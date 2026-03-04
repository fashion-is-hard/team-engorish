import { useParams } from "react-router-dom";

export default function ResultPage() {

  const { id } = useParams();

  return (
    <div style={{ padding: 40 }}>
      <h1>Result</h1>
      <p>Session ID: {id}</p>
    </div>
  );
}