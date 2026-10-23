// The calendar as «Personas» uses it (phase 3): busy blocks and nothing else. The code reads
// the events and keeps only start and end, rounded out to 15 minutes; titles, places, people
// and notes never leave this function. Writing is one thing only: an event in your own
// calendar, with no guests (nobody gets an invitation by mail).

const QUARTER = 15 * 60000;
const listOf = (data) => [data?.items, data?.events, data?.data?.items, data?.data?.events, data?.response_data?.items].find(Array.isArray) || [];

/** Overlapping or touching blocks merged, sorted. */
export function mergeBlocks(blocks) {
  const sorted = blocks.map((b) => ({ s: Date.parse(b.s), e: Date.parse(b.e) })).filter((b) => b.e > b.s).sort((a, b) => a.s - b.s);
  const out = [];
  for (const b of sorted) {
    const last = out.at(-1);
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e);
    else out.push({ ...b });
  }
  return out.map((b) => ({ s: new Date(b.s).toISOString(), e: new Date(b.e).toISOString() }));
}

/** Calendar events → busy blocks inside [from, to): only times, rounded out to 15 min. */
export function busyFromEvents(events, from, to) {
  const lo = Date.parse(from), hi = Date.parse(to);
  const blocks = [];
  for (const e of events) {
    if (!e || e.status === "cancelled" || e.transparency === "transparent") continue;
    // An all-day event only counts when it says busy (holidays and reminders do not).
    const allDay = !e.start?.dateTime && e.start?.date;
    if (allDay && e.transparency !== "opaque" && e.eventType !== "outOfOffice") continue;
    const s = Date.parse(e.start?.dateTime || e.start?.date || "");
    const end = Date.parse(e.end?.dateTime || e.end?.date || "");
    if (!Number.isFinite(s) || !Number.isFinite(end) || end <= lo || s >= hi) continue;
    blocks.push({ s: new Date(Math.floor(Math.max(s, lo) / QUARTER) * QUARTER).toISOString(), e: new Date(Math.ceil(Math.min(end, hi) / QUARTER) * QUARTER).toISOString() });
  }
  return mergeBlocks(blocks);
}

/** Local "HH:MM" on the day of `dayMs` (this computer's time zone) → ms. */
const at = (dayMs, hhmm) => {
  const d = new Date(dayMs);
  const [h, m] = String(hhmm).split(":").map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
};

/**
 * Up to `count` slots of `minutes` inside the window, on weekdays between dayStart and dayEnd,
 * that touch nobody's busy block. One per day first (choice), the calmest one marked.
 */
export function freeSlots({ from, to, dayStart = "09:00", dayEnd = "18:00", minutes = 45, busy = [], count = 3, exclude = [], now = Date.now(), step = 15 }) {
  const blocks = mergeBlocks(busy).map((b) => ({ s: Date.parse(b.s), e: Date.parse(b.e) }));
  const skip = new Set(exclude.map((x) => Date.parse(x.s)));
  const len = minutes * 60000;
  const all = [];
  const start = new Date(Date.parse(from));
  start.setHours(0, 0, 0, 0);
  // Calendar days (setDate), not 24-hour steps: the clocks change twice a year.
  for (let day = start.getTime(); day < Date.parse(to); day = new Date(new Date(day).setDate(new Date(day).getDate() + 1)).getTime()) {
    const wd = new Date(day).getDay();
    if (wd === 0 || wd === 6) continue;
    const open = at(day, dayStart), close = at(day, dayEnd);
    for (let s = open; s + len <= close; s += step * 60000) {
      const e = s + len;
      if (s < now + 3600000 || s < Date.parse(from) || e > Date.parse(to) || skip.has(s)) continue;
      if (blocks.some((b) => s < b.e && e > b.s)) continue;
      // Calm: minutes to the nearest busy block (or to the edge of the day).
      const gap = Math.min(...blocks.map((b) => (b.e <= s ? s - b.e : b.s >= e ? b.s - e : 0)), s - open + (close - e) + 86400000) / 60000;
      all.push({ s, e, day, gap });
    }
  }
  const chosen = [];
  for (const slot of all) if (chosen.length < count && !chosen.some((c) => c.day === slot.day)) chosen.push(slot);
  // Fewer days than slots: more on the same day, but a real alternative (90 minutes apart).
  for (const slot of all) if (chosen.length < count && !chosen.some((c) => Math.abs(c.s - slot.s) < 90 * 60000)) chosen.push(slot);
  chosen.sort((a, b) => a.s - b.s);
  const calmest = chosen.reduce((best, x) => (!best || x.gap > best.gap ? x : best), null);
  return chosen.map((x) => ({ s: new Date(x.s).toISOString(), e: new Date(x.e).toISOString(), ...(x === calmest && chosen.length > 1 ? { calm: true } : {}) }));
}

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid"; } catch { return "Europe/Madrid"; } };
const localIso = (ms) => {
  const d = new Date(ms), off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-", pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(off / 60)}:${pad(off % 60)}`;
};

/** Your Google Calendar through the connections (Composio): busy blocks and one plain event. */
export function connectedCalendar(connections) {
  const account = async () => {
    if (!connections?.call) return null;
    const items = (await connections.call("accounts", { cursor: "" }).catch(() => null))?.items || [];
    return items.find((a) => a.status === "ACTIVE" && String(a.toolkit).toLowerCase() === "googlecalendar") || null;
  };
  const fit = async (tool, args) => {
    const schema = await connections.call("describe", { tool }).catch(() => null);
    const known = schema?.input_schema?.properties;
    return known ? Object.fromEntries(Object.entries(args).filter(([k]) => k in known)) : args;
  };
  return {
    async busy(from, to) {
      const acc = await account();
      if (!acc) return { calendar: false, blocks: [] };
      const args = await fit("GOOGLECALENDAR_EVENTS_LIST", { calendarId: "primary", timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 250 });
      const p = await connections.call("prepare", { tool: "GOOGLECALENDAR_EVENTS_LIST", account: acc.id, arguments_json: JSON.stringify(args), scope: "peers-meeting" });
      if (!p?.read_scope) {
        if (p?.proposal) await connections.call("discard", { proposal: p.proposal }).catch(() => null);
        throw Error("La agenda no ofrece una lectura segura.");
      }
      const result = await connections.call("commit", { proposal: p.proposal });
      if (!result?.ok) throw Error(result?.error || "La agenda no respondió.");
      return { calendar: true, blocks: busyFromEvents(listOf(result.data), from, to) };
    },
    /** An event in your own calendar, with no guests. → {ok, created} */
    async create({ title, start, minutes, description }) {
      const acc = await account();
      if (!acc) return { ok: false, calendar: false };
      const args = await fit("GOOGLECALENDAR_CREATE_EVENT", {
        summary: String(title).slice(0, 200), description: String(description || "").slice(0, 1000), start_datetime: localIso(Date.parse(start)),
        event_duration_hour: Math.floor(minutes / 60), event_duration_minutes: minutes % 60, timezone: zone(), calendar_id: "primary",
      });
      const p = await connections.call("prepare", { tool: "GOOGLECALENDAR_CREATE_EVENT", account: acc.id, arguments_json: JSON.stringify(args), scope: "peers-meeting" });
      const sent = p?.arguments || {};
      if (!p?.proposal || ["attendees", "attendee_emails", "guests"].some((k) => Array.isArray(sent[k]) ? sent[k].length : sent[k])) {
        if (p?.proposal) await connections.call("discard", { proposal: p.proposal }).catch(() => null);
        throw Error("El evento llevaría invitados: no lo creo.");
      }
      const result = await connections.call("commit", { proposal: p.proposal });
      return { ok: !!result?.ok, calendar: true, error: result?.ok ? null : result?.error || null };
    },
  };
}
