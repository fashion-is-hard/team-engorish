/// <reference types="https://deno.land/x/supabase_functions@1.0.0/mod.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  sessionId?: string;
  text: string;
  voice?: string;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return json({ ok: true, function: "chat_tts" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed", method: req.method }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY in secrets" }, 500);
  }
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

  const { sessionId = "no_session", text, voice = "alloy" } = body;

  if (!text?.trim()) {
    return json({ error: "text required" }, 400);
  }

  const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      format: "mp3",
      input: text,
    }),
  });

  if (!ttsResp.ok) {
    const errText = await ttsResp.text();
    return json({ tts_audio_url: null, tts_error: errText }, 400);
  }

  const audioBytes = new Uint8Array(await ttsResp.arrayBuffer());
  const filePath = `session_${sessionId}/${crypto.randomUUID()}.mp3`;

  const { error: upErr } = await supabase.storage.from("tts").upload(filePath, audioBytes, {
    contentType: "audio/mpeg",
    upsert: true,
  });

  if (upErr) {
    return json({ tts_audio_url: null, tts_error: upErr.message }, 400);
  }

  const { data: pub } = supabase.storage.from("tts").getPublicUrl(filePath);
  return json({ tts_audio_url: pub?.publicUrl ?? null }, 200);
});