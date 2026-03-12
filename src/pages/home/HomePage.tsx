import { useNavigate, useLocation } from "react-router-dom";
import styles from "./HomePage.module.css";

function getBasePath(pathname: string) {
  return pathname.startsWith("/b") ? "/b" : "/a";
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();

  const basePath = getBasePath(location.pathname);

  function goHome() {
    navigate(`${basePath}/home`);
  }

  function goReport() {
    navigate(`${basePath}/report`);
  }

  function handleLogout() {
    navigate("/auth/login");
  }

  function handleStart() {
    navigate(`${basePath}/categories`);
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button type="button" className={styles.logoButton} onClick={goHome}>
          Engorish
        </button>

        <div className={styles.headerActions}>
          <button type="button" className={styles.iconButton} onClick={goHome} aria-label="home">
            <img src="/home.svg" alt="홈으로" />
          </button>

          <button type="button" className={styles.iconButton} onClick={goReport} aria-label="report">
            <img src="/report.svg" alt="리포트" />
          </button>

          <button type="button" className={styles.iconButton} onClick={handleLogout} aria-label="logout">
            <img src="/out.svg" alt="로그아웃" />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Welcome to Engorish!</h1>

        <section className={styles.noticeCard}>
          <div className={styles.noticeTitle}>📌 업데이트 사항 (20260313 00:20)</div>
          <ul className={styles.noticeList}>
            <li>3일간의 체험에 참여해주신 모든 분들께 진심으로 감사의 인사를 전합니다.</li>
            <li>아울러 체험 후기 설문조사와 기프티콘 추첨 이벤트를 진행합니다!</li>
            <li>가입하신 이메일로 설문조사 폼을 보내드렸으니 확인을 부탁드립니다</li>
            <li>혹여나 메일이 도착하지 않으신 분은 rlatpgmlid@naver.com으로 문의 바랍니다</li>
          </ul>
        </section>

        <section className={styles.heroCard}>
          <div className={styles.heroText}>100여개의 시나리오로 대비하는 실전 회화!</div>

          <div className={styles.heroImageWrap}>
            <img
              className={styles.heroImage}
              src="/home_banner.png"
              alt="영어 회화 학습 일러스트"
            />
          </div>

          <button type="button" className={styles.startButton} onClick={handleStart}>
            지금 시작하기
          </button>
        </section>
      </main>
    </div>
  );
}