// Development servers of projects, in the background: one per project, on a free port of
// 127.0.0.1 that Colmena assigns (only those ports open in the bots' browser). A static
// project (index.html, no package.json) is served by Colmena itself: nothing of the bot runs
// on this computer. A Node project runs its «dev» script (Vite directly with node).
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { safePath } from "../files.mjs";
import { killTree, nodeExecutable, npmCli, projectEnv, readPackage, scriptCommand } from "./run.mjs";

export const PORT_RANGE = [5200, 5299];
export const MAX_SERVERS = 3;
const LOG_LINES = 400;
const READY_MS = 45000;

const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", txt: "text/plain; charset=utf-8", woff: "font/woff",
  woff2: "font/woff2", ttf: "font/ttf", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm", wasm: "application/wasm", map: "application/json",
};

/** True when nothing listens on 127.0.0.1:port. */
export function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/** How a project is served: {kind:'static'} or {kind:'node', script:'dev'}. */
export async function serveKind(root) {
  const pkg = await readPackage(root);
  if (pkg?.scripts?.dev) return { kind: "node", script: "dev", pkg };
  if (pkg?.scripts?.start) return { kind: "node", script: "start", pkg };
  if (existsSync(path.join(root, "index.html"))) return { kind: "static" };
  throw Error(pkg ? "El package.json no tiene un script «dev» ni «start» para arrancar el servidor." : "El proyecto no tiene index.html ni package.json: no hay nada que servir.");
}

/** Port flags for the dev tools Colmena knows; the rest get PORT/HOST in the environment. */
export function portArgs(line, port) {
  const tool = String(line || "").trim().split(/\s+/)[0];
  if (/^(vite|astro)$/.test(tool)) return ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  if (tool === "next") return ["-H", "127.0.0.1", "-p", String(port)];
  return [];
}

function staticHandler(root, log) {
  return async (req, res) => {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(body);
      log(req.method + " " + req.url + " → " + status);
    };
    if (!["GET", "HEAD"].includes(req.method)) return send(405, "Método no permitido");
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).replace(/^\/+/, ""); } catch { return send(400, "Ruta no válida"); }
    if (!rel || rel.endsWith("/")) rel += "index.html";
    try {
      let target = await safePath(root, rel);
      let info = await lstat(target);
      if (info.isDirectory()) { target = await safePath(root, rel + "/index.html"); info = await lstat(target); }
      if (!info.isFile()) return send(404, "No encontrado");
      const ext = path.extname(target).slice(1).toLowerCase();
      send(200, req.method === "HEAD" ? "" : await readFile(target), TYPES[ext] || "application/octet-stream");
    } catch {
      send(404, "No encontrado: /" + rel);
    }
  };
}

const waitHttp = (port, { timeoutMs, stopped }) => new Promise((resolve, reject) => {
  const until = Date.now() + timeoutMs;
  const tryOnce = () => {
    if (stopped()) return reject(Error("El servidor se detuvo al arrancar."));
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("timeout", () => req.destroy());
    req.on("error", () => {
      if (Date.now() > until) return reject(Error("El servidor no respondió en " + Math.round(timeoutMs / 1000) + " s."));
      setTimeout(tryOnce, 300).unref?.();
    });
  };
  tryOnce();
});

export class DevServers {
  constructor({ portRange = PORT_RANGE, max = MAX_SERVERS, spawnImpl = spawn, readyMs = READY_MS, isFree = portFree, onStop = null } = {}) {
    Object.assign(this, { portRange, max, spawnImpl, readyMs, isFree, onStop });
    this.servers = new Map(); // missionId:project → server
    this.listeners = new Set();
  }
  key(missionId, project) { return missionId + ":" + project; }
  get(missionId, project) { return this.servers.get(this.key(missionId, project)) || null; }
  emit(server) { for (const fn of [...this.listeners]) { try { fn(this.view(server)); } catch {} } }

  log(server, text) {
    for (const line of String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      server.logs.push(line.slice(0, 2000));
      if (server.logs.length > LOG_LINES) server.logs.shift();
    }
  }

  async freePort() {
    const used = new Set([...this.servers.values()].filter((s) => s.status !== "stopped").map((s) => s.port));
    for (let port = this.portRange[0]; port <= this.portRange[1]; port++)
      if (!used.has(port) && (await this.isFree(port))) return port;
    throw Error("No queda ningún puerto libre para el servidor de desarrollo.");
  }

  /** Public view (no process handles). */
  view(s, { lines = 30 } = {}) {
    if (!s) return null;
    return {
      id: s.id, missionId: s.missionId, project: s.project, kind: s.kind, port: s.port, url: s.port ? "http://127.0.0.1:" + s.port + "/" : null,
      status: s.status, command: s.command, startedAt: s.startedAt, stoppedAt: s.stoppedAt || null, exitCode: s.exitCode ?? null,
      error: s.error || null, logs: lines ? s.logs.slice(-lines) : [],
    };
  }
  list(missionId) {
    return [...this.servers.values()].filter((s) => !missionId || s.missionId === missionId).map((s) => this.view(s, { lines: 12 }));
  }
  running() { return [...this.servers.values()].filter((s) => ["starting", "running"].includes(s.status)); }

  /**
   * Starts (or returns) the server of a project. kind from serveKind(root).
   * @returns {Promise<view>}
   */
  async start({ missionId, project, root, plan = null }) {
    // The real path (redirected folders, junctions, packaged-app virtualization): Vite resolves
    // files by their real path and refuses to serve any outside its root.
    try { root = realpathSync.native(root); } catch {}
    const existing = this.get(missionId, project);
    if (existing && ["starting", "running"].includes(existing.status)) {
      if (existing.ready) await existing.ready.catch(() => {});
      return this.view(existing);
    }
    if (this.running().length >= this.max)
      throw Error("Ya hay " + this.max + " servidores de desarrollo en marcha. Para alguno con project_server (action stop).");
    const how = plan || (await serveKind(root));
    const port = await this.freePort();
    const server = { id: this.key(missionId, project), missionId, project, root, port, kind: how.kind, status: "starting", logs: [], startedAt: new Date().toISOString(), command: null };
    this.servers.set(server.id, server);
    this.emit(server);
    if (how.kind === "static") {
      server.command = "servidor estático de Colmena";
      server.http = http.createServer(staticHandler(root, (line) => this.log(server, line)));
      await new Promise((resolve, reject) => {
        server.http.once("error", reject);
        server.http.listen(port, "127.0.0.1", resolve);
      }).catch((error) => { server.status = "failed"; server.error = error.message; this.emit(server); throw Error("No se pudo abrir el puerto " + port + ": " + error.message); });
      server.status = "running";
      this.log(server, "Sirviendo " + project + " en http://127.0.0.1:" + port + "/");
      this.emit(server);
      return this.view(server);
    }
    const pkg = how.pkg || (await readPackage(root));
    const cmd = await scriptCommand(root, pkg, how.script, portArgs(pkg.scripts[how.script], port), { npm: () => npmCli() });
    server.command = cmd.line;
    this.log(server, "> " + cmd.line);
    let child;
    try {
      child = this.spawnImpl(cmd.file || nodeExecutable(), cmd.args, { cwd: root, env: projectEnv({ port }), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      server.status = "failed";
      server.error = "No se pudo iniciar: " + error.message;
      this.emit(server);
      throw Error(server.error);
    }
    server.child = child;
    child.stdout?.on("data", (d) => this.log(server, d));
    child.stderr?.on("data", (d) => this.log(server, d));
    child.on("error", (error) => { server.error = error.message; this.log(server, "Error: " + error.message); });
    child.on("close", (code) => {
      server.exitCode = code;
      if (server.status !== "stopped") server.status = server.status === "starting" || code ? "failed" : "stopped";
      server.stoppedAt = new Date().toISOString();
      this.log(server, "El servidor terminó" + (code != null ? " (código " + code + ")" : "") + ".");
      this.onStop?.(this.view(server));
      this.emit(server);
    });
    server.ready = waitHttp(port, { timeoutMs: this.readyMs, stopped: () => server.status !== "starting" });
    try {
      await server.ready;
      server.status = "running";
      this.emit(server);
    } catch (error) {
      server.error = error.message;
      if (server.status === "starting") { server.status = "failed"; killTree(child, { spawnImpl: this.spawnImpl }); }
      this.emit(server);
      const tail = server.logs.slice(-25).join("\n");
      throw Object.assign(Error("No arrancó el servidor de desarrollo: " + error.message + (tail ? "\nÚltimas líneas:\n" + tail : "")), { logs: server.logs.slice(-40) });
    }
    return this.view(server);
  }

  async stop(missionId, project) {
    const server = this.get(missionId, project);
    if (!server || !["starting", "running"].includes(server.status)) return this.view(server) || { project, status: "stopped" };
    server.status = "stopped";
    server.stoppedAt = new Date().toISOString();
    if (server.http) {
      await new Promise((resolve) => { server.http.closeAllConnections?.(); server.http.close(() => resolve()); });
      this.log(server, "Servidor parado.");
      this.onStop?.(this.view(server));
    } else if (server.child) {
      // Wait for it to exit (at most 5 s): its files stay locked while it runs.
      const closed = server.child.exitCode != null ? Promise.resolve() : new Promise((resolve) => server.child.once("close", resolve));
      killTree(server.child, { spawnImpl: this.spawnImpl });
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000).unref?.())]);
    }
    this.emit(server);
    return this.view(server);
  }

  async stopMission(missionId) {
    for (const s of [...this.servers.values()]) if (s.missionId === missionId) await this.stop(missionId, s.project);
  }

  /** Mission of a running server on this port (the browser opens only those). */
  missionOfPort(port) {
    const s = [...this.servers.values()].find((x) => x.port === Number(port) && ["starting", "running"].includes(x.status));
    return s ? s.missionId : null;
  }

  shutdown() {
    for (const s of this.servers.values()) {
      if (!["starting", "running"].includes(s.status)) continue;
      s.status = "stopped";
      try { s.http?.close(); } catch {}
      if (s.child) killTree(s.child, { spawnImpl: this.spawnImpl });
    }
  }
}
