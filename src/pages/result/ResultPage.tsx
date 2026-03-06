import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./ResultPage.module.css";

type VariantPath = "a" | "b";

type InsightBox = {
  title: string;
  bullets: string[];
};

type ResultInsightResponse = {
  variant: "a" | "b";
  success: boolean;
  achieved_goal_ids: string[];
  goals: { goal_id: string; goal_title: string }[];
  insight: {
    title: string;
    box1: InsightBox;
    box2: InsightBox;
    next_hint: string;
  };
  scenario: { title: string };
};

type SessionLite = {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  variant: string | null;
};

type TurnLite = {
  role: string;
  text_raw: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function mmss(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function countWords(text: string) {
  return (text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export default function ResultPage() {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  const sessionId = (params as any).sessionId as string | undefined;
  const pathVariant: VariantPath = location.pathname.startsWith("/b") ? "b" : "a";
  const isAPath = pathVariant === "a";

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  // B용
  const [result, setResult] = useState<ResultInsightResponse | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [continuing, setContinuing] = useState(false);

  // A용
  const [aElapsedSec, setAElapsedSec] = useState(0);
  const [aSpokenWords, setASpokenWords] = useState(0);

  const variant: VariantPath = (result?.variant ?? pathVariant) === "b" ? "b" : "a";
  const isB = variant === "b";

  const achievedSet = useMemo(() => {
    const s = new Set<string>();
    (result?.achieved_goal_ids ?? []).forEach((id) => s.add(id));
    return s;
  }, [result?.achieved_goal_ids]);

  useEffect(() => {
    if (!sessionId) return;

    (async () => {
      setLoading(true);
      setFatal(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        navigate("/auth/login");
        return;
      }

      try {
        // ✅ A는 목업 UI대로만: 로컬에서 세션/턴 계산
        if (isAPath) {
          const { data: sData, error: sErr } = await supabase
            .from("roleplay_sessions")
            .select("session_id,started_at,ended_at,variant")
            .eq("session_id", sessionId)
            .single();

          if (sErr) throw new Error(sErr.message);

          const session = sData as SessionLite;
          const started = new Date(session.started_at).getTime();
          const ended = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
          const elapsedSec = Math.max(0, Math.round((ended - started) / 1000));

          const { data: tData, error: tErr } = await supabase
            .from("roleplay_turns")
            .select("role,text_raw")
            .eq("session_id", sessionId)
            .eq("role", "user");

          if (tErr) throw new Error(tErr.message);

          const turns = (tData ?? []) as TurnLite[];
          const spokenWords = turns.reduce((acc, t) => acc + countWords(t.text_raw ?? ""), 0);

          setAElapsedSec(elapsedSec);
          setASpokenWords(spokenWords);
          setLoading(false);
          return;
        }

        // ✅ B는 기존 로직 그대로
        const { data: sess } = await supabase.auth.getSession();
        const accessToken = sess.session?.access_token;

        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/result_insight`;

        const res = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            apikey: anonKey,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ sessionId }),
        });

        const text = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }

        if (!res.ok) {
          throw new Error(`result_insight ${res.status}: ${JSON.stringify(json)}`);
        }

        setResult(json as ResultInsightResponse);
        setLoading(false);
      } catch (e: any) {
        setFatal(e?.message ?? "unknown error");
        setLoading(false);
      }
    })();
  }, [sessionId, navigate, isAPath]);

  async function handleRetry() {
    if (!sessionId || retrying) return;

    try {
      setRetrying(true);

      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;

      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retry_session`;

      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          apikey: anonKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ sessionId }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        throw new Error(`retry_session ${res.status}: ${JSON.stringify(json)}`);
      }

      const nextVariant: VariantPath = json?.variant === "b" ? "b" : "a";
      const newSessionId = json?.new_session_id;

      if (!newSessionId) {
        throw new Error("new_session_id가 없습니다.");
      }

      navigate(`/${nextVariant}/play/${newSessionId}`);
    } catch (e: any) {
      alert(`다시 하기 실패: ${e?.message ?? "unknown error"}`);
      setRetrying(false);
    }
  }

  async function handleContinue() {
  if (!sessionId || continuing) return;

  try {
    setContinuing(true);

    // 1) 현재 세션 조회
    const { data: sData, error: sErr } = await supabase
      .from("roleplay_sessions")
      .select("session_id, package_id, scenario_id, variant, end_reason, status")
      .eq("session_id", sessionId)
      .single();

    if (sErr) throw new Error(sErr.message);
    if (!sData?.package_id || !sData?.scenario_id) {
      throw new Error("현재 세션의 package_id 또는 scenario_id가 없습니다.");
    }

    const nextVariant: VariantPath =
      String(sData.variant ?? "").toLowerCase() === "b" ? "b" : "a";

    // ✅ A는 종료만 됐으면 성공으로 처리
    // ✅ B만 goals_done 이어야 성공
    const isSuccess =
      nextVariant === "a"
        ? sData.status === "ended"
        : sData.status === "ended" && sData.end_reason === "goals_done";

    if (!isSuccess) {
      throw new Error("이어하기 가능한 상태가 아닙니다.");
    }

    // 2) 같은 패키지의 시나리오 목록 조회
    const { data: scData, error: scErr } = await supabase
      .from("scenarios")
      .select("scenario_id, package_id, sort_order, created_at, is_active")
      .eq("package_id", sData.package_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (scErr) throw new Error(scErr.message);

    const scenarios = scData ?? [];
    const currentIndex = scenarios.findIndex((s) => s.scenario_id === sData.scenario_id);

    if (currentIndex < 0) {
      throw new Error("현재 시나리오를 패키지 목록에서 찾지 못했습니다.");
    }

    const nextScenario = scenarios[currentIndex + 1];

    // 3) 다음 시나리오 없으면 홈으로
    if (!nextScenario) {
      navigate(`/${nextVariant}/home`);
      return;
    }

    // 4) 다음 시나리오 디테일 페이지로 이동
    navigate(`/${nextVariant}/scenarios/${nextScenario.scenario_id}`);
  } catch (e: any) {
    alert(`이어하기 실패: ${e?.message ?? "unknown error"}`);
    setContinuing(false);
  }
}

  // =========================
  // ✅ A 버전: 목업 UI
  // =========================
  if (isAPath) {
    return (
      <div className={styles.container}>
        <button className={styles.closeBtn} onClick={() => navigate(`/${variant}/home`)} aria-label="close">
          ✕
        </button>

        <div className={styles.aIconWrap}>
          <div className={styles.successIcon}>✓</div>
        </div>

        <div className={styles.aTitle}>대화 완료</div>
        <div className={styles.aSubtitle}>다른 시나리오도 도전해보세요</div>

        <div className={styles.aStatsRow}>
          <div className={styles.aStatCard}>
            <div className={styles.aStatLabel}>대화소요시간</div>
            <div className={styles.aStatValueBox}>
              <div className={styles.aStatValue}>{mmss(aElapsedSec)}</div>
            </div>
          </div>

          <div className={styles.aStatCard}>
            <div className={styles.aStatLabel}>말한 단어 수</div>
            <div className={styles.aStatValueBox}>
              <div className={styles.aStatValue}>{aSpokenWords}</div>
            </div>
          </div>
        </div>

        <div className={styles.bottomRow}>
          <button className={styles.btnGhost} onClick={() => navigate(`/${variant}/report`)}>
            리포트 보러가기
          </button>

          <button className={styles.btnPrimary} onClick={handleContinue} disabled={continuing}>
            {continuing ? "준비 중..." : "이어하기"}
          </button>
        </div>
      </div>
    );
  }

  // =========================
  // ✅ B 버전: 기존 UI 그대로
  // =========================
  if (!result) {
    return <div className={styles.loading}>결과를 불러오는 중…</div>;
  }

  const success = !!result.success;

  return (
    <div className={styles.container}>
      <button className={styles.closeBtn} onClick={() => navigate(`/${variant}/home`)} aria-label="close">
        ✕
      </button>

      <div className={styles.iconWrap}>
        {success ? (
          <div className={styles.successIcon}>✓</div>
        ) : (
          <div className={styles.failIcon}>!</div>
        )}
      </div>

      <div className={styles.goalPanel}>
        <div className={styles.goalHeader}>
          {isB ? (success ? "목표를 달성했어요!" : "목표를 달성하지 못했어요") : "세션을 완료했어요!"}
        </div>

        {isB && (
          <div className={styles.goalBox}>
            {(result.goals ?? []).map((g) => {
              const checked = achievedSet.has(g.goal_id);
              return (
                <div key={g.goal_id} className={styles.goalItem}>
                  <img src={checked ? "/check_act.svg" : "/check_dis.svg"} className={styles.goalIcon} alt="" />
                  <span className={styles.goalText}>{g.goal_title}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.insightCardDark}>
        <div className={styles.insightTitle}>{result.insight.box1.title}</div>
        <ul className={styles.bullets}>
          {(result.insight.box1.bullets ?? []).slice(0, 3).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div className={styles.insightCardLight}>
        <div className={styles.insightTitle}>{result.insight.box2.title}</div>
        <ul className={styles.bullets}>
          {(result.insight.box2.bullets ?? []).slice(0, 3).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div className={styles.nextHint}>{result.insight.next_hint}</div>

      <div className={styles.bottomRow}>
        <button className={styles.btnGhost} onClick={() => navigate(`/${variant}/report`)}>
          리포트 보러가기
        </button>

        <button
          className={styles.btnPrimary}
          onClick={success ? handleContinue : handleRetry}
          disabled={success ? continuing : retrying}
        >
          {success
            ? continuing
              ? "준비 중..."
              : "이어하기"
            : retrying
              ? "준비 중..."
              : "다시 하기"}
        </button>
      </div>
    </div>
  );
}