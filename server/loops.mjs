// Bot loop protection (OpenClaw «loop detection» / max ping-pong turns): two bots answering
// each other without end burn the person's plan for nothing. Bot-to-bot exchanges (ask_bot,
// delegation) and room automations woken by bot messages are counted per pair in a sliding
// window; past the limit that pair is silenced for a minute and the room says so once.
// The person's own messages are never counted nor held back.
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

/** One quiet line in the room: «Colmena frenó a Atlas y Nora…». */
export function postGuardNotice(store, { missionId, text, key }) {
  if (!missionId) return null;
  return store.put("messages", { id: "guard:" + key, missionId, role: "system", kind: "guard", text, at: now() });
}
