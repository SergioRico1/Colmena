// The machine of a hosted workspace (docs/CLOUD.md › Phase 4): what needs processes and a real
// filesystem, served over HTTP from inside the workspace's container. The Workspace Durable Object
// is the brain (the store, people, approvals); this is its hands. It runs the desktop's own code
// unchanged on a Linux disk:
//
//   /api/code/*                   «Código» (server/code: projects, tasks, worktrees, engines, terminals)
//   POST /api/code/cloud/import   a repository sent as a git bundle becomes a project (with a local bare
//                                 «origin» when asked, so tests can push without any real host)
//   POST /machine/run             one program, no shell, its output streamed as NDJSON (run_command)
//   POST /machine/office/pdf      an Office document → PDF with LibreOffice (server/officepdf.mjs)
//   POST /machine/mcp             an official local MCP server (server/mcp/local.mjs): list / call / close
//   ALL  /machine/port/:n/*       a dev server of the container (127.0.0.1:n), for previews
//   GET  /machine/health          {ok, busy}: whether engines or terminals are working
//   GET  /machine/backup          the work folder as a .tar.gz (the Machine DO keeps it in R2)
//   POST /machine/restore         (before /machine/begin only: bootServer) puts a backup back
//
// Who asks comes in headers the Machine DO sets: X-Colmena-Person {id, name, role},
// X-Colmena-Engine-Keys (base64url JSON of that person's API keys, only for «Código» calls),
// X-Colmena-Fake-Engine (tests: the fake Claude Code). Every request needs X-Machine-Token.
// Nothing listens anywhere but this one port, which only the Machine DO can reach.
import express from "express";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Store } from "../store.mjs";
import { CodeService } from "../code/service.mjs";
import { registerCodeRoutes, codeUploadParser } from "../code/routes.mjs";
import { createOfficeConverter, libreOfficeEngine } from "../officepdf.mjs";
import { asPerson } from "../identity.mjs";
import { slug } from "../code/git.mjs";
import { LocalMcpHost, machineMcpRoute } from "../mcp/local.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The fake Claude Code of the cloud tests (cloud/container/fake-claude-code.mjs). */
export const FAKE_ENGINE = process.env.COLMENA_FAKE_ENGINE || path.resolve(HERE, "../../cloud/container/fake-claude-code.mjs");
export const RUN_LIMITS = Object.freeze({ timeoutMs: 120000, maxBytes: 200 * 1024 });
export const API_KEY_ONLY = "En la nube, Código trabaja con tu propia clave de API (Ajustes › Tu cuenta de IA): las suscripciones de Claude y ChatGPT no se pueden usar en un servicio alojado.";

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};
const header = (req, name) => String(req.headers[name] || "");
const decodeKeys = (value) => {
  if (!value) return {};
  try { const k = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); return k && typeof k === "object" ? k : {}; } catch { return {}; }
};
const exec = (file, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 600000, ...opts }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr: String(stderr || "") })) : resolve(String(stdout || ""))));
});

/**
 * @param {object} o
 * @param {string} o.work       the persistent work folder (HOME): projects, the store, engine homes
 * @param {string} o.token      X-Machine-Token every request must bring
 * @param {Buffer} o.storeKey   32 bytes: the machine's store is encrypted with it
 * @param {object} [o.office]   an office converter (tests); default LibreOffice of this machine
 * @param {Function} [o.spawnImpl]
 */
export function createMachine({ work, token, storeKey, office = null, spawnImpl = spawn, log = (m) => console.log("[machine] " + m) }) {
  if (!work || !token || !storeKey || storeKey.length !== 32) throw Error("createMachine: work, token and a 32-byte storeKey are required.");
  const data = path.join(work, ".colmena");
  const store = new Store(data, { keyProvider: () => storeKey });
  const code = new CodeService({ store, directory: data });
  const realCommand = code.command, realCodex = code.codexCommand;
  // Each person's keys, as the last «Código» request of theirs brought them (memory only).
  const keys = new Map();
  const engineHome = (kind, personId) => path.join(work, ".engines", kind + "-" + createHash("sha256").update(String(personId || "x")).digest("hex").slice(0, 16));
  code.engineEnv = async (task) => {
    if (fake) return {};
    const personId = task.cloudPerson || null;
    const mine = keys.get(personId) || {};
    if (task.engine === "codex") {
      if (!mine.openai) throw Object.assign(Error(API_KEY_ONLY), { status: 400 });
      // Codex reads an API key login from CODEX_HOME/auth.json (what `codex login --with-api-key` writes).
      const home = engineHome("codex", personId);
      await mkdir(home, { recursive: true });
      await writeFile(path.join(home, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: mine.openai, tokens: null, last_refresh: null }), { mode: 0o600 });
      return { CODEX_HOME: home, OPENAI_API_KEY: mine.openai };
    }
    if (task.engine === "opencode") {
      const env = { ...(mine.anthropic ? { ANTHROPIC_API_KEY: mine.anthropic } : {}), ...(mine.openai ? { OPENAI_API_KEY: mine.openai } : {}), ...(mine.opencode ? { OPENCODE_API_KEY: mine.opencode } : {}) };
      if (!Object.keys(env).length) throw Object.assign(Error(API_KEY_ONLY), { status: 400 });
      return { ...env, XDG_DATA_HOME: engineHome("opencode", personId) };
    }
    if (!mine.anthropic) throw Object.assign(Error(API_KEY_ONLY), { status: 400 });
    // Claude Code with an API key and a home of this person's: never a subscription sign-in.
    const home = engineHome("claude", personId);
    await mkdir(home, { recursive: true });
    return { ANTHROPIC_API_KEY: mine.anthropic, CLAUDE_CONFIG_DIR: home };
  };
  let fake = false;
  const setFake = (on) => {
    if (on === fake) return;
    fake = on;
    code.command = on ? [process.execPath, FAKE_ENGINE] : realCommand;
    code.codexCommand = on ? null : realCodex;
    code.codexList = null;
  };
  const converter = office || createOfficeConverter({ cacheDir: path.join(data, "cache", "office-pdf"), engines: [libreOfficeEngine()] });
  let lastUse = Date.now();
  const running = new Set(); // /machine/run children
  const mcpHost = new LocalMcpHost({ spawn: spawnImpl, dir: path.join(work, ".mcp-run") });

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!sameToken(header(req, "x-machine-token"), token)) return res.status(401).json({ error: "machine token" });
    lastUse = Date.now();
    let person = null;
    try { person = JSON.parse(header(req, "x-colmena-person") || "null"); } catch {}
    setFake(header(req, "x-colmena-fake-engine") === "1");
    // GitHub (clone, push, pull requests): the token of whoever asks, or the company's. git and
    // gh read it from the environment (the credential helper set at boot), never from a file.
    const gh = header(req, "x-colmena-github-token");
    if (req.headers["x-colmena-github-token"] !== undefined) {
      if (/^[A-Za-z0-9_]{20,255}$/.test(gh)) { process.env.GH_TOKEN = gh; process.env.GITHUB_TOKEN = gh; }
      else { delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN; }
    }
    if (person?.id) {
      const k = decodeKeys(header(req, "x-colmena-engine-keys"));
      if (Object.keys(k).length || req.headers["x-colmena-engine-keys"] !== undefined) keys.set(person.id, { anthropic: k.anthropic || null, openai: k.openai || null, opencode: k.opencode || null });
      req.person = { id: String(person.id), name: person.name || null, email: person.email || null, role: person.role || "member" };
      return asPerson(req.person, next);
    }
    next();
  });

  // A task remembers who last wrote in it: its engine runs with that person's key.
  app.use((req, _res, next) => {
    const m = /^\/api\/code\/tasks\/([^/]+)\/(messages|goal)$/.exec(req.path);
    if (req.method === "POST" && m && req.person) { const t = store.get("codeTasks", m[1]); if (t) store.patch("codeTasks", t.id, { cloudPerson: req.person.id }); }
    next();
  });
  app.use(codeUploadParser);
  app.use("/machine/port", portProxy);
  app.use(express.json({ limit: "2mb" }));

  // The cloud never opens a folder of someone's computer: projects are clones, bundles or new.
  app.post("/api/code/projects", (req, res, next) => (req.body?.folder ? res.status(400).json({ error: "En la nube no hay carpetas de tu ordenador: clona un repositorio o empieza uno nuevo." }) : next()));
  // A new task is stamped with who created it (their key runs its first turn).
  app.post("/api/code/tasks", (req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => { if (body?.task?.id && req.person) { try { store.patch("codeTasks", body.task.id, { cloudPerson: req.person.id }); } catch {} } return send(body); };
    next();
  });
  app.post("/api/code/cloud/import", express.raw({ type: "*/*", limit: "200mb" }), async (req, res) => {
    try {
      const name = slug(String(req.query.name || "proyecto")) || "proyecto";
      const parent = path.join(work, "Colmena");
      let dir = path.join(parent, name);
      for (let n = 2; existsSync(dir); n++) dir = path.join(parent, name + "-" + n);
      await mkdir(parent, { recursive: true });
      const bundle = path.join(os.tmpdir(), "colmena-" + randomUUID() + ".bundle");
      await writeFile(bundle, req.body);
      try {
        await exec("git", ["clone", "-q", "--", bundle, dir]);
        if (req.query.origin === "local") {
          // A bare repository in the machine stands in for GitHub: pushes and PR branches land there.
          const remote = path.join(work, "remotes", path.basename(dir) + ".git");
          await mkdir(path.dirname(remote), { recursive: true });
          await exec("git", ["clone", "-q", "--bare", "--", bundle, remote]);
          await exec("git", ["remote", "set-url", "origin", remote], { cwd: dir });
        }
      } finally { await rm(bundle, { force: true }); }
      await exec("git", ["config", "user.email", "bruno@colmena.invalid"], { cwd: dir });
      await exec("git", ["config", "user.name", "Colmena"], { cwd: dir });
      res.json({ project: await code.addProject({ folder: dir }) });
    } catch (error) {
      res.status(error.status || 422).json({ error: "No se pudo importar el repositorio: " + String(error.stderr || error.message).slice(0, 300) });
    }
  });
  registerCodeRoutes(app, { code });

  // ---- one program, no shell (run_command): its output as NDJSON lines while it runs
  app.post("/machine/run", (req, res) => {
    const { file, args = [], cwd = null, env = null, timeoutMs = RUN_LIMITS.timeoutMs } = req.body || {};
    if (typeof file !== "string" || !file || !Array.isArray(args) || args.some((a) => typeof a !== "string")) return res.status(400).json({ error: "Programa no válido." });
    const folder = path.resolve(work, String(cwd || "missions/tmp").replace(/^\/+/, ""));
    if (!folder.startsWith(path.resolve(work) + path.sep)) return res.status(400).json({ error: "Carpeta fuera de la máquina." });
    res.set({ "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    const line = (o) => { try { res.write(JSON.stringify(o) + "\n"); } catch {} };
    mkdir(folder, { recursive: true }).then(() => {
      let child;
      try {
        child = spawnImpl(file, args, { cwd: folder, env: { PATH: process.env.PATH, HOME: work, LANG: "C.UTF-8", ...(env && typeof env === "object" ? env : {}) }, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: true });
      } catch (error) { line({ error: "No se pudo iniciar el programa: " + error.message }); return res.end(); }
      running.add(child);
      let used = 0;
      const pipe = (stream, kind) => stream.on("data", (chunk) => {
        if (used >= RUN_LIMITS.maxBytes) return;
        const piece = chunk.subarray(0, RUN_LIMITS.maxBytes - used);
        used += piece.length;
        line({ [kind]: piece.toString("base64") });
      });
      pipe(child.stdout, "out");
      pipe(child.stderr, "err");
      const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } };
      const timer = setTimeout(() => { line({ timedOut: true }); kill(); }, Math.min(Number(timeoutMs) || RUN_LIMITS.timeoutMs, 600000));
      res.on("close", () => { if (child.exitCode == null && !res.writableFinished) kill(); });
      child.on("error", (error) => { clearTimeout(timer); running.delete(child); line({ error: "No se pudo ejecutar: " + error.message }); res.end(); });
      child.on("close", (exitCode) => { clearTimeout(timer); running.delete(child); line({ exit: exitCode }); res.end(); });
    }).catch((error) => { line({ error: error.message }); res.end(); });
  });

  // ---- official local MCP servers (Google Analytics…): stdio children kept per connection,
  // their credential file only in a private folder of /work/.mcp-run while they run
  app.post("/machine/mcp", machineMcpRoute(mcpHost));

  // ---- Office → PDF
  app.post("/machine/office/pdf", express.raw({ type: "*/*", limit: "60mb" }), async (req, res) => {
    const ext = String(req.query.ext || "").toLowerCase();
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableFinished) controller.abort(); });
    try {
      const out = await converter.convert(Buffer.from(req.body || []), ext, { source: String(req.query.source || "") || null, signal: controller.signal });
      res.set({ "Content-Type": "application/pdf", "X-Office-Engine": encodeURIComponent(out.engine || ""), "X-Office-Missing-Fonts": encodeURIComponent(JSON.stringify(out.missingFonts || [])), "X-Office-Cached": out.cached ? "1" : "0" });
      res.end(out.pdf);
    } catch (error) {
      res.status(error.code === "TOO_BIG" ? 413 : error.code === "UNSUPPORTED" ? 415 : 422).json({ error: error.message, code: error.code || "FAILED" });
    }
  });

  // ---- PDF pages for previews (pdfjs + @napi-rs/canvas live here, not in the Worker)
  app.post("/machine/pdf/pages", express.raw({ type: "*/*", limit: "60mb" }), async (req, res) => {
    try { const { openPdf } = await import("../documents.mjs"); const { task, pdf } = await openPdf(Buffer.from(req.body || [])); try { res.json({ pages: pdf.numPages }); } finally { await task.destroy().catch(() => {}); } }
    catch (error) { res.status(422).json({ error: error.message }); }
  });
  app.post("/machine/pdf/page", express.raw({ type: "*/*", limit: "60mb" }), async (req, res) => {
    try {
      const { renderPdfPage } = await import("../pdfforms.mjs");
      const out = await renderPdfPage(Buffer.from(req.body || []), Number(req.query.n) || 1, { width: Number(req.query.width) || 900 });
      res.set({ "Content-Type": "image/png", "X-Pdf-Pages": String(out.pages) });
      res.end(out.png);
    } catch (error) { res.status(error.status || 422).json({ error: error.message, code: error.code || "FAILED" }); }
  });

  // ---- health, backup and restore of the work folder
  const busy = () => [...code.engines.values()].some((e) => e.engine?.alive && e.turn) || running.size > 0 || (code.terminals?.count?.() || 0) > 0;
  app.get("/machine/health", (_req, res) => res.json({ ok: true, busy: busy(), idleMs: Date.now() - lastUse, uptime: Math.round(process.uptime()) }));
  app.get("/machine/backup", (req, res) => {
    res.set({ "Content-Type": "application/gzip", "Cache-Control": "no-store" });
    // Engine caches and node_modules come back with an install; the rest is the work.
    const tar = spawn("tar", ["-czf", "-", "--exclude=./.colmena/cache", "--exclude=./.cache", "--exclude=./.npm", "--exclude=./.mcp-run", "-C", work, "."], { stdio: ["ignore", "pipe", "ignore"] });
    tar.stdout.pipe(res);
    res.on("close", () => { if (!res.writableFinished) try { tar.kill(); } catch {} });
  });

  app.use((err, _req, res, _next) => {
    const status = err?.status || (err?.name === "ZodError" ? 400 : 500);
    if (status >= 500) log("error: " + (err?.stack || err));
    res.status(status).json({ error: err?.name === "ZodError" ? "Datos no válidos." : status >= 500 ? "Algo ha fallado en la máquina." : err.message });
  });

  /** ALL /machine/port/:port/* → http://127.0.0.1:port/* (a task's dev server, for its preview). */
  function portProxy(req, res) {
    const m = /^\/(\d{2,5})(\/.*)?$/.exec(req.url);
    const port = m ? Number(m[1]) : 0;
    if (!port || port === Number(process.env.MACHINE_PORT || 8080) || port > 65535) return res.status(400).json({ error: "Puerto no válido." });
    const headers = { ...req.headers, host: "127.0.0.1:" + port };
    for (const h of ["x-machine-token", "x-colmena-person", "x-colmena-engine-keys", "x-colmena-fake-engine", "cookie", "authorization"]) delete headers[h];
    const upstream = http.request({ host: "127.0.0.1", port, method: req.method, path: m[2] || "/", headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.status(502).json({ error: "No hay nada escuchando en el puerto " + port + "." }); else res.end(); });
    req.pipe(upstream);
  }

  return {
    app, code, store,
    close() {
      for (const c of running) { try { c.kill("SIGKILL"); } catch {} }
      try { code.shutdown(); } catch {}
      try { store.close(); } catch {}
    },
  };
}

/**
 * The container's server before and after the machine opens. A fresh container first gets its
 * work folder back (POST /machine/restore, a .tar.gz the Machine DO keeps in R2), then
 * POST /machine/begin opens the store and «Código»: nothing touches the disk before that.
 */
export function bootServer({ work, token, storeKey, create = createMachine }) {
  let machine = null;
  const server = http.createServer((req, res) => {
    if (machine) return machine.app(req, res);
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!sameToken(req.headers["x-machine-token"], token)) return json(401, { error: "machine token" });
    if (req.url === "/machine/health") return json(200, { ok: true, ready: false, uptime: Math.round(process.uptime()) });
    if (req.method === "POST" && req.url === "/machine/restore") {
      const tar = spawn("tar", ["-xzf", "-", "-C", work], { stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      tar.stderr.on("data", (d) => { err += d; });
      req.pipe(tar.stdin);
      return tar.on("close", (status) => (status === 0 ? json(200, { ok: true }) : json(422, { error: err.slice(0, 300) || "tar " + status })));
    }
    if (req.method === "POST" && req.url === "/machine/begin") {
      try { machine = create({ work, token, storeKey }); } catch (error) { return json(500, { error: error.message }); }
      return json(200, { ok: true, ready: true });
    }
    json(503, { error: "La máquina se está preparando.", starting: true });
  });
  return { server, machine: () => machine, close: () => machine?.close() };
}

// `node server/machine/serve.mjs` inside the container (cloud/container/Dockerfile).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const work = process.env.MACHINE_WORK || "/work";
  const port = Number(process.env.MACHINE_PORT || 8080);
  const storeKey = Buffer.from(String(process.env.MACHINE_STORE_KEY || ""), "hex");
  const token = process.env.MACHINE_TOKEN;
  // The engines and the commands it runs never see these.
  delete process.env.MACHINE_TOKEN;
  delete process.env.MACHINE_STORE_KEY;
  await mkdir(work, { recursive: true });
  const boot = bootServer({ work, token, storeKey });
  boot.server.listen(port, "0.0.0.0", () => console.log("[machine] listening on " + port));
  process.on("SIGTERM", () => { boot.close(); boot.server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
}
