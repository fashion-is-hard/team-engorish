import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./LoginPage.module.css";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {

  const navigate = useNavigate();

  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");

  async function handleLogin(e:React.FormEvent){

  e.preventDefault();

  const { data, error } = await supabase.auth.signInWithPassword({

    email: email,
    password: password

  });

  if(error){

    alert(error.message);
    return;

  }

  if(data.user){

    navigate("/home");

  }

}

  return (

    <div className={styles.container}>

      <div className={styles.content}>

        <h1 className={styles.title}>
          Log in Engorish
        </h1>

        <form className={styles.form} onSubmit={handleLogin}>

          <input
            className={styles.input}
            placeholder="E-mail"
            type="email"
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

          <button className={styles.button}>
            로그인
          </button>

        </form>

        <div className={styles.signup}>

          <p>잉고리쉬가 처음이신가요?</p>

          <button
            className={styles.signupBtn}
            onClick={()=>navigate("/signup")}
          >
            회원가입
          </button>

        </div>

      </div>

    </div>

  );
}