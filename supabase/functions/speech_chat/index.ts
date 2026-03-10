/// <reference types="https://deno.land/x/supabase_functions@1.0.0/mod.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  })
}

serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS })
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")

  if (!OPENAI_API_KEY) {
    return json({ error: "Missing OPENAI_API_KEY" }, 500)
  }

  try {

    const form = await req.formData()

    const file = form.get("file") as File
    const sessionId = form.get("sessionId") as string
    const scenarioTitle = form.get("scenarioTitle") as string
    const scenarioDesc = form.get("scenarioDesc") as string
    const npcRole = form.get("npcRole") as string
    const npcDesc = form.get("npcDesc") as string

    if (!file) {
      return json({ error: "Audio file required" }, 400)
    }

    /* ---------------- STT ---------------- */

    const sttForm = new FormData()
    sttForm.append("file", file)
    sttForm.append("model", "gpt-4o-mini-transcribe")

    const sttRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: sttForm
    })

    const sttJson = await sttRes.json()

    const userText = sttJson.text?.trim() || ""

    if (!userText) {
      return json({ error: "No speech detected" }, 400)
    }

    /* ---------------- LLM ---------------- */

    const systemPrompt = `
You are roleplaying in an English conversation training app.

SCENARIO
Title: ${scenarioTitle}
Description: ${scenarioDesc}

ROLE
You are ${npcRole}.
${npcDesc}

RULES
- Speak only English
- Keep sentences short
- Ask one question at a time
- Stay in character

Return JSON with:
ai_text
`

    const chatRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText }
        ],
        text: { format: { type: "json_object" } }
      })
    })

    const chatJson = await chatRes.json()

    let aiText = ""

    try {
      const parsed = JSON.parse(chatJson.output_text)
      aiText = parsed.ai_text
    } catch {
      aiText = chatJson.output_text
    }

    /* ---------------- TTS ---------------- */

    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        format: "mp3",
        input: aiText
      })
    })

    const audioBuffer = await ttsRes.arrayBuffer()

    const base64 = btoa(
      String.fromCharCode(...new Uint8Array(audioBuffer))
    )

    return json({
      user_text: userText,
      ai_text: aiText,
      audio_base64: base64
    })

  } catch (err) {

    console.error(err)

    return json({
      error: "speech_chat failed"
    }, 500)

  }

})