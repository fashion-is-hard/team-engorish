import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./HomePage.module.css";

export default function HomePage(){

  const navigate = useNavigate();

  async function handleLogout(){

    await supabase.auth.signOut();

    navigate("/login");

  }

  return(

    <div className={styles.container}>

      {/* HEADER */}

      <div className={styles.header}>

        <h1 className={styles.logo}>
          Engorish
        </h1>

        <div className={styles.icons}>

          <button className={styles.icon}>
            📄
          </button>

          <button
            className={styles.icon}
            onClick={handleLogout}
          >
            ↗
          </button>

        </div>

      </div>


      {/* MAIN */}

      <div className={styles.main}>

        <div className={styles.card}>

          <p className={styles.title}>
            다양한 시나리오로 대비하는 영어회화
          </p>

          <img
            src="/illustration.png"
            className={styles.image}
          />

          <button
            className={styles.startBtn}
            onClick={()=>navigate("/category")}
          >
            지금 시작하기
          </button>

        </div>

      </div>

    </div>

  );

}