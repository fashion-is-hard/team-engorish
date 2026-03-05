import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./ReportPage.module.css";

type SessionRow = {
  session_id: string;
  started_at: string;
};

type TurnRow = {
  turn_id: string;
  role: string; // 'user' | 'ai'
  text_raw: string | null;
  created_at: string;
};

function tokenize(text: string) {
  // 영어 기준: 소문자 + 기호 제거 + 공백 split
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

type SeriesPoint = { xSec: number; y: number };

function AreaChart({
  data,
  height = 180,
  stroke = "#ff7b7b",
  fillId = "grad",
}: {
  data: SeriesPoint[];
  height?: number;
  stroke?: string;
  fillId?: string;
}) {
  const width = 320; // viewBox 기준 (반응형은 CSS로)
  const pad = 12;

  const xs = data.map((d) => d.xSec);
  const ys = data.map((d) => d.y);

  const maxX = Math.max(...xs, 1);
  const maxY = Math.max(...ys, 1);

  const xTo = (x: number) => pad + (x / maxX) * (width - pad * 2);
  const yTo = (y: number) => height - pad - (y / maxY) * (height - pad * 2);

  // line path
  const line = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xTo(d.xSec)} ${yTo(d.y)}`)
    .join(" ");

  // area path
  const area =
    line +
    ` L ${xTo(data[data.length - 1].xSec)} ${height - pad}` +
    ` L ${xTo(data[0].xSec)} ${height - pad} Z`;

  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* area */}
      <path d={area} fill={`url(#${fillId})`} stroke="none" />

      {/* line */}
      <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function ReportPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams();

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
        navigate("/login");
        return;
      }

      const { data: sData, error: sErr } = await supabase
        .from("roleplay_sessions")
        .select("session_id,started_at")
        .eq("session_id", sessionId)
        .single();

      if (sErr) {
        setFatal(sErr.message);
        setLoading(false);
        return;
      }
      setSession(sData as SessionRow);

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

  // ===== 데이터 가공: x축=플레이타임(초), y축=단어 수 =====
  const { newWordsSeries, totalWordsSeries, totalDurationSec } = useMemo(() => {
    const startMs = session?.started_at ? new Date(session.started_at).getTime() : null;

    if (!startMs) {
      return {
        newWordsSeries: [{ xSec: 0, y: 0 }],
        totalWordsSeries: [{ xSec: 0, y: 0 }],
        totalDurationSec: 0,
      };
    }

    // 사용자 발화만 집계
    const userTurns = turns.filter((t) => t.role === "user" && (t.text_raw ?? "").trim());

    // 1분 버킷(원하면 30초로 바꿔도 됨)
    const BUCKET_SEC = 60;

    const seen = new Set<string>();
    const newPerBucket = new Map<number, number>();  // bucketIndex -> new words
    const totalPerBucket = new Map<number, number>(); // bucketIndex -> total words (bucket sum)

    let lastSec = 0;

    for (const t of userTurns) {
      const ms = new Date(t.created_at).getTime();
      const sec = Math.max(0, Math.floor((ms - startMs) / 1000));
      lastSec = Math.max(lastSec, sec);

      const bucket = Math.floor(sec / BUCKET_SEC);

      const words = tokenize(t.text_raw ?? "");
      let newCount = 0;

      for (const w of words) {
        if (!seen.has(w)) {
          seen.add(w);
          newCount += 1;
        }
      }

      newPerBucket.set(bucket, (newPerBucket.get(bucket) ?? 0) + newCount);
      totalPerBucket.set(bucket, (totalPerBucket.get(bucket) ?? 0) + words.length);
    }

    const maxBucket = Math.max(0, Math.floor(lastSec / BUCKET_SEC));

    const newSeries: SeriesPoint[] = [];
    const totalSeries: SeriesPoint[] = [];

    let cumulative = 0;

    for (let b = 0; b <= maxBucket; b++) {
      const xSec = b * BUCKET_SEC;
      const newW = newPerBucket.get(b) ?? 0;
      const tot = totalPerBucket.get(b) ?? 0;

      cumulative += tot;

      newSeries.push({ xSec, y: newW });
      totalSeries.push({ xSec, y: cumulative });
    }

    // 데이터가 없을 때도 차트가 렌더되게
    if (newSeries.length === 0) newSeries.push({ xSec: 0, y: 0 });
    if (totalSeries.length === 0) totalSeries.push({ xSec: 0, y: 0 });

    return { newWordsSeries: newSeries, totalWordsSeries: totalSeries, totalDurationSec: lastSec };
  }, [session?.started_at, turns]);

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;
  if (fatal) return <div className={styles.loading}>에러: {fatal}</div>;

  return (
    <div className={styles.container}>
      {/* header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="back">
          <img src="/back.png" alt="뒤로가기" />
        </button>
        <h1>성취탭</h1>
      </div>

      {/* section 1 */}
      <div className={styles.sectionTitle}>새로 말한 단어 수</div>
      <div className={styles.card}>
        <AreaChart data={newWordsSeries} stroke="#ff7b7b" fillId="gradRed" />
        <div className={styles.axisHint}>
          x축: 플레이 타임(0 → {mmss(totalDurationSec)})
        </div>
      </div>

      {/* section 2 */}
      <div className={styles.sectionTitle}>지금까지 말한 단어 수</div>
      <div className={styles.card}>
        <AreaChart data={totalWordsSeries} stroke="#5ecf90" fillId="gradGreen" />
        <div className={styles.axisHint}>
          x축: 플레이 타임(0 → {mmss(totalDurationSec)})
        </div>
      </div>
    </div>
  );
}