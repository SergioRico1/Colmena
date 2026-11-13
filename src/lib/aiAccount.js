// Whether your bots can think (an AI account is connected), and what the places where you ask
// them for work say when they cannot. Pure: no React, no network. `state` is /api/state.

/** Is any AI account connected? (the old ChatGPT-only provider counts too). */
export function aiConnected(state) {
  return !!(state?.ai?.engines || []).some((e) => e.connected) || !!state?.provider?.connected;
}

/**
 * The «Pide algo a tu equipo» box of Inicio. Without an AI account it does not invite a request
 * it cannot serve: it is off, says why and where to connect one. Talking to PEOPLE needs no AI
 * account, and the note says so. Until the state has loaded nothing is assumed.
 *   {blocked, placeholder, note: string | null, action: {label, href} | null}
 */
export function askBox(state) {
  if (!state?.ready || aiConnected(state)) return { blocked: false, placeholder: "Pide algo a tu equipo…", note: null, action: null };
  return {
    blocked: true,
    placeholder: "Conecta una cuenta de IA para pedir trabajo a tus bots",
    note: "Tus bots piensan con tu cuenta de IA y aún no hay ninguna conectada. Con tus compañeros puedes hablar igual: las salas y los mensajes no la necesitan.",
    action: { label: "Conectar mi cuenta", href: "/ajustes/ia" },
  };
}
