import { useSearchParams, useNavigate } from "react-router-dom";

export default function LandingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const variant = params.get("variant");

  function start() {
    if (variant === "A") {
      navigate("/scenarios?variant=A");
    } else {
      navigate("/scenarios?variant=B");
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Engorish</h1>

      <p>Variant: {variant}</p>

      <button onClick={start}>
        Start Practice
      </button>
    </div>
  );
}