// src/routes/RootLayout.tsx
import { Outlet } from "react-router-dom";
import AnalyticsTracker from "@/components/AnalyticsTracker";

export default function RootLayout() {
  return (
    <>
      <AnalyticsTracker />
      <Outlet />
    </>
  );
}