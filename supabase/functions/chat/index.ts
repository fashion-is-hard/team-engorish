/// <reference types="https://deno.land/x/supabase_functions@1.0.0/mod.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ChatHistoryItem = {
  role: "assistant" | "user";
  text: string;
};

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
  messages?: ChatHistoryItem[];
  isClosing?: boolean;
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

function normalizeHistory(messages: unknown): Array<{ role: "assistant" | "user"; content: string }> {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(
      (m): m is ChatHistoryItem =>
        !!m &&
        typeof m === "object" &&
        (m as any).role &&
        ((m as any).role === "assistant" || (m as any).role === "user") &&
        typeof (m as any).text === "string"
    )
    .map((m) => ({
      role: m.role,
      content: m.text.trim(),
    }))
    .filter((m) => m.content.length > 0)
    .slice(-12);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return json({ ok: true, function: "chat", method: "GET" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed", method: req.method }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY in secrets" }, 500);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in secrets" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: ReqBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Invalid JSON body", detail: String(e) }, 400);
  }

  const {
    sessionId = "no_session",
    userText,
    mode = "suggest",
    difficulty = "basic",
    questionSpeed = 1.0,
    scenarioTitle = "Scenario",
    scenarioDesc = "",
    npcRoleName = "NPC",
    npcRoleDesc = "",
    messages = [],
    isClosing = false,
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
    `3) Ask one question at a time unless you are closing the conversation.`,
    `4) Stay in character.`,
    `5) Be consistent with the previous conversation history.`,
    isClosing
      ? `6) The conversation goals are already completed. End the conversation naturally based on what has already been said. Do not introduce a new topic. Keep the closing short and warm.`
      : `6) Continue the conversation naturally from the previous dialogue.`,
    ``,
    `DIFFICULTY: ${difficulty}`,
    `QUESTION_SPEED: ${questionSpeed}`,
    `CORRECTION_MODE: ${mode}`,
    ``,
    `Return JSON ONLY with keys: ai_text, correction (nullable).`,
    `If mode is "correct", correction must be the corrected version of the user's last sentence.`,
    `If mode is "suggest", correction can be a more natural option or null.`,
    `If isClosing is true, correction should usually be null.`,
  ]
    .filter(Boolean)
    .join("\n");

  const historyInputs = normalizeHistory(messages);

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
        ...historyInputs,
        { role: "user", content: userText.trim() },
      ],
      text: { format: { type: "json_object" } },
    }),
  });

  if (!chatResp.ok) {
    const errText = await chatResp.text();
    return json({ error: "OpenAI chat error", status: chatResp.status, detail: errText }, 400);
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

  const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      format: "mp3",
      input: ai_text,
    }),
  });

  if (!ttsResp.ok) {
    const errText = await ttsResp.text();
    return json({ ai_text, correction, tts_audio_url: null, tts_error: errText }, 200);
  }

  const audioBytes = new Uint8Array(await ttsResp.arrayBuffer());

  const filePath = `session_${sessionId}/${crypto.randomUUID()}.mp3`;
  const { error: upErr } = await supabase.storage.from("tts").upload(filePath, audioBytes, {
    contentType: "audio/mpeg",
    upsert: true,
  });

  if (upErr) {
    return json({ ai_text, correction, tts_audio_url: null, tts_error: upErr.message }, 200);
  }

  const { data: pub } = supabase.storage.from("tts").getPublicUrl(filePath);
  const tts_audio_url = pub?.publicUrl ?? null;

  return json({ ai_text, correction, tts_audio_url }, 200);
});