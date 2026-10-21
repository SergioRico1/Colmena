// OpenAI Chat Completions provider (OpenClaw packages/ai/src/transports/openai-completions-*),
// the route most OpenCode Go models speak. Colmena's Responses-style history is translated
// on the way out; the answer comes back as Responses items, preceded by a `native_turn` that
// keeps the model's reasoning_content so it can be replayed to the same model (DeepSeek and
// Kimi K3 expect it back in tool rounds).
import { consumeSSE } from "../nexo/protocol.mjs";
import { imageUnsupported } from "../images.mjs";
import { modelEntry, opencodeSession } from "./catalog.mjs";
import { NATIVE } from "./anthropic-items.mjs";
import { limitHeaders } from "../limits.mjs";

const DERIVED = new Set(["message", "function_call", "web_search_call", "reasoning"]);
const NO_VISION = "[Imagen omitida: este modelo no puede ver imágenes.]";

const textOf = (content) =>
  typeof content === "string" ? content
    : (Array.isArray(content) ? content : []).map((c) => (["input_text", "output_text", "text"].includes(c?.type) ? c.text : c?.type === "refusal" ? c.refusal : "")).filter(Boolean).join("\n");
const imagesOf = (content) =>
  (Array.isArray(content) ? content : []).filter((c) => c?.type === "input_image").map((c) => c.image_url?.url || c.image_url).filter((u) => typeof u === "string" && u);

/** Responses items → chat messages. Reasoning is replayed only to the model that wrote it. */
export function toChatMessages(input, { instructions = "", model = "", vision = true, replayReasoning = true } = {}) {
  const items = typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? input : [];
  const out = instructions ? [{ role: "system", content: String(instructions) }] : [];
  let reasoning = null; // reasoning_content of the native turn whose derived items follow
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
    if (reasoning !== null) { m.reasoning_content = reasoning; reasoning = null; }
    out.push(m);
    return m;
  };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === NATIVE) {
      reasoning = replayReasoning && item.provider === "completions" && item.model === model && typeof item.reasoning === "string" ? item.reasoning : null;
      if (item.provider !== "completions") reasoning = null;
      continue;
    }
    if (item.type === "function_call") {
      const m = assistant();
      (m.tool_calls ||= []).push({ id: String(item.call_id), type: "function", function: { name: item.name, arguments: item.arguments || "{}" } });
      continue;
    }
    if (item.type === "function_call_output") {
      const last = out.at(-1);
      if (last?.role === "assistant") last.closed = true;
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
    const last = out.at(-1);
    if (last?.role === "assistant") last.closed = true;
    const imgs = imagesOf(item.content);
    const text = textOf(item.content);
    const content = vision && imgs.length ? [{ type: "text", text: text || "." }, ...imgs.map((url) => ({ type: "image_url", image_url: { url } }))] : [text, imgs.length ? NO_VISION : ""].filter(Boolean).join("\n");
    out.push({ role: "user", content });
  }
  flushImages();
  return repairChat(out);
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

export class CompletionsProvider {
  constructor({ loadKey, fetchImpl = fetch, baseUrl, names, engine = "opencode-go" } = {}) {
    this.loadKey = loadKey;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
    this.engine = engine;
    this.names = names || { name: "OpenCode Go", limit: "Has alcanzado el límite de tu plan de OpenCode Go.", auth: "Reconecta OpenCode Go en Ajustes." };
  }
  supportsReasoning() { return true; }
  supportsCacheKey() { return false; }
  supportsNativeSearch() { return false; }
  nativeSearchAvailable() { return false; }
  async warm() { return false; }
  async generateImage() { throw imageUnsupported("Este modelo no crea imágenes. Conecta tu cuenta de ChatGPT para que tus bots puedan hacerlas."); }

  /** OpenClaw opencode-go stream wrappers: DeepSeek effort, Kimi K2 without reasoning. */
  reasoningParams(entry, effort) {
    const id = entry?.id || "";
    if (/^kimi-k2/.test(id)) return { replay: false, params: {} };
    if (/^deepseek-v4/.test(id)) {
      const level = effort === "low" || effort === "minimal" ? (/flash/.test(id) ? "low" : "high") : effort === "max" ? "max" : "high";
      return { replay: true, backfill: true, params: { thinking: { type: "enabled" }, reasoning_effort: level } };
    }
    return { replay: true, params: {} };
  }

  async respond({ model, instructions, input, tools = [], signal, onDelta = () => {}, onEvent = () => {}, reasoning = null, webSearch = false, cacheKey = null }) {
    const entry = modelEntry(model);
    const id = entry?.id || String(model || "").replace(/^[\w-]+\//, "");
    const key = await this.loadKey();
    if (!key) throw Object.assign(Error("Conecta " + this.names.name + " en Ajustes."), { status: 401 });
    const effort = typeof reasoning === "string" ? reasoning : reasoning?.effort || null;
    const policy = this.reasoningParams({ ...(entry || {}), id }, effort);
    const messages = toChatMessages(input, { instructions, model: id, vision: !entry || entry.input.includes("image"), replayReasoning: policy.replay });
    if (policy.backfill) for (const m of messages) if (m.role === "assistant" && !("reasoning_content" in m)) m.reasoning_content = "";
    const defs = toolsOf(tools);
    const body = { model: id, messages, stream: true, stream_options: { include_usage: true }, max_tokens: Math.min(entry?.maxTokens || 32768, 64000), ...(defs.length ? { tools: defs } : {}), ...policy.params };
    const sentAt = Date.now();
    let firstEventMs = null, firstTokenMs = null;
    const session = opencodeSession(cacheKey);
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetch(this.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
          method: "POST", redirect: "error", signal,
          headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer " + key, ...(this.engine === "opencode-go" ? session : {}) },
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (signal?.aborted && signal.reason) throw signal.reason;
        throw error;
      }
      // A model that does not take the thinking switches answers once more without them.
      if (response.status === 400 && attempt === 0 && (body.thinking || body.reasoning_effort)) {
        try { await response.body?.cancel(); } catch {}
        delete body.thinking;
        delete body.reasoning_effort;
        continue;
      }
      break;
    }
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.text()).slice(0, 4000); } catch {}
      const status = response.status;
      // What the provider says (its error message, never our key) helps to see what to change.
      let said = "";
      try { const j = JSON.parse(detail); said = String(j?.error?.message || j?.message || j?.error || "").slice(0, 200); } catch { said = detail.slice(0, 200); }
      console.warn(`${this.names.name} ${status} con ${id}: ${detail.slice(0, 1500).replace(/\s+/g, " ")}`);
      const message = status === 429 ? this.names.limit : status === 401 || status === 403 ? this.names.auth : `${this.names.name} rechazó la petición (${status})${said ? ": " + said : "."}`;
      throw Object.assign(Error(message), { status, detail, headers: limitHeaders(response.headers) });
    }
    let text = "", thinking = "", usage = null, finish = null, responseId = null, total = 0;
    const calls = new Map();
    try {
      await consumeSSE(response.body, (chunk) => {
        if (firstEventMs === null) { firstEventMs = Date.now() - sentAt; try { onEvent({ type: "response.created" }); } catch {} }
        if (chunk.error) throw Object.assign(Error(this.names.name + " interrumpió la respuesta."), { transient: true, providerCode: String(chunk.error.code || chunk.error.type || "") });
        responseId ||= chunk.id || null;
        if (chunk.usage) usage = chunk.usage;
        for (const choice of chunk.choices || []) {
          const d = choice.delta || {};
          const r = d.reasoning_content ?? d.reasoning ?? null;
          if (typeof r === "string" && r) { thinking += r; firstTokenMs ??= Date.now() - sentAt; try { onEvent({ type: "response.reasoning_summary_text.delta" }); } catch {} }
          if (typeof d.content === "string" && d.content) {
            firstTokenMs ??= Date.now() - sentAt;
            text += d.content;
            total += d.content.length;
            if (total > 200000) throw Error("Respuesta demasiado extensa.");
            onDelta(d.content);
          }
          for (const tc of d.tool_calls || []) {
            const index = Number.isInteger(tc.index) ? tc.index : calls.size;
            const call = calls.get(index) || { id: "", name: "", arguments: "" };
            if (tc.id) call.id = tc.id;
            if (tc.function?.name) call.name += tc.function.name;
            if (tc.function?.arguments) call.arguments += tc.function.arguments;
            calls.set(index, call);
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
    if (!finish) throw Object.assign(Error("Falta la confirmación final de " + this.names.name + "."), { transient: true });
    const list = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ ...c, id: c.id || "call_" + (responseId || sentAt) + "_" + i }));
    if (finish === "length" && list.length) throw Object.assign(Error(this.names.name + " cortó la respuesta antes de terminar una herramienta."), { transient: true });
    for (const c of list) {
      if (!c.name) throw Error("Llamada de herramienta sin nombre.");
      try { JSON.parse(c.arguments || "{}"); } catch { throw Object.assign(Error(this.names.name + " devolvió argumentos no válidos."), { transient: true }); }
    }
    const derived = [];
    if (text.trim()) derived.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
    for (const c of list) derived.push({ type: "function_call", call_id: c.id, name: c.name, arguments: c.arguments || "{}", status: "completed" });
    const output = [{ type: NATIVE, provider: "completions", model: id, count: derived.length, reasoning: thinking }, ...derived];
    const u = usage ? {
      input_tokens: Number(usage.prompt_tokens) || 0, output_tokens: Number(usage.completion_tokens) || 0,
      total_tokens: Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0),
      input_tokens_details: { cached_tokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens) || 0 },
      output_tokens_details: { reasoning_tokens: Number(usage.completion_tokens_details?.reasoning_tokens) || 0 },
    } : null;
    return { output, text, usage: u, responseId, transport: "sse", model: entry?.ref || model, webSearch: webSearch ? "unavailable" : null, timing: { firstEventMs, firstTokenMs } };
  }
}

export { DERIVED };
