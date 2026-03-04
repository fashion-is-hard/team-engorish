import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function BootPage() {
  const navigate = useNavigate();

  useEffect(() => {
    init();
  }, []);

  async function init() {
    try {
      const { data } = await supabase.auth.getSession();

      const session = data.session;

      if (!session) {
        navigate("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (!profile) {
        navigate("/login");
        return;
      }

      navigate("/landing");
    } catch (e) {
      console.error(e);
      navigate("/login");
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
      }}
    >
      Loading...
    </div>
  );
}