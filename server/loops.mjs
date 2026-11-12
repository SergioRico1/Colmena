// Bot loop protection (OpenClaw «loop detection» / max ping-pong turns): two bots answering
// each other without end burn the person's plan for nothing. Bot-to-bot exchanges (ask_bot,
// delegation) and room automations woken by bot messages are counted per pair in a sliding
// window; past the limit that pair is silenced for a minute and the room says so once.
// The person's own messages are never counted nor held back. What a routine or a trigger wrote
// (stored as «user», marked with its origin: origin.mjs) is not the person: it is counted.
// Work that starts by itself has its own, longer brakes on top of this one (brakes.mjs): the
// same thing more than 3 times a day, rules that fire each other, digests and proposals.
import { now } from "./store.mjs";

export const LOOP_GUARD = Object.freeze({ windowMs: 10 * 60000, limit: 6, cooldownMs: 60000 });
/** Room automations woken by bot messages: a lower limit, they start a whole run each time. */
export const ROOM_LOOP_GUARD = Object.freeze({ windowMs: 10 * 60000, limit: 3, cooldownMs: 60000 });

export class LoopGuard {
  constructor({ windowMs, limit, cooldownMs } = LOOP_GUARD, clock = Date.now) {
    Object.assign(this, { windowMs, limit, cooldownMs, clock });
    this.hits = new Map(); // key → timestamps inside the window
    this.silenced = new Map(); // key → until (ms)
  }
  /**
   * Counts one exchange for `key`. Returns { ok: true } or, when the pair is silenced,
   * { ok: false, until, fresh } — `fresh` only on the call that started the silence, so the
   * room notice is written once.
   */
  hit(key) {
    const t = this.clock();
    const until = this.silenced.get(key) || 0;
    if (until > t) return { ok: false, until, fresh: false };
    if (until) this.silenced.delete(key);
    const recent = (this.hits.get(key) || []).filter((at) => t - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, []);
      const next = t + this.cooldownMs;
      this.silenced.set(key, next);
      return { ok: false, until: next, fresh: true };
    }
    recent.push(t);
    this.hits.set(key, recent);
    // Forget idle keys so the map does not grow with every mission.
    if (this.hits.size > 500) for (const [k, list] of this.hits) if (!list.some((at) => t - at < this.windowMs)) this.hits.delete(k);
    return { ok: true };
  }
  reset(key) {
    this.hits.delete(key);
    this.silenced.delete(key);
  }
}

export const pairKey = (missionId, a, b) => missionId + ":" + [a, b].sort().join("|");

// ------------------------------------------------------- repeated tool calls
// The same tool with the same arguments again and again in one step (DeepSeek Harness
// repeat-tool-reminder): at these counts the result carries a reminder. Never blocks; a new
// message of the person starts the count again.
export const REPEAT_REMINDERS = Object.freeze([3, 5, 8]);

/** Stable key of a call: tool name + its arguments with sorted keys. */
export function callKey(name, args) {
  let value = args;
  if (typeof args === "string") try { value = JSON.parse(args); } catch {}
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  return name + "\u0000" + JSON.stringify(sorted(value) ?? null);
}

/**
 * Counts this call in `state` ({since, counts}) and returns {state, count, reminder|null}.
 * `personAt`: the time of the person's latest message; newer than `since` resets the count.
 */
export function countRepeat(state, key, { personAt = null } = {}) {
  const fresh = !state || (personAt && (!state.since || personAt > state.since));
  const counts = fresh ? {} : { ...(state.counts || {}) };
  const count = (counts[key] || 0) + 1;
  counts[key] = count;
  // Keep the record small: the 60 most recent keys.
  const keys = Object.keys(counts);
  if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete counts[k];
  return { state: { since: fresh ? personAt || state?.since || null : state.since, counts }, count, reminder: REPEAT_REMINDERS.includes(count) ? repeatReminder(count) : null };
}

export const repeatReminder = (count) =>
  `Aviso de Colmena: es la ${count}.ª vez en este paso que llamas a esta herramienta con exactamente los mismos argumentos. ` +
  (count >= 8 ? "Repetirlo no va a cambiar el resultado: para, cambia de enfoque (otra herramienta, otros argumentos) o explica a la persona qué te falta." :
    count >= 5 ? "Te estás repitiendo: no lo vuelvas a llamar igual; usa lo que ya tienes o prueba otro camino." :
      "Si ya tienes la respuesta, úsala; si no, cambia de enfoque en vez de repetir lo mismo.");

/** The result with the reminder attached (objects keep their shape; anything else is wrapped). */
export function withReminder(result, reminder) {
  if (!reminder || result?.waiting) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) return { ...result, aviso_repeticion: reminder };
  return { resultado: result, aviso_repeticion: reminder };
}

/** One quiet line in the room: «Colmena frenó a Atlas y Nora…». */
export function postGuardNotice(store, { missionId, text, key }) {
  if (!missionId) return null;
  return store.put("messages", { id: "guard:" + key, missionId, role: "system", kind: "guard", text, at: now() });
}
