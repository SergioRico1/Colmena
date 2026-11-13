// The shared OpenAI-compatible Chat Completions adapter (OpenClaw
// packages/ai/src/transports/openai-completions-*). It speaks for every engine on that wire:
// OpenCode Go's Chat Completions route, Gemini (Google's OpenAI-compatible endpoint),
// OpenRouter, DeepSeek, Kimi and «Servidor propio». Colmena's Responses-style history is
// translated on the way out; the answer comes back as Responses items, preceded by a
// `native_turn` that keeps what only the same model may read again: its reasoning_content
// (DeepSeek and Kimi expect it back in tool rounds), OpenRouter's reasoning_details and
// Gemini's thought signatures (extra_content on each tool call).
import { consumeSSE } from "../nexo/protocol.mjs";
import { imageUnsupported } from "../images.mjs";
import { ENGINE_LABEL, modelEntry, opencodeSession } from "./catalog.mjs";
import { NATIVE } from "./anthropic-items.mjs";
import { limitHeaders } from "../limits.mjs";
import { isContextOverflow } from "../stopped.mjs";

const DERIVED = new Set(["message", "function_call", "web_search_call", "reasoning"]);
const NO_VISION = "[Imagen omitida: este modelo no puede ver imágenes.]";
const NO_PDF = "[PDF omitido: este modelo no puede leer archivos PDF.]";
/** Gemini skips its thought-signature check for tool calls it did not write (another model's). */
export const GEMINI_SKIP_SIGNATURE = "skip_thought_signature_validator";

const textOf = (content) =>
  typeof content === "string" ? content
    : (Array.isArray(content) ? content : []).map((c) => (["input_text", "output_text", "text"].includes(c?.type) ? c.text : c?.type === "refusal" ? c.refusal : "")).filter(Boolean).join("\n");
const imagesOf = (content) =>
  (Array.isArray(content) ? content : []).filter((c) => c?.type === "input_image").map((c) => c.image_url?.url || c.image_url).filter((u) => typeof u === "string" && u);
const filesOf = (content) =>
  (Array.isArray(content) ? content : []).filter((c) => c?.type === "input_file" && typeof c.file_data === "string" && c.file_data).map((c) => ({ filename: String(c.filename || "documento.pdf"), file_data: c.file_data }));

/**
 * Responses items → chat messages. Native extras (reasoning, reasoning_details, Gemini
 * signatures) are replayed only to the engine and model that wrote them. `vision` / `pdf` say
 * whether images and PDF files go as parts or are replaced by a note; `signatures` (Gemini)
 * gives every assistant tool round a thought signature (the model's own, else the skip value).
 */
export function toChatMessages(input, { instructions = "", model = "", engine = "opencode-go", vision = true, pdf = false, replayReasoning = true, signatures = false } = {}) {
  const items = typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? input : [];
  const out = instructions ? [{ role: "system", content: String(instructions) }] : [];
  let native = null; // the native turn whose derived items follow
  let pendingImages = [];
  const flushImages = () => {
    if (!pendingImages.length) return;
    out.push({ role: "user", content: [{ type: "text", text: "Capturas devueltas por la herramienta anterior:" }, ...pendingImages.map((url) => ({ type: "image_url", image_url: { url } }))] });
    pendingImages = [];
  };
  const assistant = () => {
    const last = out.at(-1);
    if (last?.role === "assistant" && !last.closed) return last;
    flushImages();
    const m = { role: "assistant", content: "" };
    if (native && replayReasoning && typeof native.reasoning === "string") m.reasoning_content = native.reasoning;
    if (native && Array.isArray(native.details) && native.details.length) m.reasoning_details = native.details;
    out.push(m);
    return m;
  };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === NATIVE) {
      const mine = item.provider === "completions" && item.model === model && (item.engine || "opencode-go") === engine;
      native = mine ? item : null;
      continue;
    }
    if (item.type === "function_call") {
      const m = assistant();
      const call = { id: String(item.call_id), type: "function", function: { name: item.name, arguments: item.arguments || "{}" } };
      const extra = native?.extras?.[item.call_id];
      if (extra && typeof extra === "object") call.extra_content = extra;
      (m.tool_calls ||= []).push(call);
      continue;
    }
    if (item.type === "function_call_output") {
      const last = out.at(-1);
      if (last?.role === "assistant") last.closed = true;
      native = null;
      const text = typeof item.output === "string" ? item.output : textOf(item.output);
      out.push({ role: "tool", tool_call_id: String(item.call_id), content: text || "(sin resultado)" });
      const imgs = typeof item.output === "string" ? [] : imagesOf(item.output);
      if (imgs.length) {
        if (vision) pendingImages.push(...imgs);
        else out.at(-1).content += "\n" + NO_VISION;
      }
      continue;
    }
    if (item.type === "message" && item.role === "assistant") {
      const m = assistant();
      m.content = [m.content, textOf(item.content)].filter(Boolean).join("\n");
      continue;
    }
    if (item.type && item.type !== "message") continue;
    if (item.role === "assistant") {
      const m = assistant();
      m.content = [m.content, textOf(item.content)].filter(Boolean).join("\n");
      continue;
    }
    if (!["user", "developer", "system"].includes(item.role)) continue;
    flushImages();
    native = null;
    const last = out.at(-1);
    if (last?.role === "assistant") last.closed = true;
    const imgs = imagesOf(item.content);
    const files = filesOf(item.content);
    const text = textOf(item.content);
    const parts = [...(vision ? imgs.map((url) => ({ type: "image_url", image_url: { url } })) : []), ...(pdf ? files.map((file) => ({ type: "file", file })) : [])];
    const notes = [imgs.length && !vision ? NO_VISION : "", files.length && !pdf ? NO_PDF : ""].filter(Boolean);
    const content = parts.length ? [{ type: "text", text: [text || ".", ...notes].join("\n") }, ...parts] : [text, ...notes].filter(Boolean).join("\n");
    out.push({ role: "user", content });
  }
  flushImages();
  const chat = repairChat(out);
  if (signatures) {
    for (const m of chat) {
      const first = m.role === "assistant" ? m.tool_calls?.[0] : null;
      if (first && !first.extra_content?.google?.thought_signature) first.extra_content = { ...(first.extra_content || {}), google: { ...(first.extra_content?.google || {}), thought_signature: GEMINI_SKIP_SIGNATURE } };
    }
  }
  return chat;
}

/** Every tool call is answered right after its assistant message; no orphan tool messages. */
function repairChat(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = { ...messages[i] };
    delete m.closed;
    if (m.role === "tool") {
      let k = out.length - 1;
      while (k >= 0 && out[k].role === "tool") k--;
      const owner = out[k];
      if (!owner || owner.role !== "assistant" || !owner.tool_calls?.some((c) => c.id === m.tool_call_id) || out.some((x) => x.role === "tool" && x.tool_call_id === m.tool_call_id)) continue;
      out.push(m);
      continue;
    }
    // Before anything else: answer the previous assistant's unanswered calls.
    let k = out.length - 1;
    while (k >= 0 && out[k].role === "tool") k--;
    const owner = out[k];
    if (owner?.role === "assistant" && owner.tool_calls?.length) {
      const answered = new Set(out.slice(k + 1).map((x) => x.tool_call_id));
      for (const c of owner.tool_calls) if (!answered.has(c.id)) out.push({ role: "tool", tool_call_id: c.id, content: "(sin resultado)" });
    }
    if (m.role === "assistant" && !m.content && !m.tool_calls?.length) continue;
    if (m.role === "assistant" && !m.content) m.content = null;
    out.push(m);
  }
  const last = [...out].reverse().find((x) => x.role !== "tool");
  if (last?.role === "assistant" && last.tool_calls?.length) {
    const answered = new Set(out.filter((x) => x.role === "tool").map((x) => x.tool_call_id));
    for (const c of last.tool_calls) if (!answered.has(c.id)) out.push({ role: "tool", tool_call_id: c.id, content: "(sin resultado)" });
  }
  return out;
}

const toolsOf = (tools = []) =>
  (Array.isArray(tools) ? tools : []).filter((t) => t?.name && (t.type === "function" || !t.type)).map((t) => ({
    type: "function",
    function: { name: t.name, description: String(t.description || "").slice(0, 10000), parameters: t.parameters || { type: "object", properties: {} } },
  }));

/** The provider's own words from an error body (JSON object, Gemini's [{error}] array or text). */
function errorBody(detail) {
  let body = null;
  try { body = JSON.parse(detail); } catch {}
  if (Array.isArray(body)) body = body[0];
  const e = body?.error && typeof body.error === "object" ? body.error : body;
  const said = typeof e?.message === "string" ? e.message : typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : String(detail || "");
  const code = String(e?.code ?? e?.type ?? e?.status ?? e?.metadata?.error_type ?? "");
  return { said: said.replace(/\s+/g, " ").trim().slice(0, 200), code };
}

const NO_CREDIT = /insufficient[_ ](balance|credits?|funds)|not enough (credits|balance)|no credits|credit balance|out of credits|payment required|billing|exceeded_current_quota_error|suspended/i;
const QUOTA = /quota|usage[_ ]limit|limit: 0|resource[_ ]exhausted|exceeded your current|daily limit|monthly limit|plan limit/i;
const NO_MODEL = /model[_ ]not[_ ]found|no such model|model .{0,80}(not found|does not exist|not exist|is not available|unavailable|not supported)|unknown model|invalid model|not a valid model|model_not_available|no endpoints found/i;

/**
 * A failed Chat Completions call as Colmena's plain sentence, keeping status, detail (the
 * provider's body: limits.mjs and stopped.mjs read it) and the limit headers. Never the key.
 */
export function chatError({ status, detail = "", headers = null, names, model = "" }) {
  const { said, code } = errorBody(detail);
  const name = names.name;
  const text = said + " " + code;
  let message, outStatus = status;
  if (isContextOverflow({ detail, providerCode: code })) message = `La conversación no cabe en ${model || "este modelo"}: es demasiado larga. Colmena la resume y lo vuelve a intentar.`;
  else if (status === 402 || NO_CREDIT.test(text)) { message = names.credit || `Tu cuenta de ${name} no tiene saldo. Recárgala en su web y vuelve a intentarlo.`; outStatus = 402; }
  else if (status === 401 || (status === 403 && !NO_MODEL.test(text)) || /invalid[_ ]api[_ ]key|api key not valid|incorrect api key|authentication/i.test(text)) { message = names.auth; if (status !== 403) outStatus = 401; }
  else if (status === 404 || NO_MODEL.test(text)) { message = `${name} no tiene el modelo «${model}». Elige otro en Ajustes › Cuentas de IA.`; outStatus = 404; }
  else if (status === 429) message = QUOTA.test(text) ? names.limit : `${name} pide ir más despacio: demasiadas peticiones seguidas.`;
  else if (status >= 500) message = `${name} no responde ahora mismo (${status}).`;
  else message = `${name} rechazó la petición (${status})${said ? ": " + said : "."}`;
  return Object.assign(Error(message), { status: outStatus, detail: String(detail || "").slice(0, 4000), providerCode: code || null, headers: limitHeaders(headers) });
}

/** The policy of one engine: reasoning switches, what is replayed, token field. */
function policyFor(engine, entry, effort) {
  const id = entry?.id || "";
  const level3 = effort === "low" || effort === "minimal" ? "low" : effort === "max" || effort === "xhigh" ? "max" : "high";
  if (engine === "opencode-go") {
    // OpenClaw opencode-go stream wrappers: DeepSeek effort, Kimi K2 without reasoning.
    if (/^kimi-k2/.test(id)) return { replay: false, params: {} };
    if (/^deepseek-v4/.test(id)) {
      const level = effort === "low" || effort === "minimal" ? (/flash/.test(id) ? "low" : "high") : effort === "max" ? "max" : "high";
      return { replay: true, backfill: true, params: { thinking: { type: "enabled" }, reasoning_effort: level } };
    }
    return { replay: true, params: {} };
  }
  // DeepSeek: thinking on, reasoning_content must come back in every later request with tools.
  if (engine === "deepseek") return { replay: true, backfill: true, params: { thinking: { type: "enabled" }, reasoning_effort: level3 } };
  // Kimi K3.x always thinks; the whole assistant message (reasoning_content too) goes back.
  if (engine === "moonshot") return { replay: true, backfill: true, maxField: "max_completion_tokens", params: effort ? { reasoning_effort: level3 } : {} };
  // Gemini: reasoning_effort maps onto its thinking levels; tool rounds need thought signatures.
  if (engine === "gemini") return { replay: false, signatures: true, params: effort ? { reasoning_effort: effort === "max" || effort === "xhigh" ? "high" : effort } : {} };
  // OpenRouter: one reasoning switch for every model that reasons; reasoning_details go back.
  if (engine === "openrouter") return { replay: false, params: effort && entry?.thinking !== "none" ? { reasoning: { effort: effort === "max" || effort === "xhigh" ? "high" : effort === "minimal" ? "low" : effort } } : {} };
  // Servidor propio: plain Chat Completions; no answer cap (a small server counts it against its window).
  if (engine === "custom") return { replay: true, noMax: true, lenient: true, params: {} };
  return { replay: true, params: {} };
}

export class CompletionsProvider {
  /**
   * `baseUrl` is a string or a function (Servidor propio reads the person's address each call);
   * `headers()` adds the engine's own headers (OpenRouter's app name); `keyOptional` lets a
   * server without a key answer; `names` gives the plain sentences of its errors.
   */
  constructor({ loadKey, fetchImpl = fetch, baseUrl, names, engine = "opencode-go", headers = null, keyOptional = false } = {}) {
    this.loadKey = loadKey;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
    this.engine = engine;
    this.extraHeaders = headers;
    this.keyOptional = keyOptional;
    const name = ENGINE_LABEL[engine] || "La IA";
    this.names = names || { name, limit: `Has llegado al límite de uso de ${name}.`, auth: `${name} no acepta la clave guardada. Revísala en Ajustes › Cuentas de IA.` };
  }
  supportsReasoning() { return true; }
  supportsCacheKey() { return false; }
  supportsNativeSearch() { return false; }
  nativeSearchAvailable() { return false; }
  async warm() { return false; }
  async generateImage() { throw imageUnsupported("Este modelo no crea imágenes. Conecta tu cuenta de ChatGPT para que tus bots puedan hacerlas."); }
  base() {
    const base = typeof this.baseUrl === "function" ? this.baseUrl() : this.baseUrl;
    if (!base) throw Object.assign(Error("Configura la dirección de " + this.names.name + " en Ajustes."), { status: 401 });
    return String(base).replace(/\/+$/, "");
  }
  /** Kept for callers of the OpenCode Go adapter; the engine's policy decides. */
  reasoningParams(entry, effort) { return policyFor(this.engine, entry, effort); }

  async respond({ model, instructions, input, tools = [], signal, onDelta = () => {}, onEvent = () => {}, reasoning = null, webSearch = false, cacheKey = null }) {
    const entry = modelEntry(model);
    const id = entry?.id || String(model || "").replace(/^[\w-]+\//, "");
    const key = await this.loadKey();
    if (!key && !this.keyOptional) throw Object.assign(Error("Conecta " + this.names.name + " en Ajustes."), { status: 401 });
    const effort = typeof reasoning === "string" ? reasoning : reasoning?.effort || null;
    const policy = this.reasoningParams({ ...(entry || {}), id }, effort);
    const vision = this.engine === "opencode-go" ? !entry || entry.input.includes("image") : !!entry?.input?.includes("image");
    const messages = toChatMessages(input, { instructions, model: id, engine: this.engine, vision, pdf: !!entry?.pdf, replayReasoning: policy.replay, signatures: !!policy.signatures });
    if (policy.backfill) for (const m of messages) if (m.role === "assistant" && !("reasoning_content" in m)) m.reasoning_content = "";
    const defs = toolsOf(tools);
    const body = { model: id, messages, stream: true, stream_options: { include_usage: true }, ...(defs.length ? { tools: defs } : {}), ...policy.params };
    if (!policy.noMax) body[policy.maxField || "max_tokens"] = Math.min(entry?.maxTokens || 32768, 64000);
    const sentAt = Date.now();
    let firstEventMs = null, firstTokenMs = null;
    const headers = {
      "Content-Type": "application/json", Accept: "text/event-stream",
      ...(key ? { Authorization: "Bearer " + key } : {}),
      ...(this.engine === "opencode-go" ? opencodeSession(cacheKey) : {}),
      ...(this.extraHeaders?.() || {}),
    };
    const url = this.base() + "/chat/completions";
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetch(url, { method: "POST", redirect: "error", signal, headers, body: JSON.stringify(body) });
      } catch (error) {
        if (signal?.aborted && signal.reason) throw signal.reason;
        throw error;
      }
      // A model that does not take the thinking switches answers once more without them.
      if (response.status === 400 && attempt === 0 && (body.thinking || body.reasoning_effort || body.reasoning)) {
        try { await response.body?.cancel(); } catch {}
        delete body.thinking;
        delete body.reasoning_effort;
        delete body.reasoning;
        continue;
      }
      break;
    }
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.text()).slice(0, 4000); } catch {}
      // What the provider says (its error message, never our key) helps to see what to change.
      console.warn(`${this.names.name} ${response.status} con ${id}: ${detail.slice(0, 1500).replace(/\s+/g, " ")}`);
      throw chatError({ status: response.status, detail, headers: response.headers, names: this.names, model: entry?.label || id });
    }
    let text = "", thinking = "", usage = null, finish = null, responseId = null, total = 0;
    const details = [];
    const calls = new Map();
    let lastIndex = null;
    try {
      await consumeSSE(response.body, (chunk) => {
        if (firstEventMs === null) { firstEventMs = Date.now() - sentAt; try { onEvent({ type: "response.created" }); } catch {} }
        if (chunk.error) {
          // A failure after the 200 (OpenRouter mid-stream errors carry a status-like code).
          const status = Number(chunk.error.code);
          const mapped = Number.isInteger(status) && status >= 400 ? chatError({ status, detail: JSON.stringify(chunk), names: this.names, model: entry?.label || id }) : null;
          if (mapped && status < 500 && status !== 408) throw mapped;
          throw Object.assign(Error(this.names.name + " interrumpió la respuesta."), { transient: true, providerCode: String(chunk.error.metadata?.error_type || chunk.error.code || chunk.error.type || ""), detail: JSON.stringify(chunk.error).slice(0, 2000) });
        }
        responseId ||= chunk.id || null;
        if (chunk.usage) usage = chunk.usage;
        for (const choice of chunk.choices || []) {
          const d = choice.delta || choice.message || {};
          const r = d.reasoning_content ?? d.reasoning ?? null;
          if (typeof r === "string" && r) { thinking += r; firstTokenMs ??= Date.now() - sentAt; try { onEvent({ type: "response.reasoning_summary_text.delta" }); } catch {} }
          if (Array.isArray(d.reasoning_details)) details.push(...d.reasoning_details.filter((x) => x && typeof x === "object"));
          if (typeof d.content === "string" && d.content) {
            firstTokenMs ??= Date.now() - sentAt;
            text += d.content;
            total += d.content.length;
            if (total > 200000) throw Error("Respuesta demasiado extensa.");
            onDelta(d.content);
          }
          for (const tc of d.tool_calls || []) {
            // The index ties streamed pieces together; without one (some servers), a new id is a
            // new call and a piece without id continues the last one.
            let index = Number.isInteger(tc.index) ? tc.index : null;
            if (index === null) {
              const known = tc.id ? [...calls].find(([, c]) => c.id === tc.id) : null;
              index = known ? known[0] : tc.id || lastIndex === null ? calls.size : lastIndex;
              while (!known && tc.id && calls.has(index)) index++;
            }
            const call = calls.get(index) || { id: "", name: "", arguments: "", extra: null };
            if (tc.id) call.id = tc.id;
            if (tc.function?.name) call.name = call.name && tc.function.name.startsWith(call.name) ? tc.function.name : call.name + tc.function.name;
            if (typeof tc.function?.arguments === "string") call.arguments += tc.function.arguments;
            else if (tc.function?.arguments && typeof tc.function.arguments === "object") call.arguments = JSON.stringify(tc.function.arguments);
            if (tc.extra_content && typeof tc.extra_content === "object") call.extra = { ...(call.extra || {}), ...tc.extra_content };
            calls.set(index, call);
            lastIndex = index;
            firstTokenMs ??= Date.now() - sentAt;
            try { onEvent({ type: "response.function_call_arguments.delta" }); } catch {}
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
      });
    } catch (error) {
      if (signal?.aborted && signal.reason) throw signal.reason;
      if (/terminó a mitad/i.test(String(error?.message))) throw Object.assign(Error(this.names.name + " cortó la respuesta a medias."), { transient: true });
      throw error;
    }
    // A home server may close a clean stream without a finish reason.
    if (!finish && policy.lenient && (text || calls.size)) finish = calls.size ? "tool_calls" : "stop";
    if (!finish) throw Object.assign(Error("Falta la confirmación final de " + this.names.name + "."), { transient: true });
    if (finish === "error") throw Object.assign(Error(this.names.name + " interrumpió la respuesta."), { transient: true });
    const list = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ ...c, id: c.id || "call_" + (responseId || sentAt) + "_" + i }));
    if (finish === "length" && list.length) throw Object.assign(Error(this.names.name + " cortó la respuesta antes de terminar una herramienta."), { transient: true });
    for (const c of list) {
      if (!c.name) throw Error("Llamada de herramienta sin nombre.");
      try { JSON.parse(c.arguments || "{}"); } catch { throw Object.assign(Error(this.names.name + " devolvió argumentos no válidos."), { transient: true }); }
    }
    if (new Set(list.map((c) => c.id)).size !== list.length) throw Error("Llamadas de herramientas invalidas.");
    const derived = [];
    if (text.trim()) derived.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
    for (const c of list) derived.push({ type: "function_call", call_id: c.id, name: c.name, arguments: c.arguments || "{}", status: "completed" });
    const native = { type: NATIVE, provider: "completions", engine: this.engine, model: id, count: derived.length, reasoning: thinking };
    const extras = Object.fromEntries(list.filter((c) => c.extra).map((c) => [c.id, c.extra]));
    if (Object.keys(extras).length) native.extras = extras;
    if (details.length) native.details = details;
    const output = [native, ...derived];
    const u = usage ? {
      input_tokens: Number(usage.prompt_tokens) || 0, output_tokens: Number(usage.completion_tokens) || 0,
      total_tokens: Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0),
      input_tokens_details: { cached_tokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens) || 0 },
      output_tokens_details: { reasoning_tokens: Number(usage.completion_tokens_details?.reasoning_tokens) || 0 },
    } : null;
    return { output, text, usage: u, responseId, transport: "sse", model: entry?.ref || model, webSearch: webSearch ? "unavailable" : null, timing: { firstEventMs, firstTokenMs } };
  }
}

export { DERIVED };
