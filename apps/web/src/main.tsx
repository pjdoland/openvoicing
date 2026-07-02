import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./app.css";

// In dev the app registers no service worker. A leftover one from a previous
// production build served on the same origin (e.g. localhost) would keep
// serving stale, precached code and break features like Open bundle in the
// browser that has it, while another browser works. Clear it defensively.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    if (!regs.length) return;
    for (const r of regs) void r.unregister();
    if (window.caches) void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)));
    // The stale worker may still control this page until the next load.
    console.warn("[openvoicing] removed a stale service worker; reload to run fresh code.");
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
