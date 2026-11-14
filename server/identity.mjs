// Who is acting (docs/CLOUD.md › Phase 1 › Identity). The desktop has one person, always the
// same: DESKTOP_PERSON, and nothing here changes what it does. The hosted build runs every
// request, socket message and alarm as the person behind it (asPerson), and gives its store
// `personal` fields: the parts of a record that belong to each person (what they have read),
// kept per person inside the same record.
import { AsyncLocalStorage } from "node:async_hooks";

/** The one person of a desktop Colmena: what every record written without a person means. */
export const DESKTOP_PERSON = Object.freeze({ id: "me", name: null, email: null, role: "owner", desktop: true });
/** Background work of a hosted workspace (alarms, upkeep): nobody in particular. */
export const SYSTEM_PERSON = Object.freeze({ id: null, name: "Colmena", email: null, role: "system", system: true });
export const ROLES = Object.freeze(["owner", "admin", "member", "guest"]);

const context = new AsyncLocalStorage();

/** The person this code runs for: the hosted request's, else the desktop's. */
export function currentPerson() {
  return context.getStore() || DESKTOP_PERSON;
}

/** Runs `fn` (and everything it starts: awaits, timers) as `person` ({id, name, email, role}). */
export function asPerson(person, fn) {
  if (!person || (typeof person.id !== "string" && !person.system)) throw Error("Persona no válida.");
  return context.run(Object.freeze({ ...person }), fn);
}

/** A real signed-in person (not the desktop one, not background work). */
export const isPerson = (p = currentPerson()) => !!p && !p.desktop && !p.system && typeof p.id === "string";

/** How a person reads as an author address in rooms (server/room.mjs): never a mailbox address. */
export const personAddress = (id) => "u:" + id;

/**
 * A message's author for the screens (src/lib/roomView.js authorOf takes `author.kind` as is):
 * someone else by name, you as «Tú». Only hosted messages carry `by`.
 */
export function authorView(by, me = currentPerson()) {
  if (!by?.id) return null;
  const you = by.id === me?.id;
  return { kind: "person", address: personAddress(by.id), name: you ? "Tú" : String(by.name || "Alguien").slice(0, 80), you };
}

/**
 * The store's per-person fields (Store#personal), for a hosted workspace only:
 *  - notifications `read` / `readAt` → `readBy` {personId: at};
 *  - rooms `seenAt` → `seenBy` {personId: at};
 *  - a person's message (role "user") gets `by` {id, name}: who wrote it;
 *  - an approval decided by a person gets `decidedBy` {id, name}.
 * Read as a person, a record shows that person's values; read by background work, the stored
 * ones (what nobody in particular did). `before` is the stored record (null when new).
 */
export function personalFields({ person = currentPerson } = {}) {
  const PER_PERSON = {
    notifications: { map: "readBy", flag: "read", at: "readAt" },
    rooms: { map: "seenBy", at: "seenAt" },
  };
  return {
    read(kind, record) {
      const spec = PER_PERSON[kind];
      const p = person();
      if (!spec || !isPerson(p) || !record) return record;
      const at = record[spec.map]?.[p.id] || null;
      if (spec.flag) {
        record[spec.flag] = !!at || record[spec.flag] === true;
        record[spec.at] = at || (record[spec.flag] ? record[spec.at] || null : null);
      } else record[spec.at] = at;
      return record;
    },
    write(kind, record, before) {
      const p = person();
      if (!isPerson(p)) return record;
      if (kind === "messages" && record.role === "user" && !record.by && !record.author && !record.origin && !before)
        return { ...record, by: { id: p.id, name: String(p.name || p.email || "Alguien").slice(0, 80) } };
      if (kind === "approvals" && record.status && record.status !== "pending" && before?.status === "pending" && !record.decidedBy)
        return { ...record, decidedBy: { id: p.id, name: String(p.name || p.email || "Alguien").slice(0, 80) } };
      const spec = PER_PERSON[kind];
      if (!spec) return record;
      const map = { ...(before?.[spec.map] || record[spec.map] || {}) };
      const mine = spec.flag ? (record[spec.flag] ? record[spec.at] || new Date().toISOString() : null) : record[spec.at] || null;
      if (mine) map[p.id] = mine;
      else delete map[p.id];
      const out = { ...record, [spec.map]: map };
      // What was stored for everyone stays as it was: a person's view never becomes everyone's.
      if (spec.flag) {
        out[spec.flag] = before ? before[spec.flag] === true : false;
        out[spec.at] = before ? before[spec.at] ?? null : null;
      } else out[spec.at] = before ? before[spec.at] ?? null : null;
      return out;
    },
  };
}
