import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function okEmpty() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function normalizeVariant(v: unknown): "a" | "b" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "b" ? "b" : "a";
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return okEmpty();
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json();
    const sourceSessionId = String(body?.sessionId ?? "").trim();
    if (!sourceSessionId) return json({ error: "sessionId required" }, 400);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // 원본 세션
    const { data: sourceSession, error: sErr } = await admin
      .from("roleplay_sessions")
      .select("*")
      .eq("session_id", sourceSessionId)
      .single();

    if (sErr || !sourceSession) {
      return json({ error: sErr?.message ?? "Source session not found" }, 404);
    }

    if (sourceSession.user_id !== user.id) {
      return json({ error: "Forbidden" }, 403);
    }

    if (!sourceSession.package_id || !sourceSession.scenario_id) {
      return json({ error: "package_id or scenario_id missing" }, 400);
    }

    const variant = normalizeVariant(sourceSession.variant);

    // 성공 세션만 다음으로 이동 허용
    const isSuccess =
      variant === "b"
        ? sourceSession.end_reason === "goals_done"
        : sourceSession.end_reason === "turn_limit";

    if (!isSuccess) {
      return json({ error: "Only successful sessions can move to next scenario" }, 400);
    }

    // 현재 시나리오 조회
    const { data: currentScenario, error: curErr } = await admin
      .from("scenarios")
      .select("scenario_id,package_id,sort_order,created_at")
      .eq("scenario_id", sourceSession.scenario_id)
      .single();

    if (curErr || !currentScenario) {
      return json({ error: curErr?.message ?? "Current scenario not found" }, 404);
    }

    // 같은 패키지 전체 시나리오
    const { data: allScenarios, error: allErr } = await admin
      .from("scenarios")
      .select("scenario_id,package_id,sort_order,created_at,is_active")
      .eq("package_id", sourceSession.package_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (allErr) {
      return json({ error: allErr.message }, 500);
    }

    const list = allScenarios ?? [];
    const currentIdx = list.findIndex((s: any) => s.scenario_id === sourceSession.scenario_id);

    if (currentIdx < 0) {
      return json({ error: "Current scenario index not found" }, 404);
    }

    const nextScenario = list[currentIdx + 1] ?? null;

    if (!nextScenario) {
      return json({
        ok: true,
        done: true,
        next_session_id: null,
        next_scenario_id: null,
        variant,
      });
    }

    // 원본 세션 설정(optional)
    const { data: sourceSettings } = await admin
      .from("session_settings")
      .select("correction_mode,difficulty,question_speed")
      .eq("session_id", sourceSessionId)
      .maybeSingle();

    // 새 세션 생성
    const { data: newSession, error: newErr } = await admin
      .from("roleplay_sessions")
      .insert({
        user_id: user.id,
        variant,
        package_id: sourceSession.package_id,
        scenario_id: nextScenario.scenario_id,
        started_at: new Date().toISOString(),
        ended_at: null,
        status: "active",
        end_reason: null,
        turn_limit: sourceSession.turn_limit ?? 20,
        turn_count_user: 0,
        turn_count_ai: 0,
      })
      .select("session_id")
      .single();

    if (newErr || !newSession) {
      return json({ error: newErr?.message ?? "Failed to create next session" }, 500);
    }

    if (sourceSettings) {
      const { error: setErr } = await admin.from("session_settings").insert({
        session_id: newSession.session_id,
        correction_mode: sourceSettings.correction_mode,
        difficulty: sourceSettings.difficulty,
        question_speed: sourceSettings.question_speed,
      });

      if (setErr) {
        return json({ error: `Next session created but settings copy failed: ${setErr.message}` }, 500);
      }
    }

    return json({
      ok: true,
      done: false,
      next_session_id: newSession.session_id,
      next_scenario_id: nextScenario.scenario_id,
      variant,
    });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? "unknown error" }, 500);
  }
});