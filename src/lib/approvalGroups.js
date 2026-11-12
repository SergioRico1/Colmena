// Several requests of the same kind in a row (five files, three calendar events) fold into
// one card with «Aprobar todas», in the chat and in «Te necesitan». Pure: no React, no network.
//
// The server says which approvals may go together (`a.group = {key, label}`,
// server/approval-groups.mjs: same mission, bot and tool; never a red line). This file only
// folds neighbours with the same key, and checks again what must never share one click.

const ALONE = new Set(["send", "question", "plan", "secret", "skill", "soul", "revert"]);

/** Whether this approval may share a card with others: pending, with a group, and no red line. */
export function groupable(a) {
  return !!a && a.status === "pending" && !!a.group?.key && !a.redLine && !a.deferred && !a.autoSendAt && !ALONE.has(a.kind);
}

/**
 * Folds the list, in the order given, into entries: `{type: "one", a}` or
 * `{type: "group", key, id, label, botId, missionId, items}`. A group is a run of two or more
 * neighbours with the same group key; anything else in between breaks the run.
 */
export function groupApprovals(list = []) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      // Inside the card, the oldest request first, whatever order the list came in.
      const items = [...run].sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || 0);
      const first = items[0];
      out.push({ type: "group", key: first.group.key, id: "grupo:" + first.id, label: first.group.label || "", botId: first.botId ?? null, missionId: first.missionId ?? null, items });
    } else for (const a of run) out.push({ type: "one", a });
    run = [];
  };
  for (const a of list) {
    if (!groupable(a)) { flush(); out.push({ type: "one", a }); continue; }
    if (run.length && run[0].group.key !== a.group.key) flush();
    run.push(a);
  }
  flush();
  return out;
}

/** «3 peticiones de Nora: crear archivos». */
export function groupTitle(group, botName) {
  const n = group.items.length;
  return `${n} ${n === 1 ? "petición" : "peticiones"} de ${botName || "un bot"}` + (group.label ? `: ${group.label}` : "");
}

/**
 * One line for a request inside a group: its summary without «Nora quiere » and without what
 * the card's title already says («crear un evento en Google Calendar: »), else its title.
 */
export function groupLine(a, botName, label = "") {
  const text = String(a.summary || a.title || "").replace(/\s+/g, " ").trim();
  const lead = botName ? botName + " quiere " : "";
  let rest = lead && text.startsWith(lead) ? text.slice(lead.length) : text;
  if (label && rest.toLowerCase().startsWith(label.toLowerCase() + ": ")) rest = rest.slice(label.length + 2);
  const line = (rest || String(a.title || "")).replace(/\.$/, "");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The requests a folded card lists, and how many it leaves for «y 3 más» (never «y 1 más»). */
export function groupShown(items = [], max = 5) {
  const shown = items.length <= max + 1 ? items : items.slice(0, max);
  return { shown, more: items.length - shown.length };
}

/** What a batch answer means: {done: [id], failed: Map(id → reason)} from its per-item results. */
export function batchOutcome(results = []) {
  const done = [], failed = new Map();
  for (const r of results) {
    if (r?.ok) done.push(r.id);
    else if (r?.id) failed.set(r.id, r.error || "No se pudo completar.");
  }
  return { done, failed };
}

/** «No se pudo aprobar 1. Sigue pendiente.» — what the card says after a partial failure. */
export function failureText(count, decision = "approved") {
  if (!count) return "";
  const verb = decision === "denied" ? "descartar" : "aprobar";
  return count === 1 ? `No se pudo ${verb} 1. Sigue pendiente.` : `No se pudieron ${verb} ${count}. Siguen pendientes.`;
}
