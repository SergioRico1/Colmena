// The one gate before a model call: «may this call run now?» (Runtime#infer asks it, nobody
// else decides). Two reasons to say no:
//   · park   — the plan window of the engine the call would use is almost used up, and the call
//              is long or background work: it waits for the renewal («Limitado»), so the person
//              can keep chatting with what is left. What the person just wrote is never parked.
//   · refuse — the call's worst case (input estimate + the model's maximum answer) does not fit
//              in the bot's monthly budget or in the space's monthly limit (LIMIT_CODE).
// A call that may run holds a reservation of that worst case until it ends; the real usage is
// what gets recorded (usage.mjs). Reservations live in memory only: a restart forgets them.
import { engineName, whenText, PROVIDER_LIMIT_CODE } from "./limits.mjs";
import { LIMIT_CODE, monthTokens, botMonthTokens } from "./usage.mjs";

/** Long work parks from this share of the plan window on (Ajustes › Uso; null there turns it off). */
export const PLAN_PAUSE_DEFAULT = 95;
/** Model calls of one mission since the person last wrote in it; from here on it is long work. */
export const LONG_TURN_CALLS = 12;
/** A reading without a renewal time is trusted this long (with one, until that time). */
export const PLAN_READING_MS = 15 * 60_000;
const WEEK_MS = 7 * 86_400_000;

/** The threshold in percent, or null when the person turned the pause off. */
export function planPauseAt(settings) {
  const value = settings?.limits?.planPauseAt;
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : PLAN_PAUSE_DEFAULT;
}

/** «de 5 horas», «semanal», «diario» for a window length in minutes (as limits.mjs words them). */
function windowWords(minutes) {
  if (!(minutes > 0)) return null;
  if (minutes >= 7 * 1440 - 60) return "semanal";
  if (minutes >= 1380 && minutes <= 1500) return "diario";
  return minutes >= 60 ? "de " + Math.round(minutes / 60) + " horas" : null;
}

/** The line a parked mission shows. */
export function parkMessage(engine, { percent, resetsAt }, at = Date.now()) {
  const when = resetsAt ? whenText(resetsAt, at) : null;
  return `Queda poco del plan de ${engineName(engine)} (${percent} % usado). Lo dejo en pausa para que puedas seguir chateando; sigue solo cuando se renueve${when ? ", " + when : ""}.`;
}

/** The error a parked call ends with: the «Limitado» path of a mission (Runtime#run), with `limit.plan`. */
export function parkError(park) {
  return Object.assign(Error(park.text), { code: PROVIDER_LIMIT_CODE, engine: park.engine, limit: park.limit, parked: true });
}

const tokensText = (n) => Math.round(n).toLocaleString("es-ES");

export class Admission {
  constructor(store) {
    this.store = store;
    this.plans = new Map(); // engine → {primary, secondary, at}: the last plan windows it reported
    this.held = new Map(); // reservation id → {id, botId, tokens}
    this.seq = 0;
  }
  /** What a provider just said about its plan windows (provider.mjs planLimitsOf); null is ignored. */
  notePlan(engine, limits) {
    if (engine && limits && (limits.primary || limits.secondary)) this.plans.set(engine, limits);
  }
  /**
   * The windows of an engine that can still be believed: reported by the provider, with a real
   * percent, and either not yet renewed (usage inside a window only grows, so the reading holds
   * until its renewal) or, when it gave no renewal time, seen in the last PLAN_READING_MS.
   */
  planWindows(engine, at = Date.now()) {
    const seen = this.plans.get(engine);
    const seenAt = Date.parse(seen?.at || "");
    if (!seen || !Number.isFinite(seenAt) || seenAt > at + 60_000) return [];
    return [seen.primary, seen.secondary].filter((w) => {
      if (!w || typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return false;
      const reset = Date.parse(w.resetsAt || "");
      if (!Number.isFinite(reset)) return at - seenAt <= PLAN_READING_MS;
      return reset > at && at - seenAt <= (w.windowMinutes > 0 ? w.windowMinutes * 60_000 : WEEK_MS);
    });
  }
  /** Why long work on this engine should wait now: {engine, percent, resetsAt, limit, text}, or null. */
  planPark(engine, at = Date.now()) {
    const threshold = planPauseAt(this.store.get("settings", "main"));
    if (threshold === null) return null;
    const full = this.planWindows(engine, at).filter((w) => w.usedPercent >= threshold);
    if (!full.length) return null;
    // Every window that is almost used up has to renew: the latest one decides.
    const last = full.reduce((a, b) => (Date.parse(b.resetsAt || "") > Date.parse(a.resetsAt || "") || !a.resetsAt ? b : a));
    const known = full.every((w) => w.resetsAt);
    const percent = Math.max(...full.map((w) => w.usedPercent));
    const window = windowWords(last.windowMinutes);
    const resetsAt = known ? last.resetsAt : null;
    const limit = { kind: "plan", plan: true, percent, window, label: window ? "límite " + window : "límite de uso", resetsAt };
    return { engine, percent, resetsAt, limit, text: parkMessage(engine, { percent, resetsAt }, at) };
  }
  /** Tokens reserved by calls in flight: all of them, or one bot's. */
  reserved(botId = null) {
    let total = 0;
    for (const r of this.held.values()) if (!botId || r.botId === botId) total += r.tokens;
    return total;
  }
  /**
   * May this call run now? `call` = {engine, botId, work, need, limited}:
   *   work    — 'chat' (the person is waiting for it), 'long' or 'side'; or a function giving it
   *   need    — the call's worst case in tokens; or a function giving it (only asked with a cap)
   *   limited — the engine already ran out (limits.mjs handles that): no plan check
   * → {ok: true, reservation} | {park: {engine, percent, resetsAt, limit, text}} | {refuse: Error}
   * A reservation must be given back with settle(), whatever happens to the call.
   */
  admit({ engine = null, botId = null, work = "chat", need = 0, limited = false } = {}, at = Date.now()) {
    const park = engine && !limited ? this.planPark(engine, at) : null;
    if (park && (typeof work === "function" ? work() : work) !== "chat") return { park };
    const limits = this.store.get("settings", "main")?.limits || {};
    const space = limits.pauseAtLimit && Number(limits.monthlyTokens) > 0 ? Number(limits.monthlyTokens) : null;
    const bot = botId ? this.store.get("bots", botId) : null;
    const own = Number(bot?.monthlyTokens) > 0 ? Number(bot.monthlyTokens) : null;
    if (!space && !own) return { ok: true, reservation: null };
    const tokens = Math.max(0, Math.ceil(Number(typeof need === "function" ? need() : need) || 0));
    // Something must be left, and beside calls in flight the whole worst case must fit. A call
    // alone runs while anything is left (as the space limit always did): otherwise the last
    // stretch of a budget, smaller than one worst case, could never be used.
    const fits = (used, held, cap) => used + held < cap && (!held || used + held + tokens <= cap);
    if (own && !fits(botMonthTokens(this.store, botId), this.reserved(botId), own))
      return { refuse: Object.assign(Error(`${bot.name} ha llegado a su presupuesto de este mes (${tokensText(own)} tokens). Súbelo en su ficha, en «Uso», o espera al mes que viene.`), { code: LIMIT_CODE, botId, budget: own }) };
    if (space && !fits(monthTokens(this.store), this.reserved(), space))
      return { refuse: Object.assign(Error("Se ha alcanzado el límite mensual del espacio."), { code: LIMIT_CODE }) };
    const reservation = { id: ++this.seq, botId, tokens };
    this.held.set(reservation.id, reservation);
    return { ok: true, reservation };
  }
  /** The call ended (answered, failed or cut): its reservation goes; what it really used is in usage.mjs. */
  settle(reservation) {
    if (reservation) this.held.delete(reservation.id);
  }
}
