import { useNavigate } from "react-router-dom";
import styles from "./PackagePage.module.css";

const scenarios = [
  { id: 1, title: "시나리오명", desc: "시나리오 설명" },
  { id: 2, title: "시나리오명", desc: "시나리오 설명" },
  { id: 3, title: "시나리오명", desc: "시나리오 설명" }
];

export default function PackagePage(){

  const navigate = useNavigate();

  return(

    <div className={styles.container}>

      {/* HEADER */}

      <div className={styles.header}>

        <button
          className={styles.back}
          onClick={()=>navigate(-1)}
        >
          ←
        </button>

        <h1>패키지 이름</h1>

      </div>


      {/* SCENARIO LIST */}

      <div className={styles.list}>

        {scenarios.map((s,index)=>(

          <div key={s.id} className={styles.row}>

            <div className={styles.number}>
              {index+1}
            </div>

            <div className={styles.card}>

              <img
                src="/scenario.png"
                className={styles.image}
              />

              <div>

                <p className={styles.title}>
                  {s.title}
                </p>

                <p className={styles.desc}>
                  {s.desc}
                </p>

              </div>

            </div>

          </div>

        ))}

      </div>


      {/* START BUTTON */}

      <button
        className={styles.start}
        onClick={()=>navigate("/scenario")}
      >
        시작하기
      </button>

    </div>

  );

}