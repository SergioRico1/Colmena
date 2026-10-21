// «Te necesitan» (Colmena 2.0: honey only means «we need you»): what waits for your
// decision — approvals and questions, and rooms that wait for you to choose a proposal or a plan.
const DECIDE = new Set(["awaiting_choice", "awaiting_plan"]);

// «Te avisa de lo importante»: a question its bot left you about something new in your apps (watch.mjs) waits too.
export function needsOf({ approvals = [], missions = [], watchNotes = [] } = {}) {
  const asks = approvals.filter((a) => a.status === "pending");
  const covered = new Set(asks.map((a) => a.missionId));
  const choices = missions.filter((m) => DECIDE.has(m.status) && !covered.has(m.id) && !m.archived);
  return { asks, choices, notes: watchNotes || [] };
}

export function needsCount(store) {
  const { asks, choices, notes } = needsOf(store);
  return asks.length + choices.length + notes.length;
}
