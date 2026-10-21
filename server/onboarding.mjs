import { LEO, now, withBotDefaults } from "./store.mjs";

// Roles and starting teams from design/Bienvenida.dc.html.
export const ROLES = {
  diseno: { label: "Diseño", team: ["atlas", "iris", "vera", "nora"] },
  programacion: { label: "Programación", team: ["atlas", "bruno", "nora", "vera"] },
  finanzas: { label: "Finanzas y economía", team: ["atlas", "tomas", "nora", "vera"] },
  marketing: { label: "Marketing", team: ["atlas", "vera", "iris", "nora"] },
  operaciones: { label: "Operaciones", team: ["atlas", "tomas", "bruno", "vera"] },
  legal: { label: "Legal", team: ["atlas", "leo", "nora", "vera"] },
  personas: { label: "Personas y RR. HH.", team: ["atlas", "vera", "nora", "tomas"] },
  otra: { label: "Otra cosa", team: ["atlas", "nora", "vera", "tomas"] },
};

/** What the person uses every day (onboarding chat), to suggest connections and first tasks. */
export const DAILY_APPS = ["correo", "calendario", "hojas", "carpetas", "chat", "contabilidad"];

/**
 * Applies the starting team: built-in bots in the team stay enabled, the other
 * built-in bots are disabled (never deleted). Bots created by the user are untouched.
 * `team` (from the onboarding chat) narrows the role's team; Atlas is always in it: he
 * coordinates and is the first bot you meet.
 */
export function applyOnboarding(store, role, { team = null, userName = null, apps = null } = {}) {
  const base = ROLES[role];
  if (!base) throw Error("Ese perfil no existe.");
  const chosen = Array.isArray(team) ? ["atlas", ...team.filter((b) => b !== "atlas" && base.team.includes(b))] : base.team;
  const plan = { ...base, team: [...new Set(chosen)] };
  return store.tx(() => {
    if (plan.team.includes("leo") && !store.get("bots", "leo"))
      store.put("bots", withBotDefaults({ ...LEO, builtin: true, enabled: true, createdAt: now() }));
    for (const bot of store.list("bots")) {
      if (!bot.builtin) continue;
      const enabled = bot.id === "atlas" || plan.team.includes(bot.id);
      if (bot.enabled !== enabled) store.patch("bots", bot.id, { enabled });
    }
    store.patch("settings", "main", { onboarded: true, role, ...(userName ? { userName } : {}), ...(Array.isArray(apps) ? { dailyApps: apps.filter((a) => DAILY_APPS.includes(a)) } : {}) });
    return { role, team: plan.team };
  });
}
