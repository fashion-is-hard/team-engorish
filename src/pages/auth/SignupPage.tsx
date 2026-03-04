import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./SignupPage.module.css";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage(){

  const navigate = useNavigate();

  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");

  const [gender,setGender] = useState("");
  const [age,setAge] = useState("");
  const [stage,setStage] = useState("");

  const [agree,setAgree] = useState(false);

  async function handleSignup(e:React.FormEvent){

  e.preventDefault();

  if(!agree){
    alert("개인정보 동의가 필요합니다.");
    return;
  }

  const { data, error } = await supabase.auth.signUp({

    email: email,
    password: password

  });

  if(error){

    alert(error.message);
    return;

  }

  const userId = data.user?.id;

  if(userId){

    await supabase
      .from("profiles")
      .insert({

        id: userId,
        email: email,
        gender: gender,
        age_range: age,
        exchange_stage: stage

      });

  }

  alert("회원가입 완료");

  navigate("/login");

}

  return(

    <div className={styles.container}>

      <div className={styles.header}>

        <button
          className={styles.back}
          onClick={()=>navigate(-1)}
        >
          ←
        </button>

        <h2>회원가입</h2>

      </div>

      <form className={styles.form} onSubmit={handleSignup}>

        <input
          className={styles.input}
          placeholder="E-mail"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
        />

        <input
          className={styles.input}
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
        />

        <div className={styles.row}>

          <select
            className={styles.select}
            value={gender}
            onChange={(e)=>setGender(e.target.value)}
          >
            <option value="">성별</option>
            <option>남성</option>
            <option>여성</option>
          </select>

          <select
            className={styles.select}
            value={age}
            onChange={(e)=>setAge(e.target.value)}
          >
            <option value="">연령대</option>
            <option>18-20</option>
            <option>21-23</option>
            <option>24-26</option>
            <option>27+</option>
          </select>

        </div>

        <select
          className={styles.selectFull}
          value={stage}
          onChange={(e)=>setStage(e.target.value)}
        >
          <option value="">
            현재 교환학생 단계 중 어디인가요?
          </option>
          <option>출국 준비</option>
          <option>현지 적응</option>
          <option>수업 진행</option>
          <option>귀국 준비</option>
        </select>

        <label className={styles.agree}>

          <input
            type="checkbox"
            checked={agree}
            onChange={()=>setAgree(!agree)}
          />

          <span>
            [필수] 개인정보 수집에 동의합니다.
            <button
              type="button"
              className={styles.policy}
               onClick={()=>navigate("/privacy")}
            >
              개인정보 처리방침
            </button>
          </span>

        </label>

        <button className={styles.button}>
          회원가입
        </button>

      </form>

    </div>

  );
}