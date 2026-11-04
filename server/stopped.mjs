// Why a turn stopped before its answer (after assistant-ui MessageStatus.incomplete.reason):
// you stopped it, the answer ran too long, a content filter cut it, an error, or something
// else (Colmena closed). The chat shows it as one card with «Continuar» and «Descartar».

export const STOP_REASONS = ["cancelled", "length", "content-filter", "error", "other"];

/** { reason, detail } for an error that ended a turn (null when it is not a stop to show). */
export function stopReason(error, { aborted = false } = {}) {
  const code = String(error?.incomplete || error?.providerCode || error?.code || "").toLowerCase();
  const text = String(error?.message || "");
  if (aborted) return { reason: "cancelled", detail: null };
  if (/max_output_tokens|max_tokens|length|context_length|too_long|demasiado extens|context window/.test(code + " " + text.toLowerCase()))
    return { reason: "length", detail: text || null };
  if (/content_filter|content-filter|policy|safety|moderation|refusal/.test(code))
    return { reason: "content-filter", detail: text || null };
  return { reason: "error", detail: text || null };
}

/** The record kept in the mission («stopped»). */
export const stoppedRecord = ({ reason, detail = null }, stepId = null) => ({ reason: STOP_REASONS.includes(reason) ? reason : "other", detail: detail ? String(detail).slice(0, 600) : null, stepId, at: new Date().toISOString() });
