// src/routes/router.tsx
import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";

// ✅ add
import RootLayout from "@/routes/RootLayout";

// pages
import BootPage from "@/pages/boot/BootPage";
import LoginPage from "@/pages/auth/LoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import PrivacyPage from "@/pages/auth/PrivacyPage";
import NotFoundPage from "@/pages/NotFoundPage";

import HomePage from "@/pages/home/HomePage";
import PackagePage from "@/pages/package/PackagePage";
import ScenarioDetailPage from "@/pages/scenario/ScenarioDetailPage";
import PlayPage from "@/pages/play/PlayPage";
import ResultPage from "@/pages/result/ResultPage";
import ReportPage from "@/pages/report/ReportPage";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage";
import UpdatePasswordPage from "@/pages/auth/UpdatePasswordPage";

function RequireAuth() {
  return <Outlet />;
}

const makeVariantChildren = (variant: "a" | "b") => [
  { index: true, element: <Navigate to={`/${variant}/home`} replace /> },
  { path: "home", element: <HomePage /> },
  { path: "categories", element: <Navigate to={`/${variant}/home`} replace /> },
  { path: "packages/:packageId", element: <PackagePage /> },
  { path: "scenarios/:scenarioId", element: <ScenarioDetailPage /> },
  { path: "play/:sessionId", element: <PlayPage /> },
  { path: "result/:sessionId", element: <ResultPage /> },
  { path: "report", element: <ReportPage /> },
  { path: "*", element: <NotFoundPage /> },
];

// ✅ 핵심: RootLayout 안에 Outlet을 두고, 기존 라우트들을 children으로 넣기
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <Navigate to="/boot" replace /> },
      { path: "/boot", element: <BootPage /> },

      { path: "/auth/login", element: <LoginPage /> },
      { path: "/auth/signup", element: <SignupPage /> },
      { path: "/auth/reset-password", element: <ResetPasswordPage /> },
      { path: "/auth/update-password", element: <UpdatePasswordPage /> },
      { path: "/privacy", element: <PrivacyPage /> },

      {
        path: "/a",
        element: <RequireAuth />,
        children: makeVariantChildren("a"),
      },
      {
        path: "/b",
        element: <RequireAuth />,
        children: makeVariantChildren("b"),
      },

      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);