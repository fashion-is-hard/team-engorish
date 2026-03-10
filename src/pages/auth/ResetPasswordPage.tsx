import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./ResetPasswordPage.module.css";

export default function ResetPasswordPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  const emailError = useMemo(() => {
    if (!touched) return "";
    const v = email.trim();
    if (!v) return "이메일을 입력해 주세요";
    if (!/^\S+@\S+\.\S+$/.test(v)) return "이메일을 올바르게 입력해 주세요";
    return "";
  }, [email, touched]);

  const canSubmit = useMemo(() => {
    return !!email.trim() && !emailError && !loading;
  }, [email, emailError, loading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setFormError(null);

    if (!canSubmit) return;

    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });

      if (error) {
        setFormError(error.message || "재설정 링크 전송에 실패했습니다.");
        return;
      }

      setSuccessOpen(true);
    } catch (error) {
      console.error(error);
      setFormError("재설정 링크 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      {successOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalTitle}>재설정 링크를 보내드렸습니다</div>
            <div className={styles.modalText}>
              메일함에서 'Supabase Auth'로 부터 온 메일을 확인해주세요.
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
              className={`${styles.input} ${emailError ? styles.inputError : ""}`}
              placeholder="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              autoComplete="email"
              inputMode="email"
            />
            {emailError ? <div className={styles.helperError}>{emailError}</div> : null}
          </div>

          {formError ? <div className={styles.formError}>{formError}</div> : null}

          <button
            className={`${styles.button} ${
              canSubmit ? styles.buttonActive : styles.buttonDisabled
            }`}
            disabled={!canSubmit}
            type="submit"
          >
            {loading ? "전송 중..." : "재설정 링크 보내기"}
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