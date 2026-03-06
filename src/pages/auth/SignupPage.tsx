import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./SignupPage.module.css";
import { supabase } from "@/lib/supabaseClient";

type FieldKey = "email" | "password" | "gender" | "age" | "stage" | "agree";

const SIGNUP_PROFILE_STORAGE_KEY = "signup_profile_pending";

export default function SignupPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [stage, setStage] = useState("");

  const [agree, setAgree] = useState(false);

  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    email: false,
    password: false,
    gender: false,
    age: false,
    stage: false,
    agree: false,
  });

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const emailError = useMemo(() => {
    if (!touched.email) return "";
    const v = email.trim();
    if (!v) return "이메일을 입력해 주세요";
    if (!/^\S+@\S+\.\S+$/.test(v)) return "이메일을 올바르게 입력해 주세요";
    return "";
  }, [email, touched.email]);

  const passwordError = useMemo(() => {
    if (!touched.password) return "";
    if (!password) return "비밀번호를 입력해 주세요";
    if (password.length < 6) return "비밀번호는 6자 이상으로 입력해 주세요";
    return "";
  }, [password, touched.password]);

  const genderError = useMemo(() => {
    if (!touched.gender) return "";
    if (!gender) return "성별을 선택해 주세요";
    return "";
  }, [gender, touched.gender]);

  const ageError = useMemo(() => {
    if (!touched.age) return "";
    if (!age) return "연령대를 선택해 주세요";
    return "";
  }, [age, touched.age]);

  const stageError = useMemo(() => {
    if (!touched.stage) return "";
    if (!stage) return "교환 단계(상태)를 선택해 주세요";
    return "";
  }, [stage, touched.stage]);

  const agreeError = useMemo(() => {
    if (!touched.agree) return "";
    if (!agree) return "개인정보 수집 동의가 필요합니다";
    return "";
  }, [agree, touched.agree]);

  const canSubmit = useMemo(() => {
    const ok =
      email.trim() &&
      password &&
      gender &&
      age &&
      stage &&
      agree &&
      !emailError &&
      !passwordError &&
      !genderError &&
      !ageError &&
      !stageError &&
      !agreeError &&
      !loading;

    return !!ok;
  }, [
    email,
    password,
    gender,
    age,
    stage,
    agree,
    emailError,
    passwordError,
    genderError,
    ageError,
    stageError,
    agreeError,
    loading,
  ]);

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    setTouched({
      email: true,
      password: true,
      gender: true,
      age: true,
      stage: true,
      agree: true,
    });

    if (!canSubmit) return;

    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const displayNameCandidate = normalizedEmail.split("@")[0] || normalizedEmail;

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });

      if (error || !data.user) {
        setFormError(error?.message ?? "회원가입에 실패했습니다.");
        return;
      }

      // 로그인 직후 profiles 업데이트에 사용할 임시 정보 저장
      localStorage.setItem(
        SIGNUP_PROFILE_STORAGE_KEY,
        JSON.stringify({
          email: normalizedEmail,
          display_name_candidate: displayNameCandidate,
          gender,
          age_range: age,
          exchange_stage: stage,
          saved_at: Date.now(),
        })
      );

      alert("회원가입이 완료되었습니다. 로그인 후 정보가 최종 저장됩니다.");
      navigate("/auth/login", { replace: true });
    } catch (err) {
      console.error(err);
      setFormError("회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} type="button" onClick={() => navigate(-1)}>
          <img className={styles.backIcon} src="/back.svg" alt="뒤로가기" />
        </button>
      </div>

      <div className={styles.content}>
        <h2 className={styles.title}>회원가입</h2>

        <form className={styles.form} onSubmit={handleSignup}>
          <div className={styles.field}>
            <input
              className={`${styles.input} ${emailError ? styles.inputError : ""}`}
              placeholder="E-mail"
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
              autoComplete="new-password"
            />
            {passwordError ? (
              <div className={styles.helperError}>{passwordError}</div>
            ) : null}
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <select
                className={`${styles.select} ${genderError ? styles.inputError : ""}`}
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, gender: true }))}
              >
                <option value="">성별</option>
                <option value="남성">남성</option>
                <option value="여성">여성</option>
              </select>
              {genderError ? <div className={styles.helperError}>{genderError}</div> : null}
            </div>

            <div className={styles.field}>
              <select
                className={`${styles.select} ${ageError ? styles.inputError : ""}`}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, age: true }))}
              >
                <option value="">연령대</option>
                <option value="만18-만20">만18-만20</option>
                <option value="만21-만23">만21-만23</option>
                <option value="만24-만26">만24-만26</option>
                <option value="만27-만29">만27-만29</option>
                <option value="만30 이상">만30 이상</option>
              </select>
              {ageError ? <div className={styles.helperError}>{ageError}</div> : null}
            </div>
          </div>

          <div className={styles.field}>
            <select
              className={`${styles.selectFull} ${stageError ? styles.inputError : ""}`}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, stage: true }))}
            >
              <option value="">현재 교환학생 단계 중 어디인가요?</option>
              <option value="교환국으로 출국을 준비하고 있어요">
                교환국으로 출국을 준비하고 있어요
              </option>
              <option value="교환국에서 생활중이에요">교환국에서 생활중이에요</option>
              <option value="교환 생활을 마치고 돌아왔어요">교환 생활을 마치고 돌아왔어요</option>
            </select>
            {stageError ? <div className={styles.helperError}>{stageError}</div> : null}
          </div>

          <label className={styles.agree}>
            <input
              className={styles.checkbox}
              type="checkbox"
              checked={agree}
              onChange={() => setAgree((v) => !v)}
              onBlur={() => setTouched((p) => ({ ...p, agree: true }))}
            />

            <span className={styles.agreeText}>
              [필수] 개인정보 수집에 동의합니다.
              <button
                type="button"
                className={styles.policy}
                onClick={() => navigate("/privacy")}
              >
                개인정보 처리방침
              </button>
            </span>
          </label>
          {agreeError ? <div className={styles.helperError}>{agreeError}</div> : null}

          {formError ? <div className={styles.formError}>{formError}</div> : null}

          <button
            className={`${styles.button} ${
              canSubmit ? styles.buttonActive : styles.buttonDisabled
            }`}
            disabled={!canSubmit}
            type="submit"
          >
            {loading ? "가입 중..." : "회원가입"}
          </button>
        </form>
      </div>
    </div>
  );
}