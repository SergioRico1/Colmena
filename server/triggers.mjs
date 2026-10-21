import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { now } from "./store.mjs";
import { validateWebUrl, webFetch } from "./web.mjs";
import { LoopGuard, ROOM_LOOP_GUARD, postGuardNotice } from "./loops.mjs";

// Trigger types and their config mirror design/Disparador.dc.html (class Logic).
export const TIME_TYPES = new Set(["dia", "semana", "vez"]);
export const TRIGGER_TYPES = ["dia", "semana", "vez", "correo", "archivo", "evento", "sala", "hoja", "web"];
export const CONNECTOR_OF = { correo: "correo", evento: "calendario", hoja: "hojas" };
export const CONNECTOR_NAMES = {
  correo: "Correo", calendario: "Calendario", carpeta: "Carpeta compartida", hojas: "Hojas de cálculo",
  chat: "Chat del equipo", video: "Videollamadas", crm: "Clientes (CRM)", erp: "Contabilidad (ERP)",
};
// Connected-account toolkits that count as each connector.
export const TOOLKITS = {
  correo: ["gmail", "outlook", "microsoft_outlook", "zoho_mail"],
  calendario: ["googlecalendar", "outlook", "microsoft_outlook", "outlook_calendar"],
  carpeta: ["googledrive", "onedrive", "one_drive", "dropbox", "box", "sharepoint"],
  hojas: ["googlesheets", "excel", "microsoft_excel", "airtable"],
  chat: ["slack", "microsoft_teams", "discord", "telegram", "whatsapp", "googlechat"],
  video: ["zoom", "googlemeet", "webex"],
  crm: ["hubspot", "salesforce", "pipedrive", "zoho", "attio", "close"],
  erp: ["quickbooks", "xero", "netsuite", "odoo", "holded", "freshbooks", "sage"],
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida (HH:MM).");
const text = (max = 200) => z.string().trim().max(max);
const day = z.number().int().min(0).max(6);
// Every field the Disparador editor can hold. Unknown keys are rejected; keys of
// other trigger types are accepted (the editor keeps them) and dropped on save.
const configFields = z
  .object({
    hora: hhmm, zona: text(60), dias: z.array(day).max(7), festivo: z.enum(["saltar", "igual", "siguiente"]),
    semDia: day, semHora: hhmm, semCada: z.union([z.enum(["1", "2", "3", "4"]), z.number().int().min(1).max(4)]),
    vezFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida (AAAA-MM-DD)."), vezHora: hhmm, vezAviso: z.boolean(),
    buzon: text(254), deModo: z.enum(["todos", "algunos"]), remitentes: z.array(text(254).min(1)).max(20), nuevoRem: text(254),
    asunto: text(200), adjuntos: z.enum(["igual", "si", "pdf"]), entiende: z.boolean(),
    carpeta: text(400), folderId: text(100), subcarpetas: z.boolean(), tipoArchivo: z.enum(["pdf", "hoja", "imagen", "todo"]),
    nombre: text(120), quienSube: z.enum(["todos", "equipo", "fuera"]),
    calendario: text(120), eventoFiltro: z.enum(["todos", "palabra", "fuera"]), eventoPalabra: text(120),
    antelacion: z.union([z.string().regex(/^\d{1,4}$/), z.number().int().min(0).max(9999)]), unidad: z.enum(["minutos", "horas", "días"]), laboral: z.boolean(),
    sala: text(120), salaModo: z.enum(["todo", "mencion", "palabras"]), palabras: text(300), deQuien: z.enum(["personas", "todos"]),
    hoja: text(200), pestana: text(120), cambio: z.enum(["fila", "columna", "supere"]), columna: text(120), valor: text(120),
    url: text(2000), condicion: z.enum(["cambia", "contiene", "precio_bajo"]), texto: text(200),
    precio: z.union([z.string().trim().max(20), z.number().min(0).max(1e9)]), frecuencia: z.enum(["15m", "1h", "1d"]),
    probado: z.boolean(),
  })
  .partial()
  .strict();

export const CONFIG_KEYS = Object.keys(configFields.shape);

const DEFAULTS = {
  dia: { hora: "08:00", zona: "Madrid", dias: [1, 2, 3, 4, 5], festivo: "saltar" },
  semana: { semDia: 1, semHora: "09:00", semCada: "1" },
  vez: { vezFecha: "", vezHora: "10:00", vezAviso: true },
  correo: { buzon: "", deModo: "todos", remitentes: [], asunto: "", adjuntos: "igual", entiende: true },
  archivo: { carpeta: "", folderId: "", subcarpetas: true, tipoArchivo: "todo", nombre: "", quienSube: "todos" },
  evento: { calendario: "personal", eventoFiltro: "todos", eventoPalabra: "", antelacion: "30", unidad: "minutos", laboral: false },
  sala: { sala: "cualquier sala", salaModo: "mencion", palabras: "", deQuien: "personas" },
  hoja: { hoja: "", pestana: "", cambio: "fila", columna: "", valor: "" },
  web: { url: "", condicion: "cambia", texto: "", precio: "", frecuencia: "1h" },
};

// The live editor (src/components/Disparador.jsx) uses short field names; the
// canonical names come from the approved mockup's logic. Both are accepted.
const ALIASES = {
  semana: { dia: "semDia", hora: "semHora", cada: "semCada" },
  vez: { fecha: "vezFecha", hora: "vezHora", avisarAntes: "vezAviso" },
  correo: { de: "deModo", entender: "entiende" },
  archivo: { carpetaId: "folderId", tipo: "tipoArchivo", quien: "quienSube" },
  evento: { filtro: "eventoFiltro", palabra: "eventoPalabra" },
  sala: { modo: "salaModo" },
};
const EDITOR_ONLY = { sala: ["missionId"] };
export function canonicalConfig(type, config = {}) {
  const map = ALIASES[type] || {};
  const out = {};
  for (const [key, value] of Object.entries(config || {})) {
    if ((EDITOR_ONLY[type] || []).includes(key)) continue;
    if (map[key]) out[map[key]] = value;
    else if (!Object.values(ALIASES).some((m) => m[key] && !(key in (DEFAULTS[type] || {})))) out[key] = value;
  }
  if (type === "sala" && out.sala === "*") out.sala = "cualquier sala";
  if (type === "archivo" && out.folderId === null) delete out.folderId;
  return out;
}
/** Adds the editor's short names next to the canonical ones (for round trips). */
export function editorConfig(type, config = {}) {
  const out = { ...config };
  for (const [alias, canonical] of Object.entries(ALIASES[type] || {})) if (config[canonical] !== undefined) out[alias] = config[canonical];
  if (type === "sala" && config.sala === "cualquier sala") out.sala = "*";
  if (type === "semana" && out.cada !== undefined) out.cada = Number(out.cada);
  return out;
}

export const triggerInput = z.preprocess(
  (input) => (input && typeof input === "object" && TRIGGER_TYPES.includes(input.type) ? { ...input, config: canonicalConfig(input.type, input.config) } : input),
  z.object({ type: z.enum(TRIGGER_TYPES), config: configFields.default({}), sentence: text(400).optional() }).strict(),
);

/** Keeps only the fields of the trigger type, with defaults, and validates required ones. */
export function normalizeTrigger(input) {
  const { type, config } = triggerInput.parse(input);
  const out = { ...structuredClone(DEFAULTS[type]) };
  for (const key of Object.keys(out)) if (config[key] !== undefined) out[key] = config[key];
  if (type === "dia") {
    out.dias = [...new Set(out.dias)].sort();
    if (!out.dias.length) throw Error("Elige al menos un día.");
  }
  if (type === "semana") out.semCada = String(out.semCada);
  if (type === "evento") out.antelacion = String(out.antelacion);
  if (type === "vez" && !out.vezFecha) throw Error("Elige la fecha de la automatización.");
  if (type === "correo") out.remitentes = [...new Set(out.remitentes)];
  if (type === "archivo" && !out.carpeta && !out.folderId) throw Error("Elige la carpeta que se vigila.");
  if (type === "hoja" && !out.hoja) throw Error("Elige la hoja de cálculo.");
  if (type === "web") {
    if (!out.url) throw Error("Escribe la dirección de la página que se vigila.");
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(out.url)) out.url = "https://" + out.url;
    out.url = validateWebUrl(out.url).href;
    out.precio = out.precio === "" ? "" : String(out.precio).replace(",", ".");
    if (out.condicion === "contiene" && !out.texto) throw Error("Escribe el texto que tiene que aparecer en la página.");
    if (out.condicion === "precio_bajo" && !(Number(out.precio) > 0)) throw Error("Escribe el precio límite (por ejemplo 50).");
  }
  const trigger = { type, config: out };
  return { ...trigger, sentence: sentence(trigger) };
}

const DN = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DNC = ["Domingos", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábados"];
const ML = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function daysText(dias) {
  const pl = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
  const sel = ORDER.filter((d) => dias.includes(d));
  if (sel.length === 7) return "todos los días";
  if (!sel.length) return "ningún día";
  if (sel.join() === "1,2,3,4,5") return "de lunes a viernes";
  if (sel.join() === "6,0") return "los fines de semana";
  const names = sel.map((d) => pl[d]);
  return "los " + (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " y " + names.at(-1));
}

/** Same sentence as Disparador's summary(): «Se pondrá en marcha cuando …». */
export function sentence({ type, config }) {
  const s = { ...DEFAULTS[type], ...config };
  if (type === "dia") return "sean las " + s.hora + " " + daysText(s.dias);
  if (type === "semana") return "sea " + DN[s.semDia] + " a las " + s.semHora + (String(s.semCada) !== "1" ? ", cada " + s.semCada + " semanas" : "");
  if (type === "vez") {
    const p = (s.vezFecha || "").split("-").map(Number);
    if (p.length < 3 || !p[0]) return "llegue la fecha que elijas";
    const d = new Date(p[0], p[1] - 1, p[2]);
    return "llegue el " + DN[d.getDay()] + " " + p[2] + " de " + ML[p[1] - 1] + " a las " + s.vezHora;
  }
  if (type === "correo") {
    let r = "llegue un correo" + (s.buzon ? " a " + s.buzon : "");
    if (s.deModo === "algunos" && s.remitentes.length) r += " de " + s.remitentes.join(" o ");
    if (s.asunto.trim()) r += " con «" + s.asunto.trim() + "» en el asunto";
    if (s.adjuntos === "pdf") r += " y un PDF adjunto";
    if (s.adjuntos === "si") r += " y algún adjunto";
    return r;
  }
  if (type === "archivo") {
    const tipos = { pdf: "un PDF", hoja: "una hoja de cálculo", imagen: "una imagen", todo: "un archivo" };
    return "se suba " + tipos[s.tipoArchivo] + " a " + (s.carpeta || "la carpeta elegida").split(/[\\/]/).filter(Boolean).join(" / ") +
      (s.subcarpetas ? " (o sus subcarpetas)" : "") + (s.nombre.trim() ? " con «" + s.nombre.trim() + "» en el nombre" : "");
  }
  if (type === "evento") {
    const f = s.eventoFiltro === "todos" ? "cualquier evento" : s.eventoFiltro === "fuera" ? "una reunión con gente de fuera" : "un evento con «" + s.eventoPalabra + "»";
    return "falten " + s.antelacion + " " + s.unidad + " para " + f + " del calendario " + s.calendario;
  }
  if (type === "sala") {
    const sala = s.sala === "cualquier sala" ? "cualquier sala" : "# " + s.sala;
    if (s.salaModo === "todo") return "alguien escriba en " + sala;
    if (s.salaModo === "mencion") return "alguien mencione a un bot en " + sala;
    return "alguien escriba «" + s.palabras + "» en " + sala;
  }
  if (type === "web") return webSentence(s);
  if (s.cambio === "fila") return "se añada una fila a " + s.hoja + " › " + s.pestana;
  if (s.cambio === "columna") return "cambie la columna " + s.columna + " de " + s.hoja + " › " + s.pestana;
  return "el " + String(s.columna).toLowerCase() + " supere " + s.valor + " en " + s.hoja + " › " + s.pestana;
}

/** «example.com» from a URL (or the text as written). */
export function webDomain(url) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : "https://" + url).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "").trim() || "la página";
  }
}
const euros = (n) => String(n).replace(".", ",") + " €";
/** «cambie la página de example.com», «el precio en example.com baje de 50 €». */
export function webSentence(s) {
  const where = s.url ? webDomain(s.url) : "la página que elijas";
  if (s.condicion === "contiene") return "la página de " + where + " contenga «" + (String(s.texto || "").trim() || "…") + "»";
  if (s.condicion === "precio_bajo") return "el precio en " + where + " baje de " + (String(s.precio ?? "").trim() ? euros(String(s.precio).trim()) : "el límite que elijas");
  return "cambie la página de " + where;
}

// --- Page diff (ported from OpenMuse apps/server/src/engine/page-diff.ts, MIT: licenses/OpenMuse.txt) ---
/** Normalised, unique lines of page text for comparing two checks of a watched page. */
export function pageLines(text, limit = 2000) {
  const lines = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim().slice(0, 300);
    if (line) lines.add(line);
    if (lines.size >= limit) break;
  }
  return [...lines];
}
// Relative times («hace 2 días» → «hace 3 días», «58 minutes ago») tick on their own: not news.
const RELATIVE_TIME =
  /(?<![\p{L}\d])hace\s+(?:\d+|un|una|unos|unas|pocos)\s+(?:segundos?|seg|minutos?|min|horas?|h|días?|dias?|d|semanas?|sem|mes(?:es)?|años?|anos?)(?![\p{L}\d])|(?<![\p{L}\d])(?:\d+|an?|one)\s+(?:sec(?:ond)?|min(?:ute)?|hour|hr|day|week|month|year)s?\s+ago(?![\p{L}\d])|(?<![\p{L}\d])(?:ahora mismo|hace un momento|anteayer|ayer|hoy|just now|yesterday|today)(?![\p{L}\d])/giu;
export function withoutRelativeTimes(text) {
  return String(text).replace(RELATIVE_TIME, "<tiempo>");
}
// Any other number change (a price, a stock count, a version) counts as «actualizado».
const numberless = (line) => withoutRelativeTimes(line).replace(/\d+(?:[.,]\d+)*/g, "#").replace(/(\p{L})s(?![\p{L}\d])/gu, "$1").toLowerCase();
function pair(previous, current, key) {
  const open = new Map();
  for (const line of previous) open.set(key(line), [...(open.get(key(line)) || []), line]);
  const used = new Set();
  const paired = [];
  const unpaired = [];
  for (const line of current) {
    const match = open.get(key(line))?.shift();
    if (match === undefined) unpaired.push(line);
    else {
      used.add(match);
      paired.push(line);
    }
  }
  return { paired, unpaired, left: previous.filter((line) => !used.has(line)) };
}
/** { added, updated, removed } between two pageLines() lists. */
export function diffPage(previous, current) {
  const same = pair(previous, current, (line) => line);
  const retimed = pair(same.left, same.unpaired, withoutRelativeTimes);
  const renumbered = pair(retimed.left, retimed.unpaired, numberless);
  return { added: renumbered.unpaired, updated: renumbered.paired, removed: renumbered.left };
}
/** «Nuevo / Actualizado / Quitado» summary for the mission prompt, or "" when nothing changed. */
export function describePageDiff(diff) {
  const section = (title, lines, limit) => {
    if (!lines.length) return [];
    const shown = lines.slice(0, limit).map((line) => "• " + line.slice(0, 160));
    return [title + ":", ...shown, ...(lines.length > limit ? ["+" + (lines.length - limit) + " más"] : [])];
  };
  return [...section("Nuevo", diff.added, 8), ...section("Actualizado", diff.updated, 4), ...section("Quitado", diff.removed, 4)].join("\n");
}
/** «3 líneas cambiadas (2 nuevas, 1 actualizada)», or "". */
export function countPageDiff(diff) {
  const total = diff.added.length + diff.updated.length + diff.removed.length;
  if (!total) return "";
  const parts = [
    diff.added.length && diff.added.length + (diff.added.length === 1 ? " nueva" : " nuevas"),
    diff.updated.length && diff.updated.length + (diff.updated.length === 1 ? " actualizada" : " actualizadas"),
    diff.removed.length && diff.removed.length + (diff.removed.length === 1 ? " quitada" : " quitadas"),
  ].filter(Boolean);
  return total + (total === 1 ? " línea cambiada" : " líneas cambiadas") + " (" + parts.join(", ") + ")";
}
const AMOUNT = String.raw`\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MONEY = new RegExp(String.raw`(?:€|EUR|\$|USD|£)\s?(${AMOUNT})|(${AMOUNT})\s?(?:€|EUR(?![\p{L}])|euros?(?![\p{L}])|\$|USD(?![\p{L}])|£)`, "giu");
/** «1.299,00» → 1299, «49.90» → 49.9, «12,5» → 12.5. */
export function parseAmount(raw) {
  let v = String(raw).replace(/\s/g, "");
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  else v = v.replace(/,/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** First price on the page (preferring a line with `near`): «1.299,00 €», «€49.90», «12 EUR». */
export function findPrice(lines, near = "") {
  const want = fold(near);
  const pool = want ? lines.filter((l) => fold(l).includes(want)) : [];
  for (const line of [...pool, ...lines]) {
    MONEY.lastIndex = 0;
    const m = MONEY.exec(line);
    if (m) {
      const n = parseAmount(m[1] ?? m[2]);
      if (n != null) return n;
    }
  }
  return null;
}
export const WEB_EVERY = { "15m": 15 * 60000, "1h": 3600000, "1d": 86400000 };
export const WEB_MAX_FAILURES = 5;
const WEB_MAX_DELAY = 7 * 86400000;
/** Next check: the chosen frequency, doubled after each consecutive failure (max 7 days). */
export function webDelay(config, failures = 0) {
  return Math.min(WEB_MAX_DELAY, (WEB_EVERY[config?.frecuencia] || WEB_EVERY["1h"]) * 2 ** Math.max(0, failures));
}

// --- Calendar arithmetic, always in the machine's local time ---------------
const atTime = (date, time) => {
  const [h, m] = String(time || "0:0").split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0, 0, 0);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
/** Spanish national holidays (fixed dates + Good Friday) plus custom YYYY-MM-DD dates. */
export function isHoliday(date, extra = []) {
  const md = ymd(date).slice(5);
  if (["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"].includes(md)) return true;
  const e = easter(date.getFullYear());
  const goodFriday = new Date(e.getFullYear(), e.getMonth(), e.getDate() - 2);
  return ymd(goodFriday) === ymd(date) || extra.includes(ymd(date));
}
const workday = (d, extra) => d.getDay() !== 0 && d.getDay() !== 6 && !isHoliday(d, extra);

/**
 * Next run strictly after `from` for time triggers; null for event triggers or a
 * past single run. `anchor` fixes the phase of «cada N semanas».
 */
export function nextRun(trigger, from = new Date(), { holidays = [], anchor = null } = {}) {
  const c = { ...DEFAULTS[trigger.type], ...trigger.config };
  const base = new Date(from);
  if (trigger.type === "dia") {
    if (!c.dias.length) return null;
    for (let i = 0; i < 400; i++) {
      const candidate = atTime(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i), c.hora);
      if (candidate <= base || !c.dias.includes(candidate.getDay())) continue;
      if (isHoliday(candidate, holidays)) {
        if (c.festivo === "saltar") continue;
        if (c.festivo === "siguiente") {
          let moved = candidate;
          do moved = atTime(new Date(moved.getFullYear(), moved.getMonth(), moved.getDate() + 1), c.hora);
          while (!workday(moved, holidays));
          return moved.toISOString();
        }
      }
      return candidate.toISOString();
    }
    return null;
  }
  if (trigger.type === "semana") {
    const every = Number(c.semCada) || 1;
    const start = anchor ? new Date(anchor) : base;
    let first = atTime(start, c.semHora);
    while (first.getDay() !== Number(c.semDia)) first = atTime(new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1), c.semHora);
    const periodDays = 7 * every;
    if (first <= base) {
      const skip = Math.max(0, Math.floor((base - first) / (periodDays * 86400000)) - 1);
      first = atTime(new Date(first.getFullYear(), first.getMonth(), first.getDate() + skip * periodDays), c.semHora);
      while (first <= base) first = atTime(new Date(first.getFullYear(), first.getMonth(), first.getDate() + periodDays), c.semHora);
    }
    return first.toISOString();
  }
  if (trigger.type === "vez") {
    const p = String(c.vezFecha || "").split("-").map(Number);
    if (!p[0]) return null;
    const when = atTime(new Date(p[0], p[1] - 1, p[2]), c.vezHora);
    return when > base ? when.toISOString() : null;
  }
  return null;
}

// --- Human labels -----------------------------------------------------------
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** «Hoy», «Ayer», «Mañana», «Lun», «3 oct». */
export function dayLabel(date, reference = new Date()) {
  const d = new Date(date);
  const yesterday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - 1);
  const tomorrow = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
  if (sameDay(d, reference)) return "Hoy";
  if (sameDay(d, yesterday)) return "Ayer";
  if (sameDay(d, tomorrow)) return "Mañana";
  const days = Math.abs(reference - d) / 86400000;
  if (days < 6) return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][d.getDay()];
  return d.getDate() + " " + MS[d.getMonth()];
}
/** «hace 12 min», «hace 2 h», «ayer», «hace 3 días». */
export function ago(date, reference = Date.now()) {
  const minutes = Math.max(0, Math.round((reference - Date.parse(date)) / 60000));
  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return "hace " + minutes + " min";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return "hace " + hours + " h";
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : "hace " + days + " días";
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Short trigger label for lists: «Días laborables, 08:00», «Jueves, 10:00». */
export function triggerLabel({ type, config }) {
  const c = { ...DEFAULTS[type], ...config };
  if (type === "dia") {
    const sel = ORDER.filter((d) => c.dias.includes(d));
    const when = sel.length === 7 ? "Cada día" : sel.join() === "1,2,3,4,5" ? "Días laborables" : sel.join() === "6,0" ? "Fines de semana" : sel.length === 1 ? DNC[sel[0]] : sel.map((d) => "LMXJVSD"[ORDER.indexOf(d)]).join(", ");
    return when + ", " + c.hora;
  }
  if (type === "semana") return capital(DN[c.semDia]) + ", " + c.semHora + (String(c.semCada) !== "1" ? " · cada " + c.semCada + " semanas" : "");
  if (type === "vez") {
    const p = String(c.vezFecha).split("-").map(Number);
    return p[0] ? p[2] + " " + MS[p[1] - 1] + ", " + c.vezHora : "Una vez";
  }
  return {
    correo: "Cuando llega un correo",
    archivo: "Cuando se sube un archivo",
    evento: "Antes de un evento",
    sala: c.sala === "cualquier sala" ? "Cuando escriben en una sala" : "Cuando escriben en #" + c.sala,
    hoja: "Cuando cambia una hoja",
    web: "Cuando cambia una página",
  }[type];
}

/** «Días laborables, 08:00 · Hoy ✓» — state first, then the last outcome. */
export function subtitle(rule, reference = new Date()) {
  const head = rule.trigger ? triggerLabel(rule.trigger) : rule.intervalMinutes ? "Cada " + rule.intervalMinutes + " min" : "Sin disparador";
  let tail;
  if (!rule.enabled) tail = "Pausada";
  else if (rule.state === "blocked") tail = "Bloqueada";
  else if (rule.state === "waiting") tail = "Te espera";
  else if (rule.state === "running") tail = "En marcha";
  else if (rule.lastRun) {
    const ok = !["blocked", "cancelled", "failed"].includes(rule.lastStatus);
    const when = !rule.trigger || TIME_TYPES.has(rule.trigger.type) ? dayLabel(rule.lastRun, reference) : capital(ago(rule.lastRun, reference.getTime()));
    tail = when + (ok ? " ✓" : " ✗");
  } else if (rule.nextRun) {
    const next = new Date(rule.nextRun);
    tail = "Próxima: " + dayLabel(next, reference).toLowerCase() + " " + String(next.getHours()).padStart(2, "0") + ":" + String(next.getMinutes()).padStart(2, "0");
  } else tail = TIME_TYPES.has(rule.trigger?.type) ? "Sin próximas" : "Vigilando";
  return head + " · " + tail;
}

/** What a trigger needs from the bot (contract `needs`). */
export function defaultNeeds({ type }) {
  const connector = CONNECTOR_OF[type] || (type === "archivo" ? "carpeta" : null);
  return connector ? [{ tool: connector, access: "lee" }] : [];
}

// --- Event sources -----------------------------------------------------------
const POLL_MS = 5 * 60 * 1000;
function fold(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^#\s*/, "").trim();
}
const EXT = {
  pdf: [".pdf"],
  hoja: [".xlsx", ".xls", ".csv", ".ods", ".numbers"],
  imagen: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic", ".bmp"],
};
const clip = (s, n = 300) => String(s ?? "").slice(0, n);

/**
 * Watches rooms, local folders and connector accounts and hands matching events
 * to `enqueue(ruleId, event)`. It never fabricates events: when a source cannot be
 * observed the rule is marked blocked with the reason.
 */
export class TriggerEngine {
  constructor({ store, connections = null, enqueue, pollMs = POLL_MS, fetchPage = webFetch, loopGuard = ROOM_LOOP_GUARD }) {
    this.store = store;
    this.loopGuard = new LoopGuard(loopGuard); // room rules woken by bot messages
    this.connections = connections;
    this.enqueue = enqueue;
    this.pollMs = pollMs;
    this.fetchPage = fetchPage; // tests inject a reader for a local server; production only reads public pages
    this.watchers = new Map();
    this.polling = new Set();
    this.listener = (change) => this.onChange(change);
  }
  start() {
    this.store.listeners.add(this.listener);
    this.syncWatchers();
    this.pollTimer = setInterval(() => this.pollDue(), 30000);
    this.pollTimer.unref?.();
    setImmediate(() => this.pollDue());
  }
  stop() {
    this.store.listeners.delete(this.listener);
    clearInterval(this.pollTimer);
    clearTimeout(this.syncTimer);
    for (const w of this.watchers.values()) this.closeWatcher(w);
    this.watchers.clear();
  }
  rules(type) {
    return this.store.list("automations").filter((r) => r.enabled && r.trigger?.type === type);
  }
  block(rule, reason, by = "connector") {
    const current = this.store.get("automations", rule.id);
    if (!current || (current.blockedBy === by && current.error === reason)) return;
    this.store.patch("automations", rule.id, { blockedBy: by, state: "blocked", error: reason });
  }
  unblock(rule, by = "connector") {
    const current = this.store.get("automations", rule.id);
    if (current?.blockedBy === by) this.store.patch("automations", rule.id, { blockedBy: null, state: "scheduled", error: null });
  }
  onChange(change) {
    if (change?.type !== "record") return;
    if (change.kind === "messages" && change.op === "insert" && change.data)
      setImmediate(() => this.onMessage(change.data));
    if (change.kind === "folders" || change.kind === "automations") {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => this.syncWatchers(), 300);
      this.syncTimer.unref?.();
      if (change.kind === "automations" && change.op === "insert") setImmediate(() => this.pollDue());
    }
  }
  /** Sala: a user (or bot) message in the configured room. */
  onMessage(message) {
    if (!message.missionId || !["user", "assistant"].includes(message.role) || ["activity", "plan"].includes(message.kind)) return;
    const mission = this.store.get("missions", message.missionId);
    if (!mission) return;
    const room = fold(mission.room || mission.title);
    for (const rule of this.rules("sala")) {
      const c = rule.trigger.config;
      if (mission.automationId === rule.id) continue; // its own runs never retrigger it
      if (message.botId && message.botId === rule.botId) continue;
      if (c.deQuien === "personas" && message.role !== "user") continue;
      if (c.sala === "cualquier sala" ? mission.conversation : fold(c.sala) !== room) continue;
      const body = fold(message.text);
      if (c.salaModo === "mencion") {
        const names = this.store.list("bots").map((b) => "@" + fold(b.name));
        if (!names.some((n) => body.includes(n))) continue;
      }
      if (c.salaModo === "palabras") {
        const words = String(c.palabras).split(",").map(fold).filter(Boolean);
        if (!words.length || !words.some((w) => body.includes(w))) continue;
      }
      // Bots answering bots (two room rules waking each other) rest a minute; a person's
      // message always goes through.
      if (message.role !== "user") {
        const verdict = this.loopGuard.hit("sala:" + rule.id);
        if (!verdict.ok) {
          if (verdict.fresh)
            postGuardNotice(this.store, {
              missionId: mission.id, key: "sala:" + rule.id + ":" + verdict.until,
              text: "Colmena ha frenado la automatización «" + rule.name + "» un minuto: se estaba activando sin parar con mensajes de bots. Tus mensajes la siguen activando.",
            });
          continue;
        }
      }
      this.enqueue(rule.id, {
        kind: "sala",
        id: message.id,
        at: message.at || now(),
        summary: "Mensaje en #" + (mission.room || mission.title),
        data: { sala: mission.room || mission.title, missionId: mission.id, de: message.role === "user" ? "persona" : message.botId, texto: clip(message.text, 2000) },
      });
    }
  }
  // Archivo: fs.watch on a folder registered in Ajustes › Este ordenador.
  folderFor(config) {
    const folders = this.store.list("folders");
    const wanted = fold(config.carpeta).replace(/\\/g, "/").replace(/\s*\/\s*/g, "/");
    return (
      (config.folderId && folders.find((f) => f.id === config.folderId)) ||
      folders.find((f) => [f.label, f.path].some((v) => fold(v).replace(/\\/g, "/").replace(/\s*\/\s*/g, "/") === wanted)) ||
      folders.find((f) => wanted && fold(f.path).replace(/\\/g, "/").endsWith("/" + wanted))
    );
  }
  syncWatchers() {
    const active = new Set();
    for (const rule of this.rules("archivo")) {
      const folder = this.folderFor(rule.trigger.config);
      if (!folder) {
        this.block(rule, "Añade la carpeta «" + (rule.trigger.config.carpeta || "elegida") + "» en Ajustes › Este ordenador para activar esta regla.", "folder");
        continue;
      }
      const signature = folder.path + "|" + JSON.stringify(rule.trigger.config);
      active.add(rule.id);
      const existing = this.watchers.get(rule.id);
      if (existing?.signature === signature) continue;
      if (existing) this.closeWatcher(existing);
      try {
        const entry = { signature, folder, seen: new Set(), timers: new Map() };
        entry.watcher = watch(folder.path, { recursive: !!rule.trigger.config.subcarpetas, persistent: false }, (_event, name) => {
          if (name) this.onFile(rule.id, entry, String(name));
        });
        entry.watcher.on("error", () => this.block(rule, "No puedo vigilar «" + folder.label + "». Comprueba que la carpeta sigue existiendo.", "folder"));
        this.watchers.set(rule.id, entry);
        this.unblock(rule, "folder");
      } catch {
        this.block(rule, "No puedo vigilar «" + folder.label + "». Comprueba que la carpeta sigue existiendo.", "folder");
      }
    }
    for (const [ruleId, entry] of this.watchers)
      if (!active.has(ruleId)) {
        this.closeWatcher(entry);
        this.watchers.delete(ruleId);
      }
  }
  closeWatcher(entry) {
    try {
      entry.watcher?.close();
    } catch {}
    for (const t of entry.timers.values()) clearTimeout(t);
  }
  onFile(ruleId, entry, name) {
    clearTimeout(entry.timers.get(name));
    const timer = setTimeout(async () => {
      entry.timers.delete(name);
      const rule = this.store.get("automations", ruleId);
      if (!rule?.enabled || rule.trigger?.type !== "archivo") return;
      const c = rule.trigger.config;
      const base = path.basename(name);
      if (base.startsWith(".") || base.startsWith("~$") || /\.(tmp|crdownload|part)$/i.test(base)) return;
      if (c.tipoArchivo !== "todo" && !EXT[c.tipoArchivo].includes(path.extname(base).toLowerCase())) return;
      if (c.nombre && !fold(base).includes(fold(c.nombre))) return;
      let info;
      try {
        info = await stat(path.join(entry.folder.path, name));
      } catch {
        return; // deleted or renamed away
      }
      if (!info.isFile() || entry.seen.has(name)) return;
      entry.seen.add(name);
      this.enqueue(ruleId, {
        kind: "archivo",
        id: name + ":" + info.mtimeMs,
        at: now(),
        summary: "Archivo nuevo: " + base,
        data: { carpeta: entry.folder.label, archivo: name.replace(/\\/g, "/"), bytes: info.size },
      });
    }, 1500);
    timer.unref?.();
    entry.timers.set(name, timer);
  }
  // Correo / evento / hoja: audited read tools of the connections service.
  pollDue(time = Date.now()) {
    for (const rule of this.rules("web")) {
      if (this.polling.has(rule.id)) continue;
      if (rule.lastPollAt && time - Date.parse(rule.lastPollAt) < webDelay(rule.trigger.config, rule.webFailures || 0)) continue;
      this.polling.add(rule.id);
      this.checkWeb(rule, time)
        .catch((error) => console.warn("Disparador web " + rule.id + ": " + error.message))
        .finally(() => this.polling.delete(rule.id));
    }
    for (const type of Object.keys(CONNECTOR_OF))
      for (const rule of this.rules(type)) {
        if (this.polling.has(rule.id)) continue;
        if (rule.lastPollAt && time - Date.parse(rule.lastPollAt) < this.pollMs) continue;
        this.polling.add(rule.id);
        this.poll(rule)
          .catch((error) => this.block(rule, "No se pudo comprobar la regla: " + error.message))
          .finally(() => this.polling.delete(rule.id));
      }
  }
  async account(connector) {
    const accounts = (await this.connections.call("accounts", { cursor: "" }))?.items || [];
    return accounts.filter((a) => a.status === "ACTIVE" && TOOLKITS[connector].includes(String(a.toolkit).toLowerCase()));
  }
  async read(rule, tool, account, args) {
    const p = await this.connections.call("prepare", { tool, account: account.id, arguments_json: JSON.stringify(args), scope: "automation:" + rule.id });
    if (!p.read_scope || !this.store.get("connectionGrants", p.read_grant)?.active) {
      await this.connections.call("discard", { proposal: p.proposal });
      return null;
    }
    const result = await this.connections.call("commit", { proposal: p.proposal });
    if (!result?.ok) throw Error(result?.error || "La lectura no se confirmó.");
    return result.data || {};
  }
  async poll(rule) {
    const connector = CONNECTOR_OF[rule.trigger.type];
    const name = CONNECTOR_NAMES[connector];
    this.store.patch("automations", rule.id, { lastPollAt: now() });
    if (!this.connections) return this.block(rule, "El servicio de conexiones no está disponible; no puedo vigilar " + name + ".");
    let accounts;
    try {
      accounts = await this.account(connector);
    } catch {
      return this.block(rule, "El servicio de conexiones no está disponible; no puedo vigilar " + name + ".");
    }
    if (!accounts.length) return this.block(rule, "Conecta " + name + " en Ajustes para activar esta regla.");
    const permission = "Para vigilar " + name + " sin preguntarte cada vez, aprueba una lectura de " + name + " marcando «Recordar este permiso». Mientras tanto la regla no se dispara.";
    if (rule.trigger.type === "hoja")
      return this.block(rule, "Hojas de cálculo está conectada, pero Colmena aún no tiene una lectura auditada de hojas; esta regla no puede vigilarla todavía.");
    if (rule.trigger.type === "correo") {
      const c = rule.trigger.config;
      const account = accounts.find((a) => a.toolkit === "gmail" && c.buzon && fold(a.alias) === fold(c.buzon)) || accounts.find((a) => a.toolkit === "gmail");
      if (!account) return this.block(rule, "Solo puedo vigilar el correo de Gmail por ahora. Conecta una cuenta de Gmail en Ajustes.");
      const query = ["newer_than:2d", c.deModo === "algunos" && c.remitentes.length ? "from:(" + c.remitentes.join(" OR ") + ")" : "", c.asunto ? 'subject:"' + c.asunto.replace(/"/g, "") + '"' : "", c.adjuntos !== "igual" ? "has:attachment" : "", c.adjuntos === "pdf" ? "filename:pdf" : ""].filter(Boolean).join(" ");
      const data = await this.read(rule, "GMAIL_FETCH_EMAILS", account, { user_id: "me", query, max_results: 10 });
      if (!data) return this.block(rule, permission);
      const messages = data.messages || data.data?.messages || [];
      return this.observe(rule, messages.map((m) => ({
        kind: "correo",
        id: String(m.messageId || m.id || ""),
        at: m.messageTimestamp || now(),
        summary: "Correo: " + clip(m.subject, 120),
        data: { de: clip(m.sender || m.from), asunto: clip(m.subject), adjuntos: (m.attachmentList || []).map((a) => clip(a.filename, 200)).slice(0, 10), extracto: clip(m.preview?.body || m.messageText, 1500) },
      })).filter((e) => e.id));
    }
    // evento
    const c = rule.trigger.config;
    const account = accounts.find((a) => a.toolkit === "googlecalendar");
    if (!account) return this.block(rule, "Solo puedo vigilar Calendario de Google por ahora. Conecta una cuenta de Google Calendar en Ajustes.");
    let calendarId = "primary";
    if (c.calendario !== "personal") {
      const list = await this.read(rule, "GOOGLECALENDAR_LIST_CALENDARS", account, {});
      if (!list) return this.block(rule, permission);
      const words = c.calendario.includes("sala") ? ["sala", "reunion", "room"] : ["equipo", "team"];
      const found = (list.items || list.calendars || list.data?.items || []).find((x) => words.some((w) => fold(x.summary).includes(w)));
      if (!found) return this.block(rule, "No encuentro el calendario " + c.calendario + " en tu cuenta conectada. Elige «Tu calendario» o crea ese calendario.");
      calendarId = found.id;
    }
    const lead = Number(c.antelacion) * { minutos: 60000, horas: 3600000, "días": 86400000 }[c.unidad];
    const time = Date.now();
    const data = await this.read(rule, "GOOGLECALENDAR_EVENTS_LIST", account, {
      calendarId, timeMin: new Date(time).toISOString(), timeMax: new Date(time + lead + this.pollMs * 2).toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 25,
    });
    if (!data) return this.block(rule, permission);
    const events = (data.items || data.events || data.data?.items || []).filter((e) => {
      const start = Date.parse(e.start?.dateTime || "");
      if (!start || start - lead > time || start <= time) return false;
      const fire = new Date(start - lead);
      if (c.laboral && (fire.getDay() === 0 || fire.getDay() === 6 || fire.getHours() < 8 || fire.getHours() >= 19)) return false;
      if (c.eventoFiltro === "palabra" && !fold(e.summary).includes(fold(c.eventoPalabra))) return false;
      if (c.eventoFiltro === "fuera") {
        const domain = String(e.organizer?.email || "").split("@")[1];
        if (!(e.attendees || []).some((a) => String(a.email || "").split("@")[1] !== domain)) return false;
      }
      return true;
    });
    return this.observe(rule, events.map((e) => ({
      kind: "evento",
      id: String(e.id),
      at: e.start.dateTime,
      summary: "Evento: " + clip(e.summary, 120),
      data: { titulo: clip(e.summary), empieza: e.start.dateTime, asistentes: (e.attendees || []).length },
    })), { baseline: false });
  }
  /**
   * Web (OpenMuse Monitor + page-diff): reads the public page, compares normalised lines
   * with the previous check and enqueues one event with the summary of the change. The
   * first check only records the page. Failures back off exponentially; after 5 in a row
   * the rule pauses itself with the reason.
   */
  async checkWeb(rule, time = Date.now()) {
    const c = rule.trigger.config;
    const domain = webDomain(c.url);
    this.store.patch("automations", rule.id, { lastPollAt: new Date(time).toISOString() });
    let page;
    try {
      page = await this.fetchPage(c.url);
    } catch (error) {
      const current = this.store.get("automations", rule.id);
      if (!current) return;
      const failures = (current.webFailures || 0) + 1;
      const reason = error?.message || "no se pudo leer la página";
      if (failures >= WEB_MAX_FAILURES)
        return this.store.patch("automations", rule.id, {
          webFailures: failures, enabled: false, autoPaused: true, state: "paused", lastStatus: "failed",
          error: "Pausada tras " + failures + " fallos seguidos al leer " + domain + ": " + reason + " Revisa la dirección y vuelve a activarla.",
        });
      return this.store.patch("automations", rule.id, {
        webFailures: failures,
        error: "No se pudo leer " + domain + " (" + failures + " de " + WEB_MAX_FAILURES + "): " + reason + " Se volverá a intentar más tarde.",
      });
    }
    const current = this.store.get("automations", rule.id);
    if (!current) return;
    const lines = pageLines(page.text);
    const hash = createHash("sha256").update(lines.map(withoutRelativeTimes).join("\n")).digest("hex");
    const price = c.condicion === "precio_bajo" ? findPrice(lines, c.texto) : null;
    const contains = c.condicion === "contiene" ? fold(page.text).includes(fold(c.texto)) : null;
    const previous = this.store.get("webSnapshots", rule.id);
    const title = String(page.title || "").slice(0, 200);
    const base = { url: page.finalUrl || c.url, titulo: title || domain };
    let event = null;
    if (previous) {
      if (c.condicion === "cambia" && previous.hash !== hash) {
        const diff = diffPage(previous.lines || [], lines);
        const count = countPageDiff(diff);
        if (count) event = { summary: "Cambió " + domain + ": " + count, data: { ...base, cambios: describePageDiff(diff) } };
      } else if (c.condicion === "contiene" && contains && !previous.contains) {
        event = { summary: "Ya aparece «" + c.texto + "» en " + domain, data: { ...base, texto: c.texto } };
      } else if (c.condicion === "precio_bajo" && price != null && price < Number(c.precio) && !(previous.price != null && previous.price < Number(c.precio))) {
        event = { summary: "El precio en " + domain + " ha bajado a " + euros(price) + " (límite " + euros(c.precio) + ")", data: { ...base, precio: price, antes: previous.price ?? null, limite: Number(c.precio) } };
      }
    }
    const checkedAt = new Date(time).toISOString();
    this.store.put("webSnapshots", { id: rule.id, url: c.url, lines: lines.slice(0, 400), hash, price, contains, title, checkedAt });
    const baseline = previous ? null : { kind: "web", id: "web:" + hash.slice(0, 16) + ":" + checkedAt, at: checkedAt, summary: "Así está ahora " + domain, data: { ...base, extracto: String(page.text || "").slice(0, 600) } };
    this.store.patch("automations", rule.id, {
      webHash: hash, webTitle: title || null, webCheckedAt: checkedAt, webPrice: price, webFailures: 0, autoPaused: false,
      ...(current.error && /^No se pudo leer /.test(current.error) ? { error: null } : {}),
      ...(baseline ? { lastEvent: baseline, baselineAt: checkedAt } : {}),
    });
    if (event) this.enqueue(rule.id, { kind: "web", id: "web:" + hash.slice(0, 16) + ":" + checkedAt, at: checkedAt, ...event });
    return event;
  }
  /** First poll only records what exists (a new rule never fires on old mail). */
  observe(rule, events, { baseline = true } = {}) {
    const current = this.store.get("automations", rule.id);
    if (!current) return;
    const seen = new Set(current.seen || []);
    const first = baseline && !current.baselineAt;
    const fresh = events.filter((e) => !seen.has(e.id)).reverse();
    for (const e of events) seen.add(e.id);
    this.store.patch("automations", rule.id, {
      seen: [...seen].slice(-300),
      baselineAt: current.baselineAt || now(),
      ...(current.blockedBy === "connector" ? { blockedBy: null, state: "scheduled", error: null } : {}),
      ...(first && events[0] ? { lastEvent: events[0] } : {}),
    });
    if (!first) for (const e of fresh.slice(-10)) this.enqueue(rule.id, e);
  }
}
