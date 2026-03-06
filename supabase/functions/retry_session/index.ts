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

    // 유저 확인용
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    // DB 작업용
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

    // 원본 설정(optional)
    const { data: sourceSettings } = await admin
      .from("session_settings")
      .select("correction_mode,difficulty,question_speed")
      .eq("session_id", sourceSessionId)
      .maybeSingle();

    // 새 세션 생성
    const insertPayload = {
      user_id: user.id,
      variant: sourceSession.variant,
      package_id: sourceSession.package_id,
      scenario_id: sourceSession.scenario_id,
      started_at: new Date().toISOString(),
      ended_at: null,
      status: "active",
      end_reason: null,
      turn_limit: sourceSession.turn_limit ?? 20,
      turn_count_user: 0,
      turn_count_ai: 0,
    };

    const { data: newSession, error: newErr } = await admin
      .from("roleplay_sessions")
      .insert(insertPayload)
      .select("session_id,variant")
      .single();

    if (newErr || !newSession) {
      return json({ error: newErr?.message ?? "Failed to create new session" }, 500);
    }

    // 설정 복제(optional)
    if (sourceSettings) {
      const { error: setErr } = await admin.from("session_settings").insert({
        session_id: newSession.session_id,
        correction_mode: sourceSettings.correction_mode,
        difficulty: sourceSettings.difficulty,
        question_speed: sourceSettings.question_speed,
      });

      if (setErr) {
        return json({ error: `Session created but settings copy failed: ${setErr.message}` }, 500);
      }
    }

    return json({
      ok: true,
      new_session_id: newSession.session_id,
      variant: String(newSession.variant ?? "").toLowerCase() === "b" ? "b" : "a",
    });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? "unknown error" }, 500);
  }
});