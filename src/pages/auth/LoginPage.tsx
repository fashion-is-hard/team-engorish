import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./LoginPage.module.css";
import { supabase } from "@/lib/supabaseClient";

type AbVariantDB = "A" | "B";
type VariantPath = "a" | "b";

type PendingSignupProfile = {
  email?: string;
  display_name_candidate?: string;
  gender?: string;
  age_group?: string;
  exchange_stage?: string;
  saved_at?: number;
};

const SIGNUP_PROFILE_STORAGE_KEY = "signup_profile_pending";

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

function readPendingSignupProfile(): PendingSignupProfile | null {
  try {
    const raw = localStorage.getItem(SIGNUP_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingSignupProfile;
  } catch (error) {
    console.error("pending signup profile parse error:", error);
    return null;
  }
}

async function applyPendingSignupProfile(userId: string, userEmail?: string | null) {
  const pending = readPendingSignupProfile();
  console.log("pending profile:", pending);

  if (!pending) return;

  const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();
  const normalizedPendingEmail = (pending.email ?? "").trim().toLowerCase();

  if (!normalizedUserEmail || !normalizedPendingEmail) {
    throw new Error("이메일 정보가 비어 있습니다.");
  }

  if (normalizedUserEmail !== normalizedPendingEmail) {
    throw new Error("회원가입 이메일과 로그인 이메일이 일치하지 않습니다.");
  }

  const displayName =
    pending.display_name_candidate ||
    normalizedUserEmail.split("@")[0] ||
    normalizedUserEmail;

  const payload = {
    display_name: displayName,
    gender: pending.gender ?? null,
    age_group: pending.age_group ?? null,
    exchange_stage: pending.exchange_stage ?? null,
  };

  const result = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select();

  if (result.error) {
    throw new Error(
      `[profiles update] code=${result.error.code} message=${result.error.message} details=${result.error.details ?? ""} hint=${result.error.hint ?? ""}`
    );
  }

  if (!result.data || result.data.length === 0) {
    throw new Error("profiles row를 찾지 못했거나 update 결과가 0건입니다.");
  }

  localStorage.removeItem(SIGNUP_PROFILE_STORAGE_KEY);
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
    if (!email.trim()) return "이메일을 바르게 입력해주세요";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "이메일을 바르게 입력해주세요";
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

    setTouched({ email: true, password: true });

    if (!email.trim() || !password) return;
    if (emailError || passwordError) return;

    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error || !data.user) {
        setFormError("로그인 정보를 올바르게 입력해주세요.");
        return;
      }

      try {
        await applyPendingSignupProfile(data.user.id, data.user.email);
      } catch (profileError) {
        console.error("profiles update after login error:", profileError);
        setFormError("문제가 발생했습니다. 다시 로그인해 주세요.");
        return;
      }

      let variantPath: VariantPath = "a";
      try {
        variantPath = await fetchVariantPath(data.user.id);
      } catch (variantError) {
        console.error("fetchVariantPath error:", variantError);
        variantPath = "a";
      }

      navigate(`/${variantPath}/home`, { replace: true });
    } catch (error) {
      console.error(error);
      setFormError("로그인 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.brand}>Engorish</h1>
      </header>

      <main className={styles.content}>
        <h2 className={styles.title}>Log in Engorish</h2>

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
            {passwordError ? <div className={styles.helperError}>{passwordError}</div> : null}
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

        <div className={styles.linkGroup}>
          <div className={styles.signup}>
            <span className={styles.signupText}>잉고리쉬가 처음이신가요?</span>
            <button
              className={styles.signupBtn}
              type="button"
              onClick={() => navigate("/auth/signup")}
            >
              회원가입
            </button>
          </div>

          <div className={styles.demoAccount}>
            <div className={styles.demoText}>
              빠른 이용을 원하시면 아래 계정으로 로그인 해주세요!
            </div>

            <div className={styles.demoCredential}>
              <div>ID: prototype@eng.com</div>
              <div>PW: engorish</div>
            </div>
          </div>
                  

          
        </div>
      </main>
    </div>
  );
}