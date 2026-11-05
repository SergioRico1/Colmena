// «No me sirve» with a reason (DeepSeek Harness feedback: a rating plus why). A 👎 on a bot's
// answer can carry reason chips and a note; they live on the person's 👎 reaction itself, so
// removing the 👎 removes them, and they can be changed later.
// Who reads them:
// - verdicts.mjs measures with them (a 👎 with a reason weighs as a correction, and the
//   verdict says which reason repeats) — measuring only, as every reaction;
// - learning.mjs gets them as what the person said about an answer (the chips are her words,
//   picked instead of typed), next to her corrections; a bare 👎 never reaches a bot there.
import { now } from "./store.mjs";
import { reactionsOf, togglePersonReaction } from "./reactions.mjs";

export const DOWN = "👎";
export const DOWN_REASONS = Object.freeze([
  ["no-pedido", "No hizo lo que pedí"],
  ["datos", "Datos incorrectos"],
  ["largo", "Demasiado largo"],
  ["paso", "Se saltó un paso"],
  ["tono", "Tono"],
  ["lento", "Lento"],
  ["otro", "Otro"],
]);
export const DOWN_CODES = DOWN_REASONS.map(([code]) => code);
export const REASON_LABEL = Object.freeze(Object.fromEntries(DOWN_REASONS));
export const NOTE_MAX = 500;

const mine = (r) => r?.emoji === DOWN && r.by === "user";
const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** A reaction as the client sees it: the person's 👎 keeps its reasons and note. */
export function reactionView(r) {
  const view = { emoji: r.emoji, by: r.by };
  if (mine(r) && (r.reasons?.length || r.note)) Object.assign(view, { reasons: r.reasons || [], note: r.note || "" });
  return view;
}

/** The person's 👎 on a message, with {reasons, note, at, editedAt}, or null. */
export function downFeedback(message) {
  return reactionsOf(message).find(mine) || null;
}

/**
 * Sets (or changes) why an answer did not help. Adds the 👎 when it is not there yet (as a
 * click on it would, so the bots see it on their next turn). Empty reasons and note leave a
 * plain 👎. Only bot answers take a reason.
 */
export function setDownFeedback(store, messageId, { reasons = [], note = "" } = {}) {
  let message = store.get("messages", messageId);
  if (!message) throw Object.assign(Error("Ese mensaje ya no existe."), { status: 404 });
  if (message.role !== "assistant") throw Object.assign(Error("Solo se puede decir por qué no sirve una respuesta de un bot."), { status: 422 });
  const codes = [...new Set(reasons)].filter((c) => DOWN_CODES.includes(c));
  const text = String(note || "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  if (!downFeedback(message)) message = togglePersonReaction(store, messageId, DOWN);
  const at = now();
  const list = reactionsOf(message).map((r) => {
    if (!mine(r)) return r;
    const { reasons: _r, note: _n, editedAt: _e, ...rest } = r;
    return codes.length || text ? { ...rest, reasons: codes, note: text, editedAt: at } : rest;
  });
  return store.patch("messages", messageId, { reactions: list });
}

/** The reasons of a reaction in words: «Datos incorrectos, Demasiado largo». */
export const reasonText = (r) => (r?.reasons || []).map((c) => REASON_LABEL[c]).filter(Boolean).join(", ");

/**
 * What the person said about this mission's answers with a 👎 and a reason, in her words, for
 * the learning review: «Sobre la respuesta «…»: Datos incorrectos. La cifra de marzo es otra».
 */
export function feedbackCorrections(store, missionId) {
  const out = [];
  for (const m of store.where("messages", "missionId", missionId)) {
    if (m.role !== "assistant") continue;
    const r = downFeedback(m);
    if (!r || !(r.reasons?.length || r.note)) continue;
    const said = [reasonText(r), r.note].filter(Boolean).join(". ");
    out.push({ id: m.id, at: r.editedAt || r.at || m.at || "", text: "Sobre la respuesta «" + clip(m.text, 160) + "»: " + said });
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Reason codes of the person's 👎 in a mission (repeated per answer), for measuring. */
export function downReasonsOf(messages) {
  const codes = [];
  let reasoned = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const r = downFeedback(m);
    if (!r || !(r.reasons?.length || r.note)) continue;
    reasoned++;
    codes.push(...(r.reasons?.length ? r.reasons : ["otro"]));
  }
  return { codes, reasoned };
}
