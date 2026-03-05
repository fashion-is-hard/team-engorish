import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./HomePage.module.css";
import { fetchUserProgress } from "@/services/progress";

type VariantPath = "a" | "b";
function normalizeVariant(v: unknown): VariantPath {
  return v === "b" ? "b" : "a";
}

type PackageRow = {
  package_id: string;
  title: string;
  thumb_url: string | null;
};

type ScenarioRow = {
  scenario_id: string;
  package_id: string;
  title: string;
  scenario_desc: string | null;
  thumb_url: string | null;
  sort_order: number | null;
};

export default function HomePage() {
  const navigate = useNavigate();
  const params = useParams();
  const variant = normalizeVariant((params as any).variant);

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  // 진행중 패키지/시나리오
  const [activePackageId, setActivePackageId] = useState<string | null>(null);
  const [activePackage, setActivePackage] = useState<PackageRow | null>(null);
  const [scenarioList, setScenarioList] = useState<ScenarioRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // 전체 완료 여부
  const [allClear, setAllClear] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setFatal(null);

        // 로그인 체크
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) {
          navigate("/auth/login");
          return;
        }

        const prog = await fetchUserProgress();

        // “모든 패키지 clear” 판단
        const pkgIds = Object.keys(prog.packageProgressMap || {});
        const isAllClear =
          pkgIds.length > 0 && pkgIds.every((pid) => prog.packageProgressMap[pid]?.isClear === true);
        setAllClear(isAllClear);

        // 전부 완료면 카테고리로(= 두 번째 화면)
        if (isAllClear) {
          navigate(`/${variant}/categories`, { replace: true });
          return;
        }

        // 진행중 패키지 선택:
        // 1) lastPackageId가 있고 clear가 아니면 그걸
        // 2) 아니면 clear 아닌 첫 패키지
        let chosen: string | null = null;
        if (prog.lastPackageId && prog.packageProgressMap[prog.lastPackageId] && !prog.packageProgressMap[prog.lastPackageId].isClear) {
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
          // 안전망
          navigate(`/${variant}/categories`, { replace: true });
          return;
        }

        setActivePackageId(chosen);

        // 패키지 정보
        const { data: pData, error: pErr } = await supabase
          .from("packages")
          .select("package_id,title,thumb_url")
          .eq("package_id", chosen)
          .single();

        if (pErr) throw new Error(pErr.message);
        setActivePackage(pData as PackageRow);

        // 패키지 시나리오 목록
        const { data: sData, error: sErr } = await supabase
          .from("scenarios")
          .select("scenario_id,package_id,title,scenario_desc,thumb_url,sort_order,is_active")
          .eq("package_id", chosen)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (sErr) throw new Error(sErr.message);

        const list = (sData ?? []) as ScenarioRow[];
        setScenarioList(list);
        setTotalCount(list.length);

        const p = prog.packageProgressMap[chosen];
        const idx = p?.currentIndex ?? 0;
        setCurrentIndex(Math.max(0, Math.min(idx, Math.max(0, list.length - 1))));

        setLoading(false);
      } catch (e: any) {
        setFatal(e?.message ?? "알 수 없는 오류");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const progressText = useMemo(() => {
    // 0/5 형태는 “완료된 개수/전체”
    // currentIndex는 “다음으로 진행해야 할 인덱스”니까 완료 수 = currentIndex
    return `${currentIndex}/${Math.max(0, totalCount)}`;
  }, [currentIndex, totalCount]);

  const progressRatio = useMemo(() => {
    if (totalCount <= 0) return 0;
    return Math.max(0, Math.min(1, currentIndex / totalCount));
  }, [currentIndex, totalCount]);

  const nextScenario = useMemo(() => scenarioList[currentIndex] ?? null, [scenarioList, currentIndex]);

  function getThumbSrc(fileName?: string | null) {
    if (fileName && fileName.trim()) return `/${fileName}.png`;
    return "/scenario.png";
  }

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;
  if (fatal) return <div className={styles.loading}>에러: {fatal}</div>;

  // 여기까지 왔다는 건 “진행중 패키지 있음” 상태
  return (
    <div className={styles.container}>
      <div className={styles.appBar}>
        <div className={styles.brand}>Engorish</div>
        <div className={styles.icons}>
          <img src="/report.svg" alt="report" className={styles.iconBtn} />
          <img src="/out.svg" alt="out" className={styles.iconBtn} />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.h1}>진행중인 학습</div>

        <div className={styles.pkgTitleRow}>
          <div className={styles.pkgName}>{activePackage?.title ?? "패키지명"}</div>
          <button className={styles.menuBtn} type="button" onClick={() => navigate(`/${variant}/packages/${activePackageId}`)}>
            <img src="/menu.svg" alt="menu" />
          </button>
        </div>

        <div className={styles.progressRow}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressRatio * 100}%` }} />
          </div>
          <div className={styles.progressText}>{progressText}</div>
        </div>

        <div className={styles.list}>
          {scenarioList.map((s, idx) => {
            const unlocked = idx <= currentIndex;
            const locked = idx > currentIndex;
            return (
              <div key={s.scenario_id} className={styles.row}>
                <div className={`${styles.num} ${unlocked ? styles.numOn : styles.numOff}`}>
                  {idx + 1}
                </div>

                <div className={`${styles.card} ${locked ? styles.locked : ""}`}>
                  <img className={styles.thumb} src={getThumbSrc(s.thumb_url)} alt={s.title} />
                  <div className={styles.cardTexts}>
                    <div className={styles.cardTitle}>{s.title}</div>
                    <div className={styles.cardDesc}>{s.scenario_desc ?? ""}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          className={styles.cta}
          disabled={!nextScenario}
          onClick={() => {
            if (!nextScenario) return;
            navigate(`/${variant}/scenarios/${nextScenario.scenario_id}`);
          }}
        >
          이어하기
        </button>
      </div>
    </div>
  );
}