import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./BootPage.module.css";

export default function BootPage() {

  const navigate = useNavigate();

  useEffect(() => {

    const timer = setTimeout(() => {

      const session = localStorage.getItem("session");

      if(session){
        navigate("/home");
      }else{
        navigate("/login");
      }

    },2000);

    return () => clearTimeout(timer);

  },[]);

  return (
    <div className={styles.container}>
      <div className={styles.logo}>
        Engorish
      </div>
    </div>
  );
}