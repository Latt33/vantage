import { createBrowserRouter, redirect, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import LoginPage from "./pages/LoginPage";
import AoiSelectPage from "./pages/AoiSelectPage";
import CapabilityPage from "./pages/CapabilityPage";
import OperationsPage from "./pages/OperationsPage";
import PageTransition from "./components/PageTransition";

function requireAuth() {
  if (sessionStorage.getItem("auth") !== "true") throw redirect("/login");
  return null;
}

function RootLayout() {
  const location = useLocation();
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <AnimatePresence mode="wait" initial={false}>
        <PageTransition key={location.pathname}>
          <Outlet />
        </PageTransition>
      </AnimatePresence>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <LoginPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "aoi", loader: requireAuth, element: <AoiSelectPage /> },
      { path: "capabilities", loader: requireAuth, element: <CapabilityPage /> },
      { path: "operations", loader: requireAuth, element: <OperationsPage /> },
    ],
  },
]);
