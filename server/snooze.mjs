// «Recordar después»: a request that waits for the person can be put off until a time
// (`snoozedUntil` on the approval record). Until then it leaves «Te necesitan» and every
// count of what waits (sidebar, Inicio, the tray and taskbar); the bot keeps waiting as
// before, and the request comes back by itself. Nothing with a deadline is put off past it:
// a send about to leave on its own, a request that expires, a question with a wait.
import { approvalExpiresAt } from "./state.mjs";

/** The furthest a request can be put off. */
export const SNOOZE_MAX_MS = 15 * 24 * 3600e3;

/** Put off right now: pending, with a time that has not come yet. */
export function isSnoozed(a, time = Date.now()) {
  if (!a || a.status !== "pending" || !a.snoozedUntil) return false;
  const until = Date.parse(a.snoozedUntil);
  return !Number.isNaN(until) && until > time;
}

/** When this stored approval stops waiting by itself (ms), or null when it has no deadline. */
export function snoozeDeadline(a) {
  if (!a || a.status !== "pending") return null;
  const times = [
    a.autoSendAt, // a send you asked for leaves on its own
    a.kind === "secret" ? a.expiresAt : approvalExpiresAt(a), // what expires unanswered
    a.kind === "question" && !a.timedOut ? a.waitUntil : null, // the bot goes on without you
  ].map((t) => Date.parse(t || "")).filter((t) => !Number.isNaN(t));
  return times.length ? Math.min(...times) : null;
}

/** Why this approval cannot be put off until `until` (ISO), or null when it can. */
export function snoozeProblem(a, until, time = Date.now()) {
  if (!a || a.status !== "pending") return "Esto ya está resuelto.";
  const at = Date.parse(until || "");
  if (Number.isNaN(at) || at <= time) return "Elige un momento que aún no haya pasado.";
  if (at - time > SNOOZE_MAX_MS) return "No se puede posponer tanto.";
  const deadline = snoozeDeadline(a);
  if (deadline != null && deadline <= at) return "Esto caduca antes de esa hora. Decídelo ahora.";
  return null;
}

/**
 * Brings back what was put off when its time comes: the mark is cleared, which tells every
 * open window and the tray to count it again. One timer for the next one due.
 */
export function createSnoozeWaker(store, { clock = () => Date.now() } = {}) {
  let timer = null;
  const wake = () => {
    timer = null;
    const time = clock();
    let next = Infinity;
    try {
      for (const a of store.list("approvals")) {
        if (!a.snoozedUntil) continue;
        const until = Date.parse(a.snoozedUntil);
        if (a.status !== "pending" || Number.isNaN(until) || until <= time) store.patch("approvals", a.id, { snoozedUntil: null });
        else next = Math.min(next, until);
      }
    } catch { return; } // the store is closed: nothing left to bring back
    // Long waits are checked again every few hours (a timer cannot hold weeks).
    if (Number.isFinite(next)) {
      timer = setTimeout(wake, Math.min(Math.max(next - time, 0) + 50, 6 * 3600e3));
      timer.unref?.();
    }
  };
  return {
    /** Call after a request is put off or brought back. */
    schedule() { clearTimeout(timer); wake(); },
    stop() { clearTimeout(timer); timer = null; },
    wake,
  };
}
