// ✅ (추천) src/main.tsx 또는 App.tsx에서 한 번만 감싸기
// 기존 구조에 맞게 root 렌더 부분에 appShell만 추가해줘.

import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "@/routes/router";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
      <RouterProvider router={router} />
  </React.StrictMode>
);