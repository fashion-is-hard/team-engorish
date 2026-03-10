import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./UpdatePasswordPage.module.css";

export default function UpdatePasswordPage() {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const [touched, setTouched] = useState({
    password: false,
    passwordConfirm: false,
  });

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  const passwordError = useMemo(() => {
    if (!touched.password) return "";
    if (!password) return "새 비밀번호를 입력해 주세요";
    if (password.length < 6) return "비밀번호는 6자 이상으로 입력해 주세요";
    return "";
  }, [password, touched.password]);

  const passwordConfirmError = useMemo(() => {
    if (!touched.passwordConfirm) return "";
    if (!passwordConfirm) return "비밀번호 확인을 입력해 주세요";
    if (password !== passwordConfirm) return "비밀번호가 일치하지 않습니다";
    return "";
  }, [password, passwordConfirm, touched.passwordConfirm]);

  const canSubmit = useMemo(() => {
    return (
      password.length > 0 &&
      passwordConfirm.length > 0 &&
      !passwordError &&
      !passwordConfirmError &&
      !loading
    );
  }, [password, passwordConfirm, passwordError, passwordConfirmError, loading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    setTouched({
      password: true,
      passwordConfirm: true,
    });

    if (!canSubmit) return;

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setFormError(error.message || "비밀번호 변경에 실패했습니다.");
        return;
      }

      setSuccessOpen(true);
    } catch (error) {
      console.error(error);
      setFormError("비밀번호 변경에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      {successOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalTitle}>비밀번호가 변경되었습니다</div>
            <div className={styles.modalText}>
              새 비밀번호로 다시 로그인해주세요.
            </div>

            <button
              type="button"
              className={styles.modalButton}
              onClick={() => navigate("/auth/login", { replace: true })}
            >
              로그인 화면 가기
            </button>
          </div>
        </div>
      )}

      <header className={styles.header}>
        <h1 className={styles.brand}>Engorish</h1>
      </header>

      <main className={styles.content}>
        <h2 className={styles.title}>비밀번호 재설정</h2>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <input
              className={`${styles.input} ${passwordError ? styles.inputError : ""}`}
              placeholder="새 비밀번호"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, password: true }))}
              autoComplete="new-password"
            />
            {passwordError ? <div className={styles.helperError}>{passwordError}</div> : null}
          </div>

          <div className={styles.field}>
            <input
              className={`${styles.input} ${passwordConfirmError ? styles.inputError : ""}`}
              placeholder="새 비밀번호 확인"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, passwordConfirm: true }))}
              autoComplete="new-password"
            />
            {passwordConfirmError ? (
              <div className={styles.helperError}>{passwordConfirmError}</div>
            ) : null}
          </div>

          {formError ? <div className={styles.formError}>{formError}</div> : null}

          <button
            className={`${styles.button} ${
              canSubmit ? styles.buttonActive : styles.buttonDisabled
            }`}
            disabled={!canSubmit}
            type="submit"
          >
            {loading ? "변경 중..." : "비밀번호 변경하기"}
          </button>
        </form>

        <button
          className={styles.loginLink}
          type="button"
          onClick={() => navigate("/auth/login")}
        >
          로그인 하러가기
        </button>
      </main>
    </div>
  );
}