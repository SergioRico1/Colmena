// The third engine of a «Código» task: OpenCode (T3 Code OpenCodeRuntime), with your OpenCode Go
// key or its free models. `opencode serve` runs on a loopback port with a random password, one
// per task; its HTTP API starts sessions and turns («build» or «plan» agent), and its event
// stream is turned into the same events as the other engines. Every tool that is not a plain
// read asks first (permission rules), so the task's access and red lines decide.
// OpenCode is not on this computer by default: Colmena installs it for itself, only when you
// press «Instalar OpenCode» (npm, in <data>/code/engines/opencode, never for all of Windows).
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { nodeExecutable, npmCli } from "../projects/run.mjs";

export const OPENCODE_VERSION = "1.19.3";
const OPENCODE_PACKAGE = "opencode-ai@" + OPENCODE_VERSION;

/** Models: your OpenCode Go key first, then the free ones (id «provider/model»). */
export const OPENCODE_MODELS = Object.freeze([
  { id: "opencode-go/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", go: true, isDefault: true },
  { id: "opencode-go/kimi-k3", label: "Kimi K3", go: true },
  { id: "opencode-go/glm-5.3-flash", label: "GLM 5.3 Flash", go: true },
  { id: "opencode/deepseek-v4.1-flash-free", label: "DeepSeek V4.1 Flash · gratis" },
  { id: "opencode/muse-spark-1.3-contributor-free", label: "Muse Spark 1.3 · gratis" },
]);

const binDir = (directory) => path.join(directory, "code", "engines", "opencode");
/** OpenCode's executable: COLMENA_OPENCODE_CLI, Colmena's own install, else none. */
export function findOpenCode(directory, env = process.env) {
  if (env.COLMENA_OPENCODE_CLI) return env.COLMENA_OPENCODE_CLI.split("|");
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const exe = process.platform === "win32" ? "opencode.exe" : "opencode";
  const os = process.platform === "win32" ? "windows" : process.platform;
  for (const pkg of [`opencode-${os}-${arch}`, `opencode-${os}-${arch}-baseline`]) {
    const p = path.join(binDir(directory), "node_modules", pkg, "bin", exe);
    if (existsSync(p)) return [p];
  }
  return null;
}

/** `npm install opencode-ai` into Colmena's own folder (the person pressed «Instalar»). */
export function installOpenCode(directory, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeExecutable(), [npmCli(), "install", "--prefix", binDir(directory), OPENCODE_PACKAGE, "--no-audit", "--no-fund", "--loglevel=error"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && findOpenCode(directory)) resolve({ ok: true, version: OPENCODE_VERSION });
      else reject(Object.assign(Error("No se pudo instalar OpenCode" + (err ? ": " + err.trim().split("\n").at(-1) : ".")), { status: 502 }));
    });
  });
}

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once("error", reject);
  srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

/** OpenCode's tool → Claude Code's vocabulary (one work log for every engine). */
export function toolFromOpenCode(tool, input = {}) {
  const file = input.filePath || input.file_path || input.path || "";
  switch (tool) {
    case "bash": return { name: "Bash", input: { command: input.command || "", description: input.description || "" } };
    case "read": return { name: "Read", input: { file_path: file } };
    case "write": return { name: "Write", input: { file_path: file } };
    case "edit": case "patch": case "multiedit": return { name: "Edit", input: { file_path: file } };
    case "glob": case "list": return { name: "Glob", input: { pattern: input.pattern || input.path || "." } };
    case "grep": return { name: "Grep", input: { pattern: input.pattern || "" } };
    case "webfetch": return { name: "WebFetch", input: { url: input.url || "" } };
    case "websearch": return { name: "WebSearch", input: { query: input.query || "" } };
    case "task": return { name: "Task", input: { description: input.description || input.prompt || "" } };
    case "todowrite": case "todoread": return { name: "TodoWrite", input: {} };
    case "skill": return { name: "Skill", input: { skill: input.name || "" } };
    default: return { name: tool, input };
  }
}

/** A permission OpenCode asks for → what Colmena's policy judges. */
export function permissionToTool(p) {
  const meta = p.metadata || {};
  const first = (p.patterns || [])[0] || "";
  switch (p.permission) {
    case "bash": return { tool: "Bash", input: { command: meta.command || first } };
    case "edit": case "write": return { tool: "Edit", input: { file_path: meta.filepath || meta.filePath || first } };
    case "read": case "glob": case "grep": case "list": case "lsp": return { tool: "Read", input: { file_path: meta.filepath || first } };
    case "webfetch": case "websearch": case "codesearch": return { tool: "WebFetch", input: { url: meta.url || first } };
    case "task": case "skill": case "todowrite": case "question": return { tool: "Task", input: {} };
    default: return { tool: "Permissions", input: { command: p.permission + (first ? ": " + first : "") } };
  }
}

/** Colmena's effort → the model's own variant (OpenCode «variant»: each model has its own set). */
const VARIANTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
export function pickVariant(effort, variants = []) {
  const have = variants.filter((v) => VARIANTS.includes(v));
  if (!have.length) return null;
  if (have.includes(effort)) return effort;
  const want = VARIANTS.indexOf(effort) < 0 ? VARIANTS.indexOf("high") : VARIANTS.indexOf(effort);
  // The closest one; between two as close, the lighter.
  return have.map((v) => [v, Math.abs(VARIANTS.indexOf(v) - want), VARIANTS.indexOf(v)]).sort((a, b) => a[1] - b[1] || a[2] - b[2])[0][0];
}

/** The last answer of a plan turn is the plan: «Plan» headings and the like stay as written. */
export const planOf = (texts) => texts.map((t) => String(t || "").trim()).filter(Boolean).join("\n\n");

const RULES = [
  { permission: "*", pattern: "*", action: "ask" },
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "glob", pattern: "*", action: "allow" },
  { permission: "grep", pattern: "*", action: "allow" },
  { permission: "list", pattern: "*", action: "allow" },
  { permission: "lsp", pattern: "*", action: "allow" },
  { permission: "skill", pattern: "*", action: "allow" },
  { permission: "todowrite", pattern: "*", action: "allow" },
  { permission: "question", pattern: "*", action: "allow" },
  { permission: "webfetch", pattern: "*", action: "allow" },
  { permission: "websearch", pattern: "*", action: "allow" },
];

export class OpenCodeEngine extends EventEmitter {
  /**
   * @param {object} o  cwd, model («provider/model»), effort, instructions, authorize(req), command,
   *                    sessionId (resume), forkAt (assistant message to fork at), apiKey (OpenCode Go)
   */
  constructor(o) {
    super();
    this.o = o;
    this.kind = "opencode";
    this.command = o.command;
    this.alive = false;
    this.sessionId = o.sessionId || null;
    this.parts = new Map(); // part id → type
    this.tools = new Map(); // callID → «running» | «done»
    this.texts = new Set(); // text parts already given whole
    this.turn = false;
    this.commands = [];
    this.mode = "build";
    this.planTexts = [];
    this.variant = null;
  }

  get model() {
    const [providerID, ...rest] = String(this.o.model || OPENCODE_MODELS[0].id).split("/");
    return { providerID, modelID: rest.join("/") };
  }

  async start() {
    if (!this.command) throw Object.assign(Error("OpenCode no está instalado para Colmena. Pulsa «Instalar OpenCode»."), { status: 503 });
    this.port = await freePort();
    this.password = randomBytes(18).toString("hex");
    const env = { ...process.env, OPENCODE_SERVER_PASSWORD: this.password };
    if (this.o.apiKey) env.OPENCODE_API_KEY = this.o.apiKey; // only in the child's memory, never on disk
    const [exe, ...lead] = this.command;
    this.proc = spawn(exe, [...lead, "serve", "--port", String(this.port), "--hostname", "127.0.0.1", "--pure"], { cwd: this.o.cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.pid = this.proc.pid;
    this.alive = true;
    let stderr = "";
    this.proc.stderr.on("data", (d) => { stderr = (stderr + d).slice(-3000); });
    this.proc.stdout.on("data", () => {});
    this.proc.on("error", (e) => this.finish(Object.assign(Error("No se pudo iniciar OpenCode: " + e.message), { status: 503 })));
    this.proc.on("exit", (code) => this.finish(this.closing ? null : Object.assign(Error("OpenCode se cerró (" + code + ")."), { detail: stderr })));
    const end = Date.now() + 40000;
    for (;;) {
      if (!this.alive) throw Error("OpenCode se cerró al arrancar.");
      try { const r = await fetch(this.url("/global/health"), { headers: this.headers() }); if (r.ok) break; } catch {}
      if (Date.now() > end) throw Error("OpenCode no arrancó a tiempo.");
      await new Promise((r) => setTimeout(r, 250));
    }
    this.listen();
    // The model's variants, for the task's effort (asked once; none known → OpenCode's default).
    const providers = await this.api("GET", "/provider").catch(() => null);
    const info = (providers?.all || []).find((p) => p.id === this.model.providerID)?.models?.[this.model.modelID];
    this.variant = pickVariant(this.o.effort || "high", Object.keys(info?.variants || {}));
    let session = null;
    if (this.sessionId) session = await this.api("GET", "/session/" + this.sessionId).catch(() => null);
    if (session?.id && this.o.forkAt) session = await this.api("POST", "/session/" + session.id + "/fork", { messageID: this.o.forkAt }).catch(() => session);
    if (!session?.id) session = await this.api("POST", "/session", { title: "Colmena", permission: RULES });
    this.sessionId = session.id;
    this.emit("event", { type: "session", id: this.sessionId });
    return session;
  }

  url(p) { return `http://127.0.0.1:${this.port}${p}${p.includes("?") ? "&" : "?"}directory=${encodeURIComponent(this.o.cwd)}`; }
  headers() { return { "content-type": "application/json", authorization: "Basic " + Buffer.from("opencode:" + this.password).toString("base64") }; }
  async api(method, p, body) {
    const r = await fetch(this.url(p), { method, headers: this.headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw Object.assign(Error("OpenCode: " + (text.slice(0, 200) || r.status)), { status: r.status });
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  async listen() {
    try {
      this.events = new AbortController();
      const r = await fetch(this.url("/event"), { headers: this.headers(), signal: this.events.signal });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let e;
          try { e = JSON.parse(line.slice(6)); } catch { continue; }
          try { await this.onEvent(e); } catch {}
        }
      }
    } catch {}
  }

  async onEvent(e) {
    const p = e.properties || {};
    if (p.sessionID && p.sessionID !== this.sessionId) return;
    const out = (ev) => this.emit("event", ev);
    if (process.env.COLMENA_CODE_DEBUG && !/delta|plugin|catalog/.test(e.type)) console.log("[opencode]", e.type, JSON.stringify(p).slice(0, 240));
    switch (e.type) {
      case "message.updated":
        if (p.info?.role === "assistant" && this.turn) out({ type: "mark", at: p.info.id });
        if (p.info?.error && this.turn) this.lastError = p.info.error.data?.message || p.info.error.name || null;
        return;
      case "message.part.delta":
        if (this.parts.get(p.partID) === "text" && p.field === "text") out({ type: "delta", text: p.delta || "" });
        return;
      case "message.part.updated": {
        const part = p.part || {};
        this.parts.set(part.id, part.type);
        if (!this.turn) return;
        if (part.type === "text" && part.time?.end && !part.synthetic && !this.texts.has(part.id) && part.text?.trim()) {
          this.texts.add(part.id);
          // A plan turn's answer is the plan: it comes whole when the turn ends (PlanCard).
          if (this.mode === "plan") this.planTexts.push(part.text);
          else out({ type: "text", text: part.text });
        } else if (part.type === "tool") {
          const st = part.state || {};
          // Its input is only known once it runs (pending parts come empty).
          if (!this.tools.has(part.callID) && st.status !== "pending") {
            this.tools.set(part.callID, "running");
            const t = toolFromOpenCode(part.tool, st.input || {});
            out({ type: "tool", id: part.callID, name: t.name, input: t.input });
          }
          if ((st.status === "completed" || st.status === "error") && this.tools.get(part.callID) !== "done") {
            this.tools.set(part.callID, "done");
            out({ type: "toolDone", id: part.callID, output: String(st.output || st.error || ""), error: st.status === "error" });
          }
        } else if (part.type === "step-finish" && part.tokens) {
          const t = part.tokens;
          out({ type: "usage", used: (t.input || 0) + (t.cache?.read || 0), window: 128000 });
        }
        return;
      }
      case "permission.asked": {
        const { tool, input } = permissionToTool(p);
        const d = await this.o.authorize({ tool, input, toolUseId: p.tool?.callID || p.id });
        await this.api("POST", "/permission/" + p.id + "/reply", d.behavior === "allow" ? { reply: "once" } : { reply: "reject", message: d.message || "No permitido." }).catch(() => {});
        return;
      }
      case "question.asked": case "question.v2.asked": {
        const questions = (p.questions || []).map((q, i) => ({ question: q.question || q.text || "Pregunta " + (i + 1), header: q.header || "", multiSelect: !!q.multiple, options: (q.options || []).map((o) => ({ label: o.label || String(o), description: o.description || "" })) }));
        const d = await this.o.authorize({ tool: "AskUserQuestion", input: { questions }, toolUseId: p.id });
        if (d.behavior !== "allow") { await this.api("POST", "/question/" + p.id + "/reject").catch(() => {}); return; }
        const said = d.updatedInput?.answers || {};
        await this.api("POST", "/question/" + p.id + "/reply", { answers: questions.map((q) => (said[q.question] ? [said[q.question]] : [])) }).catch(() => {});
        return;
      }
      case "session.error":
        if (this.turn) this.lastError = p.error?.data?.message || p.error?.name || "OpenCode falló.";
        if (p.error?.name === "MessageAbortedError") this.aborted = true;
        return;
      case "session.status":
        if (p.status?.type === "busy") this.busy = true;
        if (p.status?.type === "idle") this.idle();
        return;
      case "session.idle":
        this.idle();
        return;
      default:
    }
  }

  idle() {
    if (!this.turn || !this.busy) return;
    this.turn = false;
    this.busy = false;
    const error = this.aborted ? null : this.lastError;
    const interrupted = !!this.aborted;
    this.lastError = null;
    this.aborted = false;
    const plan = this.mode === "plan" && !error && !interrupted ? planOf(this.planTexts) : "";
    if (this.mode === "plan" && !plan) for (const text of this.planTexts) this.emit("event", { type: "text", text });
    if (plan) this.emit("event", { type: "plan", text: plan });
    this.mode = "build";
    this.planTexts = [];
    this.emit("event", { type: "done", interrupted, error });
  }

  body(text, mode) {
    return { parts: [{ type: "text", text: String(text) }], model: this.model, agent: mode === "plan" ? "plan" : "build", system: this.o.instructions || undefined, ...(this.variant ? { variant: this.variant } : {}) };
  }
  async send(text, { mode = "build" } = {}) {
    this.turn = true;
    this.busy = false;
    this.mode = mode === "plan" ? "plan" : "build";
    this.planTexts = [];
    await this.api("POST", "/session/" + this.sessionId + "/prompt_async", this.body(text, this.mode));
  }
  /** OpenCode takes a message sent while it works at its next step. */
  steer(text) {
    return this.api("POST", "/session/" + this.sessionId + "/prompt_async", this.body(text, this.mode || "build"));
  }
  interrupt() { this.aborted = true; return this.api("POST", "/session/" + this.sessionId + "/abort").catch(() => null); }
  async compact() {
    this.turn = true;
    await this.api("POST", "/session/" + this.sessionId + "/summarize", this.model);
    this.busy = true;
    this.idle();
  }

  finish(error) {
    if (!this.alive) return;
    this.alive = false;
    this.events?.abort();
    this.emit("exit", error);
  }
  close() {
    this.closing = true;
    this.events?.abort();
    try { this.proc?.kill(); } catch {}
  }
}
