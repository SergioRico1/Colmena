// The engine of a «Código» task: Claude Code of this computer (its own login, your Claude plan),
// driven the way T3 Code drives the Agent SDK and OpenClaw its live CLI sessions: one long-lived
// `claude --print` process per task with stream-json in and out, Claude Code's own tools, and
// every tool call passed to Colmena first (PreToolUse hook + `--permission-prompt-tool stdio`),
// so the task's access and the red lines decide. Sessions persist, so a task resumes after a
// restart (`--resume`), and «Editar desde aquí» forks it at an earlier answer
// (`--resume-session-at` + `--fork-session`).
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { cleanEnv, findClaudeCli } from "../providers/claude-cli.mjs";

/** Claude Code's own tools a task may use (scheduling, remote and app-specific ones stay off). */
export const CODE_TOOLS = ["Task", "AskUserQuestion", "Bash", "PowerShell", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "NotebookEdit", "Skill", "ExitPlanMode", "TaskStop", "ToolSearch"];
const MAX_LINE = 8 * 1024 * 1024;

export class ClaudeCodeEngine extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.cwd           task folder
   * @param {string} o.model         e.g. claude-opus-5-5
   * @param {string} [o.effort]
   * @param {string} o.sessionId     the session to create or resume
   * @param {boolean} [o.resume]     resume `sessionId` instead of creating it
   * @param {string} [o.resumeAt]    with resume: cut the session after this assistant message
   * @param {string} o.instructions  appended to Claude Code's system prompt
   * @param {string} o.tempDir       where the prompt file lives
   * @param {(req:{tool:string,input:object,toolUseId:string|null,signal:AbortSignal})=>Promise<object>} o.authorize
   */
  constructor(o) {
    super();
    this.o = o;
    this.command = o.command || findClaudeCli();
    this.proc = null;
    this.alive = false;
    this.pending = new Map(); // control request id → {resolve, reject}
    this.requests = new Map(); // incoming request id → AbortController
    this.decided = new Map(); // tool_use_id → decision promise (hook and can_use_tool ask once)
    this.sessionId = o.sessionId;
    this.stderr = "";
    this.kind = "claude-code";
    this.mode = "build"; // or "plan" (Claude Code's plan permission mode)
  }

  async start() {
    if (!this.command) throw Object.assign(Error("No encuentro Claude Code en este ordenador."), { status: 503 });
    await mkdir(this.o.tempDir, { recursive: true });
    this.promptFile = path.join(this.o.tempDir, "codigo-" + randomUUID() + ".md");
    await writeFile(this.promptFile, String(this.o.instructions || ""), "utf8");
    const session = this.o.resume
      ? ["--resume", this.o.sessionId, ...(this.o.resumeAt ? ["--resume-session-at", this.o.resumeAt, "--fork-session"] : [])]
      : ["--session-id", this.o.sessionId];
    const args = [
      "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--permission-prompt-tool", "stdio", "--permission-mode", this.o.permissionMode || "default",
      // The project's own Claude settings and CLAUDE.md count; the person's global ones do not.
      "--setting-sources", "project,local", "--tools", CODE_TOOLS.join(","),
      "--append-system-prompt-file", this.promptFile, "--model", this.o.model,
      ...(this.o.effort ? ["--effort", this.o.effort] : []), ...session,
    ];
    const [exe, ...lead] = Array.isArray(this.command) ? this.command : [this.command];
    this.proc = spawn(exe, [...lead, ...args], { cwd: this.o.cwd, env: { ...cleanEnv(), ...(this.o.env || {}) }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.alive = true;
    this.pid = this.proc.pid;
    let buffer = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE && buffer.indexOf("\n") < 0) buffer = "";
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        this.accept(message);
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (c) => { this.stderr = (this.stderr + c).slice(-4000); });
    this.proc.stdin.on("error", () => {});
    this.proc.on("error", (e) => this.finish(Object.assign(Error("No se pudo iniciar Claude Code: " + e.message), { status: 503 })));
    this.proc.on("exit", (code) => {
      const auth = /not logged in|please log in|claude auth login|invalid api key|401/i.test(this.stderr);
      const error = this.closing ? null : Object.assign(Error(auth ? "Claude Code no tiene la sesión iniciada. Abre una terminal y ejecuta «claude auth login»." : "Claude Code se cerró (" + code + ")."), { auth, detail: this.stderr.slice(-1500) });
      this.finish(error);
    });
    const hooks = { PreToolUse: [{ hookCallbackIds: ["PreToolUse"] }] };
    const ready = await this.control({ subtype: "initialize", hooks }, 60000);
    this.commands = Array.isArray(ready?.commands) ? ready.commands.map((c) => ({ name: c.name, description: c.description })) : [];
    return ready;
  }

  finish(error) {
    if (!this.alive) return;
    this.alive = false;
    for (const { reject } of this.pending.values()) reject(error || Error("Claude Code se cerró."));
    this.pending.clear();
    for (const c of this.requests.values()) c.abort();
    this.requests.clear();
    rm(this.promptFile, { force: true }).catch(() => {});
    this.emit("exit", error);
  }

  write(message) {
    if (!this.alive) return false;
    try { this.proc.stdin.write(JSON.stringify(message) + "\n"); return true; } catch { return false; }
  }

  control(request, timeout = 30000) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error("Claude Code no respondió.")); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      if (!this.write({ type: "control_request", request_id: id, request })) { clearTimeout(timer); this.pending.delete(id); reject(Error("Claude Code no está en marcha.")); }
    });
  }

  /** Starts a turn; «plan» turns run in Claude Code's plan mode (nothing is changed). */
  async send(text, { mode = "build" } = {}) {
    if (mode !== this.mode) {
      await this.setPermissionMode(mode === "plan" ? "plan" : this.o.permissionMode || "default");
      this.mode = mode;
    }
    return this.steer(text);
  }

  /** A message from the person mid-turn: Claude Code takes it at its next step. */
  steer(text, uuid = randomUUID()) {
    const content = Array.isArray(text) ? text : String(text);
    if (!this.write({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, uuid, session_id: this.sessionId })) throw Error("Claude Code no está en marcha.");
    return uuid;
  }

  interrupt() { return this.control({ subtype: "interrupt" }, 15000).catch(() => null); }
  setPermissionMode(mode) { return this.control({ subtype: "set_permission_mode", mode }).catch(() => null); }

  close() {
    if (!this.proc) return;
    this.closing = true;
    try { this.proc.stdin.end(); } catch {}
    const proc = this.proc;
    setTimeout(() => { if (proc.exitCode === null) try { proc.kill(); } catch {} }, 3000).unref?.();
  }

  accept(m) {
    if (m.type === "control_response") {
      const r = m.response || {};
      const p = this.pending.get(r.request_id);
      if (!p) return;
      this.pending.delete(r.request_id);
      if (r.subtype === "success") p.resolve(r.response || {});
      else p.reject(Error(r.error || "Claude Code rechazó la petición."));
      return;
    }
    if (m.type === "control_request") { void this.dispatch(m.request_id, m.request || {}); return; }
    if (m.type === "control_cancel_request") { this.requests.get(m.request_id)?.abort(); return; }
    if (m.type === "keep_alive") return;
    if (m.type === "system" && m.subtype === "init" && m.session_id) this.sessionId = m.session_id;
    this.emit("message", m);
    this.normalize(m);
  }

  /** Claude Code's stream → the events every engine gives the task (see service.mjs onEvent). */
  normalize(m) {
    const out = (e) => this.emit("event", e);
    if (m.type === "system" && m.subtype === "init") { if (m.session_id) out({ type: "session", id: m.session_id }); return; }
    if (m.type === "rate_limit_event") {
      const info = m.rate_limit_info || {};
      out({ type: "limit", status: info.status, kind: info.rateLimitType, resetsAt: info.resetsAt ? info.resetsAt * 1000 : null, utilization: info.unifiedWindows?.[info.rateLimitType]?.utilization ?? null });
      return;
    }
    if (m.parent_tool_use_id) { if (m.type === "assistant") out({ type: "child", parent: m.parent_tool_use_id }); return; }
    if (m.type === "stream_event") {
      const ev = m.event || {};
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") out({ type: "delta", text: ev.delta.text || "" });
      else if (ev.type === "message_start" && ev.message?.usage) {
        const u = ev.message.usage;
        const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (used) out({ type: "usage", used, window: 200000 });
      }
      return;
    }
    if (m.type === "assistant" && m.message) {
      if (m.uuid) out({ type: "mark", at: m.uuid });
      for (const block of m.message.content || []) {
        if (block.type === "text" && block.text?.trim()) out({ type: "text", text: block.text });
        else if (block.type === "tool_use" && block.name !== "ExitPlanMode") out({ type: "tool", id: block.id, name: block.name, input: block.input || {} });
      }
      return;
    }
    if (m.type === "user" && Array.isArray(m.message?.content)) {
      for (const block of m.message.content) {
        if (block?.type !== "tool_result") continue;
        const content = block.content;
        const output = typeof content === "string" ? content : (Array.isArray(content) ? content : []).map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[imagen]" : "")).filter(Boolean).join("\n");
        out({ type: "toolDone", id: block.tool_use_id, output, error: !!block.is_error });
      }
      return;
    }
    if (m.type === "result") {
      const sub = String(m.subtype || "");
      const failed = m.is_error || sub.startsWith("error");
      out({ type: "done", interrupted: /interrupt/i.test(sub), error: failed ? ((Array.isArray(m.errors) ? m.errors.join(" ") : "") || m.result || "Bruno no pudo terminar este turno.") : null });
    }
  }

  /** The decision for one tool call, asked once even if both the hook and the prompt come. */
  decide(tool, input, toolUseId, signal) {
    if (toolUseId && this.decided.has(toolUseId)) return this.decided.get(toolUseId);
    if (tool === "ExitPlanMode") {
      // The plan is for the person (Refinar · Implementar · En una tarea nueva): the turn stops here.
      const p = Promise.resolve({ behavior: "deny", message: "Colmena ha recogido tu plan y se lo enseña a la persona. Termina aquí sin hacer nada más y espera su decisión." });
      if (toolUseId) this.decided.set(toolUseId, p);
      this.emit("event", { type: "plan", text: String(input?.plan || "") });
      return p;
    }
    const p = this.o.authorize({ tool, input: input || {}, toolUseId: toolUseId || null, signal }).catch(() => ({ behavior: "deny", message: "Colmena no pudo autorizar esta acción." }));
    if (toolUseId) {
      this.decided.set(toolUseId, p);
      if (this.decided.size > 500) this.decided.delete(this.decided.keys().next().value);
    }
    return p;
  }

  async dispatch(id, request) {
    const controller = new AbortController();
    this.requests.set(id, controller);
    let response;
    try {
      if (request.subtype === "can_use_tool") {
        const d = await this.decide(request.tool_name, request.input, request.tool_use_id, controller.signal);
        response = d.behavior === "allow"
          ? { behavior: "allow", updatedInput: d.updatedInput || request.input, toolUseID: request.tool_use_id }
          : { behavior: "deny", message: d.message || "No permitido.", toolUseID: request.tool_use_id };
      } else if (request.subtype === "hook_callback" && request.input?.hook_event_name === "PreToolUse") {
        const input = request.input;
        const d = await this.decide(input.tool_name, input.tool_input, request.tool_use_id || input.tool_use_id, controller.signal);
        response = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d.behavior === "allow" ? "allow" : "deny", ...(d.behavior === "allow" ? (d.updatedInput ? { updatedInput: d.updatedInput } : {}) : { permissionDecisionReason: d.message || "No permitido." }) } };
      } else if (request.subtype === "elicitation") {
        response = { action: "decline" };
      } else {
        response = {};
      }
      this.write({ type: "control_response", response: { subtype: "success", request_id: id, response } });
    } catch {
      this.write({ type: "control_response", response: { subtype: "error", request_id: id, error: "Colmena no pudo atender la petición." } });
    } finally {
      this.requests.delete(id);
    }
  }
}
