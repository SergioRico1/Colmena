import { GOAL_MARK, clip } from "./shared.mjs";

// What a new engine is told of a task after a switch (CodeService.handoffFor).

/** The history a new engine gets after a switch (T3 Code ContextHandoffService): 16 000 bytes. */
export const HANDOFF_BYTES = 16000;

/**
 * A budgeted selection of the task's real messages, not a summary (T3 Code portable handoffs):
 * the original request always, then the most recent entries that fit, whole, in their order,
 * with how many were left out. Your new message stays apart and is never shortened.
 */
export function handoffContext(items, { from = "otro motor", bot = "Bruno", budget = HANDOFF_BYTES } = {}) {
  const entries = [];
  const sign = (n) => (n ? n : 0);
  for (const i of items) {
    if (i.kind === "user") {
      const extra = [...(i.contexts || []).map((c) => c.label), ...(i.attachments || []).map((a) => "adjunto " + a.name)];
      entries.push({ who: "Persona", text: (i.text || "") + (extra.length ? "\n(con: " + extra.join(", ") + ")" : "") });
    } else if (i.kind === "text") entries.push({ who: bot, text: String(i.text || "").replace(GOAL_MARK, "").trim() });
    else if (i.kind === "plan") entries.push({ who: bot + " · plan propuesto" + (i.status === "open" ? " (aún sin implementar)" : ""), text: i.text });
    else if (i.kind === "turn") entries.push({ who: "Colmena", text: "Cambios de ese turno: " + (i.files || []).slice(0, 30).map((f) => `${f.path} (+${sign(f.add)} −${sign(f.del)})`).join(", ") + ((i.files || []).length > 30 ? "…" : "") });
    else if (i.kind === "tool" && i.verb === "run" && i.detail) entries.push({ who: "Colmena", text: "Orden: " + clip(String(i.detail).split(/\r?\n/)[0], 200) + (i.status === "error" ? " → falló" + (i.output ? ": " + clip(String(i.output).trim().split(/\r?\n/).slice(-2).join(" "), 200) : "") : i.status === "denied" ? " → no permitida" : "") });
    else if (i.kind === "notice" && (i.goal || i.tone === "done" || i.tone === "warn") && !i.engineSwitch) entries.push({ who: "Colmena", text: i.text });
    else if (i.kind === "review") entries.push({ who: "Revisión", text: (i.summary || "") + (i.findings || []).map((f) => `\n- [${f.severity}] ${f.title}${f.file ? " (" + f.file + (f.line ? ":" + f.line : "") + ")" : ""}`).join("") });
    else if (i.kind === "error") entries.push({ who: "Colmena", text: "Error: " + i.text });
  }
  const filled = entries.filter((e) => String(e.text || "").trim());
  const line = (e) => `[${e.who}]\n${e.text}`;
  const bytes = (s) => Buffer.byteLength(s, "utf8") + 2;
  let left = budget;
  const first = filled.findIndex((e) => e.who === "Persona");
  const keep = new Set();
  if (first >= 0) {
    // The original request always goes; if it alone is too long, its start and its end.
    const text = line(filled[first]);
    if (bytes(text) > budget / 2) filled[first] = { ...filled[first], text: clip(filled[first].text, Math.floor(budget / 4)) + " [recortado]" };
    keep.add(first);
    left -= bytes(line(filled[first]));
  }
  for (let k = filled.length - 1; k >= 0; k--) {
    if (keep.has(k)) continue;
    const size = bytes(line(filled[k]));
    if (size > left) break;
    keep.add(k);
    left -= size;
  }
  const omitted = filled.length - keep.size;
  const body = filled.map((e, k) => (keep.has(k) ? line(e) : null)).filter(Boolean);
  if (omitted && first >= 0) body.splice(1, 0, `[… ${omitted === 1 ? "1 entrada intermedia omitida" : omitted + " entradas intermedias omitidas"} …]`);
  return [
    `Contexto de esta tarea hasta ahora. La llevaba ${from}; ahora sigues tú en la misma carpeta, que ya tiene todos sus cambios. Son los mensajes reales, en orden${omitted ? ", con algunos intermedios omitidos" : ""}; si necesitas detalles, mira los archivos.`,
    ...body,
  ].join("\n\n");
}
