// Smoke test of a packaged Colmena (electron-builder output in release/): starts its server
// on the app's own Node (Electron as Node, as desktop/main.cjs does once installed) with a
// throwaway data folder, waits for COLMENA_READY and asks /api/health. Also loads the native
// addons (node-pty, @napi-rs/canvas) for the app's architecture.
// Usage: node scripts/smoke-packaged.mjs [path to Colmena.exe | Colmena.app]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Absolute: a relative «release/…» given by CI would otherwise be taken for a package name
// by require() below (the 2.0.0 release failed on that).
const given = process.argv[2] ? path.resolve(process.argv[2]) : null;
const candidates = given ? [given] : process.platform === "win32"
  ? [path.join(root, "release", "win-unpacked", "Colmena.exe")]
  : [path.join(root, "release", "mac-arm64", "Colmena.app"), path.join(root, "release", "mac", "Colmena.app")];
const target = candidates.find((p) => existsSync(p));
if (!target) {
  console.error("No packaged Colmena found in: " + candidates.join(", "));
  process.exit(1);
}
const exe = target.endsWith(".app") ? path.join(target, "Contents", "MacOS", "Colmena") : target;
const app = target.endsWith(".app") ? path.join(target, "Contents", "Resources", "app") : path.join(path.dirname(target), "resources", "app");
const data = mkdtempSync(path.join(os.tmpdir(), "colmena-smoke-"));
const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", COLMENA_DATA_DIR: data, COLMENA_PORT: "0", COLMENA_RELAY_URL: "off" };
console.log("Packaged app: " + exe);

const natives = spawnSync(exe, ["-e", `
  const { createCanvas } = require(${JSON.stringify(path.join(app, "node_modules", "@napi-rs", "canvas"))});
  createCanvas(4, 4).getContext("2d").fillRect(0, 0, 2, 2);
  require(${JSON.stringify(path.join(app, "node_modules", "node-pty"))});
  console.log("native addons ok " + process.platform + "-" + process.arch + " node " + process.versions.node);
`], { env, encoding: "utf8", timeout: 60000 });
process.stdout.write(natives.stdout || "");
if (natives.status !== 0) {
  console.error(natives.stderr || natives.error);
  process.exit(1);
}

const server = spawn(exe, [path.join(app, "server", "index.mjs"), "--production"], { cwd: app, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
let output = "";
const finish = (code, message) => {
  console[code ? "error" : "log"](message);
  if (code && output) console.error(output.slice(-4000));
  server.kill();
  setTimeout(() => {
    try { rmSync(data, { recursive: true, force: true }); } catch {}
    process.exit(code);
  }, 1500);
};
const timer = setTimeout(() => finish(1, "The packaged server did not start within 90 s."), 90000);
server.stderr.on("data", (chunk) => { output += chunk; });
server.on("exit", (code) => finish(1, "The packaged server exited early with code " + code + "."));
server.stdout.on("data", async (chunk) => {
  output += chunk;
  const ready = output.match(/COLMENA_READY (http:\/\/127\.0\.0\.1:\d+)/);
  if (!ready) return;
  clearTimeout(timer);
  server.removeAllListeners("exit");
  server.stdout.removeAllListeners("data");
  try {
    const health = await (await fetch(ready[1] + "/api/health")).json();
    const page = await fetch(ready[1] + "/");
    if (health.application !== "Colmena") throw Error("unexpected /api/health: " + JSON.stringify(health));
    if (!page.ok || !/<div id="root"|<script/i.test(await page.text())) throw Error("the app page did not load (dist/ missing?)");
    finish(0, "Server ok at " + ready[1] + " · " + JSON.stringify(health));
  } catch (error) {
    finish(1, "Health check failed: " + error.message);
  }
});
