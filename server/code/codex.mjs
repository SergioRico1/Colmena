// The second engine of a «Código» task: Codex of this computer (its own ChatGPT login), driven
// like T3 Code does — `codex app-server`, JSON-RPC over stdio, one process per task. Every
// command and file change Codex wants to make is asked to Colmena first (approval policy
// «untrusted» + the task's sandbox), so the same access and red lines apply as with Claude Code.
// Its stream is translated into the same events (see service.mjs onEvent).
import { spawn, execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeExecutable } from "../projects/run.mjs";

/** Codex: COLMENA_CODEX_CLI, else the npm install (run with node, no shell). */
export function findCodexCli(env = process.env) {
  if (env.COLMENA_CODEX_CLI) return env.COLMENA_CODEX_CLI.split("|");
  const appdata = env.APPDATA || path.join(env.USERPROFILE || os.homedir(), "AppData", "Roaming");
  const js = path.join(appdata, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (existsSync(js)) {
    // codex.js needs a real Node; the installed app's server runs on Electron's.
    try { return [nodeExecutable(), js]; } catch {}
  }
  for (const p of ["/usr/local/bin/codex", "/opt/homebrew/bin/codex"]) if (existsSync(p)) return [p];
  return null;
}

/** `codex login status` → {status:'available'|'missing'|'not_installed'}. */
export function probeCodex({ command = findCodexCli(), timeoutMs = 15000 } = {}) {
  if (!command) return Promise.resolve({ status: "not_installed" });
  const [exe, ...lead] = command;
  return new Promise((resolve) => {
    execFile(exe, [...lead, "login", "status"], { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      const said = String(stdout || "") + String(stderr || "");
      resolve({ status: /logged in/i.test(said) && !/not logged in/i.test(said) ? "available" : error?.killed ? "timeout" : "missing" });
    });
  });
}

const SANDBOX = { project: "workspace-write", ask: "read-only", full: "danger-full-access" };
const SANDBOX_POLICY = { project: { type: "workspaceWrite", networkAccess: true }, ask: { type: "readOnly", networkAccess: true }, full: { type: "dangerFullAccess" } };

/** «"…powershell.exe" -Command "…"» → the command itself (what the person reads and what is judged). */
export function unwrapCommand(command) {
  const c = String(command || "").trim();
  const m = /^"?[^"\s]*(?:powershell|pwsh|cmd)(?:\.exe)?"?\s+(?:-NoProfile\s+)?(?:-Command|\/c)\s+([\s\S]+)$/i.exec(c);
  if (!m) return c;
  const inner = m[1].trim();
  if (/^"[\s\S]*"$/.test(inner)) return inner.slice(1, -1).replace(/\\"/g, '"');
  if (/^'[\s\S]*'$/.test(inner)) return inner.slice(1, -1).replace(/''/g, "'");
  return inner;
}

/** A Codex item → the tool line the work log shows (Claude Code's tool names, so one vocabulary). */
export function toolOf(item) {
  if (item.type === "commandExecution") {
    const command = unwrapCommand(item.command);
    const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
    if (actions.length && actions.every((a) => a.type === "read")) return { name: "Read", input: { file_path: actions[0].path || actions[0].name, command } };
    if (actions.length && actions.every((a) => a.type === "search")) return { name: "Grep", input: { pattern: actions[0].query || "", path: actions[0].path || "" } };
    if (actions.length && actions.every((a) => a.type === "listFiles")) return { name: "Glob", input: { pattern: actions[0].path || ".", command } };
    return { name: "Bash", input: { command } };
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const added = changes.length === 1 && changes[0].kind?.type === "add";
    return { name: added ? "Write" : "Edit", input: { file_path: changes[0]?.path || "", paths: changes.map((c) => c.path) } };
  }
  if (item.type === "webSearch") return { name: "WebSearch", input: { query: item.query || item.action?.query || "" } };
  if (item.type === "mcpToolCall") return { name: `mcp__${item.server}__${item.tool}`, input: item.arguments || {} };
  if (item.type === "dynamicToolCall") return { name: item.tool || "tool", input: item.arguments || {} };
  if (item.type === "collabAgentToolCall") return { name: "Task", input: { description: item.prompt || "" } };
  if (item.type === "imageView") return { name: "Read", input: { file_path: item.path } };
  return null;
}

export class CodexEngine extends EventEmitter {
  /**
   * @param {object} o  cwd, model, effort, access, threadId (resume when set), instructions,
   *                    authorize(req) like ClaudeCodeEngine, command ([exe, ...args])
   */
  constructor(o) {
    super();
    this.o = o;
    this.kind = "codex";
    this.command = o.command || findCodexCli();
    this.pending = new Map();
    this.nextId = 1;
    this.alive = false;
    this.threadId = o.threadId || null;
    this.turnId = null;
    this.changes = new Map(); // fileChange item id → paths (for its approval)
    this.texts = new Map(); // agentMessage item id → text so far
    this.stderr = "";
    this.lastError = null;
  }

  async start() {
    if (!this.command) throw Object.assign(Error("No encuentro Codex en este ordenador."), { status: 503 });
    const [exe, ...lead] = this.command;
    // The person's own MCP servers are left out: they are slow to start and not for this task.
    this.proc = spawn(exe, [...lead, "app-server", "-c", "mcp_servers={}"], { cwd: this.o.cwd, env: { ...process.env, ...(this.o.env || {}) }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.pid = this.proc.pid;
    this.alive = true;
    let buffer = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        this.accept(m);
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (c) => { this.stderr = (this.stderr + c).slice(-4000); });
    this.proc.stdin.on("error", () => {});
    this.proc.on("error", (e) => this.finish(Object.assign(Error("No se pudo iniciar Codex: " + e.message), { status: 503 })));
    this.proc.on("exit", (code) => this.finish(this.closing ? null : Object.assign(Error("Codex se cerró (" + code + ")."), { detail: this.stderr.slice(-1500) })));
    await this.call("initialize", { clientInfo: { name: "colmena", title: "Colmena", version: "0.1.0" }, capabilities: { experimentalApi: true } }, 60000);
    this.notify("initialized");
    const settings = {
      cwd: this.o.cwd, model: this.o.model || null, approvalPolicy: "untrusted", sandbox: SANDBOX[this.o.access] || SANDBOX.project,
      developerInstructions: this.o.instructions || null,
    };
    let result;
    if (this.threadId) {
      try { result = await this.call("thread/resume", { threadId: this.threadId, ...settings }, 60000); } catch { result = null; }
    }
    if (!result) result = await this.call("thread/start", settings, 60000);
    this.threadId = result.thread?.id || this.threadId;
    this.emit("event", { type: "session", id: this.threadId });
    if (this.o.rollback > 0) await this.call("thread/rollback", { threadId: this.threadId, numTurns: this.o.rollback }).catch(() => null);
    this.commands = [];
    return result;
  }

  finish(error) {
    if (!this.alive) return;
    this.alive = false;
    for (const { reject } of this.pending.values()) reject(error || Error("Codex se cerró."));
    this.pending.clear();
    this.emit("exit", error);
  }

  write(m) {
    if (!this.alive) return false;
    try { this.proc.stdin.write(JSON.stringify(m) + "\n"); return true; } catch { return false; }
  }
  notify(method, params) { this.write(params === undefined ? { method } : { method, params }); }
  call(method, params, timeout = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error("Codex no respondió (" + method + ").")); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      if (!this.write({ id, method, params })) { clearTimeout(timer); this.pending.delete(id); reject(Error("Codex no está en marcha.")); }
    });
  }

  /** Starts a turn; «plan» turns use Codex's plan collaboration mode. */
  async send(text, { mode = "build" } = {}) {
    const input = [{ type: "text", text: String(text), text_elements: [] }];
    const r = await this.call("turn/start", {
      threadId: this.threadId, input, cwd: this.o.cwd, model: this.o.model || null, effort: this.o.effort || null,
      approvalPolicy: "untrusted", sandboxPolicy: SANDBOX_POLICY[this.o.access] || SANDBOX_POLICY.project,
      collaborationMode: { mode: mode === "plan" ? "plan" : "default", settings: { model: this.o.model || "", reasoning_effort: this.o.effort || null, developer_instructions: null } },
    }, 60000);
    this.turnId = r?.turn?.id || this.turnId;
    return this.turnId;
  }

  /** A message mid-turn: Codex takes it in the running turn. */
  steer(text) {
    if (!this.turnId) throw Error("Codex no está trabajando.");
    return this.call("turn/steer", { threadId: this.threadId, expectedTurnId: this.turnId, input: [{ type: "text", text: String(text), text_elements: [] }] });
  }

  /** «Compactar»: Codex summarizes the thread; it ends like a turn. */
  async compact() {
    this.compacting = true;
    await this.call("thread/compact/start", { threadId: this.threadId }, 60000);
  }

  interrupt() {
    if (!this.turnId) return Promise.resolve(null);
    return this.call("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }, 15000).catch(() => null);
  }

  close() {
    if (!this.proc) return;
    this.closing = true;
    try { this.proc.stdin.end(); } catch {}
    const proc = this.proc;
    setTimeout(() => { if (proc.exitCode === null) try { proc.kill(); } catch {} }, 3000).unref?.();
  }

  accept(m) {
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(Object.assign(Error(m.error.message || "Codex rechazó la petición."), { code: m.error.code }));
      else p.resolve(m.result);
      return;
    }
    if (m.method && m.id !== undefined) { void this.request(m); return; }
    if (m.method) this.notification(m.method, m.params || {});
  }

  async request(m) {
    const reply = (result) => this.write({ id: m.id, result });
    const fail = (message) => this.write({ id: m.id, error: { code: -32601, message } });
    const p = m.params || {};
    try {
      if (m.method === "item/commandExecution/requestApproval") {
        const d = await this.o.authorize({ tool: "Bash", input: { command: unwrapCommand(p.command), description: p.reason || "" }, toolUseId: p.itemId });
        return reply({ decision: d.behavior === "allow" ? "accept" : "decline" });
      }
      if (m.method === "item/fileChange/requestApproval") {
        const paths = this.changes.get(p.itemId) || [];
        let d = { behavior: "allow" };
        for (const file of paths.length ? paths : [p.grantRoot || ""]) {
          d = await this.o.authorize({ tool: "Edit", input: { file_path: file }, toolUseId: p.itemId + ":" + file });
          if (d.behavior !== "allow") break;
        }
        return reply({ decision: d.behavior === "allow" ? "accept" : "decline" });
      }
      if (m.method === "item/tool/requestUserInput") {
        const questions = (p.questions || []).map((q) => ({ id: q.id, question: q.question, header: q.header, multiSelect: false, options: (q.options || []).map((o) => ({ label: o.label, description: o.description })) }));
        const d = await this.o.authorize({ tool: "AskUserQuestion", input: { questions }, toolUseId: p.itemId });
        const said = d.updatedInput?.answers || {};
        const answers = {};
        for (const q of questions) if (said[q.question]) answers[q.id] = { answers: [said[q.question]] };
        return reply({ answers });
      }
      if (m.method === "mcpServer/elicitation/request") return reply({ action: "decline" });
      if (m.method === "item/permissions/requestApproval") {
        const d = await this.o.authorize({ tool: "Permissions", input: { command: p.reason || "Más permisos para Codex" }, toolUseId: p.itemId });
        return reply({ decision: d.behavior === "allow" ? "accept" : "decline" });
      }
      return fail("Colmena no atiende " + m.method + ".");
    } catch {
      return reply({ decision: "decline" });
    }
  }

  notification(method, p) {
    const out = (e) => this.emit("event", e);
    if (process.env.COLMENA_CODE_DEBUG && !/delta|moderation/i.test(method)) console.log("[codex]", method, JSON.stringify(p).slice(0, 300));
    switch (method) {
      case "turn/started": this.turnId = p.turn?.id || this.turnId; return;
      case "item/agentMessage/delta": {
        this.texts.set(p.itemId, (this.texts.get(p.itemId) || "") + (p.delta || ""));
        return out({ type: "delta", text: p.delta || "" });
      }
      case "item/started": {
        const item = p.item || {};
        if (item.type === "fileChange") this.changes.set(item.id, (item.changes || []).map((c) => c.path));
        const tool = toolOf(item);
        if (tool) out({ type: "tool", id: item.id, name: tool.name, input: tool.input });
        return;
      }
      case "item/completed": {
        const item = p.item || {};
        if (item.type === "agentMessage") { this.texts.delete(item.id); if (item.text?.trim()) out({ type: "text", text: item.text }); return; }
        if (item.type === "plan") { if (item.text?.trim()) out({ type: "plan", text: item.text }); return; }
        if (!toolOf(item)) return;
        const failed = ["failed", "declined"].includes(item.status) || (item.type === "commandExecution" && item.exitCode != null && item.exitCode !== 0);
        const output = item.type === "commandExecution" ? item.aggregatedOutput || "" : item.type === "fileChange" ? (item.changes || []).map((c) => c.diff).join("\n") : item.type === "mcpToolCall" ? JSON.stringify(item.result || item.error || "").slice(0, 4000) : "";
        return out({ type: "toolDone", id: item.id, output, error: failed });
      }
      case "thread/tokenUsage/updated": {
        const u = p.tokenUsage || {};
        const used = u.last?.inputTokens || 0;
        if (used) out({ type: "usage", used, window: u.modelContextWindow || 272000 });
        return;
      }
      case "account/rateLimits/updated": {
        const r = p.rateLimits || {};
        const w = r.primary || {};
        return out({ type: "limit", status: r.rateLimitReachedType ? "rejected" : "allowed", kind: w.windowDurationMins >= 10080 ? "seven_day" : "five_hour", resetsAt: w.resetsAt ? w.resetsAt * 1000 : null, utilization: w.usedPercent != null ? w.usedPercent / 100 : null });
      }
      case "error": this.lastError = p.error?.message || p.message || null; return;
      case "thread/compacted":
        if (this.compacting && !this.turnId) { this.compacting = false; out({ type: "done", interrupted: false, error: null }); }
        return;
      case "turn/completed": {
        const turn = p.turn || {};
        this.turnId = null;
        this.compacting = false;
        const interrupted = turn.status === "interrupted";
        const error = turn.status === "failed" ? (turn.error?.message || this.lastError || "Bruno no pudo terminar este turno.") : null;
        this.lastError = null;
        return out({ type: "done", interrupted, error });
      }
      default:
    }
  }
}

/** Codex's models for this account (`model/list`), asked once with a short-lived app-server. */
export async function codexModels({ command = findCodexCli(), cwd = os.homedir() } = {}) {
  if (!command) return [];
  const engine = new CodexEngine({ command, cwd, authorize: async () => ({ behavior: "deny" }) });
  try {
    const [exe, ...lead] = command;
    engine.proc = spawn(exe, [...lead, "app-server", "-c", "mcp_servers={}"], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    engine.alive = true;
    let buffer = "";
    engine.proc.stdout.setEncoding("utf8");
    engine.proc.stdout.on("data", (c) => { buffer += c; let nl; while ((nl = buffer.indexOf("\n")) >= 0) { const l = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); try { engine.accept(JSON.parse(l)); } catch {} } });
    engine.proc.on("exit", () => engine.finish(null));
    engine.proc.stdin.on("error", () => {});
    await engine.call("initialize", { clientInfo: { name: "colmena", version: "0.1.0" }, capabilities: { experimentalApi: true } }, 30000);
    engine.notify("initialized");
    const r = await engine.call("model/list", {}, 30000);
    return (r?.data || []).filter((m) => !m.hidden && !String(m.id).includes("/")).map((m) => ({
      id: m.id, label: m.displayName || m.id, isDefault: !!m.isDefault, efforts: (m.supportedReasoningEfforts || []).map((e) => e.reasoningEffort || e), defaultEffort: m.defaultReasoningEffort || null, description: m.description || "",
    }));
  } catch {
    return [];
  } finally {
    engine.close();
  }
}
