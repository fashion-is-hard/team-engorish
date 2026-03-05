import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "./NotFoundPage.module.css";

function detectVariant(pathname: string): "a" | "b" {
  // /a/... or /b/... 형태면 그대로 유지, 아니면 a로 기본
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg === "b" ? "b" : "a";
}

export default function NotFoundPage() {
  const nav = useNavigate();
  const loc = useLocation();

  const variant = useMemo(() => detectVariant(loc.pathname), [loc.pathname]);

  function goHome() {
    nav(`/${variant}/home`, { replace: true });
  }
  function goLogin() {
    nav(`/${variant}/auth/login`, { replace: true });
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.badge}>404</div>

        <h1 className={styles.title}>페이지를 찾을 수 없어요</h1>
        <p className={styles.desc}>
          문제가 지속되면 rlatpgmlid@naver.com 으로 문의해주세요.
        </p>


        <div className={styles.meta}>
          <span className={styles.metaLabel}>요청 경로</span>
          <span className={styles.metaValue}>{loc.pathname}</span>
        </div>
      </div>
    </div>
  );
}