// What a bot is doing right now, in words, from the runtime's live list (/api/state › bots):
// {key, word, mood}. key: libre | trabaja | espera | pausa | limite; mood feeds BotFace. Never
// honey: that colour only means «te necesita». Used by the channels (src/chat/) and the rooms.

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");

export function botNow(live) {
  if (live?.limited) return { key: "limite", word: "Sin plan" + (live.limited.resumeAt || live.limited.resetsAt ? " hasta las " + hm(live.limited.resumeAt || live.limited.resetsAt) : ""), mood: "pausa" };
  if (live?.status === "pausado" || live?.enabled === false) return { key: "pausa", word: "En pausa", mood: "pausa" };
  if (live?.status === "espera") return { key: "espera", word: "Esperando una respuesta", mood: "espera" };
  if (live?.status === "trabaja" || live?.busy) return { key: "trabaja", word: "Trabajando" + (live.activity?.verb ? " · " + live.activity.verb : ""), mood: "trabajando" };
  return { key: "libre", word: "Libre", mood: "libre" };
}

/** The colour of each state's dot and words (tokens; the free green, the working accent). */
export const NOW_TONE = {
  libre: { dot: "var(--c-ok)", ink: "var(--c-ok-ink)" },
  trabaja: { dot: "var(--c-accent)", ink: "var(--c-accent-ink)" },
  espera: { dot: "var(--c-text-4)", ink: "var(--c-text-3)" },
  pausa: { dot: "var(--c-text-4)", ink: "var(--c-text-3)" },
  limite: { dot: "var(--c-error)", ink: "var(--c-error)" },
};
