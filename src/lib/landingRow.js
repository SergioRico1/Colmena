// Long answers open at their first line (followScroll.js `landing`): which row of a chat is
// «the latest answer» whose start must stay in view. Only an answer that arrives while you
// have the chat open counts — the one being written, then the finished one that takes its
// place; what the chat opened with is history and opens at its end, as always.

/** A turn already this far into its answer when the chat opened keeps following its end. */
export const UNDER_WAY = 600;
const SLACK_MS = 3000;

/** The steps already well into their answer: [{ stepId, text }] → Set(stepId). */
export const underWay = (live = []) => new Set(live.filter((l) => String(l.text || "").length > UNDER_WAY).map((l) => l.stepId));

/**
 * The row to land on — { key, turn }: its key and what names the answer across the row
 * being written and the finished one (the step, else the message) — or null. `rows` are the chat's rows (Conversacion.jsx:
 * { key, kind, m?, live? }), `openedAt` when this chat was opened (ms) and `under` the steps
 * that were already well into their answer then. Looks from the end back to your last
 * message: an answer before it is not the latest one.
 */
export function landingRow(rows, { openedAt = 0, under = null } = {}) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.kind === "user") return null;
    if (row.kind === "now" && row.live?.text) return under?.has(row.live.stepId) ? null : { key: row.key, turn: row.live.stepId || row.key };
    if (row.kind === "answer" && row.m?.text) {
      if (row.m.stepId && under?.has(row.m.stepId)) return null;
      return Date.parse(row.m.at || 0) >= openedAt - SLACK_MS ? { key: row.key, turn: row.m.stepId || row.key } : null;
    }
  }
  return null;
}
