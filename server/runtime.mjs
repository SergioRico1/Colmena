import { LoopGuard, LOOP_GUARD } from "./loops.mjs";
import { pendingSummary } from "./redlines.mjs";
import { blockingKey, mayDeclareBlocked, trackBlocking } from "./guards.mjs";
import { quietRun, QUIET_MARK } from "./quiet.mjs";
import { addressees, quietReply, passedTo, speechCut, STOP_RE, MAX_ROUNDS } from "./roomturns.mjs";
import { isAppToolName } from "./apptools.mjs";
import { cleanUse, turnNote } from "./turnoptions.mjs";
import { RECEIPT, abandonEffect, beginEffect, finishEffect, isEffect, recoverEffects } from "./receipts.mjs";
import { compactImages, forReceipt } from "./computer/tools.mjs";
import { GOAL_LIMIT_CODE } from "./goals.mjs";
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { id, now } from "./store.mjs";
import { hasHistory, historySize, removeStepHistory, setStepHistory, stepHistory } from "./histories.mjs";
import { readMissionFile } from "./files.mjs";
import { activateSkill, importSkill, parseSkill } from "./skills.mjs";
import { TOOLS, CONNECTION_TOOLS, verbFor, READ_TOOLS, capabilitiesOf, webSearchesOf } from "./tools.mjs";
import { checkStructured, repairNote } from "./structured.mjs";
import { overlapping, stepScopes } from "./writescopes.mjs";
import { composeInstructions, autonomyOf, useDataDirectory } from "./soul.mjs";
import { webFetch } from "./web.mjs";
import { addReaction, removeReaction, swapReaction, reactionsOf, ACK_LOOKING, ACK_TAKEN, ACK_DONE } from "./reactions.mjs";
import { THINKING_EFFORT, UNAVAILABLE_CODE } from "./provider.mjs";
import { CONTEXT, contextBudget, contextSize, estimateTokens, trimHistory, compactHistory, pruneOutput, isColmenaNote, isPersonMessage } from "./context.mjs";
import { spillOutput } from "./spill.mjs";
import { IMAGE_CODE } from "./images.mjs";
import { stepUsage, LIMIT_CODE, tokensOf as usageTokens } from "./usage.mjs";
import { engineName, PROVIDER_LIMIT_CODE, UNKNOWN_RESET_MS } from "./limits.mjs";
import { Checkpoints } from "./checkpoints.mjs";
import { primaryBot, bumpLearningCounter } from "./learning.mjs";
import { stopReason, stoppedRecord, isContextOverflow } from "./stopped.mjs";
import {
  STUCK_ROUNDS, WEB_SEARCH_NOTE, QUEUE_MODES, INCOGNITO_MS, PARTIAL_CODE, PARALLEL_STEPS, QUIET_MS, IDLE_ABORT_MS, AUTO_RESUMES, leavesWorkUndone,
  partialTableUnsaid, titleFromPrompt, clipWords, roomSlug, appsLabel, ACTIVE, INCOGNITO_NOTE, INTERRUPT_CODE, stepLabel, MISSION_WIDE, RETRY_CODE,
  RESUME_WINDOW_MS, LIMIT_RESUMES, runsInParallel, PROGRESS_MAX, LIVE_AFTER, countWords,
} from "./runtime/helpers.mjs";
import { installMethods } from "./mixin.mjs";
import { InferenceMethods } from "./runtime/inference.mjs";
import { ContextMethods } from "./runtime/context.mjs";
import { SideJobMethods } from "./runtime/sidejobs.mjs";
import { EffectMethods } from "./runtime/effects.mjs";
import { ApprovalMethods } from "./runtime/approvals.mjs";
import { DelegationMethods } from "./runtime/delegation.mjs";
export {
  STUCK_ROUNDS, SUGGEST_INSTRUCTIONS, TITLE_INSTRUCTIONS, MEMORY_FLUSH, COMPACT_INSTRUCTIONS, WEB_SEARCH_NOTE, QUEUE_MODES, INCOGNITO_MS,
  PARTIAL_CODE, PARALLEL_STEPS, QUIET_MS, IDLE_ABORT_MS, AUTO_RESUMES, THREAD_WINDOW, THREAD_STEP, threadCut, leavesWorkUndone, partialTableUnsaid,
  REVIEWABLE, REVIEW_INSTRUCTIONS, describeFailure, titleFromPrompt, clipWords, roomSlug, appsLabel, learningSummary, memoryOps,
} from "./runtime/helpers.mjs";

export { TOOLS, CONNECTION_TOOLS };
// Context hygiene (context.mjs): budgets scale with the model's window; old tool outputs keep
// their head and tail, outputs too big are spilled to a file, then the middle is summarized.
export { CONTEXT, contextBudget, contextSize, estimateTokens, trimHistory, compactHistory, pruneOutput, isColmenaNote, isPersonMessage };
const SKILLS_DIR = fileURLToPath(new URL("../prompts/skills/", import.meta.url));

/**
 * Initial skills (prompts/skills/*.md, adapted from OpenClaw skills/ — MIT/Apache-2.0,
 * licenses/OpenClaw.txt): imported once as active skills of their bot (frontmatter
 * metadata.colmena.bot). settings.seededSkills remembers what was seeded, so a skill the
 * person deleted or disabled is never added again. Returns the skills created now.
 */
export function seedSkills(store, { directory = SKILLS_DIR } = {}) {
  let files = [];
  try { files = readdirSync(directory).filter((f) => f.endsWith(".md")).sort(); } catch { return []; }
  const settings = store.get("settings", "main");
  const seeded = new Set(Array.isArray(settings?.seededSkills) ? settings.seededSkills : []);
  const created = [];
  for (const file of files) {
    const key = file.replace(/\.md$/, "");
    if (seeded.has(key)) continue;
    try {
      const content = readFileSync(path.join(directory, file), "utf8");
      const parsed = parseSkill(content);
      const botId = String(parsed.metadata?.colmena?.bot || "").trim() || null;
      if (botId && !store.get("bots", botId)) continue;
      const skill = importSkill(store, { content, source: "Habilidades iniciales de Colmena (OpenClaw skills/)", botId, origin: "imported", status: "active" });
      if (skill.status !== "active") activateSkill(store, skill.id, "active");
      created.push(skill);
      seeded.add(key);
    } catch {}
  }
  if (settings && created.length) store.patch("settings", "main", { seededSkills: [...seeded] });
  else if (!settings && created.length) store.put("settings", { id: "main", seededSkills: [...seeded] });
  return created;
}

export class Runtime {
  /**
   * `extraTools(bot, mission)` (optional, also assignable later as runtime.extraTools) lets
   * the coordinator add tools — e.g. using the computer — for bots whose capability
   * 'ordenador' is on. It returns [{name, description, parameters, strict?, run(args, ctx)}];
   * `run` receives {mission, step, bot, call, signal, runtime} and may return {waiting:true}.
   */
  constructor(store, provider, connections = null, { web = webFetch, extraTools = null, retryDelays = null, context = null, seed = !process.env.NODE_TEST_CONTEXT, sleep = null, idleAbortMs = IDLE_ABORT_MS, quietMs = QUIET_MS, suggest = !process.env.NODE_TEST_CONTEXT, review = !process.env.NODE_TEST_CONTEXT, autoTitle = !process.env.NODE_TEST_CONTEXT, narrate = !process.env.NODE_TEST_CONTEXT, recaps = !process.env.NODE_TEST_CONTEXT, speech = !process.env.NODE_TEST_CONTEXT, loopGuard = LOOP_GUARD, checkpoints = !process.env.NODE_TEST_CONTEXT } = {}) {
    this.store = store;
    this.provider = provider;
    this.connections = connections;
    this.web = web;
    this.webCache = new Map(); // url → { at, result | error, pending }
    this.extraTools = extraTools;
    // Fixed waits (tests) instead of the provider's backoff policy (provider.mjs RETRY).
    this.retryDelays = retryDelays;
    // {window, maxOutput} assumed for models nobody knows the window of (tests, local models).
    this.context = context;
    this.sleep = sleep;
    this.idleAbortMs = idleAbortMs;
    this.quietMs = quietMs;
    this.suggest = suggest;
    this.quiet = new Set(); // missions flagged «sin avanzar»
    this.active = new Map();
    this.jobs = new Set();
    this.missionJobs = new Map();
    this.wakeups = new Map(); // missionId → wakes its scheduler (an OK given while others work)
    this.delegates = new Map(); // helper step id (ask_bot tasks) → {missionId, botId, from}: who may get message_bot
    this.code = null; // «Código» (server/code/service.mjs), set by the server: code_task
    this.activity = new Map();
    this.progress = new Map(); // missionId → last time something moved (watchdog, «atascado»)
    this.loopGuard = new LoopGuard(loopGuard);
    this.review = review; // automatic reviewer of routine approvals (off in tests unless asked)
    this.recaps = recaps; // 1–3 sentence room recaps when a room settles (cheapest model)
    this.autoTitle = autoTitle; // short titles for chats after their first answer
    this.narrate = narrate; // one-line «what I am doing» during long work (cheapest model)
    this.speech = speech; // long answers in rooms said in parts
    this.narrating = new Set();
    // Restore points of the files each turn changes («Deshacer cambios», server/checkpoints.mjs).
    this.checkpoints = checkpoints ? new Checkpoints(store, { ...(typeof checkpoints === "object" ? checkpoints : {}), root: (missionId) => this.root(missionId) }) : null;
    useDataDirectory(store.directory, store);
    // Initial skills on first start (tests opt in with {seed: true}: their stores start empty).
    if (seed) try { seedSkills(store); } catch {}
    // An effect a close caught half-way is «sin confirmar», never run again (receipts.mjs).
    try { this.recovered = recoverEffects(store); } catch (error) { this.recovered = []; console.warn("Colmena: no se pudieron revisar los recibos: " + error.message); }
    // Work cut by a close, crash or sleep: paused and marked, so resumeInterrupted() picks it
    // up on its own once the AI account is ready (OpenClaw restart-recovery).
    for (const m of store.list("missions"))
      if (["running", "queued", "planning"].includes(m.status))
        store.patch("missions", m.id, {
          status: "paused",
          interrupted: { at: now() },
          error: "Colmena se cerró. Puedes continuar desde el último paso guardado.",
          stopped: stoppedRecord({ reason: "other", detail: "Colmena se cerró mientras trabajaba." }),
        });
  }
  root(missionId) {
    return path.join(this.store.directory, "workspaces", missionId);
  }
  settings() {
    return this.store.get("settings", "main") || {};
  }
  bot(botId) {
    return this.store.get("bots", botId);
  }
  /** Mission safety 'preguntar' forces the most careful autonomy for that mission. */
  autonomy(mission, bot) {
    // «Pregúntame antes de enviar nada fuera» is already guaranteed by the red lines;
    // it must not turn internal work (browsing, deliverables) into approvals.
    return autonomyOf(bot);
  }
  teamCandidates() {
    return this.store.list("bots").filter((b) => b.enabled && b.audience !== "yo" && b.id !== "atlas" && b.usesChatGPT !== false);
  }
  makeStep(missionId, key, botId, kind, deps = [], extra = {}) {
    const bot = this.bot(botId);
    const name = bot?.name || botId;
    const titles = {
      solo: extra.missionTitle || "Respuesta",
      plan: "Atlas prepara el reparto",
      work: name + ": " + String(extra.taskTitle || extra.task || "su parte").slice(0, 80),
      synthesis: extra.combine ? "Atlas combina las propuestas" : "Atlas integra el trabajo",
      proposal: "Propuesta de " + name,
      critique: name + " compara las propuestas",
      debate_summary: "Atlas resume el debate",
      followup: "Respuesta de " + name + " a tu mensaje",
    };
    const { missionTitle, ...rest } = extra;
    // A step made again under the same key starts a new conversation.
    removeStepHistory(this.store, missionId + ":" + key);
    return this.store.put("steps", {
      id: missionId + ":" + key,
      key,
      missionId,
      botId,
      kind,
      deps,
      status: "pending",
      rounds: 0,
      pending: [],
      text: "",
      title: titles[kind] || name,
      words: 0,
      reads: 0,
      seconds: 0,
      activity: [],
      startedAt: null,
      completedAt: null,
      ...rest,
    });
  }
  create({
    prompt,
    mode = "solo",
    botIds,
    title,
    automationId = null,
    conversation = false,
    conversationOf = null,
    safety = "avisar",
    attachments = [],
    incognito = false,
    use = [],
    deep = false,
    thread = false,
    context = "",
  }) {
    // «+» in a new chat's composer: the same note and effort as for a later message; `context`
    // is what its «@» picks bring (server/mention-refs.mjs).
    const promptNote = turnNote(use, { deep }) + String(context || "");
    if (typeof prompt !== "string" || !prompt.trim()) throw Error("Escribe el encargo.");
    if (!["solo", "equipo", "debate"].includes(mode)) throw Error("Modo no válido.");
    const previous = conversationOf ? this.store.get("missions", conversationOf) : null;
    if (conversationOf && !previous) throw Error("Conversacion no encontrada.");
    let bots = [...new Set(botIds?.length ? botIds : previous ? previous.botIds : mode === "solo" ? ["nora"] : [])];
    if (mode === "equipo") {
      if (!this.bot("atlas")?.enabled) throw Error("Atlas coordina el equipo y debe estar disponible.");
      bots = bots.filter((b) => b !== "atlas");
      if (!bots.length && !this.teamCandidates().length) throw Error("No hay bots de equipo disponibles.");
    } else if (!bots.length) throw Error("Selecciona entre uno y cuatro bots disponibles.");
    if (bots.length > 4 || bots.some((b) => !this.bot(b)?.enabled))
      throw Error("Selecciona entre uno y cuatro bots disponibles.");
    if (mode === "debate" && bots.length < 2) throw Error("El debate necesita al menos dos bots.");
    if (mode !== "solo" && bots.some((b) => this.bot(b).audience === "yo"))
      throw Error("Los bots personales solo participan en su chat privado.");
    const isConversation = !!(conversation || conversationOf) && mode === "solo";
    let priorMessages = [];
    if (previous) {
      priorMessages = [...(previous.priorMessages || []), ...this.conversationTurns(previous.id)].slice(-30);
    } else if (isConversation && !incognito) {
      // Earlier chats with this bot give context; incognito ones never do (and never get any).
      priorMessages = this.store.list("missions")
        .filter((m) => m.mode === "solo" && m.botIds[0] === bots[0] && m.status === "completed" && !m.incognito)
        .slice(-5)
        .flatMap((m) => [
          { role: "user", content: m.prompt },
          { role: "assistant", content: String(m.result || "").slice(0, 20000) },
        ]);
    }
    const missionTitle = title ? clipWords(title.replace(/\s+/g, " ").trim(), 80) : titleFromPrompt(prompt);
    const taken = new Set(this.store.list("missions").map((m) => m.room).filter(Boolean));
    const missionId = id();
    const steps = [];
    if (mode === "solo") steps.push(["answer", bots[0], "solo", [], { missionTitle, ...(deep ? { effort: "high" } : {}) }]);
    else if (mode === "equipo") steps.push(["plan", "atlas", "plan", []]);
    else {
      for (const b of bots) steps.push(["proposal-" + b, b, "proposal", []]);
      for (const b of bots) steps.push(["critique-" + b, b, "critique", bots.map((x) => "proposal-" + x)]);
      steps.push(["debate-summary", "atlas", "debate_summary", bots.map((x) => "critique-" + x)]);
    }
    const mission = this.store.put("missions", {
      id: missionId,
      title: missionTitle,
      room: roomSlug(missionTitle, taken),
      prompt,
      mode,
      botIds: bots,
      conversation: isConversation,
      conversationOf: conversationOf || null,
      ...(thread && isConversation ? { thread: true } : {}), // the bot's single chat (threads.mjs)
      ...(promptNote ? { promptNote } : {}),
      ...(incognito && isConversation ? { incognito: true, expiresAt: new Date(Date.now() + INCOGNITO_MS).toISOString() } : {}),
      safety: safety === "preguntar" ? "preguntar" : "avisar",
      status: "queued",
      createdAt: now(),
      completedAt: null,
      error: null,
      steps: steps.map((s) => s[0]),
      automationId,
      learningStatus: "pending",
      priorMessages,
      chosenBotIds: [],
      plan: null,
    });
    for (const [key, botId, kind, deps, extra] of steps) this.makeStep(missionId, key, botId, kind, deps, extra);
    this.store.event(mission.id, "created", { text: "Misión creada", mode });
    this.store.put("messages", {
      id: id(), missionId, role: "user", text: prompt, kind: "message",
      attachments: this.attachmentList(attachments), at: now(),
    });
    // Automation prompts are not the person talking to the bot.
    if (!automationId) this.countTurn(primaryBot(mission));
    return mission;
  }
  /** Hermes counter: messages of the person addressed to a bot (memory review every 10). */
  countTurn(botId) {
    try { bumpLearningCounter(this.store, botId, "userTurns"); } catch {}
  }
  /** The bots of a room or chat, by name (Atlas included: he coordinates every room). */
  roomMembers(mission) {
    const ids = [...new Set([...(mission.botIds || []), ...(mission.conversation ? [] : ["atlas"])])];
    return ids.map((b) => ({ id: b, name: this.bot(b)?.name || "" })).filter((m) => m.name);
  }
  mentionedBot(mission, text) {
    return addressees(text, this.roomMembers(mission))[0];
  }
  /**
   * One turn per addressee, one after another (each sees what the previous ones said and may
   * stay quiet if it has nothing new). Returns the new step keys.
   */
  queueTurns(missionId, botIds, deps, { request, ackOn, replyTo = null, round = 1, chainKind = "chain", effort = undefined }) {
    const chain = botIds.length > 1 || round > 1 ? chainKind + "-" + id() : null;
    const names = botIds.map((b) => this.bot(b)?.name || b);
    const keys = [];
    botIds.forEach((botId, i) => {
      const key = "followup-" + id();
      this.makeStep(missionId, key, botId, "followup", [...deps, ...keys.slice(-1)], {
        request, ackOn, round, ...(replyTo ? { replyTo } : {}), ...(effort ? { effort } : {}),
        ...(chain ? { chain, chainIndex: i, chainNames: names, silentOk: i > 0 || round > 1 } : {}),
      });
      keys.push(key);
    });
    return keys;
  }
  addMessage(missionId, text, attachments = [], { replyTo = null, mode: forcedMode = null, use = [], deep = false, refs = [], context = "" } = {}) {
    // «+» in the composer: tools or apps chosen for this message, and «Pensar a fondo»; the
    // «@» picks of files and conversations bring `context` (server/mention-refs.mjs).
    const chosen = cleanUse(use);
    const note = turnNote(chosen, { deep }) + String(context || "");
    const effort = deep ? "high" : undefined;
    const m = this.store.get("missions", missionId);
    // A reply in a message's thread: it stays in that thread, and the bot that wrote the
    // message answers there, with the message it refers to in front of it.
    const parent = replyTo ? this.store.get("messages", replyTo) : null;
    const thread = parent && parent.missionId === missionId ? (parent.replyTo || parent.id) : null;
    if (!m || ["cancelled", "awaiting_choice"].includes(m.status))
      throw Error("La misión no admite mensajes ahora. Elige primero una propuesta si hay un debate pendiente.");
    if (m.status === "awaiting_plan" && !thread) {
      this.planDecision(missionId, "changes", text);
      return this.store.where("messages", "missionId", missionId).filter((x) => x.role === "user").at(-1);
    }
    const working = this.active.has(missionId) && !["completed", "paused", "waiting"].includes(m.status);
    // «Para», «detente», «stop»… alone: the work stops (as the Pause button), nothing is lost.
    if (working && !thread && STOP_RE.test(text)) {
      const message = this.store.put("messages", { id: id(), missionId, role: "user", text, kind: "message", attachments: [], at: now(), stop: true });
      this.stop(missionId);
      return message;
    }
    const stalled = this.steps(missionId).filter((s) => s.stalled);
    if (stalled.length && !thread) return this.resumeStalled(m, stalled, text, attachments);
    const prior = this.steps(missionId), key = "followup-" + id();
    const named = addressees(text, this.roomMembers(m));
    const root = thread ? this.store.get("messages", thread) : null;
    const threadBot = root?.role === "assistant" && root.botId && (m.botIds.includes(root.botId) || root.botId === "atlas") ? root.botId : null;
    const botIds = named.length ? named : [threadBot
      || (m.mode === "solo" ? m.botIds[0] : m.mode === "debate" && m.chosenBotIds?.length === 1 ? m.chosenBotIds[0] : "atlas")];
    const botId = botIds[0];
    const about = root ? "Responde en el hilo del mensaje de " + (root.role === "user" ? "la persona" : this.bot(root.botId)?.name || "un bot") + " (dato): «" + String(root.text || "").slice(0, 1500) + "»\n\nLa persona escribe: " : "";
    for (const b of botIds) this.countTurn(b);
    // Ctrl+Enter sends one message with the other mode (OpenClaw steer ⇄ queue).
    const mode = QUEUE_MODES.includes(forcedMode) ? forcedMode : QUEUE_MODES.includes(m.queueMode) ? m.queueMode : "steer";
    if (m.suggestions) this.store.patch("missions", missionId, { suggestions: null });
    const messageId = id();
    const message = this.store.put("messages", {
      id: messageId, missionId, role: "user", text, kind: "message", attachments: this.attachmentList(attachments), at: now(), ...(thread ? { replyTo: thread } : {}),
      ...(named.length ? { to: named } : {}),
      ...(QUEUE_MODES.includes(forcedMode) ? { mode: forcedMode } : {}),
      ...(chosen.length ? { use: chosen } : {}), ...(deep ? { deep: true } : {}),
      ...(refs?.length ? { refs } : {}),
      // «Espera» / «Junta»: the bots at work do not see it until they finish.
      ...(working && (mode === "followup" || mode === "collect") ? { deliver: "after" } : {}),
    });
    // Several messages before the bot gets to them: one turn, not one per message.
    const waitingTurn = botIds.length === 1 && mode !== "followup" && prior.find((s) => s.kind === "followup" && s.status === "pending" && !hasHistory(s) && !s.chain && s.botId === botId && (s.replyTo || null) === (thread || null));
    if (waitingTurn) {
      this.store.patch("steps", waitingTurn.id, { request: waitingTurn.request + "\n\nY después escribe: «" + text + "»" + note, ackExtra: [...(waitingTurn.ackExtra || []), messageId], ...(effort ? { effort } : {}) });
      this.store.event(missionId, "user_message", { text: "Mensaje añadido al que ya esperaba respuesta" });
      return message;
    }
    // «Interrumpe»: what they were doing stops and this message is answered now.
    if (working && mode === "interrupt" && !thread) {
      const skipped = prior.filter((s) => s.status !== "completed");
      for (const s of skipped) this.store.patch("steps", s.id, { status: "completed", skipped: true, stalled: null, pending: [], completedAt: now() });
      const ids = new Set(skipped.map((s) => s.id));
      for (const a of this.store.where("approvals", "missionId", missionId).filter((a) => a.status === "pending" && ids.has(a.stepId)))
        this.store.patch("approvals", a.id, { status: "denied", decidedAt: now(), decidedBy: "tú", resolution: "Interrumpido por tu mensaje" });
      const keys = this.queueTurns(missionId, botIds, [], { request: about + text + note, ackOn: messageId, effort });
      this.store.patch("missions", missionId, { steps: [...(m.steps || []), ...keys] });
      this.active.get(missionId)?.abort(Object.assign(Error("Interrumpido por tu mensaje."), { code: INTERRUPT_CODE }));
      this.store.event(missionId, "interrupted", { text: "Han parado para atender tu mensaje" });
      this.wake(missionId);
      return message;
    }
    // «@Atlas» while the team works on its plan: Atlas answers now, beside them (it can write to
    // a teammate at work with message_bot), instead of after the whole plan. Its answer is an
    // aside: never the mission's result.
    const aside = working && !thread && mode === "steer" && m.mode === "equipo" && !!m.plan?.approved && named.length === 1 && named[0] === "atlas"
      && prior.some((s) => s.kind === "work" && s.status !== "completed");
    if (aside) {
      const [key] = this.queueTurns(missionId, ["atlas"], prior.filter((s) => s.status === "completed").map((s) => s.key), { request: about + text + note, ackOn: messageId, effort });
      this.store.patch("steps", missionId + ":" + key, { aside: true });
      this.store.patch("missions", missionId, { steps: [...(m.steps || []), key] });
      this.store.event(missionId, "user_message", { text: "Atlas te responde ahora; el equipo sigue con lo suyo." });
      this.wakeups.get(missionId)?.();
      return message;
    }
    // Queue a dependent turn without interrupting a tool call or changing its approval.
    const keys = this.queueTurns(missionId, botIds, prior.map((s) => s.key), { request: about + text + note, ackOn: messageId, replyTo: thread, effort });
    this.store.patch("missions", missionId, {
      steps: [...(m.steps || []), ...keys],
      ...(m.status === "completed" ? { status: "queued", error: null } : {}),
    });
    this.store.event(missionId, "user_message", { text: "Mensaje recibido; se atendera tras el trabajo en curso." });
    if (m.status === "completed" && this.active.has(missionId)) {
      void Promise.resolve(this.missionJobs.get(missionId)).then(() => this.launch(missionId));
    } else if (!this.active.has(missionId) && !["paused", "waiting"].includes(m.status)) this.launch(missionId);
    return message;
  }
  /**
   * «Otra respuesta»: the bot answers `userMessage` again, without a new message of yours (the
   * answer it replaces stays as a sibling version, branches.mjs).
   */
  rerun(missionId, userMessage, botId = null) {
    const m = this.store.get("missions", missionId);
    if (!m) throw Error("La misión no existe.");
    if (this.active.has(missionId) || ["running", "queued", "planning"].includes(m.status)) throw Object.assign(Error("Espera a que termine de responder."), { status: 409 });
    const bot = botId && this.bot(botId) ? botId : m.mode === "solo" ? m.botIds[0] : "atlas";
    this.countTurn(bot);
    const keys = this.queueTurns(missionId, [bot], this.steps(missionId).map((s) => s.key), { request: String(userMessage.text || ""), ackOn: userMessage.id });
    this.store.patch("missions", missionId, { steps: [...(m.steps || []), ...keys], status: "queued", error: null, stopped: null });
    this.launch(missionId);
  }
  /**
   * A step that stopped at its round limit or in a loop waits for the person. Any message
   * («continúa», or a hint) resumes it with fresh rounds; the text is added to its history.
   */
  resumeStalled(mission, stalled, text, attachments = []) {
    const message = this.store.put("messages", {
      id: id(), missionId: mission.id, role: "user", text, kind: "message", attachments: this.attachmentList(attachments), at: now(),
    });
    const go = /^\s*(?:sigue|contin[uú]a|adelante|venga|vale|ok|s[ií])\b[\s.!¡]*$/i.test(text);
    for (const step of stalled) {
      this.countTurn(step.botId);
      const fresh = this.store.get("steps", step.id);
      this.setHistory(step.id, [...(this.history(fresh) || []), {
        role: "user",
        content: go ? "La persona dice: «" + text + "». Sigue donde lo dejaste, sin repetir lo que ya falló." : "La persona responde: «" + text + "». Tenlo en cuenta y sigue.",
      }], {
        stalled: null,
        status: "pending",
        rounds: 0,
        failedRounds: 0,
        resumes: (fresh.resumes || 0) + 1,
        failures: {},
        ackOn: message.id,
        ackDone: false,
      });
    }
    this.store.patch("missions", mission.id, { status: "queued", error: null });
    this.store.event(mission.id, "resumed", { text: "La misión sigue tras tu mensaje" });
    if (!this.active.has(mission.id)) this.launch(mission.id);
    else this.relaunch(mission.id);
    return message;
  }
  /** «Añadir a la conversación»: another bot joins a chat or room. */
  addMember(missionId, botId) {
    const m = this.store.get("missions", missionId);
    if (!m || m.status === "cancelled") throw Error("La conversacion no admite cambios.");
    const bot = this.bot(botId);
    if (!bot?.enabled) throw Error("Bot no disponible.");
    if (m.botIds.includes(botId)) return m;
    if (bot.audience === "yo" && !m.conversation) throw Error("Los bots personales solo participan en su chat privado.");
    if (m.botIds.length >= 6) throw Error("Como maximo seis bots por conversacion.");
    const updated = this.store.patch("missions", missionId, { botIds: [...m.botIds, botId] });
    this.store.put("messages", { id: id(), missionId, role: "system", botId, kind: "activity", text: bot.name + " se ha unido a la conversacion.", at: now() });
    this.store.event(missionId, "member_added", { botId, text: bot.name + " se ha unido" });
    return updated;
  }
  /** A hint from the person in the bots' thread; later rounds and steps receive it. */
  threadHint(missionId, text) {
    const m = this.store.get("missions", missionId);
    if (!m) throw Error("Misión no encontrada.");
    const value = String(text || "").trim();
    if (!value || value.length > 4000) throw Error("Escribe una pista de hasta 4000 caracteres.");
    const entry = this.addThread({ missionId, from: "user", to: null, text: value });
    this.store.event(missionId, "thread_hint", { text: "Pista añadida al hilo" });
    return entry;
  }
  addThread(entry) {
    const record = this.store.put("thread", { id: id(), at: now(), ...entry });
    const m = this.store.get("missions", entry.missionId);
    if (m) this.store.patch("missions", m.id, { threadSummary: this.threadSummary(m.id) });
    return record;
  }
  thread(missionId) {
    return this.store.where("thread", "missionId", missionId);
  }
  threadSummary(missionId) {
    const entries = this.thread(missionId);
    if (!entries.length) return null;
    const talks = entries.filter((t) => t.from !== "user" && t.to);
    const hints = entries.length - talks.length;
    const pairs = new Map();
    for (const t of talks.filter((_, i) => i % 2 === 0)) {
      const k = (this.bot(t.from)?.name || t.from) + " consultó a " + (this.bot(t.to)?.name || t.to);
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
    const parts = [...pairs].map(([k, n]) => (n > 1 ? k + " " + n + " veces" : k));
    if (hints) parts.push(hints === 1 ? "1 pista tuya" : hints + " pistas tuyas");
    return parts.join(" · ") || null;
  }
  steps(missionId) {
    // Only this mission's steps, through the missionId index (T3 Code loads the slice a
    // caller needs): parsing every step of every mission cost ~20 ms and grew without end.
    // Without their provider conversations: those are records of their own (history()).
    return this.store.where("steps", "missionId", missionId);
  }
  /** The provider conversation of a step (its id or its record): an array, null before it starts (histories.mjs). */
  history(step) {
    return stepHistory(this.store, step);
  }
  /** Writes the conversation of a step, with `changes` to its record in the same transaction. */
  setHistory(stepId, items, changes = {}) {
    return setStepHistory(this.store, stepId, items, changes);
  }
  /** A step with its conversation at hand (`history`), as the code that runs it works with it. */
  liveStep(stepId) {
    const step = this.store.get("steps", stepId);
    return step ? { ...step, history: stepHistory(this.store, step) } : null;
  }
  /** store.patch for a live step: `history` in `changes` goes to its own record; the result keeps the conversation at hand. */
  patchStep(step, changes) {
    const { history, ...rest } = changes;
    if (history === undefined) return { ...this.store.patch("steps", step.id, rest), history: step.history };
    return { ...this.setHistory(step.id, history, rest), history };
  }
  launch(missionId) {
    if (this.active.has(missionId)) return this.missionJobs.get(missionId);
    const job = this.run(missionId);
    this.jobs.add(job);
    this.missionJobs.set(missionId, job);
    job.finally(() => {
      this.jobs.delete(job);
      if (this.missionJobs.get(missionId) === job) this.missionJobs.delete(missionId);
    });
    return job;
  }
  /** Resume a paused or blocked mission from its last checkpoint. */
  resume(missionId) {
    if (!this.store.get("missions", missionId)) throw Error("Misión no encontrada.");
    return this.launch(missionId);
  }
  /**
   * After a restart: the work Colmena was doing when it closed goes on by itself. Each step
   * that was in the middle of something is told to check before repeating it. At most
   * AUTO_RESUMES times in 15 minutes (then it waits for «Continuar»), never while the whole
   * team is paused. Returns the ids it resumed.
   */
  resumeInterrupted() {
    if (this.settings().paused) return [];
    const resumed = [];
    for (const m of this.store.list("missions")) {
      if (m.status !== "paused" || !m.interrupted || this.active.has(m.id)) continue;
      const recent = (m.autoResumes || []).filter((t) => Date.now() - Date.parse(t) < RESUME_WINDOW_MS);
      if (recent.length >= AUTO_RESUMES) {
        this.store.patch("missions", m.id, { interrupted: null, error: "Colmena se ha cerrado varias veces mientras trabajaba en esto. Pulsa «Continuar» cuando quieras seguir." });
        continue;
      }
      for (const s of this.steps(m.id))
        if (s.status === "running" && historySize(s))
          this.setHistory(s.id, [...(this.history(s) || []), { role: "user", content: "Colmena se reinició mientras trabajabas. Antes de repetir algo que estaba a medias (un envío, un archivo, una acción en una web), comprueba si ya se hizo." }], { status: "pending" });
      this.store.patch("missions", m.id, { autoResumes: [...recent, now()], interrupted: null, error: null });
      this.store.event(m.id, "resumed", { text: "Sigue sola tras reiniciar Colmena" });
      this.launch(m.id);
      resumed.push(m.id);
    }
    return resumed;
  }
  /**
   * «Limitado»: what a mission paused by an AI's usage limit waits for — {engine, label,
   * window, resetsAt, resumeAt, botIds, model, at}. Without a known renewal it looks again
   * after UNKNOWN_RESET_MS (the next attempt reports the real time).
   */
  limitRecord(missionId, error) {
    const limit = error?.limit || {};
    const running = this.steps(missionId).filter((s) => s.status === "running");
    let resumeAt = Date.parse(limit.until || limit.resetsAt || "");
    if (!Number.isFinite(resumeAt) || resumeAt <= Date.now()) resumeAt = Date.now() + UNKNOWN_RESET_MS;
    return {
      engine: error?.engine || "openai", label: limit.label || "límite de uso", window: limit.window || null, resetsAt: limit.resetsAt || null,
      resumeAt: new Date(resumeAt).toISOString(), botIds: [...new Set(running.map((s) => s.botId))], model: running.find((s) => s.model)?.model || null, at: now(),
    };
  }
  /**
   * Missions paused by an AI's usage limit go on by themselves when it renews, or as soon as
   * a substitute can answer (Ajustes › Si falla, usar) — T3 Code UsageLimitRecoveryWorker. The
   * steps in the middle of something are told to continue without repeating. At most
   * LIMIT_RESUMES times a day (then «Continuar»), never while the team is paused. Called from
   * the scheduler tick; returns the ids it resumed.
   */
  resumeLimited(time = Date.now()) {
    if (this.settings().paused) return [];
    const hub = typeof this.provider?.fallbackFor === "function" ? this.provider : null;
    const resumed = [];
    for (const m of this.store.list("missions")) {
      const l = m.limited;
      if (m.status !== "paused" || !l || this.active.has(m.id) || this.missionJobs.has(m.id)) continue;
      const due = Date.parse(l.resumeAt || "") <= time;
      let substitute = null;
      if (!due && hub && l.model) try { substitute = hub.fallbackFor(l.model); } catch {}
      if (!due && !substitute) continue;
      const recent = (m.limitResumes || []).filter((t) => time - Date.parse(t) < 86_400_000);
      if (recent.length >= LIMIT_RESUMES) {
        this.store.patch("missions", m.id, { limited: null, error: engineName(l.engine) + " sigue sin dejar trabajar hoy. Pulsa «Continuar» cuando quieras volver a intentarlo." });
        continue;
      }
      const text = due ? engineName(l.engine) + " ha renovado su " + (l.label || "límite") + ": el trabajo sigue" : "Sigue con " + substitute.label + " mientras " + engineName(l.engine) + " renueva su límite";
      for (const s of this.steps(m.id))
        if (s.status === "running" && historySize(s))
          this.setHistory(s.id, [...(this.history(s) || []), { role: "user", content: "[Colmena] " + text + ". Continúa donde lo dejaste, sin repetir lo que ya está hecho." }]);
      this.store.patch("missions", m.id, { limited: null, error: null, limitResumes: [...recent, new Date(time).toISOString()] });
      this.store.event(m.id, "resumed", { text });
      this.store.put("messages", { id: id(), missionId: m.id, role: "system", kind: "activity", text: text + ".", at: now() });
      this.launch(m.id);
      resumed.push(m.id);
    }
    return resumed;
  }
  relaunch(missionId, { keepPaused = false } = {}) {
    // A run in progress looks again at once (the step you just approved starts beside the others).
    this.wakeups.get(missionId)?.();
    const prior = this.missionJobs.get(missionId);
    void Promise.resolve(prior).then(() => {
      if (keepPaused && this.store.get("missions", missionId)?.status === "paused") return;
      return this.launch(missionId);
    });
  }
  /**
   * Goes on after something that was not you saying «sigue» (a question's wait ended, the
   * reviewer or a rule approved, a retry): a mission you paused meanwhile stays paused.
   */
  wake(missionId) {
    this.relaunch(missionId, { keepPaused: true });
  }
  runningStatus(missionId) {
    const m = this.store.get("missions", missionId);
    const plan = m.mode === "equipo" && this.steps(missionId).find((s) => s.key === "plan");
    return plan && plan.status !== "completed" ? "planning" : "running";
  }
  async run(missionId) {
    if (this.active.has(missionId)) return;
    const initial = this.store.get("missions", missionId);
    if (!initial || ["completed", "cancelled", "awaiting_choice"].includes(initial.status)) return;
    if (this.settings().paused) {
      this.store.patch("missions", missionId, { status: "paused", pausedBy: "all", error: "El equipo esta en pausa." });
      return;
    }
    const controller = new AbortController();
    this.active.set(missionId, controller);
    // No total time cap (long work is fine): stop only when nothing has moved for 10 minutes.
    this.touch(missionId);
    const timer = setInterval(() => {
      const quietFor = Date.now() - (this.progress.get(missionId) || 0);
      if (quietFor > this.idleAbortMs)
        controller.abort(Error("Llevaba 10 minutos sin avanzar y lo he parado para no gastar en balde. Pulsa «Continuar» para seguir desde el último paso guardado."));
      else if (quietFor > this.quietMs && !this.quiet.has(missionId)) this.markQuiet(missionId);
    }, Math.max(20, Math.min(30000, this.quietMs / 4, this.idleAbortMs / 4)));
    timer.unref();
    this.store.patch("missions", missionId, { status: this.runningStatus(missionId), error: null, pausedBy: null, interrupted: null, limited: null, stopped: null, partial: null });
    this.store.event(missionId, "started", { text: "Equipo en marcha" });
    try {
      const model = this.settings().model || this.provider?.config?.()?.local?.model || this.availableModels()[0]?.slug;
      if (!model) throw Error("Conecta ChatGPT en Ajustes › Cuentas de IA.");
      if (!(await this.schedule(missionId, model, controller))) return;
      const mission = this.store.get("missions", missionId);
      if (mission.mode === "debate" && !mission.chosenBotIds?.length) {
        this.store.patch("missions", missionId, { status: "awaiting_choice" });
        this.store.event(missionId, "awaiting_choice", { text: "Las propuestas y criticas estan listas. Elige una propuesta." });
      } else {
        // The last thing said (a teammate that stayed quiet is not the result, nor Atlas'
        // answer in passing while the team worked).
        const all = this.steps(missionId);
        const final = [...all].reverse().find((s) => !s.quietReply && !s.aside && String(s.text || "").trim()) || all.at(-1);
        this.complete(missionId, final.text, final.botId);
        void this.suggestNext(missionId);
        void this.nameConversation(missionId);
        void this.recapRoom(missionId);
        await this.learn(missionId, model, controller.signal);
      }
    } catch (error) {
      const current = this.store.get("missions", missionId);
      if (!current) return; // deleted while it ran
      const limited = error?.code === LIMIT_CODE || error?.code === GOAL_LIMIT_CODE;
      // The provider did not answer after the retries: paused, continue later from the checkpoint.
      const unavailable = error?.code === UNAVAILABLE_CODE;
      if (controller.signal.reason?.code === INTERRUPT_CODE || controller.signal.reason?.code === RETRY_CODE) {
        // «Pausar» right after «Reintentar» or an interrupting message: the pause stands.
        if (!["cancelled", "completed", "paused"].includes(current.status)) this.store.patch("missions", missionId, { status: "queued", error: null });
        return;
      }
      // The AI's plan ran out and no substitute could answer: «Limitado» until it renews, then
      // resumeLimited() goes on by itself (T3 Code UsageLimitRecoveryWorker).
      const providerLimited = error?.code === PROVIDER_LIMIT_CODE && !controller.signal.aborted;
      // Why it stopped, for the «Se paró» card (stopped.mjs): you, length, a filter, an error…
      const why = controller.signal.aborted
        ? (/por el usuario/.test(String(controller.signal.reason?.message || "")) ? { reason: "cancelled" } : { reason: "other", detail: controller.signal.reason?.message || error.message })
        : stopReason(error);
      if (current.status !== "cancelled" && current.status !== "completed")
        this.store.patch("missions", missionId, {
          status: limited || unavailable || providerLimited || controller.signal.aborted ? "paused" : "blocked",
          error: error.message,
          ...(providerLimited ? { limited: this.limitRecord(missionId, error), stopped: null } : { stopped: stoppedRecord(why) }),
        });
      // Part of the team failed while the rest finished: «partial», with what failed and what is done.
      const partial = error?.code === PARTIAL_CODE;
      if (partial && this.store.get("missions", missionId)?.status === "blocked") this.store.patch("missions", missionId, { partial: error.partial });
      this.store.event(missionId, limited ? "limit" : providerLimited ? "provider_limit" : unavailable ? "unavailable" : controller.signal.aborted ? "stopped" : partial ? "partial" : "error", { text: error.message });
      // A failed mission is reviewed too: what went wrong in the method (learning.mjs).
      if (this.store.get("missions", missionId)?.status === "blocked") this.learnSoon(missionId);
    } finally {
      clearInterval(timer);
      this.progress.delete(missionId);
      if (this.quiet.delete(missionId) && this.store.get("missions", missionId)) this.store.patch("missions", missionId, { quiet: null });
      this.active.delete(missionId);
      for (const [botId, a] of this.activity) if (a.missionId === missionId) this.clearActivity(botId, missionId);
      // The turn's second restore point, once the mission is free (a queued message may start
      // the next turn meanwhile: its first point waits for this one, folder by folder).
      this.checkpoints?.finishSoon(missionId);
    }
  }
  /**
   * Greedy step scheduler: up to PARALLEL_STEPS steps run at once and a step starts as soon as
   * its own dependencies are done, not when the whole wave ends. A step that fails fails alone:
   * it is marked «failed» with its reason, independent branches go on and the steps that need
   * it wait. A stop, and failures of the AI or the budget (MISSION_WIDE), still end the run once
   * the steps in flight settle. True when every step completed, false when the mission now waits
   * for the person; throws when the run fails (PARTIAL_CODE if independent work did finish).
   */
  async schedule(missionId, model, controller) {
    const signal = controller.signal;
    const running = new Map(); // step id → promise of {step, error}
    const failed = new Map(); // step id → {step, error}
    const finished = new Set(); // step keys completed in this run
    let fatal = null, wake = null;
    const waker = () => wake?.();
    this.wakeups.set(missionId, waker);
    const settle = ({ step, error }) => {
      running.delete(step.id);
      if (!error) {
        if (this.store.get("steps", step.id)?.status === "completed") finished.add(step.key);
        return;
      }
      if (signal.aborted || MISSION_WIDE(error)) { fatal ||= error; return; }
      failed.set(step.id, { step, error });
      const reason = String(error?.message || error || "Error desconocido").slice(0, 600);
      this.store.patch("steps", step.id, { status: "failed", error: reason, failedAt: now() });
      this.store.event(missionId, "step_failed", { botId: step.botId, stepId: step.id, text: (this.bot(step.botId)?.name || step.botId) + " no pudo terminar «" + stepLabel(step) + "»: " + reason });
    };
    try {
      for (;;) {
        if (signal.aborted || fatal) {
          while (running.size) settle(await Promise.race(running.values()));
          throw fatal || signal.reason;
        }
        const steps = this.steps(missionId);
        if (!running.size && steps.every((s) => s.status === "completed")) return true;
        const done = new Set(steps.filter((s) => s.status === "completed").map((s) => s.key));
        const ready = steps.filter((s) => s.status !== "completed" && !running.has(s.id) && !failed.has(s.id) && !s.stalled && s.deps.every((d) => done.has(d)) && !this.hasPendingApproval(s));
        for (const step of ready.slice(0, Math.max(0, PARALLEL_STEPS - running.size))) {
          // Two parts at once that write the same files: the later one gets a note (advisory).
          this.noteOverlap(missionId, step, [...running.keys()]);
          running.set(step.id, this.runStep(missionId, step, model, signal).then(() => ({ step }), (error) => ({ step, error })));
        }
        if (running.size) {
          this.store.patch("missions", missionId, { status: this.runningStatus(missionId) });
          const woken = new Promise((resolve) => { wake = () => resolve(null); });
          const next = await Promise.race([...running.values(), woken]);
          wake = null;
          if (next) settle(next);
          continue;
        }
        const waitingPlan = this.store.where("approvals", "missionId", missionId).some((a) => a.kind === "plan" && a.status === "pending");
        const stalled = steps.some((s) => s.stalled);
        // Nothing can run. A step that waits for you keeps the mission waiting (a failed step
        // is retried with it); otherwise the run ends with what failed.
        const needsYou = waitingPlan || steps.some((s) => s.status !== "completed" && !failed.has(s.id) && (s.stalled || this.hasPendingApproval(s)));
        if (failed.size && !needsYou) throw this.runFailure(missionId, failed, finished);
        this.store.patch("missions", missionId, { status: waitingPlan ? "awaiting_plan" : "waiting" });
        this.store.event(missionId, stalled ? "stalled" : "waiting", {
          text: waitingPlan ? "El plan espera tu OK" : stalled ? "Espera que le digas «continúa» o cómo seguir" : "Necesita tu OK",
        });
        return false;
      }
    } finally {
      if (this.wakeups.get(missionId) === waker) this.wakeups.delete(missionId);
    }
  }
  /**
   * Why a run ended with failed steps. One failure and nothing independent done: that step's
   * own error (the mission fails as before). Otherwise a clear Spanish summary — what failed,
   * what is done, what waits for it — with code PARTIAL_CODE when other work did finish.
   */
  runFailure(missionId, failed, finished) {
    const steps = this.steps(missionId);
    const byKey = new Map(steps.map((s) => [s.key, s]));
    // What the failed steps needed (their dependencies, all the way up) is not independent work.
    const needed = new Set();
    const walk = (s) => { for (const d of s?.deps || []) if (!needed.has(d)) { needed.add(d); walk(byKey.get(d)); } };
    const list = [...failed.values()];
    for (const { step } of list) walk(step);
    const independent = [...finished].filter((k) => !needed.has(k)).map((k) => byKey.get(k)).filter(Boolean);
    if (!independent.length && list.length === 1) return list[0].error;
    const who = (s) => this.bot(s.botId)?.name || s.botId;
    const failedText = list.map(({ step, error }) => who(step) + " («" + stepLabel(step) + "»: " + String(error?.message || error).slice(0, 200) + ")").join("; ");
    const waiting = steps.filter((s) => s.status !== "completed" && !failed.has(s.id));
    const message = (independent.length ? "Parte del trabajo ha fallado: " : "No se pudo terminar: ") + failedText + ". " +
      (independent.length ? "Lo demás está hecho (" + [...new Set(independent.map(who))].join(", ") + "). " : "") +
      (waiting.length === 1 ? "Queda en espera un paso que lo necesita. " : waiting.length ? "Quedan en espera " + waiting.length + " pasos que lo necesitan. " : "") +
      "Pulsa «Continuar» para reintentar lo que falló; lo hecho se conserva.";
    return Object.assign(Error(message), independent.length ? {
      code: PARTIAL_CODE,
      partial: {
        failed: list.map(({ step, error }) => ({ stepId: step.id, botId: step.botId, title: stepLabel(step), error: String(error?.message || error).slice(0, 300) })),
        done: independent.map((s) => s.id), waiting: waiting.map((s) => s.id), at: now(),
      },
    } : {});
  }
  hasPendingApproval(step) {
    return step.pending?.some((c) => {
      const a = this.store.get("approvals", step.id + ":" + c.call_id);
      return ["pending", "executing"].includes(a?.status);
    });
  }
  /**
   * After a room turn: teammates named with @ in the answer get the word (a new round,
   * one after another), up to MAX_ROUNDS from the person's message and within the loop guard.
   */
  passTheWord(mission, step, bot, messageId, text) {
    if (step.kind !== "followup" || mission.automationId || !text) return [];
    const round = step.round || 1;
    if (round >= MAX_ROUNDS) return [];
    const members = this.roomMembers(mission);
    const targets = passedTo(text, members, { self: bot.id }).filter((t) => {
      try { this.guardPair(mission, bot, this.bot(t)); return true; } catch { return false; }
    });
    if (!targets.length) return [];
    const request = bot.name + " te menciona en la sala (dato): «" + String(text).slice(0, 3000) + "»\n\nResponde a lo que te pide o te pregunta. Si no te pide nada a ti, responde exactamente " + QUIET_MARK + ".";
    const fresh = this.store.get("missions", mission.id);
    const keys = this.queueTurns(mission.id, targets, this.steps(mission.id).map((s) => s.key), { request, ackOn: messageId, replyTo: step.replyTo || null, round: round + 1, chainKind: "pass" });
    this.store.patch("missions", mission.id, { steps: [...(fresh.steps || []), ...keys] });
    this.store.event(mission.id, "pass_word", { botId: bot.id, to: targets, text: bot.name + " pasa la palabra a " + targets.map((t) => this.bot(t)?.name || t).join(" y ") });
    return keys;
  }
  /**
   * Two parts running at once that declare (plan «writes»), name in their task or have written
   * the same files or folders of the mission: `step` — the later one — gets a note before its
   * next round. Advisory and cheap (string prefixes); each pair is noted once.
   */
  noteOverlap(missionId, step, otherIds) {
    const mine = stepScopes(step);
    if (!mine.length || !otherIds.length) return;
    const warned = new Set(step.overlap?.with || []);
    const hits = [];
    for (const otherId of otherIds) {
      const other = otherId === step.id || warned.has(otherId) ? null : this.store.get("steps", otherId);
      const paths = other ? overlapping(mine, stepScopes(other)) : [];
      if (paths.length) hits.push({ other, paths });
    }
    if (!hits.length) return;
    const names = [...new Set(hits.map((h) => this.bot(h.other.botId)?.name || h.other.botId))];
    const paths = [...new Set(hits.flatMap((h) => h.paths))].slice(0, 6);
    const where = paths.map((p) => "«" + p + "»").join(", ");
    const fresh = this.store.get("steps", step.id) || step;
    this.store.patch("steps", step.id, {
      overlap: { with: [...warned, ...hits.map((h) => h.other.id)], paths, at: now() },
      overlapNotes: [...(fresh.overlapNotes || []), "[Colmena] Aviso: " + names.join(" y ") + (names.length > 1 ? " trabajan" : " trabaja") + " a la vez que tú y también puede" + (names.length > 1 ? "n" : "") + " escribir en " + where +
        ". No sobrescribas su trabajo: usa nombres de archivo distintos o lee el archivo antes de cambiar algo que no hayas creado tú. Es solo un aviso; sigue con tu parte."],
    });
    this.store.event(missionId, "write_overlap", { botId: step.botId, stepId: step.id, text: (this.bot(step.botId)?.name || step.botId) + " y " + names.join(", ") + " pueden escribir a la vez en " + where });
  }
  async runStep(missionId, initial, model, signal) {
    let mission = this.store.get("missions", missionId);
    const bot = this.bot(initial.botId);
    if (!bot) throw Error("El bot de este paso ya no existe.");
    if (bot.usesChatGPT === false) throw Error(bot.name + " no tiene una cuenta de IA habilitada.");
    let step = this.liveStep(initial.id);
    // One model and one effort per step: the provider's encrypted reasoning belongs to that
    // model, and a request that keeps them is continued on the warm socket.
    if (!step.model) step = this.patchStep(step, { model: this.stepModel(bot, step, mission, model) });
    if (step.effort === undefined) step = this.patchStep(step, { effort: this.effortForStep(bot, step, mission) });
    model = step.model;
    // The system prompt is fixed once per step (first round): memory written during the
    // step shows up in the next one, as in Hermes' frozen snapshot.
    const instructions = () => composeInstructions(this.store, bot, { mission, autonomy: this.autonomy(mission, bot), extra: mission.incognito ? INCOGNITO_NOTE : "" });
    if (!step.history)
      step = this.patchStep(step, {
        history: this.initialHistory(mission, step),
        seenHints: this.userHints(missionId).map((h) => h.id),
        ...(this.usesBrief(mission, step) ? { seenBrief: this.missionBrief(missionId, { forBotId: bot.id, exceptStepId: step.id }).keys } : {}),
        instructions: instructions(),
      });
    else if (!step.instructions) step = this.patchStep(step, { instructions: instructions() });
    // Cut by a cancel, «Reintentar» or a close (not waiting for an OK): the calls it had
    // chosen and that never got a result get one now, so it decides again.
    if (["running", "pending"].includes(step.status)) step = this.settleInterrupted(step);
    let segment = Date.now(), accounted = false;
    this.store.patch("steps", step.id, { status: "running", startedAt: step.startedAt || now() });
    this.store.event(missionId, "bot_started", { botId: bot.id, stepId: step.id, text: bot.name + " está trabajando" });
    this.acknowledge(step, bot);
    // Just after a restart the connected apps' direct tools may still be loading.
    if (typeof this.appTools?.whenReady === "function") await this.appTools.whenReady(8000);
    // Everything this bot may call in this step; what the model is shown may be shorter.
    const offered = this.toolsForStep(mission, step, bot);
    // Tools on demand (tool-search.mjs): with many tools only the core ones are listed and the
    // rest are found with find_tools and run with use_tool. The list is decided once and kept
    // for the whole step (cached prefix, warm socket, Claude Code session); what the bot used
    // through use_tool in earlier steps of this mission is listed directly from now on.
    if (!Array.isArray(step.promotedTools)) step = this.patchStep(step, { promotedTools: this.toolsUsedBefore(step) });
    const onDemand = this.toolSplit(mission, step, bot, offered);
    const tools = onDemand.listed;
    const moreTools = this.toolsNote(offered, tools);
    // Instructions and tools, priced once for the context budget (before any real usage).
    const overhead = estimateTokens(step.instructions || "") + estimateTokens(moreTools) + estimateTokens(tools);
    let overflowRetried = false;
    const stall = (reason, text) => {
      const current = this.store.get("steps", step.id);
      this.store.patch("steps", step.id, {
        status: "waiting",
        stalled: { reason, text, at: now() },
        seconds: Math.round((current.seconds || 0) + (Date.now() - segment) / 1000),
      });
      accounted = true;
      this.store.put("messages", {
        id: id(), missionId, botId: bot.id, role: "assistant", text, kind: "message", phase: step.kind, stepId: step.id, ...(step.replyTo ? { replyTo: step.replyTo } : {}), stall: reason, at: now(),
      });
      this.store.event(missionId, "stalled", { botId: bot.id, stepId: step.id, text: bot.name + ": " + text });
    };
    let nudges = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        step = this.liveStep(step.id);
        if (step.pending.length) {
          let looping = null, waiting = false;
          const shots = new Map(); // call_id → result with a screenshot (this round only)
          const runCall = async (call) => {
            signal.throwIfAborted();
            const receiptId = step.id + ":" + call.call_id;
            let receipt = this.store.get("receipts", receiptId);
            // No receipt yet, or one that waits for an OK: the call runs (its approval decides).
            // Done, «sin confirmar» or already started: never again (receipts.mjs).
            const open = !receipt || receipt.status === RECEIPT.waiting;
            // The person wrote after the model chose this change: skip it and re-decide with
            // the message in front (OpenClaw steering). Reads still run.
            if (open && !runsInParallel(call.name) && this.steeredSince(missionId, step)) {
              this.store.put("receipts", { ...(receipt || {}), id: receiptId, tool: call.name, status: RECEIPT.done, result: { skipped: true, note: "No se hizo: la persona acaba de escribir. Lee su mensaje y vuelve a decidir si hace falta." }, at: now() });
              return;
            }
            if (open) {
              let args = {};
              try { args = JSON.parse(call.arguments); } catch {}
              this.setActivity(bot.id, missionId, step.id, verbFor(call.name, args), this.activityDetail(call.name, args));
              this.toolActivity(step.id, call, args, "running");
              const began = Date.now();
              // The intent before the effect, in its own transaction: a close from here on
              // leaves it «sin confirmar», never run twice (T3 Code CommandReceiptStore).
              const effect = isEffect(call.name);
              if (effect && !beginEffect(this.store, { id: receiptId, tool: call.name, missionId, stepId: step.id, args: call.arguments }).fresh) return;
              let result;
              try {
                result = await this.tool(mission, step, call, signal, model);
              } catch (error) {
                // Stopped mid-way: a keyed internal write may run again; anything else is «sin confirmar».
                if (effect) abandonEffect(this.store, receiptId);
                throw error;
              }
              if (result?.waiting) {
                if (effect) finishEffect(this.store, receiptId, result);
                waiting = true;
                return;
              }
              this.toolActivity(step.id, call, args, result?.error ? "error" : "done");
              // The same call again and again: a reminder rides on its result (never blocks).
              result = this.repeatReminder(missionId, step.id, call, result);
              // A screenshot goes to the model once, as an image; the receipt keeps the rest.
              if (typeof result?.image === "string" && result.image.startsWith("data:image/")) shots.set(call.call_id, result);
              const stored = shots.has(call.call_id) ? forReceipt(result) : result;
              receipt = effect
                ? finishEffect(this.store, receiptId, result, { ms: Date.now() - began, stored })
                : this.store.put("receipts", { id: receiptId, tool: call.name, status: RECEIPT.done, result: stored, ms: Date.now() - began, at: now() });
              try { bumpLearningCounter(this.store, bot.id, "toolCalls"); } catch {}
              if (READ_TOOLS.has(call.name) && !result?.error)
                this.store.patch("steps", step.id, { reads: (this.store.get("steps", step.id).reads || 0) + 1 });
              if (result?.error) looping ||= this.countFailure(step.id, call, result.error);
              // Where it writes (tried counts too: a file a teammate already wrote is refused).
              this.trackWrite(missionId, step.id, call.name, args);
              this.store.event(missionId, "tool_result", {
                botId: bot.id,
                tool: call.name,
                text: call.name + (result?.error ? " fallo" : " completado"),
              });
            }
          };
          // Calls that only read run together (three pages fetched at once, not one after
          // another); anything else runs alone, in order. Outputs keep the calls' order.
          const groups = [];
          for (const call of step.pending) {
            const last = groups.at(-1);
            if (runsInParallel(call.name) && last?.parallel) last.calls.push(call);
            else groups.push({ parallel: runsInParallel(call.name), calls: [call] });
          }
          for (const group of groups) {
            if (group.parallel && group.calls.length > 1) await Promise.all(group.calls.map(runCall));
            else for (const call of group.calls) {
              await runCall(call);
              if (waiting) break;
            }
            if (waiting) break;
          }
          if (waiting) {
            this.store.patch("steps", step.id, { status: "waiting", seconds: (step.seconds || 0) + (Date.now() - segment) / 1000 });
            accounted = true;
            return;
          }
          for (const call of step.pending) {
            const receipt = this.store.get("receipts", step.id + ":" + call.call_id);
            const answered = (h) => h.some((x) => x.type === "function_call_output" && x.call_id === call.call_id);
            if (!receipt || receipt.result === undefined || answered(this.history(step.id))) continue;
            // Too big for the context: saved whole to a file, the model gets head, tail and where.
            const output = await spillOutput(this.root(missionId), step.id, call.name, this.modelOutput(missionId, step.id, call, receipt.result, shots.get(call.call_id)));
            const latest = this.history(step.id);
            // Only the latest screenshot stays as an image; older ones become a note.
            if (!answered(latest)) this.setHistory(step.id, compactImages([...latest, { type: "function_call_output", call_id: call.call_id, output }]));
          }
          // A round where every call failed counts towards «stuck»; any success resets it.
          const batch = step.pending.map((c) => this.store.get("receipts", step.id + ":" + c.call_id)?.result);
          const allFailed = batch.length > 0 && batch.every((r) => r?.error);
          const lastError = allFailed ? { tool: step.pending.at(-1).name, error: batch.at(-1).error } : null;
          // Anti-false-blocked (guards.mjs): «stuck» needs the same blocking condition for
          // BLOCKED_ROUNDS rounds in a row; varied failures mean it is still trying (hard cap 2×).
          const blocking = trackBlocking(step.blocking, lastError ? blockingKey(lastError.tool, lastError.error) : null);
          this.store.patch("steps", step.id, { pending: [], failedRounds: allFailed ? (step.failedRounds || 0) + 1 : 0, blocking });
          step = this.liveStep(step.id);
          if (!looping && step.failedRounds >= STUCK_ROUNDS && (mayDeclareBlocked(blocking, { reason: lastError?.error }) || step.failedRounds >= STUCK_ROUNDS * 2)) {
            stall("loop", `Me he atascado: llevo ${step.failedRounds} intentos seguidos sin que nada funcione (el último, «${lastError.tool}»: «${String(lastError.error).slice(0, 160)}»). Paro para no gastar en balde; dime cómo seguir o «continúa» para intentarlo de otra forma.`);
            return;
          }
          if (looping) {
            stall("loop", `Me he atascado: he intentado ${looping.times} veces lo mismo con «${looping.tool}» y falla igual («${String(looping.error).slice(0, 160)}»). Paro para no repetirlo; dime cómo seguir o «continúa» para intentarlo de otra forma.`);
            return;
          }
        }
        // Long work: one line in the bot's own words of what it is doing (cheapest model).
        this.maybeNarrate(missionId, step.id, bot);
        // Before the first word: what it is doing, so a slow start never looks frozen.
        if (!step.rounds) this.setActivity(bot.id, missionId, step.id, "preparando", "");
        step = this.injectHints(step);
        step = this.injectPermissionChange(this.store.get("missions", missionId) || mission, step);
        step = this.injectMessages(this.store.get("missions", missionId) || mission, step);
        step = this.injectRelays(step);
        step = this.injectBrief(this.store.get("missions", missionId) || mission, step);
        const contextOptions = { tools, instructions: (step.instructions || instructions()) + moreTools, webSearch: this.searchFor(bot, step) };
        step = await this.manageContext(mission, step, bot, model, signal, contextOptions);
        if (this.contextTokens(step, overhead) > this.contextBudget(model).hardLimit)
          throw Error("La misión supera el contexto local permitido. Divide el encargo.");
        // A chat starts thinking «low»; once it turns into real work (two rounds of tools) it
        // thinks «medium» for the rest of the step (one full request, then continued again).
        if (step.effort === "low" && bot.thinking !== "rapido" && step.history.filter((x) => x.type === "function_call").length >= 2)
          step = this.patchStep(step, { effort: THINKING_EFFORT.equilibrado || "medium" });
        this.store.patch("steps", step.id, { rounds: step.rounds + 1, roundAt: now() });
        mission = this.store.get("missions", missionId);
        this.setActivity(bot.id, missionId, step.id, "conectando", "");
        let buffer = "", last = 0, writing = false, retried = false, started = false;
        // Rooms: a long answer is said in parts (800–1200 characters, at a paragraph), each
        // one a message of its own as soon as it is written (OpenClaw block streaming).
        const speaking = this.speech && !mission.conversation && !mission.automationId && !step.silentOk && !step.outputSchema && ["followup", "solo", "work", "synthesis"].includes(step.kind);
        let streamed = "", said = 0;
        const parts = [];
        const sayPart = () => {
          const cut = speechCut(streamed, said);
          if (cut <= said) return;
          const part = streamed.slice(said, cut).trim();
          said = cut;
          if (!part) return;
          parts.push(this.store.put("messages", {
            id: id(), missionId, botId: bot.id, role: "assistant", text: part, kind: "message", part: parts.length + 1,
            phase: step.kind, stepId: step.id, ...(step.replyTo ? { replyTo: step.replyTo } : {}), at: now(),
          }).id);
          // The part is in the room before the live text drops it (no blink).
          this.emit({ type: "flush-now" });
          this.emit({ type: "delta", mission: missionId, stepId: step.id, botId: bot.id, text: streamed.slice(said), reset: true });
          buffer = "";
          last = Date.now();
        };
        const webSearch = contextOptions.webSearch;
        let result;
        try {
          result = await this.infer({
            model,
            instructions: contextOptions.instructions + (webSearch ? WEB_SEARCH_NOTE : ""),
            input: step.history,
            tools,
            reasoning: step.effort ? { effort: step.effort } : null,
            webSearch,
            signal,
            timeoutMs: 180000,
            onEvent: (event) => {
              if (!started && /^response\.(created|in_progress)$/.test(event.type)) {
                started = true;
                if (!writing) this.setActivity(bot.id, missionId, step.id, "pensando", "");
              }
              if (/^response\.web_search_call\.(in_progress|searching)$/.test(event.type)) this.setActivity(bot.id, missionId, step.id, "leyendo", "buscando en la web");
            },
            onDelta: (delta) => {
              buffer += delta;
              streamed += delta;
              // A short line before its tools («Busco los correos de pedidos…») becomes a progress
              // line when the round ends; the live text starts once it is clearly the answer.
              if (!writing && streamed.length < LIVE_AFTER && !streamed.includes("\n")) return;
              if (!writing && delta) {
                writing = true;
                this.setActivity(bot.id, missionId, step.id, "escribiendo", "");
              }
              if (speaking && delta.includes("\n")) sayPart();
              // OpenClaw live-text pacing: the first words at once, then at most every 75 ms.
              if (buffer && Date.now() - last > 75) {
                this.emitDelta(missionId, step.id, bot.id, buffer);
                buffer = "";
                last = Date.now();
              }
            },
          }, {
            missionId, botId: bot.id, stepId: step.id,
            onRetry: (info) => {
              retried = true;
              buffer = "";
              writing = false;
              // Parts said by the failed attempt go away; the retry says them again.
              for (const partId of parts.splice(0)) try { this.store.remove("messages", partId); } catch {}
              streamed = "";
              said = 0;
              // Text streamed by the failed attempt is discarded by the room (reset) and rewritten.
              this.emit({ type: "delta", mission: missionId, stepId: step.id, botId: bot.id, text: "", reset: true });
              this.recordRecovery(missionId, step.id, bot, info);
            },
          });
        } catch (error) {
          // The provider says the request does not fit its window: compact as hard as possible
          // and send it once more, only if the history really shrank (DSH context-overflow
          // recovery); otherwise the error stops the turn as before («Continuar»).
          if (signal.aborted || overflowRetried || !isContextOverflow(error)) throw error;
          overflowRetried = true;
          const before = this.liveStep(step.id);
          const after = await this.manageContext(mission, before, bot, model, signal, { ...contextOptions, force: true });
          if (after === before || contextSize(after.history) >= contextSize(before.history)) throw error;
          this.store.event(missionId, "context_overflow", { botId: bot.id, stepId: step.id, text: bot.name + " ha hecho sitio en su contexto y lo intenta de nuevo" });
          continue;
        }
        overflowRetried = false;
        // What the provider counted for this request anchors the next estimate (contextTokens).
        const counted = result.usage ? usageTokens(result.usage).input : 0;
        if (retried) this.recordRecovery(missionId, step.id, bot, { status: "recovered" });
        if (buffer && writing) this.emitDelta(missionId, step.id, bot.id, buffer);
        signal.throwIfAborted();
        const output = Array.isArray(result.output) ? result.output : [];
        const searches = webSearchesOf(output);
        if (searches.length) this.recordSearches(missionId, step.id, bot, searches);
        const text = String(result.text || "");
        // A use_tool call that names one of the bot's tools with valid arguments IS that call
        // from here on — in the conversation and in `pending` — so everything that follows
        // (permission, approval, red lines, receipt, steering, tool card) sees the real tool.
        const viaSearch = [];
        const produced = !onDemand.active ? output : output.map((x) => {
          const real = x.type === "function_call" ? this.unwrapToolUse(x, offered) : x;
          if (real !== x) viaSearch.push(real.name);
          return real;
        });
        const calls = produced.filter((x) => x.type === "function_call");
        if (calls.some((c) => step.history.some((old) => old.type === "function_call" && old.call_id === c.call_id)))
          throw Error("OpenAI repitio un identificador de herramienta. No se ejecutará.");
        this.setHistory(step.id, [...this.history(step.id), ...produced], {
          ...(viaSearch.length ? { usedTools: [...new Set([...(this.store.get("steps", step.id)?.usedTools || []), ...viaSearch])].slice(-24) } : {}),
          pending: calls,
          pendingAt: now(),
          meter: counted > 0 ? { tokens: counted, items: step.history.length, at: now() } : null,
        });
        // It stopped at «I still have to…», or it gives a partial table as the whole: not said
        // to you; it is told to finish (or to say it is partial) and goes on.
        const partial = !calls.length && partialTableUnsaid(step.history, text);
        if (!calls.length && !parts.length && !step.silentOk && tools.length && step.kind !== "plan" && !(step.finishNudges >= 1) && (leavesWorkUndone(text) || partial)) {
          const fresh = this.store.get("steps", step.id);
          const table = tools.some((t) => t.name === "apps_table");
          this.emit({ type: "delta", mission: missionId, stepId: step.id, botId: bot.id, text: "", reset: true });
          this.patchStep(fresh, {
            finishNudges: (fresh.finishNudges || 0) + 1,
            ...(fresh.effort === "low" && bot.thinking !== "rapido" ? { effort: THINKING_EFFORT.equilibrado || "medium" } : {}),
            history: [...this.history(step.id), { role: "user", content: partial
              ? "[Colmena] apps_table avisó de que el resultado está INCOMPLETO y tu respuesta lo da como completo. Acota la búsqueda (remitente exacto, asunto) y vuelve a llamar a apps_table para cubrir todo el periodo; si de verdad no se puede, di claramente qué parte cubre y que el total es parcial."
              : "[Colmena] No termines diciendo lo que falta: hazlo ahora, en este mismo turno, con tus herramientas" +
              (table ? " (para muchos elementos usa apps_table: pagina, lee en paralelo, quita duplicados y suma en código)" : "") +
              ". No se lo pases a otro bot que no tenga tus herramientas. Solo si de verdad es imposible con lo que tienes, di el bloqueo concreto y qué necesitas de la persona." }],
          });
          continue;
        }
        // While it works it says what it is doing (Claude Desktop, Codex preambles): a short
        // text that comes with tool calls is a progress line of this step, shown with the
        // calls it announces — never a message of its own, a notification or a turn.
        if (calls.length && !parts.length && text.trim().length <= PROGRESS_MAX) {
          const line = text.replace(/\s+/g, " ").trim();
          if (writing) this.emit({ type: "delta", mission: missionId, stepId: step.id, botId: bot.id, text: "", reset: true });
          if (line && !mission.automationId && !step.silentOk) {
            this.store.put("messages", {
              id: id(), missionId, botId: bot.id, role: "assistant", text: line, kind: "progress", phase: step.kind, stepId: step.id,
              callIds: calls.map((c) => c.call_id), ...(step.replyTo ? { replyTo: step.replyTo } : {}), at: now(),
            });
            // The same line is its status meanwhile (the narrator waits its turn).
            this.store.patch("steps", step.id, { narration: { text: line.length > 120 ? line.slice(0, 119) + "…" : line, at: now() } });
          }
          continue;
        }
        // A teammate with nothing new to add says nothing (OpenClaw NO_REPLY).
        const quiet = !calls.length && !!step.silentOk && !parts.length && quietReply(text).quiet;
        // What is left after the parts already said; if the final text does not match what
        // streamed, the parts give way to the whole answer.
        let rest = text;
        if (parts.length) {
          const saidText = streamed.slice(0, said).trim();
          if (text.trim().startsWith(saidText)) rest = text.trim().slice(saidText.length).trim();
          else for (const partId of parts.splice(0)) try { this.store.remove("messages", partId); } catch {}
        }
        // A part that must deliver data (outputSchema): checked before it reaches the room. One
        // repair, then the step fails with the reason; the room shows the data as JSON.
        let structured = null;
        if (!calls.length && step.outputSchema && !quiet) {
          const checked = checkStructured(step.outputSchema, text);
          if (!checked.ok) {
            const fresh = this.store.get("steps", step.id);
            this.emit({ type: "delta", mission: missionId, stepId: step.id, botId: bot.id, text: "", reset: true });
            if (!(fresh.schemaRepairs >= 1)) {
              this.setHistory(step.id, [...this.history(step.id), { role: "user", content: repairNote(step.outputSchema, checked.errors) }], { schemaRepairs: (fresh.schemaRepairs || 0) + 1 });
              continue;
            }
            throw Error(bot.name + " no entregó los datos con el formato pedido (" + checked.errors.slice(0, 4).join("; ") + ").");
          }
          structured = checked;
          const json = JSON.stringify(checked.value, null, 2);
          rest = (checked.prose ? checked.prose + "\n\n" : "") + "```json\n" + (json.length > 12000 ? json.slice(0, 12000) + "\n…" : json) + "\n```";
        }
        let messageId = null;
        if (!quiet && rest.trim())
          messageId = this.store.put("messages", {
            id: id(), missionId, botId: bot.id, role: "assistant", text: mission.automationId ? quietRun(rest).text : rest, kind: "message",
            phase: step.kind, stepId: step.id, ...(parts.length ? { part: parts.length + 1 } : {}), ...(step.replyTo ? { replyTo: step.replyTo } : {}), at: now(),
          }).id;
        else if (parts.length) messageId = parts.at(-1);
        if (calls.length) continue;
        if (step.kind === "plan" && !this.store.get("missions", missionId).plan?.approved) {
          if (nudges++ < 2) {
            this.setHistory(step.id, [...this.history(step.id), { role: "user", content: "Llama a propose_plan con el reparto antes de terminar." }]);
            continue;
          }
          throw Error("Atlas no propuso un reparto. Vuelve a intentarlo.");
        }
        const current = this.store.get("steps", step.id);
        if (!text.trim() && !current.reacted && !current.silentOk) throw Error("El modelo termino sin entregar una respuesta.");
        const seconds = Math.round((current.seconds || 0) + (Date.now() - segment) / 1000);
        accounted = true;
        this.store.patch("steps", step.id, {
          status: "completed",
          text: quiet ? "" : text,
          ...(quiet ? { quietReply: true } : {}),
          ...(structured ? { data: structured.value } : {}),
          usage: result.usage || null,
          words: quiet ? 0 : countWords(text),
          seconds,
          completedAt: now(),
        });
        if (messageId) this.store.patch("messages", messageId, { summary: { reads: current.reads || 0, seconds, ...stepUsage(this.store, step.id) } });
        this.settleAck(step.id, bot, { answered: !!messageId });
        if (!quiet) this.passTheWord(this.store.get("missions", missionId) || mission, current, bot, messageId, text);
        this.store.event(missionId, "bot_completed", { botId: bot.id, stepId: step.id, text: bot.name + (quiet ? " no tenía nada que añadir" : " ha terminado") });
        // The answer reaches the room before its live text goes away (one bubble, no gap).
        this.emit({ type: "flush-now" });
        this.emit({ type: "step_done", mission: missionId, stepId: step.id, botId: step.botId });
        return;
      }
    } finally {
      if (!accounted) {
        const s = this.store.get("steps", step.id);
        if (s) this.store.patch("steps", step.id, { seconds: Math.round((s.seconds || 0) + (Date.now() - segment) / 1000) });
      }
      // Stopped, waiting or failed: no «lo estoy mirando» left behind.
      const s = this.store.get("steps", step.id);
      if (s && s.status !== "completed") this.dropLooking(s, bot);
      this.clearActivity(bot.id, missionId);
    }
  }
  /**
   * The message a step answers: the person's message (follow-up, resume), the first message
   * of the mission (solo, plan) or the plan that gave a teammate its part (work).
   */
  ackTarget(step) {
    if (step.ackOn) return this.store.get("messages", step.ackOn) ? step.ackOn : null;
    if (!["solo", "plan"].includes(step.kind)) return null;
    return this.store.where("messages", "missionId", step.missionId).find((m) => m.role === "user" && (!m.kind || m.kind === "message"))?.id || null;
  }
  /** A follow-up whose message the bots at work already read and used: say so, so it does not repeat their work. */
  takenNote(step) {
    if (step.kind !== "followup" || !step.ackOn) return "";
    const msg = this.store.get("messages", step.ackOn);
    const by = [...new Set(reactionsOf(msg).filter((r) => r.emoji === ACK_TAKEN && r.by !== "user").map((r) => (r.by === step.botId ? "tú" : this.bot(r.by)?.name || r.by)))];
    if (!by.length) return "";
    return "Este mensaje ya lo leyeron y lo tuvieron en cuenta mientras trabajaban: " + by.join(", ") + ". No repitas su trabajo: si no queda nada por responder ni por hacer, reacciona con react y termina sin escribir; si queda algo (una pregunta sin responder, un cambio que nadie hizo), atiéndelo.";
  }
  ackTargets(step) {
    const first = this.ackTarget(step);
    return [...(first ? [first] : []), ...(step.ackExtra || []).filter((x) => this.store.get("messages", x))];
  }
  ackEmoji(step) {
    return step.kind === "work" ? ACK_TAKEN : ACK_LOOKING;
  }
  /** Slack-style «visto»: instead of a «Vale, voy a…» message, a reaction while it works. */
  acknowledge(step, bot) {
    const fresh = this.store.get("steps", step.id) || step;
    if (fresh.ackDone) return;
    for (const target of this.ackTargets(fresh)) try { addReaction(this.store, target, this.ackEmoji(fresh), bot.id); } catch {}
  }
  dropLooking(step, bot) {
    if (this.ackEmoji(step) !== ACK_LOOKING || step.reacted === ACK_LOOKING) return;
    for (const target of this.ackTargets(step)) removeReaction(this.store, target, ACK_LOOKING, bot.id);
  }
  /** Done: 👀 goes away (the answer is right there); a teammate's 👍 on the plan becomes ✅. */
  settleAck(stepId, bot) {
    const step = this.store.get("steps", stepId);
    const target = step && this.ackTarget(step);
    if (!target) return;
    if (step.kind === "work") swapReaction(this.store, target, ACK_TAKEN, ACK_DONE, bot.id);
    else this.dropLooking(step, bot);
    this.store.patch("steps", stepId, { ackDone: true });
  }
  /** react tool: the bot answers the message with an emoji (and may end without writing). */
  reactTo(step, bot, emoji) {
    const target = this.ackTarget(step);
    if (!target) return { error: "No hay un mensaje al que reaccionar en este turno." };
    addReaction(this.store, target, emoji, bot.id);
    this.store.patch("steps", step.id, { reacted: emoji });
    return { ok: true, message: "Reacción puesta. Si no hace falta decir nada más, termina sin escribir; si sí, escribe solo lo útil." };
  }
  emit(event) {
    for (const fn of this.store.listeners) fn(event);
  }
  /** Something moved in the mission (a round, a tool, streamed text): resets the watchdog. */
  touch(missionId) {
    if (!missionId) return;
    this.progress.set(missionId, Date.now());
    if (this.quiet.delete(missionId) && this.store.get("missions", missionId)) this.store.patch("missions", missionId, { quiet: null });
  }
  /** «Nora lleva 3 min sin avanzar»: which bot and what it was doing when it went quiet. */
  markQuiet(missionId) {
    this.quiet.add(missionId);
    const [botId, act] = [...this.activity].find(([, a]) => a?.missionId === missionId) || [];
    const since = new Date(this.progress.get(missionId) || Date.now()).toISOString();
    this.store.patch("missions", missionId, { quiet: { since, botId: botId || null, verb: act?.verb || null, detail: act?.detail || null } });
  }
  /** «Reintentar»: drops the call in flight and starts again from the last saved step. */
  retry(missionId) {
    const controller = this.active.get(missionId);
    if (!controller) return this.launch(missionId);
    controller.abort(Object.assign(Error("Reintentando."), { code: RETRY_CODE }));
    this.store.event(missionId, "retry", { text: "Reintentando desde el último paso guardado" });
    this.wake(missionId);
  }
  emitDelta(missionId, stepId, botId, text) {
    this.touch(missionId);
    this.emit({ type: "delta", mission: missionId, stepId, botId, text });
  }
  activityDetail(name, args) {
    if (name === "read_file") return args.path || "";
    if (name === "read_folder_file") return (String(args.path || "").split(/[\\/]/).pop() || "") + (args.page > 1 ? " · página " + args.page : "");
    if (name === "web_fetch") { try { return new URL(args.url).hostname; } catch { return ""; } }
    if (name === "ask_bot") return this.bot(args.botId)?.name || args.botId || "";
    if (name === "create_deliverable") return args.title || "";
    if (name === "write_file") return args.path || "";
    if (name === "search_history") return "historial: " + (args.query || "");
    if (name === "read_thread") return "la conversación" + (args.position > 1 ? " · desde el mensaje " + args.position : "");
    if (name === "create_image") return args.title || "";
    if (name === "create_presentation" || name === "create_document" || name === "create_spreadsheet") return args.title || "";
    if (name === "fill_pdf") return args.title || "";
    if (name === "pdf_fields") return String(args.path || "").split(/[\\/]/).pop() || "";
    if (name === "read_deliverable") return args.title || "";
    if (name === "desktop_open") return args.app || "";
    if (name === "mcp_call") return this.mcp?.store?.get?.("mcpServers", args.server)?.name || args.server || "";
    return "";
  }
  /** Hosted web search for bots with capability web, except plan and critique steps, while the endpoint accepts it. */
  searchFor(bot, step) {
    if (!capabilitiesOf(bot).web || ["plan", "critique"].includes(step.kind)) return false;
    if (typeof this.provider?.nativeSearchAvailable === "function") {
      try { return !!this.provider.nativeSearchAvailable(); } catch { return false; }
    }
    return true;
  }
  /** Hosted searches of a response → step.activity (query, results, sources) for the tool cards. */
  recordSearches(missionId, stepId, bot, searches) {
    const step = this.store.get("steps", stepId);
    if (!step) return;
    const at = now();
    const log = [...(step.activity || [])];
    for (const s of searches) {
      if (log.some((e) => e.tool === "web_search" && e.callId === s.id)) continue;
      const text = s.action === "search" ? "Buscó «" + (s.query || "en la web") + "»" : "Abrió " + (s.url || "una página");
      log.push({ verb: "leyendo", detail: s.query || "", text, tool: "web_search", callId: s.id, status: s.status, query: s.query, action: s.action, url: s.url, count: s.count, sources: s.sources, untrusted: true, startedAt: at, endedAt: at, at });
    }
    this.store.patch("steps", stepId, { activity: log.slice(-40), reads: (step.reads || 0) + searches.filter((s) => s.status === "done").length });
    this.store.event(missionId, "tool_result", { botId: bot.id, tool: "web_search", text: bot.name + " ha buscado en la web" });
  }
  /** Retry state of the model call: activity «Reintentando (2/3)…» for the room and step.recovery for the card. */
  recordRecovery(missionId, stepId, bot, info) {
    const step = this.store.get("steps", stepId);
    if (!step) return;
    const list = [...(step.recovery || [])];
    if (info.status === "recovered") {
      if (list.at(-1)?.status === "waiting") list[list.length - 1] = { ...list.at(-1), status: "recovered", endedAt: now() };
      this.store.patch("steps", stepId, { recovery: list.slice(-10) });
      return;
    }
    list.push({ attempt: info.attempt, max: info.max, wait: info.wait, reason: info.reason, status: info.status, message: info.message || null, ...(info.limited ? { limited: true } : {}), at: now() });
    this.store.patch("steps", stepId, { recovery: list.slice(-10) });
    const detail = info.status === "waiting" ? `Reintentando (${info.attempt}/${info.max})…`
      : info.status === "fallback" ? "Sigue con " + (info.to || "el modelo local") : "El proveedor no responde";
    // Handing the turn to the substitute is said once, as one line in the chat or room.
    if (info.status === "fallback" && info.from)
      this.store.put("messages", { id: id(), missionId, role: "system", botId: bot.id, kind: "activity", stepId, handoff: true,
        text: bot.name + " sigue con " + (info.to || "el modelo local") + ": " + info.from + (info.limited ? " ha llegado a su " + info.reason : " no responde (" + info.reason + ")") + ".", at: now() });
    this.setActivity(bot.id, missionId, stepId, "pensando", detail);
    this.store.event(missionId, "retry", { botId: bot.id, text: bot.name + ": " + detail + (info.reason ? " (" + info.reason + ")" : "") });
  }
  /** Live state per bot; emitted as {type:'activity', mission, botId, verb, detail}. */
  /**
   * One entry of step.activity per tool call: {tool, callId, status:'running'|'done'|'error',
   * startedAt, endedAt, label?}. The verb entry just logged by setActivity for the same
   * call is merged into it so the timeline does not show it twice.
   */
  toolActivity(stepId, call, args, status) {
    const step = this.store.get("steps", stepId);
    if (!step) return;
    const log = [...(step.activity || [])];
    const at = now();
    let index = log.findIndex((e) => e.callId === call.call_id);
    if (index < 0) {
      const verb = verbFor(call.name, args), detail = this.activityDetail(call.name, args);
      // Connected apps say what they do («Leer correos»), never their tool name (gmail_fetch_emails).
      const label = call.name === "apps_table" ? "Revisar muchos elementos de una vez"
        : call.name.startsWith("apps_") ? appsLabel(call.name, args)
        : isAppToolName(call.name) ? appsLabel("apps_execute", { tool: call.name.toUpperCase() }) : null;
      const last = log.at(-1);
      const base = last && !last.callId && last.verb === verb && (last.detail || "") === (detail || "") ? log.pop() : { verb, detail, text: detail ? verb + " · " + detail : verb, at };
      // The file it touched, for the «Archivos» panel («cambiado por Nora», «leído»).
      const file = typeof args?.path === "string" && args.path.length <= 240 ? { path: args.path } : {};
      log.push({ ...base, ...(label ? { label, text: label + (detail ? " · " + detail : "") } : {}), ...file, tool: call.name, callId: call.call_id, status: "running", startedAt: at, endedAt: null });
      index = log.length - 1;
    }
    if (status !== "running") log[index] = { ...log[index], status, endedAt: at };
    this.store.patch("steps", stepId, { activity: log.slice(-40) });
  }
  setActivity(botId, missionId, stepId, verb, detail = "") {
    this.touch(missionId);
    const prev = this.activity.get(botId);
    if (prev && prev.missionId === missionId && prev.verb === verb && prev.detail === detail) return;
    this.activity.set(botId, { verb, missionId, detail, at: now() });
    this.emit({ type: "activity", mission: missionId, botId, verb, detail });
    if (!stepId) return;
    const step = this.store.get("steps", stepId);
    if (!step) return;
    const log = step.activity || [];
    if (log.at(-1)?.verb === verb && log.at(-1)?.detail === detail) return;
    this.store.patch("steps", stepId, {
      activity: [...log, { verb, detail, text: detail ? verb + " · " + detail : verb, at: now() }].slice(-40),
    });
  }
  clearActivity(botId, missionId) {
    const prev = this.activity.get(botId);
    if (!prev || prev.missionId !== missionId) return;
    this.activity.delete(botId);
    this.emit({ type: "activity", mission: missionId, botId, verb: null, detail: null });
  }
  /** «Iris está escribiendo · informe.md» for the mission card. */
  activityLine(missionId) {
    for (const [botId, a] of this.activity)
      if (a.missionId === missionId)
        return (this.bot(botId)?.name || botId) + " está " + a.verb + (a.detail ? " · " + a.detail : "");
    return null;
  }
  announce(missionId, bot, text, key) {
    this.store.put("messages", { id: "note:" + key, missionId, botId: bot.id, role: "system", kind: "activity", text, at: now() });
  }
  stop(missionId, cancel = false) {
    const m = this.store.get("missions", missionId);
    if (!m || ["completed", "cancelled"].includes(m.status)) throw Error("La misión ya ha terminado.");
    this.store.patch("missions", missionId, { status: cancel ? "cancelled" : "paused", stopped: cancel ? null : stoppedRecord({ reason: "cancelled" }) });
    this.active.get(missionId)?.abort(Error(cancel ? "Misión cancelada por el usuario." : "Misión pausada por el usuario."));
    if (cancel)
      for (const a of this.store.where("approvals", "missionId", missionId).filter((a) => a.status === "pending" && !["skill", "soul"].includes(a.kind)))
        this.store.patch("approvals", a.id, { status: "denied", decidedAt: now(), decidedBy: "tú", resolution: "Misión cancelada" });
    this.store.event(missionId, cancel ? "cancelled" : "paused", { text: cancel ? "Misión cancelada" : "Misión pausada" });
    if (cancel) this.learnSoon(missionId);
  }
  /**
   * «Descartar» on a stopped turn: what it left half done is dropped (its pending steps end
   * as skipped, their pending approvals denied) and the conversation is ready for your next
   * message; what was already said and done stays.
   */
  discardStopped(missionId) {
    const m = this.store.get("missions", missionId);
    if (!m) throw Error("La misión no existe.");
    if (this.active.has(missionId)) throw Error("Espera a que termine de parar.");
    if (!["paused", "blocked"].includes(m.status)) throw Error("No hay nada parado que descartar.");
    const open = this.steps(missionId).filter((s) => s.status !== "completed");
    for (const s of open) this.store.patch("steps", s.id, { status: "completed", skipped: true, stalled: null, pending: [], completedAt: now() });
    const ids = new Set(open.map((s) => s.id));
    for (const a of this.store.where("approvals", "missionId", missionId).filter((a) => a.status === "pending" && ids.has(a.stepId)))
      this.store.patch("approvals", a.id, { status: "denied", decidedAt: now(), decidedBy: "tú", resolution: "Descartado" });
    this.store.patch("missions", missionId, { status: "completed", error: null, stopped: null, interrupted: null, pausedBy: null, completedAt: now() });
    this.store.event(missionId, "discarded", { text: "Descartaste lo que quedó a medias" });
    return this.store.get("missions", missionId);
  }
  /** «Pausar a todo el equipo»: pauses every active mission; work done is kept. */
  pauseAll() {
    if (this.store.get("settings", "main")) this.store.patch("settings", "main", { paused: true });
    let count = 0;
    for (const m of this.store.list("missions")) {
      if (!ACTIVE.includes(m.status)) continue;
      this.store.patch("missions", m.id, { status: "paused", pausedBy: "all", error: "El equipo esta en pausa." });
      this.active.get(m.id)?.abort(Error("Equipo en pausa."));
      this.store.event(m.id, "paused", { text: "Equipo en pausa" });
      count++;
    }
    return count;
  }
  resumeAll() {
    if (this.store.get("settings", "main")) this.store.patch("settings", "main", { paused: false });
    let count = 0;
    for (const m of this.store.list("missions")) {
      if (m.status !== "paused" || m.pausedBy !== "all") continue;
      this.store.patch("missions", m.id, { pausedBy: null, error: null });
      this.relaunch(m.id);
      count++;
    }
    return count;
  }
  complete(missionId, result, botId = null) {
    const mission = this.store.get("missions", missionId);
    // An automation with nothing new: no notice, and the next run knows what this one said.
    let nothingNew = false;
    // An unattended run lists the red lines it left for you (they wait in the Bandeja).
    const pending = pendingSummary(this.store, missionId);
    if (mission.automationId) {
      ({ quiet: nothingNew, text: result } = quietRun(result));
      if (pending) { nothingNew = false; result = String(result || "") + pending; }
      if (this.store.get("automations", mission.automationId))
        this.store.patch("automations", mission.automationId, { lastSummary: String(result).slice(0, 2000), lastSummaryAt: now(), lastQuiet: nothingNew });
    }
    this.store.patch("missions", missionId, {
      status: "completed", result, completedAt: now(), error: null, ...(mission.automationId ? { nothingNew } : {}),
      ...(pending ? { pendingRedLines: this.store.where("approvals", "missionId", missionId).filter((a) => a.deferred && a.status === "pending").map((a) => ({ id: a.id, title: a.title || a.summary || "" })) } : {}),
    });
    if (pending) this.store.put("messages", { id: "pending-redlines:" + missionId, missionId, role: "system", kind: "activity", text: pending.trim().replace(/\*\*/g, ""), at: now() });
    if (!mission.conversation) {
      const existing = this.store.get("artifacts", missionId + ":result");
      this.store.put("artifacts", {
        id: missionId + ":result", missionId, botId, title: mission.title, content: result, kind: "document", format: "md",
        status: "final", version: existing ? (existing.version || 1) + 1 : 1, room: mission.room || null,
        createdAt: existing?.createdAt || now(), updatedAt: now(),
      });
    }
    this.store.event(missionId, "completed", { text: mission.conversation ? "Respuesta lista" : "Entrega disponible en Biblioteca" });
  }
  /** Debate: one bot = choose its proposal; two = Atlas merges both into one delivery. */
  choose(missionId, botIdOrIds) {
    const m = this.store.get("missions", missionId);
    if (m?.status !== "awaiting_choice") throw Error("El debate no esta listo.");
    const ids = [...new Set(Array.isArray(botIdOrIds) ? botIdOrIds : [botIdOrIds])];
    if (!ids.length || ids.length > 2) throw Error("Elige una propuesta o combina dos.");
    const steps = this.steps(missionId);
    const proposals = ids.map((b) => steps.find((s) => s.botId === b && s.kind === "proposal"));
    if (proposals.some((p) => !p)) throw Error("Propuesta no encontrada.");
    this.store.patch("missions", missionId, { chosenBotIds: ids, chosenBotId: ids[0] });
    if (ids.length === 1) {
      this.complete(missionId, proposals[0].text, ids[0]);
      const job = this.learn(missionId, this.settings().model, AbortSignal.timeout(90000));
      this.jobs.add(job);
      job.finally(() => this.jobs.delete(job));
      return;
    }
    const names = ids.map((b) => this.bot(b)?.name || b).join(" y ");
    this.makeStep(missionId, "combine", "atlas", "synthesis", [...proposals.map((p) => p.key), ...steps.filter((s) => s.kind === "critique").map((s) => s.key)], {
      combine: true,
      request: "Combina en una unica entrega las propuestas de " + names + " para este encargo: «" + m.prompt.slice(0, 4000) +
        "». Conserva lo mejor de cada una, resuelve contradicciones y explica en dos lineas que tomaste de cada propuesta.",
    });
    this.store.patch("missions", missionId, { steps: [...m.steps, "combine"], status: "queued" });
    this.store.event(missionId, "combine", { text: "Atlas combina las propuestas de " + names });
    this.launch(missionId);
  }
  async shutdown() {
    for (const c of this.active.values()) c.abort(Error("Colmena se esta cerrando."));
    await Promise.allSettled([...this.jobs]);
  }
}

installMethods(Runtime, InferenceMethods);
installMethods(Runtime, ContextMethods);
installMethods(Runtime, SideJobMethods);
installMethods(Runtime, EffectMethods);
installMethods(Runtime, ApprovalMethods);
installMethods(Runtime, DelegationMethods);
