import { useNavigate } from "react-router-dom";
import styles from "./CategoryPage.module.css";

const packages = [1,2,3,4];

export default function CategoryPage(){

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

        <h1>학습영역</h1>

      </div>


      {/* TITLE */}

      <h2 className={styles.sectionTitle}>
        캠퍼스 영어
      </h2>


      {/* FILTER */}

      <div className={styles.tabs}>

        <button className={`${styles.tab} ${styles.active}`}>
          학교
        </button>

        <button className={styles.tab}>
          일상
        </button>

        <button className={styles.tab}>
          공공기관
        </button>

        <button className={styles.tab}>
          행정시설
        </button>

      </div>


      {/* GRID */}

      <div className={styles.grid}>

        {packages.map((p)=>(
          
          <div
            key={p}
            className={styles.card}
            onClick={()=>navigate("/package")}
          >

            <img
              src="/package.png"
              className={styles.image}
            />

            <span className={styles.badge}>
              시작 전
            </span>

            <p className={styles.name}>
              패키지 이름
            </p>

          </div>

        ))}

      </div>

    </div>

  );
}