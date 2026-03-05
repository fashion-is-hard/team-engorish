import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./ResultPage.module.css";

type SessionRow = {
  session_id: string;
  scenario_id: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  turn_limit: number | null;
  turn_count_user: number;
  turn_count_ai: number;
};

type TurnRow = {
  turn_id: string;
  role: string; // 'user' | 'ai'
  text_raw: string | null;
  created_at: string;
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
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** 현재 경로(/a/... or /b/...)에서 variant 추출 */
function getVariantFromPath(pathname: string): "a" | "b" {
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg === "b" ? "b" : "a";
}

export default function ResultPage() {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation() as any;

  const variant = useMemo(() => getVariantFromPath(location?.pathname ?? "/a"), [location?.pathname]);

  // ✅ 라우터: /a/result/:sessionId , /b/result/:sessionId
  // (혹시 state로 넘어오는 경우도 대비)
  const sessionId: string | undefined = (params as any).sessionId || location?.state?.sessionId;

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [session, setSession] = useState<SessionRow | null>(null);
  const [turns, setTurns] = useState<TurnRow[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setFatal("sessionId가 없습니다.");
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setFatal(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        navigate("/auth/login");
        return;
      }

      const { data: sData, error: sErr } = await supabase
        .from("roleplay_sessions")
        .select("session_id,scenario_id,started_at,ended_at,end_reason,turn_limit,turn_count_user,turn_count_ai")
        .eq("session_id", sessionId)
        .single();

      if (sErr) {
        setFatal(sErr.message);
        setLoading(false);
        return;
      }

      const sess = sData as SessionRow;
      setSession(sess);

      const { data: tData, error: tErr } = await supabase
        .from("roleplay_turns")
        .select("turn_id,role,text_raw,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (tErr) {
        setFatal(tErr.message);
        setLoading(false);
        return;
      }

      setTurns((tData ?? []) as TurnRow[]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const durationSec = useMemo(() => {
    if (!session?.started_at) return 0;
    const start = new Date(session.started_at).getTime();
    const end = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  }, [session?.started_at, session?.ended_at]);

  const userWordCount = useMemo(() => {
    const userTexts = turns
      .filter((t) => t.role === "user")
      .map((t) => (t.text_raw ?? "").trim())
      .filter(Boolean);

    let sum = 0;
    for (const tx of userTexts) sum += countWords(tx);
    return sum;
  }, [turns]);

  const onClose = () => {
    navigate(`/${variant}/home`);
  };

  const goReport = () => {
    // ✅ 일단 이동만
    navigate(`/${variant}/report`, { state: { sessionId } });
  };

  const goNext = async () => {
    if (!session?.scenario_id) {
      navigate(`/${variant}/home`);
      return;
    }

    // 1) 현재 시나리오의 package_id / sort_order
    const { data: cur, error: curErr } = await supabase
      .from("scenarios")
      .select("scenario_id,package_id,sort_order,is_active")
      .eq("scenario_id", session.scenario_id)
      .single();

    if (curErr || !cur) {
      console.error(curErr);
      navigate(`/${variant}/home`);
      return;
    }

    const curSort = cur.sort_order ?? 0;

    // 2) 같은 패키지에서 다음 시나리오
    const { data: nextList, error: nextErr } = await supabase
      .from("scenarios")
      .select("scenario_id,sort_order,is_active")
      .eq("package_id", cur.package_id)
      .eq("is_active", true)
      .gt("sort_order", curSort)
      .order("sort_order", { ascending: true })
      .limit(1);

    if (nextErr) {
      console.error(nextErr);
      navigate(`/${variant}/home`);
      return;
    }

    const next = nextList?.[0];

    // 3) 있으면 다음 시나리오 디테일, 없으면 패키지로
    if (next?.scenario_id) {
      navigate(`/${variant}/scenarios/${next.scenario_id}`);
    } else {
      navigate(`/${variant}/packages/${cur.package_id}`);
    }
  };

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;
  if (fatal) return <div className={styles.loading}>에러: {fatal}</div>;

  return (
    <div className={styles.container}>
      {/* top bar */}
      <div className={styles.topBar}>
        <div />
        <button className={styles.closeBtn} onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>

      {/* main */}
      <div className={styles.center}>
        <div className={styles.checkCircle}>✓</div>
        <div className={styles.title}>대화 완료</div>
        <div className={styles.subtitle}>다른 시나리오도 도전해보세요</div>

        <div className={styles.cards}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>대화소요시간</div>
            <div className={styles.statValue}>{mmss(durationSec)}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>말한 단어 수</div>
            <div className={styles.statValue}>{userWordCount}</div>
          </div>
        </div>
      </div>

      {/* bottom actions */}
      <div className={styles.bottom}>
        <button className={styles.btnGhost} onClick={goReport}>
          리포트 보러가기
        </button>
        <button className={styles.btnPrimary} onClick={goNext}>
          이어하기
        </button>
      </div>
    </div>
  );
}