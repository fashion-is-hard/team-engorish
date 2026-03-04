import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./ScenarioDetailPage.module.css";

type CorrectionMode = "correct" | "suggest";
type Difficulty = "basic" | "intermediate";
type Speed = 0.8 | 1.0 | 1.2 | 1.5;

export default function ScenarioDetailPage() {
  const navigate = useNavigate();

  // (임시) 나중에 DB에서 불러오기
  const scenario = useMemo(
    () => ({
      category: "카테고리",
      title: "시나리오명",
      packageName: "패키지명",
      description: "시나리오 설명",
      noticeTitle: "안내사항",
      noticeBody: "• 설명 문장",
      examples: [
        { en: "예시 문장", ko: "번역" },
        { en: "예시 문장", ko: "번역" },
        { en: "예시 문장", ko: "번역" },
      ],
    }),
    []
  );

  // 설정값 (A버전 UI에서도 수집)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>("suggest");
  const [difficulty, setDifficulty] = useState<Difficulty>("basic");
  const [speed, setSpeed] = useState<Speed>(1.0);

  const correctionLabel = correctionMode === "correct" ? "교정 하기" : "새로운 제안";
  const difficultyLabel = difficulty === "basic" ? "Basic" : "Intermediate";

  function openSettings() {
    setSheetOpen(true);
  }

  function closeSettings() {
    setSheetOpen(false);
  }

  function applySettings() {
    // TODO: supabase에 session_settings로 저장 (나중에 연결)
    setSheetOpen(false);
  }

  function start() {
    // TODO: 세션 생성 후 play로 이동
    // navigate(`/play/${scenarioId}`)
    navigate("/play");
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="back">
          ←
        </button>
      </div>

      {/* Top */}
      <div className={styles.top}>
        <img className={styles.heroImg} src="/scenario.png" alt="scenario" />

        <span className={styles.pill}>{scenario.category}</span>

        <h1 className={styles.title}>{scenario.title}</h1>
        <p className={styles.sub}>{scenario.packageName}</p>
      </div>

      {/* Section: 시나리오 설명 */}
      <div className={styles.section}>
        <div className={styles.sectionPill}>시나리오 설명</div>
        <div className={styles.card}>
          <p className={styles.cardText}>{scenario.description}</p>
        </div>
      </div>

      {/* Section: 대화설정 */}
      <div className={styles.section}>
        <div className={styles.sectionPill}>대화설정</div>

        <div className={styles.settingsCard} role="button" tabIndex={0} onClick={openSettings}>
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>교정모드</span>
            <span className={styles.settingsValue}>{correctionLabel}</span>
          </div>

          <div className={styles.divider} />

          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>난이도 조절</span>
            <span className={styles.settingsValue}>{difficultyLabel}</span>
          </div>

          <div className={styles.divider} />

          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>질문 속도 조절</span>
            <span className={styles.settingsValue}>{speed.toFixed(1)}</span>
          </div>

          <div className={styles.chev}>›</div>
        </div>
      </div>

      {/* Section: 예시 문장 */}
      <div className={styles.section}>
        <div className={styles.sectionPill}>예시 문장</div>
        <div className={styles.card}>
          {scenario.examples.map((ex, idx) => (
            <div key={idx} className={styles.exampleRow}>
              <div className={styles.exampleEn}>{ex.en}</div>
              <div className={styles.exampleKo}>{ex.ko}</div>
              {idx !== scenario.examples.length - 1 && <div className={styles.exampleDivider} />}
            </div>
          ))}
        </div>
      </div>

      {/* Notice */}
      <div className={styles.notice}>
        <div className={styles.noticeTitle}>{scenario.noticeTitle}</div>
        <div className={styles.noticeBody}>{scenario.noticeBody}</div>
      </div>

      {/* Bottom CTA */}
      <div className={styles.bottomBar}>
        <button className={styles.cta} onClick={start}>
          시작하기
        </button>
      </div>

      {/* Bottom Sheet */}
      {sheetOpen && (
        <>
          <div className={styles.backdrop} onClick={closeSettings} />
          <div className={styles.sheet} role="dialog" aria-modal="true">
            <div className={styles.sheetHandle} />

            <h2 className={styles.sheetTitle}>대화설정</h2>

            <div className={styles.sheetBlock}>
              <div className={styles.sheetLabel}>교정모드</div>
              <div className={styles.chips}>
                <button
                  type="button"
                  className={`${styles.chip} ${correctionMode === "correct" ? styles.chipActive : ""}`}
                  onClick={() => setCorrectionMode("correct")}
                >
                  교정 하기
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${correctionMode === "suggest" ? styles.chipActive : ""}`}
                  onClick={() => setCorrectionMode("suggest")}
                >
                  새로운 제안
                </button>
              </div>
            </div>

            <div className={styles.sheetBlock}>
              <div className={styles.sheetLabel}>난이도 설정</div>
              <div className={styles.chips}>
                <button
                  type="button"
                  className={`${styles.chip} ${difficulty === "basic" ? styles.chipActive : ""}`}
                  onClick={() => setDifficulty("basic")}
                >
                  Basic
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${difficulty === "intermediate" ? styles.chipActive : ""}`}
                  onClick={() => setDifficulty("intermediate")}
                >
                  Intermediate
                </button>
              </div>
            </div>

            <div className={styles.sheetBlock}>
              <div className={styles.sheetLabel}>질문 속도</div>
              <div className={styles.speedRow}>
                {[0.8, 1.0, 1.2, 1.5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`${styles.speedChip} ${speed === v ? styles.speedActive : ""}`}
                    onClick={() => setSpeed(v as Speed)}
                  >
                    {v.toFixed(1)}
                  </button>
                ))}
              </div>
            </div>

            <button className={styles.sheetCta} onClick={applySettings}>
              설정하기
            </button>
          </div>
        </>
      )}
    </div>
  );
}