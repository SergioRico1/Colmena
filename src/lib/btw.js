// «/btw …» in the composers (chat, room, Código): the same rule as server/btw.mjs.
const BTW = /^\s*\/(?:btw|side)(?:\s+([\s\S]*))?$/i;

/** The question of «/btw …» (or «/side …»); null when the text is not one, "" when it is empty. */
export const btwQuestion = (text) => {
  const m = BTW.exec(String(text ?? ""));
  return m ? (m[1] || "").trim() : null;
};
