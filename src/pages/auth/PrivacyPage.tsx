import { useNavigate } from "react-router-dom";
import styles from "./PrivacyPage.module.css";

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.container}>
      {/* SignupPage와 동일한 톤의 상단바 */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} type="button" onClick={() => navigate(-1)}>
          {/* 아이콘은 /icons/ 없이 루트에 svg로 저장되어 있다고 했으니 */}
          <img className={styles.backIcon} src="/back.svg" alt="뒤로가기" />
        </button>
      </div>

      <div className={styles.content}>
        <h1 className={styles.h1}>개인정보 처리방침</h1>

        <section className={styles.section}>
          <h2 className={styles.h2}>1. 수집하는 개인정보 항목</h2>

          <p className={styles.label}>[필수]</p>
          <ul className={styles.ul}>
            <li>이메일</li>
            <li>성별</li>
            <li>연령대</li>
            <li>교환학생 단계</li>
          </ul>

          <p className={styles.label}>[서비스 이용 과정에서 자동 생성 및 수집]</p>
          <ul className={styles.ul}>
            <li>대화 전사 텍스트</li>
            <li>발화량 및 플레이 진행 기록</li>
            <li>접속 기록 및 서비스 이용 로그</li>
          </ul>

          <p className={styles.note}>(음성 녹음 파일은 저장하지 않습니다.)</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>2. 개인정보 이용 목적</h2>

          <ul className={styles.ul}>
            <li>AI 대화 기능 제공</li>
            <li>발화량 측정 및 세션 진행 관리</li>
            <li>대화 분석 리포트 생성</li>
            <li>서비스 개선 및 실험결과 분석</li>
            <li>오류 확인 및 보안 유지</li>
          </ul>

          <p className={styles.note}>(마케팅, 광고, 상업적 판매 목적으로 사용하지 않습니다.)</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>3. 보유 및 이용 기간</h2>

          <ul className={styles.ul}>
            <li>개인정보는 실험 종료시 부터 1개월 이내 파기합니다.</li>
            <li>이용자가 삭제를 요청할 경우 즉시 삭제 가능합니다.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>4. 제3자 처리 및 외부 서비스 이용</h2>

          <p className={styles.p}>서비스 운영을 위해 다음 외부 서비스를 사용합니다.</p>

          <ul className={styles.ul}>
            <li>Supabase</li>
            <li>OpenAI API</li>
          </ul>

          <p className={styles.p}>
            위 서비스는 단순 기술적 처리 목적이며 개인정보를 판매하거나 제3자에게 제공하지 않습니다.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>5. 참여자의 권리 및 내부 열람 제한</h2>

          <ul className={styles.ul}>
            <li>참여자는 언제든지 열람, 수정, 삭제를 요청할 수 있습니다.</li>
            <li>
              참여자의 발화 기록 및 개인 분석 데이터는 앱 기능 작동을 위해 데이터베이스에 임시 저장되지만
              운영팀원이 이를 임의로 열람하지 않습니다.
            </li>
            <li>데이터 접근 권한은 최소한으로 제한되며 연구 목적 범위 내에서만 사용됩니다.</li>
          </ul>
        </section>

        <div className={styles.footer}>
          <p>문의: rlatpgmlid@naver.com</p>
          <p>시행일: 2026년 3월 5일</p>
        </div>
      </div>
    </div>
  );
}