import { isUnattended, ownFileCommand, personAsked, personTurnText } from "../redlines.mjs";
import { isComputerTool, addComputerGrant } from "../computer/tools.mjs";
import path from "node:path";
import { id, now } from "../store.mjs";
import { activateSkill, resolveSkillApproval } from "../skills.mjs";
import { parseOutputSchema } from "../structured.mjs";
import { normalizeScope } from "../writescopes.mjs";
import { autonomyOf, readSoul, writeSoul } from "../soul.mjs";
import { suggestAlwaysApprove, addGrant, normalizeText, rejectSoulProposal } from "../learning.mjs";
import { decideRevert } from "../verdicts.mjs";
import { answersForBot, answersText, buildQuestions, checkAnswers, lateAnswerText, QUESTION_PENDING, QUESTION_WAIT_MINUTES } from "../questions.mjs";
import { flat, sameUrl, sha } from "./helpers.mjs";

/** Runtime methods: questions to the person, plans and approvals (asking, answering, deciding). */
export class ApprovalMethods {
  approvalContext(mission, bot) {
    const automation = mission.automationId ? this.store.get("automations", mission.automationId) : null;
    return (bot?.name || "Colmena") + " · " + (automation ? automation.name : mission.room ? "#" + mission.room : mission.title);
  }
  askUser(mission, step, bot, call, args) {
    const approvalId = step.id + ":" + call.call_id;
    const a = this.store.get("approvals", approvalId);
    if (!a) {
      // present_choices (openmuse): an option may cite a page; the quote must be literal in what web_fetch read here.
      const sources = (args.sources || []).map((s) => ({ url: s.url.trim(), quote: s.quote.trim() }));
      const problems = [];
      if (sources.some((s) => s.url || s.quote)) {
        const pages = this.fetchedPages(mission.id);
        sources.forEach((s, i) => {
          if (!s.url && !s.quote) return;
          if (i >= args.options.length) return problems.push(`La fuente ${i + 1} no corresponde a ninguna opción.`);
          if (!s.url || !s.quote) return problems.push(`Opción ${i + 1}: una fuente necesita url y cita.`);
          const page = pages.find((p) => sameUrl(p.url, s.url) || sameUrl(p.finalUrl, s.url));
          if (!page) return problems.push(`Opción ${i + 1}: no has leído ${s.url} con web_fetch en esta misión.`);
          if (!flat(page.text).includes(flat(s.quote))) problems.push(`Opción ${i + 1}: la cita no aparece literalmente en ${s.url}.`);
        });
      }
      if (problems.length) throw Error(problems.join(" ") + " Corrige o quita esas fuentes y vuelve a preguntar.");
      const options = args.options.map((label, i) => ({
        id: "o" + (i + 1), label, primary: i === 0,
        ...(sources[i]?.url ? { source: { url: sources[i].url, quote: sources[i].quote } } : {}),
      }));
      // Several at once: answered one at a time in the chat (questions.mjs).
      const questions = args.more?.length ? buildQuestions(args).map((q, i) => (i === 0 ? { ...q, options } : q)) : null;
      // How long the bot waits (questionWait): then it goes on with the prudent option and the
      // question stays open; a later answer still reaches it.
      const waitMinutes = this.questionWait(mission, bot, args.waitMinutes);
      const waitUntil = waitMinutes ? new Date(Date.now() + waitMinutes * 60000).toISOString() : null;
      this.store.put("approvals", {
        id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: call.call_id, tool: "ask_user",
        kind: "question", title: args.question.slice(0, 140), summary: args.question, context: this.approvalContext(mission, bot),
        blocks: args.blocks, options, email: null, canAlways: false, status: "pending", createdAt: now(),
        decidedAt: null, decidedBy: null, resolution: null, ...(questions ? { questions } : {}),
        ...(waitUntil ? { waitMinutes, waitUntil } : {}),
      });
      if (waitUntil) this.wakeAt(mission.id, waitUntil);
      this.store.put("messages", {
        id: "question:" + approvalId, missionId: mission.id, botId: bot.id, role: "assistant", kind: "question",
        text: args.question, options, approvalId, stepId: step.id, at: now(),
      });
      this.store.event(mission.id, "approval_requested", { botId: bot.id, text: bot.name + " tiene una pregunta" });
      return { waiting: true };
    }
    if (a.status === "pending" && a.timedOut) return QUESTION_PENDING;
    if (a.status === "pending" && a.waitUntil && Date.parse(a.waitUntil) <= Date.now()) {
      // Nobody answered in time: pending, never a «no» nor a «yes»; the card stays answerable.
      this.store.patch("approvals", a.id, { timedOut: true, timedOutAt: now() });
      this.store.event(mission.id, "question_timeout", { botId: bot.id, text: bot.name + " sigue con lo prudente; la pregunta sigue abierta" });
      return QUESTION_PENDING;
    }
    if (a.status === "pending") return { waiting: true };
    if (a.status === "answered" && a.answers) return answersForBot(a.answers);
    if (a.status === "answered") return { answer: a.answer.text || a.answer.label, optionId: a.answer.optionId || null };
    return { answer: null, message: "La persona prefirio no responder. Sigue con la opcion mas prudente y dilo." };
  }
  /**
   * Minutes a bot waits for an answer: what it asked for (waitMinutes), else for bots that act
   * on their own settings.questionWaitMinutes (default QUESTION_WAIT_MINUTES; 0 = no limit).
   * A bot that only suggests waits for you unless it asked for a limit.
   */
  questionWait(mission, bot, asked = 0) {
    if (asked > 0) return Math.min(asked, 24 * 60);
    if (this.autonomy(mission, bot) === "sugiere") return 0;
    const setting = this.settings().questionWaitMinutes;
    return Number.isFinite(setting) && setting >= 0 ? Math.min(setting, 24 * 60) : QUESTION_WAIT_MINUTES;
  }
  /** Relaunches the mission when a question's wait ends (missed timers: sweepQuestions). */
  wakeAt(missionId, at) {
    const timer = setTimeout(() => this.sweepQuestions(missionId), Math.max(0, Date.parse(at) - Date.now()) + 50);
    timer.unref?.();
  }
  /** Questions whose wait ended while nobody answered: their mission goes on. */
  sweepQuestions(missionId = null) {
    const due = this.store.list("approvals").filter((a) => a.kind === "question" && a.status === "pending" && !a.timedOut && a.waitUntil
      && Date.parse(a.waitUntil) <= Date.now() && (!missionId || a.missionId === missionId));
    for (const missionId of new Set(due.map((a) => a.missionId))) {
      const m = this.store.get("missions", missionId);
      if (m && !["cancelled", "completed"].includes(m.status) && !this.active.has(missionId)) this.wake(missionId);
    }
    return due.length;
  }
  answer(approvalId, { optionId = null, text = "", answers = null } = {}) {
    const a = this.store.get("approvals", approvalId);
    if (!a || a.kind !== "question") throw Error("Pregunta no encontrada.");
    if (a.status !== "pending") throw Error("Esta pregunta ya está respondida.");
    // «Lucía pide a Vera: …» (server/room-work.mjs): your decision on another person's request.
    // It closes here and the room hears it; never a message of yours in the room («Adelante»
    // must not read as your word for anything else) and nothing to relaunch.
    if (a.roomRequest || a.roomShare) {
      const option = a.options.find((o) => o.id === optionId);
      if (!option) throw Error("Elige una de las opciones.");
      this.store.patch("approvals", a.id, { status: "answered", answer: { optionId: option.id, label: option.label, text: null }, decidedAt: now(), decidedBy: "tú", resolution: option.label });
      return;
    }
    if (this.store.get("missions", a.missionId)?.status === "cancelled") throw Error("La misión está cancelada.");
    // The bot already went on without it: the answer reaches it as your message, tagged as the reply.
    if (a.timedOut) return this.lateAnswer(a, { optionId, text, answers });
    // Several questions, answered by steps: all of them together, once.
    if (a.questions?.length) {
      const normalized = checkAnswers(a.questions, answers || [{ id: a.questions[0].id, optionId, text }]);
      const said = answersText(normalized);
      const answered = normalized.filter((x) => !x.skipped).length;
      this.store.patch("approvals", a.id, {
        status: "answered", answers: normalized, answer: { optionId: null, label: null, text: said },
        decidedAt: now(), decidedBy: "tú", resolution: answered === normalized.length ? `${answered} respuestas` : `${answered} de ${normalized.length} respuestas`,
      });
      this.store.put("messages", { id: id(), missionId: a.missionId, role: "user", kind: "message", text: said, approvalId: a.id, at: now() });
      this.store.event(a.missionId, "approval_decided", { text: "Preguntas respondidas" });
      this.relaunch(a.missionId);
      return;
    }
    const option = optionId ? a.options.find((o) => o.id === optionId) : null;
    if (optionId && !option) throw Error("Opcion no valida.");
    const written = String(text || "").trim().slice(0, 4000);
    if (!option && !written) throw Error("Elige una opcion o escribe una respuesta.");
    this.store.patch("approvals", a.id, {
      status: "answered", answer: { optionId: option?.id || null, label: option?.label || null, text: written || null },
      decidedAt: now(), decidedBy: "tú", resolution: written || option.label,
    });
    this.store.put("messages", { id: id(), missionId: a.missionId, role: "user", kind: "message", text: written || option.label, approvalId: a.id, at: now() });
    this.store.event(a.missionId, "approval_decided", { text: "Pregunta respondida" });
    this.relaunch(a.missionId);
  }
  /**
   * «Descartar» a question: it closes without an answer and the bot goes on with the most
   * prudent option, saying so (ask_user then returns «prefirió no responder»).
   */
  dismissQuestion(approvalId) {
    const a = this.store.get("approvals", approvalId);
    if (!a || a.kind !== "question") throw Error("Pregunta no encontrada.");
    if (a.status !== "pending") throw Error("Esta pregunta ya no espera respuesta.");
    this.store.patch("approvals", a.id, { status: "dismissed", decidedAt: now(), decidedBy: "tú", resolution: "Sin responder" });
    if (a.roomRequest || a.roomShare) return; // another person's request (or what it made), put aside: «ahora no», «no compartir» (server/room-work.mjs)
    this.store.event(a.missionId, "approval_decided", { text: "Pregunta descartada" });
    // Timed out: the bot already went on; nothing waits for this card any more.
    if (!a.timedOut) this.relaunch(a.missionId);
  }
  /**
   * An answer to a question that already timed out (the bot went on with the prudent option):
   * it closes the question and reaches the bot as your message, tagged as the reply — in the
   * step that asked when it still works, else in a new turn of that bot.
   */
  lateAnswer(a, { optionId = null, text = "", answers = null } = {}) {
    let said, answer, extra = {};
    if (a.questions?.length) {
      const normalized = checkAnswers(a.questions, answers || [{ id: a.questions[0].id, optionId, text }]);
      said = answersText(normalized);
      answer = { optionId: null, label: null, text: said };
      extra = { answers: normalized };
    } else {
      const option = optionId ? a.options.find((o) => o.id === optionId) : null;
      if (optionId && !option) throw Error("Opcion no valida.");
      const written = String(text || "").trim().slice(0, 4000);
      if (!option && !written) throw Error("Elige una opcion o escribe una respuesta.");
      said = written || option.label;
      answer = { optionId: option?.id || null, label: option?.label || null, text: written || null };
    }
    this.store.patch("approvals", a.id, { status: "answered", answer, ...extra, lateAnswer: true, decidedAt: now(), decidedBy: "tú", resolution: String(said).replace(/\s+/g, " ").trim().slice(0, 200) });
    const message = this.store.put("messages", { id: id(), missionId: a.missionId, role: "user", kind: "message", text: said, approvalId: a.id, lateAnswer: true, answersQuestion: String(a.summary || a.title || "").slice(0, 600), at: now() });
    this.store.event(a.missionId, "approval_decided", { text: "Pregunta respondida (después de que siguiera)" });
    const step = this.store.get("steps", a.stepId);
    const mission = this.store.get("missions", a.missionId);
    if (step && step.status !== "completed") {
      if (!this.active.has(a.missionId)) this.relaunch(a.missionId);
      return message;
    }
    if (!mission || mission.status === "cancelled") return message;
    // Asked in a turn for another person's request: what goes on from your answer keeps its limits.
    const keys = this.queueTurns(a.missionId, [a.botId], this.steps(a.missionId).map((s) => s.key), { request: lateAnswerText(message.answersQuestion, said), ackOn: message.id, extra: this.turnLimits(step) });
    this.store.patch("missions", a.missionId, { steps: [...(mission.steps || []), ...keys], ...(mission.status === "completed" ? { status: "queued", error: null } : {}) });
    if (mission.status === "completed" && this.active.has(a.missionId)) void Promise.resolve(this.missionJobs.get(a.missionId)).then(() => this.launch(a.missionId));
    else if (!this.active.has(a.missionId) && !["paused"].includes(mission.status)) this.launch(a.missionId);
    return message;
  }
  proposePlan(mission, step, bot, call, args) {
    if (step.kind !== "plan") throw Error("Solo el paso de plan puede proponer un reparto.");
    const approvalId = step.id + ":" + call.call_id;
    let a = this.store.get("approvals", approvalId);
    // Resumed after the approval (or a second call): the plan is already in place — not a failure.
    if (!a && mission.plan?.approved) return { approved: true, message: "El plan ya está aprobado. Resume el reparto en una o dos frases para la sala; no hagas el trabajo de los demás." };
    if (!a) {
      const pool = mission.botIds.length ? mission.botIds : this.teamCandidates().map((b) => b.id);
      const assignments = [], problems = [], order = [];
      const resolve = (ref) => this.bot(ref) || this.store.list("bots").find((b) => normalizeText(b.name) === normalizeText(ref));
      for (const item of args.assignments) {
        const target = resolve(item.botId);
        if (!target || !target.enabled || target.audience === "yo" || target.id === "atlas" || !pool.includes(target.id)) {
          problems.push(item.botId);
          continue;
        }
        // Dependencies only on teammates listed earlier: no cycles, a readable order.
        const after = [];
        for (const ref of item.after || []) {
          const dep = resolve(ref);
          if (!dep || !order.includes(dep.id)) return { error: "«after» de " + target.name + " debe nombrar bots que aparezcan antes en el reparto: " + ref + "." };
          if (!after.includes(dep.id) && dep.id !== target.id) after.push(dep.id);
        }
        const title = item.title || item.task.split(/(?<=[.:;])\s/)[0].slice(0, 90);
        // Data another part needs: the deliverable as JSON matching outputSchema.
        const { schema, error } = parseOutputSchema(item.outputSchema);
        if (error) return { error: "La parte de " + target.name + ": " + error };
        const writes = [...new Set((item.writes || []).map(normalizeScope).filter(Boolean))];
        assignments.push({
          botId: target.id, title, task: item.task, deliverable: item.deliverable || (schema ? "Datos en JSON" : ""), avoid: item.avoid || "", after,
          ...(schema ? { outputSchema: schema } : {}), ...(writes.length ? { writes } : {}),
        });
        order.push(target.id);
      }
      if (problems.length)
        return { error: "Bots no válidos en el reparto: " + problems.join(", ") + ".", disponibles: pool };
      const plan = { assignments, summary: args.summary };
      // The plan starts at once (OpenClaw/Codex auto mode): you see it in the room and can
      // stop it or change it while the team works. Only an Atlas set to «Solo sugiere» waits
      // for your OK (a single task never does). Red lines inside the work still wait for you.
      const auto = autonomyOf(bot) !== "sugiere" || assignments.length === 1;
      const message = this.store.put("messages", {
        id: "plan:" + approvalId, missionId: mission.id, botId: bot.id, role: "assistant", kind: "plan", text: args.summary,
        plan: { assignments, approved: auto, ...(auto ? { auto: true } : {}) }, approvalId, stepId: step.id, at: now(),
      });
      a = this.store.put("approvals", {
        id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: call.call_id, tool: "propose_plan",
        kind: "plan", title: "Plan para «" + mission.title + "»", summary: args.summary, context: this.approvalContext(mission, bot),
        blocks: assignments.length + 1, options: [], email: null, canAlways: false, plan, messageId: message.id,
        status: auto ? "approved" : "pending", createdAt: now(), decidedAt: auto ? now() : null,
        decidedBy: auto ? "regla" : null, resolution: auto ? (assignments.length === 1 ? "Arranca solo: es una única tarea" : "Arranca solo: puedes pararlo o cambiarlo mientras trabajan") : null,
      });
      if (auto) {
        this.applyPlan(mission.id, a);
        return { approved: true, decidedBy: "regla", message: "El plan ya está en marcha; la persona puede pararlo o cambiarlo. Resume el reparto en una o dos frases para la sala; no hagas el trabajo de los demás." };
      }
      this.store.event(mission.id, "plan_proposed", { botId: bot.id, text: "Atlas propone un plan" });
      return { waiting: true };
    }
    if (a.status === "pending") return { waiting: true };
    if (a.status === "approved") return { approved: true, message: "La persona aprobó el plan. Resume el reparto en una o dos frases para la sala; no hagas el trabajo de los demás." };
    return { approved: false, changes: a.note || "", message: "La persona pide cambios. Rehaz el plan teniéndolos en cuenta y vuelve a llamar a propose_plan." };
  }
  applyPlan(missionId, approval) {
    const mission = this.store.get("missions", missionId);
    if (mission.plan?.approved || mission.steps.includes("synthesis")) return;
    const { assignments, summary } = approval.plan;
    const keys = [], used = new Map(), latest = new Map();
    for (const item of assignments) {
      const n = (used.get(item.botId) || 0) + 1;
      used.set(item.botId, n);
      const key = "work-" + item.botId + (n > 1 ? "-" + n : "");
      // A teammate starts when the ones it needs (listed earlier) have finished.
      const deps = ["plan", ...(item.after || []).map((b) => latest.get(b)).filter(Boolean)];
      const task = [item.title && !item.task.startsWith(item.title) ? item.title : null, item.task, item.deliverable ? "Entrega: " + item.deliverable : "", item.avoid ? "No hagas: " + item.avoid : ""].filter(Boolean).join("\n");
      this.makeStep(missionId, key, item.botId, "work", [...new Set(deps)], {
        task, taskTitle: item.title || null, request: null, ackOn: approval.messageId || null,
        ...(item.outputSchema ? { outputSchema: item.outputSchema } : {}), ...(item.writes?.length ? { writes: item.writes } : {}),
      });
      latest.set(item.botId, key);
      keys.push(key);
    }
    // A single part: that bot's delivery is the final answer (no Atlas synthesis, ~90 s less).
    const single = keys.length === 1;
    if (single) this.store.patch("steps", missionId + ":" + keys[0], { final: true });
    else this.makeStep(missionId, "synthesis", "atlas", "synthesis", keys);
    this.store.patch("missions", missionId, {
      steps: [...mission.steps, ...keys, ...(single ? [] : ["synthesis"])],
      botIds: [...new Set(assignments.map((x) => x.botId))],
      plan: { assignments, summary, approved: true, approvedAt: now() },
    });
    if (approval.messageId) {
      const msg = this.store.get("messages", approval.messageId);
      if (msg) this.store.patch("messages", msg.id, { plan: { ...msg.plan, approved: true } });
    }
    this.store.event(missionId, "plan_approved", { text: "Plan aprobado" });
  }
  /** Approve the proposed plan or ask Atlas to redo it with a note. */
  planDecision(missionId, decision, note = "") {
    const a = this.store.where("approvals", "missionId", missionId).filter((x) => x.kind === "plan" && x.status === "pending").at(-1);
    if (!a) throw Error("No hay un plan pendiente.");
    if (decision === "approved") {
      this.store.patch("approvals", a.id, { status: "approved", decidedAt: now(), decidedBy: "tú", resolution: "Plan aprobado" });
      this.applyPlan(missionId, a);
    } else if (decision === "changes") {
      const value = String(note || "").trim().slice(0, 4000);
      if (!value) throw Error("Indica que quieres cambiar del plan.");
      this.store.patch("approvals", a.id, { status: "denied", decidedAt: now(), decidedBy: "tú", resolution: "Cambios pedidos", note: value });
      this.store.put("messages", { id: id(), missionId, role: "user", kind: "message", text: value, approvalId: a.id, at: now() });
      this.store.event(missionId, "plan_changes", { text: "Has pedido cambios en el plan" });
    } else throw Error("Decision no valida.");
    this.store.patch("missions", missionId, { status: "queued" });
    this.relaunch(missionId);
  }
  /**
   * A red line about to wait for the person (computer commands, unconfined project runs),
   * judged by its effect (redlines.mjs): {approved, by, resolution} when it only undoes this
   * mission's own work, when your message in this turn named it exactly, or when you already
   * approved it after a routine left it pending; {deferred:true} in an unattended run; null =
   * ask as usual. Never for something read outside, nor for sends, buys or payments.
   */
  redLineShortcut(mission, step, bot, { tool, args = {}, approvalId = null } = {}) {
    const fresh = this.store.get("missions", mission.id) || mission;
    const same = (a) => a.tool === tool && JSON.stringify(a.args ?? null) === JSON.stringify(args ?? null);
    const earlier = this.store.where("approvals", "missionId", mission.id).find((a) => a.id !== approvalId && a.deferred && a.status === "approved" && !a.consumedBy && same(a));
    if (earlier) {
      this.store.patch("approvals", earlier.id, { consumedBy: approvalId, status: "executed" });
      return { approved: true, by: "tú", resolution: "Lo aprobaste tú después (lo dejó pendiente una rutina)" };
    }
    if (!this.flagged(step) && tool === "run_command") {
      if (ownFileCommand(this.store, mission.id, args)) return { approved: true, by: "colmena", resolution: "Sin preguntar: solo borra archivos que creó esta misión" };
      const text = personTurnText(this.store, fresh, step);
      const files = (args.args || []).map(String).filter((x) => !x.startsWith("-"));
      const deletes = /^(del|erase|rm|remove-item|ri|rmdir|rd)(\.exe)?$/i.test(path.basename(String(args.program || "")));
      const asked = deletes ? personAsked(text, { action: "borrar", targets: files })
        : personAsked(text, { action: "ejecutar", targets: [[path.basename(String(args.program || "")).replace(/\.(exe|com)$/i, ""), ...(args.args || [])].join(" ")] });
      if (asked) return { approved: true, by: "tú", resolution: "Lo pediste tú en tu mensaje" };
    }
    if (isUnattended(fresh, this.settings(), step)) return { deferred: true };
    return null;
  }
  /** Your decision on a red line an unattended routine left for later (its step already ended). */
  approveDeferred(a, decision) {
    if (!["approved", "denied"].includes(decision)) throw Error("Decision no valida.");
    const mission = this.store.get("missions", a.missionId);
    if (!mission || mission.status === "cancelled") throw Error("La misión está cancelada.");
    this.store.patch("approvals", a.id, { status: decision, decidedAt: now(), decidedBy: "tú", resolution: decision === "approved" ? "Aprobado · se hace ahora" : "Denegado" });
    this.store.event(a.missionId, "approval_decided", { text: decision === "approved" ? "Accion aprobada" : "Accion denegada" });
    if (decision !== "approved") return;
    const request = "La persona ha aprobado ahora lo que dejaste pendiente mientras no estaba: «" + String(a.title || a.summary || "").slice(0, 300) +
      "». Hazlo ahora con la misma herramienta (" + a.tool + ") y exactamente los mismos argumentos (" + JSON.stringify(a.args ?? {}).slice(0, 1500) + "): Colmena ya lo tiene aprobado. Después di en una frase cómo ha ido.";
    const keys = this.queueTurns(a.missionId, [a.botId], this.steps(a.missionId).map((s) => s.key), { request, extra: this.turnLimits(a.stepId ? this.store.get("steps", a.stepId) : null) });
    this.store.patch("missions", a.missionId, { steps: [...(mission.steps || []), ...keys], ...(mission.status === "completed" ? { status: "queued", error: null } : {}) });
    this.relaunch(a.missionId);
  }
  approve(approvalId, decision, { always = false } = {}) {
    const a = this.store.get("approvals", approvalId);
    if (!a || a.status !== "pending") throw Error("Esta solicitud ya está resuelta.");
    // Left pending by an unattended routine that already went on: approving it asks that bot
    // to do it now (its call is approved by this decision, redLineShortcut).
    if (a.deferred && !["apps_execute"].includes(a.tool) && this.store.get("steps", a.stepId)?.status === "completed") return this.approveDeferred(a, decision);
    if (!["approved", "denied"].includes(decision)) throw Error("Decision no valida.");
    if (a.tool === "apps_execute") throw Error("Revisa esta acción en el diálogo de conexiones antes de decidir.");
    const mission = this.store.get("missions", a.missionId);
    if (a.kind === "skill") {
      const skill = this.store.get("skills", a.skillId);
      if (skill?.status === "pending") activateSkill(this.store, skill.id, decision === "approved" ? "active" : "disabled");
      resolveSkillApproval(this.store, a.skillId, decision === "approved" ? "active" : "disabled");
      if (this.store.get("approvals", a.id).status === "pending")
        this.store.patch("approvals", a.id, { status: decision, decidedAt: now(), decidedBy: "tú", resolution: decision === "approved" ? "Habilidad activada" : "Habilidad descartada" });
      return;
    }
    if (a.kind === "soul") {
      if (decision === "approved") {
        const bot = this.bot(a.botId);
        const current = readSoul(a.botId, { bot }) || "";
        if (sha(current) !== a.baseHash) throw Error("El SOUL ha cambiado desde la propuesta. Revisala de nuevo.");
        writeSoul(a.botId, a.proposal, { source: "propuesta", reason: a.summary, approvalId: a.id }); // a version to restore later
        if (mission)
          this.store.put("messages", { id: id(), missionId: a.missionId, role: "system", botId: a.botId, kind: "activity", text: "Se ha actualizado el SOUL de " + (bot?.name || a.botId) + " con tu aprobación.", at: now() });
        this.store.event(a.missionId, "soul_updated", { botId: a.botId, text: "SOUL de " + (bot?.name || a.botId) + " actualizado" });
      } else rejectSoulProposal(this.store, a); // never proposed again
      this.store.patch("approvals", a.id, { status: decision === "approved" ? "executed" : "denied", decidedAt: now(), decidedBy: "tú", resolution: decision === "approved" ? "SOUL actualizado" : "Propuesta descartada" });
      return;
    }
    // Something learned made the work worse (verdicts.mjs): put it back, or keep it.
    if (a.kind === "revert") return void decideRevert(this.store, a, decision);
    if (mission?.status === "cancelled") throw Error("La misión está cancelada.");
    if (a.kind === "plan")
      return this.planDecision(a.missionId, decision === "approved" ? "approved" : "changes", decision === "approved" ? "" : "La persona no aprueba este reparto. Propon otro.");
    if (a.kind === "question") {
      if (decision === "approved") throw Error("Responde la pregunta eligiendo una opcion.");
      this.store.patch("approvals", a.id, { status: "denied", decidedAt: now(), decidedBy: "tú", resolution: "Sin respuesta" });
      this.relaunch(a.missionId);
      return;
    }
    if (always && decision === "approved" && !a.canAlways) throw Error("Esta acción no admite aprobación permanente.");
    this.store.patch("approvals", a.id, {
      status: decision, decidedAt: now(), decidedBy: "tú", resolution: decision === "approved" ? "Aprobado" : "Denegado",
    });
    this.store.event(a.missionId, "approval_decided", { text: decision === "approved" ? "Accion aprobada" : "Accion denegada" });
    if (always && decision === "approved") {
      if (isComputerTool(a.tool)) addComputerGrant(this.store, a);
      else addGrant(this.store, { botId: a.botId, tool: a.tool, kind: a.kind, scope: a.scope ?? null, origin: "approval" });
      // Equal requests already waiting are resolved by the new rule.
      for (const other of this.store.list("approvals"))
        if (other.status === "pending" && other.id !== a.id && other.botId === a.botId && other.tool === a.tool && (other.scope ?? null) === (a.scope ?? null) && other.canAlways &&
          !(other.stepId && this.flagged({ id: other.stepId }))) {
          this.store.patch("approvals", other.id, { status: "approved", decidedAt: now(), decidedBy: "regla", resolution: "Aprobado por una regla" });
          this.wake(other.missionId);
        }
    }
    this.relaunch(a.missionId);
    if (this.settings().learning !== false) {
      try { suggestAlwaysApprove(this.store); } catch {}
    }
  }
}
