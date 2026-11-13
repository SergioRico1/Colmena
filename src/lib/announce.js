// What a conversation says to a screen reader, as pure functions (the hook that feeds the
// live region is lib/useAnnouncer.js). One polite line per finished message, never per
// streamed token; several arrivals in the same moment are said as one count; something that
// starts waiting for the person is said by name; the person's own messages say nothing.

import { listNames as list } from "./identity.js";

const MAX = 120;

/** Text as it should be spoken: no Markdown marks, one line, cut at a word near `max`. */
export function spoken(text, max = MAX) {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " (código) ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : plain.slice(0, max)).replace(/[\s,;:.]+$/, "") + "…";
}

const unique = (names) => [...new Set(names.filter(Boolean))];

/**
 * The line to say. `items`: finished messages from someone else, { name, text }.
 * `waiting`: what has just started waiting for the person, { name, kind }.
 */
export function announcement(items = [], waiting = []) {
  const parts = [];
  if (items.length === 1) {
    const { name, text } = items[0];
    const said = spoken(text);
    parts.push(said ? `${name || "Alguien"}: ${said}` : `Mensaje nuevo de ${name || "alguien"}`);
  } else if (items.length > 1) {
    const who = unique(items.map((m) => m.name));
    parts.push(`${items.length} mensajes nuevos` + (who.length ? " de " + list(who.slice(0, 3)) + (who.length > 3 ? " y más" : "") : ""));
  }
  if (waiting.length === 1) {
    const { name, kind } = waiting[0];
    parts.push(!name ? "Algo espera tu OK" : kind === "question" ? `${name} te pregunta algo` : `${name} espera tu OK`);
  } else if (waiting.length > 1) {
    const who = unique(waiting.map((w) => w.name));
    parts.push(who.length === 1 ? `${who[0]} espera tu OK en ${waiting.length} cosas` : who.length === 2 && waiting.length === 2 ? `${list(who)} esperan tu OK` : `${waiting.length} cosas esperan tu OK`);
  }
  return parts.join(". ");
}

/**
 * Which entries are new since the last look. `seen` (a Set) is updated in place. An entry
 * is { id, done, skip }: one that is still being written (`done: false`) is not marked, so
 * it is said once, when it ends; a skipped one (yours, a system line) is marked and never said.
 * Entries come in the order they are shown: only what sits after the last one already known
 * is news. What appears before it is history (an older page being loaded) and is marked
 * without a word.
 */
export function fresh(seen, entries = []) {
  const out = [];
  let lastKnown = -1;
  entries.forEach((e, i) => { if (e && seen.has(e.id)) lastKnown = i; });
  entries.forEach((e, i) => {
    if (!e || e.id === undefined || e.id === null || seen.has(e.id)) return;
    if (i < lastKnown) { seen.add(e.id); return; }
    if (e.done === false) return;
    seen.add(e.id);
    if (!e.skip) out.push(e);
  });
  return out;
}

/**
 * Batches what arrives within `delay` ms into one line. `say(line)` gets the text;
 * `timers` lets a test drive the clock.
 */
export function createAnnouncer({ say, delay = 1200, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) } }) {
  let items = [], waiting = [], timer = null;
  const flush = () => {
    if (timer !== null) { timers.clear(timer); timer = null; }
    const line = announcement(items, waiting);
    items = []; waiting = [];
    if (line) say(line);
  };
  return {
    add(newItems = [], newWaiting = []) {
      if (!newItems.length && !newWaiting.length) return;
      items.push(...newItems); waiting.push(...newWaiting);
      if (timer !== null) timers.clear(timer);
      timer = timers.set(flush, delay);
    },
    flush,
    cancel() { if (timer !== null) timers.clear(timer); timer = null; items = []; waiting = []; },
    get pending() { return items.length + waiting.length; },
  };
}
