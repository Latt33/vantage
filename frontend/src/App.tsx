import { RouterProvider } from "react-router-dom";
import { router } from "./router";

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <RouterProvider router={router} />
    </div>
  );
}
