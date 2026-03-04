import { useParams } from "react-router-dom";

export default function ScenarioDetailPage() {

  const { id } = useParams();

  return (
    <div style={{ padding: 40 }}>
      <h1>Scenario Detail</h1>
      <p>ID: {id}</p>
    </div>
  );
}