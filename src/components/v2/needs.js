import { splitSnoozed } from "../../lib/snooze.js";

// «Te necesitan» (Colmena 2.0: honey only means «we need you»): what waits for your
// decision — approvals and questions, and rooms that wait for you to choose a proposal or a plan.
const DECIDE = new Set(["awaiting_choice", "awaiting_plan"]);

// «Te avisa de lo importante»: a question its bot left you about something new in your apps (watch.mjs) waits too.
// What you put off («Recordar después», lib/snooze.js) is not in `asks` nor in the count until
// its time: it comes apart in `snoozed`. Its room does not count as a choice meanwhile.
export function needsOf({ approvals = [], missions = [], watchNotes = [] } = {}, now = Date.now()) {
  const pending = approvals.filter((a) => a.status === "pending");
  const { waiting: asks, snoozed } = splitSnoozed(pending, now);
  const covered = new Set(pending.map((a) => a.missionId));
  const choices = missions.filter((m) => DECIDE.has(m.status) && !covered.has(m.id) && !m.archived);
  return { asks, choices, notes: watchNotes || [], snoozed };
}

export function needsCount(store, now = Date.now()) {
  const { asks, choices, notes } = needsOf(store, now);
  return asks.length + choices.length + notes.length;
}
