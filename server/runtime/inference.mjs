import { checkGoalBudget, spendOnGoal } from "../goals.mjs";
import { chooseModel } from "../models.mjs";
import { now } from "../store.mjs";
import { THINKING_EFFORT, RETRY, retryDelay, UNAVAILABLE_CODE, isTransientError } from "../provider.mjs";
import { checkLimit, record as recordUsage, crossedWarning } from "../usage.mjs";
import { usageLimitOf, limitError, engineName } from "../limits.mjs";
import { parseRef } from "../providers/catalog.mjs";
import { describeFailure, isChatStep, sha } from "./helpers.mjs";

/** Runtime methods: calling the model (retries, usage limits, hand-over to another engine) and choosing the model and effort of a step. */
export class InferenceMethods {
  /**
   * Inference wrapper: monthly cap before the call, usage after it, and recovery (OpenClaw
   * model-failover). A 429/5xx/timeout/network error is retried with the same model with
   * exponential backoff and jitter (~2 s, 6 s, 18 s; the provider's Retry-After when it says
   * one: provider.mjs retryDelay); nothing done is lost because the step history and receipts are
   * already saved, and a failed stream never returns tools to run. After the retries, the
   * local model (Ajustes › fallback 'local') answers that call; otherwise the error carries
   * UNAVAILABLE_CODE and the mission is paused. `params.timeoutMs` gives every attempt its
   * own deadline; `onRetry({attempt, max, wait, reason, status})` reports progress.
   */
  async infer(params, { missionId = null, botId = null, stepId = null, onRetry = null, retry = true } = {}) {
    checkLimit(this.store);
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
    let result, started = Date.now();
    // An engine that already ran out of its plan is not asked again until it renews (T3 Code
    // usage-limit recovery): the substitute answers, or the work waits for the renewal.
    const known = typeof hub?.limitOf === "function" ? hub.limitOf(engine) : null;
    if (known) {
      const next = hub.fallbackFor(rest.model);
      if (!next) throw limitError(engine, known);
      started = Date.now();
      result = await this.handOver(next, attemptParams(), { engine, reason: known.label, limit: known, stepId, onRetry, max: retries });
    } else for (let attempt = 0; ; attempt++) {
      try {
        started = Date.now();
        result = await this.provider.respond(attemptParams());
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
          if (next) result = await this.handOver(next, attemptParams(), { engine, reason, limit: usageLimit ? limit : null, stepId, onRetry, max: retries });
          else {
            onRetry?.({ attempt: null, max: retries, wait: 0, reason, status: "fallback", to: "el modelo local" });
            const { fallback: _f, webSearch: _w, ...bare } = attemptParams();
            result = await local.respond({ ...bare, reasoning: null });
          }
          break;
        }
        onRetry?.({ attempt: null, max: retries, wait: 0, reason, status: "failed", message: error.message });
        if (usageLimit) throw limitError(engine, limit, error);
        if (accountFailure) throw error;
        const who = { anthropic: "Claude", "opencode-go": "OpenCode Go" }[error?.engine] || "OpenAI";
        throw Object.assign(
          Error(`${who} no responde (${reason}) tras ${retries} reintentos. La misión queda en pausa: pulsa «Continuar» cuando vuelva; lo hecho se conserva.`),
          { code: UNAVAILABLE_CODE, cause: error },
        );
      }
    }
    if (result?.limits) this.planLimits = result.limits;
    if (result?.usage) {
      const effort = typeof rest.reasoning === "string" ? rest.reasoning : rest.reasoning?.effort || null;
      const entry = recordUsage(this.store, { missionId, botId, stepId, tokens: result.usage, ms: Date.now() - started, model: result.model || rest.model || null, effort, transport: result.transport || null, timing: result.timing || null, purpose: rest.purpose || (retry ? "step" : "side"), tools: Array.isArray(rest.tools) ? rest.tools.length : null });
      const spent = missionId && entry ? spendOnGoal(this.store, missionId, entry.tokens) : null;
      if (spent) this.store.event(missionId, "goal_budget", { text: "El objetivo «" + spent.title + "» ha gastado su presupuesto" });
      if (missionId && crossedWarning(this.store))
        this.store.event(missionId, "usage_warning", { text: "Se ha usado el 80 % del limite mensual del espacio." });
    }
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
  async handOver(next, params, { engine, reason, limit = null, stepId = null, onRetry = null, max = 0 }) {
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
      const out = await next.provider.respond({ ...plain, instructions: (plain.instructions || "") + note, model: next.model, ...(isLocal ? { reasoning: null, webSearch: false } : {}) });
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
