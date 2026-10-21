import { useEffect, useRef, useState } from "react";

// How a bot at work is described (OpenClaw working indicator, in Colmena's voice):
// - the phases before the first word, shown only when they last (a quick start stays dots);
// - after 30 s, a hive phrase that changes every 45 s, never the same twice in a row;
// - the bot's own line («Ya tengo dos tarifas…») when the narrator wrote one.

/** Server activity verbs → what the person reads. */
export const PHASES = {
  preparando: "Preparando el contexto",
  conectando: "Esperando al modelo",
  resumiendo: "Ordenando lo hablado",
};
const SLOW_MS = 1500;

/** «conectando» for 300 ms reads as thinking; only a phase that lasts shows its name. */
export function useSlowPhase(verb) {
  const [shown, setShown] = useState(PHASES[verb] ? "pensando" : verb);
  useEffect(() => {
    if (!PHASES[verb]) {
      setShown(verb);
      return undefined;
    }
    const t = setTimeout(() => setShown(verb), SLOW_MS);
    return () => clearTimeout(t);
  }, [verb]);
  return shown;
}

export function verbLabel(verb) {
  if (!verb) return "Pensando";
  return PHASES[verb] || verb.charAt(0).toUpperCase() + verb.slice(1);
}

export const PHRASES = [
  "Libando datos", "Zumbando entre fuentes", "Polinizando ideas", "Tejiendo el panal", "Recogiendo néctar",
  "Bailando la danza de la abeja", "Llenando las celdas", "Revoloteando por los detalles", "Ordenando la colmena",
  "Madurando la miel", "Siguiendo el rastro del polen", "Puliendo las celdas", "Volando de flor en flor", "Afinando el zumbido",
];
const SHOW_AFTER_MS = 30000;
const EVERY_MS = 45000;
const STRIDE = 5; // coprime with 14: every phrase before any repeats

function hash(text) {
  let h = 2166136261;
  for (const c of String(text || "")) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** The hive phrase for a step running since `startedAt` (null before 30 s). */
export function usePhrase(startedAt, active, seed = "") {
  const [now, setNow] = useState(() => Date.now());
  const salt = useRef(Math.floor(Math.random() * PHRASES.length));
  useEffect(() => {
    if (!active || !startedAt) return undefined;
    const t = setInterval(() => { if (document.visibilityState !== "hidden") setNow(Date.now()); }, 5000);
    return () => clearInterval(t);
  }, [active, startedAt]);
  const since = Date.parse(startedAt || 0);
  if (!active || !since || now - since < SHOW_AFTER_MS) return null;
  const turn = Math.floor((now - since - SHOW_AFTER_MS) / EVERY_MS);
  return PHRASES[(hash(seed) + salt.current + turn * STRIDE) % PHRASES.length] + "…";
}
