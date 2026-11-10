import { cheapestModel } from "../checkins.mjs";
import { RECAP, RECAP_INSTRUCTIONS, cleanRecap, recapInput } from "../recaps.mjs";
import { QUIET_MARK } from "../quiet.mjs";
import { NARRATION, NARRATION_INSTRUCTIONS, narrationDue, narrationInput, cleanNarration } from "../narration.mjs";
import { now } from "../store.mjs";
import { learnFromMission, learnNow as learnNowFor, learningTick, condenseUserProfile } from "../learning.mjs";
import { visibleMessages } from "../branches.mjs";
import { SUGGEST_INSTRUCTIONS, TITLE_INSTRUCTIONS, learningSummary } from "./helpers.mjs";

/** Runtime methods: the small jobs beside the work (suggested replies, room recaps, chat titles, narration) and what the team learns after a mission. */
export class SideJobMethods {
  /**
   * «Sugerencias» for the composer (OpenClaw next-message predictions): after a bot answers,
   * the cheapest model proposes up to three short replies the person would likely write.
   * They only fill the box when clicked (or with Tab): nothing is sent by itself. Off with
   * settings.suggestions === false; never for automations; failures are silent.
   */
  async suggestNext(missionId) {
    if (!this.suggest || this.settings().suggestions === false) return null;
    const m = this.store.get("missions", missionId);
    // Never in incognito: they would be kept in its record.
    if (!m || m.automationId || m.incognito) return null;
    const said = () => visibleMessages(this.store.get("missions", missionId), this.store.where("messages", "missionId", missionId)).filter((x) => (!x.kind || x.kind === "message") && x.text).at(-1);
    const last = said();
    if (!last || last.role !== "assistant") return null;
    const model = cheapestModel(this.availableModels());
    if (!model) return null;
    try {
      const turns = this.conversationTurns(missionId).slice(-6).map((t) => ({ ...t, content: String(t.content).slice(0, 2500) }));
      const result = await this.infer({
        model, tools: [], reasoning: { effort: "low" }, timeoutMs: 30000,
        instructions: SUGGEST_INSTRUCTIONS,
        input: [{ role: "user", content: JSON.stringify({ conversacion: turns }) }],
      }, { missionId, botId: last.botId || "atlas", retry: false });
      let list = [];
      try { list = JSON.parse(String(result?.text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "")).sugerencias || []; } catch {}
      list = [...new Set(list.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter((x) => x && x.length <= 80))].slice(0, 3);
      const fresh = this.store.get("missions", missionId);
      const still = said();
      // Only when they add something: one lone suggestion is noise.
      if (!fresh || still?.id !== last.id || list.length < 2) return null;
      this.store.patch("missions", missionId, { suggestions: { forMessageId: last.id, list } });
      return list;
    } catch {
      return null;
    }
  }
  /**
   * Room recap: after a room settles (and on «Reintentar resumen», with force) the cheapest
   * model sums it up in 1–3 sentences. Nothing new since the last recap → no call. Off with
   * settings.recaps === false; never for chats or incognito rooms.
   */
  async recapRoom(missionId, { force = false } = {}) {
    if (!force && (!this.recaps || this.settings().recaps === false)) return null;
    const m = this.store.get("missions", missionId);
    if (!m || m.conversation || m.incognito) return null;
    const messages = this.store.where("messages", "missionId", missionId).filter((x) => ["user", "assistant"].includes(x.role) && (!x.kind || x.kind === "message" || x.kind === "deliverable") && String(x.text || "").trim() && !String(x.text).includes(QUIET_MARK));
    if (messages.length < RECAP.minMessages) return null;
    const last = messages.at(-1);
    if (!force && m.recap?.upto === last.id && m.recap?.status === "ok") return m.recap;
    const model = cheapestModel(this.availableModels());
    if (!model) return null;
    this.store.patch("missions", missionId, { recap: { ...(m.recap || {}), status: "writing" } });
    try {
      const result = await this.infer({
        model, tools: [], reasoning: { effort: "low" }, timeoutMs: RECAP.timeoutMs, instructions: RECAP_INSTRUCTIONS,
        input: [{ role: "user", content: recapInput(m, messages, (botId) => this.bot(botId)?.name || botId || "Un bot") }],
      }, { missionId, botId: "atlas", retry: false });
      const text = cleanRecap(result?.text);
      if (!text) throw Error("Resumen vacío.");
      const recap = { text, at: new Date().toISOString(), upto: last.id, count: messages.length, status: "ok" };
      if (this.store.get("missions", missionId)) this.store.patch("missions", missionId, { recap });
      return recap;
    } catch {
      if (this.store.get("missions", missionId)) this.store.patch("missions", missionId, { recap: { ...(m.recap || {}), status: "failed", failedAt: new Date().toISOString() } });
      return null;
    }
  }
  /**
   * A chat starts named after its first message («Hola»); after the first answer the cheapest
   * model gives it a short title (as ChatGPT does). Never over a name you gave it.
   */
  async nameConversation(missionId) {
    if (!this.autoTitle) return null;
    const m = this.store.get("missions", missionId);
    if (!m?.conversation || m.titled || m.incognito) return null;
    const turns = this.conversationTurns(missionId);
    if (!turns.some((t) => t.role === "assistant")) return null;
    const model = cheapestModel(this.availableModels());
    if (!model) return null;
    try {
      const result = await this.infer({
        model, tools: [], reasoning: { effort: "low" }, timeoutMs: 20000, instructions: TITLE_INSTRUCTIONS,
        input: [{ role: "user", content: JSON.stringify({ conversacion: turns.slice(0, 4).map((t) => ({ ...t, content: String(t.content).slice(0, 1500) })) }) }],
      }, { missionId, botId: m.botIds?.[0] || "atlas", retry: false });
      const title = String(result?.text || "").split("\n")[0].replace(/^["'«“\s]+|["'»”.\s]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
      const fresh = this.store.get("missions", missionId);
      if (!title || title.length < 3 || !fresh || fresh.titled) return null;
      this.store.patch("missions", missionId, { title, titled: true });
      return title;
    } catch {
      return null;
    }
  }
  /**
   * «Ya tengo dos tarifas; me falta la de Iberdrola»: during long work (from 20 s, every 15 s,
   * at most 12 per step) the cheapest model writes what the bot is doing, from its last
   * actions. Saved on the step (step.narration), so the room, the chat and the sidebar show
   * it. Off with settings.narration === false; failures are silent.
   */
  maybeNarrate(missionId, stepId, bot) {
    if (!this.narrate || this.settings().narration === false || this.narrating.has(stepId)) return;
    const step = this.store.get("steps", stepId);
    const mission = this.store.get("missions", missionId);
    if (!narrationDue(step) || !mission || mission.automationId) return;
    const model = cheapestModel(this.availableModels());
    if (!model) return;
    this.narrating.add(stepId);
    this.store.patch("steps", stepId, { narrations: (step.narrations || 0) + 1, narration: { ...(step.narration || {}), at: now() } });
    void (async () => {
      try {
        const result = await this.infer({
          model, tools: [], reasoning: { effort: "low" }, timeoutMs: NARRATION.timeoutMs, instructions: NARRATION_INSTRUCTIONS,
          input: [{ role: "user", content: JSON.stringify(narrationInput(step, bot)) }],
        }, { missionId, botId: bot.id, retry: false });
        const text = cleanNarration(result?.text);
        const fresh = this.store.get("steps", stepId);
        if (text && fresh?.status === "running") this.store.patch("steps", stepId, { narration: { text, at: now() } });
      } catch {} finally {
        this.narrating.delete(stepId);
      }
    })();
  }
  /** A failed or cancelled mission is reviewed in the background, once its run has unwound. */
  learnSoon(missionId) {
    const job = (async () => {
      await new Promise((r) => setImmediate(r));
      await this.learn(missionId, this.settings().model || this.provider?.config?.()?.local?.model, AbortSignal.timeout(90000));
    })();
    this.jobs.add(job);
    job.finally(() => this.jobs.delete(job));
  }
  async learn(missionId, model, signal) {
    // The conversation may be deleted while its review runs: then there is nothing to mark.
    const mark = (changes) => { if (this.store.get("missions", missionId)) this.store.patch("missions", missionId, changes); };
    if (!this.store.get("missions", missionId)) return;
    if (this.store.get("missions", missionId)?.incognito) {
      mark({ learningStatus: "incognito" });
      return;
    }
    // A lesson («Enséñale») is always reviewed: you asked the bot to learn it.
    const teach = !!this.store.get("missions", missionId)?.teach;
    if (this.settings().learning === false && !teach) {
      mark({ learningStatus: "disabled" });
      return;
    }
    mark({ learningStatus: "running" });
    try {
      const result = await learnFromMission({
        store: this.store,
        missionId,
        model,
        reviewModel: cheapestModel(this.availableModels()), // the two reviewers run on the cheap model
        signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
        infer: (params, meta) => this.infer(params, meta),
        force: teach,
      });
      mark({ learningStatus: result.status === "skipped" ? "skipped" : "completed" });
    } catch (error) {
      mark({ learningStatus: "failed", learningError: error.message });
    }
  }
  /**
   * «Aprende de esta misión» (POST /api/missions/:id/learn): forced review of a finished
   * mission. Returns {status, skill, memories, soul, notes, reasons} in a light shape.
   */
  async learnNow(missionId) {
    const mission = this.store.get("missions", missionId);
    if (!mission) throw Object.assign(Error("Misión no encontrada."), { status: 404 });
    if (this.settings().learning === false) throw Object.assign(Error("El aprendizaje está desactivado en Ajustes › Espacio."), { status: 409 });
    if (this.active.has(missionId) || ["queued", "running", "planning"].includes(mission.status))
      throw Object.assign(Error("La misión sigue en marcha. Espera a que termine."), { status: 409 });
    if (mission.learningStatus === "running") throw Object.assign(Error("Ya está aprendiendo de esta misión."), { status: 409 });
    const model = this.settings().model || this.provider?.config?.()?.local?.model;
    if (!model) throw Error("Conecta una cuenta de IA y elige un modelo en Ajustes.");
    this.store.patch("missions", missionId, { learningStatus: "running", learningError: null });
    try {
      const result = await learnNowFor({
        store: this.store, missionId, model, reviewModel: cheapestModel(this.availableModels()), signal: AbortSignal.timeout(150000),
        infer: (params, meta) => this.infer(params, meta),
      });
      this.store.patch("missions", missionId, { learningStatus: result.status === "skipped" ? "skipped" : "completed" });
      return learningSummary(result);
    } catch (error) {
      this.store.patch("missions", missionId, { learningStatus: "failed", learningError: error.message });
      throw error;
    }
  }
  /** Periodic learning (scheduler, hourly): weekly curator + daily USER.md condensation. */
  async learningTick(at = new Date()) {
    return learningTick(this.store, (params, meta) => this.infer(params, meta), { at, model: this.settings().model || null });
  }
  /** Condenses USER.md now (button or tests). */
  async condenseUserProfile({ force = true } = {}) {
    return condenseUserProfile(this.store, (params, meta) => this.infer(params, meta), { force, model: this.settings().model || null });
  }
}
