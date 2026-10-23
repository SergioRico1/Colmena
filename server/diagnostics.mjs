// Ajustes › Diagnóstico («t3 doctor», OpenClaw doctor; ideas only): one click checks the AI
// accounts, the code engines, the database, the disk, the server's stalls and the app
// connections, and says what fails and how to fix it, in plain words.
//   GET /api/diagnostics → {at, ms, checks: [{id, group, title, status, text, fix?, to?, command?}], summary}
// status: ok | warn | fail | off (not in use). `to` is a Colmena address that fixes it,
// `command` something to type in a terminal. Every check has its own time limit, and the
// database integrity check (PRAGMA quick_check, never VACUUM) runs in a worker thread on its
// own read-only connection, so the server never stands still while it reads.
import { stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { CLI_MIN_VERSION, claudeCliVersion, findClaudeCli, newerOrEqual, probeClaudeCli } from "./providers/claude-cli.mjs";
import { findCodexCli, probeCodex } from "./code/codex.mjs";
import { findOpenCode } from "./code/opencode.mjs";
import { whenText } from "./limits.mjs";

export const CHECK_MS = 12_000;
const MB = 1024 * 1024, GB = 1024 * MB;
const WAL_WARN = 64 * MB;
const DISK_WARN = 5 * GB, DISK_FAIL = 1 * GB;

export const sizeText = (bytes) => {
  if (!(bytes >= 0)) return "—";
  if (bytes >= GB) return (bytes / GB).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " GB";
  if (bytes >= MB) return (bytes / MB).toLocaleString("es-ES", { maximumFractionDigits: bytes >= 100 * MB ? 0 : 1 }) + " MB";
  return Math.max(1, Math.round(bytes / 1024)).toLocaleString("es-ES") + " KB";
};
const ago = (ms) => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "hace un momento";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); timer.unref?.(); }),
  ]);
}

/** PRAGMA quick_check on a read-only connection in a worker: ["ok"] or the problems found. */
export function quickCheck(file, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const worker = new Worker(
      `const { workerData, parentPort } = require("node:worker_threads");
       const { DatabaseSync } = require("node:sqlite");
       try {
         const db = new DatabaseSync(workerData.file, { readOnly: true });
         db.exec("PRAGMA busy_timeout=5000;");
         const rows = db.prepare("PRAGMA quick_check(20)").all().map((r) => String(Object.values(r)[0]));
         db.close();
         parentPort.postMessage({ rows });
       } catch (e) { parentPort.postMessage({ error: String(e && e.message || e) }); }`,
      { eval: true, workerData: { file } },
    );
    const timer = setTimeout(() => { worker.terminate(); resolve({ error: "timeout" }); }, timeoutMs);
    timer.unref?.();
    worker.once("message", (m) => { clearTimeout(timer); worker.terminate(); resolve(m); });
    worker.once("error", (e) => { clearTimeout(timer); resolve({ error: e.message }); });
  });
}

// ─────────────────────────────────────────────────────────────── each group of checks
const AI_TO = "/ajustes/inteligencia";

async function aiChecks({ provider, probeClaude = probeClaudeCli }) {
  if (!provider?.engines) return [{ id: "ai", group: "ia", title: "Cuentas de IA", status: "fail", text: "La capa de proveedores no está disponible.", fix: "Reinicia Colmena." }];
  const engines = provider.engines();
  const out = [];
  for (const e of engines) {
    const base = { id: "ai:" + e.id, group: "ia", title: e.label };
    if (!e.connected) { out.push({ ...base, status: "off", text: "Sin conectar.", to: AI_TO + "#" + (e.id === "openai" ? "chatgpt" : e.id === "anthropic" ? "claude" : "opencode") }); continue; }
    if (e.limit) {
      const when = e.limit.resetsAt ? whenText(e.limit.resetsAt) : null;
      out.push({ ...base, status: "warn", text: `Ha llegado a su ${e.limit.label || "límite de uso"}${when ? ` · se renueva ${when}` : ""}.`, fix: "El trabajo sigue solo al renovarse. Para seguir antes, elige otra IA en «Si falla, usar».", to: AI_TO + "#respaldo" });
      continue;
    }
    if (e.id === "openai") {
      const s = (() => { try { return provider.session?.status?.(); } catch { return null; } })();
      const kind = provider.kind;
      if (kind === "chatgpt" && s && s.canInfer === false) {
        out.push({ ...base, status: "fail", text: "La sesión de ChatGPT no da permiso para usar tu plan.", fix: "Desconecta y vuelve a iniciar sesión con tu cuenta de ChatGPT.", to: AI_TO });
        continue;
      }
    }
    if (e.id === "anthropic" && e.method === "cli") {
      const auth = await withTimeout(probeClaude(), CHECK_MS, { status: "timeout" });
      if (auth.status !== "available") {
        out.push({ ...base, status: "fail", text: auth.status === "not_installed" ? "Claude Code ya no está instalado en este ordenador." : auth.status === "missing" ? "Claude Code no tiene la sesión iniciada." : "Claude Code no contesta.", fix: auth.status === "missing" ? "Abre una terminal, escribe claude y luego /login." : "Reinstala Claude Code o conecta Claude con una clave.", command: auth.status === "missing" ? "claude" : null, to: AI_TO });
        continue;
      }
    }
    if (e.resting) { out.push({ ...base, status: "warn", text: ["Conectada", e.detail, "no respondió hace poco y Colmena espera un momento antes de volver a usarla."].filter(Boolean).join(" · "), fix: "No hace falta hacer nada: lo vuelve a intentar sola." }); continue; }
    out.push({ ...base, status: "ok", text: "Conectada" + (e.detail ? " · " + e.detail : "") + "." });
  }
  const connected = engines.filter((e) => e.connected);
  if (!connected.length) out.unshift({ id: "ai:none", group: "ia", title: "Cerebro del equipo", status: "fail", text: "Ninguna cuenta de IA conectada: los bots no pueden pensar.", fix: "Conecta ChatGPT, Claude u OpenCode Go.", to: AI_TO });
  else {
    const fallback = provider.config?.()?.fallback;
    if (connected.length > 1 && (!fallback || fallback === "none")) out.push({ id: "ai:fallback", group: "ia", title: "Respaldo", status: "warn", text: "Tienes más de una IA conectada pero ninguna de respaldo.", fix: "Elige una en «Si falla, usar»: si la principal llega a su límite, el trabajo sigue con la otra.", to: AI_TO + "#respaldo" });
  }
  return out;
}

async function codeChecks({ directory, find = {}, probe = {} }) {
  const out = [];
  const claude = (find.claude || findClaudeCli)();
  if (!claude) out.push({ id: "code:claude", group: "codigo", title: "Claude Code", status: "off", text: "No está instalado.", fix: "Instálalo desde claude.com/code si quieres que Bruno programe con Claude." });
  else {
    const [version, auth] = await Promise.all([
      withTimeout((probe.claudeVersion || claudeCliVersion)({ command: claude }), CHECK_MS, null),
      withTimeout((probe.claudeAuth || probeClaudeCli)({ command: claude }), CHECK_MS, { status: "timeout" }),
    ]);
    if (version && !newerOrEqual(version, CLI_MIN_VERSION)) out.push({ id: "code:claude", group: "codigo", title: "Claude Code", status: "warn", text: `Versión ${version}: los modelos nuevos piden la ${CLI_MIN_VERSION} o más.`, fix: "Actualízalo desde una terminal.", command: "claude update" });
    else if (auth.status === "missing") out.push({ id: "code:claude", group: "codigo", title: "Claude Code", status: "warn", text: `Instalado${version ? " · " + version : ""}, sin sesión iniciada.`, fix: "Abre una terminal, escribe claude y luego /login.", command: "claude" });
    else if (auth.status !== "available") out.push({ id: "code:claude", group: "codigo", title: "Claude Code", status: "warn", text: `Instalado${version ? " · " + version : ""}, pero no contesta a tiempo.`, fix: "Ciérralo si está abierto en otra ventana y vuelve a comprobar." });
    else out.push({ id: "code:claude", group: "codigo", title: "Claude Code", status: "ok", text: `Listo · ${version || "versión desconocida"}${auth.email ? " · " + auth.email : ""}.` });
  }
  const codex = (find.codex || findCodexCli)();
  if (!codex) out.push({ id: "code:codex", group: "codigo", title: "Codex", status: "off", text: "No está instalado.", fix: "Para usarlo, instálalo con npm y entra con tu cuenta de ChatGPT.", command: "npm install -g @openai/codex" });
  else {
    const auth = await withTimeout((probe.codex || probeCodex)({ command: codex }), CHECK_MS, { status: "timeout" });
    out.push(auth.status === "available"
      ? { id: "code:codex", group: "codigo", title: "Codex", status: "ok", text: "Listo, con la sesión iniciada." }
      : { id: "code:codex", group: "codigo", title: "Codex", status: "warn", text: auth.status === "timeout" ? "Instalado, pero no contesta a tiempo." : "Instalado, sin sesión iniciada.", fix: "Inicia sesión desde una terminal.", command: "codex login" });
  }
  const opencode = (find.opencode || findOpenCode)(directory);
  out.push(opencode
    ? { id: "code:opencode", group: "codigo", title: "OpenCode", status: "ok", text: "Instalado en Colmena." }
    : { id: "code:opencode", group: "codigo", title: "OpenCode", status: "off", text: "No está instalado.", fix: "En Código, elige OpenCode y pulsa «Instalar».", to: "/codigo" });
  return out;
}

async function dataChecks({ directory, integrity = quickCheck, disk = statfs }) {
  const out = [];
  const file = path.join(directory, "colmena.sqlite");
  const [db, wal] = await Promise.all([stat(file).catch(() => null), stat(file + "-wal").catch(() => null)]);
  if (!db) out.push({ id: "data:db", group: "datos", title: "Base de datos", status: "fail", text: "No encuentro el archivo de la base de datos.", fix: "Reinicia Colmena. Si sigue, no borres la carpeta de datos y pide ayuda." });
  else {
    const walBytes = wal?.size || 0;
    out.push(walBytes > WAL_WARN
      ? { id: "data:size", group: "datos", title: "Tamaño", status: "warn", text: `${sizeText(db.size)} y un diario de cambios (WAL) de ${sizeText(walBytes)}, más grande de lo normal.`, fix: "Se recoge solo cuando no hay trabajo en marcha; reiniciar Colmena también lo vacía." }
      : { id: "data:size", group: "datos", title: "Tamaño", status: "ok", text: `${sizeText(db.size)} · diario de cambios (WAL) ${sizeText(walBytes)}.` });
    const check = await integrity(file);
    if (check.error === "timeout") out.push({ id: "data:integrity", group: "datos", title: "Integridad", status: "warn", text: "La comprobación tardó demasiado y se paró.", fix: "Vuelve a probar cuando el equipo no esté trabajando." });
    else if (check.error) out.push({ id: "data:integrity", group: "datos", title: "Integridad", status: "warn", text: "No se pudo comprobar: " + check.error, fix: "Vuelve a probar en un momento." });
    else if (check.rows?.length === 1 && check.rows[0] === "ok") out.push({ id: "data:integrity", group: "datos", title: "Integridad", status: "ok", text: "Sin errores (comprobación rápida de SQLite)." });
    else out.push({ id: "data:integrity", group: "datos", title: "Integridad", status: "fail", text: `SQLite encontró ${check.rows?.length || 0} ${check.rows?.length === 1 ? "problema" : "problemas"}: ${String(check.rows?.[0] || "").slice(0, 160)}`, fix: "Cierra Colmena y haz una copia de la carpeta de datos antes de nada. No la borres." });
  }
  const free = await disk(directory).then((s) => Number(s.bavail) * Number(s.bsize)).catch(() => null);
  if (free == null) out.push({ id: "data:disk", group: "datos", title: "Disco", status: "off", text: "No se pudo leer el espacio libre." });
  else out.push({
    id: "data:disk", group: "datos", title: "Disco",
    status: free < DISK_FAIL ? "fail" : free < DISK_WARN ? "warn" : "ok",
    text: `${sizeText(free)} libres donde Colmena guarda tus datos.`,
    ...(free < DISK_WARN ? { fix: "Libera espacio: los bots necesitan sitio para guardar entregables y puntos de restauración." } : {}),
  });
  out.push({ id: "data:folder", group: "datos", title: "Carpeta de datos", status: "off", text: directory });
  return out;
}

function serverChecks({ stalls, version, startedAt = Date.now() - process.uptime() * 1000, running = 0 }) {
  const out = [];
  const s = stalls?.state;
  if (!s) out.push({ id: "server:stalls", group: "servidor", title: "Bloqueos", status: "off", text: "El vigilante de bloqueos no está activo." });
  else if (!s.count) out.push({ id: "server:stalls", group: "servidor", title: "Bloqueos", status: "ok", text: `Ninguno desde que arrancó (${ago(Date.now() - startedAt)}).` });
  else out.push({ id: "server:stalls", group: "servidor", title: "Bloqueos", status: "warn", text: `Se quedó parado ${s.count} ${s.count === 1 ? "vez" : "veces"}; el peor, ${(s.worstMs / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s${s.last ? ", el último a las " + hhmm(s.last.at) : ""}.`, fix: "Si notas la app lenta y se repite, reinicia Colmena cuando no haya trabajo en marcha." });
  out.push({ id: "server:version", group: "servidor", title: "Versión", status: "off", text: `Colmena ${version || "?"} · Node ${process.versions.node} · ${os.platform() === "win32" ? "Windows" : os.platform()} · ${running} ${running === 1 ? "trabajo" : "trabajos"} en marcha.` });
  return out;
}

async function appChecks({ connections, mcp }) {
  const out = [];
  if (connections) {
    const status = await withTimeout(connections.call("status").catch((e) => ({ error: e.message })), CHECK_MS, { error: "timeout" });
    if (status.error) out.push({ id: "apps:service", group: "apps", title: "Servicio de apps", status: "warn", text: status.error === "timeout" ? "No contesta a tiempo." : "No responde: " + status.error, fix: "Mira tu conexión a internet y vuelve a comprobar." });
    else if (!status.configured) out.push({ id: "apps:service", group: "apps", title: "Apps conectadas", status: "off", text: "Aún no has conectado ninguna app.", to: "/ajustes/conexiones" });
    else {
      const page = await withTimeout(connections.call("accounts", { cursor: "" }).catch((e) => ({ error: e.message })), CHECK_MS, { error: "timeout" });
      const items = page.items || [];
      if (page.error) out.push({ id: "apps:accounts", group: "apps", title: "Cuentas de apps", status: "warn", text: "No pude leer tus cuentas: " + (page.error === "timeout" ? "no contesta a tiempo" : page.error) + ".", fix: "Vuelve a comprobar en un momento." });
      for (const a of items) {
        const name = a.alias || a.toolkit || "App";
        out.push(a.status === "ACTIVE"
          ? { id: "apps:" + a.id, group: "apps", title: name, status: "ok", text: "Conectada." }
          : { id: "apps:" + a.id, group: "apps", title: name, status: "warn", text: a.status === "INITIATED" ? "Falta terminar la autorización." : "Hay que volver a conectarla.", fix: "Ábrela en Apps y conexiones y pulsa «Volver a conectar».", to: "/ajustes/conexiones" });
      }
      if (!page.error && !items.length) out.push({ id: "apps:accounts", group: "apps", title: "Cuentas de apps", status: "off", text: "Ninguna cuenta conectada todavía.", to: "/ajustes/conexiones" });
    }
  }
  for (const s of (() => { try { return mcp?.servers?.() || []; } catch { return []; } })()) {
    out.push(s.status === "connected"
      ? { id: "mcp:" + s.id, group: "apps", title: s.name, status: "ok", text: `Conexión directa · ${s.toolCount} ${s.toolCount === 1 ? "acción" : "acciones"}.` }
      : { id: "mcp:" + s.id, group: "apps", title: s.name, status: "warn", text: s.status === "pending" ? "Pendiente de autorización." : s.error || "Hay que volver a conectarla.", fix: "Vuelve a conectarla en Apps y conexiones.", to: "/ajustes/conexiones" });
  }
  return out;
}

const GROUP_TIMEOUT = (group) => [{ id: group + ":timeout", group, title: "Comprobación", status: "warn", text: "Tardó demasiado y se paró.", fix: "Vuelve a comprobar en un momento." }];

/** Runs every check in parallel; one slow group never holds the others. */
export async function runDiagnostics({ store, runtime = null, connections = null, stalls = null, version = null, deps = {} }) {
  const started = Date.now();
  const directory = store.directory;
  const running = (() => { try { return store.list("missions").filter((m) => ["running", "planning", "queued"].includes(m.status)).length; } catch { return 0; } })();
  const guard = (group, job) => withTimeout(Promise.resolve().then(job).catch((e) => [{ id: group + ":error", group, title: "Comprobación", status: "warn", text: "No se pudo comprobar: " + e.message }]), CHECK_MS * 2.5, GROUP_TIMEOUT(group));
  const groups = await Promise.all([
    guard("ia", () => aiChecks({ provider: runtime?.provider, probeClaude: deps.probeClaude })),
    guard("codigo", () => codeChecks({ directory, find: deps.find, probe: deps.probe })),
    guard("datos", () => dataChecks({ directory, integrity: deps.integrity, disk: deps.disk })),
    guard("servidor", () => serverChecks({ stalls, version, running })),
    guard("apps", () => appChecks({ connections, mcp: runtime?.mcp })),
  ]);
  const checks = groups.flat();
  const summary = { ok: 0, warn: 0, fail: 0, off: 0 };
  for (const c of checks) summary[c.status] = (summary[c.status] || 0) + 1;
  return { at: new Date().toISOString(), ms: Date.now() - started, checks, summary };
}

export function registerDiagnosticsRoutes(app, { store, runtime, connections, version }) {
  let running = null; // one run at a time: a second click waits for the same answer
  app.get("/api/diagnostics", async (_req, res) => {
    running ||= runDiagnostics({ store, runtime, connections, stalls: app.locals.stalls, version }).finally(() => { running = null; });
    res.json(await running);
  });
}

export const _test = { aiChecks, codeChecks, dataChecks, serverChecks, appChecks };
