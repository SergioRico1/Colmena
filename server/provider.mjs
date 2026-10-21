import path from "node:path";
import { consumeSSE } from "./nexo/protocol.mjs";
import { RESOURCE } from "./nexo/security.mjs";
import { windowsVault } from "./nexo/credential-vault.mjs";
import { imageUnsupported, IMAGES_UNSUPPORTED } from "./images.mjs";
import { ResponseSockets, SocketUnavailable } from "./provider-ws.mjs";
import { chooseModel, parseModel } from "./models.mjs";
import { cheapestModel } from "./checkins.mjs";
import { ENGINES, ENGINE_LABEL, CATALOG, ANTHROPIC_API, OPENCODE_GO_API, OPENCODE_GO_ANTHROPIC_API, OPENCODE_GO_CHECK_MODEL, opencodeSession, parseRef, modelEntry, listEntry } from "./providers/catalog.mjs";
import { AnthropicProvider, validateSetupToken, isSubscriptionToken } from "./providers/anthropic.mjs";
import { CompletionsProvider } from "./providers/completions.mjs";
import { ClaudeCliProvider, probeClaudeCli, claudeCliVersion, CLI_MIN_VERSION, newerOrEqual } from "./providers/claude-cli.mjs";
import { cleanSecret, checkOpenCodeKey } from "./providers/secret-input.mjs";
import { limitHeaders, usageLimitOf, UNKNOWN_RESET_MS, PROVIDER_LIMIT_CODE } from "./limits.mjs";

// Responses API over SSE. Tools are only returned after the final
// `response.completed` confirms them; partial or contradictory streams fail.
export const THINKING_EFFORT = { rapido: "low", equilibrado: "medium", profundo: "high" };
export const OPENAI_API = "https://api.openai.com/v1";
/** Waits before each retry of a failed inference (OpenClaw model-failover: bounded same-model recovery). */
export const RETRY_DELAYS = Object.freeze([2000, 6000, 15000]);
export const UNAVAILABLE_CODE = "COLMENA_PROVIDER_UNAVAILABLE";

const effortOf = (reasoning) => (typeof reasoning === "string" ? reasoning : reasoning?.effort) || null;

/**
 * Temporary failures worth retrying with the same model: 429, 5xx, timeouts, network errors
 * and streams cut before `response.completed`. Never auth, bad requests or the monthly cap.
 */
export function isTransientError(error) {
  if (!error || error.code === "COLMENA_MONTHLY_LIMIT" || error.code === UNAVAILABLE_CODE || error.code === PROVIDER_LIMIT_CODE) return false;
  if (error.transient === true) return true;
  if (Number.isInteger(error.status)) return error.status === 429 || error.status === 408 || error.status >= 500;
  if (["TimeoutError", "AbortError"].includes(error.name)) return error.name === "TimeoutError" || /timeout|tiempo/i.test(String(error.message));
  const code = error.code || error.cause?.code || "";
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_\w+)$/.test(code)) return true;
  return error instanceof TypeError && /fetch failed|network|terminated/i.test(String(error.message));
}

/** Up to `max` bytes of an error body (diagnostics only; never shown verbatim to the person). */
async function errorDetail(response, max = 8192) {
  try {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    try { await reader.cancel(); } catch {}
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8").slice(0, max);
  } catch {
    return "";
  }
}

function httpError(response, errors, detail) {
  const error = Error(
    response.status === 429 ? errors.limit : response.status === 401 || response.status === 403 ? errors.auth : `${errors.name} rechazo la peticion (${response.status}).`,
  );
  error.status = response.status;
  error.detail = detail;
  error.headers = limitHeaders(response.headers);
  return error;
}

/**
 * The ChatGPT plan's usage windows, when the backend reports them in response headers
 * (x-codex-primary-used-percent, …-window-minutes, …-reset-after-seconds; same for
 * «secondary»). Null when it does not. Shown as «te queda X % del plan» (OpenClaw /status).
 */
export function planLimitsOf(headers, at = Date.now()) {
  const get = (k) => (typeof headers?.get === "function" ? headers.get(k) : headers?.[k]) ?? null;
  const windowOf = (name) => {
    const used = Number(get("x-codex-" + name + "-used-percent"));
    if (!Number.isFinite(used) || get("x-codex-" + name + "-used-percent") === null) return null;
    const minutes = Number(get("x-codex-" + name + "-window-minutes"));
    const after = Number(get("x-codex-" + name + "-reset-after-seconds"));
    return { usedPercent: Math.max(0, Math.min(100, Math.round(used))), windowMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null, resetsAt: Number.isFinite(after) && after >= 0 ? new Date(at + after * 1000).toISOString() : null };
  };
  const primary = windowOf("primary"), secondary = windowOf("secondary");
  return primary || secondary ? { primary, secondary, at: new Date(at).toISOString() } : null;
}

/**
 * Collects one streamed response (SSE or WebSocket events): text deltas go to `onDelta`,
 * tool calls are only returned after `response.completed` confirms them. `finish()` gives
 * {output, text, usage, responseId} or throws.
 */
export function responseCollector({ onDelta = () => {}, onEvent = () => {}, errors }) {
  let completed = null, responseId = null, total = 0;
  const items = new Map();
  const cut = (message) => Object.assign(Error(message), { transient: true });
  const handle = (event) => {
    if (typeof event?.type === "string" && /^response\.(web_search_call|output_item\.added|created|in_progress)/.test(event.type)) {
      try { onEvent(event); } catch {}
    }
    const incoming = event.response_id || event.response?.id;
    if (incoming) {
      if (responseId && incoming !== responseId) throw Error("Eventos de respuestas distintas.");
      responseId = incoming;
    }
    if (event.type === "response.output_text.delta") {
      total += event.delta?.length || 0;
      if (total > 200000) throw Error("Respuesta demasiado extensa.");
      onDelta(event.delta || "");
    }
    if (event.type === "response.output_item.done") {
      if (!Number.isInteger(event.output_index) || event.output_index < 0 || event.output_index > 100 || !event.item)
        throw Error("Elemento de respuesta invalido.");
      items.set(event.output_index, event.item);
    }
    if (event.type === "response.completed") completed = event.response;
    if (["response.failed", "response.incomplete", "error"].includes(event.type)) {
      const code = String(event.response?.error?.code || event.error?.code || event.code || "");
      const error = Error(errors.name + " interrumpio la respuesta; no se ejecutarán sus herramientas.");
      // Server-side failures are retried; invalid requests, policy and context errors are not.
      error.transient = event.type !== "response.incomplete" && !/invalid|policy|content|context|length|billing|quota|usage_limit/i.test(code);
      error.providerCode = code || null;
      // The plan ran out mid-stream (WebSocket or SSE error event): a 429 with its renewal time.
      if (/usage_limit|rate_limit|quota/i.test(code) || Number(event.status ?? event.error?.status) === 429) {
        error.status = 429;
        error.transient = false;
        error.detail = JSON.stringify(event.error || event.response?.error || event).slice(0, 4000);
        if (event.headers && typeof event.headers === "object") error.headers = limitHeaders(event.headers);
      }
      throw error;
    }
  };
  const finish = () => {
    if (!completed || completed.status !== "completed" || !Array.isArray(completed.output))
      throw cut("Falta la confirmacion final de " + errors.name + ".");
    for (const [index, item] of completed.output.entries()) {
      const previous = [...items].find(([, v]) => (item.id && v.id === item.id) || (item.call_id && v.call_id === item.call_id));
      if (previous) {
        const old = previous[1];
        if (old.type !== item.type || (item.type === "function_call" && (old.call_id !== item.call_id || old.name !== item.name || old.arguments !== item.arguments)))
          throw Error("Herramienta final contradictoria.");
        items.set(previous[0], item);
      } else {
        if (items.has(index)) throw Error("Indices finales contradictorios.");
        items.set(index, item);
      }
    }
    const output = [...items.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
    if (JSON.stringify(output).length > 800000) throw Error("Respuesta demasiado grande.");
    const calls = output.filter((x) => x.type === "function_call");
    if (new Set(calls.map((c) => c.call_id)).size !== calls.length || calls.some((c) => !c.call_id || !c.name || typeof c.arguments !== "string"))
      throw Error("Llamadas de herramientas invalidas.");
    return {
      output,
      text: output
        .filter((x) => x.type === "message")
        .flatMap((x) => x.content || [])
        .filter((x) => x.type === "output_text" || x.type === "refusal")
        .map((x) => x.text || x.refusal || "")
        .join("\n"),
      usage: completed.usage || null,
      responseId: completed.id || responseId,
    };
  };
  return { handle, finish, cut };
}

async function streamResponses({ fetchImpl, url, headers, body, signal, onDelta, onEvent = () => {}, errors }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted && signal.reason) throw signal.reason;
    throw error;
  }
  if (!response.ok) throw httpError(response, errors, await errorDetail(response));
  const limits = planLimitsOf(response.headers);
  const collector = responseCollector({ onDelta, onEvent, errors });
  try {
    await consumeSSE(response.body, collector.handle);
  } catch (error) {
    if (signal?.aborted && signal.reason) throw signal.reason;
    if (/terminó a mitad|termino a mitad/i.test(String(error?.message))) throw collector.cut(errors.name + " cortó la respuesta a medias.");
    throw error;
  }
  return { ...collector.finish(), limits, transport: "sse" };
}

/** Shared request logic; subclasses supply URL, headers and capability checks. */
class ResponsesProvider {
  constructor({ fetchImpl = fetch, errors, includeEncrypted = false, sockets } = {}) {
    this.fetch = fetchImpl;
    this.errors = errors;
    this.includeEncrypted = includeEncrypted;
    // Real network only: an injected fetch (tests, previews) never opens sockets.
    this.sockets = sockets !== undefined ? sockets : fetchImpl === fetch && !process.env.NODE_TEST_CONTEXT ? new ResponseSockets() : null;
    this.limitsEveryMs = Infinity;
  }
  supportsReasoning() { return true; }
  /** Opens the warm socket of a bot and mission before its first round (you are typing). */
  async warm(cacheKey) {
    if (!this.sockets || !cacheKey || !this.supportsCacheKey()) return false;
    try {
      const { url, headers } = await this.target();
      if (!this.sockets.supports(url, cacheKey)) return false;
      const sent = this.sessionHeader ? { ...headers, session_id: String(cacheKey).slice(0, 64) } : headers;
      return await this.sockets.warm(String(cacheKey), sent);
    } catch {
      return false;
    }
  }
  /** prompt_cache_key (OpenAI prompt caching): related calls land where their prefix is cached. */
  supportsCacheKey() { return this.cacheKeys !== false; }
  /** Hosted {type:"web_search"} (OpenClaw native-web-search): OpenAI endpoints only. */
  supportsNativeSearch() { return true; }
  /** false once the endpoint rejected the hosted search tool during this session. */
  nativeSearchAvailable() { return this.supportsNativeSearch() && this.nativeSearch !== false; }
  async target() { throw Error("Proveedor no configurado."); }
  prepareInput(input) { return input; }
  /** Items only another provider understands (Claude / Chat Completions turns, their searches). */
  foreignFree(input) {
    return Array.isArray(input) ? input.filter((x) => x?.type !== "native_turn" && !(x?.type === "web_search_call" && !/^ws_/.test(String(x.id || "")))) : input;
  }
  /**
   * `webSearch: true` adds the hosted search tool. A 400 is answered at most once per
   * cause: without reasoning (if the error names it), without the sources include, or
   * without the search tool — which then stays off for the whole session (fallback: web_fetch).
   * The result carries `webSearch: 'native'|'unavailable'|null`.
   */
  /** Headers a provider adds to each request (OpenCode's conversation id). */
  requestHeaders() { return null; }
  async respond({ model, instructions, input, tools = [], signal, onDelta: deltaOut = () => {}, onEvent: eventOut = () => {}, reasoning = null, webSearch = false, cacheKey = null, side = false }) {
    // Timing of each attempt: the first event (the server started) and the first word or tool
    // call argument (what you start to see), measured from the moment the request left.
    let sentAt = Date.now(), firstEventMs = null, firstTokenMs = null;
    const onEvent = (event) => {
      if (firstEventMs === null) firstEventMs = Date.now() - sentAt;
      if (firstTokenMs === null && /output_text\.delta|function_call_arguments\.delta|reasoning_summary_text\.delta/.test(String(event?.type || ""))) firstTokenMs = Date.now() - sentAt;
      eventOut(event);
    };
    const onDelta = (...a) => { if (firstTokenMs === null) firstTokenMs = Date.now() - sentAt; deltaOut(...a); };
    const { url, headers: targetHeaders, model: forced } = await this.target();
    const headers = { ...targetHeaders, ...(this.requestHeaders({ cacheKey }) || {}) };
    const chosen = forced || model;
    const effort = effortOf(reasoning);
    let withReasoning = !!effort && this.supportsReasoning(chosen, effort);
    let search = !!webSearch && this.nativeSearchAvailable();
    let sources = search && this.searchSources !== false;
    let keyed = !!cacheKey && this.supportsCacheKey();
    const build = () => {
      const body = { model: chosen, instructions, input: this.prepareInput(this.foreignFree(input)), tools: search ? [...tools, { type: "web_search" }] : tools, stream: true, store: false };
      if (keyed) body.prompt_cache_key = String(cacheKey).slice(0, 64);
      if (withReasoning) body.reasoning = { effort: search && effort === "minimal" ? "low" : effort };
      const include = [];
      if (this.includeEncrypted || withReasoning) include.push("reasoning.encrypted_content");
      if (search && sources) include.push("web_search_call.action.sources");
      if (include.length) body.include = include;
      return body;
    };
    for (let attempt = 0; ; attempt++) {
      try {
        // The ChatGPT backend routes its prompt cache by this header (as Codex and OpenClaw send it).
        const sent = keyed && this.sessionHeader ? { ...headers, session_id: String(cacheKey).slice(0, 64) } : headers;
        const body = build();
        let result = null;
        sentAt = Date.now(); firstEventMs = null; firstTokenMs = null;
        // A warm WebSocket for this bot and mission when the endpoint takes it (OpenClaw);
        // every so often SSE instead, whose headers carry the plan's usage windows.
        // The plan's usage windows only travel in SSE headers: a side task (a title, a
        // narration…) refreshes them when due; a bot's rounds always stay on its socket.
        const probe = side && Date.now() - (this.limitsAt || 0) >= this.limitsEveryMs;
        if (keyed && this.sockets?.supports(url, cacheKey) && !probe) {
          try {
            result = await this.sockets.run({ key: String(cacheKey), headers: sent, body, signal, collector: () => responseCollector({ onDelta, onEvent, errors: this.errors }) });
          } catch (error) {
            if (!(error instanceof SocketUnavailable)) throw error;
          }
        }
        if (!result) {
          result = await streamResponses({ fetchImpl: this.fetch, url, headers: sent, body, signal, onDelta, onEvent, errors: this.errors });
          this.limitsAt = Date.now();
        }
        return { ...result, webSearch: search ? "native" : webSearch ? "unavailable" : null, timing: { firstEventMs, firstTokenMs } };
      } catch (error) {
        if (error.status !== 400 || attempt >= 3 || signal?.aborted) throw error;
        const detail = String(error.detail || "");
        if (keyed && /prompt_cache_key/i.test(detail)) { keyed = false; this.cacheKeys = false; }
        else if (withReasoning && (!search || /reasoning|effort/i.test(detail))) withReasoning = false;
        else if (search && sources && /include|sources/i.test(detail)) { sources = false; this.searchSources = false; }
        else if (search) { search = false; this.nativeSearch = false; }
        else throw error;
      }
    }
  }
  /**
   * One PNG through the hosted {type:"image_generation"} tool (OpenClaw
   * generateOpenAICodexImage): a separate request with tool_choice forced to it.
   * Returns {base64, revisedPrompt, usage}. Plans without the tool → IMAGES_UNSUPPORTED.
   */
  async generateImage({ model, prompt, size = "1024x1024", signal, onPhase = () => {} }) {
    const { url, headers, model: forced } = await this.target();
    const body = {
      model: forced || model,
      instructions: "Eres un asistente que genera imágenes. Genera exactamente una imagen a partir de la petición.",
      input: [{ role: "user", content: [{ type: "input_text", text: String(prompt) }] }],
      tools: [{ type: "image_generation", size, output_format: "png" }],
      tool_choice: { type: "image_generation" },
      stream: true,
      store: false,
    };
    let response;
    try {
      response = await this.fetch(url, { method: "POST", redirect: "error", signal, headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers }, body: JSON.stringify(body) });
    } catch (error) {
      if (signal?.aborted && signal.reason) throw signal.reason;
      throw error;
    }
    if (!response.ok) {
      const detail = await errorDetail(response);
      if (response.status === 404 || (response.status === 403 && /image|tool|plan|permission|not allowed/i.test(detail)) || (response.status === 400 && /image|tool|not supported|unsupported|not allowed|unknown/i.test(detail)))
        throw imageUnsupported();
      throw httpError(response, this.errors, detail);
    }
    const streamed = [];
    let completed = null;
    await consumeSSE(response.body, (event) => {
      if (event.type === "response.image_generation_call.in_progress") onPhase("Preparando");
      else if (event.type === "response.image_generation_call.generating") onPhase("Dibujando");
      else if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call") streamed.push(event.item);
      else if (event.type === "response.completed") completed = event.response;
      else if (["response.failed", "error"].includes(event.type)) {
        const message = String(event.response?.error?.message || event.error?.message || event.message || "");
        if (/image.?generation|not (enabled|supported|available)|unsupported/i.test(message)) throw imageUnsupported();
        throw Object.assign(Error("OpenAI no pudo crear la imagen" + (/safety|policy|moderation/i.test(message) ? ": la petición no cumple sus normas de uso." : ".")), { transient: !/safety|policy|moderation/i.test(message) });
      } else if (event.type === "response.incomplete") throw Error("OpenAI dejó la imagen a medias.");
    }, { maxBuffer: 64 * 1024 * 1024 });
    if (!completed) throw Object.assign(Error("OpenAI cortó la creación de la imagen."), { transient: true });
    const output = Array.isArray(completed.output) ? completed.output : [];
    const calls = output.filter((x) => x?.type === "image_generation_call");
    const item = [...(calls.length ? calls : streamed)].find((x) => typeof x.result === "string" && x.result);
    if (!item) {
      const said = output.filter((x) => x?.type === "message").flatMap((x) => x.content || [])
        .map((c) => (c.type === "refusal" ? c.refusal : c.type === "output_text" ? c.text : "")).filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
      throw Error(said ? "OpenAI no ha creado la imagen: «" + said + "»" : "OpenAI terminó sin crear la imagen.");
    }
    if (item.status && item.status !== "completed") throw Error("OpenAI no terminó la imagen (" + String(item.status).slice(0, 40) + ").");
    return { base64: item.result, revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt.slice(0, 2000) : null, usage: completed.usage || null };
  }
}

/** ChatGPT plan through the OAuth session (constructor kept for existing callers and tests). */
export class OpenAIProvider extends ResponsesProvider {
  constructor(session, { fetchImpl = fetch } = {}) {
    super({
      fetchImpl,
      includeEncrypted: true,
      errors: { name: "OpenAI", limit: "Has alcanzado el limite de tu plan de ChatGPT.", auth: "Reconecta tu cuenta de ChatGPT." },
    });
    this.session = session;
    this.sessionHeader = true;
    // The plan's usage windows only travel in SSE response headers: one SSE call every 10 min.
    this.limitsEveryMs = 10 * 60 * 1000;
  }
  supportsReasoning(model, effort) {
    const entry = this.session?.models?.find?.((m) => m.slug === model);
    if (!entry || !Array.isArray(entry.reasoning_efforts) || !entry.reasoning_efforts.length) return !entry;
    return entry.reasoning_efforts.includes(effort);
  }
  async target() {
    return { url: RESOURCE + "/responses", headers: { Authorization: "Bearer " + (await this.session.accessToken()) } };
  }
}

export class ApiKeyProvider extends ResponsesProvider {
  constructor(loadKey, { fetchImpl = fetch } = {}) {
    super({
      fetchImpl,
      errors: { name: "OpenAI", limit: "La clave de OpenAI ha alcanzado su limite de uso.", auth: "La clave de OpenAI no es valida. Revisala en Ajustes." },
    });
    this.loadKey = loadKey;
  }
  supportsReasoning(model) { return /^(o\d|gpt-5|gpt-6)/.test(model || ""); }
  async target() {
    const key = await this.loadKey();
    if (!key) throw Error("Guarda una clave de OpenAI en Ajustes.");
    return { url: OPENAI_API + "/responses", headers: { Authorization: "Bearer " + key } };
  }
}

export function normalizeLocalUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { throw Error("Direccion local no valida."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash)
    throw Error("Solo se admite un modelo local en http://127.0.0.1 o http://localhost.");
  const base = url.origin + url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return base;
}

export class LocalProvider extends ResponsesProvider {
  constructor(config, { fetchImpl = fetch } = {}) {
    super({
      fetchImpl,
      errors: { name: "El modelo local", limit: "El modelo local esta ocupado.", auth: "El modelo local rechazo el acceso." },
    });
    this.config = config;
  }
  supportsReasoning() { return false; }
  supportsNativeSearch() { return false; }
  supportsCacheKey() { return false; }
  /** OpenAI-only items (encrypted reasoning, hosted searches) are not sent to a local server. */
  prepareInput(input) {
    return Array.isArray(input) ? input.filter((x) => !["reasoning", "web_search_call", "image_generation_call"].includes(x?.type)) : input;
  }
  async generateImage() {
    throw imageUnsupported("El modelo local no puede crear imágenes. Conecta tu cuenta de ChatGPT en Ajustes.");
  }
  async target() {
    const { baseUrl, model } = this.config();
    if (!baseUrl || !model) throw Error("Configura el modelo local en Ajustes.");
    return { url: normalizeLocalUrl(baseUrl) + "/v1/responses", headers: {}, model };
  }
}

/** OpenCode Go's Responses route (GPT-5.6 Luna): same wire as OpenAI, its own key and host. */
export class GoResponsesProvider extends ResponsesProvider {
  constructor(loadKey, { fetchImpl = fetch } = {}) {
    super({ fetchImpl, sockets: null, errors: { name: "OpenCode Go", limit: "Has alcanzado el límite de tu plan de OpenCode Go.", auth: "Reconecta OpenCode Go en Ajustes." } });
    this.loadKey = loadKey;
  }
  supportsNativeSearch() { return false; }
  supportsCacheKey() { return false; }
  requestHeaders({ cacheKey } = {}) { return opencodeSession(cacheKey); }
  prepareInput(input) {
    return Array.isArray(input) ? input.filter((x) => !["reasoning", "web_search_call", "image_generation_call"].includes(x?.type)) : input;
  }
  async generateImage() { throw imageUnsupported("Este modelo no crea imágenes. Conecta tu cuenta de ChatGPT para que tus bots puedan hacerlas."); }
  async target() {
    const key = await this.loadKey();
    if (!key) throw Object.assign(Error("Conecta OpenCode Go en Ajustes."), { status: 401 });
    return { url: OPENCODE_GO_API + "/responses", headers: { Authorization: "Bearer " + key }, model: null };
  }
}

const KEY_BINDING = { profile: "openai-apikey", hostId: "colmena-provider-v1", clientId: "openai-apikey", subject: "apikey" };
// Claude and OpenCode credentials: one DPAPI profile each, like OpenClaw's typed auth
// profiles (api_key | token) — never in SQLite, which only keeps the last 4 characters.
const BINDINGS = {
  "anthropic-apikey": { profile: "anthropic-apikey", hostId: "colmena-provider-v1", clientId: "anthropic-apikey", subject: "apikey" },
  "anthropic-token": { profile: "anthropic-token", hostId: "colmena-provider-v1", clientId: "anthropic-token", subject: "token" },
  "opencode-apikey": { profile: "opencode-apikey", hostId: "colmena-provider-v1", clientId: "opencode-apikey", subject: "apikey" },
};
const CONFIG_ID = "main";
/** A provider that failed for its account (limit, auth, outage) rests before it is tried again. */
const COOLDOWNS = [30000, 60000, 300000];

/**
 * Routes inference to the engine of each model (OpenClaw provider/model refs):
 * - openai: the ChatGPT session, an OpenAI API key (DPAPI vault) or a loopback
 *   OpenAI-compatible server (Ollama…) — bare model slugs, as always;
 * - anthropic: «anthropic/<id>» through an API key, a subscription setup-token or the
 *   Claude Code CLI of this computer;
 * - opencode-go: «opencode-go/<id>» through the OpenCode key, on the model's own route.
 * Config lives in store records 'providers'/main: {kind, apikey:{hint}, local:{baseUrl, model},
 * anthropic:{method, hint, email}, opencode:{hint}, primary, fallback, pins:{engine:{family:ref}}}.
 */
export class ProviderHub {
  constructor({ session = null, store, vault, fetchImpl = fetch, claudeCli = null } = {}) {
    this.session = session;
    this.store = store;
    this.fetch = fetchImpl;
    this.vault = vault === undefined ? windowsVault(path.join(store.directory, "provider")) : vault;
    this.keyCache = undefined;
    this.secrets = new Map();
    this.cooldown = new Map(); // engine → {until, strikes}
    this.chatgpt = session ? new OpenAIProvider(session, { fetchImpl }) : null;
    this.apikey = new ApiKeyProvider(() => this.loadKey(), { fetchImpl });
    this.local = new LocalProvider(() => this.config().local || {}, { fetchImpl });
    this.anthropic = new AnthropicProvider({ credential: () => this.anthropicCredential(), fetchImpl });
    this.claudeCli = claudeCli || new ClaudeCliProvider({ directory: path.join(store.directory, "claude-cli") });
    const goKey = () => this.secret("opencode-apikey");
    const goNames = { name: "OpenCode Go", limit: "Has alcanzado el límite de tu plan de OpenCode Go.", auth: "Reconecta OpenCode Go en Ajustes." };
    this.goChat = new CompletionsProvider({ loadKey: goKey, fetchImpl, baseUrl: OPENCODE_GO_API, names: goNames });
    this.goAnthropic = new AnthropicProvider({ credential: async () => { const key = await goKey(); return key ? { type: "api_key", key } : null; }, fetchImpl, baseUrl: OPENCODE_GO_ANTHROPIC_API, direct: false, engine: "opencode-go", names: goNames });
    this.goResponses = new GoResponsesProvider(goKey, { fetchImpl });
  }
  config() {
    return this.store.get("providers", CONFIG_ID) || { id: CONFIG_ID, kind: null, apikey: null, local: null };
  }
  saveConfig(patch) {
    return this.store.put("providers", { ...this.config(), ...patch, updatedAt: new Date().toISOString() });
  }
  async loadKey() {
    if (this.keyCache !== undefined) return this.keyCache;
    if (!this.vault) return (this.keyCache = null);
    const stored = await this.vault.load(KEY_BINDING);
    return (this.keyCache = typeof stored?.key === "string" ? stored.key : null);
  }
  /** A Claude/OpenCode secret from the vault (cached for the session). */
  async secret(name) {
    if (this.secrets.has(name)) return this.secrets.get(name);
    const stored = this.vault ? await this.vault.load(BINDINGS[name]) : null;
    const value = typeof stored?.key === "string" ? stored.key : typeof stored?.token === "string" ? stored.token : null;
    this.secrets.set(name, value);
    return value;
  }
  async anthropicCredential() {
    const method = this.config().anthropic?.method;
    if (method === "api_key") { const key = await this.secret("anthropic-apikey"); return key ? { type: "api_key", key } : null; }
    if (method === "token") { const token = await this.secret("anthropic-token"); return token ? { type: "token", token } : null; }
    return null;
  }
  chatgptConnected() {
    const status = this.session?.status?.();
    return !!status && status.canInfer !== false;
  }
  /** Active OpenAI flavour: explicit choice if usable, otherwise the ChatGPT session. */
  get kind() {
    const c = this.config();
    if (c.kind === "apikey" && c.apikey) return "apikey";
    if (c.kind === "local" && c.local?.baseUrl && c.local?.model) return "local";
    if (this.chatgptConnected()) return "chatgpt";
    if (c.apikey) return "apikey";
    if (c.local?.baseUrl && c.local?.model) return "local";
    return null;
  }

  // ------------------------------------------------------------- engines
  connected(engine) {
    const c = this.config();
    if (engine === "openai") return !!this.kind;
    if (engine === "anthropic") return ["api_key", "token", "cli"].includes(c.anthropic?.method);
    if (engine === "opencode-go") return !!c.opencode?.hint;
    return false;
  }
  /** The team's engine: the one chosen in Ajustes if connected, else the first connected. */
  get primary() {
    const chosen = this.config().primary;
    if (ENGINES.includes(chosen) && this.connected(chosen)) return chosen;
    return ENGINES.find((e) => this.connected(e)) || null;
  }
  /** Engine of a bot: its own choice (Ajustes › Qué usa cada bot) when connected, else the team's. */
  engineFor(bot) {
    return ENGINES.includes(bot?.engine) && this.connected(bot.engine) ? bot.engine : this.primary;
  }
  /** Models of an engine in the {slug, label, families, utility} shape models.mjs reads. */
  modelsFor(engine = this.primary) {
    if (engine === "openai") return this.kind === "local" ? [] : Array.isArray(this.session?.models) ? this.session.models : [];
    const list = CATALOG[engine];
    if (!list) return [];
    // Ajustes › Avanzado can pin a model to a family; the pinned one wins that family. A pin
    // to a model the catalogue no longer has is ignored (the family keeps its default).
    const pins = Object.fromEntries(Object.entries(this.config().pins?.[engine] || {}).filter(([, ref]) => list.some((m) => m.ref === ref)));
    return list.map((m) => {
      const entry = listEntry(m);
      const pinned = Object.entries(pins).filter(([, ref]) => ref === m.ref).map(([f]) => f);
      const families = [...new Set([...entry.families.filter((f) => !pins[f] || pins[f] === m.ref), ...pinned])];
      return { ...entry, families, rank: pinned.length ? 1000 + entry.rank : entry.rank };
    });
  }
  engines() {
    const c = this.config();
    const a = c.anthropic || null, o = c.opencode || null;
    return ENGINES.map((id) => ({
      id, label: ENGINE_LABEL[id], connected: this.connected(id),
      ...(id === "openai" ? { detail: this.connected("openai") ? this.openaiStatus().label : null } : {}),
      ...(id === "anthropic" ? { method: a?.method || null, detail: a?.method === "cli" ? "Claude Code" + (a.email ? " · " + a.email : "") : a?.method === "token" ? "Token de suscripción ····" + (a.hint || "") : a?.method === "api_key" ? "Clave de API ····" + (a.hint || "") : null } : {}),
      ...(id === "opencode-go" ? { detail: o?.hint ? "Clave ····" + o.hint : null } : {}),
      resting: this.resting(id),
      limit: this.limitOf(id),
    }));
  }
  openaiStatus() {
    const kind = this.kind, c = this.config();
    if (kind === "chatgpt") {
      const s = this.session.status();
      return { kind, label: s?.email || s?.label || "Cuenta ChatGPT", connected: true };
    }
    if (kind === "apikey") return { kind, label: "Clave de OpenAI ····" + (c.apikey?.hint || ""), connected: true };
    if (kind === "local") return { kind, label: "Modelo local · " + c.local.model, connected: true };
    return { kind: null, label: "Sin conectar", connected: false };
  }
  /** The team's engine as one status line (aiConnected reads `kind`). */
  status() {
    const primary = this.primary;
    if (!primary || primary === "openai") return this.openaiStatus();
    const e = this.engines().find((x) => x.id === primary);
    return { kind: primary, label: e.label + (e.detail ? " · " + e.detail : ""), connected: true };
  }

  // -------------------------------------------------------- credentials
  async setApiKey(key) {
    const value = String(key || "").trim();
    if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(value)) throw Error("La clave de OpenAI no tiene un formato válido.");
    if (!this.vault) throw Error("El almacen cifrado de Windows no está disponible.");
    const response = await this.fetch(OPENAI_API + "/models", {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: "Bearer " + value },
    });
    if (!response.ok) throw Error(response.status === 401 ? "OpenAI no acepta esta clave." : `OpenAI rechazo la clave (${response.status}).`);
    await this.vault.save(KEY_BINDING, { key: value });
    this.keyCache = value;
    this.saveConfig({ kind: "apikey", apikey: { hint: value.slice(-4), savedAt: new Date().toISOString() } });
    return this.status();
  }
  setLocal({ baseUrl, model }) {
    const base = normalizeLocalUrl(baseUrl);
    const name = String(model || "").trim();
    if (!/^[\w.:/@-]{1,120}$/.test(name)) throw Error("Indica el nombre del modelo local.");
    this.saveConfig({ kind: "local", local: { baseUrl: base, model: name } });
    return this.status();
  }
  /**
   * Claude, the three ways OpenClaw offers: an API key (checked against GET /v1/models),
   * a subscription setup-token from `claude setup-token` (checked with one tiny request
   * as Claude Code), or the Claude Code CLI already signed in on this computer.
   */
  async connectAnthropic({ method, secret = "" }) {
    if (method === "cli") {
      const probe = await probeClaudeCli();
      if (probe.status === "not_installed") throw Error("Claude Code no está instalado en este ordenador.");
      if (probe.status !== "available") throw Error("Claude Code no tiene la sesión iniciada. Abre una terminal y ejecuta «claude auth login».");
      const version = await claudeCliVersion();
      if (version && !newerOrEqual(version, CLI_MIN_VERSION)) throw Error(`Tu Claude Code (${version}) es demasiado antiguo para los modelos actuales. Actualízalo con «claude update» (hace falta la ${CLI_MIN_VERSION} o posterior).`);
      this.saveConfig({ anthropic: { method: "cli", email: probe.email || null, authMethod: probe.authMethod || null, version, savedAt: new Date().toISOString() }, primary: this.config().primary || "anthropic" });
      this.cooldown.delete("anthropic");
      return this.engines();
    }
    if (!this.vault) throw Error("El almacén cifrado de Windows no está disponible.");
    if (method === "api_key") {
      const key = cleanSecret(secret);
      if (!/^sk-ant-[A-Za-z0-9_-]{20,400}$/.test(key) || isSubscriptionToken(key)) throw Error("La clave de Anthropic no tiene un formato válido (empieza por sk-ant-api…).");
      const response = await this.fetch(ANTHROPIC_API + "/v1/models", { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
      if (!response.ok) throw Error(response.status === 401 ? "Anthropic no acepta esta clave." : `Anthropic rechazó la clave (${response.status}).`);
      await this.vault.save(BINDINGS["anthropic-apikey"], { key });
      this.secrets.set("anthropic-apikey", key);
      this.saveConfig({ anthropic: { method: "api_key", hint: key.slice(-4), savedAt: new Date().toISOString() }, primary: this.config().primary || "anthropic" });
    } else if (method === "token") {
      const { token, error } = validateSetupToken(secret);
      if (error) throw Error(error);
      const probe = new AnthropicProvider({ credential: async () => ({ type: "token", token }), fetchImpl: this.fetch });
      try {
        await probe.respond({ model: "anthropic/claude-haiku-5-5", instructions: "Responde solo «ok».", input: [{ role: "user", content: "ok" }], signal: AbortSignal.timeout(30000), side: true });
      } catch (e) {
        throw Error(e.status === 401 || e.status === 403 ? "Anthropic no acepta este token. Genera otro con «claude setup-token»." : "No se pudo comprobar el token: " + e.message);
      }
      await this.vault.save(BINDINGS["anthropic-token"], { token });
      this.secrets.set("anthropic-token", token);
      this.saveConfig({ anthropic: { method: "token", hint: token.slice(-4), savedAt: new Date().toISOString() }, primary: this.config().primary || "anthropic" });
    } else throw Error("Forma de conexión desconocida.");
    this.cooldown.delete("anthropic");
    return this.engines();
  }
  /** OpenCode Go: one key from opencode.ai/auth, checked against the Go model list. */
  async connectOpenCode({ key: raw }) {
    const { key, error } = checkOpenCodeKey(raw);
    if (error) throw Error(error);
    if (!this.vault) throw Error("El almacén cifrado de Windows no está disponible.");
    // The Go model list is public (OpenClaw: not an entitlement check), so the key is checked
    // with a one-token answer from the cheapest model.
    const response = await this.fetch(OPENCODE_GO_API + "/chat/completions", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key, ...opencodeSession() },
      body: JSON.stringify({ model: OPENCODE_GO_CHECK_MODEL, messages: [{ role: "user", content: "ok" }], max_tokens: 1, stream: false }),
    });
    if (response.status === 401 || response.status === 403) throw Error("OpenCode no acepta esta clave (o no tiene una suscripción de OpenCode Go activa).");
    if (response.status === 402) throw Error("Tu cuenta de OpenCode no tiene saldo ni una suscripción de Go activa.");
    if (!response.ok && response.status !== 429) throw Error(`OpenCode rechazó la comprobación de la clave (${response.status}).`);
    await this.vault.save(BINDINGS["opencode-apikey"], { key });
    this.secrets.set("opencode-apikey", key);
    this.saveConfig({ opencode: { hint: key.slice(-4), savedAt: new Date().toISOString() }, primary: this.config().primary || "opencode-go" });
    this.cooldown.delete("opencode-go");
    return this.engines();
  }
  /** Team engine, what to use when it fails, and pinned models per family (Ajustes). */
  setEngines({ primary, fallback, pins } = {}) {
    const c = this.config();
    const patch = {};
    if (primary !== undefined) {
      if (primary !== null && (!ENGINES.includes(primary) || !this.connected(primary))) throw Error("Conecta esa cuenta antes de elegirla.");
      patch.primary = primary;
    }
    if (fallback !== undefined) {
      if (![...ENGINES, "local", "none", null].includes(fallback)) throw Error("Sustituto no válido.");
      patch.fallback = fallback;
    }
    if (pins !== undefined) {
      const next = { ...(c.pins || {}) };
      for (const [engine, families] of Object.entries(pins || {})) {
        if (!CATALOG[engine]) continue;
        const clean = {};
        for (const [family, ref] of Object.entries(families || {})) if (["luna", "sol", "astra"].includes(family) && ref && CATALOG[engine].some((m) => m.ref === ref)) clean[family] = ref;
        next[engine] = clean;
      }
      patch.pins = next;
    }
    this.saveConfig(patch);
    return this.engines();
  }
  /** Switches back to ChatGPT (kind 'chatgpt') or removes a saved key/local server/account. */
  async clear(kind) {
    const c = this.config();
    if (kind === "apikey") {
      if (this.vault) await this.vault.remove(KEY_BINDING.profile);
      this.keyCache = null;
      this.saveConfig({ apikey: null, kind: c.kind === "apikey" ? null : c.kind });
    } else if (kind === "local") this.saveConfig({ local: null, kind: c.kind === "local" ? null : c.kind });
    else if (kind === "chatgpt") this.saveConfig({ kind: null });
    else if (kind === "anthropic") {
      if (this.vault) for (const name of ["anthropic-apikey", "anthropic-token"]) await this.vault.remove(BINDINGS[name].profile);
      this.secrets.delete("anthropic-apikey"); this.secrets.delete("anthropic-token");
      this.anthropic.clients.clear();
      this.claudeCli.close?.();
      this.saveConfig({ anthropic: null, primary: c.primary === "anthropic" ? null : c.primary ?? null });
    } else if (kind === "opencode-go") {
      if (this.vault) await this.vault.remove(BINDINGS["opencode-apikey"].profile);
      this.secrets.delete("opencode-apikey");
      this.saveConfig({ opencode: null, primary: c.primary === "opencode-go" ? null : c.primary ?? null });
    } else throw Error("Proveedor desconocido.");
    return this.status();
  }

  /** Every connected engine's models (the settings picker validates against this list). */
  async models() {
    const out = [];
    if (this.kind) out.push(...(await this.openaiModels()));
    for (const engine of ["anthropic", "opencode-go"]) if (this.connected(engine)) out.push(...this.modelsFor(engine));
    return out;
  }
  async openaiModels() {
    const kind = this.kind;
    if (kind === "chatgpt") {
      const list = this.session.models?.length ? this.session.models : await this.session.listModels();
      return list.map((m) => ({ slug: m.slug, label: m.display_name || m.label || m.slug }));
    }
    if (kind === "local") {
      const { model } = this.config().local;
      return [{ slug: model, label: model + " (local)" }];
    }
    if (kind === "apikey") {
      const key = await this.loadKey();
      const response = await this.fetch(OPENAI_API + "/models", { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: "Bearer " + key } });
      if (!response.ok) throw Error(`OpenAI rechazo la peticion (${response.status}).`);
      const data = await response.json();
      return (Array.isArray(data?.data) ? data.data : [])
        .map((m) => m?.id)
        .filter((id) => typeof id === "string" && /^(gpt-|o\d)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search)/.test(id))
        .sort()
        .slice(0, 100)
        .map((slug) => ({ slug, label: slug }));
    }
    return [];
  }
  provider(kind = this.kind) {
    if (kind === "chatgpt") return this.chatgpt;
    if (kind === "apikey") return this.apikey;
    if (kind === "local") return this.local;
    throw Error("Conecta ChatGPT, Claude u OpenCode Go en Ajustes › Inteligencia.");
  }
  /** The adapter that speaks a model's wire protocol. */
  providerFor(model) {
    const { engine } = parseRef(model);
    if (engine === "anthropic") return this.config().anthropic?.method === "cli" ? this.claudeCli : this.anthropic;
    if (engine === "opencode-go") {
      const api = modelEntry(model)?.api || "openai-completions";
      return api === "anthropic-messages" ? this.goAnthropic : api === "openai-responses" ? this.goResponses : this.goChat;
    }
    return this.provider(this.kind);
  }
  /**
   * The model a call really uses. A bare ChatGPT slug while OpenAI is not connected (the
   * account default in old settings, a caller that never heard of other engines) becomes
   * the team engine's model of the same family.
   */
  resolveModel(model) {
    const { engine } = parseRef(model);
    if (engine !== "openai" || this.kind || !this.primary || this.primary === "openai") return model;
    return this.equivalent(model, this.primary) || model;
  }
  /** Same family on another engine (OpenClaw fallbacks list, by role instead of by name). */
  equivalent(model, engine) {
    const list = this.modelsFor(engine);
    if (!list.length) return engine === "openai" && this.kind === "local" ? this.config().local?.model || null : null;
    const entry = modelEntry(model) || null;
    const family = entry?.families?.[0] || (entry?.utility ? null : parseModel(model)?.family) || null;
    if (!family && (entry?.utility || /mini|nano|luna/.test(String(model)))) return cheapestModel(list) || list[0].slug;
    return chooseModel({ modelFamily: family || "sol" }, list, list[0].slug).slug;
  }
  /** Is this engine resting after failures for its account (limit, auth, outage)? */
  resting(engine) { return (this.cooldown.get(engine)?.until || 0) > Date.now() || !!this.limitOf(engine); }

  // ------------------------------------------------------ usage limits
  /**
   * The engine's usage limit while it lasts (T3 Code usage-limit recovery): {engine, kind,
   * label, window, resetsAt, until, at}. Kept in the providers record, so a restart still
   * knows when each one renews; `until` is the renewal time, or a later look when unknown.
   */
  limitOf(engine) {
    const l = this.config().limits?.[engine];
    return l && Date.parse(l.until) > Date.now() ? l : null;
  }
  /** Every engine that is limited now, by engine. */
  limits() {
    return Object.fromEntries(ENGINES.map((e) => [e, this.limitOf(e)]).filter(([, l]) => l));
  }
  markLimited(engine, limit, at = Date.now()) {
    const reset = Date.parse(limit?.resetsAt || "");
    const until = Number.isFinite(reset) && reset > at ? reset : at + UNKNOWN_RESET_MS;
    const entry = { engine, kind: limit?.kind || "usage", label: limit?.label || "límite de uso", window: limit?.window || null, resetsAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null, until: new Date(until).toISOString(), at: new Date(at).toISOString() };
    this.saveConfig({ limits: { ...(this.config().limits || {}), [engine]: entry } });
    this.cooldown.set(engine, { strikes: COOLDOWNS.length, until });
    return entry;
  }
  clearLimit(engine) {
    const limits = this.config().limits;
    if (!limits?.[engine]) return;
    const { [engine]: _gone, ...rest } = limits;
    this.saveConfig({ limits: rest });
  }
  rest(engine) {
    const c = this.cooldown.get(engine) || { strikes: 0 };
    const strikes = Math.min(c.strikes + 1, COOLDOWNS.length);
    this.cooldown.set(engine, { strikes, until: Date.now() + COOLDOWNS[strikes - 1] });
  }
  /**
   * Where a failed call goes next (Ajustes › Si falla, usar): another connected engine with
   * the same family, or the local model. Null when there is none (the mission pauses).
   */
  fallbackFor(model) {
    const { engine } = parseRef(model);
    const choice = this.config().fallback ?? this.store.get("settings", "main")?.fallback ?? "none";
    if (choice === "local") {
      const local = this.config().local;
      return local?.baseUrl && local?.model && this.kind !== "local" ? { engine: "openai", provider: this.local, model: local.model, label: "el modelo local" } : null;
    }
    if (!ENGINES.includes(choice) || choice === engine || !this.connected(choice) || this.resting(choice)) return null;
    const target = choice === "openai" ? this.equivalent(model, "openai") || this.store.get("settings", "main")?.model : this.equivalent(model, choice);
    return target ? { engine: choice, provider: choice === "openai" ? this.provider(this.kind) : this.providerFor(target), model: target, label: ENGINE_LABEL[choice] } : null;
  }
  /**
   * One inference. Callers that handle recovery themselves (Runtime#infer: retries, then
   * the fallback engine) pass `fallback: false`; other callers keep the immediate fallback
   * when the provider answers 429.
   */
  async respond({ fallback = true, ...params }) {
    const model = this.resolveModel(params.model);
    const { engine } = parseRef(model);
    try {
      const result = await this.providerFor(model).respond({ ...params, model });
      if (this.cooldown.has(engine)) this.cooldown.delete(engine);
      if (this.config().limits?.[engine]) this.clearLimit(engine);
      return { ...result, model: result.model || model, engine };
    } catch (error) {
      // The plan or quota ran out: the engine rests until it renews (not 30 s).
      const limit = usageLimitOf(error);
      if (limit?.kind === "usage" && !params.signal?.aborted) error.limit = this.markLimited(engine, limit);
      else if (error.status === 429 || error.status === 401 || error.status === 403 || error.status === 402) this.rest(engine);
      const next = fallback && error.status === 429 && !params.signal?.aborted ? this.fallbackFor(model) : null;
      if (next) return { ...(await next.provider.respond({ ...params, model: next.model, ...(next.engine === "openai" && next.provider === this.local ? { reasoning: null } : {}) })), model: next.model, engine: next.engine, fellBack: next.label };
      throw Object.assign(error, { engine });
    }
  }
  /** The local model when Ajustes › fallback is 'local', one is configured and it is not already in use. */
  fallbackProvider() {
    const settings = this.store.get("settings", "main") || {};
    const local = this.config().local;
    const choice = this.config().fallback ?? settings.fallback;
    if (this.kind === "local" || choice !== "local" || !local?.baseUrl || !local?.model) return null;
    return this.local;
  }
  /** Hosted web search for an engine (the team's by default) during this session. */
  nativeSearchAvailable(engine = this.primary) {
    if (!engine) return false;
    if (engine === "openai") return !!this.kind && this.provider(this.kind).nativeSearchAvailable();
    if (engine === "anthropic") return this.providerFor("anthropic/claude-opus-5-5").nativeSearchAvailable();
    return false;
  }
  async warm(cacheKey) {
    if (!this.kind || this.primary !== "openai") return false;
    return this.provider(this.kind).warm?.(cacheKey) ?? false;
  }
  /** Images only come from ChatGPT (hosted image_generation), whichever engine thinks. */
  async generateImage(params) {
    const kind = this.kind;
    if (!kind) throw imageUnsupported(this.primary ? "Para crear imágenes conecta tu cuenta de ChatGPT en Ajustes." : IMAGES_UNSUPPORTED);
    return await this.provider(kind).generateImage(params);
  }
  close() { this.claudeCli?.close?.(); }
}
