// src/services/analytics.ts
import { supabase } from "@/lib/supabaseClient";

export type AnalyticsEventName =
  | "page_view"
  | "page_leave"
  | "session_heartbeat"
  | "click"
  | "custom";

export type AnalyticsEvent = {
  event_name: AnalyticsEventName;
  pathname?: string | null;
  page_id?: string | null; // 페이지 단위 식별자 (ex: "home", "play", "result")
  session_id?: string | null; // roleplay session id(있으면)
  props?: Record<string, any>;
};

function getVariantFromPath(pathname: string): "a" | "b" | null {
  if (pathname.startsWith("/b")) return "b";
  if (pathname.startsWith("/a")) return "a";
  return null;
}

export async function logEvent(evt: AnalyticsEvent) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;

  // 로그인 안 된 상태면 로그 스킵 (원하면 anon 로깅도 가능)
  if (!user) return;

  const pathname = evt.pathname ?? window.location.pathname;
  const variant = getVariantFromPath(pathname);

  const payload = {
    user_id: user.id,
    session_id: evt.session_id ?? null,
    variant,
    event_name: evt.event_name,
    pathname,
    referrer: document.referrer || null,
    page_id: evt.page_id ?? null,
    props: evt.props ?? {},
    client_ts: new Date().toISOString(),
  };

  const { error } = await supabase.from("analytics_events").insert(payload);

  // 분석 로그는 UX를 깨면 안돼서 alert 금지. 콘솔만.
  if (error) console.warn("[analytics] insert failed:", error.message);
}

/**
 * 체류시간 로깅용: page_view -> page_leave 를 pair로 남기고
 * page_leave props에 dwell_ms(머문 시간) 기록.
 */
export function createPageTimer() {
  const startedAt = performance.now();
  return {
    dwellMs: () => Math.max(0, Math.round(performance.now() - startedAt)),
  };
}