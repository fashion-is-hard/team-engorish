import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TurnRow = {
  role: string;
  text_raw: string | null;
  created_at: string;
  audio_url?: string | null;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  variant: string;
  scenario_id: string | null;
  ended_at: string | null;
  status: string;

  score_c: number | null;
  score_a: number | null;
  score_f: number | null;
  score_p: number | null;
  score_overall: number | null;
  report_insight: any | null;
};

type ScenarioLite = {
  scenario_id: string;
  title: string | null;
  scenario_desc: string | null;
};

type AudioEval = {
  durationSec: number;
  avgLogprob: number | null;
  wordCount: number;
  wpm: number | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function wordCount(s: string) {
  const t = (s || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function normalizeVariant(v: unknown): "a" | "b" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "b" ? "b" : "a";
}

function takeLast<T>(arr: T[], n: number) {
  return arr.slice(Math.max(0, arr.length - n));
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------
// 기존 텍스트 기반 C/A/F + 기본 P
// ---------------------
function computeBaseScoresFromTurns(userTurns: string[], aiTurns: string[]) {
  const userTextAll = userTurns.join(" ").trim();
  const userWords = wordCount(userTextAll);

  const avgLen = userTurns.length ? avg(userTurns.map((t) => wordCount(t))) : 0;
  const connectors = [
    "because",
    "although",
    "however",
    "therefore",
    "which",
    "that",
    "when",
    "while",
    "if",
    "so",
  ];
  const connectorHits = connectors.reduce(
    (acc, w) => acc + (userTextAll.toLowerCase().includes(w) ? 1 : 0),
    0
  );
  const punctHits = (userTextAll.match(/[,:;]/g) ?? []).length;

  let scoreC = 40 + avgLen * 4 + connectorHits * 6 + punctHits * 1.5;
  scoreC = clamp(scoreC, 0, 100);

  const lower = userTextAll.toLowerCase();
  let penaltyA = 0;
  const badPatterns = [
    /\bi\s+no\b/g,
    /\bhe\s+go\b/g,
    /\bshe\s+go\b/g,
    /\bthey\s+goes\b/g,
    /\bdoesn't\s+have\b/g,
  ];
  badPatterns.forEach((re) => {
    penaltyA += (lower.match(re) ?? []).length * 10;
  });

  let scoreA = 75 - penaltyA - (userWords < 20 ? 10 : 0);
  scoreA = clamp(scoreA, 0, 100);

  const fillers = (lower.match(/\b(um|uh|er|ah)\b/g) ?? []).length;
  const repeats = (lower.match(/\b(\w+)\s+\1\b/g) ?? []).length;
  let scoreF = 78 - fillers * 8 - repeats * 6;
  if (userTurns.length <= 1 && userWords < 10) scoreF -= 15;
  scoreF = clamp(scoreF, 0, 100);

  const weirdTokenHits = (userTextAll.match(/[^\x00-\x7F]/g) ?? []).length;
  const aiRepeatAsks = aiTurns
    .map((t) => t.toLowerCase())
    .filter(
      (t) =>
        t.includes("could you say that again") ||
        t.includes("pardon") ||
        t.includes("repeat")
    ).length;

  let baseP = 80 - weirdTokenHits * 2 - aiRepeatAsks * 10;
  baseP = clamp(baseP, 0, 100);

  return {
    score_c: Math.round(scoreC),
    score_a: Math.round(scoreA),
    score_f: Math.round(scoreF),
    score_p_base: Math.round(baseP),
    ai_repeat_asks: aiRepeatAsks,
    weird_token_hits: weirdTokenHits,
  };
}

// ---------------------
// 음성 기반 발음 점수용 유틸
// ---------------------
function logprobToScore(avgLogprob: number | null) {
  if (avgLogprob == null || Number.isNaN(avgLogprob)) return 55;

  const hi = -0.15;
  const lo = -1.2;

  if (avgLogprob >= hi) return 95;
  if (avgLogprob <= lo) return 35;

  const ratio = (avgLogprob - lo) / (hi - lo);
  return Math.round(35 + ratio * 60);
}

function wpmToScore(wpm: number | null) {
  if (wpm == null || Number.isNaN(wpm) || !Number.isFinite(wpm)) return 60;

  if (wpm >= 90 && wpm <= 170) return 90;
  if (wpm >= 70 && wpm < 90) return 78;
  if (wpm > 170 && wpm <= 200) return 78;
  if (wpm >= 50 && wpm < 70) return 65;
  if (wpm > 200 && wpm <= 230) return 65;
  return 50;
}

async function fetchAudioAsFile(audioUrl: string, index: number): Promise<File | null> {
  try {
    const res = await fetch(audioUrl);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "audio/webm";
    const ext = contentType.includes("mpeg")
      ? "mp3"
      : contentType.includes("wav")
      ? "wav"
      : contentType.includes("ogg")
      ? "ogg"
      : "webm";

    const blob = await res.blob();
    return new File([blob], `turn_${index}.${ext}`, { type: contentType });
  } catch (e) {
    console.error("fetchAudioAsFile error:", e);
    return null;
  }
}

async function analyzePronunciationFromAudio(
  audioUrl: string,
  openaiApiKey: string,
  index: number
): Promise<AudioEval | null> {
  const file = await fetchAudioAsFile(audioUrl, index);
  if (!file) return null;

  const form = new FormData();
  form.append("file", file);
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("include[]", "logprobs");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("analyzePronunciationFromAudio error:", res.status, detail);
    return null;
  }

  const json = await res.json();

  const durationSec =
    typeof json?.duration === "number"
      ? json.duration
      : typeof json?.usage?.seconds === "number"
      ? json.usage.seconds
      : 0;

  const segments = Array.isArray(json?.segments) ? json.segments : [];
  const segLogprobs = segments
    .map((s: any) => (typeof s?.avg_logprob === "number" ? s.avg_logprob : null))
    .filter((n: number | null): n is number => n != null);

  const avgLogprob = segLogprobs.length > 0 ? avg(segLogprobs) : null;

  const words = Array.isArray(json?.words) ? json.words : [];
  const transcriptText = typeof json?.text === "string" ? json.text : "";

  const wc = words.length > 0 ? words.length : wordCount(transcriptText);
  const wpm = durationSec > 0 && wc > 0 ? (wc / durationSec) * 60 : null;

  return {
    durationSec,
    avgLogprob,
    wordCount: wc,
    wpm,
  };
}

async function computePronunciationScore(
  userTurnsWithAudio: Array<{ text: string; audio_url: string | null }>,
  aiTurns: string[],
  baseP: number,
  openaiApiKey: string
) {
  const audioTurns = userTurnsWithAudio.filter(
    (t) => typeof t.audio_url === "string" && t.audio_url
  );

  if (!audioTurns.length) {
    return {
      score_p: baseP,
      meta: {
        source: "text_fallback_v1",
        sampled_audio_turns: 0,
      },
    };
  }

  const sampleTurns = audioTurns.slice(-3);

  const evals: AudioEval[] = [];
  for (let i = 0; i < sampleTurns.length; i++) {
    const ev = await analyzePronunciationFromAudio(
      sampleTurns[i].audio_url as string,
      openaiApiKey,
      i
    );
    if (ev) evals.push(ev);
  }

  const aiRepeatAsks = aiTurns
    .map((t) => t.toLowerCase())
    .filter(
      (t) =>
        t.includes("could you say that again") ||
        t.includes("pardon") ||
        t.includes("repeat")
    ).length;

  if (!evals.length) {
    return {
      score_p: clamp(baseP - 5, 0, 100),
      meta: {
        source: "text_fallback_v1",
        sampled_audio_turns: 0,
      },
    };
  }

  const avgLogprob = avg(
    evals.map((e) => e.avgLogprob).filter((n): n is number => n != null)
  );

  const validWpms = evals
    .map((e) => e.wpm)
    .filter((n): n is number => n != null && Number.isFinite(n));

  const avgWpm = validWpms.length ? avg(validWpms) : null;

  const logprobScore = logprobToScore(Number.isFinite(avgLogprob) ? avgLogprob : null);
  const pacingScore = wpmToScore(avgWpm);

  const audioCoverage = sampleTurns.length / Math.max(1, userTurnsWithAudio.length);
  const coverageScore = 55 + audioCoverage * 35;

  let scoreP =
    logprobScore * 0.55 +
    pacingScore * 0.20 +
    coverageScore * 0.15 +
    baseP * 0.10;

  scoreP -= aiRepeatAsks * 8;
  scoreP = clamp(Math.round(scoreP), 0, 100);

  return {
    score_p: scoreP,
    meta: {
      source: "audio_v1",
      sampled_audio_turns: evals.length,
      avg_logprob: Number.isFinite(avgLogprob) ? Number(avgLogprob.toFixed(3)) : null,
      avg_wpm: avgWpm != null ? Math.round(avgWpm) : null,
      avg_duration_sec: Math.round(avg(evals.map((e) => e.durationSec)) * 10) / 10,
    },
  };
}

// ---------------------
// 점수 기반 fallback 문장
// ---------------------
function buildFallbackInsight(params: {
  scenarioTitle: string;
  score_c: number;
  score_a: number;
  score_f: number;
  score_p: number;
  overall: number;
  sessionCount: number;
}) {
  const { scenarioTitle, score_c, score_a, score_f, score_p, overall, sessionCount } = params;

  const topLabel =
    [
      { key: "논리와 전개", v: score_c },
      { key: "정확성", v: score_a },
      { key: "유창성", v: score_f },
      { key: "발음 전달력", v: score_p },
    ].sort((a, b) => b.v - a.v)[0]?.key ?? "대화 수행";

  const lowLabel =
    [
      { key: "논리와 전개", v: score_c },
      { key: "정확성", v: score_a },
      { key: "유창성", v: score_f },
      { key: "발음 전달력", v: score_p },
    ].sort((a, b) => a.v - b.v)[0]?.key ?? "표현력";

  return {
    summary:
      sessionCount <= 1
        ? `${scenarioTitle} 상황에서 기본적인 의도를 전달하고 대화를 이어갈 수 있는 수준이에요.`
        : `${scenarioTitle} 같은 실전 상황에서 이전보다 더 안정적으로 의도를 전달하고 대화를 이어가고 있어요.`,
    strengths: [
      `${scenarioTitle} 맥락에서 필요한 말을 끝까지 이어가며 대화를 유지했어요.`,
      `${topLabel} 측면이 비교적 안정적으로 드러났어요.`,
    ],
    improvements: [
      `${lowLabel}을 조금 더 다듬으면 전체 전달력이 더 좋아질 수 있어요.`,
      `실전 상황을 가정해 한 문장씩 또렷하게 말하는 연습을 이어가 보세요.`,
    ],
  };
}

// ---------------------
// LLM 기반 맥락형 리포트 생성
// ---------------------
async function generateContextualSessionInsight(params: {
  openaiApiKey: string;
  scenarioTitle: string;
  scenarioDesc: string;
  latestTurns: TurnRow[];
  score_c: number;
  score_a: number;
  score_f: number;
  score_p: number;
  score_overall: number;
  totalSessions: number;
}) {
  const {
    openaiApiKey,
    scenarioTitle,
    scenarioDesc,
    latestTurns,
    score_c,
    score_a,
    score_f,
    score_p,
    score_overall,
    totalSessions,
  } = params;

  const conversation = latestTurns
    .map((t) => ({
      role: (t.role || "").toLowerCase(),
      text: t.text_raw ?? "",
    }))
    .filter((t) => t.text.trim())
    .slice(-12);

  const system = `
You are writing a short learner-facing English speaking report in Korean.
Your job is NOT to mention C/A/F/P labels directly unless absolutely necessary.
Focus on:
1) what the learner can now do in this scenario,
2) what they did well in this session,
3) one or two actionable improvements.

Return JSON only:
{
  "summary": "string",
  "strengths": ["string", "string"],
  "improvements": ["string", "string"]
}

Rules:
- Write naturally in Korean.
- Be specific to the scenario and conversation context.
- Strengths should sound like achievement effects or concrete session feedback.
- Improvements should be constructive and actionable.
- Avoid technical scoring jargon.
- Do not mention raw numbers in the text unless needed.
- Keep each bullet concise.
`.trim();

  const user = {
    scenarioTitle,
    scenarioDesc,
    totalSessions,
    scores: {
      complexity: score_c,
      accuracy: score_a,
      fluency: score_f,
      pronunciation: score_p,
      overall: score_overall,
    },
    conversation,
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
      text: { format: { type: "json_object" } },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`insight generation failed: ${res.status} ${detail}`);
  }

  const json = await res.json();

  let text = "";
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    text = json.output_text.trim();
  } else if (Array.isArray(json?.output)) {
    for (const item of json.output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (typeof c?.text === "string" && c.text.trim()) {
          text = c.text.trim();
          break;
        }
      }
      if (text) break;
    }
  }

  const parsed = safeJsonParse(text);
  if (!parsed) {
    throw new Error("invalid insight json");
  }

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.filter((x: unknown) => typeof x === "string").slice(0, 3)
      : [],
    improvements: Array.isArray(parsed.improvements)
      ? parsed.improvements.filter((x: unknown) => typeof x === "string").slice(0, 3)
      : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: sessRows, error: sessErr } = await supabase
      .from("roleplay_sessions")
      .select(
        "session_id,user_id,variant,scenario_id,ended_at,status,score_c,score_a,score_f,score_p,score_overall,report_insight"
      )
      .eq("user_id", userId)
      .eq("status", "ended")
      .order("ended_at", { ascending: true });

    if (sessErr) throw new Error(sessErr.message);

    const sessions = (sessRows ?? []) as SessionRow[];
    const updatedSessions: SessionRow[] = [];

    for (let idx = 0; idx < sessions.length; idx++) {
      const s = sessions[idx];
      const reportMeta = s.report_insight ?? {};

      const needRecompute =
        s.score_c == null ||
        s.score_a == null ||
        s.score_f == null ||
        s.score_p == null ||
        s.score_overall == null ||
        reportMeta?.insight_version !== "context_v2" ||
        reportMeta?.p_source !== "audio_v1";

      if (!needRecompute) {
        updatedSessions.push(s);
        continue;
      }

      const { data: turns, error: tErr } = await supabase
        .from("roleplay_turns")
        .select("role,text_raw,created_at,audio_url")
        .eq("session_id", s.session_id)
        .order("created_at", { ascending: true });

      if (tErr) {
        console.error("turn fetch error:", tErr.message);
        updatedSessions.push(s);
        continue;
      }

      const { data: scenarioData } = await supabase
        .from("scenarios")
        .select("scenario_id,title,scenario_desc")
        .eq("scenario_id", s.scenario_id)
        .maybeSingle();

      const scenario = (scenarioData ?? null) as ScenarioLite | null;

      const t = (turns ?? []) as TurnRow[];

      const userTurns = t
        .filter((x) => (x.role || "").toLowerCase() === "user")
        .map((x) => x.text_raw ?? "")
        .filter(Boolean);

      const aiTurns = t
        .filter((x) => ["ai", "assistant"].includes((x.role || "").toLowerCase()))
        .map((x) => x.text_raw ?? "")
        .filter(Boolean);

      const userTurnsWithAudio = t
        .filter((x) => (x.role || "").toLowerCase() === "user")
        .map((x) => ({
          text: x.text_raw ?? "",
          audio_url: x.audio_url ?? null,
        }))
        .filter((x) => x.text);

      const base = computeBaseScoresFromTurns(userTurns, aiTurns);

      const pResult = await computePronunciationScore(
        userTurnsWithAudio,
        aiTurns,
        base.score_p_base,
        OPENAI_API_KEY
      );

      const score_c = base.score_c;
      const score_a = base.score_a;
      const score_f = base.score_f;
      const score_p = pResult.score_p;
      const score_overall = clamp(
        Math.round(score_c * 0.25 + score_a * 0.35 + score_f * 0.20 + score_p * 0.20),
        0,
        100
      );

      let contextualInsight: {
        summary: string;
        strengths: string[];
        improvements: string[];
      };

      try {
        contextualInsight = await generateContextualSessionInsight({
          openaiApiKey: OPENAI_API_KEY,
          scenarioTitle: scenario?.title ?? "이 시나리오",
          scenarioDesc: scenario?.scenario_desc ?? "",
          latestTurns: takeLast(t, 12),
          score_c,
          score_a,
          score_f,
          score_p,
          score_overall,
          totalSessions: idx + 1,
        });
      } catch (e) {
        console.error("generateContextualSessionInsight error:", e);
        contextualInsight = buildFallbackInsight({
          scenarioTitle: scenario?.title ?? "이 시나리오",
          score_c,
          score_a,
          score_f,
          score_p,
          overall: score_overall,
          sessionCount: idx + 1,
        });
      }

      const patch = {
        score_c,
        score_a,
        score_f,
        score_p,
        score_overall,
        report_insight: {
          ...contextualInsight,
          insight_version: "context_v2",
          scenario_title: scenario?.title ?? null,
          p_source: pResult.meta.source,
          p_meta: pResult.meta,
        },
      };

      await supabase.from("roleplay_sessions").update(patch).eq("session_id", s.session_id);

      updatedSessions.push({ ...s, ...patch } as any);
    }

    const series = updatedSessions
      .filter((s) => s.score_overall != null)
      .map((s) => ({
        session_id: s.session_id,
        ended_at: s.ended_at,
        variant: normalizeVariant(s.variant),
        c: s.score_c ?? 0,
        a: s.score_a ?? 0,
        f: s.score_f ?? 0,
        p: s.score_p ?? 0,
        overall: s.score_overall ?? 0,
      }));

    const latest = series.length ? series[series.length - 1] : null;

    const avgC = Math.round(avg(series.map((x) => x.c)));
    const avgA = Math.round(avg(series.map((x) => x.a)));
    const avgF = Math.round(avg(series.map((x) => x.f)));
    const avgP = Math.round(avg(series.map((x) => x.p)));
    const avgOverall = Math.round(avg(series.map((x) => x.overall)));

    const latestSession = updatedSessions.length
      ? updatedSessions[updatedSessions.length - 1]
      : null;

    const insight =
      latestSession?.report_insight
        ? {
            summary:
              typeof latestSession.report_insight.summary === "string"
                ? latestSession.report_insight.summary
                : "이번 세션의 종합 인사이트를 준비 중이에요.",
            detail: {
              strengths: Array.isArray(latestSession.report_insight.strengths)
                ? latestSession.report_insight.strengths.slice(0, 3)
                : [],
              improvements: Array.isArray(latestSession.report_insight.improvements)
                ? latestSession.report_insight.improvements.slice(0, 3)
                : [],
            },
          }
        : {
            summary:
              series.length === 0
                ? "아직 기록이 없어요. 첫 세션을 완료하면 성장 그래프가 쌓여요."
                : `최근 세션 기준 종합 점수는 ${latest?.overall ?? 0}점이에요.`,
            detail: { strengths: [], improvements: [] },
          };

    return new Response(
      JSON.stringify({
        ok: true,
        totals: {
          sessions: series.length,
          avg: { c: avgC, a: avgA, f: avgF, p: avgP, overall: avgOverall },
          latest: latest
            ? {
                c: latest.c,
                a: latest.a,
                f: latest.f,
                p: latest.p,
                overall: latest.overall,
              }
            : null,
        },
        series,
        insight,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});