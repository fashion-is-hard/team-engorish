import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./HomePage.module.css";
import { fetchUserProgress } from "@/services/progress";

type CategoryRow = { category_id: string; name: string; sort_order: number | null };
type PackageRowLite = {
  package_id: string;
  category_id: string;
  title: string;
  description: string | null;
  thumb_url: string | null;
  sort_order: number | null;
  is_active: boolean;
};

type BadgeType = "clear" | "progress" | "not_started";

function getVariantFromPath(pathname: string): "a" | "b" {
  return pathname.startsWith("/b") ? "b" : "a";
}

function imgSrc(fileName?: string | null, fallback = "/package.png") {
  if (fileName && fileName.trim()) return `/${fileName}.png`;
  return fallback;
}

function badgeLabel(t: BadgeType) {
  if (t === "clear") return "완료";
  if (t === "progress") return "진행 중";
  return "시작 전";
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const variant = useMemo(() => getVariantFromPath(location.pathname), [location.pathname]);

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const [packages, setPackages] = useState<PackageRowLite[]>([]);
  const [progressMap, setProgressMap] = useState<any>(null); // fetchUserProgress 결과 그대로 저장

  // ----- boot load -----
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

        // 1) categories
        const { data: cData, error: cErr } = await supabase
          .from("learning_categories")
          .select("category_id,name,sort_order")
          .order("sort_order", { ascending: true });

        if (cErr) throw new Error(cErr.message);
        const cList = (cData ?? []) as CategoryRow[];

        if (cancelled) return;
        setCategories(cList);

        // 기본 선택: 첫 카테고리
        const firstCat = cList?.[0]?.category_id ?? null;
        setActiveCategoryId(firstCat);

        // 2) progress (badge 계산용)
        const prog = await fetchUserProgress();
        if (cancelled) return;
        setProgressMap(prog?.packageProgressMap ?? {});

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
  }, [navigate]);

  // ----- when category changes: load packages -----
  useEffect(() => {
    let cancelled = false;
    if (!activeCategoryId) return;

    (async () => {
      try {
        setLoading(true);
        setFatal(null);

        const { data: pData, error: pErr } = await supabase
          .from("packages")
          .select("package_id,category_id,title,description,thumb_url,sort_order,is_active")
          .eq("category_id", activeCategoryId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (pErr) throw new Error(pErr.message);

        if (cancelled) return;
        setPackages((pData ?? []) as PackageRowLite[]);
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
  }, [activeCategoryId]);

  // ...위 코드 동일

  const goReport = () => navigate(`/${variant}/report`);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/auth/login");
  };

  // ✅ 패키지 페이지 이동
  const goPackage = (packageId: string) => {
    navigate(`/${variant}/packages/${packageId}`);
  };

  const getBadge = (packageId: string): BadgeType => {
    const p = progressMap?.[packageId];
    const isClear = p?.isClear === true;
    const idx = typeof p?.currentIndex === "number" ? p.currentIndex : 0;

    if (isClear) return "clear";
    if (idx > 0) return "progress";
    return "not_started";
  };

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;
  if (fatal) return <div className={styles.loading}>에러: {fatal}</div>;

  return (
    <div className={styles.container}>
      {/* AppBar */}
      <header className={styles.appBar}>
        <div className={styles.brand}>Engorish</div>

        <div className={styles.appIcons}>
          <button className={styles.iconBtn} type="button" aria-label="report" onClick={goReport}>
            <img src="/report.svg" alt="" />
          </button>
          <button className={styles.iconBtn} type="button" aria-label="logout" onClick={logout}>
            <img src="/out.svg" alt="" />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <h2 className={styles.pageTitle}>캠퍼스 영어</h2>

        {/* Category tabs */}
        <div className={styles.tabs}>
          {categories.map((c) => {
            const on = c.category_id === activeCategoryId;
            return (
              <button
                key={c.category_id}
                type="button"
                className={`${styles.tab} ${on ? styles.tabOn : styles.tabOff}`}
                onClick={() => setActiveCategoryId(c.category_id)}
              >
                {c.name}
              </button>
            );
          })}
        </div>

        {/* ✅ Package grid */}
        <div className={styles.grid}>
          {packages.map((p) => {
            const badge = getBadge(p.package_id);

            return (
              <button
                key={p.package_id}
                type="button"
                className={styles.cardBtn}      // ✅ 새 클래스 추천 (아래 CSS 참고)
                onClick={() => goPackage(p.package_id)}
                aria-label={`패키지 열기: ${p.title}`}
              >
                <img
                  className={styles.thumb}
                  src={imgSrc(p.thumb_url, "/scenario.png")}
                  alt=""
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/scenario.png";
                  }}
                />

                <div className={`${styles.badge} ${styles[`badge_${badge}`]}`}>
                  {badgeLabel(badge)}
                </div>

                <div className={styles.cardTitle}>{p.title}</div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}