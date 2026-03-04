import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";

export default function ScenarioListPage() {

  const [scenarios, setScenarios] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from("scenarios")
      .select("*");

    if (data) setScenarios(data);
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Scenarios</h1>

      {scenarios.map((s) => (
        <div key={s.scenario_id}>
          <button
            onClick={() => navigate(`/session/${s.scenario_id}`)}
          >
            {s.title}
          </button>
        </div>
      ))}
    </div>
  );
}