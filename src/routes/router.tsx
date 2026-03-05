// src/routes/router.tsx
import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";

// pages
import BootPage from "@/pages/boot/BootPage";
import LoginPage from "@/pages/auth/LoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import PrivacyPage from "@/pages/auth/PrivacyPage";
import NotFoundPage from "@/pages/NotFoundPage";

import HomePage from "@/pages/home/HomePage";
import CategoryPage from "@/pages/category/CategoryPage";
import PackagePage from "@/pages/package/PackagePage";
import ScenarioDetailPage from "@/pages/scenario/ScenarioDetailPage";
import PlayPage from "@/pages/play/PlayPage";
import ResultPage from "@/pages/result/ResultPage";
import ReportPage from "@/pages/report/ReportPage";

function RequireAuth() {
  // 일단 여기선 막지 말고, Boot/Login에서만 흐름 잡아도 됨
  // (나중에 loader/redirect로 강화하면 됨)
  return <Outlet />;
}

export const router = createBrowserRouter([
  // ✅ 처음 진입은 무조건 Boot로
  { path: "/", element: <Navigate to="/boot" replace /> },

  // ✅ 전역 Boot (세션 보고 /auth/login 또는 /a/home,/b/home으로)
  { path: "/boot", element: <BootPage /> },

  // ✅ Auth는 공통(분기 없음)
  { path: "/auth/login", element: <LoginPage /> },
  { path: "/auth/signup", element: <SignupPage /> },
  { path: "/privacy", element: <PrivacyPage /> },

  // ✅ App은 /a, /b 아래로
  // ✅ App은 /a, /b 아래로 (regex 제거 버전)
{
  path: "/a",
  element: <RequireAuth />,
  children: [
    { path: "home", element: <HomePage /> },
    { path: "categories", element: <CategoryPage /> },
    { path: "packages/:packageId", element: <PackagePage /> },
    { path: "scenarios/:scenarioId", element: <ScenarioDetailPage /> },
    { path: "play/:sessionId", element: <PlayPage /> },
    { path: "result/:sessionId", element: <ResultPage /> },
    { path: "report", element: <ReportPage /> },
    { path: "*", element: <NotFoundPage /> },
  ],
},
{
  path: "/b",
  element: <RequireAuth />,
  children: [
    { path: "home", element: <HomePage /> },
    { path: "categories", element: <CategoryPage /> },
    { path: "packages/:packageId", element: <PackagePage /> },
    { path: "scenarios/:scenarioId", element: <ScenarioDetailPage /> },
    { path: "play/:sessionId", element: <PlayPage /> },
    { path: "result/:sessionId", element: <ResultPage /> },
    { path: "report", element: <ReportPage /> },
    { path: "*", element: <NotFoundPage /> },
  ],
},
  // ✅ 전역 404
  { path: "*", element: <NotFoundPage /> },
]);