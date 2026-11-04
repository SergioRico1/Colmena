// How an old request reads once it is closed (after assistant-ui's approval `resolution`:
// answered, dismissed, cancelled, expired): its final state in plain words, never buttons
// that no longer do anything.

const CANCELLED = /cancelad|interrumpid|descartad|se pidi[oó] de nuevo/i;

/**
 * { state, label } for a request that no longer waits, or null while it is pending.
 * state: "answered" | "approved" | "denied" | "dismissed" | "cancelled" | "expired".
 */
export function closedState(approval, options = approval?.options || []) {
  const a = approval;
  if (!a || a.status === "pending") return null;
  const by = a.decidedBy === "regla" ? "Respondió una regla" : "Respondiste";
  if (a.status === "answered") {
    const chosen = options.find((o) => o.id === a.answer?.optionId || o.label === a.resolution);
    const said = a.answer?.text || chosen?.label || (typeof a.resolution === "string" ? a.resolution : "");
    return { state: "answered", label: said ? `${by}: ${said}` : by };
  }
  if (a.status === "dismissed") return { state: "dismissed", label: "La dejaste sin responder" };
  if (a.status === "expired") return { state: "expired", label: "Caducó sin respuesta" };
  if (CANCELLED.test(String(a.resolution || ""))) return { state: "cancelled", label: "Se canceló: " + String(a.resolution).replace(/\.$/, "").toLowerCase() };
  if (a.status === "denied") return { state: "denied", label: a.decidedBy === "regla" ? "Lo denegó una regla" : "Lo denegaste" };
  if (["approved", "executed", "executing"].includes(a.status)) return { state: "approved", label: a.decidedBy === "regla" ? "Lo aprobó una regla" : "Lo aprobaste" };
  return { state: "cancelled", label: "Ya no espera respuesta" };
}
