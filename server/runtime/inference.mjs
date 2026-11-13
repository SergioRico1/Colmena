import { checkGoalBudget, spendOnGoal } from "../goals.mjs";
import { chooseModel } from "../models.mjs";
import { now } from "../store.mjs";
import { THINKING_EFFORT, RETRY, retryDelay, UNAVAILABLE_CODE, isTransientError } from "../provider.mjs";
import { record as recordUsage, crossedWarning } from "../usage.mjs";
import { parkError, LONG_TURN_CALLS } from "../admission.mjs";
import { CONTEXT, estimateTokens } from "../context.mjs";
import { usageLimitOf, limitError, engineName } from "../limits.mjs";
import { parseRef } from "../providers/catalog.mjs";
import { describeFailure, isChatStep, sha } from "./helpers.mjs";

/** What a request would send, in tokens (instructions, history and tools): an estimate. */
const inputEstimate = (params) => estimateTokens(params.instructions) + estimateTokens(params.input) + estimateTokens(params.tools);

/** Runtime methods: calling the model (the gate before it, retries, usage limits, hand-over to another engine) and choosing the model and effort of a step. */
export class InferenceMethods {
  /**
   * The gate of every model call (admission.mjs decides; this says what the call is):
   * {ok, reservation} | {park} | {refuse}. Long work parks when little is left of the plan of
   * the engine it would use; a call whose worst case (input estimate + the model's maximum
   * answer) does not fit in the bot's month or the space's is refused.
   */
  admit({ engine, missionId = null, botId = null, stepId = null, side = false, interactive = false, limited = false, params = {} }) {
    const out = this.admission.admit({
      engine, botId, limited,
      work: () => this.workOf({ missionId, stepId, side, interactive }),
      need: () => inputEstimate(params) + this.contextBudget(params.model).maxOutput,
    });
    if (out.ok && missionId && !side) this.turnCalls.set(missionId, (this.turnCalls.get(missionId) || 0) + 1);
    return out;
  }
  /**
   * What a call is for the plan gate: 'chat' (the person is waiting for it: never parked),
   * 'long' (parked when little is left of the plan) or 'side' (skipped then). Long work is:
   *   · a run nobody is watching: started by a routine or a trigger (also the turn a routine
   *     opens in a room), by the watcher or by another person's errand, or one that went on by
   *     itself (after a restart, or when a limit renewed) — until the person writes in it;
   *   · a mission that already made LONG_TURN_CALLS model calls since the person last wrote in
   *     it or pressed «Continuar».
   * «Continuar» makes the whole run the person's ('chat'). Side jobs (titles, narration,
   * recaps, learning, the watcher, check-ins) are 'side' unless the caller says `interactive`.
   */
  workOf({ missionId = null, stepId = null, side = false, interactive = false }) {
    if (interactive) return "chat";
    const mission = !side && missionId ? this.store.get("missions", missionId) : null;
    if (!mission) return "side";
    const origin = this.runOrigin.get(missionId);
    if (origin === "go") return "chat";
    if (origin === "auto") return "long";
    // The turn answers a message: the person's, or the one a routine wrote in a room.
    const step = stepId ? this.store.get("steps", stepId) : null;
    const asked = step?.ackOn ? this.store.get("messages", step.ackOn) : null;
    // Another person's request to one of your bots (server/room-work.mjs): nobody of this
    // computer is waiting for it, so it is long work — unless its owner approved it just now
    // (`attended`: they are here; it then counts calls like any turn of theirs).
    if (step?.roomAsk && !step.attended) return "long";
    if (asked ? !!asked.automationId : !!(mission.automationId || mission.watch || mission.peerErrand)) return "long";
    return (this.turnCalls.get(missionId) || 0) >= LONG_TURN_CALLS ? "long" : "chat";
  }
  /** The person wrote in a mission: its next calls are theirs again (a fresh turn). */
  personSpoke(missionId) {
    this.turnCalls.delete(missionId);
    if (this.runOrigin.get(missionId) === "auto") this.runOrigin.delete(missionId);
  }
  /** Usage of one call into the month, the bot's month and the mission's goal. */
  countUsage(usage, { missionId = null, botId = null, stepId = null, ...details }) {
    const entry = recordUsage(this.store, { missionId, botId, stepId, tokens: usage, ...details });
    const spent = missionId && entry ? spendOnGoal(this.store, missionId, entry.tokens) : null;
    if (spent) this.store.event(missionId, "goal_budget", { text: "El objetivo «" + spent.title + "» ha gastado su presupuesto" });
    if (missionId && entry && crossedWarning(this.store))
      this.store.event(missionId, "usage_warning", { text: "Se ha usado el 80 % del limite mensual del espacio." });
    return entry;
  }
  /**
   * One provider call. When it dies half-way (a cut stream, a failure after it started, a
   * stop) what it had used is still counted: the provider's own figure when the error carries
   * one, else an estimate (what was sent, plus the text that had arrived), marked as such. A
   * call that never started (no connection, a refusal) used nothing.
   */
  async metered(params, count, send) {
    let chars = 0, begun = false;
    const watched = {
      ...params,
      onDelta: (delta) => { begun = true; chars += String(delta || "").length; return params.onDelta?.(delta); },
      onEvent: (event) => { begun = true; return params.onEvent?.(event); },
    };
    const started = Date.now();
    try {
      return await send(watched);
    } catch (error) {
      const said = error?.usage && typeof error.usage === "object" ? error.usage : null;
      const usage = said || (begun ? { input_tokens: inputEstimate(params), output_tokens: Math.ceil(chars / CONTEXT.charsPerToken) } : null);
      if (usage) try { this.countUsage(usage, { ...count, ms: Date.now() - started, partial: true, estimated: !said }); } catch {}
      throw error;
    }
  }
  /**
   * Inference wrapper: the gate before the call (admit), usage after it, and recovery (OpenClaw
   * model-failover). A 429/5xx/timeout/network error is retried with the same model with
   * exponential backoff and jitter (~2 s, 6 s, 18 s; the provider's Retry-After when it says
   * one: provider.mjs retryDelay); nothing done is lost because the step history and receipts are
   * already saved, and a failed stream never returns tools to run. After the retries, the
   * local model (Ajustes › fallback 'local') answers that call; otherwise the error carries
   * UNAVAILABLE_CODE and the mission is paused. `params.timeoutMs` gives every attempt its
   * own deadline; `onRetry({attempt, max, wait, reason, status})` reports progress.
   */
  async infer(params, { missionId = null, botId = null, stepId = null, onRetry = null, retry = true, interactive = false } = {}) {
    if (missionId) checkGoalBudget(this.store, missionId);
    const { timeoutMs, ...rest } = params;
    // One cache key per bot and mission: its rounds (and its next turns) reuse the prefix
    // OpenAI already processed — the same system prompt, tools and earlier history.
    // Side tasks (no retry: titles, narration…) get their own key, so they never take the
    // bot's warm connection or its continuation.
    if (!rest.cacheKey && missionId && botId) rest.cacheKey = this.cacheKeyFor(missionId, botId, !retry);
    // A side task outside a mission (watcher, check-ins, reviewer): calls with the same
    // instructions share a key, so OpenAI routes them where that prefix is already cached.
    if (!rest.cacheKey && typeof rest.instructions === "string" && rest.instructions) rest.cacheKey = "colmena-side-" + sha(rest.instructions).slice(0, 32);
    if (!retry) rest.side = true;
    // Fixed waits when given (tests); otherwise RETRY's backoff with jitter. Either way a
    // provider's Retry-After wins (provider.mjs retryDelay).
    const fixed = Array.isArray(this.retryDelays) ? this.retryDelays : null;
    const retries = !retry ? 0 : fixed ? fixed.length : RETRY.retries;
    const delayFor = (attempt, error) => retryDelay(attempt, { error, base: fixed ? fixed[attempt] : null });
    const base = rest.signal;
    const attemptParams = () => ({ ...rest, fallback: false, signal: timeoutMs ? (base ? AbortSignal.any([base, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)) : base });
    const hub = typeof this.provider?.fallbackFor === "function" ? this.provider : null;
    const engine = this.engineOfModel(rest.model);
    // An engine that already ran out of its plan is not asked again until it renews (T3 Code
    // usage-limit recovery): the substitute answers, or the work waits for the renewal.
    const known = typeof hub?.limitOf === "function" ? hub.limitOf(engine) : null;
    const effort = typeof rest.reasoning === "string" ? rest.reasoning : rest.reasoning?.effort || null;
    const count = { missionId, botId, stepId, model: rest.model || null, effort, purpose: rest.purpose || (retry ? "step" : "side"), tools: Array.isArray(rest.tools) ? rest.tools.length : null };
    // The one gate: long work waits when little is left of the plan; the worst case of the
    // call is reserved in the bot's month and the space's until it ends, however it ends.
    const gate = this.admit({ engine, missionId, botId, stepId, side: !retry, interactive, limited: !!known, params: rest });
    if (gate.refuse) throw gate.refuse;
    if (gate.park) throw parkError(gate.park);
    try {
      return await this.inferAdmitted({ rest, attemptParams, hub, engine, known, retries, delayFor, base, count, stepId, onRetry });
    } finally {
      this.admission.settle(gate.reservation);
    }
  }
  /** The call itself, once admitted: attempts, backoff, hand-over, and the usage of what answered. */
  async inferAdmitted({ rest, attemptParams, hub, engine, known, retries, delayFor, base, count, stepId, onRetry }) {
    let result, started = Date.now();
    if (known) {
      const next = hub.fallbackFor(rest.model);
      if (!next) throw limitError(engine, known);
      started = Date.now();
      result = await this.handOver(next, attemptParams(), { engine, reason: known.label, limit: known, stepId, onRetry, max: retries, count });
    } else for (let attempt = 0; ; attempt++) {
      try {
        started = Date.now();
        result = await this.metered(attemptParams(), count, (p) => this.provider.respond(p));
        break;
      } catch (error) {
        if (base?.aborted) throw error;
        // The plan or quota ran out: retrying the same engine is pointless until it renews.
        const limit = error?.limit || usageLimitOf(error);
        const usageLimit = limit?.kind === "usage";
        // The account itself failed (no access, no credit): straight to the substitute engine.
        const accountFailure = [401, 402, 403].includes(error?.status) || usageLimit;
        if (!usageLimit && !isTransientError(error) && !(accountFailure && hub?.fallbackFor(rest.model))) throw error;
        const reason = usageLimit ? limit.label : describeFailure(error);
        if (attempt < retries && !accountFailure) {
          const wait = delayFor(attempt, error);
          onRetry?.({ attempt: attempt + 1, max: retries, wait, reason, status: "waiting" });
          await this.wait(wait, base);
          continue;
        }
        // Ajustes › Si falla, usar: another engine with the same family, or the local model.
        const next = hub ? hub.fallbackFor(rest.model) : null;
        const local = !next && typeof this.provider?.fallbackProvider === "function" ? this.provider.fallbackProvider() : null;
        if (next || local) {
          if (next) result = await this.handOver(next, attemptParams(), { engine, reason, limit: usageLimit ? limit : null, stepId, onRetry, max: retries, count });
          else {
            onRetry?.({ attempt: null, max: retries, wait: 0, reason, status: "fallback", to: "el modelo local" });
            const { fallback: _f, webSearch: _w, ...bare } = attemptParams();
            result = await this.metered({ ...bare, reasoning: null }, count, (p) => local.respond(p));
          }
          break;
        }
        onRetry?.({ attempt: null, max: retries, wait: 0, reason, status: "failed", message: error.message });
        if (usageLimit) throw limitError(engine, limit, error);
        if (accountFailure) throw error;
        const who = error?.engine && error.engine !== "openai" ? engineName(error.engine) : "OpenAI";
        throw Object.assign(
          Error(`${who} no responde (${reason}) tras ${retries} reintentos. La misión queda en pausa: pulsa «Continuar» cuando vuelva; lo hecho se conserva.`),
          { code: UNAVAILABLE_CODE, cause: error },
        );
      }
    }
    // How much of its plan the engine that answered has used (only ChatGPT says): shown in
    // Ajustes › Uso, and what the gate reads before the next long call.
    if (result?.limits) {
      this.planLimits = result.limits;
      this.admission.notePlan(result.engine || engine, result.limits);
    }
    if (result?.usage) this.countUsage(result.usage, { ...count, ms: Date.now() - started, model: result.model || rest.model || null, transport: result.transport || null, timing: result.timing || null });
    return result;
  }
  /** The engine a model runs on, as the hub routes it (a bare ChatGPT slug may become the team's engine). */
  engineOfModel(model) {
    const resolved = typeof this.provider?.resolveModel === "function" ? this.provider.resolveModel(model) : model;
    return parseRef(resolved).engine;
  }
  /**
   * The substitute engine answers this call (Ajustes › Si falla, usar) without losing the
   * turn: it reads the same step transcript (the old engine's native items are dropped by
   * every adapter), its instructions say it takes over, and the room hears it once per step.
   * If the substitute is out of its plan too, it is marked and the work waits for a renewal.
   */
  async handOver(next, params, { engine, reason, limit = null, stepId = null, onRetry = null, max = 0, count = null }) {
    const step = stepId ? this.store.get("steps", stepId) : null;
    if (!step || step.handedTo !== next.engine) {
      if (step) this.store.patch("steps", stepId, { handedTo: next.engine, handoff: { from: engine, to: next.engine, label: next.label, reason, limited: !!limit, at: now() } });
      onRetry?.({ attempt: null, max, wait: 0, reason, status: "fallback", to: next.label, from: engineName(engine), limited: !!limit });
    }
    const { fallback: _f, ...plain } = params;
    const isLocal = next.provider === this.provider?.local;
    const note = "\n\n[Colmena] Sigues tú con " + next.label + ": " + engineName(engine) + (limit ? " ha llegado a su " + limit.label : " no responde") +
      ". Lo anterior de este turno lo hizo otro modelo; continúa desde donde se quedó, sin repetir lo que ya está hecho.";
    try {
      const sent = { ...plain, instructions: (plain.instructions || "") + note, model: next.model, ...(isLocal ? { reasoning: null, webSearch: false } : {}) };
      const out = count ? await this.metered(sent, { ...count, model: next.model }, (p) => next.provider.respond(p)) : await next.provider.respond(sent);
      return { ...out, model: next.model, engine: next.engine, fellBack: next.label, switched: { from: engine, to: next.engine, reason, limited: !!limit } };
    } catch (error) {
      if (plain.signal?.aborted) throw error;
      const own = usageLimitOf(error);
      const marked = own?.kind === "usage" && typeof this.provider?.markLimited === "function" ? this.provider.markLimited(next.engine, own) : null;
      if (limit) throw limitError(engine, limit, error);
      if (own?.kind === "usage") throw limitError(next.engine, marked || own, error);
      throw error;
    }
  }
  /** The prompt-cache key (and warm socket) of a bot in a mission; side tasks get their own. */
  cacheKeyFor(missionId, botId, side = false) {
    return "colmena-" + sha(missionId + ":" + botId + (side ? ":side" : "")).slice(0, 40);
  }
  /**
   * You started typing in a chat or a room: open the socket of the bot that will answer, so
   * its first round does not wait for the handshake (as Codex and Claude Desktop warm up).
   */
  async warm(missionId) {
    const m = this.store.get("missions", missionId);
    if (!m || typeof this.provider?.warm !== "function") return false;
    const botId = m.conversation || m.mode === "solo" ? m.botIds?.[0] : "atlas";
    return botId ? this.provider.warm(this.cacheKeyFor(missionId, botId)) : false;
  }
  /** Waits `ms` unless the mission stops first. */
  wait(ms, signal) {
    if (typeof this.sleep === "function") return this.sleep(ms, signal);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(() => { signal?.removeEventListener?.("abort", stop); resolve(); }, ms);
      const stop = () => { clearTimeout(timer); reject(signal.reason); };
      signal?.addEventListener?.("abort", stop, { once: true });
    });
  }
  /**
   * Models a bot can think with: those of its engine (its own choice in Ajustes, else the
   * team's: ChatGPT, Claude or OpenCode Go). ChatGPT keeps the account's list; a local model
   * keeps its own.
   */
  availableModels(bot = null) {
    if (typeof this.provider?.modelsFor === "function") return this.provider.modelsFor(this.provider.engineFor?.(bot) ?? undefined);
    if (this.provider?.kind === "local") return [];
    const list = this.provider?.session?.models;
    return Array.isArray(list) ? list : [];
  }
  /** Colmena picks the model for each bot (NEXO families Luna/Sol/Astra, highest version). */
  modelFor(bot, fallback) {
    return chooseModel(bot, this.availableModels(bot), this.fallbackModel(bot, fallback)).slug || this.fallbackModel(bot, fallback);
  }
  /**
   * The account default (a ChatGPT slug) only for bots that think with ChatGPT; a bot on
   * Claude or OpenCode Go falls back to its own engine's first model, never to ChatGPT.
   */
  fallbackModel(bot, fallback) {
    const engine = typeof this.provider?.engineFor === "function" ? this.provider.engineFor(bot) : "openai";
    if (!engine || engine === "openai") return fallback;
    return this.availableModels(bot)[0]?.slug || fallback;
  }
  reasoningFor(bot) {
    const effort = THINKING_EFFORT[bot?.thinking];
    return effort ? { effort } : null;
  }
  /**
   * Effort for one step (fixed for the whole step). «Rápido» and «A fondo» in the bot's
   * profile always win. With «Equilibrado» (the default), answering you in a chat or a room
   * thinks «low» — that is most of the waiting — and real work (an encargo, a plan, a
   * synthesis, a critique) thinks «medium», as Codex and OpenClaw do with their levels.
   */
  effortForStep(bot, step, mission) {
    const chosen = bot?.thinking;
    if (chosen === "rapido" || chosen === "profundo") return THINKING_EFFORT[chosen];
    if (!THINKING_EFFORT.equilibrado) return null;
    return isChatStep(step, mission) ? "low" : THINKING_EFFORT.equilibrado;
  }
  /**
   * Model for one step. The coordinator's heaviest family pays off when it plans or splits
   * work; when it only answers you, the next family down replies in about half the time.
   * A family chosen in the bot's profile is always kept.
   */
  modelForStep(bot, step, mission, fallback) {
    if (!bot?.modelFamily && (isChatStep(step, mission) || ["plan", "delegate"].includes(step.kind)) && /astra/i.test(this.modelFor(bot, fallback))) {
      const lighter = chooseModel({ ...bot, modelFamily: "sol" }, this.availableModels(bot), this.fallbackModel(bot, fallback)).slug;
      if (lighter) return lighter;
    }
    return this.modelFor(bot, fallback);
  }
  /**
   * Model of a new step: the bot's own (modelForStep), unless its engine is out of its plan
   * right now and another engine can answer — then that one's, from the first round.
   */
  stepModel(bot, step, mission, fallback) {
    const chosen = this.modelForStep(bot, step, mission, fallback);
    const hub = typeof this.provider?.limitOf === "function" ? this.provider : null;
    if (!hub || !hub.limitOf(this.engineOfModel(chosen))) return chosen;
    try {
      const next = hub.fallbackFor(chosen);
      return next && next.provider !== hub.local ? next.model : chosen;
    } catch {
      return chosen;
    }
  }
}
