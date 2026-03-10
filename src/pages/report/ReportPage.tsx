import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./ReportPage.module.css";

type SessionRowLite = {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  variant: string | null;
};

type TurnRowLite = {
  session_id: string;
  role: string;
  text_raw: string | null;
  created_at: string;
};

function getVariantFromPath(pathname: string): "a" | "b" {
  return pathname.startsWith("/b") ? "b" : "a";
}

function normalizeVariant(v: unknown): "a" | "b" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "b" ? "b" : "a";
}

function tokenizeEn(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z'\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function AreaChart({
  values,
  stroke,
  fillId,
  height = 220,
}: {
  values: number[];
  stroke: string;
  fillId: string;
  height?: number;
}) {
  const width = 420;
  const padX = 18;
  const padY = 16;

  const maxV = Math.max(1, ...values);
  const n = Math.max(1, values.length);

  const pts = values.map((v, i) => {
    const x = padX + (i * (width - padX * 2)) / Math.max(1, n - 1);
    const y = padY + (1 - v / maxV) * (height - padY * 2);
    return { x, y };
  });

  const dLine =
    pts.length === 1
      ? `M ${pts[0].x} ${pts[0].y}`
      : `M ${pts[0].x} ${pts[0].y} ` +
        pts
          .slice(1)
          .map((p) => `L ${p.x} ${p.y}`)
          .join(" ");

  const dArea =
    pts.length === 0
      ? ""
      : `${dLine} L ${pts[pts.length - 1].x} ${height - padY} L ${pts[0].x} ${height - padY} Z`;

  return (
    <svg className={styles.chartSvg} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {pts.length > 0 && <path d={dArea} fill={`url(#${fillId})`} stroke="none" />}
      {pts.length > 0 && (
        <path
          d={dLine}
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

type ReportResponseB = {
  ok: boolean;
  totals: {
    sessions: number;
    avg: { c: number; a: number; f: number; p: number; overall: number };
    latest: { c: number; a: number; f: number; p: number; overall: number } | null;
  };
  series: Array<{
    session_id: string;
    ended_at: string | null;
    variant: "a" | "b";
    c: number;
    a: number;
    f: number;
    p: number;
    overall: number;
  }>;
  insight: {
    summary: string;
    detail: { strengths: string[]; improvements: string[] };
  };
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function Radar({ c, a, f, p }: { c: number; a: number; f: number; p: number }) {
  const size = 170;
  const cx = size / 2;
  const cy = size / 2;
  const r = 60;

  const toPt = (angleDeg: number, value: number) => {
    const v = clamp(value, 0, 100) / 100;
    const rad = (Math.PI / 180) * angleDeg;
    return { x: cx + Math.cos(rad) * r * v, y: cy + Math.sin(rad) * r * v };
  };

  const ptC = toPt(-90, c);
  const ptP = toPt(0, p);
  const ptF = toPt(90, f);
  const ptA = toPt(180, a);

  const poly = `${ptC.x},${ptC.y} ${ptP.x},${ptP.y} ${ptF.x},${ptF.y} ${ptA.x},${ptA.y}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map((k, i) => (
        <polygon
          key={i}
          points={`${cx},${cy - r * k} ${cx + r * k},${cy} ${cx},${cy + r * k} ${cx - r * k},${cy}`}
          fill="none"
          stroke="rgba(78,85,94,0.12)"
          strokeWidth="1"
        />
      ))}

      <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="rgba(78,85,94,0.12)" />
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="rgba(78,85,94,0.12)" />

      <polygon
        points={poly}
        fill="rgba(153,169,190,0.42)"
        stroke="rgba(143,160,184,1)"
        strokeWidth="2"
      />

      <text x={cx} y={cy - r - 10} textAnchor="middle" fontSize="13" fill="#4E555E">
        C
      </text>
      <text x={cx - r - 12} y={cy + 4} textAnchor="middle" fontSize="13" fill="#4E555E">
        A
      </text>
      <text x={cx} y={cy + r + 18} textAnchor="middle" fontSize="13" fill="#4E555E">
        F
      </text>
      <text x={cx + r + 14} y={cy + 4} textAnchor="middle" fontSize="13" fill="#4E555E">
        P
      </text>
    </svg>
  );
}

function Bars({ c, a, f, p }: { c: number; a: number; f: number; p: number }) {
  const rows = [
    { k: "C", v: c },
    { k: "A", v: a },
    { k: "F", v: f },
    { k: "P", v: p },
  ];

  return (
    <div className={styles.bars}>
      {rows.map((r) => (
        <div key={r.k} className={styles.barRow}>
          <div className={styles.barLabel}>{r.k}</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${clamp(r.v, 0, 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniArea({ values }: { values: number[] }) {
  const w = 220;
  const h = 100;
  const pad = 10;

  if (!values.length) return <div className={styles.miniEmpty}>-</div>;

  const xs = values.map((_, i) =>
    values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - pad * 2) + pad
  );
  const ys = values.map((v) => {
    const t = clamp(v, 0, 100) / 100;
    return (1 - t) * (h - pad * 2) + pad;
  });

  const line = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={styles.miniSvg}>
      <polygon points={area} fill="rgba(153,169,190,0.32)" />
      <polyline points={line} fill="none" stroke="rgba(143,160,184,1)" strokeWidth="2.5" />
    </svg>
  );
}

export default function ReportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const variant = useMemo(() => getVariantFromPath(location.pathname), [location.pathname]);
  const isB = variant === "b";

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [newWordsCum, setNewWordsCum] = useState<number[]>([]);
  const [spokenWordsCum, setSpokenWordsCum] = useState<number[]>([]);

  const [bData, setBData] = useState<ReportResponseB | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setFatal(null);

        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) {
          navigate("/auth/login");
          return;
        }

        if (isB) {
          const { data: sess } = await supabase.auth.getSession();
          const accessToken = sess.session?.access_token;

          const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
          const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/report_insight`;

          const res = await fetch(fnUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              apikey: anonKey,
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({}),
          });

          const text = await res.text();
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }

          if (!res.ok) throw new Error(`report_insight ${res.status}: ${JSON.stringify(json)}`);

          if (cancelled) return;
          setBData(json as ReportResponseB);
          setLoading(false);
          return;
        }

        const { data: sData, error: sErr } = await supabase
          .from("roleplay_sessions")
          .select("session_id,started_at,ended_at,status,variant")
          .eq("user_id", user.id)
          .order("started_at", { ascending: true });

        if (sErr) throw new Error(sErr.message);
        const allSessions = (sData ?? []) as SessionRowLite[];
        const sessions = allSessions.filter((s) => normalizeVariant(s.variant) === "a");

        if (sessions.length === 0) {
          if (cancelled) return;
          setNewWordsCum([]);
          setSpokenWordsCum([]);
          setLoading(false);
          return;
        }

        const sessionIds = sessions.map((s) => s.session_id);

        const allTurns: TurnRowLite[] = [];
        const chunkSize = 50;

        for (let i = 0; i < sessionIds.length; i += chunkSize) {
          const chunk = sessionIds.slice(i, i + chunkSize);

          const { data: tData, error: tErr } = await supabase
            .from("roleplay_turns")
            .select("session_id,role,text_raw,created_at")
            .in("session_id", chunk)
            .eq("role", "user")
            .order("created_at", { ascending: true });

          if (tErr) throw new Error(tErr.message);
          allTurns.push(...((tData ?? []) as TurnRowLite[]));
        }

        const uniqueMap = new Map<string, Set<string>>();
        const totalMap = new Map<string, number>();
        for (const sid of sessionIds) {
          uniqueMap.set(sid, new Set());
          totalMap.set(sid, 0);
        }

        for (const t of allTurns) {
          const sid = t.session_id;
          const set = uniqueMap.get(sid);
          if (!set) continue;

          const tokens = tokenizeEn(t.text_raw ?? "");
          totalMap.set(sid, (totalMap.get(sid) ?? 0) + tokens.length);
          for (const w of tokens) set.add(w);
        }

        const newCum: number[] = [];
        const spokenCum: number[] = [];
        let accNew = 0;
        let accSpoken = 0;

        for (const s of sessions) {
          const u = uniqueMap.get(s.session_id) ?? new Set<string>();
          const tot = totalMap.get(s.session_id) ?? 0;

          accNew += u.size;
          accSpoken += tot;

          newCum.push(accNew);
          spokenCum.push(accSpoken);
        }

        if (cancelled) return;
        setNewWordsCum(newCum);
        setSpokenWordsCum(spokenCum);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setFatal(e?.message ?? "알 수 없는 오류");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, isB]);

  function goHome() {
    navigate(`/${variant}/home`);
  }

  function goReport() {
    navigate(`/${variant}/report`);
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("logout error:", error);
    } finally {
      navigate("/auth/login");
    }
  }

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;
  if (fatal) return <div className={styles.loading}>에러: {fatal}</div>;

  if (isB) {
    const totals = bData?.totals;
    const avg = totals?.avg ?? { c: 0, a: 0, f: 0, p: 0, overall: 0 };

    const series = bData?.series ?? [];
    const seriesC = series.map((x) => x.c);
    const seriesA = series.map((x) => x.a);
    const seriesF = series.map((x) => x.f);
    const seriesP = series.map((x) => x.p);

    return (
      <div className={styles.container}>
        <header className={styles.topHeader}>
          <button type="button" className={styles.logoButton} onClick={goHome}>
            Engorish
          </button>

          <div className={styles.headerActions}>
            <button type="button" className={styles.iconButton} onClick={goHome} aria-label="home">
              <img src="/home.svg" alt="" />
            </button>
            <button type="button" className={styles.iconButton} onClick={goReport} aria-label="report">
              <img src="/report.svg" alt="" />
            </button>
            <button type="button" className={styles.iconButton} onClick={handleLogout} aria-label="logout">
              <img src="/out.svg" alt="" />
            </button>
          </div>
        </header>

        <main className={styles.body}>
          <section className={styles.section}>
            <div className={styles.sectionTitle}>종합 인사이트</div>
            <div className={styles.insightCard}>
              <div className={styles.insightBadgeGreen}>한문장 요약</div>
              <div className={styles.insightText}>{bData?.insight?.summary ?? "요약을 준비 중이에요."}</div>

              {!!(bData?.insight?.detail?.strengths?.length) && (
                <ul className={styles.insightList}>
                  {bData!.insight.detail.strengths.slice(0, 2).map((t, i) => (
                    <li key={`s-${i}`}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>종합 점수</div>

            <div className={styles.scoreCard}>
              <div className={styles.scoreLeft}>
                <Bars c={avg.c} a={avg.a} f={avg.f} p={avg.p} />
              </div>
              <div className={styles.scoreRight}>
                <Radar c={avg.c} a={avg.a} f={avg.f} p={avg.p} />
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>세부 변화</div>

            <div className={styles.miniGrid}>
              <div className={styles.miniCard}>
                <div className={styles.miniTitle}>Complexity</div>
                <MiniArea values={seriesC} />
              </div>

              <div className={styles.miniCard}>
                <div className={styles.miniTitle}>Accuracy</div>
                <MiniArea values={seriesA} />
              </div>

              <div className={styles.miniCard}>
                <div className={styles.miniTitle}>Fluency</div>
                <MiniArea values={seriesF} />
              </div>

              <div className={styles.miniCard}>
                <div className={styles.miniTitle}>Pronunciation</div>
                <MiniArea values={seriesP} />
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>더 나아지기 위해서</div>
            <div className={styles.insightCard}>
              <div className={styles.insightBadgeRed}>개선점 요약</div>
              <ul className={styles.insightList}>
                {(bData?.insight?.detail?.improvements ?? []).slice(0, 3).map((t, i) => (
                  <li key={`i-${i}`}>{t}</li>
                ))}
              </ul>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const totalPlays = newWordsCum.length;
  const latestNew = totalPlays ? newWordsCum[totalPlays - 1] : 0;
  const latestSpoken = totalPlays ? spokenWordsCum[totalPlays - 1] : 0;
  const BLUE_GRAY = "#8FA0B8";

  return (
    <div className={styles.container}>
      <header className={styles.topHeader}>
        <button type="button" className={styles.logoButton} onClick={goHome}>
          Engorish
        </button>

        <div className={styles.headerActions}>
          <button type="button" className={styles.iconButton} onClick={goHome} aria-label="home">
            <img src="/home.svg" alt="" />
          </button>
          <button type="button" className={styles.iconButton} onClick={goReport} aria-label="report">
            <img src="/report.svg" alt="" />
          </button>
          <button type="button" className={styles.iconButton} onClick={handleLogout} aria-label="logout">
            <img src="/out.svg" alt="" />
          </button>
        </div>
      </header>

      <main className={styles.body}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>새로운 단어</div>
          <div className={styles.sectionValue}>{latestNew}</div>

          <div className={styles.card}>
            {totalPlays === 0 ? (
              <div className={styles.empty}>아직 플레이 기록이 없어요.</div>
            ) : (
              <AreaChart values={newWordsCum} stroke={BLUE_GRAY} fillId="grad_new" />
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>말한 단어</div>
          <div className={styles.sectionValue}>{latestSpoken}</div>

          <div className={styles.card}>
            {totalPlays === 0 ? (
              <div className={styles.empty}>아직 플레이 기록이 없어요.</div>
            ) : (
              <AreaChart values={spokenWordsCum} stroke={BLUE_GRAY} fillId="grad_spoken" />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}