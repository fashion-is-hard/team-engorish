// supabase/functions/report_insight/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TurnRow = {
  role: string; // 'user' | 'ai' etc
  text_raw: string | null;
  created_at: string;
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

// 아주 러프한 텍스트 기반 점수 (추후 OpenAI로 더 정교하게 바꿔도 됨)
function computeScoresFromTurns(userTurns: string[], aiTurns: string[]) {
  const userTextAll = userTurns.join(" ").trim();
  const userWords = wordCount(userTextAll);

  // C: 문장 길이/접속사/쉼표/세미콜론 등 proxy
  const avgLen = userTurns.length ? avg(userTurns.map((t) => wordCount(t))) : 0;
  const connectors = ["because", "although", "however", "therefore", "which", "that", "when", "while", "if", "so"];
  const connectorHits = connectors.reduce((acc, w) => acc + (userTextAll.toLowerCase().includes(w) ? 1 : 0), 0);
  const punctHits = (userTextAll.match(/[,:;]/g) ?? []).length;

  let scoreC = 40 + avgLen * 4 + connectorHits * 6 + punctHits * 1.5;
  scoreC = clamp(scoreC, 0, 100);

  // A: 정확도 proxy (아주 단순: "I no", "he go" 같은 흔한 패턴/중복된 오류 징후)
  // -> 실제론 correction 결과나 LLM 평가가 더 정확
  const lower = userTextAll.toLowerCase();
  let penaltyA = 0;
  const badPatterns = [
    /\bi\s+no\b/g,
    /\bhe\s+go\b/g,
    /\bshe\s+go\b/g,
    /\bthey\s+goes\b/g,
    /\bdoesn't\s+have\b/g, // (예시) 필요시 패턴 조정
  ];
  badPatterns.forEach((re) => {
    penaltyA += (lower.match(re) ?? []).length * 10;
  });
  // 너무 짧거나 단어 수 적으면 정확도 측정 어려우니 기본점 낮춤
  let scoreA = 75 - penaltyA - (userWords < 20 ? 10 : 0);
  scoreA = clamp(scoreA, 0, 100);

  // F: 유창성 proxy (반복/끊김/um/uh)
  const fillers = (lower.match(/\b(um|uh|er|ah)\b/g) ?? []).length;
  const repeats = (lower.match(/\b(\w+)\s+\1\b/g) ?? []).length; // 같은 단어 연속
  let scoreF = 78 - fillers * 8 - repeats * 6;
  // 너무 짧은 발화는 유창성 점수 낮춰서 과대평가 방지
  if (userTurns.length <= 1 && userWords < 10) scoreF -= 15;
  scoreF = clamp(scoreF, 0, 100);

  // P: 발음 명확성 proxy (STT 깨짐/의미없는 토큰/AI 되묻는 빈도)
  const weirdTokenHits = (userTextAll.match(/[^\x00-\x7F]/g) ?? []).length; // 비ASCII 많으면 STT 깨짐 가능성
  const aiRepeatAsks = aiTurns
    .map((t) => t.toLowerCase())
    .filter((t) => t.includes("could you say that again") || t.includes("pardon") || t.includes("repeat"))
    .length;
  let scoreP = 80 - weirdTokenHits * 2 - aiRepeatAsks * 10;
  scoreP = clamp(scoreP, 0, 100);

  // overall: 가중 평균(원하면 바꿔도 됨)
  const scoreOverall = Math.round(scoreC * 0.25 + scoreA * 0.35 + scoreF * 0.25 + scoreP * 0.15);

  return {
    score_c: Math.round(scoreC),
    score_a: Math.round(scoreA),
    score_f: Math.round(scoreF),
    score_p: Math.round(scoreP),
    score_overall: clamp(scoreOverall, 0, 100),
  };
}

function buildBasicInsight(latest: any) {
  const { score_c, score_a, score_f, score_p } = latest;

  // 강점/개선점 단순 생성
  const pairs = [
    { k: "C(Complexity)", v: score_c },
    { k: "A(Accuracy)", v: score_a },
    { k: "F(Fluency)", v: score_f },
    { k: "P(Pronunciation)", v: score_p },
  ].sort((a, b) => b.v - a.v);

  const strengths = [`${pairs[0].k}가 상대적으로 좋아요 (${pairs[0].v}점).`, `${pairs[1].k}도 안정적이에요 (${pairs[1].v}점).`];
  const improvements = [
    `${pairs[3].k}를 올리면 전체 점수가 더 잘 올라가요 (${pairs[3].v}점).`,
    `${pairs[2].k}도 조금만 더 다듬으면 좋아요 (${pairs[2].v}점).`,
  ];

  const summary = `최근 세션 기준으로 ${pairs[0].k} 강점이 뚜렷하고, ${pairs[3].k} 개선 여지가 있어요.`;

  return { summary, strengths, improvements };
}

Deno.serve(async (req) => {
  // CORS preflight
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

    // user auth client (JWT 검증용)
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

    // service role client (DB read/write)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) ended 세션들 불러오기 (A/B 모두)
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

    // 2) 점수 없는 세션은 turn 기반으로 계산해서 저장
    const updatedSessions: SessionRow[] = [];
    for (const s of sessions) {
      const needScore =
        s.score_c == null || s.score_a == null || s.score_f == null || s.score_p == null || s.score_overall == null;

      if (!needScore) {
        updatedSessions.push(s);
        continue;
      }

      const { data: turns, error: tErr } = await supabase
        .from("roleplay_turns")
        .select("role,text_raw,created_at")
        .eq("session_id", s.session_id)
        .order("created_at", { ascending: true });

      if (tErr) {
        updatedSessions.push(s);
        continue;
      }

      const t = (turns ?? []) as TurnRow[];
      const userTurns = t.filter((x) => (x.role || "").toLowerCase() === "user").map((x) => x.text_raw ?? "").filter(Boolean);
      const aiTurns = t.filter((x) => ["ai", "assistant"].includes((x.role || "").toLowerCase())).map((x) => x.text_raw ?? "").filter(Boolean);

      const scores = computeScoresFromTurns(userTurns, aiTurns);

      // 기본 인사이트(추후 LLM으로 바꿔도 됨)
      const insight = buildBasicInsight(scores);

      const patch = {
        score_c: scores.score_c,
        score_a: scores.score_a,
        score_f: scores.score_f,
        score_p: scores.score_p,
        score_overall: scores.score_overall,
        report_insight: insight,
      };

      await supabase.from("roleplay_sessions").update(patch).eq("session_id", s.session_id);

      updatedSessions.push({ ...s, ...patch } as any);
    }

    // 3) 누적 요약 만들기 (B 리포트용)
    const series = updatedSessions
      .filter((s) => s.score_overall != null)
      .map((s) => ({
        session_id: s.session_id,
        ended_at: s.ended_at,
        variant: (String(s.variant).toLowerCase() === "b" ? "b" : "a") as "a" | "b",
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

    // 종합 인사이트: 최신 세션 인사이트 + 누적 평균 기반 한줄
    const cumulativeSummary =
      series.length === 0
        ? "아직 기록이 없어요. 첫 세션을 완료하면 성장 그래프가 쌓여요."
        : `지금까지 ${series.length}회 누적 기준, 종합 점수 평균은 ${avgOverall}점이에요.`;

    const insight = latest
      ? {
          summary: `${cumulativeSummary} 최근 세션은 ${latest.overall}점이에요.`,
          detail: {
            strengths: (updatedSessions[updatedSessions.length - 1]?.report_insight?.strengths ?? []).slice(0, 3),
            improvements: (updatedSessions[updatedSessions.length - 1]?.report_insight?.improvements ?? []).slice(0, 3),
          },
        }
      : { summary: cumulativeSummary, detail: { strengths: [], improvements: [] } };

    return new Response(
      JSON.stringify({
        ok: true,
        totals: {
          sessions: series.length,
          avg: { c: avgC, a: avgA, f: avgF, p: avgP, overall: avgOverall },
          latest: latest ? { c: latest.c, a: latest.a, f: latest.f, p: latest.p, overall: latest.overall } : null,
        },
        series, // 세션별 추이 그래프용
        insight, // 상단 “종합 인사이트” 박스용
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