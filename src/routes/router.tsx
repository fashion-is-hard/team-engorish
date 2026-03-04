import { createBrowserRouter } from "react-router-dom";

import BootPage from "@/pages/boot/BootPage";
import LoginPage from "@/pages/auth/LoginPage";
import LandingPage from "@/pages/landing/LandingPage";
import ScenarioListPage from "@/pages/scenario/ScenarioListPage";
import SessionPage from "@/pages/session/SessionPage";
import ResultPage from "@/pages/result/ResultPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <BootPage />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/landing",
    element: <LandingPage />,
  },
  {
    path: "/scenarios",
    element: <ScenarioListPage />,
  },
  {
    path: "/session/:id",
    element: <SessionPage />,
  },
  {
    path: "/result/:id",
    element: <ResultPage />,
  },
]);