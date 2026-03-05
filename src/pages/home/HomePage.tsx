import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./HomePage.module.css";
import { fetchUserProgress } from "@/services/progress";

type PackageLite = {
  package_id: string;
  title: string;
  thumb_url: string | null;
};

type ScenarioLite = {
  scenario_id: string;
  package_id: string;
  title: string;
  scenario_desc: string | null;
  thumb_url: string | null;
  sort_order: number | null;
};

function getVariantFromPath(pathname: string): "a" | "b" {
  return pathname.startsWith("/b") ? "b" : "a";
}

function imgSrc(fileName?: string | null, fallback = "/scenario.png") {
  if (fileName && fileName.trim()) return `/${fileName}.png`;
  return fallback;
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const variant = useMemo(() => getVariantFromPath(location.pathname), [location.pathname]);

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [activePackageId, setActivePackageId] = useState<string | null>(null);
  const [activePackage, setActivePackage] = useState<PackageLite | null>(null);

  const [scenarioList, setScenarioList] = useState<ScenarioLite[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // (A) 홈 규칙:
  // - 진행중(=clear 아닌 패키지)이 있으면 “진행중인 학습” UI
  // - 전부 clear면 카테고리 페이지로 보내기
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setFatal(null);

        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) {
          navigate("/auth/login");
          return;
        }

        const prog = await fetchUserProgress();
        const pkgIds = Object.keys(prog.packageProgressMap || {});

        const isAllClear = pkgIds.length > 0 && pkgIds.every((pid) => prog.packageProgressMap[pid]?.isClear === true);
        if (isAllClear) {
          navigate(`/${variant}/categories`, { replace: true });
          return;
        }

        // 진행중 패키지 선택: 최근 패키지 우선, 없으면 clear 아닌 첫 패키지
        let chosen: string | null = null;
        if (
          prog.lastPackageId &&
          prog.packageProgressMap[prog.lastPackageId] &&
          !prog.packageProgressMap[prog.lastPackageId].isClear
        ) {
          chosen = prog.lastPackageId;
        } else {
          for (const pid of pkgIds) {
            if (!prog.packageProgressMap[pid]?.isClear) {
              chosen = pid;
              break;
            }
          }
        }

        if (!chosen) {
          navigate(`/${variant}/categories`, { replace: true });
          return;
        }

        if (cancelled) return;
        setActivePackageId(chosen);

        // package info
        const { data: pData, error: pErr } = await supabase
          .from("packages")
          .select("package_id,title,thumb_url")
          .eq("package_id", chosen)
          .single();

        if (pErr) throw new Error(pErr.message);
        if (cancelled) return;
        setActivePackage(pData as PackageLite);

        // scenarios in package
        const { data: sData, error: sErr } = await supabase
          .from("scenarios")
          .select("scenario_id,package_id,title,scenario_desc,thumb_url,sort_order,is_active")
          .eq("package_id", chosen)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (sErr) throw new Error(sErr.message);
        const list = (sData ?? []) as ScenarioLite[];

        if (cancelled) return;
        setScenarioList(list);

        const p = prog.packageProgressMap[chosen];
        const idx = typeof p?.currentIndex === "number" ? p.currentIndex : 0;
        setCurrentIndex(Math.max(0, Math.min(idx, Math.max(0, list.length - 1))));

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
  }, [navigate, variant]);

  const totalCount = scenarioList.length;

  const progressText = useMemo(() => {
    // 완료 수 = currentIndex (다음으로 해야할 인덱스)
    return `${currentIndex}/${Math.max(0, totalCount)}`;
  }, [currentIndex, totalCount]);

  const progressRatio = useMemo(() => {
    if (totalCount <= 0) return 0;
    return Math.max(0, Math.min(1, currentIndex / totalCount));
  }, [currentIndex, totalCount]);

  const nextScenario = useMemo(() => scenarioList[currentIndex] ?? null, [scenarioList, currentIndex]);

  const goCategories = () => navigate(`/${variant}/categories`);
  const goContinue = () => {
    if (!nextScenario) return;
    navigate(`/${variant}/scenarios/${nextScenario.scenario_id}`);
  };

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;
  if (fatal) return <div className={styles.loading}>에러: {fatal}</div>;

  return (
    <div className={styles.container}>
      {/* Top App Bar */}
      <header className={styles.appBar}>
        <div className={styles.brand}>Engorish</div>

        <div className={styles.appIcons}>
          {/* 아이콘 파일 없으면 안 보일 수 있어서 alt 텍스트만이라도 남김 */}
          <button className={styles.iconBtn} type="button" aria-label="report" onClick={() => navigate(`/${variant}/report`)}>
            <img src="/doc.svg" alt="" />
          </button>
          <button className={styles.iconBtn} type="button" aria-label="logout">
            <img src="/logout.svg" alt="" />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>진행중인 학습</h2>

          {/* package row */}
          <div className={styles.pkgRow}>
            <div className={styles.pkgName}>{activePackage?.title ?? "패키지명"}</div>

            {/* ✅ 햄버거 → 카테고리 페이지로 */}
            <button className={styles.menuBtn} type="button" onClick={goCategories} aria-label="categories">
              <img src="/menu.svg" alt="" />
            </button>
          </div>

          {/* progress */}
          <div className={styles.progressRow}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progressRatio * 100}%` }} />
            </div>
            <div className={styles.progressText}>{progressText}</div>
          </div>

          {/* list */}
          <div className={styles.list}>
            {scenarioList.map((s, idx) => {
              const unlocked = idx <= currentIndex; // clear + current
              return (
                <div key={s.scenario_id} className={styles.row}>
                  <div className={`${styles.numCircle} ${unlocked ? styles.numOn : styles.numOff}`}>
                    {idx + 1}
                  </div>

                  <div className={styles.card}>
                    <img
                      className={styles.thumb}
                      src={imgSrc(s.thumb_url)}
                      alt={s.title}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = "/scenario.png";
                      }}
                    />
                    <div className={styles.cardTexts}>
                      <div className={styles.cardTitle}>{s.title}</div>
                      <div className={styles.cardDesc}>{s.scenario_desc ?? ""}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* bottom button */}
          <div className={styles.bottom}>
            <button className={styles.cta} type="button" onClick={goContinue} disabled={!nextScenario}>
              이어하기
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}