// src/pages/result/ResultPage.tsx
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

export default function ResultPage() {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  const sessionId = (params as any).sessionId as string | undefined;
  const pathVariant: VariantPath = location.pathname.startsWith("/b") ? "b" : "a";

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [result, setResult] = useState<ResultInsightResponse | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [continuing, setContinuing] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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

      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;

      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/next_scenario`;

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
        throw new Error(`next_scenario ${res.status}: ${JSON.stringify(json)}`);
      }

      const nextVariant: VariantPath = json?.variant === "b" ? "b" : "a";

      if (json?.done || !json?.next_scenario_id) {
        navigate(`/${nextVariant}/home`);
        return;
      }

      navigate(`/${nextVariant}/scenarios/${json.next_scenario_id}`);
    } catch (e: any) {
      alert(`이어하기 실패: ${e?.message ?? "unknown error"}`);
      setContinuing(false);
    }
  }

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;

  if (fatal || !result) {
    return (
      <div className={styles.loading}>
        <div style={{ marginBottom: 10, color: "#b00020" }}>
          에러: {fatal ?? "결과를 불러올 수 없습니다."}
        </div>
        <button className={styles.smallBtn} onClick={() => navigate(-1)}>
          뒤로가기
        </button>
      </div>
    );
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