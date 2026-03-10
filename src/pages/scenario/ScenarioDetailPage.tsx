import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import type { PackageRow, ScenarioExampleLineRow, ScenarioRow } from "@/types/db";
import styles from "./ScenarioDetailPage.module.css";

type NoticeSection = { title: string; bullets: string[] };

const NOTICE_A: NoticeSection[] = [
  {
    title: "마이크 사용권한",
    bullets: [
      "AI와 대화를 나누기 위해서는 마이크 사용 권한이 필요해요.",
      "말이 끝나면 반드시 마이크 버튼을 다시 눌러주세요.",
      "말을 끝내고 너무 빨리 누르면 인식이 안 될 수도 있어요.",
      "1초 정도 기다리신 후 눌러주시면 감사하겠습니다.",
    ],
  },
  {
    title: "대화종료",
    bullets: [
      "대화 가능 턴수는 최대 20턴이에요. 20턴을 채우면 자동으로 대화가 종료돼요.",
      "그 전에 대화를 끝내고 싶으시면 오른쪽의 닫기 버튼을 눌러주세요.",
    ],
  },
];

const NOTICE_B: NoticeSection[] = [
  {
    title: "마이크 사용권한",
    bullets: [
      "AI와 대화를 나누기 위해서는 마이크 사용 권한이 필요해요.",
      "말이 끝나면 반드시 마이크 버튼을 다시 눌러주세요.",
      "말을 끝내고 너무 빨리 누르면 인식이 안 될 수도 있어요.",
      "1초 정도 기다리신 후 눌러주시면 감사하겠습니다.",
    ],
  },
  {
    title: "대화종료",
    bullets: [
      "대화는 목적을 달성하면 자동으로 종료돼요.",
      "그 전에 대화를 끝내고 싶으시면 오른쪽 닫기 버튼을 눌러주세요.",
    ],
  },
];

type RouteParams = { scenarioId?: string };

type ScenarioGoalRowDb = {
  goal_id: string;
  scenario_id: string;
  goal_title: string | null;
  goal_type: string | null;
  goal_definition: any | null;
  success_threshold: number | null;
  version: number | null;
  is_active: boolean | null;
  created_at: string | null;
};

function getVariantFromPathname(pathname: string): "a" | "b" {
  return pathname.startsWith("/b") ? "b" : "a";
}

function getBasePath(pathname: string) {
  return pathname.startsWith("/b") ? "/b" : "/a";
}

export default function ScenarioDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { scenarioId } = useParams<RouteParams>();

  const variant = useMemo(() => getVariantFromPathname(location.pathname), [location.pathname]);
  const basePath = useMemo(() => getBasePath(location.pathname), [location.pathname]);
  const isB = variant === "b";

  const [categoryName, setCategoryName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scenario, setScenario] = useState<ScenarioRow | null>(null);
  const [pkg, setPkg] = useState<PackageRow | null>(null);
  const [examples, setExamples] = useState<ScenarioExampleLineRow[]>([]);
  const [goals, setGoals] = useState<ScenarioGoalRowDb[]>([]);

  useEffect(() => {
    if (!scenarioId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: sData, error: sErr } = await supabase
          .from("scenarios")
          .select(
            "scenario_id,package_id,title,scenario_desc,is_active,sort_order,created_at,thumb_url"
          )
          .eq("scenario_id", scenarioId)
          .single();

        if (cancelled) return;
        if (sErr) throw new Error(sErr.message);

        const s = sData as ScenarioRow;
        setScenario(s);

        const { data: pData, error: pErr } = await supabase
          .from("packages")
          .select(
            "package_id,category_id,title,description,thumb_url,sort_order,is_active,created_at"
          )
          .eq("package_id", s.package_id)
          .single();

        if (cancelled) return;
        if (pErr) throw new Error(pErr.message);

        const p = pData as PackageRow;
        setPkg(p);

        const { data: cData, error: cErr } = await supabase
          .from("learning_categories")
          .select("name")
          .eq("category_id", p.category_id)
          .single();

        if (cancelled) return;
        if (cErr) throw new Error(cErr.message);

        setCategoryName((cData as { name: string }).name ?? "");

        if (!isB) {
          const { data: eData, error: eErr } = await supabase
            .from("scenario_example_lines")
            .select("example_id,scenario_id,text_en,text_ko,sort_order")
            .eq("scenario_id", scenarioId)
            .order("sort_order", { ascending: true });

          if (cancelled) return;
          if (eErr) throw new Error(eErr.message);

          setExamples((eData ?? []) as ScenarioExampleLineRow[]);
          setGoals([]);
        }

        if (isB) {
          const { data: gData, error: gErr } = await supabase
            .from("scenario_goals")
            .select(
              "goal_id,scenario_id,goal_title,goal_type,goal_definition,success_threshold,version,is_active,created_at"
            )
            .eq("scenario_id", scenarioId);

          if (cancelled) return;
          if (gErr) throw new Error(gErr.message);

          const raw = (gData ?? []) as ScenarioGoalRowDb[];

          const picked = raw
            .filter((g) => (g.goal_title ?? "").trim().length > 0)
            .sort((a, b) => {
              const va = a.version ?? 0;
              const vb = b.version ?? 0;
              if (va !== vb) return va - vb;

              const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
              const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
              return ta - tb;
            })
            .slice(0, 3);

          setGoals(picked);
          setExamples([]);
        }

        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "알 수 없는 오류");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scenarioId, isB]);

  const heroImg = useMemo(() => {
    if (scenario?.thumb_url && scenario.thumb_url.trim()) {
      if (
        scenario.thumb_url.startsWith("/") ||
        scenario.thumb_url.startsWith("http://") ||
        scenario.thumb_url.startsWith("https://")
      ) {
        return scenario.thumb_url;
      }
      return `/${scenario.thumb_url}.png`;
    }
    return "/scenario.png";
  }, [scenario]);

  const notice = isB ? NOTICE_B : NOTICE_A;

  async function startSession() {
    if (!scenarioId || !scenario) {
      alert("시나리오 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;

    if (!userId) {
      alert("로그인이 필요합니다.");
      navigate("/auth/login");
      return;
    }

    const session_id = crypto.randomUUID();

    const payload = {
      session_id,
      user_id: userId,
      variant: variant.toUpperCase(),
      package_id: scenario.package_id,
      scenario_id: scenario.scenario_id,
      started_at: new Date().toISOString(),
      ended_at: null,
      status: "active",
      end_reason: null,
      turn_count_user: 0,
      turn_count_ai: 0,
      turn_limit: isB ? null : 20,
      platform: "web",
      model_name: null as any,
    };

    const { error: insErr } = await supabase.from("roleplay_sessions").insert(payload);
    if (insErr) {
      console.error("session insert error:", insErr);
      alert(`세션 생성 실패: ${insErr.message}`);
      return;
    }

    navigate(`${basePath}/play/${session_id}`);
  }

  function goHome() {
    navigate(`${basePath}/home`);
  }

  function goReport() {
    navigate(`${basePath}/report`);
  }

  function handleLogout() {
    navigate("/auth/login");
  }

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

      {loading && <div className={styles.helper}>불러오는 중…</div>}
      {error && <div className={styles.error}>에러: {error}</div>}

      <div className={styles.top}>
        <img className={styles.heroImg} src={heroImg} alt="scenario thumbnail" />
        <span className={styles.pill}>{categoryName || "카테고리"}</span>
        <h1 className={styles.title}>{scenario?.title ?? "시나리오명"}</h1>
        <p className={styles.sub}>{pkg?.title ?? "패키지명"}</p>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionPill}>시나리오 설명</div>
        <div className={styles.card}>
          <p className={styles.cardText}>{scenario?.scenario_desc ?? ""}</p>
        </div>
      </div>

      {!isB && (
        <div className={styles.section}>
          <div className={styles.sectionPill}>예시 문장</div>
          <div className={styles.card}>
            {examples.length === 0 && <div className={styles.empty}>예시 문장이 없습니다.</div>}
            {examples.map((ex, idx) => (
              <div key={ex.example_id} className={styles.exampleRow}>
                <div className={styles.exampleEn}>{ex.text_en}</div>
                <div className={styles.exampleKo}>{ex.text_ko ?? ""}</div>
                {idx !== examples.length - 1 && <div className={styles.exampleDivider} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {isB && (
        <div className={styles.section}>
          <div className={styles.sectionPill}>대화 목적</div>
          <div className={styles.card}>
            {goals.length === 0 && <div className={styles.empty}>대화 목적이 없습니다.</div>}
            {goals.map((g, idx) => (
              <div key={g.goal_id} className={styles.goalRow}>
                <img src="/check_dis.svg" className={styles.goalCheck} alt="" />
                <span className={styles.goalText}>{g.goal_title ?? ""}</span>
                {idx !== goals.length - 1 && <div className={styles.exampleDivider} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.notice}>
        {notice.map((sec) => (
          <div key={sec.title} className={styles.noticeBlock}>
            <div className={styles.noticeTitle}>{sec.title}</div>
            {sec.bullets.map((b, i) => (
              <div key={`${sec.title}-${i}`} className={styles.noticeBody}>
                • {b}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.bottomBar}>
        <button
          className={styles.cta}
          onClick={startSession}
          disabled={loading || !!error || !scenario}
        >
          시작하기
        </button>
      </div>
    </div>
  );
}