import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
// Shell layer: loaded last so it overrides index.css / docs.css for shell selectors only.
import "./ui/shell.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
