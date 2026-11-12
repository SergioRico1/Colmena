// Brakes for work the bots start by themselves (routines, triggers, watchers). The scheduler
// (scheduler.mjs) asks these before a self-started run begins; none of them calls a model.
//   · signature  — what a run is about: the rule + the normalised subject of the event (an
//                  email thread, a file path, what a webhook is about).
//   · loop limit — the same signature may start LOOP.limit runs in LOOP.windowMs; the next one
//                  stops the rule and tells the person once, with «Reanudar».
//   · chain      — rules that fire each other are cut at MAX_CHAIN_DEPTH (origin.mjs).
//   · join       — an event about work that is still open is added to it, not started again.
//   · digest     — a rule that fires more than DIGEST.limit times in DIGEST.windowMs collects
//                  the rest and delivers them as one run.
//   · proposal   — costly work a rule starts for the first time waits for the person's OK.
import { createHash } from "node:crypto";
import { botMonthTokens } from "./usage.mjs";

const HOUR = 3600_000;
export const LOOP = Object.freeze({ limit: 3, windowMs: 24 * HOUR });
export const DIGEST = Object.freeze({ limit: 5, windowMs: HOUR, holdMs: 30 * 60_000, max: 50 });
export const COST = Object.freeze({
  monthlyTokens: 3_000_000, // settings.limits.selfStartMonthlyTokens overrides it (null turns it off)
  soloTokens: 40_000, // a typical run of one bot, until the rule has runs of its own to average
  teamTokens: 160_000,
  budgetShare: 0.5, // «mostly consumed»: the month's estimate takes more than half of the bot's budget
  growth: 2, // asked again when the estimate doubles what the person said yes to
  snoozeMs: 24 * HOUR, // «Ahora no»
});
/** Mission states that count as open work: running, or waiting on the person. */
export const OPEN_STATUSES = new Set(["queued", "planning", "running", "waiting", "awaiting_plan", "awaiting_choice"]);

export const LOOP_TEXT = "Esta regla se ha disparado 3 veces por lo mismo hoy. La he parado; mira si es lo que quieres.";
export const CHAIN_TEXT = "Varias reglas se estaban poniendo en marcha unas a otras. He cortado la cadena aquí.";
export const NEVER_TEXT = "Dijiste «Nunca para esta regla», así que está parada. Actívala si cambias de idea.";

const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
/** «RE: Fwd: Factura 12 » → «factura 12». */
export const normalSubject = (s) => fold(s).replace(/^(?:(?:re|rv|fw|fwd|tr|resp)\s*(?:\[\d+\])?\s*:\s*)+/i, "").slice(0, 160);
const address = (s) => (/[^\s<>"']+@[^\s<>"']+/.exec(fold(s)) || [fold(s).slice(0, 80)])[0];

/**
 * What an event is about, normalised so that two events about the same thing are equal:
 * an email's thread (else its subject without «Re:» and its sender), a file's path, a calendar
 * event, a webhook's subject (webhooks.mjs: the pull request, the issue…). A person's message
 * in a room and a page change are each their own subject: they never repeat.
 */
export function eventSubject(event) {
  const d = event?.data || {};
  switch (event?.kind) {
    case "correo": return "correo:" + (d.hilo ? "hilo:" + d.hilo : normalSubject(d.asunto) + "|" + address(d.de));
    case "archivo": return "archivo:" + fold([d.carpeta, d.archivo].filter(Boolean).join("/")).replace(/\\/g, "/");
    case "evento": return "evento:" + String(event.id || "");
    case "sala": return d.de === "persona" ? "sala:mensaje:" + String(event.id || "") : "sala:" + String(d.missionId || d.sala || "");
    case "webhook": return "webhook:" + (d.asunto ? fold(d.asunto).slice(0, 200) : String(event.id || ""));
    default: return String(event?.kind || "evento") + ":" + String(event?.id || "");
  }
}

/** The signature of a self-started run: «<rule id>:<16 hex of the subject>». */
export function signatureOf(ruleId, event) {
  return String(ruleId) + ":" + createHash("sha256").update(eventSubject(event)).digest("hex").slice(0, 16);
}

/** Runs a signature started inside the loop window (since the rule was last resumed). */
export function startsOf(rule, signature, time = Date.now()) {
  const since = Math.max(time - LOOP.windowMs, Date.parse(rule?.loopResetAt || "") || 0);
  return (rule?.starts || []).filter((s) => s.s === signature && Date.parse(s.at) > since).length;
}
/** `rule.starts` with one more, without what fell out of the window. */
export function withStart(rule, signatures, time = Date.now()) {
  const at = new Date(time).toISOString();
  const kept = (rule?.starts || []).filter((s) => time - Date.parse(s.at) < LOOP.windowMs);
  return [...kept, ...signatures.filter(Boolean).map((s) => ({ s, at }))].slice(-300);
}

/** Arrival times of a rule's events in the last day (the digest reads the last hour of them). */
export function withArrival(rule, time = Date.now()) {
  return [...(rule?.arrivals || []).filter((t) => time - t < 24 * HOUR), time].slice(-400);
}
/** Whether a new event of this rule goes to the digest: one is already open, or it fires too often. */
export function digestNow(rule, time = Date.now()) {
  if (rule?.digest?.events?.length) return true;
  return (rule?.arrivals || []).filter((t) => time - t < DIGEST.windowMs).length >= DIGEST.limit;
}
/** `rule.digest` with one more event (the oldest go when it is full; they are counted). */
export function withDigest(rule, event, time = Date.now()) {
  const d = rule?.digest?.events?.length ? rule.digest : { events: [], dropped: 0, since: new Date(time).toISOString(), dueAt: new Date(time + DIGEST.holdMs).toISOString() };
  const events = [...d.events.filter((e) => e.id !== event.id), event];
  const over = Math.max(0, events.length - DIGEST.max);
  return { ...d, events: events.slice(over), dropped: (d.dropped || 0) + over };
}

const round = (n) => Math.round(n).toLocaleString("es-ES");
/** «unos 1,2 millones de tokens», «unos 400.000 tokens». */
export const tokensText = (n) => (n >= 1_000_000 ? "unos " + (Math.round(n / 100_000) / 10).toLocaleString("es-ES") + " millones de tokens" : "unos " + round(Math.round(n / 1000) * 1000) + " tokens");

/** The limit for work that starts by itself, per rule and month: a number, or null when turned off. */
export function selfStartLimit(settings) {
  const value = settings?.limits?.selfStartMonthlyTokens;
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : COST.monthlyTokens;
}

/** Tokens a run of this rule usually takes: the average of its last finished runs, else a typical figure. */
export function typicalTokens(store, rule) {
  const team = rule.botId === "atlas";
  const done = store.where("missions", "automationId", rule.id).filter((m) => m.status === "completed").slice(-5);
  const used = done.map((m) => store.where("usage", "missionId", m.id).reduce((n, u) => n + (Number(u.tokens) || 0), 0)).filter((n) => n > 0);
  if (used.length) return Math.round(used.reduce((a, b) => a + b, 0) / used.length);
  return team ? COST.teamTokens : COST.soloTokens;
}

/**
 * What starting this rule's work costs, by rules a person can follow:
 *   team    — it is team work (Atlas plans and several bots work);
 *   monthly — at the pace its events arrive, a month of runs passes the self-start limit;
 *   budget  — that month would take more than half of the bot's monthly budget.
 * → {reasons: [{id, text}], team, runs, tokens, monthly}; no reasons = not costly.
 */
export function costOf(store, rule, time = Date.now()) {
  const settings = store.get("settings", "main") || {};
  const team = rule.botId === "atlas";
  const perDay = Math.max(1, (rule.arrivals || []).filter((t) => time - t < 24 * HOUR).length);
  const runs = perDay * 30;
  const tokens = typicalTokens(store, rule);
  const monthly = runs * tokens;
  const reasons = [];
  if (team) reasons.push({ id: "team", text: "Es trabajo en equipo: Atlas lo reparte y trabajan varios bots." });
  const limit = selfStartLimit(settings);
  if (limit && monthly > limit)
    reasons.push({ id: "monthly", text: `Al ritmo de hoy serían unas ${round(runs)} veces al mes, ${tokensText(monthly)}: más de lo que tienes puesto para lo que empieza solo (${round(limit)}).` });
  const bot = team ? null : store.get("bots", rule.botId);
  const budget = Number(bot?.monthlyTokens) > 0 ? Number(bot.monthlyTokens) : null;
  if (budget && (monthly > budget * COST.budgetShare || botMonthTokens(store, bot.id) + tokens > budget))
    reasons.push({ id: "budget", text: `Se llevaría más de la mitad del presupuesto de ${bot.name} de este mes (${round(budget)} tokens).` });
  return { reasons, team, runs, tokens, monthly };
}

/**
 * Whether costly work has to be proposed first: null (go on), or the cost to show. The person
 * is asked the first time a rule would start costly work, and again only when it became team
 * work or its estimate grew past COST.growth times what they said yes to. «Siempre» ends it.
 * `adopt` in the result: the rule ran before this brake existed; its level is taken as known.
 */
export function costGate(store, rule, time = Date.now()) {
  if (rule.costly === "siempre") return null;
  const cost = costOf(store, rule, time);
  if (!cost.reasons.length) return null;
  const known = rule.costOk || null;
  if (!known) return rule.lastRun && !rule.costAsked ? { ...cost, adopt: true } : cost;
  if (cost.team && !known.team) return cost;
  if (cost.monthly > Math.max(known.monthly || 0, 1) * COST.growth && cost.reasons.some((r) => r.id !== "team")) return cost;
  return null;
}

export const START_TOOL = "start_work";
export const START_OPTIONS = Object.freeze([
  { id: "go", label: "Adelante", primary: true },
  { id: "later", label: "Ahora no" },
  { id: "never", label: "Nunca para esta regla" },
  { id: "always", label: "Siempre para esta regla" },
]);
