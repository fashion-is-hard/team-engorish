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
  const [policyOpen, setPolicyOpen] = useState(false);

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

      localStorage.setItem(
        SIGNUP_PROFILE_STORAGE_KEY,
        JSON.stringify({
          email: normalizedEmail,
          display_name_candidate: displayNameCandidate,
          gender,
          age_group: age,
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
      {policyOpen && (
        <div className={styles.modalOverlay} onClick={() => setPolicyOpen(false)}>
          <div
            className={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="개인정보 처리방침"
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>개인정보 처리방침</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setPolicyOpen(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <p>1. 수집하는 개인정보 항목</p>
              <p>[필수]</p>
              <p>이메일, 성별, 연령대, 교환학생 단계</p>
              <p>[서비스 이용 과정에서 자동 수집]</p>
              <p>대화 전사 텍스트, 발화량 및 플레이 진행기록, 접속 기록 및 서비스 이용 로그</p>
              <p>*음성녹음 파일은 저장하지 않습니다</p>
              <p>2. 개인정보 이용 목적</p>
              <p>AI 대화 기능 제공, 발화량 측정 및 세션 진행 관리, 대화 분석 리포트 생성, 서비스 개선 및 실험결과 분석, 오류 확인 및 보안 유지</p>
              <p>* 마케팅, 광고, 상업적 판매 목적으로 사용하지 않습니다.</p>
              <p>3. 보유 및 이용 기간</p>
              <p>개인정보는 실험 종료 시점 부터 1개월 이내 파기합니다.</p>
              <p>이용자가 삭제를 요청할 경우 즉시 삭제 가능합니다.</p>
              <p>4. 제3자 처리 및 외부 서비스 이용</p>
              <p>서비스 운영을 위해 다음 외부 서비스를 사용합니다.</p>
              <p>[Supabase, OpenAI API]</p>
              <p>위 서비스는 단순 기술적 처리 목적이며 개인정보를 판매하거나 제3자에게 제공하지 않습니다.</p>
              <p>5. 참여자의 권리 및 내부 열람 제한</p>
              <p>참여자는 언제든지 열람, 수정, 삭제를 요청할 수 있습니다.</p>
              <p>참여자의 발화 기록 및 개인 분석 데이터는 앱 기능 작동을 위해 데이터베이스에 임시 저장되지만 운영팀원이 이를 임의로 열람하지 않습니다.</p>
              <p>데이터 접근 권한은 최소한으로 제한되며 연구 목적 범위 내에서만 사용됩니다.</p>
              <p>문의: rlatpgmlid@naver.com</p>
              <p>시행일: 2026년 3월 10일</p>
            </div>

            <button
              type="button"
              className={styles.modalConfirm}
              onClick={() => setPolicyOpen(false)}
            >
              확인
            </button>
          </div>
        </div>
      )}

      <header className={styles.header}>
        <h1 className={styles.brand}>Engorish</h1>
      </header>

      <main className={styles.content}>
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
            {passwordError ? <div className={styles.helperError}>{passwordError}</div> : null}
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
                <option value="만20세 이하">만20세 이하</option>
                <option value="만21-23세">만21-23세</option>
                <option value="만24-25세">만24-25세</option>
                <option value="만26-29세">만26-29세</option>
                <option value="만30세 이상">만30세 이상</option>
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
              <option value="교환국에서 체류 중이에요">교환국에서 체류 중이에요</option>
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
                onClick={() => setPolicyOpen(true)}
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
            {loading ? "가입 중..." : "가입하기"}
          </button>
        </form>

        <div className={styles.loginRow}>
          <span className={styles.loginText}>이미 계정이 있으신가요?</span>
          <button
            className={styles.loginLink}
            type="button"
            onClick={() => navigate("/auth/login")}
          >
            로그인 하러가기
          </button>
        </div>
      </main>
    </div>
  );
}