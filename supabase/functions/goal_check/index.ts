import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

function getIntent(def: any): string | null {
  if (!def) return null;
  if (typeof def === "string") {
    try {
      def = JSON.parse(def);
    } catch {
      return null;
    }
  }
  const intent = def?.intent;
  if (typeof intent !== "string") return null;
  const s = intent.trim();
  return s ? s : null;
}

Deno.serve(async (req) => {
  try {
    // ✅ CORS preflight 먼저 처리
    if (req.method === "OPTIONS") return okEmpty();

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json();
    const userText = typeof body.userText === "string" ? body.userText : "";
    const goalsRaw = Array.isArray(body.goals) ? body.goals : [];

    if (!userText.trim()) return json({ achieved_goal_ids: [] });

    const goals = goalsRaw
      .map((g: any) => ({
        goal_id: g.goal_id,
        intent: getIntent(g.goal_definition),
        goal_title: g.goal_title ?? "",
      }))
      .filter((g: any) => typeof g.goal_id === "string" && g.goal_id && g.intent);

    if (goals.length === 0) return json({ achieved_goal_ids: [] });

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
    if (!OPENAI_API_KEY) {
      return json({ achieved_goal_ids: [], warning: "OPENAI_API_KEY not set" });
    }

    const payload = {
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You evaluate whether the user's utterance achieves any of the listed intents.
Return ONLY JSON: {"achieved_goal_ids":["..."]}

Rules:
- Be conservative (avoid false positives).
- Mark achieved only when the utterance clearly satisfies the intent.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            userText,
            goals: goals.map((g: any) => ({
              goal_id: g.goal_id,
              intent: g.intent,
              goal_title: g.goal_title,
            })),
          }),
        },
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

    const ids = Array.isArray(out?.achieved_goal_ids) ? out.achieved_goal_ids : [];
    const achieved_goal_ids = ids.filter((x: any) => typeof x === "string");

    return json({ achieved_goal_ids });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? "unknown error" }, 500);
  }
});