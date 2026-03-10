import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./CategoryPage.module.css";

type CategoryRow = {
  category_id: string;
  name: string;
  sort_order: number | null;
  is_active: boolean;
};

type PackageRow = {
  package_id: string;
  category_id: string;
  title: string;
  description: string | null;
  thumb_url: string | null;
  sort_order: number | null;
  is_active: boolean;
};

type ScenarioRowLite = {
  scenario_id: string;
  package_id: string;
  is_active: boolean;
};

type SessionRowLite = {
  session_id: string;
  package_id: string | null;
  scenario_id: string | null;
  status: string;
};

type PackageProgress = {
  totalScenarios: number;
  completedScenarios: number;
  state: "complete" | "progress" | "not-started";
};

function getBasePath(pathname: string) {
  return pathname.startsWith("/b") ? "/b" : "/a";
}

function normalizeThumb(src: string | null | undefined) {
  if (!src) return "/scenario.png";
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) {
    return src;
  }
  return `/${src}.png`;
}

export default function CategoryPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const basePath = getBasePath(location.pathname);

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  const [progressMap, setProgressMap] = useState<Record<string, PackageProgress>>({});

  useEffect(() => {
    void loadPage();
  }, []);

  async function loadPage() {
    try {
      setLoading(true);
      setFatal(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        navigate("/auth/login", { replace: true });
        return;
      }

      const [
        { data: categoryData, error: categoryError },
        { data: packageData, error: packageError },
        { data: scenarioData, error: scenarioError },
        { data: sessionData, error: sessionError },
      ] = await Promise.all([
        supabase
          .from("learning_categories")
          .select("category_id, name, sort_order, is_active")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),

        supabase
          .from("packages")
          .select("package_id, category_id, title, description, thumb_url, sort_order, is_active")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),

        supabase
          .from("scenarios")
          .select("scenario_id, package_id, is_active")
          .eq("is_active", true),

        supabase
          .from("roleplay_sessions")
          .select("session_id, package_id, scenario_id, status")
          .eq("user_id", user.id)
          .eq("status", "ended"),
      ]);

      if (categoryError) throw new Error(categoryError.message);
      if (packageError) throw new Error(packageError.message);
      if (scenarioError) throw new Error(scenarioError.message);
      if (sessionError) throw new Error(sessionError.message);

      const nextCategories = (categoryData ?? []) as CategoryRow[];
      const nextPackages = (packageData ?? []) as PackageRow[];
      const nextScenarios = (scenarioData ?? []) as ScenarioRowLite[];
      const nextSessions = (sessionData ?? []) as SessionRowLite[];

      setCategories(nextCategories);
      setPackages(nextPackages);

      if (nextCategories.length > 0) {
        setSelectedCategoryId(nextCategories[0].category_id);
      }

      // package별 전체 scenario 수
      const totalScenarioMap: Record<string, number> = {};
      nextScenarios.forEach((s) => {
        totalScenarioMap[s.package_id] = (totalScenarioMap[s.package_id] ?? 0) + 1;
      });

      // package별 완료 scenario 집합
      const completedScenarioSetMap: Record<string, Set<string>> = {};
      nextSessions.forEach((s) => {
        if (!s.package_id || !s.scenario_id) return;
        if (!completedScenarioSetMap[s.package_id]) {
          completedScenarioSetMap[s.package_id] = new Set<string>();
        }
        completedScenarioSetMap[s.package_id].add(s.scenario_id);
      });

      const nextProgressMap: Record<string, PackageProgress> = {};
      nextPackages.forEach((pkg) => {
        const total = totalScenarioMap[pkg.package_id] ?? 0;
        const completed = completedScenarioSetMap[pkg.package_id]?.size ?? 0;

        let state: PackageProgress["state"] = "not-started";
        if (completed > 0 && completed < total) state = "progress";
        if (total > 0 && completed >= total) state = "complete";

        nextProgressMap[pkg.package_id] = {
          totalScenarios: total,
          completedScenarios: completed,
          state,
        };
      });

      setProgressMap(nextProgressMap);
      setLoading(false);
    } catch (error) {
      console.error(error);
      setFatal(error instanceof Error ? error.message : "불러오기에 실패했습니다.");
      setLoading(false);
    }
  }

  const selectedCategoryName = useMemo(() => {
    return categories.find((c) => c.category_id === selectedCategoryId)?.name ?? "";
  }, [categories, selectedCategoryId]);

  const visiblePackages = useMemo(() => {
    return packages.filter((pkg) => pkg.category_id === selectedCategoryId);
  }, [packages, selectedCategoryId]);

  function goHome() {
    navigate(`${basePath}/home`);
  }

  function goReport() {
    navigate(`${basePath}/report`);
  }

  function handleLogout() {
    navigate("/auth/login");
  }

  function openPackage(packageId: string) {
    navigate(`${basePath}/packages/${packageId}`);
  }

  function getBadgeLabel(state: PackageProgress["state"]) {
    if (state === "complete") return "완료";
    if (state === "progress") return "진행중";
    return "시작전";
  }

  function getBadgeClass(state: PackageProgress["state"]) {
    if (state === "complete") return styles.badgeComplete;
    if (state === "progress") return styles.badgeProgress;
    return styles.badgeNotStarted;
  }

  if (loading) {
    return <div className={styles.loading}>불러오는 중…</div>;
  }

  if (fatal) {
    return <div className={styles.loading}>에러: {fatal}</div>;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
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

      <main className={styles.main}>
        <h1 className={styles.title}>{selectedCategoryName || "카테고리"}</h1>

        <div className={styles.tabRow}>
          {categories.map((category) => {
            const active = category.category_id === selectedCategoryId;
            return (
              <button
                key={category.category_id}
                type="button"
                className={`${styles.tabButton} ${active ? styles.tabButtonActive : ""}`}
                onClick={() => setSelectedCategoryId(category.category_id)}
              >
                {category.name}
              </button>
            );
          })}
        </div>

        <div className={styles.grid}>
          {visiblePackages.map((pkg) => {
            const progress = progressMap[pkg.package_id] ?? {
              totalScenarios: 0,
              completedScenarios: 0,
              state: "not-started" as const,
            };

            return (
              <button
                key={pkg.package_id}
                type="button"
                className={styles.card}
                onClick={() => openPackage(pkg.package_id)}
              >
                <div className={styles.cardImageWrap}>
                  <img
                    className={styles.cardImage}
                    src={normalizeThumb(pkg.thumb_url)}
                    alt={pkg.title}
                  />
                </div>

                <div className={styles.cardBody}>
                  <div className={`${styles.badge} ${getBadgeClass(progress.state)}`}>
                    {getBadgeLabel(progress.state)}
                  </div>

                  <div className={styles.cardTitle}>{pkg.title}</div>

                  {progress.totalScenarios > 0 && (
                    <div className={styles.cardMeta}>
                      {progress.completedScenarios}/{progress.totalScenarios}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}