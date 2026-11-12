// A visible end when work finishes: what was delivered, how long it took and one next action.
// Pure: no React, no network. The screens draw it calmly (components/v3/dia/Completion.jsx):
// no confetti, nothing that moves under «reduce motion».
//
// It is shown for work the person asked for that finishes while they are in the app:
//   - a task (a mission that is not a chat) always;
//   - a chat only when that turn delivered something (every answer is not an event);
//   - a routine's run only when it brought something new (never «nothing new»);
//   - never the bot that watches your apps, an incognito chat or archived work.
import { roomUrl } from "./format.js";

/** A finished run stays on screen this long unless you close it. */
export const COMPLETION_KEEP_MS = 30 * 60e3;
const ts = (x) => Date.parse(x || 0) || 0;
const firstSentence = (t) => (t ? (String(t).match(/^[^.!?\n]+[.!?]?/) || [""])[0].replace(/[.]$/, "").trim() : "");

/** «menos de 1 min», «14 min», «2 h», «3 días». */
export function tookText(ms) {
  if (!(ms > 0)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return "menos de 1 min";
  if (min < 90) return min + " min";
  const h = Math.round(min / 60);
  return h < 36 ? h + " h" : Math.round(h / 24) + " días";
}

/** Finished work that may get its moment (whether it does also depends on what it delivered). */
export function completable(m) {
  return !!m && m.status === "completed" && !m.watch && !m.incognito && !m.archived && !(m.automationId && m.nothingNew);
}

/** What this run delivered: the mission's deliverables made since `start` (all of a task's). */
export function deliveredBy(m, artifacts = [], start = 0) {
  return artifacts
    .filter((a) => a.missionId === m.id && (!m.conversation || ts(a.updatedAt || a.createdAt) >= start - 5000))
    .sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
    .map((a) => ({ id: a.id, title: a.title || "Entregable", href: `/biblioteca?abrir=${encodeURIComponent(a.id)}` }));
}

/**
 * The summary of one finished mission, or null when it gets no moment:
 *   { id, title, line, who, took, deliverables: [{id, title, href}], open: {label, href},
 *     suggestions: [text], href, at }
 * `startedAt`: when this run was seen to start (a chat has many turns; without it a chat's
 * time is not known and is left out rather than guessed).
 */
export function completionSummary(m, { artifacts = [], bots = [], startedAt = null } = {}) {
  if (!completable(m)) return null;
  const end = ts(m.completedAt);
  const start = startedAt || (m.conversation ? 0 : ts(m.createdAt));
  const deliverables = deliveredBy(m, artifacts, startedAt || (m.conversation ? end - 6 * 3600e3 : 0));
  if (m.conversation && !deliverables.length) return null;
  const names = [...new Set([...(m.chosenBotIds || []), ...(m.botIds || [])])].map((id) => bots.find((b) => b.id === id)?.name).filter(Boolean).slice(0, 3);
  const who = names.length > 1 ? names.slice(0, -1).join(", ") + " y " + names.at(-1) : names[0] || "Tu equipo";
  const href = m.conversation ? roomUrl(m) : `/encargo/${m.id}`;
  return {
    id: m.id, title: m.title || "Trabajo", line: firstSentence(m.recap?.text),
    who, took: start && end > start ? tookText(end - start) : null,
    deliverables,
    // One next action: the deliverable when there is exactly one, else the work itself.
    open: { label: "Abrir", href: deliverables.length === 1 ? deliverables[0].href : href },
    suggestions: (m.suggestions || []).filter((t) => typeof t === "string" && t.trim()).slice(0, 3),
    href, at: m.completedAt || null,
  };
}

/**
 * What finished while you were in the app: the summaries of the missions completed after
 * `since` (when this window opened), newest first, that were not closed and are still recent.
 * `started`: Map(missionId → ms) of the runs seen to start.
 */
export function freshCompletions({ missions = [], artifacts = [], bots = [] } = {}, { since = 0, now = Date.now(), dismissed = new Set(), started = new Map() } = {}) {
  return missions
    .filter((m) => completable(m) && ts(m.completedAt) > since && now - ts(m.completedAt) < COMPLETION_KEEP_MS && !dismissed.has(m.id + ":" + m.completedAt))
    .sort((a, b) => ts(b.completedAt) - ts(a.completedAt))
    .map((m) => completionSummary(m, { artifacts, bots, startedAt: started.get(m.id) || null }))
    .filter(Boolean);
}
