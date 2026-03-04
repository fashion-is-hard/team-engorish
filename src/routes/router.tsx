import { createBrowserRouter } from "react-router-dom";

import BootPage from "@/pages/boot/BootPage";
import LoginPage from "@/pages/auth/LoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import PrivacyPage from "@/pages/auth/PrivacyPage";
import HomePage from "@/pages/home/HomePage";
import CategoryPage from "@/pages/category/CategoryPage";
import PackagePage from "@/pages/package/PackagePage";
import ScenarioDetailPage from "@/pages/scenario/ScenarioDetailPage";



export const router = createBrowserRouter([

  {
    path:"/",
    element:<BootPage/>
  },
  {
  path:"/signup",
  element:<SignupPage/>
},

  {
    path:"/login",
    element:<LoginPage/>
  },
  {
  path:"/privacy",
  element:<PrivacyPage/>
},
{
  path:"/home",
  element:<HomePage/>
},
{
  path:"/category",
  element:<CategoryPage/>
},
{
  path:"/package",
  element:<PackagePage/>
},
{
  path: "/scenario",
  element: <ScenarioDetailPage />
}


]);