// src/services/progress.ts
import { supabase } from "@/lib/supabaseClient";

type ScenarioLite = {
  scenario_id: string;
  package_id: string;
  sort_order: number | null;
  created_at?: string | null;
};

type SessionLite = {
  scenario_id: string | null;
  package_id: string | null;
  variant: string | null;
  status: string | null;
  end_reason: string | null;
};

type PackageProgress = {
  currentIndex: number;   // 다음으로 플레이해야 할 시나리오 index
  isClear: boolean;       // 패키지 전체 클리어 여부
  clearedCount: number;   // 성공한 시나리오 수
  totalCount: number;     // 전체 시나리오 수
};

type FetchUserProgressResult = {
  packageProgressMap: Record<string, PackageProgress>;
};

function normalizeVariant(v: unknown): "a" | "b" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "b" ? "b" : "a";
}

function isSuccessfulSession(s: SessionLite) {
  const variant = normalizeVariant(s.variant);
  if (variant === "b") return s.status === "ended" && s.end_reason === "goals_done";
  return s.status === "ended" && s.end_reason === "turn_limit";
}

export async function fetchUserProgress(): Promise<FetchUserProgressResult> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth.user) {
    return { packageProgressMap: {} };
  }

  const userId = auth.user.id;

  // 1) 전체 활성 시나리오 불러오기
  const { data: scenarioData, error: scenarioErr } = await supabase
    .from("scenarios")
    .select("scenario_id,package_id,sort_order,created_at")
    .eq("is_active", true)
    .order("package_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (scenarioErr) throw new Error(scenarioErr.message);

  const scenarios = (scenarioData ?? []) as ScenarioLite[];

  // package별 시나리오 목록
  const scenariosByPackage = new Map<string, ScenarioLite[]>();
  for (const sc of scenarios) {
    if (!sc.package_id) continue;
    const arr = scenariosByPackage.get(sc.package_id) ?? [];
    arr.push(sc);
    scenariosByPackage.set(sc.package_id, arr);
  }

  // 2) 유저 세션 불러오기
  const { data: sessionData, error: sessionErr } = await supabase
    .from("roleplay_sessions")
    .select("scenario_id,package_id,variant,status,end_reason")
    .eq("user_id", userId)
    .not("scenario_id", "is", null);

  if (sessionErr) throw new Error(sessionErr.message);

  const sessions = (sessionData ?? []) as SessionLite[];

  // 3) 성공한 scenario_id만 모으기
  const successfulScenarioIds = new Set<string>();
  for (const s of sessions) {
    if (!s.scenario_id) continue;
    if (isSuccessfulSession(s)) {
      successfulScenarioIds.add(s.scenario_id);
    }
  }

  // 4) packageProgressMap 계산
  const packageProgressMap: Record<string, PackageProgress> = {};

  for (const [packageId, list] of scenariosByPackage.entries()) {
    const totalCount = list.length;

    if (totalCount === 0) {
      packageProgressMap[packageId] = {
        currentIndex: 0,
        isClear: false,
        clearedCount: 0,
        totalCount: 0,
      };
      continue;
    }

    let clearedCount = 0;
    for (const sc of list) {
      if (successfulScenarioIds.has(sc.scenario_id)) {
        clearedCount += 1;
      }
    }

    const isClear = clearedCount >= totalCount;

    // 다음으로 해야 할 시나리오 = 첫 번째 미클리어 시나리오
    let currentIndex = list.findIndex((sc) => !successfulScenarioIds.has(sc.scenario_id));

    // 전부 클리어면 마지막 시나리오 index 유지
    if (currentIndex === -1) {
      currentIndex = Math.max(0, totalCount - 1);
    }

    packageProgressMap[packageId] = {
      currentIndex,
      isClear,
      clearedCount,
      totalCount,
    };
  }

  return { packageProgressMap };
}