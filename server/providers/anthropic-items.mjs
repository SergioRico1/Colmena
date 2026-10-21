// Responses-style history ⇄ Anthropic Messages (OpenClaw packages/ai/src/transports/
// anthropic-messages.ts and anthropic-stream-reducer.ts, adapted to Colmena's items).
//
// Colmena keeps every step's history as Responses input items. A Claude round is stored as
// one `native_turn` item (the assistant content blocks exactly as Anthropic returned them:
// thinking with its signature, text with citations, tool_use, server web search) followed by
// the derived Responses items the runtime reads (message, function_call, web_search_call).
// Sent back to the same model the native blocks travel untouched, so signed thinking stays
// valid; any other provider ignores `native_turn` and reads the derived items.

export const NATIVE = "native_turn";
const DERIVED = new Set(["message", "function_call", "web_search_call", "reasoning"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Tool call ids Anthropic accepts: [a-zA-Z0-9_-], at most 64 (OpenClaw tool projection). */
export const toolId = (id) => String(id || "call").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "call";

/** Responses function tools → Anthropic tool definitions (no strict: Colmena validates with zod). */
export function toolsOf(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .filter((t) => t && (t.type === "function" || !t.type) && t.name)
    .map((t) => ({
      name: t.name,
      description: String(t.description || "").slice(0, 10000),
      input_schema: t.parameters && typeof t.parameters === "object" ? { type: "object", ...t.parameters } : { type: "object", properties: {} },
    }));
}

/** A data: URL image → Anthropic image block; http(s) → url source; anything else → null. */
export function imageBlock(url) {
  const text = String(url || "");
  const data = /^data:([^;,]+);base64,(.+)$/s.exec(text);
  if (data) {
    const media = data[1].toLowerCase() === "image/jpg" ? "image/jpeg" : data[1].toLowerCase();
    return IMAGE_TYPES.has(media) ? { type: "image", source: { type: "base64", media_type: media, data: data[2].replace(/\s+/g, "") } } : null;
  }
  return /^https?:\/\//i.test(text) ? { type: "image", source: { type: "url", url: text } } : null;
}

const NO_VISION = "[Imagen omitida: este modelo no puede ver imágenes. Pide a la persona que la describa si hace falta.]";

/** User/tool content parts (string or input_text/input_image/output_text) → Anthropic blocks. */
function partsOf(content, vision) {
  if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : [];
  const out = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (!part || typeof part !== "object") continue;
    if (["input_text", "output_text", "text"].includes(part.type) && String(part.text || "").trim()) out.push({ type: "text", text: String(part.text) });
    else if (part.type === "input_image" || part.type === "image_url") {
      const block = vision ? imageBlock(part.image_url?.url || part.image_url) : null;
      out.push(block || { type: "text", text: vision ? "[Imagen no compatible omitida]" : NO_VISION });
    }
  }
  return out;
}

const textOfMessage = (item) =>
  (Array.isArray(item.content) ? item.content : [])
    .map((c) => (c?.type === "output_text" ? c.text : c?.type === "refusal" ? c.refusal : typeof c === "string" ? c : ""))
    .filter(Boolean).join("\n");

/** Native blocks safe to send back: same model keeps thinking, another model drops it. */
export function replayBlocks(content, sameModel) {
  const out = [];
  for (const b of Array.isArray(content) ? content : []) {
    if (!b?.type) continue;
    if (b.type === "thinking" || b.type === "redacted_thinking") { if (sameModel) out.push(b); continue; }
    if (b.type === "text" && !String(b.text || "").trim()) continue;
    out.push(b);
  }
  return out;
}

/**
 * Responses items → {messages}. `model` is the request's model id (native turns of that model
 * keep their thinking; `engine` must match for a native turn to be replayed at all); `vision` false replaces images with a note; `stripThinking` drops all
 * thinking blocks (after the API refused a stale signature).
 */
export function toMessages(input, { model = "", vision = true, stripThinking = false, nameFor = (n) => n, engine = "anthropic" } = {}) {
  const items = typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? input : [];
  const messages = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === NATIVE) {
      // Only the engine that wrote a native turn gets it back: Claude's blocks never travel to
      // OpenCode Go's Anthropic route (or the reverse); the other one reads the derived items.
      if (item.provider === "anthropic" && (item.engine || "anthropic") === engine && Array.isArray(item.content)) {
        push("assistant", replayBlocks(item.content, !stripThinking && item.model === model));
        // Skip the derived copies of this turn that follow it.
        let skip = Number.isInteger(item.count) ? item.count : 0;
        while (skip > 0 && DERIVED.has(items[i + 1]?.type)) { i++; skip--; }
      }
      continue;
    }
    if (item.type === "function_call") {
      let args = {};
      try { args = JSON.parse(item.arguments || "{}"); } catch {}
      push("assistant", [{ type: "tool_use", id: toolId(item.call_id), name: nameFor(item.name), input: args && typeof args === "object" && !Array.isArray(args) ? args : {} }]);
      continue;
    }
    if (item.type === "function_call_output") {
      const parts = typeof item.output === "string" ? (item.output ? [{ type: "text", text: item.output }] : []) : partsOf(item.output, vision);
      push("user", [{ type: "tool_result", tool_use_id: toolId(item.call_id), content: parts.length ? parts : [{ type: "text", text: "(sin resultado)" }] }]);
      continue;
    }
    if (item.type === "message" && item.role === "assistant") {
      const text = textOfMessage(item);
      if (text.trim()) push("assistant", [{ type: "text", text }]);
      continue;
    }
    if (item.type && item.type !== "message") continue; // reasoning, web_search_call, image_generation_call…
    const role = item.role === "assistant" ? "assistant" : item.role === "user" || item.role === "developer" || item.role === "system" ? "user" : null;
    if (!role) continue;
    const blocks = role === "assistant" && typeof item.content !== "string" ? [{ type: "text", text: textOfMessage(item) }].filter((b) => b.text.trim()) : partsOf(item.content, vision);
    push(role, blocks);
  }
  return { messages: repair(messages) };
}

/**
 * Makes the transcript valid for the Messages API: starts with the person, every tool_use is
 * answered in the next user message (tool_result blocks first), no orphan results.
 */
function repair(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") {
      const prev = out.at(-1);
      const asked = new Set(prev?.role === "assistant" ? prev.content.filter((b) => b.type === "tool_use").map((b) => b.id) : []);
      const results = m.content.filter((b) => b.type === "tool_result" && asked.has(b.tool_use_id));
      const seen = new Set();
      const unique = results.filter((b) => !seen.has(b.tool_use_id) && seen.add(b.tool_use_id));
      const rest = m.content.filter((b) => b.type !== "tool_result");
      const missing = [...asked].filter((id) => !seen.has(id)).map((id) => ({ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: "(sin resultado)" }], is_error: true }));
      const content = [...unique, ...missing, ...rest];
      if (content.length) out.push({ role: "user", content });
      continue;
    }
    const prev = out.at(-1);
    if (prev?.role === "assistant") {
      // An assistant turn after an assistant turn: answer its tools first (cut rounds).
      const open = prev.content.filter((b) => b.type === "tool_use").map((b) => ({ type: "tool_result", tool_use_id: b.id, content: [{ type: "text", text: "(sin resultado)" }], is_error: true }));
      if (open.length) out.push({ role: "user", content: open });
      else { prev.content.push(...m.content); continue; }
    }
    out.push({ role: "assistant", content: [...m.content] });
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "." }] });
  // Every tool_use of the last assistant turn needs an answer too (a resumed step).
  const last = out.at(-1);
  if (last.role === "assistant") {
    const open = last.content.filter((b) => b.type === "tool_use").map((b) => ({ type: "tool_result", tool_use_id: b.id, content: [{ type: "text", text: "(sin resultado)" }], is_error: true }));
    if (open.length) out.push({ role: "user", content: open });
  }
  return out;
}

/** Content blocks as they may be sent back (no SDK-only or null fields). */
export function cleanBlocks(content = []) {
  return content.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text, ...(Array.isArray(b.citations) && b.citations.length ? { citations: b.citations } : {}) };
    if (b.type === "thinking") return { type: "thinking", thinking: b.thinking || "", signature: b.signature || "" };
    if (b.type === "redacted_thinking") return { type: "redacted_thinking", data: b.data };
    if (b.type === "tool_use" || b.type === "server_tool_use") return { type: b.type, id: b.id, name: b.name, input: b.input ?? {} };
    return Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== null && v !== undefined && k !== "parsed_output"));
  });
}

/**
 * A finished Anthropic message → Colmena output items: the native turn, then the message
 * (text with url_citation annotations), the searches and the tool calls, in order.
 * `nameOf` maps a wire tool name back (Claude Code casing for subscription tokens).
 */
export function fromMessage(message, { model = "", nameOf = (n) => n, engine = "anthropic" } = {}) {
  const content = cleanBlocks(Array.isArray(message?.content) ? message.content : []);
  const derived = [];
  const texts = [], annotations = [];
  const searches = new Map();
  for (const b of content) {
    if (b.type === "text") {
      texts.push(b.text);
      for (const c of b.citations || []) if (c?.url) annotations.push({ type: "url_citation", url: c.url, title: c.title || null });
    } else if (b.type === "server_tool_use" && b.name === "web_search") {
      searches.set(b.id, { type: "web_search_call", id: b.id, status: "completed", action: { type: "search", query: String(b.input?.query || ""), sources: [] } });
    } else if (b.type === "web_search_tool_result") {
      const call = searches.get(b.tool_use_id);
      if (call) {
        if (Array.isArray(b.content)) call.action.sources = b.content.filter((r) => r?.url).slice(0, 20).map((r) => ({ type: "url", url: r.url }));
        else call.status = "failed";
      }
    }
  }
  const text = texts.join("");
  if (text.trim()) derived.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations }] });
  derived.push(...searches.values());
  for (const b of content) if (b.type === "tool_use") derived.push({ type: "function_call", call_id: b.id, name: nameOf(b.name), arguments: JSON.stringify(b.input ?? {}), status: "completed" });
  return [{ type: NATIVE, provider: "anthropic", engine, model, count: derived.length, content }, ...derived];
}

/** Anthropic usage → the Responses usage shape usage.mjs reads. */
export function usageOf(u) {
  if (!u) return null;
  const read = Number(u.cache_read_input_tokens) || 0, write = Number(u.cache_creation_input_tokens) || 0;
  const input = (Number(u.input_tokens) || 0) + read + write, output = Number(u.output_tokens) || 0;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: { cached_tokens: read } };
}
