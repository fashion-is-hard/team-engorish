// src/components/AnalyticsTracker.tsx
import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { createPageTimer, logEvent } from "@/services/analytics";

function inferPageId(pathname: string): string {
  // /a/home, /b/play/:id 같은 구조라서 대충 매핑
  const p = pathname.replace(/^\/(a|b)\//, "/"); // variant 제거
  if (p.startsWith("/home")) return "home";
  if (p.startsWith("/packages/")) return "package";
  if (p.startsWith("/scenarios/")) return "scenario_detail";
  if (p.startsWith("/play/")) return "play";
  if (p.startsWith("/result/")) return "result";
  if (p.startsWith("/report")) return "report";
  if (p.startsWith("/auth/")) return "auth";
  if (p.startsWith("/boot")) return "boot";
  return "unknown";
}

function extractSessionId(pathname: string): string | null {
  // /a/play/:sessionId , /b/result/:sessionId
  const m = pathname.match(/\/(play|result)\/([^/]+)/);
  return m?.[2] ?? null;
}

export default function AnalyticsTracker() {
  const location = useLocation();

  const pathname = location.pathname;
  const pageId = useMemo(() => inferPageId(pathname), [pathname]);
  const sessionId = useMemo(() => extractSessionId(pathname), [pathname]);

  // 이전 페이지 기록용
  const prevRef = useRef<{ pathname: string; pageId: string; sessionId: string | null; timer: any } | null>(null);

  useEffect(() => {
    // 1) 이전 페이지 leave 기록
    const prev = prevRef.current;
    if (prev) {
      const dwell = prev.timer?.dwellMs?.() ?? null;
      logEvent({
        event_name: "page_leave",
        pathname: prev.pathname,
        page_id: prev.pageId,
        session_id: prev.sessionId,
        props: { dwell_ms: dwell },
      });
    }

    // 2) 현재 페이지 view 기록
    const timer = createPageTimer();
    logEvent({
      event_name: "page_view",
      pathname,
      page_id: pageId,
      session_id: sessionId,
      props: { search: location.search || null },
    });

    // 3) ref 업데이트
    prevRef.current = { pathname, pageId, sessionId, timer };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // 탭 닫기/새로고침 시에도 leave 한 번 더 남기기
  useEffect(() => {
    const onBeforeUnload = () => {
      const cur = prevRef.current;
      if (!cur) return;
      const dwell = cur.timer?.dwellMs?.() ?? null;

      // beforeunload에서는 await 못하니까 fire-and-forget
      logEvent({
        event_name: "page_leave",
        pathname: cur.pathname,
        page_id: cur.pageId,
        session_id: cur.sessionId,
        props: { dwell_ms: dwell, reason: "beforeunload" },
      });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return null;
}