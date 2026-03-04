import { useParams } from "react-router-dom";

export default function SessionPage() {

  const { id } = useParams();

  return (
    <div style={{ padding: 40 }}>
      <h1>Session</h1>
      <p>Scenario: {id}</p>

      <button>Start Mic</button>
    </div>
  );
}