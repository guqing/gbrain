import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// When ui-dev.ts detects the port is already busy, it POSTs to /__exo_ping
// which triggers server.ws.send({ type: 'custom', event: 'exo:focus' }).
// We listen here and call window.focus() to bring the browser window to front.
// This is tree-shaken away in production builds.
if (import.meta.hot) {
  import.meta.hot.on("exo:focus", () => window.focus());
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
