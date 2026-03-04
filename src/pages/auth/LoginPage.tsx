import { supabase } from "@/lib/supabase";

export default function LoginPage() {

  async function login() {
    await supabase.auth.signInWithOtp({
      email: "test@test.com"
    });
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Login</h1>
      <button onClick={login}>Login</button>
    </div>
  );
}