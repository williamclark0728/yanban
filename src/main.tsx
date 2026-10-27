import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isDesktop } from "./lib/desktop";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lets the site be installed as an app (on Android this is the app) and open offline.
if (import.meta.env.PROD && "serviceWorker" in navigator && !isDesktop) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
