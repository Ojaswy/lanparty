import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: resolve(here, "../dist"), emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/og": { target: "http://localhost:8787", changeOrigin: true },
      "/portal": { target: "http://localhost:8787", changeOrigin: true },
      // `/r/:id` is an SPA route in dev (Vite's history fallback); in production
      // the server serves it with OG tags injected.
    },
  },
});
