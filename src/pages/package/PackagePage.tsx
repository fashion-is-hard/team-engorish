import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import type { PackageRow, ScenarioRow } from "@/types/db";
import styles from "./PackagePage.module.css";
import { fetchUserProgress } from "@/services/progress";

type VariantPath = "a" | "b";

function getVariantFromPath(pathname: string): VariantPath {
  return pathname.startsWith("/b") ? "b" : "a";
}

export default function PackagePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const variant = useMemo(() => getVariantFromPath(location.pathname), [location.pathname]);
  const packageId = (params as { packageId?: string }).packageId;

  const [pkg, setPkg] = useState<PackageRow | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!packageId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: pData, error: pErr } = await supabase
          .from("packages")
          .select(
            "package_id,category_id,title,description,thumb_url,sort_order,is_active,created_at"
          )
          .eq("package_id", packageId)
          .single();

        if (cancelled) return;
        if (pErr) throw new Error(pErr.message);
        setPkg(pData as PackageRow);

        const { data: sData, error: sErr } = await supabase
          .from("scenarios")
          .select(
            "scenario_id,package_id,title,scenario_desc,is_active,sort_order,created_at,thumb_url"
          )
          .eq("package_id", packageId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (cancelled) return;
        if (sErr) throw new Error(sErr.message);

        const list = (sData ?? []) as ScenarioRow[];
        setScenarios(list);

        const prog = await fetchUserProgress();
        const p = prog.packageProgressMap?.[packageId];

        if (p && typeof p.currentIndex === "number") {
          setCurrentIndex(Math.max(0, Math.min(p.currentIndex, Math.max(0, list.length - 1))));
        } else {
          setCurrentIndex(0);
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
  }, [packageId]);

  const currentScenario = useMemo(() => {
    return scenarios[currentIndex] ?? null;
  }, [scenarios, currentIndex]);

  function getThumbSrc(fileName?: string | null) {
    if (!fileName || !fileName.trim()) return "/scenario.png";
    if (fileName.startsWith("http://") || fileName.startsWith("https://") || fileName.startsWith("/")) {
      return fileName;
    }
    return `/${fileName}.png`;
  }

  function goHome() {
    navigate(`/${variant}/home`);
  }

  function goReport() {
    navigate(`/${variant}/report`);
  }

  function handleLogout() {
    navigate("/auth/login");
  }

  function openCurrentScenario() {
    if (!currentScenario) return;
    navigate(`/${variant}/scenarios/${currentScenario.scenario_id}`);
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

          <button
            type="button"
            className={styles.iconButton}
            onClick={goReport}
            aria-label="report"
          >
            <img src="/report.svg" alt="" />
          </button>

          <button
            type="button"
            className={styles.iconButton}
            onClick={handleLogout}
            aria-label="logout"
          >
            <img src="/out.svg" alt="" />
          </button>
        </div>
      </header>

      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{pkg?.title ?? "패키지"}</h1>
      </div>

      <main className={styles.body}>
        {error ? <div className={styles.error}>에러: {error}</div> : null}

        {loading ? (
          <div className={styles.skeletonList}>
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : (
          <div className={styles.list}>
            {scenarios.map((s, index) => {
              const unlocked = index <= currentIndex;
              const locked = index > currentIndex;
              const isCurrent = index === currentIndex;

              return (
                <div key={s.scenario_id} className={styles.row}>
                  <div
                    className={`${styles.number} ${
                      unlocked ? styles.numberOn : styles.numberOff
                    }`}
                  >
                    {index + 1}
                  </div>

                  <div
                    className={`${styles.card} ${locked ? styles.locked : ""} ${
                      isCurrent ? styles.current : ""
                    }`}
                  >
                    <div className={styles.thumbWrap}>
                      <img src={getThumbSrc(s.thumb_url)} className={styles.image} alt={s.title} />
                    </div>

                    <div className={styles.texts}>
                      <p className={styles.title}>{s.title}</p>
                      <p className={styles.desc}>{s.scenario_desc ?? ""}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <div className={styles.bottomBar}>
        <button
          className={styles.cta}
          disabled={!currentScenario}
          type="button"
          onClick={openCurrentScenario}
        >
          시작하기
        </button>
      </div>
    </div>
  );
}