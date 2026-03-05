import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import type { LearningCategoryRow, PackageRow } from "@/types/db";
import styles from "./CategoryPage.module.css";
import { fetchUserProgress } from "@/services/progress";

type VariantPath = "a" | "b";
function normalizeVariant(v: unknown): VariantPath {
  return v === "b" ? "b" : "a";
}

export default function CategoryPage() {
  const navigate = useNavigate();
  const params = useParams();
  const variant = normalizeVariant((params as any).variant);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<LearningCategoryRow[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageRow[]>([]);

  // ✅ 진행도 맵
  const [pkgProgMap, setPkgProgMap] = useState<Record<string, any>>({});

  // 0) 유저 진행도 로드(배지용)
  useEffect(() => {
    (async () => {
      try {
        const prog = await fetchUserProgress();
        setPkgProgMap(prog.packageProgressMap);
      } catch (e: any) {
        // 로그인 안 된 경우도 있을 수 있음
        console.warn(e?.message ?? e);
      }
    })();
  }, []);

  // 1) 카테고리 로드
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("learning_categories")
        .select("category_id,name,sort_order,is_active,created_at")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as LearningCategoryRow[];
      setCategories(list);
      if (list.length > 0) setActiveCategoryId(list[0].category_id);
      setLoading(false);
    })();
  }, []);

  // 2) 선택된 카테고리의 패키지 로드
  useEffect(() => {
    if (!activeCategoryId) return;

    (async () => {
      setError(null);

      const { data, error } = await supabase
        .from("packages")
        .select("package_id,category_id,title,description,thumb_url,sort_order,is_active,created_at")
        .eq("is_active", true)
        .eq("category_id", activeCategoryId)
        .order("sort_order", { ascending: true });

      if (error) {
        setError(error.message);
        return;
      }

      setPackages((data ?? []) as PackageRow[]);
    })();
  }, [activeCategoryId]);

  const activeName = useMemo(() => {
    return categories.find((c) => c.category_id === activeCategoryId)?.name ?? "";
  }, [categories, activeCategoryId]);

  function getThumbSrc(fileName?: string | null) {
    if (fileName && fileName.trim()) return `/${fileName}.png`;
    return "/package.png";
  }

  function getBadgeInfo(packageId: string) {
    const p = pkgProgMap?.[packageId];
    if (!p) return { text: "시작 전", cls: styles.badgeNotStarted };
    if (p.isClear) return { text: "완료", cls: styles.badgeClear };
    if (p.isInProgress) return { text: "진행 중", cls: styles.badgeProgress };
    return { text: "시작 전", cls: styles.badgeNotStarted };
  }

  return (
    <div className={styles.container}>
      {/* HEADER */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate(`/${variant}/home`)}>
          <img src="/back.png" alt="뒤로가기" />
        </button>
        <h1>학습영역</h1>
      </div>

      {/* TITLE */}
      <h2 className={styles.sectionTitle}>{activeName || "학습영역"}</h2>

      {/* TABS */}
      <div className={styles.tabs}>
        {categories.map((c) => (
          <button
            key={c.category_id}
            className={`${styles.tab} ${c.category_id === activeCategoryId ? styles.activeTab : ""}`}
            onClick={() => setActiveCategoryId(c.category_id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {loading && <div className={styles.helper}>불러오는 중…</div>}
      {error && <div className={styles.error}>에러: {error}</div>}

      {/* GRID */}
      <div className={styles.grid}>
        {packages.map((p) => {
          const badge = getBadgeInfo(p.package_id);
          return (
            <div
              key={p.package_id}
              className={styles.card}
              onClick={() => navigate(`/${variant}/packages/${p.package_id}`)}
            >
              <img src={getThumbSrc(p.thumb_url)} className={styles.image} alt={p.title} />

              <span className={`${styles.badge} ${badge.cls}`}>{badge.text}</span>
              <p className={styles.name}>{p.title}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}