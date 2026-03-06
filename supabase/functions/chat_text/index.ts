/// <reference types="https://deno.land/x/supabase_functions@1.0.0/mod.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type ReqBody = {
  sessionId?: string;
  userText: string;
  mode?: "correct" | "suggest";
  difficulty?: "basic" | "intermediate";
  questionSpeed?: number;
  scenarioTitle?: string;
  scenarioDesc?: string;
  npcRoleName?: string;
  npcRoleDesc?: string;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function extractOutputText(respJson: any): string {
  if (typeof respJson?.output_text === "string" && respJson.output_text.trim()) {
    return respJson.output_text.trim();
  }

  const out = respJson?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const t = c?.text;
          if (typeof t === "string" && t.trim()) return t.trim();
        }
      }
    }
  }

  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return json({ ok: true, function: "chat_text" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed", method: req.method }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY in secrets" }, 500);
  }

  let body: ReqBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON body", detail: String(e) }, 400);
  }

  const {
    userText,
    mode = "suggest",
    difficulty = "basic",
    questionSpeed = 1.0,
    scenarioTitle = "Scenario",
    scenarioDesc = "",
    npcRoleName = "NPC",
    npcRoleDesc = "",
  } = body;

  if (!userText?.trim()) {
    return json({ error: "userText required" }, 400);
  }

  const system = [
    `You are roleplaying as an NPC in an English conversation training app.`,
    ``,
    `SCENARIO`,
    `Title: ${scenarioTitle}`,
    scenarioDesc ? `Situation: ${scenarioDesc}` : "",
    ``,
    `ROLE`,
    `You are: ${npcRoleName}.`,
    npcRoleDesc ? `Role details: ${npcRoleDesc}` : "",
    ``,
    `RULES`,
    `1) Speak only in English.`,
    `2) Keep it natural and short.`,
    `3) Ask one question at a time.`,
    `4) Stay in character.`,
    ``,
    `DIFFICULTY: ${difficulty}`,
    `QUESTION_SPEED: ${questionSpeed}`,
    `CORRECTION_MODE: ${mode}`,
    ``,
    `Return JSON ONLY with keys: ai_text, correction (nullable).`,
    `If mode is "correct", correction must be the corrected version of the user's last sentence.`,
    `If mode is "suggest", correction can be a more natural option or null.`,
  ]
    .filter(Boolean)
    .join("\n");

  const chatResp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      text: { format: { type: "json_object" } },
    }),
  });

  if (!chatResp.ok) {
    const errText = await chatResp.text();
    return json({ error: "OpenAI chat_text error", status: chatResp.status, detail: errText }, 400);
  }

  const chatJson = await chatResp.json();
  const rawText = extractOutputText(chatJson);

  let ai_text = "";
  let correction: string | null = null;

  try {
    const parsed = JSON.parse(rawText);
    ai_text = String(parsed?.ai_text ?? "").trim();
    correction = parsed?.correction ?? null;
  } catch {
    ai_text = rawText || "Sorry, could you say that again?";
    correction = null;
  }

  return json({ ai_text, correction }, 200);
});