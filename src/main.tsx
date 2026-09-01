import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/ui/theme/tokens.css";
import "@/store/persistBootstrap";
import AppRoot from "./AppRoot";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>
);
