// Where a finished dictation goes and which engine heard it (src/components/interaction/Dictation.jsx).
// Pure, so node --test can check it without a browser.

/** Appends dictated words to a text, with one space between. */
export const appendText = (prev, said) => (prev && !/\s$/.test(prev) ? prev + " " : prev || "") + said;

/**
 * The plan for a transcript: at the caret or selection the box had when dictation began, as one
 * edit, or appended when that place is no longer meaningful.
 * `snapshot` and `now` are { value, start, end, el } (or null when there is no box to read).
 * - the text changed meanwhile → append (the old caret points at other words);
 * - the same box with its caret or selection moved → append (you put it elsewhere on purpose);
 * - a box remounted while dictating (some composers swap it for the live words) had no caret to
 *   move, so the one it had is restored.
 */
export function planInsert(snapshot, now, text) {
  const said = String(text || "").replace(/\s+/g, " ").trim();
  if (!said) return null;
  if (!snapshot || !now || now.value !== snapshot.value) return { mode: "append", text: said };
  if (now.el === snapshot.el && (now.start !== snapshot.start || now.end !== snapshot.end)) return { mode: "append", text: said };
  const start = Math.max(0, Math.min(snapshot.start ?? snapshot.value.length, snapshot.value.length));
  const end = Math.max(start, Math.min(snapshot.end ?? start, snapshot.value.length));
  const before = snapshot.value.slice(0, start);
  const after = snapshot.value.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s.,;:!?)»”]/.test(after) ? " " : "";
  return { mode: "caret", start, end, text: lead + said + trail, caret: start + lead.length + said.length };
}

/**
 * Which engine hears you, said where it is used: «En este equipo» (the computer's recognizer, the
 * voice never leaves it) or «En la nube» (a recording sent to OpenAI). In «auto», using the cloud
 * because this computer cannot is always said, never a silent switch.
 */
export function engineNote(voice, mode) {
  if (mode === "sistema") return { where: "En este equipo", cloud: false, note: null };
  if (mode !== "openai") return null;
  const fallback = voice?.preference !== "openai";
  return {
    where: "En la nube",
    cloud: true,
    note: fallback ? "El dictado de este equipo no está disponible: tu voz se envía a OpenAI para pasarla a texto." : "Tu voz se envía a OpenAI para pasarla a texto.",
    fallback,
  };
}
