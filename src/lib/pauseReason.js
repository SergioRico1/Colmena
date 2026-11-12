// Why a task is paused and what makes it go on, in the words the chat already uses for the
// same facts («Se paró», components/v2/chat/StoppedCard.jsx; «Límite del plan»,
// components/v2/LimitNotice.jsx). A list never says just «En pausa»: it says why, and what
// resumes it. Pure: no React, no network.
//
// The mission summary carries the cause (server/state.mjs): `limited` (an AI's usage limit),
// `pausedBy: "all"` (the whole team is paused), `interrupted` (Colmena closed while it
// worked), `stopped` {reason, detail} (server/stopped.mjs) and `error`.
import { engineName, renewText } from "./limitWords.js";

const CONTINUE = "Sigue cuando pulses «Continuar»";

/**
 * { why, resumes, auto } for a paused mission, or null when it is not paused.
 * `why`: what happened; `resumes`: what makes it go on; `auto`: it goes on by itself.
 */
export function pauseReason(m, { botName = "El bot", now = Date.now() } = {}) {
  if (!m || m.status !== "paused") return null;
  const who = botName || "El bot";
  if (m.limited) {
    const when = renewText(m.limited.resetsAt, now);
    const again = renewText(m.limited.resumeAt, now);
    const engine = engineName(m.limited.engine);
    return m.limited.plan
      ? { why: `Queda poco del plan de ${engine}`, resumes: when ? `Sigue sola cuando se renueve, ${when}` : `Lo vuelve a mirar sola ${again || "dentro de un rato"}`, auto: true }
      : { why: `${engine} ha llegado a su ${m.limited.label || "límite de uso"}`, resumes: when ? `Sigue sola cuando se renueve, ${when}` : `Lo vuelve a intentar sola ${again || "dentro de un rato"}`, auto: true };
  }
  if (m.pausedBy === "all") return { why: "Pausaste a todo el equipo", resumes: "Sigue cuando pulses «Reanudar al equipo»", auto: false };
  if (m.interrupted) return { why: "Colmena se cerró mientras trabajaba", resumes: "Sigue sola desde el último paso guardado en cuanto tu IA esté lista", auto: true };
  const stopped = m.stopped || null;
  switch (stopped?.reason) {
    case "cancelled": return { why: stopped.why ? `La paraste tú: «${stopped.why}»` : "La paraste tú", resumes: CONTINUE, auto: false };
    case "length": return { why: "La respuesta era demasiado larga y se cortó", resumes: CONTINUE + ", desde el último paso guardado", auto: false };
    case "content-filter": return { why: "Un filtro de contenido la cortó", resumes: "Prueba a pedirlo de otra manera", auto: false };
    case "error": return { why: `${who} no pudo seguir` + (stopped.detail ? `: ${trim(stopped.detail)}` : ""), resumes: CONTINUE, auto: false };
    default: break;
  }
  const said = stopped?.detail || m.error || "";
  return { why: said ? trim(said) : `${who} se paró`, resumes: CONTINUE, auto: false };
}

/** The two parts as one line: «La paraste tú. Sigue cuando pulses «Continuar».» */
export function pauseLine(m, options) {
  const r = pauseReason(m, options);
  return r ? `${r.why}. ${r.resumes}.` : "";
}

const trim = (text) => { const s = String(text).replace(/\s+/g, " ").trim().replace(/[.]$/, ""); return s.length > 140 ? s.slice(0, 139).trimEnd() + "…" : s; };
