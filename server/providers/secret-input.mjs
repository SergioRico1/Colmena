// Pasted keys and tokens: copying from a web page or a terminal often brings a trailing space,
// a line break, a non-breaking space or a zero-width character. They are removed before any
// check, and the error says exactly what is wrong (never the secret itself).

// Zero-width and BOM characters are never part of a key, wherever they are.
const INVISIBLE = /[​-‍⁠﻿­]/g;
// Any whitespace at the ends, including NBSP and the other Unicode spaces.
const EDGES = /^[\s  -   　]+|[\s  -   　]+$/g;
const INNER_SPACE = /[\s  -   　]/;

/** The pasted value without invisible characters and without spaces or line breaks at its ends. */
export function cleanSecret(raw) {
  return String(raw ?? "").replace(INVISIBLE, "").replace(EDGES, "");
}

/**
 * OpenCode key (opencode.ai/auth, e.g. «oc_sk_» + hex + «_» + letters and digits):
 * {key} or {error} naming the problem.
 */
export function checkOpenCodeKey(raw) {
  const key = cleanSecret(raw);
  if (!key) return { error: "Pega tu clave de OpenCode." };
  const space = key.search(INNER_SPACE);
  if (space >= 0) return { error: `La clave tiene un espacio o un salto de línea en medio (después del carácter ${space}). Cópiala de nuevo, en una sola línea.` };
  const bad = key.match(/[^A-Za-z0-9_\-.]/);
  if (bad) return { error: `La clave tiene un carácter que no es válido («${bad[0]}», en la posición ${bad.index + 1}). Solo puede llevar letras, números, «_», «-» y «.».` };
  if (key.length < 16) return { error: `La clave es demasiado corta (${key.length} caracteres). Cópiala entera.` };
  if (key.length > 400) return { error: "La clave es demasiado larga. Copia solo la clave." };
  return { key };
}
