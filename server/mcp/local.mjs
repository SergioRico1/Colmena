// Official open-source MCP servers that Colmena runs for you (catalog entries with run "local":
// Google Analytics, Google Ads). They speak MCP over stdio, started through the process seam
// (server/machine/seam.mjs): a child of this computer on the desktop, a program in the company's
// machine in the cloud (POST /machine/mcp, served by server/machine/serve.mjs with this same host).
//
// A spec is {command, args, env, files}: `files` are written to a private folder only for that
// process (mode 0600) and removed when it stops; "${file:<name>}" in an env value becomes its
// path. That is how a Google authorized-user credential reaches the server without ever being
// written anywhere else: the vault (or the request to the machine) → that folder → gone.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const IDLE_MS = 5 * 60000;
const CALL_TIMEOUT_MS = 120000;
const KEY = /^[A-Za-z0-9:._-]{1,120}$/;

/** MCP over a seam child's stdin/stdout, one JSON-RPC message per line. */
export class SpawnStdioTransport {
  constructor(spawn, { command, args = [], env = {}, cwd = undefined }) {
    Object.assign(this, { spawnImpl: spawn, command, args, env, cwd, child: null, buffer: "", stderr: "" });
  }
  async start() {
    const child = this.spawnImpl(this.command, this.args, { cwd: this.cwd, env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...this.env }, stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
    this.child = child;
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      let nl;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).replace(/\r$/, "");
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; } // a log line on stdout is not a message
        try { this.onmessage?.(msg); } catch (error) { this.onerror?.(error); }
      }
    });
    child.stderr?.on("data", (chunk) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4000); });
    child.on("error", (error) => this.onerror?.(Error("No se pudo iniciar " + this.command + ": " + error.message)));
    child.on("close", () => { this.child = null; this.onclose?.(); });
  }
  async send(message) {
    if (!this.child?.stdin) throw Error("El servidor local no está en marcha.");
    await new Promise((resolve, reject) => this.child.stdin.write(JSON.stringify(message) + "\n", (e) => (e ? reject(e) : resolve())));
  }
  /** Stops the child and waits for it to exit (at most 3 s), so its folder can be removed. */
  async close() {
    const child = this.child;
    if (!child) return;
    const gone = child.exitCode != null ? Promise.resolve() : new Promise((resolve) => { child.once("close", resolve); const t = setTimeout(resolve, 3000); t.unref?.(); });
    try { child.stdin?.end(); child.kill(); } catch {}
    await gone;
    this.child = null;
  }
}

/**
 * Keeps one running server per key (a person's connection), stopped after IDLE_MS without use.
 * `spawn`: the seam's spawn. `dir`: where the per-process private folders go.
 */
export class LocalMcpHost {
  constructor({ spawn, dir, idleMs = IDLE_MS }) {
    Object.assign(this, { spawnImpl: spawn, dir, idleMs, live: new Map() });
  }
  async open(key, spec) {
    if (!KEY.test(String(key || ""))) throw Error("Servidor local no válido.");
    const old = this.live.get(key);
    if (old && old.fingerprint === JSON.stringify(spec)) { this.touch(key); return old.client; }
    if (old) await this.close(key);
    const folder = path.join(this.dir, key.replace(/[^A-Za-z0-9_-]/g, "_") + "-" + randomBytes(6).toString("hex"));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const files = {};
    for (const [name, content] of Object.entries(spec.files || {})) {
      if (!/^[A-Za-z0-9._-]{1,60}$/.test(name)) throw Error("Archivo no válido.");
      files[name] = path.join(folder, name);
      await writeFile(files[name], typeof content === "string" ? content : JSON.stringify(content), { mode: 0o600 });
    }
    const env = Object.fromEntries(Object.entries(spec.env || {}).map(([k, v]) => [k, String(v).replace(/\$\{file:([A-Za-z0-9._-]+)\}/g, (_, n) => files[n] || "")]));
    const transport = new SpawnStdioTransport(this.spawnImpl, { command: spec.command, args: spec.args || [], env, cwd: folder });
    const client = new Client({ name: "Colmena", version: "1.0.0" });
    const entry = { client, transport, folder, fingerprint: JSON.stringify(spec), timer: null };
    this.live.set(key, entry);
    transport.onclose = () => { if (this.live.get(key) === entry) { this.live.delete(key); clearTimeout(entry.timer); rm(folder, { recursive: true, force: true }).catch(() => {}); } };
    try {
      await client.connect(transport);
    } catch (error) {
      await this.close(key);
      const why = transport.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300);
      throw Error("No se pudo arrancar " + spec.command + (why ? ": " + why : ": " + error.message));
    }
    this.touch(key);
    return client;
  }
  touch(key) {
    const e = this.live.get(key);
    if (!e) return;
    clearTimeout(e.timer);
    e.timer = setTimeout(() => this.close(key), this.idleMs);
    e.timer.unref?.();
  }
  async listTools(key, spec) {
    const client = await this.open(key, spec);
    const tools = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const out = await client.listTools(cursor ? { cursor } : {});
      tools.push(...(out.tools || []));
      cursor = out.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }
  async callTool(key, spec, name, args, { timeout = CALL_TIMEOUT_MS } = {}) {
    const client = await this.open(key, spec);
    try { return await client.callTool({ name, arguments: args }, undefined, { timeout }); } finally { this.touch(key); }
  }
  async close(key) {
    const e = this.live.get(key);
    if (!e) return;
    this.live.delete(key);
    clearTimeout(e.timer);
    try { await e.client.close(); } catch {}
    try { await e.transport.close(); } catch {}
    await rm(e.folder, { recursive: true, force: true }).catch(() => {});
  }
  async shutdown() { for (const key of [...this.live.keys()]) await this.close(key); }
}

/** The same surface, run in the company's machine (the seam's `request` to /machine/mcp). */
export function machineMcp(machine) {
  const call = async (body) => {
    const res = await machine.request("/machine/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Error(data.error || "La máquina de tu empresa no ha podido arrancar el servidor.");
    return data;
  };
  return {
    kind: "machine",
    listTools: async (key, spec) => (await call({ op: "list", key, spec })).tools || [],
    callTool: async (key, spec, name, args) => (await call({ op: "call", key, spec, name, arguments: args })).result,
    close: async (key) => { await call({ op: "close", key }).catch(() => {}); },
    shutdown: async () => {},
  };
}

/** The machine's side of /machine/mcp (server/machine/serve.mjs). */
export function machineMcpRoute(host) {
  return async (req, res) => {
    const { op, key, spec, name, arguments: args } = req.body || {};
    const okSpec = (s) => s && typeof s.command === "string" && /^\/opt\/mcp\/bin\/[A-Za-z0-9._-]{1,60}$|^[A-Za-z0-9._-]{1,60}$/.test(s.command) && (s.args || []).every((a) => typeof a === "string");
    try {
      if (op === "close") { await host.close(String(key)); return res.json({ ok: true }); }
      if (!okSpec(spec)) return res.status(400).json({ error: "Servidor local no válido." });
      if (op === "list") return res.json({ tools: await host.listTools(String(key), spec) });
      if (op === "call") return res.json({ result: await host.callTool(String(key), spec, String(name), args && typeof args === "object" ? args : {}) });
      res.status(400).json({ error: "Operación no válida." });
    } catch (error) {
      res.status(422).json({ error: String(error.message || error).slice(0, 400) });
    }
  };
}
