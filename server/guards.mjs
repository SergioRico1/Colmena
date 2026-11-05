// Small autonomy guards around a bot's work:
//   - permissionChangeNote: the person changed what a bot may do while it works; it is told
//     once, at its next round (DeepSeek Harness permission presets: the agent always knows);
//   - blocked/stalled only for real (DeepSeek Harness goal «anti-false-blocked»): a step or a
//     goal is declared blocked only when the same blocking condition persisted for
//     BLOCKED_ROUNDS consecutive rounds; «it is difficult» is not blocked.

const AUTONOMY = { sugiere: "Solo sugiere", avisa: "Hace y avisa", solo: "Hace solo" };
const ACCESS = { none: "sin acceso", lee: "solo lee", pide: "lee y pide para escribir", escribe: "lee y escribe" };
const APP = { correo: "Correo", calendario: "Calendario", carpeta: "Carpeta", hojas: "Hojas", chat: "Chat", erp: "Contabilidad" };
const CAPABILITY = { web: "buscar en la web", apps: "usar tus apps conectadas", ordenador: "usar el ordenador", carpetas: "leer tus carpetas", imagenes: "crear imágenes", memoria: "recordar" };
const yes = (v) => (v ? "sí" : "no");

/**
 * One Spanish note listing what changed (before → now), or null when nothing the bot can act
 * on changed. `before`/`now` come from Runtime#permissionState.
 */
export function permissionChangeNote(before = {}, now = {}) {
  const lines = [];
  if (before.autonomy !== now.autonomy)
    lines.push(`autonomía: ${AUTONOMY[now.autonomy] || now.autonomy} (antes ${AUTONOMY[before.autonomy] || before.autonomy || "otra"})`);
  const apps = new Set([...Object.keys(before.apps || {}), ...Object.keys(now.apps || {})]);
  for (const key of apps) {
    const a = before.apps?.[key] || "none", b = now.apps?.[key] || "none";
    if (a !== b) lines.push(`${APP[key] || key}: ${ACCESS[b] || b} (antes ${ACCESS[a] || a})`);
  }
  const caps = new Set([...Object.keys(before.capabilities || {}), ...Object.keys(now.capabilities || {})]);
  for (const key of caps) {
    const a = !!before.capabilities?.[key], b = !!now.capabilities?.[key];
    if (a !== b) lines.push(`${b ? "ahora puedes" : "ya no puedes"} ${CAPABILITY[key] || key}`);
  }
  if (!!before.computer !== !!now.computer) lines.push(`usar el ordenador: ${yes(now.computer)} (antes ${yes(before.computer)})`);
  if (!!before.commands !== !!now.commands) lines.push(`ejecutar programas: ${yes(now.commands)} (antes ${yes(before.commands)})`);
  if (!lines.length) return null;
  return "Aviso de Colmena: la persona ha cambiado tus permisos mientras trabajabas. Desde ahora: " + lines.join("; ") + ". " +
    "Ajusta lo que hagas a esto (no cuentes con lo que ya no tienes y no esperes permiso para lo que ahora puedes hacer solo). Las líneas rojas siguen pidiendo su OK.";
}

// ------------------------------------------------------------ anti-false-blocked
export const BLOCKED_ROUNDS = 3;

/** «Es difícil», «cuesta», «es complicado»: effort, never a blocking condition by itself. */
export const ONLY_HARD = /\b(es|resulta|parece|está|esta)\s+(muy\s+|bastante\s+|demasiado\s+)?(dif[ií]cil|complicad[oa]|costos[oa]|lent[oa]|laborios[oa])\b|\bme\s+cuesta\b/i;

/** Normalized blocking condition: same tool and error, digits and quotes folded. */
export const blockingKey = (tool, error) =>
  String(tool || "") + "\u0000" + String(error || "").toLowerCase().replace(/\d+/g, "#").replace(/[«»"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * Tracks consecutive rounds with the same blocking condition: {key, rounds}. A round without
 * one (null) resets it; a different one starts again at 1.
 */
export function trackBlocking(state, key) {
  if (!key) return { key: null, rounds: 0 };
  return state?.key === key ? { key, rounds: (state.rounds || 0) + 1 } : { key, rounds: 1 };
}

/** «Es difícil» with nothing that actually stops it (no access, something missing, an error). */
export const onlyHard = (reason) => ONLY_HARD.test(String(reason || "")) && !/\b(no puedo|no tengo|falta|necesito|sin acceso|bloquead|error|denegad|no existe)\w*/i.test(String(reason || ""));

/** May this be declared blocked now? Only after BLOCKED_ROUNDS rounds of the same condition, never for «it is difficult». */
export const mayDeclareBlocked = (state, { reason = "" } = {}) =>
  !!state?.key && (state.rounds || 0) >= BLOCKED_ROUNDS && !onlyHard(reason);
