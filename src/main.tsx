import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
// File Converter actor: registers the browser-side conversion runner.
import "./runtime/convert";
// Shell layer: loaded last so it overrides index.css / docs.css for shell selectors only.
import "./ui/shell.css";
// Typography layer: loaded after everything else. Single source of every font stack; Chinese = Noto Sans SC / TC only.
import "./ui/typography.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
