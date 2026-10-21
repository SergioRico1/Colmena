// Rooms with several bots (OpenClaw group threads, adapted to Colmena):
// - who a message is for: «@Nora», «@todos», or the name first («Nora, mira esto»);
// - several addressees answer one after another, each seeing what the others said, with
//   «add something new or stay quiet» (OpenClaw NO_REPLY → QUIET_MARK);
// - a bot that names a teammate with @ in its answer passes it the word (up to MAX_ROUNDS);
// - long answers in rooms are said in parts (OpenClaw block streaming, 800–1200 characters);
// - «para», «detente», «stop»… alone stop the work (OpenClaw abort trigger words).
import { QUIET_MARK, quietRun } from "./quiet.mjs";

export const MAX_ADDRESSEES = 10;
/** A person's message can start up to this many rounds of bots passing the word. */
export const MAX_ROUNDS = 3;
/** Teammates one answer can bring in. */
export const PASS_LIMIT = 2;
export const SPEECH = Object.freeze({ min: 800, max: 1200 });
export const STOP_RE = /^\s*(?:para|p[aá]ralo|p[aá]rate|parad|detente|deteneos|stop|basta|cancela|alto)\s*[.!¡]*\s*$/i;

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/**
 * Bot ids a message is addressed to, in the order they are named. `members`: [{id, name}].
 * «@todos» / «@equipo» → every member. A name in prose without @ does not count, except
 * first in the message followed by a comma or colon («Nora, …» / «Nora: …»).
 */
export function addressees(text, members) {
  const raw = fold(text);
  const list = (members || []).filter((m) => m?.id && m?.name);
  if (/(^|\s)@(todos|equipo)(?![\p{L}\d])/u.test(raw)) return list.map((m) => m.id).slice(0, MAX_ADDRESSEES);
  const found = [];
  for (const m of list) {
    const name = escapeRe(fold(m.name));
    const at = new RegExp("(^|[\\s(¿¡,;])@" + name + "(?![\\p{L}\\d])", "u").exec(raw);
    const vocative = new RegExp("^\\s*" + name + "\\s*[,:]", "u").test(raw);
    if (at) found.push({ id: m.id, index: at.index });
    else if (vocative) found.push({ id: m.id, index: -1 });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.id).slice(0, MAX_ADDRESSEES);
}

/** For the first of several addressees: who else answers after it. */
export function chainLead(names) {
  if (names.length < 2) return "";
  return "Este mensaje es para varios: " + names.join(", ") + ". Responde tu parte; los demás hablarán después de ti y verán lo que digas.";
}

/**
 * What teammates of the same chain already said (data), with the rule to add only what is
 * new. Empty when nobody has answered yet.
 */
export function siblingNote(steps, step, nameOf) {
  if (!step?.chain) return "";
  const said = (steps || []).filter((s) => s.chain === step.chain && s.id !== step.id && s.status === "completed" && !s.quietReply && String(s.text || "").trim());
  if (!said.length) return "";
  const each = Math.max(400, Math.floor(16000 / said.length));
  return "Tus compañeros ya han respondido (dato): " + said.map((s) => nameOf(s.botId) + ": «" + clip(s.text, each) + "»").join(" ")
    + "\nAporta solo algo nuevo: otro dato, un matiz, una objeción o tu parte. Si no tienes nada que añadir, responde exactamente " + QUIET_MARK + " y no se publicará nada.";
}

/** The answer of a bot that may stay quiet: { quiet, text }. */
export function quietReply(text) {
  const t = String(text || "").trim();
  if (!t) return { quiet: true, text: "" };
  const q = quietRun(t);
  return q.quiet ? { quiet: true, text: "" } : { quiet: false, text: t };
}

/**
 * Teammates a bot's answer calls in with @ (not itself, not those already in this chain),
 * at most PASS_LIMIT.
 */
export function passedTo(text, members, { self, already = [] } = {}) {
  const raw = fold(text);
  const out = [];
  for (const m of members || []) {
    if (!m?.id || !m?.name || m.id === self || already.includes(m.id)) continue;
    const re = new RegExp("(^|[\\s(¿¡,;])@" + escapeRe(fold(m.name)) + "(?![\\p{L}\\d])", "u");
    const hit = re.exec(raw);
    if (hit) out.push({ id: m.id, index: hit.index });
  }
  return out.sort((a, b) => a.index - b.index).map((x) => x.id).slice(0, PASS_LIMIT);
}

/**
 * Where streamed text can be cut so the part so far becomes a message of its own, or -1.
 * Only at a blank line outside code blocks, once the next block has started and is not an
 * indented continuation; the part is ≥ min characters, ideally ≤ max (else the first cut
 * after max). `from`: where the current part starts.
 */
export function speechCut(text, from = 0, { min = SPEECH.min, max = SPEECH.max } = {}) {
  const s = String(text || "");
  if (s.length - from < min) return -1;
  let fence = null, pos = from, best = -1;
  const lines = s.slice(from).split("\n");
  // The last line may still be arriving: it is never a cut point on its own.
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const start = pos;
    pos += line.length + 1;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1][0].repeat(marker[1].length);
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence || line.trim() !== "" || i === 0) continue;
    // A blank line: the next non-blank line must have started and begin a new block.
    let j = i + 1;
    while (j < lines.length - 1 && lines[j].trim() === "") j++;
    const next = lines[j];
    if (j >= lines.length - 1 && !next?.trim()) continue;
    if (/^\s/.test(next) || !next.trim()) continue;
    const cut = start + line.length + 1 + lines.slice(i + 1, j).reduce((n, l) => n + l.length + 1, 0);
    const size = start - from;
    if (size < min) continue;
    if (size <= max) best = cut;
    else return best >= 0 ? best : cut;
  }
  return best;
}
