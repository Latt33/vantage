import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import ScanlineOverlay from "./components/ScanlineOverlay";

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <RouterProvider router={router} />
      <ScanlineOverlay />
    </div>
  );
}
