// Which Colmena this desktop app opens (docs/CLOUD.md › Phase 5): «Solo en este ordenador» (the
// local server and its data, as always) or «Usar Colmena en la nube» (the company's workspace at
// app.colmena.team, plus this computer's local agent). The choice is kept in the desktop
// profile (userData/colmena-mode.json); the two modes never share data: the local mode's data
// folder stays untouched in cloud mode, and the cloud's session lives in its own partition.
//
// Resolution: COLMENA_MODE (tests, QA) → the saved choice → for a new installed copy with no
// local data, ask (the first-run choice) → otherwise local, so nothing changes for anyone who
// already uses Colmena or runs it from the repository.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const MODES = ["local", "cloud"];
const DEFAULT_CLOUD = "https://app.colmena.team";
const PARTITION = "persist:colmena-cloud";

function dataDir(env = process.env) {
  return env.COLMENA_DATA_DIR || path.join(env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Colmena");
}
const modeFile = (userData) => path.join(userData, "colmena-mode.json");

function readMode(userData) {
  try {
    const saved = JSON.parse(fs.readFileSync(modeFile(userData), "utf8"));
    return MODES.includes(saved?.mode) ? saved : null;
  } catch { return null; }
}
function writeMode(userData, mode) {
  if (!MODES.includes(mode)) throw Error("Modo no válido.");
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(modeFile(userData), JSON.stringify({ mode, at: new Date().toISOString() }, null, 2));
  return mode;
}
/** "local" | "cloud" | "ask" (show the first-run choice). */
function resolveMode({ userData, env = process.env, packaged = false, exists = fs.existsSync } = {}) {
  if (MODES.includes(env.COLMENA_MODE)) return env.COLMENA_MODE;
  const saved = readMode(userData);
  if (saved) return saved.mode;
  const hasLocal = exists(path.join(dataDir(env), "colmena.sqlite"));
  return packaged && !hasLocal ? "ask" : "local";
}
/** The cloud site: COLMENA_CLOUD_URL (an https origin, or http on loopback for wrangler dev) or app.colmena.team. */
function cloudUrl(env = process.env) {
  const raw = env.COLMENA_CLOUD_URL || DEFAULT_CLOUD;
  try {
    const u = new URL(raw);
    const loopback = u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname);
    if ((u.protocol === "https:" || loopback) && !u.username && !u.password && u.pathname === "/") return u.origin;
  } catch {}
  return DEFAULT_CLOUD;
}

module.exports = { MODES, PARTITION, DEFAULT_CLOUD, dataDir, readMode, writeMode, resolveMode, cloudUrl, modeFile };
