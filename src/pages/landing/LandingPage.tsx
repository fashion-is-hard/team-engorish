import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: 40 }}>
      <h1>Landing</h1>

      <button onClick={() => navigate("/scenarios")}>
        Start Practice
      </button>
    </div>
  );
}