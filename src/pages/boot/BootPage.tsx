import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./BootPage.module.css";

type AbVariantDB = "A" | "B";
type VariantPath = "a" | "b";

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

export default function BootPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // 1) 세션 확인
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      const session = data.session;

      // ✅ 로그인 이력 없으면 로그인 페이지로
      if (!session) {
        navigate("/auth/login", { replace: true });
        return;
      }

      // 2) 로그인 이력 있으면 AB 읽어서 해당 variant 홈으로
      try {
        const variantPath = await fetchVariantPath(session.user.id);
        if (cancelled) return;
        navigate(`/${variantPath}/home`, { replace: true });
      } catch (e) {
        // profiles가 아직 생성 안 된 타이밍/네트워크 이슈 대비
        console.error(e);
        if (!cancelled) navigate("/auth/login", { replace: true });
      }
    };

    // 로고 잠깐 보여주고 이동(원치 않으면 0으로)
    const t = setTimeout(run, 1800);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [navigate]);

  return (
    <div className={styles.container}>
      <div className={styles.logo}>Engorish</div>
    </div>
  );
}