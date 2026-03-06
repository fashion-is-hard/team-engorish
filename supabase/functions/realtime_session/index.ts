/// <reference types="https://deno.land/x/supabase_functions@1.0.0/mod.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

type ReqBody = {
  scenarioTitle?: string;
  scenarioDesc?: string;
  npcRoleName?: string;
  npcRoleDesc?: string;
  difficulty?: "basic" | "intermediate";
  correctionMode?: "correct" | "suggest";
  voice?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return json({ ok: true, function: "realtime_session" });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY" }, 500);
  }

  let body: ReqBody = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body
  }

  const {
    scenarioTitle = "Scenario",
    scenarioDesc = "",
    npcRoleName = "NPC",
    npcRoleDesc = "",
    difficulty = "basic",
    correctionMode = "suggest",
    voice = "marin",
  } = body;

  const instructions = [
    `You are roleplaying as an NPC in an English conversation training app.`,
    `Speak only in English.`,
    `Keep each reply natural and short.`,
    `Ask one question at a time.`,
    `Stay in character.`,
    `Scenario title: ${scenarioTitle}`,
    scenarioDesc ? `Scenario situation: ${scenarioDesc}` : "",
    `You are: ${npcRoleName}`,
    npcRoleDesc ? `Role details: ${npcRoleDesc}` : "",
    `Difficulty: ${difficulty}`,
    `Correction mode: ${correctionMode}`,
    `The user is speaking with voice. Reply with conversational spoken English, not long written paragraphs.`,
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    session: {
      type: "realtime",
      model: "gpt-realtime",
      output_modalities: ["audio", "text"],
      instructions,
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            language: "en",
          },
          turn_detection: {
            type: "server_vad",
            create_response: true,
          },
        },
        output: {
          voice,
        },
      },
    },
  };

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    return json({ error: "OpenAI realtime_session error", detail: data }, 400);
  }

  // docs example browser code expects data.value, but endpoint returns client_secret.value
  return json(
    {
      value: data?.client_secret?.value ?? null,
      expires_at: data?.client_secret?.expires_at ?? null,
      raw: data,
    },
    200
  );
});