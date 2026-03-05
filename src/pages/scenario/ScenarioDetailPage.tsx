import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import type { PackageRow, ScenarioExampleLineRow, ScenarioRow } from "@/types/db";
import styles from "./ScenarioDetailPage.module.css";

type ScenarioGoalRow = {
  goal_id: string;
  scenario_id: string;
  goal_text: string;
  sort_order: number;
};

type NoticeSection = {
  title: string;
  bullets: string[];
};

/** ✅ A 버전 안내사항(현재 텍스트 유지) */
const NOTICE_A: NoticeSection[] = [
  {
    title: "마이크 사용권한",
    bullets: [
      "AI와 대화를 나누기 위해서는 마이크 사용 권한이 필요해요.",
      "말이 끝나면 반드시 마이크 버튼을 다시 눌러주세요.",
    ],
  },
  {
    title: "대화종료",
    bullets: [
      "대화 가능 턴수는 최대 20턴이에요. 20턴을 채우면 자동으로 대화가 종료돼요.",
      "그 전에 대화를 종료하고 싶다면 오른쪽의 X 버튼을 눌러주세요.",
    ],
  },
];

/** ✅ B 버전 안내사항(너가 쉽게 수정 가능하게 분리) */
const NOTICE_B: NoticeSection[] = [
  {
    title: "마이크 사용권한",
    bullets: [
      // TODO: B 버전 문구로 수정
      "AI와 대화를 나누기 위해서는 마이크 사용 권한이 필요해요.",
      "말이 끝나면 반드시 마이크 버튼을 다시 눌러주세요.",
    ],
  },
  {
    title: "대화종료",
    bullets: [
      // TODO: B 버전 문구로 수정
      "목표를 달성하면 자동으로 대화가 종료돼요.",
      "그 전에 대화를 종료하고 싶다면 오른쪽의 X 버튼을 눌러주세요.",
    ],
  },
];

type RouteParams = {
  variant?: string; // "a" | "b"
  scenarioId?: string;
};

function normalizeVariant(v?: string) {
  return v === "b" ? "b" : "a";
}

export default function ScenarioDetailPage() {
  const navigate = useNavigate();
  const { scenarioId, variant: rawVariant } = useParams<RouteParams>();
  const variant = normalizeVariant(rawVariant);
  const isB = variant === "b";

  const [categoryName, setCategoryName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scenario, setScenario] = useState<ScenarioRow | null>(null);
  const [pkg, setPkg] = useState<PackageRow | null>(null);

  const [examples, setExamples] = useState<ScenarioExampleLineRow[]>([]);
  const [goals, setGoals] = useState<ScenarioGoalRow[]>([]);

  useEffect(() => {
    if (!scenarioId) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      // 1) scenario
      const { data: sData, error: sErr } = await supabase
        .from("scenarios")
        .select("scenario_id,package_id,title,scenario_desc,is_active,sort_order,created_at,thumb_url")
        .eq("scenario_id", scenarioId)
        .single();

      if (cancelled) return;

      if (sErr) {
        setError(sErr.message);
        setLoading(false);
        return;
      }

      const s = sData as ScenarioRow;
      setScenario(s);

      // 2) package
      const { data: pData, error: pErr } = await supabase
        .from("packages")
        .select("package_id,category_id,title,description,thumb_url,sort_order,is_active,created_at")
        .eq("package_id", s.package_id)
        .single();

      if (cancelled) return;

      if (pErr) {
        setError(pErr.message);
        setLoading(false);
        return;
      }

      const p = pData as PackageRow;
      setPkg(p);

      // 3) category name
      const { data: cData, error: cErr } = await supabase
        .from("learning_categories")
        .select("name")
        .eq("category_id", p.category_id)
        .single();

      if (cancelled) return;

      if (cErr) {
        setError(cErr.message);
        setLoading(false);
        return;
      }
      setCategoryName((cData as { name: string }).name ?? "");

      // 4) A: example lines
      if (!isB) {
        const { data: eData, error: eErr } = await supabase
          .from("scenario_example_lines")
          .select("example_id,scenario_id,text_en,text_ko,sort_order")
          .eq("scenario_id", scenarioId)
          .order("sort_order", { ascending: true });

        if (cancelled) return;

        if (eErr) {
          setError(eErr.message);
          setLoading(false);
          return;
        }

        setExamples((eData ?? []) as ScenarioExampleLineRow[]);
        setGoals([]);
      }

      // 5) B: goals
      if (isB) {
        const { data: gData, error: gErr } = await supabase
          .from("scenario_goals")
          .select("goal_id,scenario_id,goal_text,sort_order")
          .eq("scenario_id", scenarioId)
          .order("sort_order", { ascending: true });

        if (cancelled) return;

        if (gErr) {
          setError(gErr.message);
          setLoading(false);
          return;
        }

        setGoals((gData ?? []) as ScenarioGoalRow[]);
        setExamples([]);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [scenarioId, isB]);

  const heroImg = useMemo(() => {
    if (scenario?.thumb_url && scenario.thumb_url.trim()) return `/${scenario.thumb_url}.png`;
    return "/scenario.png";
  }, [scenario]);

  const notice = isB ? NOTICE_B : NOTICE_A;

  async function startSession() {
    if (!scenarioId || !scenario) {
      alert("시나리오 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) console.log("authErr:", authErr);

    const userId = auth.user?.id;
    if (!userId) {
      alert("로그인이 필요합니다.");
      navigate("/auth/login");
      return;
    }

    // ✅ returning/select 권한 이슈 회피: 프론트에서 session_id 생성
    const session_id = crypto.randomUUID();

    const payload = {
      session_id,
      user_id: userId,
      variant: variant.toUpperCase(), // "A" | "B"
      package_id: scenario.package_id,
      scenario_id: scenario.scenario_id,
      started_at: new Date().toISOString(),
      ended_at: null,
      status: "active",
      end_reason: null,
      turn_count_user: 0,
      turn_count_ai: 0,
      turn_limit: isB ? null : 20, // ✅ B는 턴 제한 없음(원하면 null)
      platform: "web",
      model_name: null as any,
    };

    const { error: insErr } = await supabase
      .from("roleplay_sessions")
      .insert(payload);

    if (insErr) {
      console.error("session insert error:", insErr);
      alert(`세션 생성 실패: ${insErr.message}`);
      return;
    }

    // ✅ router.tsx 기준: /a/play/:sessionId , /b/play/:sessionId
    navigate(`/${variant}/play/${session_id}`);
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="back">
          <img src="/back.svg" alt="뒤로가기" />
        </button>
      </div>

      {loading && <div className={styles.helper}>불러오는 중…</div>}
      {error && <div className={styles.error}>에러: {error}</div>}

      {/* Top */}
      <div className={styles.top}>
        <img className={styles.heroImg} src={heroImg} alt="scenario thumbnail" />
        <span className={styles.pill}>{categoryName || "카테고리"}</span>
        <h1 className={styles.title}>{scenario?.title ?? "시나리오명"}</h1>
        <p className={styles.sub}>{pkg?.title ?? "패키지명"}</p>
      </div>

      {/* 시나리오 설명 */}
      <div className={styles.section}>
        <div className={styles.sectionPill}>시나리오 설명</div>
        <div className={styles.card}>
          <p className={styles.cardText}>{scenario?.scenario_desc ?? ""}</p>
        </div>
      </div>

      {/* A: 예시 문장 */}
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

      {/* B: 대화 목적 */}
      {isB && (
        <div className={styles.section}>
          <div className={styles.sectionPill}>대화 목적</div>
          <div className={styles.card}>
            {goals.length === 0 && <div className={styles.empty}>대화 목적이 없습니다.</div>}

            {goals.map((g, idx) => (
              <div key={g.goal_id} className={styles.goalRow}>
                {/* ✅ 비활성 체크 아이콘 */}
                <img src="/check_dis.svg" className={styles.goalCheck} alt="" />
                <span className={styles.goalText}>{g.goal_text}</span>
                {idx !== goals.length - 1 && <div className={styles.exampleDivider} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 안내사항 */}
      <div className={styles.notice}>
        {notice.map((sec) => (
          <div key={sec.title} className={styles.noticeBlock}>
            <div className={styles.noticeTitle}>{sec.title}</div>
            {sec.bullets.map((b, i) => (
              <div key={`${sec.title}-${i}`} className={styles.noticeBody}>
                - {b}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Bottom CTA */}
      <div className={styles.bottomBar}>
        <button className={styles.cta} onClick={startSession} disabled={loading || !!error || !scenario}>
          시작하기
        </button>
      </div>
    </div>
  );
}