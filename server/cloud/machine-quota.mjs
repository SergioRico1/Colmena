// Machine minutes of a company (docs/CLOUD.md › Phase 4 › Costs): what the Machine Durable Object
// (cloud/src/machine.js) counts and refuses. Pure, so the rules are tested in Node.
//
//   meta = { usage: {month: "YYYY-MM", ms}, runningSince: ms | null }
//
// A running container counts from `runningSince` (or the first of the month, when it has run
// since the month before); a new month starts from zero.

export const DEFAULT_MINUTES_PER_MONTH = 600;
export const monthOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const monthStart = (t) => Date.parse(monthOf(t) + "-01T00:00:00Z");

/** Milliseconds used this month at `at`, the running span included. */
export function usedMs(meta = {}, at = Date.now(), running = !!meta.runningSince) {
  const base = meta.usage?.month === monthOf(at) ? meta.usage.ms || 0 : 0;
  return base + (running && meta.runningSince ? Math.max(0, at - Math.max(meta.runningSince, monthStart(at))) : 0);
}

/** The minutes a company may use: its own number, the deployment's, or the default. */
export function quotaMinutes(own, deployment) {
  for (const v of [own, deployment]) { const n = Number(v); if (Number.isFinite(n) && n > 0) return Math.min(n, 100000); }
  return DEFAULT_MINUTES_PER_MONTH;
}

/** null when the machine may start; otherwise the sentence the person reads. */
export function quotaRefusal(meta, minutes, at = Date.now()) {
  if (usedMs(meta, at, false) < minutes * 60000) return null;
  return "Tu empresa ha usado sus " + minutes + " minutos de máquina de este mes. Se renuevan el día 1; quien administra la empresa puede pedir más.";
}

/** The meta after the container stopped at `at`: its running span added to this month. */
export function stopped(meta = {}, at = Date.now()) {
  if (!meta.runningSince) return { ...meta };
  return { ...meta, usage: { month: monthOf(at), ms: usedMs(meta, at, true) }, runningSince: null };
}
