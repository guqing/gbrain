import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      // Dev-only: expose POST /__exo_ping so ui-dev.ts can signal the
      // already-open tab to call window.focus() via Vite's HMR WebSocket.
      name: "exo-focus-ping",
      configureServer(server) {
        server.middlewares.use("/__exo_ping", (req, res, next) => {
          if (req.method !== "POST") { next(); return; }
          server.ws.send({ type: "custom", event: "exo:focus" });
          res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3002,
    proxy: {
      "/api": {
        target: process.env["EXO_UI_API_ORIGIN"] ?? "http://127.0.0.1:7499",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
