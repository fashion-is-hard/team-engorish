import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./LoginPage.module.css";
import { supabase } from "@/lib/supabaseClient";

type AbVariantDB = "A" | "B";
type VariantPath = "a" | "b";

function toVariantPath(v: AbVariantDB | null | undefined): VariantPath {
  return v === "B" ? "b" : "a";
}

async function fetchVariantPath(userId: string): Promise<VariantPath> {
  const { data, error } = await supabase
    .from("profiles")
    .select("ab_variant")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return toVariantPath(data?.ab_variant as AbVariantDB | null);
}

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const emailError = useMemo(() => {
    if (!touched.email) return "";
    if (!email.trim()) return "ID를 바르게 입력해주세요";
    // 아주 느슨한 이메일 체크 (필요하면 더 엄격하게)
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "ID를 바르게 입력해주세요";
    return "";
  }, [email, touched.email]);

  const passwordError = useMemo(() => {
    if (!touched.password) return "";
    if (!password) return "비밀번호를 바르게 입력해주세요";
    return "";
  }, [password, touched.password]);

  const canSubmit = useMemo(() => {
    return (
      email.trim().length > 0 &&
      password.length > 0 &&
      !emailError &&
      !passwordError &&
      !loading
    );
  }, [email, password, emailError, passwordError, loading]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    // 제출 시 에러 표시 강제
    setTouched({ email: true, password: true });

    if (!email.trim() || !password) return;
    if (emailError || passwordError) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        setFormError("로그인 정보를 올바르게 입력해주세요.");
        return;
      }

      // ✅ 로그인 성공 → profiles.ab_variant 읽고 A/B 홈으로
      let variantPath: VariantPath = "a";
      try {
        variantPath = await fetchVariantPath(data.user.id);
      } catch {
        // profiles 생성 타이밍 이슈 등 대비: 기본 A
        variantPath = "a";
      }

      navigate(`/${variantPath}/home`, { replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Log in Engorish</h1>

        <form className={styles.form} onSubmit={handleLogin}>
          <div className={styles.field}>
            <input
              className={`${styles.input} ${emailError ? styles.inputError : ""}`}
              placeholder="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, email: true }))}
              autoComplete="email"
              inputMode="email"
            />
            {emailError ? <div className={styles.helperError}>{emailError}</div> : null}
          </div>

          <div className={styles.field}>
            <input
              className={`${styles.input} ${passwordError ? styles.inputError : ""}`}
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, password: true }))}
              autoComplete="current-password"
            />
            {passwordError ? (
              <div className={styles.helperError}>{passwordError}</div>
            ) : null}
          </div>

          {formError ? <div className={styles.formError}>{formError}</div> : null}

          <button
            className={`${styles.button} ${canSubmit ? styles.buttonActive : styles.buttonDisabled}`}
            disabled={!canSubmit}
            type="submit"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div className={styles.signup}>
          <p>잉고리쉬가 처음이신가요?</p>
          <button
            className={styles.signupBtn}
            type="button"
            onClick={() => navigate("/auth/signup")}
          >
            회원가입
          </button>
        </div>
      </div>
    </div>
  );
}