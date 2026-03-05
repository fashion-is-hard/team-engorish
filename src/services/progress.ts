// src/services/progress.ts
import { supabase } from "@/lib/supabaseClient";

export type ScenarioLite = {
  scenario_id: string;
  package_id: string;
  title: string;
  scenario_desc: string | null;
  thumb_url: string | null;
  sort_order: number | null;
};

export type PackageProgress = {
  package_id: string;
  total: number;
  completed: number;
  currentIndex: number;          // 다음으로 진행해야 할 index (0-based)
  nextScenarioId: string | null; // 다음으로 진행할 시나리오
  isClear: boolean;
  isInProgress: boolean;
  isNotStarted: boolean;
};

export type UserProgress = {
  completedScenarioIds: Set<string>;
  packageProgressMap: Record<string, PackageProgress>;
  lastPackageId: string | null;     // 최근 플레이 패키지(진행중 있으면 우선)
  lastNextScenarioId: string | null; // 최근 패키지의 다음 시나리오
};

async function getUserIdOrThrow() {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("로그인이 필요합니다.");
  return userId;
}

/**
 * A버전 진행도 집계:
 * - ended 세션의 scenario_id를 완료로 간주(중복 제거)
 * - 각 package의 scenarios를 sort_order로 가져와서 nextScenario 계산
 * - 최근 플레이(ended 포함) 기준으로 lastPackageId도 계산
 */
export async function fetchUserProgress(): Promise<UserProgress> {
  const userId = await getUserIdOrThrow();

  // 1) 완료한 시나리오 집계(중복 제거)
  const { data: endedSessions, error: sErr } = await supabase
    .from("roleplay_sessions")
    .select("scenario_id,package_id,started_at,status,end_reason")
    .eq("user_id", userId)
    .eq("status", "ended")
    .not("scenario_id", "is", null);

  if (sErr) throw new Error(sErr.message);

  const completedScenarioIds = new Set<string>();
  for (const row of endedSessions ?? []) {
    // ✅ 필요하면 아래처럼 end_reason 조건 넣기
    // if (row.end_reason !== "turn_limit") continue;
    if (row.scenario_id) completedScenarioIds.add(row.scenario_id);
  }

  // 2) 최근 플레이 패키지(진행중 우선) 구하기
  // - active 세션이 있으면 그 패키지를 우선
  const { data: active, error: aErr } = await supabase
    .from("roleplay_sessions")
    .select("package_id,scenario_id,started_at,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);

  if (aErr) throw new Error(aErr.message);

  let lastPackageId: string | null = active?.[0]?.package_id ?? null;

  if (!lastPackageId) {
    const { data: lastAny, error: lErr } = await supabase
      .from("roleplay_sessions")
      .select("package_id,started_at")
      .eq("user_id", userId)
      .not("package_id", "is", null)
      .order("started_at", { ascending: false })
      .limit(1);

    if (lErr) throw new Error(lErr.message);
    lastPackageId = lastAny?.[0]?.package_id ?? null;
  }

  // 3) 모든 package의 scenarios를 가져와서 packageProgressMap 만들기
  // (is_active=true만)
  const { data: allScenarios, error: scErr } = await supabase
    .from("scenarios")
    .select("scenario_id,package_id,title,scenario_desc,thumb_url,sort_order,is_active")
    .eq("is_active", true)
    .order("package_id", { ascending: true })
    .order("sort_order", { ascending: true });

  if (scErr) throw new Error(scErr.message);

  const byPackage: Record<string, ScenarioLite[]> = {};
  for (const r of allScenarios ?? []) {
    const p = r.package_id as string;
    if (!byPackage[p]) byPackage[p] = [];
    byPackage[p].push({
      scenario_id: r.scenario_id,
      package_id: r.package_id,
      title: r.title,
      scenario_desc: r.scenario_desc,
      thumb_url: r.thumb_url,
      sort_order: r.sort_order,
    });
  }

  const packageProgressMap: Record<string, PackageProgress> = {};
  for (const packageId of Object.keys(byPackage)) {
    const list = byPackage[packageId];
    const total = list.length;

    let completed = 0;
    for (const s of list) {
      if (completedScenarioIds.has(s.scenario_id)) completed += 1;
    }

    // next = 완료 안 된 첫 번째
    let currentIndex = 0;
    let nextScenarioId: string | null = null;
    for (let i = 0; i < list.length; i++) {
      if (!completedScenarioIds.has(list[i].scenario_id)) {
        currentIndex = i;
        nextScenarioId = list[i].scenario_id;
        break;
      }
      // 전부 완료면 nextScenarioId는 null 유지
      if (i === list.length - 1) {
        currentIndex = list.length - 1;
        nextScenarioId = null;
      }
    }

    const isClear = total > 0 && completed >= total;
    const isNotStarted = completed === 0;
    const isInProgress = !isClear && !isNotStarted;

    packageProgressMap[packageId] = {
      package_id: packageId,
      total,
      completed,
      currentIndex: isClear ? Math.max(0, total - 1) : currentIndex,
      nextScenarioId: isClear ? null : nextScenarioId,
      isClear,
      isInProgress,
      isNotStarted,
    };
  }

  // 4) lastPackageId 기준 nextScenarioId 계산
  const lastNextScenarioId =
    lastPackageId && packageProgressMap[lastPackageId]
      ? packageProgressMap[lastPackageId].nextScenarioId
      : null;

  return {
    completedScenarioIds,
    packageProgressMap,
    lastPackageId,
    lastNextScenarioId,
  };
}