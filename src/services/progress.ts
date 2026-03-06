// src/services/progress.ts
import { supabase } from "@/lib/supabaseClient";

type ScenarioLite = {
  scenario_id: string;
  package_id: string;
  sort_order: number | null;
  created_at?: string | null;
};

type SessionLite = {
  session_id: string;
  scenario_id: string | null;
  package_id: string | null;
  variant: string | null;
  status: string | null;      // active | ended
  end_reason: string | null;
  started_at?: string | null;
  ended_at?: string | null;
};

type PackageProgress = {
  currentIndex: number;
  isClear: boolean;
  clearedCount: number;
  totalCount: number;
};

type FetchUserProgressResult = {
  packageProgressMap: Record<string, PackageProgress>;
};

function normalizeVariant(v: unknown): "a" | "b" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "b" ? "b" : "a";
}

// ✅ 성공 세션 판정
function isSuccessfulSession(s: SessionLite) {
  const variant = normalizeVariant(s.variant);

  if (variant === "a") {
    // A는 종료만 되면 성공
    return s.status === "ended";
  }

  // B는 목표 달성만 성공
  return s.status === "ended" && s.end_reason === "goals_done";
}

export async function fetchUserProgress(): Promise<FetchUserProgressResult> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth.user) return { packageProgressMap: {} };

  const userId = auth.user.id;

  // 1) 전체 활성 시나리오
  const { data: scenarioData, error: scenarioErr } = await supabase
    .from("scenarios")
    .select("scenario_id,package_id,sort_order,created_at")
    .eq("is_active", true)
    .order("package_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (scenarioErr) throw new Error(scenarioErr.message);

  const scenarios = (scenarioData ?? []) as ScenarioLite[];

  const scenariosByPackage = new Map<string, ScenarioLite[]>();
  for (const sc of scenarios) {
    if (!sc.package_id) continue;
    const arr = scenariosByPackage.get(sc.package_id) ?? [];
    arr.push(sc);
    scenariosByPackage.set(sc.package_id, arr);
  }

  // 2) 유저 세션 전부 조회
  const { data: sessionData, error: sessionErr } = await supabase
    .from("roleplay_sessions")
    .select("session_id,scenario_id,package_id,variant,status,end_reason,started_at,ended_at")
    .eq("user_id", userId)
    .not("scenario_id", "is", null)
    .order("started_at", { ascending: true });

  if (sessionErr) throw new Error(sessionErr.message);

  const sessions = (sessionData ?? []) as SessionLite[];

  // 3) 성공한 scenario_id 집합
  const successfulScenarioIds = new Set<string>();
  for (const s of sessions) {
    if (!s.scenario_id) continue;
    if (isSuccessfulSession(s)) {
      successfulScenarioIds.add(s.scenario_id);
    }
  }

  // 4) package별 가장 최근 active 세션 찾기
  const latestActiveByPackage = new Map<string, SessionLite>();

  for (const s of sessions) {
    if (!s.package_id || !s.scenario_id) continue;
    if (s.status !== "active") continue;

    const prev = latestActiveByPackage.get(s.package_id);
    const curTime = new Date(s.started_at ?? 0).getTime();
    const prevTime = prev ? new Date(prev.started_at ?? 0).getTime() : -1;

    if (!prev || curTime > prevTime) {
      latestActiveByPackage.set(s.package_id, s);
    }
  }

  // 5) package progress 계산
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

    // 기본값: 첫 번째 미클리어 시나리오
    let currentIndex = list.findIndex((sc) => !successfulScenarioIds.has(sc.scenario_id));

    if (currentIndex === -1) {
      currentIndex = Math.max(0, totalCount - 1);
    }

    // ✅ 진행 중(active) 세션이 있으면 그 시나리오를 current로 우선 반영
    // A에서는 특히 이게 중요 (홈 갔다 와도 이어서 보이게)
    const activeSession = latestActiveByPackage.get(packageId);
    if (activeSession?.scenario_id) {
      const activeIndex = list.findIndex((sc) => sc.scenario_id === activeSession.scenario_id);
      if (activeIndex >= 0) {
        currentIndex = activeIndex;
      }
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