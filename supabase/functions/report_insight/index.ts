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

  // 0에 가까울수록 더 좋음, -1.2 이하면 낮게
  const hi = -0.15;
  const lo = -1.2;

  if (avgLogprob >= hi) return 95;
  if (avgLogprob <= lo) return 35;

  const ratio = (avgLogprob - lo) / (hi - lo);
  return Math.round(35 + ratio * 60);
}

function wpmToScore(wpm: number | null) {
  if (wpm == null || Number.isNaN(wpm) || !Number.isFinite(wpm)) return 60;

  // 대략 90~170 사이를 가장 안정적으로 보고 점수화
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
    .map((s: any) =>
      typeof s?.avg_logprob === "number" ? s.avg_logprob : null
    )
    .filter((n: number | null): n is number => n != null);

  const avgLogprob =
    segLogprobs.length > 0 ? avg(segLogprobs) : null;

  const words = Array.isArray(json?.words) ? json.words : [];
  const transcriptText =
    typeof json?.text === "string" ? json.text : "";

  const wc = words.length > 0 ? words.length : wordCount(transcriptText);
  const wpm =
    durationSec > 0 && wc > 0 ? (wc / durationSec) * 60 : null;

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

  // 비용/지연 제어: 최근 3개만 샘플
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
    evals
      .map((e) => e.avgLogprob)
      .filter((n): n is number => n != null)
  );

  const validWpms = evals
    .map((e) => e.wpm)
    .filter((n): n is number => n != null && Number.isFinite(n));

  const avgWpm = validWpms.length ? avg(validWpms) : null;

  const logprobScore = logprobToScore(
    Number.isFinite(avgLogprob) ? avgLogprob : null
  );
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

function buildBasicInsight(latest: any) {
  const { score_c, score_a, score_f, score_p } = latest;

  const pairs = [
    { k: "C(Complexity)", v: score_c },
    { k: "A(Accuracy)", v: score_a },
    { k: "F(Fluency)", v: score_f },
    { k: "P(Pronunciation)", v: score_p },
  ].sort((a, b) => b.v - a.v);

  const strengths = [
    `${pairs[0].k}가 상대적으로 좋아요 (${pairs[0].v}점).`,
    `${pairs[1].k}도 안정적이에요 (${pairs[1].v}점).`,
  ];

  const improvements = [
    `${pairs[3].k}를 올리면 전체 점수가 더 잘 올라가요 (${pairs[3].v}점).`,
    `${pairs[2].k}도 조금만 더 다듬으면 좋아요 (${pairs[2].v}점).`,
  ];

  const summary = `최근 세션 기준으로 ${pairs[0].k} 강점이 뚜렷하고, ${pairs[3].k} 개선 여지가 있어요.`;

  return { summary, strengths, improvements };
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

    for (const s of sessions) {
      const reportMeta = s.report_insight ?? {};
      const needRecompute =
        s.score_c == null ||
        s.score_a == null ||
        s.score_f == null ||
        s.score_p == null ||
        s.score_overall == null ||
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

      const insight = buildBasicInsight({
        score_c,
        score_a,
        score_f,
        score_p,
      });

      const patch = {
        score_c,
        score_a,
        score_f,
        score_p,
        score_overall,
        report_insight: {
          ...insight,
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

    const cumulativeSummary =
      series.length === 0
        ? "아직 기록이 없어요. 첫 세션을 완료하면 성장 그래프가 쌓여요."
        : `지금까지 ${series.length}회 누적 기준, 종합 점수 평균은 ${avgOverall}점이에요.`;

    const latestSession = updatedSessions.length
      ? updatedSessions[updatedSessions.length - 1]
      : null;

    const insight = latest
      ? {
          summary: `${cumulativeSummary} 최근 세션은 ${latest.overall}점이에요.`,
          detail: {
            strengths: (latestSession?.report_insight?.strengths ?? []).slice(0, 3),
            improvements: (latestSession?.report_insight?.improvements ?? []).slice(0, 3),
          },
        }
      : { summary: cumulativeSummary, detail: { strengths: [], improvements: [] } };

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