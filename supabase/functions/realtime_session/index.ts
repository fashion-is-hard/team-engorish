import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY" }, 500);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const instructions =
    typeof body?.instructions === "string" && body.instructions.trim()
      ? body.instructions
      : "You are an English conversation partner. Only speak English.";

  const voice =
    typeof body?.voice === "string" && body.voice.trim()
      ? body.voice
      : "marin";

  const payload = {
    type: "realtime",
    model: "gpt-realtime",
    instructions,
    audio: {
      input: {
        format: {
          type: "audio/pcm",
          rate: 24000,
        },
        transcription: {
          model: "gpt-4o-mini-transcribe",
          language: "en",
        },
        turn_detection: null,
        noise_reduction: {
          type: "near_field",
        },
      },
      output: {
        format: {
          type: "audio/pcm",
          rate: 24000,
        },
        voice,
        speed: 1,
      },
    },
  };

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();

  let out: any = null;
  try {
    out = JSON.parse(raw);
  } catch {
    return json({ error: "OpenAI returned non-JSON", raw }, 502);
  }

  if (!res.ok) {
    return json(
      {
        error: out?.error?.message ?? out?.error ?? "Failed to create realtime client secret",
        detail: out,
      },
      res.status
    );
  }

  const value =
    typeof out?.client_secret?.value === "string" && out.client_secret.value.trim()
      ? out.client_secret.value.trim()
      : typeof out?.value === "string" && out.value.trim()
        ? out.value.trim()
        : null;

  const expires_at = out?.client_secret?.expires_at ?? out?.expires_at ?? null;

  if (!value) {
    return json(
      {
        error: "realtime token missing",
        detail: out,
      },
      502
    );
  }

  return json({ value, expires_at });
});