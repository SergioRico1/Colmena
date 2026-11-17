// Polls in the desktop's conversations with people (components/room/RoomPlus.jsx): a message any
// Colmena reads — «📊 ¿Pregunta?» and one line per option with a keycap — voted with reactions of
// those keycaps, so votes travel as reactions do. Pure, so tests read it.
export const KEYCAPS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
/** «¿Pizza o sushi? | Pizza | Sushi» → the poll as a message any Colmena reads. */
export function pollText(spec) {
  const parts = String(spec || "").split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return "📊 " + parts[0] + "\n" + parts.slice(1, 10).map((o, i) => KEYCAPS[i] + " " + o).join("\n");
}
/** A poll in a message's text: {question, options: [{emoji, text}]} or null. */
export function parsePoll(text) {
  const lines = String(text || "").split("\n");
  if (!/^📊 /.test(lines[0] || "")) return null;
  const options = lines.slice(1).map((l) => { const k = KEYCAPS.find((e) => l.startsWith(e + " ")); return k ? { emoji: k, text: l.slice(k.length + 1) } : null; });
  if (options.length < 2 || options.some((o) => !o)) return null;
  return { question: lines[0].slice(3), options };
}

