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

function coerceJson(def: any) {
  if (typeof def === "string") {
    try {
      return JSON.parse(def);
    } catch {
      return null;
    }
  }
  return def;
}

function getIntent(def: any): string | null {
  const d = coerceJson(def);
  const intent = d?.intent;
  if (typeof intent !== "string") return null;
  const s = intent.trim();
  return s ? s : null;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return okEmpty();
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json();
    const sessionId = String(body?.sessionId ?? "").trim();
    if (!sessionId) return json({ error: "sessionId required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1) session
    const { data: session, error: sErr } = await supabase
      .from("roleplay_sessions")
      .select("session_id,variant,scenario_id,status,end_reason,turn_limit,turn_count_user,turn_count_ai")
      .eq("session_id", sessionId)
      .single();

    if (sErr || !session) return json({ error: sErr?.message ?? "session not found" }, 404);
    if (!session.scenario_id) return json({ error: "scenario_id missing" }, 400);

    const variant = String(session.variant ?? "a").toLowerCase() === "b" ? "b" : "a";

    // 2) scenario
    const { data: scenario } = await supabase
      .from("scenarios")
      .select("scenario_id,title,scenario_desc,package_id")
      .eq("scenario_id", session.scenario_id)
      .single();

    // 3) goals (B만)
    let goals: any[] = [];
    if (variant === "b") {
      const { data: gData } = await supabase
        .from("scenario_goals")
        .select("goal_id,scenario_id,goal_title,goal_type,goal_definition,success_threshold,is_active,created_at")
        .eq("scenario_id", session.scenario_id)
        .eq("is_active", true)
        .order("created_at", { ascending: true });

      goals = (gData ?? []).map((g: any) => ({
        goal_id: g.goal_id,
        goal_title: g.goal_title,
        goal_type: g.goal_type,
        intent: getIntent(g.goal_definition),
      })).filter((g: any) => g.goal_id && g.intent);
    }

    // 4) turns
    const { data: tData, error: tErr } = await supabase
      .from("roleplay_turns")
      .select("turn_no,role,text_raw,created_at")
      .eq("session_id", sessionId)
      .order("turn_no", { ascending: true });

    if (tErr) return json({ error: tErr.message }, 500);

    const turns = (tData ?? []).map((t: any) => ({
      role: (t.role === "assistant" || t.role === "ai") ? "ai" : "user",
      text: String(t.text_raw ?? "").trim(),
    })).filter((x: any) => x.text);

    // B가 아니면 목표 기반 성공/실패가 애매하니: A는 항상 "완료"로 처리
    if (variant === "a") {
      const success = true;
      return json({
        variant,
        success,
        achieved_goal_ids: [],
        goals: [],
        insight: {
          title: "세션을 완료했어요!",
          box1: { title: "이 표현이 특히 좋았어요!", bullets: ["대화 흐름을 잘 유지했어요."] },
          box2: { title: "다음엔 이렇게 해봐요", bullets: ["답변을 1문장 더 확장해보면 더 자연스러워요."] },
          next_hint: "다음 미션으로 넘어가 볼까요?",
        },
        scenario: { title: scenario?.title ?? "시나리오" },
      });
    }

    // 5) LLM으로 intent 달성 판정 + 인사이트 생성
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
    if (!OPENAI_API_KEY) {
      // 키 없으면 최소 응답(목표는 전부 미달성 처리)
      return json({
        variant,
        success: false,
        achieved_goal_ids: [],
        goals,
        insight: {
          title: "목표를 달성하지 못했어요",
          box1: { title: "더 나아가기 위해서", bullets: ["다음엔 목표 의도를 더 직접적으로 말해보세요."] },
          box2: { title: "다시 도전해보세요!", bullets: ["짧게라도 intent를 분명히 드러내면 체크돼요."] },
          next_hint: "다시 한 번 도전해볼까요?",
        },
        scenario: { title: scenario?.title ?? "시나리오" },
      });
    }

    const prompt = {
      scenarioTitle: scenario?.title ?? "",
      goals: goals.map((g) => ({
        goal_id: g.goal_id,
        goal_title: g.goal_title,
        intent: g.intent,
      })),
      transcript: turns.slice(-30), // 너무 길어지면 비용↑ / 최근 30개만 (원하면 늘려)
      rules: [
        "Return ONLY JSON.",
        "Be conservative: avoid false positives.",
        "A goal is achieved only if user's utterances clearly satisfy the intent.",
        "Insights must be short and friendly (Korean).",
      ],
      output_schema: {
        achieved_goal_ids: ["uuid"],
        success: "boolean",
        insight: {
          title: "string",
          box1: { title: "string", bullets: ["string"] },
          box2: { title: "string", bullets: ["string"] },
          next_hint: "string",
        },
      },
    };

    const payload = {
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an evaluator for an English roleplay app. Output JSON only. No extra text.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const txt = await r.text();
    if (!r.ok) return json({ error: `OpenAI ${r.status}`, detail: txt }, 500);

    const j = JSON.parse(txt);
    const content = j?.choices?.[0]?.message?.content ?? "{}";
    const out = JSON.parse(content);

    const achieved = Array.isArray(out?.achieved_goal_ids) ? out.achieved_goal_ids : [];
    const achieved_goal_ids = achieved.filter((x: any) => typeof x === "string");

    // “성공” 기준: 모든 goal 달성
    const success = goals.length > 0 && goals.every((g) => achieved_goal_ids.includes(g.goal_id));

    // out.success가 있어도 최종은 위 success로 통일
    const insight = out?.insight ?? {};
    const title = success ? "목표를 달성했어요!" : "목표를 달성하지 못했어요";

    return json({
      variant,
      success,
      achieved_goal_ids,
      goals,
      insight: {
        title: String(insight.title ?? title),
        box1: {
          title: String(insight?.box1?.title ?? (success ? "이 표현이 특히 좋았어요!" : "더 나아가기 위해서")),
          bullets: Array.isArray(insight?.box1?.bullets) ? insight.box1.bullets.slice(0, 3) : [],
        },
        box2: {
          title: String(insight?.box2?.title ?? (success ? "이 표현이 특히 좋았어요!" : "다시 도전해보세요!")),
          bullets: Array.isArray(insight?.box2?.bullets) ? insight.box2.bullets.slice(0, 3) : [],
        },
        next_hint: String(insight?.next_hint ?? "다음 미션으로 넘어가 볼까요?"),
      },
      scenario: { title: scenario?.title ?? "시나리오" },
    });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? "unknown error" }, 500);
  }
});