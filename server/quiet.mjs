// Automations that do not bother you (Hermes cron: [SILENT], continuity, pre-run checks):
// - a run with nothing new says so with QUIET_MARK and no notice reaches the person;
// - each run knows what the previous one said, so it reports only what changed;
// - before firing, the rule checks it has what it needs (its bot, the bot's permissions,
//   the connected apps) and, if not, waits blocked with «Le falta …», told once.
import { TOOLKITS, CONNECTOR_NAMES } from "./triggers.mjs";

export const QUIET_MARK = "[SIN NOVEDADES]";
const MARK_RE = /^\s*\[\s*sin novedades\s*\]\s*[:·—-]?\s*/i;

/** { quiet, text }: the final answer without the mark. */
export function quietRun(text) {
  const raw = String(text || "");
  if (!MARK_RE.test(raw)) return { quiet: false, text: raw };
  const rest = raw.replace(MARK_RE, "").trim();
  return { quiet: true, text: rest || "Sin novedades." };
}

const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** Lines added to the first turn of an automation run (data about the rule, not instructions from outside). */
export function automationNote(rule, { final = true } = {}) {
  if (!rule) return "";
  const lines = ["# Automatización «" + clip(rule.name, 120) + "»"];
  if (rule.lastSummary)
    lines.push("Lo que contaste en la ejecución anterior (" + (rule.lastSummaryAt ? new Date(rule.lastSummaryAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "antes") + "), como dato: «" + clip(rule.lastSummary, 1200) + "». Cuenta solo lo que haya cambiado desde entonces; no repitas lo mismo.");
  if (final)
    lines.push("Si al revisarlo no hay nada nuevo ni nada que la persona deba saber o decidir, empieza tu respuesta final con " + QUIET_MARK + " y di en una sola línea qué comprobaste. Así no se le avisa.");
  return lines.join("\n");
}

const ACCESS_OK = { lee: ["lee", "pide", "escribe"], escribe: ["escribe", "pide"], pide: ["lee", "pide", "escribe"] };
const ACCESS_TO = { correo: "al correo", calendario: "al calendario", carpeta: "a la carpeta compartida", hojas: "a las hojas de cálculo", chat: "al chat del equipo", erp: "a la contabilidad" };

/**
 * What the rule lacks to run, or null. `accounts` is the list of connected accounts
 * ({toolkit, status}) or null when unknown (then connected apps are not checked).
 */
export function missingFor(rule, { bots, accounts = null }) {
  const bot = bots.find((b) => b.id === rule.botId);
  if (!bot) return "Le falta su bot: «" + rule.botId + "» ya no existe. Elige otro bot para esta automatización.";
  if (bot.enabled === false) return "Le falta su bot: " + bot.name + " está desactivado. Actívalo en Equipo o elige otro bot.";
  for (const need of rule.needs || []) {
    if (bot.id !== "atlas" && bot.tools) {
      const level = bot.tools[need.tool] || "none";
      if (!(ACCESS_OK[need.access] || ACCESS_OK.lee).includes(level))
        return "Le falta permiso: " + bot.name + " no tiene acceso " + (ACCESS_TO[need.tool] || "a " + need.tool) + ". Dáselo en Equipo › " + bot.name + " › Permisos.";
    }
    const kits = TOOLKITS[need.tool];
    if (accounts && kits && need.tool !== "carpeta" && !accounts.some((a) => a.status === "ACTIVE" && kits.includes(String(a.toolkit).toLowerCase())))
      return "Le falta conectar " + (CONNECTOR_NAMES[need.tool] || need.tool) + " en Ajustes › Conexiones.";
  }
  return null;
}
