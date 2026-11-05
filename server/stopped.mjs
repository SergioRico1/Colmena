// Why a turn stopped before its answer (after assistant-ui MessageStatus.incomplete.reason):
// you stopped it, the answer ran too long, a content filter cut it, an error, or something
// else (Colmena closed). The chat shows it as one card with «Continuar» and «Descartar».

export const STOP_REASONS = ["cancelled", "length", "content-filter", "error", "other"];

// A request bigger than the model's context window, in the words OpenAI, Anthropic and the
// OpenAI-compatible providers use (DeepSeek Harness isContextWindowExceededError — MIT).
const OVERFLOW = [
  /context_length_exceeded|context_window_exceeded/i,
  /(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-](?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])/i,
  /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i,
  /\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?(?:model(?:'s)?\s+)?context(?:\s+window)?\b/i,
  /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i,
  /\b(?:input|prompt|request|messages?)\b.{0,40}\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b/i,
  /\bprompt is too long\b/i,
];

/** A provider-confirmed context-window overflow (never an answer that ran too long). */
export function isContextOverflow(error) {
  if (!error || typeof error !== "object") return false;
  const detail = [error.providerCode, error.code, error.detail, error.message, error.cause?.message, error.cause?.detail]
    .filter((x) => typeof x === "string" && x).join(" \n ");
  return OVERFLOW.some((re) => re.test(detail));
}

/** { reason, detail } for an error that ended a turn (null when it is not a stop to show). */
export function stopReason(error, { aborted = false } = {}) {
  const code = String(error?.incomplete || error?.providerCode || error?.code || "").toLowerCase();
  const text = String(error?.message || "");
  if (aborted) return { reason: "cancelled", detail: null };
  if (isContextOverflow(error) || /max_output_tokens|max_tokens|length|context_length|too_long|demasiado extens|context window/.test(code + " " + text.toLowerCase()))
    return { reason: "length", detail: text || null };
  if (/content_filter|content-filter|policy|safety|moderation|refusal/.test(code))
    return { reason: "content-filter", detail: text || null };
  return { reason: "error", detail: text || null };
}

/** The record kept in the mission («stopped»). */
export const stoppedRecord = ({ reason, detail = null }, stepId = null) => ({ reason: STOP_REASONS.includes(reason) ? reason : "other", detail: detail ? String(detail).slice(0, 600) : null, stepId, at: new Date().toISOString() });
