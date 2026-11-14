import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

// The variable Bricolage Grotesque files (styles/base.css), found the way Node finds the package:
// a relative "../../node_modules" path misses it in a git worktree, where node_modules lives in a
// parent folder, and the build then shipped the URL unresolved (a 404 on app.colmena.team).
const bricolage = path.join(path.dirname(createRequire(import.meta.url).resolve("@fontsource-variable/bricolage-grotesque/package.json")), "files");

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@bricolage-files": bricolage } },
  server: { allowedHosts: ["localhost", "127.0.0.1"], fs: { allow: [searchForWorkspaceRoot(process.cwd()), bricolage] } },
  // cloud.html: the hosted sign-in and company pages (src/cloud/, docs/CLOUD.md); the desktop never opens it.
  build: { outDir: "dist", assetsInlineLimit: 0, rollupOptions: { input: { main: "index.html", cloud: "cloud.html" } } },
});
