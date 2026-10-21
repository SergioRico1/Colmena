// «Claude Code de este ordenador» (OpenClaw extensions/anthropic/cli-backend.ts, method
// `cli`): the Claude Code CLI installed on this computer thinks with its own login (your
// Claude plan) and Colmena's tools reach it through a loopback MCP server, as OpenClaw's
// `bundleMcp` does. Native Claude Code tools stay off (`--tools ""`); only
// `mcp__colmena__*` is allowed, so every action still goes through Colmena's permissions.
//
// Colmena drives the rounds (respond → tool calls → outputs → respond). Claude Code drives
// its own loop, so one CLI process lives per bot and mission: when it calls a Colmena tool,
// the call is handed back to the runtime as a function_call and the MCP request waits; the
// next respond() delivers the output and the stream goes on. A process that died (restart,
// idle, different model or tools) is replaced and reseeded from the step's transcript.
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { imageUnsupported } from "../images.mjs";
import { modelEntry } from "./catalog.mjs";

export const MCP_NAME = "colmena";
const PREFIX = "mcp__" + MCP_NAME + "__";
// Inherited overrides must not steer the CLI to another endpoint, token or provider
// (OpenClaw CLAUDE_CLI_CLEAR_ENV).
const CLEAR_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_OLD", "ANTHROPIC_API_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_UNIX_SOCKET", "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_CODE_DISABLE_1M_CONTEXT", "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING",
  "MAX_THINKING_TOKENS", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "CLAUDE_CODE_PLUGIN_CACHE_DIR", "CLAUDE_CODE_PLUGIN_SEED_DIR", "CLAUDE_CODE_REMOTE",
  "CLAUDE_CODE_USE_COWORK_PLUGINS", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_VERTEX", "CLAUDECODE",
];
const IDLE_MS = 30 * 60 * 1000;
const SETTLE_MS = 250;

/** The Claude Code executable: COLMENA_CLAUDE_CLI, then the usual install places (no shell). */
export function findClaudeCli(env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    env.COLMENA_CLAUDE_CLI,
    path.join(home, ".local", "bin", exe),
    env.APPDATA && path.join(env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", exe),
    process.platform !== "win32" && "/usr/local/bin/claude",
    process.platform !== "win32" && "/opt/homebrew/bin/claude",
  ].filter(Boolean);
  return candidates.find((p) => { try { return existsSync(p); } catch { return false; } }) || null;
}

export function cleanEnv(base = process.env) {
  const env = { ...base };
  for (const k of CLEAR_ENV) delete env[k];
  return env;
}

/**
 * `claude auth status --json` without reading any token (OpenClaw probeClaudeCliAuthStatus):
 * {status:'available', authMethod, email} | {status:'missing'|'not_installed'|'unreadable'|'timeout'}.
 */
export function probeClaudeCli({ command = findClaudeCli(), timeoutMs = 10000 } = {}) {
  if (!command) return Promise.resolve({ status: "not_installed" });
  return new Promise((resolve) => {
    const [exe, ...lead] = Array.isArray(command) ? command : [command];
    execFile(exe, [...lead, "auth", "status", "--json"], { env: cleanEnv(), timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error?.killed) return resolve({ status: "timeout" });
      let parsed;
      try { parsed = JSON.parse(String(stdout || "")); } catch { return resolve({ status: "unreadable" }); }
      if (typeof parsed?.loggedIn !== "boolean") return resolve({ status: "unreadable" });
      if (!parsed.loggedIn) return resolve({ status: "missing" });
      const email = parsed.authMethod === "claude.ai" && typeof parsed.email === "string" && parsed.email.length <= 320 ? parsed.email : null;
      resolve({ status: "available", authMethod: String(parsed.authMethod || ""), email });
    });
  });
}

/** Claude Code models need a recent CLI (Anthropic gates them by version; OpenClaw's floor). */
export const CLI_MIN_VERSION = "2.1.280";
export const newerOrEqual = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
};

/** `claude --version` → «2.1.304», or null. */
export function claudeCliVersion({ command = findClaudeCli(), timeoutMs = 10000 } = {}) {
  if (!command) return Promise.resolve(null);
  const [exe, ...lead] = Array.isArray(command) ? command : [command];
  return new Promise((resolve) => {
    execFile(exe, [...lead, "--version"], { env: cleanEnv(), timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 }, (error, stdout) => {
      resolve(error ? null : /(\d+\.\d+\.\d+)/.exec(String(stdout || ""))?.[1] || null);
    });
  });
}

const textOf = (content) =>
  typeof content === "string" ? content
    : (Array.isArray(content) ? content : []).map((c) => (["input_text", "output_text", "text"].includes(c?.type) ? c.text : c?.type === "input_image" ? "[imagen]" : "")).filter(Boolean).join("\n");

/** The step so far, as one message for a fresh CLI session (OpenClaw reseed from transcript). */
export function transcriptOf(items, { max = 400000 } = {}) {
  const lines = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object" || item.type === "native_turn" || item.type === "reasoning" || item.type === "web_search_call") continue;
    if (item.type === "function_call") lines.push(`[Llamaste a la herramienta ${item.name} con ${String(item.arguments || "{}").slice(0, 3000)}]`);
    else if (item.type === "function_call_output") lines.push(`[Resultado: ${(typeof item.output === "string" ? item.output : textOf(item.output)).slice(0, 6000)}]`);
    else if (item.type === "message" || item.role === "assistant") { const t = textOf(item.content); if (t.trim()) lines.push((item.role === "assistant" ? "[Tú] " : "[Persona] ") + t); }
    else if (item.role === "user" || item.role === "developer") { const t = textOf(item.content); if (t.trim()) lines.push("[Persona] " + t); }
  }
  let text = lines.join("\n\n");
  if (text.length > max) text = "…" + text.slice(text.length - max);
  return text;
}

/**
 * A failed turn of the CLI, in words that say what to do. An old Claude Code or a model it
 * does not know is not retried (it would fail the same way); limits rest the engine; the rest
 * (overloaded, cut streams) is retried.
 */
export function cliFailure(text) {
  const said = String(text || "").slice(0, 400);
  console.warn("Claude Code no pudo terminar: " + said.replace(/\s+/g, " "));
  const version = /version (\d+\.\d+\.\d+) or newer is required/i.exec(said);
  if (version || /claude update|does not support this model/i.test(said))
    return Object.assign(Error("Tu Claude Code es demasiado antiguo para este modelo" + (version ? " (hace falta la " + version[1] + " o posterior)" : "") + ". Actualízalo con «claude update» en una terminal."), { status: 426, detail: said });
  if (/not logged in|please log in|claude auth login|oauth token|401/i.test(said))
    return Object.assign(Error("Claude Code no tiene la sesión iniciada. Abre una terminal y ejecuta «claude auth login»."), { status: 401, detail: said });
  if (/rate.?limit|usage limit|limit reached|429/i.test(said)) return Object.assign(Error("Has alcanzado el límite de tu plan de Claude."), { status: 429, detail: said });
  if (/model.*(not found|not available|invalid)|unknown model/i.test(said)) return Object.assign(Error("Claude Code no tiene este modelo."), { status: 404, detail: said });
  return Object.assign(Error("Claude Code no pudo terminar: " + said.slice(0, 200)), { transient: true, detail: said });
}

const userLine = (content) => JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" }) + "\n";
const toolsSig = (tools) => createHash("sha256").update(JSON.stringify((tools || []).map((t) => [t.name, t.parameters]))).digest("hex").slice(0, 16);
const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** One live Claude Code process with its loopback MCP server. */
class CliSession {
  constructor({ command, model, effort, tools, instructions, directory, onExit }) {
    Object.assign(this, { command, model, effort, tools, instructions, directory, onExit });
    this.sig = toolsSig(tools);
    this.secret = randomBytes(24).toString("hex");
    this.arrived = [];     // MCP calls not handed to the runtime yet
    this.waiting = new Map(); // call_id → resolve(result) of calls handed to the runtime
    this.uses = [];        // tool_use blocks Claude announced (to recover their ids)
    this.text = "";        // assistant text of the current round
    this.usage = new Map();
    this.turnDone = false;
    this.alive = false;
    this.error = null;
    this.consumed = 0;
    this.wake = () => {};
    this.usedAt = Date.now();
  }
  notify() { const w = this.wake; this.wake = () => {}; w(); }

  async start() {
    this.server = http.createServer((req, res) => this.mcp(req, res).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } }));
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(0, "127.0.0.1", resolve); });
    const port = this.server.address().port;
    await mkdir(this.directory, { recursive: true });
    this.promptFile = path.join(this.directory, "colmena-" + randomUUID() + ".md");
    await writeFile(this.promptFile, String(this.instructions || "") + "\n\nTus herramientas de Colmena aparecen con el prefijo mcp__colmena__ (por ejemplo, mcp__colmena__read_file). Úsalas para actuar; no tienes otras.", "utf8");
    const config = JSON.stringify({ mcpServers: { [MCP_NAME]: { type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: "Bearer " + this.secret } } } });
    const args = [
      "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--setting-sources", "", "--tools", "", "--strict-mcp-config", "--mcp-config", config,
      "--allowedTools", PREFIX + "*", "--disallowedTools", "ScheduleWakeup,CronCreate,Monitor",
      "--permission-mode", "default", "--no-session-persistence", "--append-system-prompt-file", this.promptFile,
      "--model", this.model, ...(this.effort ? ["--effort", this.effort] : []),
    ];
    const env = { ...cleanEnv(), CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1", MCP_TOOL_TIMEOUT: String(24 * 3600 * 1000), MCP_TIMEOUT: "30000" };
    // `command` may be [executable, ...leading args] (tests run a fake CLI through node).
    const [exe, ...lead] = Array.isArray(this.command) ? this.command : [this.command];
    this.proc = spawn(exe, [...lead, ...args], { cwd: this.directory, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
        try { this.event(JSON.parse(line)); } catch {}
      }
    });
    let stderr = "";
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (c) => { stderr = (stderr + c).slice(-4000); });
    this.proc.stdin.on("error", () => {});
    this.proc.on("error", (e) => { console.warn("No se pudo iniciar Claude Code: " + e.message); this.error ||= Object.assign(Error("No se pudo iniciar Claude Code: " + e.message), { status: 503 }); this.close(); });
    this.proc.on("exit", (code) => {
      if (this.alive && !this.error) {
        const auth = /not logged in|please log in|run .?claude auth login|invalid api key|401/i.test(stderr);
        this.error = Object.assign(Error(auth ? "Claude Code no tiene la sesión iniciada. Abre una terminal y ejecuta «claude auth login»." : "Claude Code se cerró (" + code + ")."), auth ? { status: 401 } : { transient: true }, { detail: stderr.slice(-2000) });
        // Local diagnostics only (the server log of this computer); never shown to the person.
        console.warn("Claude Code se cerró (" + code + "): " + stderr.slice(-1500).replace(/s+/g, " "));
      }
      this.close();
    });
  }

  /** Loopback MCP: list this step's tools; a call waits until the runtime runs it. */
  async mcp(req, res) {
    if (req.headers.authorization !== "Bearer " + this.secret || !String(req.url).startsWith("/mcp")) { res.writeHead(403); res.end(); return; }
    const server = new Server({ name: "colmena", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools.map((t) => ({ name: t.name, description: String(t.description || "").slice(0, 10000), inputSchema: t.parameters || { type: "object", properties: {} } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, (request) => new Promise((resolve) => {
      const name = String(request.params.name || "");
      const args = request.params.arguments || {};
      const use = this.uses.find((u) => !u.matched && u.name === PREFIX + name && same(u.input, args)) || this.uses.find((u) => !u.matched && u.name === PREFIX + name);
      if (use) use.matched = true;
      this.arrived.push({ call_id: use?.id || "cli_" + randomUUID().replace(/-/g, "").slice(0, 24), name, arguments: JSON.stringify(args), resolve, at: Date.now() });
      this.notify();
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  event(e) {
    this.usedAt = Date.now();
    if (e.type === "stream_event" && !e.parent_tool_use_id) {
      const ev = e.event || {};
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") this.onDelta?.(ev.delta.text || "");
      else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") this.onEvent?.({ type: "response.reasoning_summary_text.delta" });
      else if (ev.type === "message_start") this.onEvent?.({ type: "response.created" });
    } else if (e.type === "assistant" && !e.parent_tool_use_id && e.message) {
      const m = e.message;
      for (const b of m.content || []) {
        if (b.type === "text" && b.text) this.text += b.text;
        else if (b.type === "tool_use" && !this.uses.some((u) => u.id === b.id)) this.uses.push({ id: b.id, name: b.name, input: b.input, matched: false });
      }
      if (m.id && m.usage) this.usage.set(m.id, m.usage);
      this.notify();
    } else if (e.type === "result") {
      if (e.is_error && !this.error) this.error = cliFailure(String(e.result || e.subtype || "error"));
      if (!this.text && typeof e.result === "string") this.text = e.result;
      this.turnDone = true;
      this.notify();
    }
  }

  send(content) { this.turnDone = false; this.proc.stdin.write(userLine(content)); }

  /** Resolves the waiting MCP calls with the runtime's outputs. */
  deliver(outputs) {
    for (const o of outputs) {
      const resolve = this.waiting.get(o.call_id);
      if (!resolve) continue;
      this.waiting.delete(o.call_id);
      const parts = typeof o.output === "string" ? [{ type: "text", text: o.output || "(sin resultado)" }]
        : (Array.isArray(o.output) ? o.output : []).map((p) => {
          if (p?.type === "input_image") {
            const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(p.image_url?.url || p.image_url || ""));
            return m ? { type: "image", data: m[2], mimeType: m[1] } : null;
          }
          return p?.text ? { type: "text", text: String(p.text) } : null;
        }).filter(Boolean);
      resolve({ content: parts.length ? parts : [{ type: "text", text: "(sin resultado)" }] });
    }
  }

  /** Waits for the next stop: tool calls ready, the turn finished, an error or the abort. */
  async next(signal) {
    for (;;) {
      if (this.error) throw this.error;
      if (signal?.aborted) throw signal.reason || Error("Cancelado");
      const quiet = this.arrived.length && Date.now() - this.arrived.at(-1).at >= SETTLE_MS;
      if (quiet || (this.turnDone && !this.arrived.length)) break;
      await new Promise((resolve) => {
        const t = setTimeout(resolve, this.arrived.length ? SETTLE_MS : 1000);
        const stop = () => { clearTimeout(t); resolve(); };
        this.wake = stop;
        signal?.addEventListener?.("abort", stop, { once: true });
      });
    }
    const calls = this.arrived.splice(0);
    for (const c of calls) this.waiting.set(c.call_id, c.resolve);
    const text = this.text;
    this.text = "";
    const usage = [...this.usage.values()];
    this.usage.clear();
    return { calls, text, usage };
  }

  close() {
    if (!this.alive && !this.server) return;
    this.alive = false;
    try { this.proc?.kill(); } catch {}
    try { this.server?.close(); } catch {}
    this.server = null;
    for (const resolve of this.waiting.values()) resolve({ content: [{ type: "text", text: "(cancelado)" }], isError: true });
    this.waiting.clear();
    if (this.promptFile) rm(this.promptFile, { force: true }).catch(() => {});
    this.notify();
    this.onExit?.(this);
  }
}

const sumUsage = (list) => {
  let input = 0, output = 0, cached = 0;
  for (const u of list) {
    const read = Number(u.cache_read_input_tokens) || 0;
    input += (Number(u.input_tokens) || 0) + read + (Number(u.cache_creation_input_tokens) || 0);
    output += Number(u.output_tokens) || 0;
    cached += read;
  }
  return input + output ? { input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: { cached_tokens: cached } } : null;
};

export class ClaudeCliProvider {
  constructor({ directory = path.join(os.tmpdir(), "colmena-claude-cli"), command = undefined, spawnSession = null } = {}) {
    this.directory = directory;
    this.command = command;
    this.sessions = new Map();
    this.spawnSession = spawnSession; // tests inject a fake session
    this.names = { name: "Claude Code", limit: "Has alcanzado el límite de tu plan de Claude.", auth: "Inicia sesión en Claude Code («claude auth login») y vuelve a probar." };
    const sweep = setInterval(() => { for (const s of this.sessions.values()) if (Date.now() - s.usedAt > IDLE_MS && !s.waiting.size) s.close(); }, 60000);
    sweep.unref?.();
  }
  supportsReasoning() { return true; }
  supportsCacheKey() { return true; }
  supportsNativeSearch() { return false; }
  nativeSearchAvailable() { return false; }
  async warm() { return false; }
  async generateImage() { throw imageUnsupported("Claude no crea imágenes. Conecta tu cuenta de ChatGPT para que tus bots puedan hacerlas."); }
  close() { for (const s of this.sessions.values()) s.close(); this.sessions.clear(); }

  async open(key, { model, effort, tools, instructions }) {
    const command = this.command === undefined ? findClaudeCli() : this.command;
    if (!command && !this.spawnSession) throw Object.assign(Error("Claude Code no está instalado en este ordenador."), { status: 503 });
    const options = { command, model, effort, tools, instructions, directory: path.join(this.directory, createHash("sha256").update(key).digest("hex").slice(0, 16)), onExit: (s) => { if (this.sessions.get(key) === s) this.sessions.delete(key); } };
    const session = this.spawnSession ? this.spawnSession(options) : new CliSession(options);
    await session.start();
    this.sessions.set(key, session);
    return session;
  }

  async respond({ model, instructions, input, tools = [], signal, onDelta = () => {}, onEvent = () => {}, reasoning = null, cacheKey = null, side = false }) {
    const entry = modelEntry(model);
    const id = entry?.id || String(model || "").replace(/^[\w-]+\//, "");
    const effort = (typeof reasoning === "string" ? reasoning : reasoning?.effort) || (side ? "low" : null);
    const items = Array.isArray(input) ? input : [{ role: "user", content: String(input || "") }];
    const key = String(cacheKey || "side-" + randomUUID());
    let s = this.sessions.get(key);
    const fresh = items.slice(s?.consumed ?? 0);
    const outputs = fresh.filter((x) => x?.type === "function_call_output");
    const rest = fresh.filter((x) => x?.type !== "function_call_output");
    const head = createHash("sha256").update(JSON.stringify(items[0] ?? null)).digest("hex");
    const continues = s?.alive && s.model === id && s.sig === toolsSig(tools) && s.head === head && items.length >= s.consumed &&
      (s.waiting.size ? outputs.length >= s.waiting.size && [...s.waiting.keys()].every((c) => outputs.some((o) => o.call_id === c)) && rest.every((x) => x.role === "user") : s.turnDone && outputs.length === 0 && rest.length > 0 && rest.every((x) => x.role === "user"));
    const started = Date.now();
    if (continues) {
      s.onDelta = onDelta; s.onEvent = onEvent;
      s.deliver(outputs);
      const extra = rest.map((x) => textOf(x.content)).filter((t) => t.trim()).join("\n\n");
      if (extra) {
        if (s.turnDone) s.send([{ type: "text", text: extra }]);
        else s.proc?.stdin?.write(userLine([{ type: "text", text: extra }]));
      }
    } else {
      s?.close();
      s = await this.open(key, { model: id, effort, tools, instructions });
      s.onDelta = onDelta; s.onEvent = onEvent;
      const onlyUser = items.every((x) => x?.role === "user" && !x.type);
      const first = onlyUser ? items.map((x) => textOf(x.content)).filter(Boolean).join("\n\n")
        : "Continúa este trabajo. Esto es lo que ha pasado hasta ahora en este paso (transcripción de Colmena):\n\n" + transcriptOf(items) + "\n\nSigue desde aquí: si quedan herramientas por usar, úsalas; si ya está, responde.";
      s.send([{ type: "text", text: first || "." }]);
    }
    let round;
    try {
      round = await s.next(signal);
    } catch (error) {
      if (signal?.aborted) { s.close(); throw signal.reason || error; }
      s.close();
      throw error;
    }
    const output = [];
    if (round.text.trim()) output.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: round.text, annotations: [] }] });
    for (const c of round.calls) output.push({ type: "function_call", call_id: c.call_id, name: c.name, arguments: c.arguments, status: "completed" });
    s.consumed = items.length + output.length;
    s.head = head;
    return { output, text: round.text, usage: sumUsage(round.usage), responseId: null, transport: "cli", model: entry?.ref || model, webSearch: null, timing: { firstEventMs: null, firstTokenMs: Date.now() - started } };
  }
}
