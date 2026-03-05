import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import type { PackageRow, ScenarioRow } from "@/types/db";
import styles from "./PackagePage.module.css";
import { fetchUserProgress } from "@/services/progress";

type VariantPath = "a" | "b";
function normalizeVariant(v: unknown): VariantPath {
  return v === "b" ? "b" : "a";
}

export default function PackagePage() {
  const navigate = useNavigate();
  const params = useParams();
  const variant = normalizeVariant((params as any).variant);
  const packageId = (params as any).packageId as string | undefined;

  const [pkg, setPkg] = useState<PackageRow | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ 진행도
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
          .select("package_id,category_id,title,description,thumb_url,sort_order,is_active,created_at")
          .eq("package_id", packageId)
          .single();

        if (cancelled) return;
        if (pErr) throw new Error(pErr.message);
        setPkg(pData as PackageRow);

        const { data: sData, error: sErr } = await supabase
          .from("scenarios")
          .select("scenario_id,package_id,title,scenario_desc,is_active,sort_order,created_at,thumb_url")
          .eq("package_id", packageId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (cancelled) return;
        if (sErr) throw new Error(sErr.message);

        const list = (sData ?? []) as ScenarioRow[];
        setScenarios(list);

        // ✅ 진행도 기반 currentIndex 계산
        const prog = await fetchUserProgress();
        const p = prog.packageProgressMap?.[packageId];
        if (p && typeof p.currentIndex === "number") {
          // clear면 마지막 인덱스이긴 한데, 버튼은 disabled 처리로 막을 수도 있음
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

  const currentScenario = useMemo(() => scenarios[currentIndex] ?? null, [scenarios, currentIndex]);

  function getThumbSrc(fileName?: string | null) {
    if (fileName && fileName.trim()) return `/${fileName}.png`;
    return "/scenario.png";
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} type="button" onClick={() => navigate(`/${variant}/categories`)}>
          <img src="/back.svg" alt="뒤로가기" />
        </button>
        <h1 className={styles.headerTitle}>{pkg?.title ?? "패키지"}</h1>
      </div>

      <div className={styles.body}>
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
              const unlocked = index <= currentIndex; // 완료 + 현재
              const locked = index > currentIndex;    // 잠김
              const isCurrent = index === currentIndex;

              return (
                <div key={s.scenario_id} className={styles.row}>
                  <div className={`${styles.number} ${unlocked ? styles.numberOn : styles.numberOff}`}>
                    {index + 1}
                  </div>

                  {/* ✅ 카드 클릭 없음(상호작용 X) */}
                  <div className={`${styles.card} ${locked ? styles.locked : ""} ${isCurrent ? styles.current : ""}`}>
                    <img src={getThumbSrc(s.thumb_url)} className={styles.image} alt={s.title} />
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
      </div>

      {/* Bottom CTA: 다음 시나리오 디테일로 */}
      <button
        className={styles.cta}
        disabled={!currentScenario}
        type="button"
        onClick={() => {
          if (!currentScenario) return;
          navigate(`/${variant}/scenarios/${currentScenario.scenario_id}`);
        }}
      >
        시작하기
      </button>
    </div>
  );
}