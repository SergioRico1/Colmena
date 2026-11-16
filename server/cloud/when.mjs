// «Cuándo», as people write it in Spanish (/recordar, scheduled messages): «en 20 minutos», «en 2
// horas», «mañana», «pasado mañana a las 18:30», «el viernes a las 9», «hoy a las 5 de la tarde»,
// «a las 17», «el 25/11 a las 10». Read in the person's time zone; a day without a time is 9:00.

const DAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** {y, mo, d, h, mi, wd} of `ms` on the wall clock of `tz` (UTC when unknown). */
export function wallClock(ms, tz) {
  let parts;
  const opts = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" };
  try { parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz || "UTC" }).formatToParts(new Date(ms)); }
  catch { parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).formatToParts(new Date(ms)); }
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), wd };
}

/** The instant a wall-clock time of `tz` stands for (the offset settled twice, for DST edges). */
export function fromWallClock({ y, mo, d, h = 9, mi = 0 }, tz) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let at = want;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(at, tz);
    at += want - Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  }
  return at;
}

const addDays = ({ y, mo, d }, n) => { const t = new Date(Date.UTC(y, mo - 1, d + n)); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

// «a las 9», «a las 9:30», «a las 5 de la tarde», «a las 21h».
const TIME = String.raw`(?:a\s+las?\s+)(\d{1,2})(?:[:.h](\d{2}))?\s*(?:h\b)?\s*(de\s+la\s+(?:manana|tarde|noche)|de\s+la\s+madrugada|am|pm)?`;
const DAY = String.raw`(hoy|manana|pasado\s+manana|(?:el\s+)?(?:proximo\s+)?(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado)|(?:el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)`;
const IN = String.raw`en\s+(\d{1,3}|un|una|media)\s*(minutos?|min|horas?|h|dias?|semanas?)`;
const EXPR = new RegExp(String.raw`^(?:${IN}|${DAY}(?:\s+${TIME})?|${TIME})`, "u");

function hourOf(h, mi, part) {
  let hour = Number(h);
  if (!(hour >= 0 && hour <= 23)) return null;
  const p = part || "";
  if ((/tarde|noche|pm/.test(p)) && hour < 12) hour += 12;
  if (/manana|madrugada|am/.test(p) && hour === 12) hour = 0;
  const minute = mi ? Number(mi) : 0;
  return minute >= 0 && minute < 60 ? { h: hour, mi: minute } : null;
}

/** One «cuándo» at the start of `folded` text → {at, used} (characters read), or null. */
function readAt(folded, now, tz) {
  const m = EXPR.exec(folded);
  if (!m) return null;
  const [all, n, unit, day, dd, mm, yy, h1, mi1, part1, h2, mi2, part2] = m;
  if (n) {
    const count = n === "media" ? 0.5 : n === "un" || n === "una" ? 1 : Number(n);
    const ms = /^min/.test(unit) ? 60000 : /^h/.test(unit) ? 3600000 : /^d/.test(unit) ? 86400000 : 7 * 86400000;
    if (!(count > 0)) return null;
    return { at: now + Math.round(count * ms), used: all.length };
  }
  const today = wallClock(now, tz);
  let date = { y: today.y, mo: today.mo, d: today.d };
  const time = h1 != null ? hourOf(h1, mi1, part1) : h2 != null ? hourOf(h2, mi2, part2) : null;
  if ((h1 != null || h2 != null) && !time) return null;
  if (day) {
    const word = day.replace(/^el\s+/, "").replace(/^proximo\s+/, "");
    if (word === "hoy") { /* today */ }
    else if (word === "manana") date = addDays(date, 1);
    else if (/^pasado/.test(word)) date = addDays(date, 2);
    else if (dd) {
      const year = yy ? (yy.length === 2 ? 2000 + Number(yy) : Number(yy)) : today.y;
      date = { y: year, mo: Number(mm), d: Number(dd) };
      if (!(date.mo >= 1 && date.mo <= 12 && date.d >= 1 && date.d <= 31)) return null;
      // «el 3/1» said in December is next year's.
      if (!yy && fromWallClock({ ...date, h: 23, mi: 59 }, tz) < now) date.y += 1;
    } else {
      const wd = DAYS.indexOf(word);
      let ahead = (wd - today.wd + 7) % 7;
      if (ahead === 0) ahead = 7; // «el lunes» said on a Monday is next week's
      date = addDays(date, ahead);
    }
  }
  const at = fromWallClock({ ...date, ...(time || { h: 9, mi: 0 }) }, tz);
  // «a las 9» alone, already past today: tomorrow at 9.
  if (!day && at <= now) return { at: fromWallClock({ ...addDays(date, 1), ...time }, tz), used: all.length };
  return { at, used: all.length };
}

/**
 * The «cuándo» at the start or at the end of `text` → {at, rest} (what is left, trimmed), or null.
 * Only times still to come count.
 */
export function parseWhen(text, { now = Date.now(), tz = null } = {}) {
  const raw = String(text || "").trim();
  const folded = fold(raw);
  // Folding keeps the length (NFD then marks removed would not): map positions on the folded text.
  const plain = folded.length === raw.length ? folded : null;
  const cut = (from, to) => (plain ? raw.slice(from, to) : folded.slice(from, to));
  const head = readAt(folded, now, tz);
  if (head && head.at > now) return { at: head.at, rest: cut(head.used).replace(/^[\s,:;-]+/, "").trim() };
  // At the end: try every word boundary from the left, the longest «cuándo» that reaches the end.
  const starts = [...folded.matchAll(/(?:^|\s)(?=\S)/g)].map((m) => m.index + m[0].length);
  for (const i of starts) {
    if (i === 0) continue;
    const tail = folded.slice(i);
    const found = readAt(tail, now, tz);
    if (found && found.used === tail.trimEnd().length && found.at > now) return { at: found.at, rest: cut(0, i).replace(/[\s,:;-]+$/, "").trim() };
  }
  return null;
}

/** «el martes 25 a las 9:00», «mañana a las 18:30», «hoy a las 17:00» on the wall clock of `tz`. */
export function whenLabel(at, { now = Date.now(), tz = null } = {}) {
  const w = wallClock(at, tz), t = wallClock(now, tz);
  const hm = String(w.h).padStart(2, "0") + ":" + String(w.mi).padStart(2, "0");
  const days = Math.round((Date.UTC(w.y, w.mo - 1, w.d) - Date.UTC(t.y, t.mo - 1, t.d)) / 86400000);
  const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const day = days === 0 ? "hoy" : days === 1 ? "mañana" : days > 1 && days < 7 ? "el " + DAY_NAMES[w.wd] : "el " + DAY_NAMES[w.wd] + " " + w.d + " de " + MONTHS[w.mo - 1];
  return day + " a las " + hm;
}
