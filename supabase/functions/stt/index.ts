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
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: CORS_HEADERS,
    });
  }

  if (req.method === "GET") {
    return json({ ok: true, function: "stt", method: "GET" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed", method: req.method }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY in secrets" }, 500);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return json({ error: "file required" }, 400);
    }

    const openaiForm = new FormData();
    openaiForm.append("file", file, file.name || "recording.webm");
    openaiForm.append("model", "gpt-4o-mini-transcribe");

    const language = formData.get("language");
    if (typeof language === "string" && language.trim()) {
      openaiForm.append("language", language.trim());
    }

    const prompt = formData.get("prompt");
    if (typeof prompt === "string" && prompt.trim()) {
      openaiForm.append("prompt", prompt.trim());
    }

    const temperature = formData.get("temperature");
    if (typeof temperature === "string" && temperature.trim()) {
      openaiForm.append("temperature", temperature.trim());
    }

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: openaiForm,
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json(
        {
          error: "OpenAI transcription error",
          status: resp.status,
          detail,
        },
        400
      );
    }

    const result = await resp.json();
    const text = typeof result?.text === "string" ? result.text.trim() : "";

    return json({ text }, 200);
  } catch (error) {
    console.error("stt function error:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});