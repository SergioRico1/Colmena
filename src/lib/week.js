// «Tu semana con el equipo»: what the last seven days were, from the /api/state snapshot.
// Pure: no React, no network.

const ts = (x) => Date.parse(x || 0) || 0;
const firstSentence = (t) => (t ? (String(t).match(/^[^.!?\n]+[.!?]?/) || [""])[0].replace(/[.]$/, "").trim() : "");
const WEEK_MS = 7 * 864e5;

/** A task that finished in the window: work with a plan and a delivery, not a chat. */
export const finishedInWeek = (m, since, now) => !m.conversation && m.status === "completed" && ts(m.completedAt) > since && ts(m.completedAt) <= now;

/**
 * { from, to, done, approved, skills, happened[], soon[] } for the seven days up to `now`.
 * `done`: finished work · `approved`: what you approved or answered yourself · `skills`: new
 * skills waiting for your review · `happened`: up to three sentences · `soon`: goal milestones.
 */
export function weekSummary({ missions = [], approvals = [], skills = [], goals = [] } = {}, now = Date.now()) {
  const since = now - WEEK_MS;
  const done = missions.filter((m) => finishedInWeek(m, since, now));
  const approved = approvals.filter((a) => a.decidedBy === "tú" && ts(a.decidedAt) > since);
  const pendingSkills = (skills || []).filter((s) => s.status === "pending");
  const happened = done.filter((m) => m.recap?.text).slice(0, 3).map((m) => firstSentence(m.recap.text) + ".");
  const soon = [];
  for (const g of Array.isArray(goals) ? goals : []) {
    const due = ts(g.next?.dueAt);
    if (due > now && due - now < 21 * 864e5) soon.push(`El objetivo «${g.title}» tiene un hito el ${new Date(due).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}.`);
  }
  const awaiting = missions.filter((m) => m.status === "awaiting_choice" && !m.archived).length;
  if (awaiting) happened.push(awaiting === 1 ? "Hay una propuesta esperando tu decisión." : `Hay ${awaiting} propuestas esperando tu decisión.`);
  return { from: since, to: now, done: done.length, approved: approved.length, skills: pendingSkills.length, happened: happened.slice(0, 3), soon: soon.slice(0, 3) };
}

/** «Del 5 al 12 de noviembre»: the days the summary covers, today included. */
export function weekRange(from, to) {
  const a = new Date(from), b = new Date(to);
  const month = (d) => d.toLocaleDateString("es-ES", { month: "long" });
  return a.getMonth() === b.getMonth() ? `Del ${a.getDate()} al ${b.getDate()} de ${month(b)}` : `Del ${a.getDate()} de ${month(a)} al ${b.getDate()} de ${month(b)}`;
}
