// «Recordar después» in «Te necesitan»: when a request that waits for you may come back, and
// which ones are put off right now. Pure: no React, no network. The time is kept on the
// approval (`snoozedUntil`, POST /api/approvals/:id/snooze; server/snooze.mjs).

const at9 = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 9, 0, 0, 0);

/**
 * The three choices, in local time: in one hour, tomorrow at 9:00, and Monday of next week at
 * 9:00. On a Sunday «next week» is tomorrow, so that choice is left out.
 * @returns {{id: "hour"|"tomorrow"|"week", label: string, at: Date}[]}
 */
export function snoozeChoices(now = new Date()) {
  const toMonday = ((8 - now.getDay()) % 7) || 7; // Monday → the next one, never today
  const tomorrow = at9(now, 1);
  const monday = at9(now, toMonday);
  return [
    { id: "hour", label: "Dentro de 1 hora", at: new Date(now.getTime() + 3600e3) },
    { id: "tomorrow", label: "Mañana a las 9:00", at: tomorrow },
    ...(monday.getTime() === tomorrow.getTime() ? [] : [{ id: "week", label: "La semana que viene (lunes a las 9:00)", at: monday }]),
  ];
}

/** When this request stops waiting by itself (ms): a send that leaves alone, an expiry, a timed question. */
export function snoozeDeadline(a) {
  const times = [a?.autoSendAt, a?.expiresAt, a?.stillOpen ? null : a?.waitUntil].map((t) => Date.parse(t || "")).filter((t) => !Number.isNaN(t));
  return times.length ? Math.min(...times) : null;
}

/**
 * The choices these requests can take: never one that falls after the deadline of any of
 * them. Empty when nothing can be put off (then «Recordar después» is not shown).
 */
export function snoozeChoicesFor(items, now = new Date()) {
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length || list.some((a) => a.status !== "pending")) return [];
  const deadlines = list.map(snoozeDeadline).filter((t) => t != null);
  const limit = deadlines.length ? Math.min(...deadlines) : Infinity;
  return snoozeChoices(now).filter((c) => c.at.getTime() < limit);
}

/** Put off right now. */
export function isSnoozed(a, now = Date.now()) {
  if (!a || a.status !== "pending" || !a.snoozedUntil) return false;
  const until = Date.parse(a.snoozedUntil);
  return !Number.isNaN(until) && until > now;
}

/** {waiting, snoozed}: the pending requests that count now, and the ones put off (soonest back first). */
export function splitSnoozed(approvals = [], now = Date.now()) {
  const waiting = [], snoozed = [];
  for (const a of approvals) (isSnoozed(a, now) ? snoozed : waiting).push(a);
  snoozed.sort((a, b) => Date.parse(a.snoozedUntil) - Date.parse(b.snoozedUntil));
  return { waiting, snoozed };
}

/**
 * «Posponer» a room or a conversation (PATCH /api/rooms/:id or /missions/:id { snooze }): the
 * same presets as the server (server/rooms.mjs › snoozeUntil), each with when it comes back.
 * «Hasta esta tarde» only while it is still before 17:00.
 * @returns {{id: "tarde"|"manana"|"lunes", label: string, hint: string}[]}
 */
export function roomSnoozeChoices(from = new Date()) {
  const at = (days, h) => { const d = new Date(from); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const afternoon = at(0, 17);
  const monday = at(((8 - from.getDay()) % 7) || 7, 9);
  return [
    ...(afternoon > from ? [{ id: "tarde", label: "Hasta esta tarde", hint: hhmm(afternoon) }] : []),
    { id: "manana", label: "Hasta mañana", hint: hhmm(at(1, 9)) },
    { id: "lunes", label: "Hasta el lunes", hint: monday.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) },
  ];
}

/** «2 pospuestos». */
export const snoozedLabel = (n) => (n === 1 ? "1 pospuesto" : `${n} pospuestos`);

const hhmm = (d) => d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
/** «hoy a las 17:40», «mañana a las 9:00», «el lunes 4 a las 9:00». */
export function snoozeWhen(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  const day = days <= 0 ? "hoy" : days === 1 ? "mañana" : "el " + d.toLocaleDateString("es-ES", { weekday: "long" }) + " " + d.getDate();
  return `${day} a las ${hhmm(d)}`;
}
