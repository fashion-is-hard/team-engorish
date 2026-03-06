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
    const sessionId = String(body?.sessionId ?? "").trim();
    if (!sessionId) return json({ error: "sessionId required" }, 400);

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
      .select("session_id,user_id,variant,package_id,scenario_id,status,end_reason")
      .eq("session_id", sessionId)
      .single();

    if (sErr || !sourceSession) {
      return json({ error: sErr?.message ?? "Source session not found" }, 404);
    }

    if (sourceSession.user_id !== user.id) {
      return json({ error: "Forbidden" }, 403);
    }

    const variant = normalizeVariant(sourceSession.variant);

    // ✅ 성공 세션만 다음 시나리오 이동 허용
    const isSuccess =
      variant === "b"
        ? sourceSession.status === "ended" && sourceSession.end_reason === "goals_done"
        : sourceSession.status === "ended" && sourceSession.end_reason === "turn_limit";

    if (!isSuccess) {
      return json({ error: "Only successful sessions can move to next scenario" }, 400);
    }

    if (!sourceSession.package_id || !sourceSession.scenario_id) {
      return json({ error: "package_id or scenario_id missing" }, 400);
    }

    // 패키지 시나리오 목록
    const { data: allScenarios, error: allErr } = await admin
      .from("scenarios")
      .select("scenario_id,sort_order,created_at,is_active")
      .eq("package_id", sourceSession.package_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (allErr) return json({ error: allErr.message }, 500);

    const list = allScenarios ?? [];
    const idx = list.findIndex((s: any) => s.scenario_id === sourceSession.scenario_id);

    if (idx < 0) return json({ error: "Current scenario not found in package list" }, 404);

    const nextScenario = list[idx + 1] ?? null;

    if (!nextScenario) {
      return json({ ok: true, done: true, variant, next_scenario_id: null });
    }

    return json({ ok: true, done: false, variant, next_scenario_id: nextScenario.scenario_id });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? "unknown error" }, 500);
  }
});