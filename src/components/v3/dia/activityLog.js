// The pure part of Actividad (src/screens/Actividad.jsx, design/V3Actividad.dc.html): the log
// of what each bot did, built from the rooms' and chats' steps (their tool calls, as
// GET /api/missions/:id returns them) and from the requests they made you. One row per kind of
// action in a step («Nora leyó 4 páginas web»), newest first, with a technical line for
// expert mode («web_fetch ×4 · ine.es → no responde»). Kept apart so it can be tested.
import { isSala } from "../../../lib/rooms.js";
import { C } from "../../../lib/theme.js";

// Filters of the board: Todo · Pidió permiso · Leyó y calculó · Escribió · Envió fuera · Errores.
export const FILTERS = [["todo", "Todo"], ["permiso", "Pidió permiso"], ["leer", "Leyó y calculó"], ["escribir", "Escribió"], ["enviar", "Envió fuera"], ["error", "Errores"]];

// Status of a row → its words and colours (the board's S map, plus «Descartado»).
export const STATUS = {
  ok: { label: "Hecho", bg: C.okSoft, ink: C.okInk },
  wait: { label: "Espera tu OK", bg: C.honey, ink: C.honeyInk },
  run: { label: "En curso", bg: C.chip, ink: C.accentInk },
  unk: { label: "Sin confirmar", bg: C.chip, ink: C.text2 },
  err: { label: "Error", bg: C.errorSoft, ink: C.error },
  off: { label: "Descartado", bg: C.chip, ink: C.text2 },
};

const SEND = /send|post_?message|publish|reply|forward|invite|transfer|pay|tweet|share|upload|create_event|chat_post/i;
const WRITE = /write|create|edit|update|append|deliverable|draft|save|remember|generate|image|rename|move|delete/i;
const ts = (x) => Date.parse(x || 0) || 0;
const LIVE = new Set(["running", "queued", "planning"]);

/** «leer» | «escribir» | «enviar» for a tool call (its name, or the app action behind it). */
export function kindOfTool(name, card = {}) {
  const what = String(card?.tool || name || "");
  if (card?.type === "deliverable" || card?.type === "memory") return "escribir";
  if (SEND.test(what) && !/draft/i.test(what)) return "enviar";
  if (WRITE.test(what)) return "escribir";
  return "leer";
}

const statusOf = (calls) => (calls.some((c) => c.status === "error") ? "err" : calls.some((c) => c.status === "uncertain") ? "unk" : calls.some((c) => c.status === "waiting") ? "wait" : calls.some((c) => c.status === "running") ? "run" : "ok");

/** What a group of calls of one tool did, in plain words («leyó 4 páginas web»). */
export function sentenceOf(name, calls) {
  const n = calls.length;
  const card = calls[0]?.card || {};
  const failed = calls.every((c) => c.status === "error");
  switch (card.type) {
    case "web": return failed ? `no pudo abrir ${card.domain || "una página web"}` : n > 1 ? `leyó ${n} páginas web` : `leyó ${card.title || card.domain || "una página web"}`;
    case "search": return n > 1 ? `buscó ${n} veces` : card.query ? `buscó «${card.query}»` : "buscó en lo que ya sabe";
    case "file": return failed ? `no pudo leer ${card.name || "un archivo"}` : n > 1 ? `leyó ${n} archivos` : `leyó ${card.name || "un archivo"}`;
    case "folder": return `miró la carpeta ${card.path || ""}`.trim();
    case "deliverable": return n > 1 ? `escribió ${n} entregables` : `escribió «${card.title || "un entregable"}»`;
    case "command": return failed ? `no pudo ejecutar ${card.program || "un programa"}` : n > 1 ? `ejecutó ${n} órdenes` : `ejecutó ${card.program || "una orden"}`;
    case "app": return failed ? `no pudo usar ${card.app || "una app"}` : `usó ${card.app || "una app"}${card.action ? " para " + card.action : ""}${n > 1 ? ` (${n} veces)` : ""}`;
    case "browser": return `navegó por ${card.domain || "la web"}`;
    case "desktop": return `usó ${card.app || "el ordenador"} en el ordenador`;
    case "memory": return "guardó algo en su memoria";
    case "note": {
      const what = n > 1 ? `${n} notas` : `la nota «${card.title || "sin título"}»`;
      if (card.action === "read") return failed ? `no pudo leer ${what}` : `leyó ${what}`;
      return failed ? `no pudo cambiar ${what}` : `${card.action === "create" || card.created ? "creó" : "cambió"} ${what}`;
    }
    case "bot": return `le preguntó a ${card.botName || "otro bot"}`;
    case "question": return "te hizo una pregunta";
    default: return failed ? `no pudo usar ${String(name).replace(/_/g, " ")}` : `usó ${String(name).replace(/_/g, " ")}${n > 1 ? ` ×${n}` : ""}`;
  }
}

/** The technical line of a group (expert mode). */
export function toolLine(name, calls) {
  const card = calls[0]?.card || {};
  const detail = card.domain || card.name || card.command || card.query || card.tool || card.title || card.app || card.path || "";
  const parts = [`${name}${calls.length > 1 ? " ×" + calls.length : ""}${detail ? " " + String(detail).slice(0, 80) : ""}`];
  const errors = calls.filter((c) => c.error);
  if (errors.length) parts.push(String(errors[0].error).slice(0, 120));
  if (card.exitCode != null && card.exitCode !== 0) parts.push("salida " + card.exitCode);
  return parts.join(" · ");
}

// Where it happened: the chat's title (its bot is already the row's), the room or the task.
export const placeOf = (m) => (!m ? "" : m.conversation && !isSala(m) ? m.title || "Chat" : isSala(m) ? "#" + (m.room || m.title || "sala") : m.title || "Tarea");
export const hrefOf = (m) => (!m ? null : m.conversation && !isSala(m) ? `/chat/${m.botIds?.[0]}?c=${m.id}` : isSala(m) ? `/sala/${m.id}` : `/encargo/${m.id}`);

const APPROVAL_TEXT = {
  send: (a) => `quiere enviar ${a.email?.subject ? "«" + a.email.subject + "»" : a.title}`,
  permission: (a) => `pidió permiso: ${a.title}`,
  question: (a) => `te preguntó: ${a.title}`,
  plan: () => "te propuso un plan",
  secret: (a) => `pidió una clave: ${a.title}`,
};
const APPROVAL_STATUS = { pending: "wait", approved: "ok", answered: "ok", denied: "off", dismissed: "off", expired: "off", cancelled: "off" };

/**
 * The log rows since `from` (ms): [{id, at, botId, missionId, where, href, k, s, text, tool}].
 * `details`: mission details ({…mission, steps}); `approvals`: the requests in the state.
 */
export function logRows({ details = [], approvals = [], from = 0 }) {
  const rows = [];
  const byId = new Map(details.map((d) => [d.id, d]));
  for (const d of details) {
    if (!d || d.incognito) continue;
    const where = placeOf(d);
    const href = hrefOf(d);
    for (const s of d.steps || []) {
      const at = s.completedAt || s.startedAt;
      // A step still running counts while its room or chat really runs (not one left half done days ago).
      if (!at || (ts(at) < from && !(s.status === "running" && LIVE.has(d.status)))) continue;
      const base = { at: s.status === "running" ? s.startedAt || at : at, botId: s.botId || d.botIds?.[0] || "atlas", missionId: d.id, where, href };
      const groups = new Map();
      for (const call of s.tools || []) {
        const name = call.name || "herramienta";
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(call);
      }
      let i = 0;
      for (const [name, calls] of groups) {
        const ok = calls.filter((c) => c.status !== "error");
        const bad = calls.filter((c) => c.status === "error");
        // A failure gets its own row («Nora no pudo abrir la web del INE»).
        for (const part of ok.length && bad.length ? [ok, bad] : [calls]) {
          const st = statusOf(part);
          rows.push({ ...base, id: `${s.id}:${i++}`, k: st === "err" ? "error" : kindOfTool(name, part[0]?.card), s: st, text: sentenceOf(name, part), tool: toolLine(name, part) });
        }
      }
      // The step itself: what it wrote, that it is on it, or that it could not finish.
      const words = s.words ? ` · ${s.words.toLocaleString("es-ES")} ${s.words === 1 ? "palabra" : "palabras"}` : "";
      if (s.status === "running" && !groups.size) rows.push({ ...base, id: s.id + ":paso", k: "leer", s: "run", text: s.narration?.text ? s.narration.text.charAt(0).toLowerCase() + s.narration.text.slice(1) : `está con «${s.title}»`, tool: `${s.kind}${words}` });
      else if (s.status === "completed" && (s.words || !groups.size)) rows.push({ ...base, id: s.id + ":paso", k: "escribir", s: "ok", text: `terminó «${s.title}»`, tool: `${s.kind}${words}` });
      else if (["failed", "error", "interrupted"].includes(s.status)) rows.push({ ...base, id: s.id + ":paso", k: "error", s: "err", text: `no pudo terminar «${s.title}»`, tool: `${s.kind} · ${s.status}` });
    }
  }
  for (const a of approvals) {
    if (ts(a.createdAt) < from) continue;
    const m = byId.get(a.missionId);
    if (m?.incognito) continue;
    const st = APPROVAL_STATUS[a.status] || "unk";
    const byYou = a.decidedBy === "tú" && st === "ok" ? (a.status === "answered" ? " (respondiste tú)" : " (aprobado por ti)") : "";
    rows.push({
      id: "ap:" + a.id, at: a.createdAt, botId: a.botId || "atlas", missionId: a.missionId, where: m ? placeOf(m) : a.context || "", href: st === "wait" ? `/revisar/${a.id}` : hrefOf(m),
      k: a.kind === "send" ? "enviar" : "permiso", s: st, text: (APPROVAL_TEXT[a.kind] || ((x) => `te pidió: ${x.title}`))(a) + byYou,
      tool: [a.kind, a.app || a.scopeLabel, a.impact?.headline, a.revision ? "rev " + String(a.revision).slice(0, 6) : null].filter(Boolean).join(" · "),
    });
  }
  return rows.sort((x, y) => ts(y.at) - ts(x.at));
}

/** Rows that pass the filter (and the bot, in expert mode). */
export const filterRows = (rows, filter = "todo", botId = null) => rows.filter((r) => (filter === "todo" || r.k === filter) && (!botId || r.botId === botId));

/** CSV of the log (Excel in Spanish reads «;»). */
export function logCsv(rows, bots = []) {
  const cell = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const nameOf = (id) => bots.find((b) => b.id === id)?.name || id;
  const head = ["Fecha", "Bot", "Qué", "Dónde", "Estado", "Detalle"];
  return [head, ...rows.map((r) => [new Date(r.at).toISOString(), nameOf(r.botId), r.text, r.where, STATUS[r.s]?.label || r.s, r.tool])].map((line) => line.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** «12 min», «2 h», «3 d» since an ISO time. */
export function since(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts(iso)) / 60e3));
  if (m < 60) return `${Math.max(1, m)} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}
