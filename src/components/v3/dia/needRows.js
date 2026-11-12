// «Te necesitan» on Inicio as compact rows: who, what and the one action that moves it on.
// Three show; «Ver las N» unfolds the rest; a row opens its full card in place. Pure: no
// React, no network. The rows are the one list of what waits for you (server/waiting.mjs,
// needsOf): requests of the same kind from one bot share a row, as they share a card.
import { approvalCard } from "../../../lib/approvalCard.js";
import { groupApprovals, groupTitle } from "../../../lib/approvalGroups.js";

/** Rows on screen before «Ver las N». */
export const ROWS_SHOWN = 3;
const stamp = (iso) => Date.parse(iso || 0) || 0;

/**
 * The rows, the oldest first: [{type, key, at, count, botId, missionId, a | group | note | mission | item}].
 * `needs` is needsOf(store). An item whose record the state does not carry (more notes than it
 * lists) still gets its row, so the rows always add up to the count.
 */
export function needEntries(needs = {}) {
  const { asks = [], choices = [], notes = [], errands = [], items = [] } = needs;
  const out = [
    ...groupApprovals([...asks].sort((a, b) => stamp(a.createdAt) - stamp(b.createdAt))).map((e) => (e.type === "group"
      ? { type: "group", key: e.id, at: e.items[0].createdAt, count: e.items.length, botId: e.botId, missionId: e.missionId, group: e }
      : { type: "approval", key: e.a.id, at: e.a.createdAt, count: 1, botId: e.a.botId, missionId: e.a.missionId, a: e.a })),
    ...notes.map((n) => ({ type: "note", key: n.id, at: n.createdAt, count: 1, botId: n.botId, missionId: n.missionId, note: n })),
    ...choices.map((m) => ({ type: "choice", key: m.id, at: m.updatedAt || m.createdAt, count: 1, botId: m.botIds?.[0] || "atlas", missionId: m.id, mission: m })),
    ...errands.map((x) => ({ type: "errand", key: x.id, at: x.at, count: 1, botId: x.botId, missionId: null, item: x })),
  ];
  const known = new Set(out.flatMap((e) => (e.type === "group" ? e.group.items.map((a) => a.id) : [e.key])));
  for (const item of items) if (!known.has(item.id)) out.push({ type: "item", key: item.id, at: item.at, count: 1, botId: item.botId, missionId: item.missionId, item });
  return out.sort((a, b) => stamp(a.at) - stamp(b.at));
}

/**
 * One row in words: { who, what, sub, action: {kind, label, href?} }.
 * action.kind: "approve" (done from the row: an ordinary request, with its 10 s to undo) ·
 * "expand" (the full card opens in place: what is held to approve, a question, several
 * requests) · "link" (it is decided where it is read: a plan, a choice, another person's ask).
 */
export function needRow(entry, { botName = "" } = {}) {
  const who = botName || "Un bot";
  switch (entry.type) {
    case "approval": {
      const model = approvalCard(entry.a, { botName });
      const send = model.send;
      const sub = send ? "Para " + (send.to.join(", ") || "nadie todavía") + (send.moreTo ? ` y ${send.moreTo} más` : "") : model.impact || model.text || "";
      const action = model.kind === "question" ? { kind: "expand", label: "Responder" }
        : model.primary.action === "open" ? { kind: "link", label: model.primary.label, href: model.primary.href }
          : model.primary.hold ? { kind: "expand", label: model.verb ? `Ver y ${model.verb}` : "Ver y decidir" }
            : { kind: "approve", label: model.primary.label };
      return { who, what: model.title, sub, action };
    }
    case "group":
      return { who, what: groupTitle(entry.group, botName), sub: "", action: { kind: "expand", label: "Ver y aprobar" } };
    case "note":
      return { who, what: entry.note.question || entry.note.title || "Tiene una pregunta para ti", sub: entry.note.text || "", action: { kind: "expand", label: "Responder" } };
    case "choice": {
      const m = entry.mission;
      const plan = m.status === "awaiting_plan";
      return {
        who, what: plan ? `El plan de «${m.title}» espera tu OK` : `Las propuestas de «${m.title}» están listas`, sub: "",
        action: { kind: "link", label: plan ? "Revisar el plan" : "Ver y elegir", href: plan ? `/encargo/${m.id}` : `/debate/${m.id}` },
      };
    }
    case "errand":
      return { who, what: entry.item.title || "Otra persona pide algo a tu bot", sub: "", action: { kind: "link", label: "Ver y decidir", href: entry.item.roomId ? `/con/${encodeURIComponent(entry.item.roomId)}` : "/equipo" } };
    default:
      return { who, what: "Tiene algo para ti en su chat", sub: "", action: { kind: "link", label: "Abrir", href: entry.botId && entry.missionId ? `/chat/${entry.botId}?c=${entry.missionId}` : "/" } };
  }
}

/** Which rows show and what the toggle says: {shown, hidden, label} («Ver las 5», «Ver menos»). */
export function foldRows(entries = [], { all = false, open = [], limit = ROWS_SHOWN } = {}) {
  const total = entries.reduce((n, e) => n + (e.count || 1), 0);
  if (entries.length <= limit) return { shown: entries, hidden: 0, label: null };
  if (all) return { shown: entries, hidden: 0, label: "Ver menos" };
  // A row you opened stays on screen when the list is folded.
  const keep = new Set(open);
  const shown = entries.filter((e, i) => i < limit || keep.has(e.key));
  return { shown, hidden: entries.length - shown.length, label: `Ver las ${total}` };
}
