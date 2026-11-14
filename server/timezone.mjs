// Calendar arithmetic in a named time zone (docs/CLOUD.md › Phase 4 › Time zones).
//
// The desktop does its calendar arithmetic in the machine's local time (`new Date(y, m, d, h)`,
// `getHours()`), which is right there: the machine is the person's. In the cloud the machine is
// in UTC, so a company's routines carry an IANA zone instead (`settings.timezone`). `zoned(tz)`
// gives the same few operations either way:
//
//   Z.parts(date)              → {year, month (0-11), day, hours, minutes, seconds, weekday (0 = Sunday)}
//   Z.make(y, m, d, h, mi)     → the Date of that wall-clock time (fields overflow like Date's)
//   Z.ymd(date)                → "YYYY-MM-DD" of that instant's day in the zone
//
// With no zone (null, "", "local") it is exactly the local-time code the desktop always ran.
// With a zone, wall-clock times are resolved the way calendars do across DST changes: a time that
// does not exist (the spring-forward gap, 02:30 in Madrid on the last Sunday of March) moves
// forward by the gap (03:30); a time that happens twice (the autumn fall-back) is the first one.

const formatters = new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    if (formatters.size > 200) formatters.clear();
    formatters.set(tz, f);
  }
  return f;
}
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** True for a zone this runtime knows (IANA names such as "Europe/Madrid", or "UTC"). */
export function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A zone name worth storing, or null (local time). */
export function cleanTimeZone(tz) {
  if (tz == null || tz === "" || tz === "local") return null;
  return validTimeZone(tz) ? tz : null;
}

function zoneParts(tz, ms) {
  const out = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: Number(out.year), month: Number(out.month) - 1, day: Number(out.day),
    hours: Number(out.hour) % 24, minutes: Number(out.minute), seconds: Number(out.second), weekday: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** Milliseconds the zone is ahead of UTC at instant `ms` (Madrid in summer: +7,200,000). */
export function offsetAt(tz, ms) {
  const p = zoneParts(tz, ms);
  const wall = Date.UTC(p.year, p.month, p.day, p.hours, p.minutes, p.seconds);
  return wall - (Math.floor(ms / 1000) * 1000);
}

const pad = (n) => String(n).padStart(2, "0");

const LOCAL = Object.freeze({
  tz: null,
  parts(date) {
    const d = new Date(date);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds(), weekday: d.getDay() };
  },
  make(y, m, d, h = 0, mi = 0) { return new Date(y, m, d, h, mi, 0, 0); },
  ymd(date) { const p = LOCAL.parts(date); return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`; },
});

const zones = new Map();
/** The calendar of a zone (see the top of this file); local time without one. */
export function zoned(tz) {
  const name = cleanTimeZone(tz);
  if (!name) return LOCAL;
  let z = zones.get(name);
  if (z) return z;
  z = Object.freeze({
    tz: name,
    parts: (date) => zoneParts(name, new Date(date).getTime()),
    make(y, m, d, h = 0, mi = 0) {
      // The wall-clock time as if it were UTC, then the zone's offset taken off. Around a DST
      // change the offset before and after differ: each candidate is kept only if it really reads
      // as that wall time; none (a gap) → the offset from before the change, which moves it forward.
      const wall = Date.UTC(y, m, d, h, mi, 0, 0);
      const before = offsetAt(name, wall - 86400000), after = offsetAt(name, wall + 86400000);
      const fits = (t) => { const p = zoneParts(name, t); return Date.UTC(p.year, p.month, p.day, p.hours, p.minutes, 0, 0) === wall; };
      const found = [...new Set([before, after, offsetAt(name, wall)])].map((o) => wall - o).filter(fits).sort((a, b) => a - b);
      return new Date(found.length ? found[0] : wall - before);
    },
    ymd(date) { const p = zoneParts(name, new Date(date).getTime()); return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`; },
  });
  if (zones.size > 200) zones.clear();
  zones.set(name, z);
  return z;
}

/** «09:05» of an instant in a zone (local time without one). */
export function clockOf(date, tz = null) {
  const p = zoned(tz).parts(date);
  return pad(p.hours) + ":" + pad(p.minutes);
}

/** The zone a browser reports, when it is one this runtime knows; else null. */
export function browserTimeZone(value) {
  return cleanTimeZone(typeof value === "string" ? value.trim() : null);
}
