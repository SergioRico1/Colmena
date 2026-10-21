// Anthropic Messages provider (OpenClaw packages/ai/src/transports/anthropic-*.ts), through
// the official SDK. Two credentials, as in OpenClaw's anthropic extension:
// - API key (`sk-ant-api…`): x-api-key, direct pay-as-you-go billing.
// - Subscription setup-token (`sk-ant-oat01-…`, from `claude setup-token`): Bearer plus the
//   Claude Code client identity Anthropic gates subscription tokens on (beta list, x-app,
//   claude-cli user agent, billing header and the Claude Code system block, Claude Code
//   tool casing). OpenClaw sends exactly this; Colmena copies it without variations.
// The same class speaks to OpenCode Go's Anthropic route (Qwen) with its key and base URL.
import Anthropic from "@anthropic-ai/sdk";
import { imageUnsupported } from "../images.mjs";
import { modelEntry, opencodeSession } from "./catalog.mjs";
import { toMessages, toolsOf, fromMessage, usageOf } from "./anthropic-items.mjs";
import { limitHeaders } from "../limits.mjs";

/** Minimum Claude Code version advertised with subscription tokens (OpenClaw floor). */
export const CLAUDE_CODE_VERSION = "2.1.280";
const OAUTH_BETAS = "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14";
const BINDING_BETA = "thinking-binding-controls-2026-08-01";
// Claude Code's own tools keep their exact casing on subscription requests (OpenClaw
// anthropic-tool-projection.ts); every other name travels unchanged.
const CLAUDE_CODE_TOOLS = ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "KillShell", "NotebookEdit", "Skill", "Task", "TaskOutput", "TodoWrite", "WebFetch", "WebSearch"];
const CASING = new Map(CLAUDE_CODE_TOOLS.map((n) => [n.toLowerCase(), n]));

/** A pasted setup-token: no whitespace, `sk-ant-oat01-` and at least 80 characters (OpenClaw). */
export function validateSetupToken(raw) {
  const token = String(raw || "").replace(/[\s\u00A0\u200B-\u200D\u2060\uFEFF\u00AD]+/g, "");
  if (!token.startsWith("sk-ant-oat01-")) return { error: "El token debe empezar por sk-ant-oat01-. Genéralo con «claude setup-token»." };
  if (token.length < 80) return { error: "El token parece incompleto. Cópialo entero." };
  return { token };
}
export const isSubscriptionToken = (value) => /sk-ant-oat/.test(String(value || ""));

const EFFORT = { minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
const effortOf = (reasoning) => (typeof reasoning === "string" ? reasoning : reasoning?.effort) || null;

/** SDK / HTTP errors → Colmena errors (status, Spanish message, transient flag). */
function toError(error, names) {
  if (error?.name === "AbortError" || error instanceof Anthropic.APIUserAbortError) return error;
  const status = Number.isInteger(error?.status) ? error.status : null;
  const detail = String(error?.error?.error?.message || error?.message || "").slice(0, 4000);
  const type = String(error?.error?.error?.type || error?.error?.type || "");
  let message;
  if (status === 429 || /rate_limit/.test(type)) message = names.limit;
  else if (status === 401 || status === 403) message = names.auth;
  else if (status === 529 || /overloaded/.test(type)) message = names.name + " está saturado ahora mismo.";
  else if (status === 402 || /credit|billing/i.test(detail)) message = names.name + " no tiene saldo para esta petición.";
  else message = names.name + (status ? ` rechazó la petición (${status}).` : " cortó la respuesta.");
  const out = Object.assign(Error(message), { status, detail, providerCode: type || null, headers: limitHeaders(error?.headers) });
  if (status === null && !(error instanceof Anthropic.APIError)) out.cause = error;
  // Streams cut mid-way (no status) and overloaded/server errors are retried.
  if (status === null || status === 529 || /overloaded|api_error/.test(type)) out.transient = true;
  return out;
}

export class AnthropicProvider {
  /**
   * `credential()` → {type:'api_key', key} | {type:'token', token} | null.
   * `engine` names the Colmena engine (anthropic, opencode-go) for messages and refs.
   */
  constructor({ credential, fetchImpl = fetch, baseUrl = "https://api.anthropic.com", names, direct = true, engine = "anthropic" } = {}) {
    this.credential = credential;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
    this.direct = direct; // api.anthropic.com itself: betas, binding controls, hosted search
    this.engine = engine;
    this.names = names || { name: "Claude", limit: "Has alcanzado el límite de tu cuenta de Claude.", auth: "Reconecta tu cuenta de Claude en Ajustes." };
    this.nativeSearch = direct;
    this.caching = true;
    this.binding = true;
    this.clients = new Map();
  }
  supportsReasoning() { return true; }
  supportsCacheKey() { return false; }
  supportsNativeSearch() { return this.direct; }
  nativeSearchAvailable() { return this.supportsNativeSearch() && this.nativeSearch !== false; }
  async warm() { return false; }
  async generateImage() { throw imageUnsupported("Claude no crea imágenes. Conecta tu cuenta de ChatGPT para que tus bots puedan hacerlas."); }

  async client() {
    const cred = await this.credential();
    if (!cred) throw Object.assign(Error("Conecta tu cuenta de " + this.names.name + " en Ajustes."), { status: 401 });
    const secret = cred.type === "token" ? cred.token : cred.key;
    const oauth = this.direct && (cred.type === "token" || isSubscriptionToken(secret));
    const key = (oauth ? "o:" : "k:") + secret;
    if (this.clients.has(key)) return this.clients.get(key);
    const headers = oauth
      ? { accept: "application/json", "anthropic-dangerous-direct-browser-access": "true", "anthropic-beta": OAUTH_BETAS, "x-app": "cli", "user-agent": "claude-cli/" + CLAUDE_CODE_VERSION }
      : { accept: "application/json", "anthropic-dangerous-direct-browser-access": "true" };
    const sdk = new Anthropic({
      baseURL: this.baseUrl, fetch: this.fetch, maxRetries: 0, timeout: 600000, defaultHeaders: headers,
      ...(oauth ? { apiKey: null, authToken: secret } : { apiKey: secret, authToken: null }),
    });
    const value = { sdk, oauth };
    this.clients.clear();
    this.clients.set(key, value);
    return value;
  }

  /** The model id on the wire and its catalogue entry. */
  route(model) {
    const entry = modelEntry(model);
    const id = entry?.id || String(model || "").replace(/^[\w-]+\//, "");
    return { id, entry, ref: entry?.ref || model };
  }

  body({ id, entry, oauth, instructions, input, tools, effort, search, caching, binding, stripThinking }) {
    const nameFor = oauth ? (n) => CASING.get(String(n).toLowerCase()) || n : (n) => n;
    const vision = !entry || entry.input.includes("image");
    const { messages } = toMessages(input, { model: id, vision, stripThinking, nameFor, engine: this.engine });
    const system = [];
    if (oauth) {
      system.push({ type: "text", text: `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}; cc_entrypoint=sdk-cli;` });
      system.push({ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." });
    }
    if (String(instructions || "").trim()) system.push({ type: "text", text: String(instructions) });
    // Prompt caching (OpenClaw anthropic-payload-policy): the stable system prompt, then the
    // conversation (top-level automatic breakpoint on the last cacheable block).
    if (caching && system.length) system[system.length - 1].cache_control = { type: "ephemeral" };
    const defs = toolsOf(tools).map((t) => ({ ...t, name: nameFor(t.name) }));
    if (search && entry?.search) defs.push({ type: entry.search, name: "web_search", max_uses: 5 });
    const max = Math.min(entry?.maxTokens || 64000, 64000);
    const body = { model: id, max_tokens: max, messages, ...(system.length ? { system } : {}), ...(defs.length ? { tools: defs } : {}) };
    if (caching) body.cache_control = { type: "ephemeral" };
    const thinking = entry?.thinking || "adaptive";
    if (thinking === "adaptive") {
      body.thinking = { type: "adaptive", display: "summarized", ...(binding ? { block_binding: { prefix_mismatch_behavior: "drop_block" } } : {}) };
      if (effort) body.output_config = { effort };
    }
    return body;
  }

  /**
   * One round, streamed. Returns {output, text, usage, responseId, transport, webSearch,
   * timing, model}. A 400 is answered at most once per cause (cache markers, thinking
   * binding, stale thinking, hosted search, effort), as ResponsesProvider does.
   */
  async respond({ model, instructions, input, tools = [], signal, onDelta = () => {}, onEvent = () => {}, reasoning = null, webSearch = false, side = false, cacheKey = null }) {
    const { id, entry, ref } = this.route(model);
    const { sdk, oauth } = await this.client();
    let effort = EFFORT[effortOf(reasoning)] || (side || entry?.utility ? "low" : null);
    if (effort && entry?.efforts && !entry.efforts.includes(effort)) effort = entry.efforts[0];
    let search = !!webSearch && this.nativeSearchAvailable() && !!entry?.search;
    let caching = this.caching, binding = this.direct && !oauth && this.binding, stripThinking = false;
    let sentAt = Date.now(), firstEventMs = null, firstTokenMs = null;
    const event = (e) => { if (firstEventMs === null) firstEventMs = Date.now() - sentAt; try { onEvent(e); } catch {} };
    const token = () => { if (firstTokenMs === null) firstTokenMs = Date.now() - sentAt; };
    const nameOf = (n) => (oauth ? CLAUDE_CODE_TOOLS.includes(n) ? tools.find((t) => t.name?.toLowerCase() === n.toLowerCase())?.name || n : n : n);
    for (let attempt = 0; ; attempt++) {
      const body = this.body({ id, entry, oauth, instructions, input, tools, effort, search, caching, binding, stripThinking });
      const extra = { ...(binding ? { "anthropic-beta": BINDING_BETA } : {}), ...(this.engine === "opencode-go" ? opencodeSession(cacheKey) : {}) };
      const headers = Object.keys(extra).length ? extra : undefined;
      sentAt = Date.now(); firstEventMs = null; firstTokenMs = null;
      try {
        let message = null, total = 0;
        // pause_turn (a long server-side search): continue the same turn, up to 3 times.
        for (let pass = 0; pass < 4; pass++) {
          const stream = sdk.messages.stream(body, { signal, ...(headers ? { headers } : {}) });
          for await (const e of stream) {
            if (e.type === "message_start") event({ type: "response.created" });
            else if (e.type === "content_block_start" && e.content_block?.type === "server_tool_use") event({ type: "response.web_search_call.searching" });
            else if (e.type === "content_block_delta") {
              if (e.delta?.type === "text_delta") {
                token();
                total += e.delta.text.length;
                if (total > 200000) throw Object.assign(Error("Respuesta demasiado extensa."), { own: true });
                onDelta(e.delta.text);
              } else if (e.delta?.type === "thinking_delta") { token(); event({ type: "response.reasoning_summary_text.delta" }); }
              else if (e.delta?.type === "input_json_delta") { token(); event({ type: "response.function_call_arguments.delta" }); }
            }
          }
          const part = await stream.finalMessage();
          message = message ? { ...part, content: [...message.content, ...part.content], usage: sumUsage(message.usage, part.usage) } : part;
          if (part.stop_reason !== "pause_turn") break;
          body.messages = [...body.messages, { role: "assistant", content: part.content }];
        }
        if (message.stop_reason === "refusal")
          throw Object.assign(Error(this.names.name + " ha declinado esta petición por sus normas de seguridad."), { own: true, providerCode: "refusal" });
        const output = fromMessage(message, { model: id, nameOf, engine: this.engine });
        if (message.stop_reason === "max_tokens" && output.some((x) => x.type === "function_call"))
          throw Object.assign(Error(this.names.name + " cortó la respuesta antes de terminar una herramienta."), { own: true, transient: true });
        const text = output.filter((x) => x.type === "message").flatMap((x) => x.content).map((c) => c.text).join("\n");
        return { output, text, usage: usageOf(message.usage), responseId: message.id, transport: "sse", model: ref, webSearch: search ? "native" : webSearch ? "unavailable" : null, timing: { firstEventMs, firstTokenMs } };
      } catch (raw) {
        if (signal?.aborted) throw signal.reason || raw;
        const error = raw?.own ? raw : toError(raw, this.names);
        if (error.status !== 400 || attempt >= 4) throw error;
        const detail = String(error.detail || "");
        if (binding && /block_binding|binding|anthropic-beta|beta/i.test(detail)) { binding = false; this.binding = false; }
        else if (caching && /cache_control/i.test(detail)) { caching = false; this.caching = false; }
        else if (!stripThinking && /signature|thinking/i.test(detail)) stripThinking = true;
        else if (search && /web_search|server tool|tool type/i.test(detail)) { search = false; this.nativeSearch = false; }
        else if (effort && /effort|output_config/i.test(detail)) effort = null;
        else throw error;
      }
    }
  }
}

function sumUsage(a = {}, b = {}) {
  const keys = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
  return Object.fromEntries(keys.map((k) => [k, (Number(a?.[k]) || 0) + (Number(b?.[k]) || 0)]));
}
