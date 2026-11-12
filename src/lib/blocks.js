// «Bloques vivos» (server/blocks.mjs): the pure side of drawing one. The server sends numbers
// as numbers and text as plain text; everything a person reads is written here (es-ES), never
// taken pre-formatted from a bot.

const NUMBER = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, useGrouping: "always" });
const MINUS = "−", NBSP = " ";

/** «1.234,5»: Spanish separators, two decimals at most, a real minus sign. */
export function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return NUMBER.format(Object.is(value, -0) ? 0 : value).replace(/^-/, MINUS);
}
/** «1.234,5 €», «12 %», «7 tickets»: the unit after the number, as Spanish writes it. */
export function formatValue(value, unit = "") {
  const n = formatNumber(value);
  const u = String(unit || "").trim();
  return u && n !== "—" ? n + NBSP + u : n;
}
/** A cell or a row's value: numbers formatted, text as it is, nothing as a dash. */
export function cellText(value) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "number" ? formatNumber(value) : String(value);
}
const signed = (n) => (n > 0 ? "+" : "") + formatNumber(n);

/**
 * How a kpi moved, in words: {text: '+50 € · +25 %', tone: 'good'|'bad'|'flat', direction,
 * spoken: 'Sube 50 € (25 %) respecto a la vez anterior'}. Null without a delta.
 */
export function deltaLabel(delta, unit = "") {
  if (!delta || !Number.isFinite(delta.change)) return null;
  if (delta.direction === "flat") return { text: "Sin cambios", tone: "flat", direction: "flat", spoken: "Igual que la vez anterior" };
  const u = String(unit || "").trim();
  const amount = u === "%" ? signed(delta.change) + NBSP + "pt" : signed(delta.change) + (u ? NBSP + u : "");
  const percent = Number.isFinite(delta.percent) && u !== "%" ? signed(delta.percent) + NBSP + "%" : null;
  const up = delta.direction === "up";
  const plainAmount = formatValue(Math.abs(delta.change), u === "%" ? "pt" : u);
  return {
    text: [amount, percent].filter(Boolean).join(" · "),
    tone: delta.good === true ? "good" : delta.good === false ? "bad" : "flat",
    direction: delta.direction,
    spoken: (up ? "Sube " : "Baja ") + plainAmount + (percent ? " (" + formatNumber(Math.abs(delta.percent)) + NBSP + "%)" : "") + " respecto a la vez anterior",
  };
}

/**
 * The path of a sparkline in a `width`×`height` box: «M0 12L10 4…». Fewer than two numbers
 * draw nothing (null); equal numbers draw a flat line through the middle.
 */
export function sparklinePath(values, width = 120, height = 32, pad = 2) {
  const list = (Array.isArray(values) ? values : []).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (list.length < 2) return null;
  const min = Math.min(...list), max = Math.max(...list), span = max - min;
  const round = (n) => Math.round(n * 10) / 10;
  const x = (i) => round(pad + (i * (width - 2 * pad)) / (list.length - 1));
  const y = (v) => round(span === 0 ? height / 2 : height - pad - ((v - min) * (height - 2 * pad)) / span);
  return list.map((v, i) => (i ? "L" : "M") + x(i) + " " + y(v)).join("");
}
/** Where the last point of that sparkline is ({x, y}), for its dot. */
export function sparklineEnd(values, width = 120, height = 32, pad = 2) {
  const path = sparklinePath(values, width, height, pad);
  if (!path) return null;
  const [x, y] = path.slice(path.lastIndexOf("L") + 1).split(" ").map(Number);
  return { x, y };
}

/** 0–100 for a progress bar. */
export function progressPercent(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

export const STATE_LABEL = Object.freeze({ ok: "Bien", atencion: "Atención", fallo: "Fallo" });

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** «ahora mismo», «hace 5 min», «hace 2 h», «hace 3 d». */
export function agoLabel(iso, now = Date.now()) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "";
  const ms = Math.max(0, now - at);
  if (ms < MIN) return "ahora mismo";
  if (ms < HOUR) return "hace " + Math.floor(ms / MIN) + " min";
  if (ms < DAY) return "hace " + Math.floor(ms / HOUR) + " h";
  return "hace " + Math.floor(ms / DAY) + " d";
}
const hhmm = (d) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const dayMonth = (d, now) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) }).replace(/\./g, "");
/** «hoy a las 08:02», «ayer a las 08:02», «el 10 nov». */
export function sinceLabel(iso, now = Date.now()) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "";
  const d = new Date(at), today = new Date(now);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  if (days <= 0) return "hoy a las " + hhmm(d);
  if (days === 1) return "ayer a las " + hhmm(d);
  return "el " + dayMonth(d, now);
}
/** A block is stale when nothing refreshed it for longer than the server said it may go (twice its routine's interval, else 48 h). */
export function isStale(block, now = Date.now()) {
  const at = Date.parse(block?.updatedAt || "");
  if (!Number.isFinite(at)) return true;
  return now - at > (Number(block.staleAfterMs) > 0 ? block.staleAfterMs : 48 * HOUR);
}
/** The line under a block: «Actualizado hace 2 h», or «Sin actualizar desde ayer a las 08:02» once stale. */
export function updatedLabel(block, now = Date.now()) {
  return isStale(block, now) ? "Sin actualizar desde " + sinceLabel(block?.updatedAt, now) : "Actualizado " + agoLabel(block?.updatedAt, now);
}
/** «Dato del 11 nov»: what moment a kpi's figure is about, when its bot said so. */
export function asOfLabel(iso, now = Date.now()) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  // A date without a time is that calendar day, whatever the time zone here.
  const day = midnight ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d;
  return "Dato del " + dayMonth(day, now) + (midnight ? "" : ", " + hhmm(d));
}
/** Who keeps a block: «Nora · Ventas cada mañana», «Nora», «Un bot que ya no está». */
export function sourceLabel(block) {
  const s = block?.source || {};
  const who = s.botName || "Un bot que ya no está";
  if (s.routine) return who + " · " + s.routine;
  if (s.routineGone) return who + " · su rutina ya no existe";
  return who;
}
/** Which way a block can still move on the panel. */
export function moveOptions(ids, id) {
  const at = ids.indexOf(id);
  return { up: at > 0, down: at >= 0 && at < ids.length - 1, position: at + 1, total: ids.length };
}
/** `ids` with `id` one place up or down (the same list when it cannot move). */
export function movedIds(ids, id, direction) {
  const at = ids.indexOf(id), to = at + (direction === "up" ? -1 : 1);
  if (at < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
/** The id of a block from its message in a conversation (`block:<id>`), or null. */
export const blockIdOf = (message) => (message?.kind === "block" && typeof message.id === "string" && message.id.startsWith("block:") ? message.id.slice(6) : null);
/** A link the app may open outside: http or https only (the server already checks; this is the last word). */
export function externalHref(url) {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
/** What a link shows: its host («tienda.test»). */
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
