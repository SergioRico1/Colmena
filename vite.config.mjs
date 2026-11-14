import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: ["localhost", "127.0.0.1"] },
  // cloud.html: the hosted sign-in and company pages (src/cloud/, docs/CLOUD.md); the desktop never opens it.
  build: { outDir: "dist", assetsInlineLimit: 0, rollupOptions: { input: { main: "index.html", cloud: "cloud.html" } } },
});
