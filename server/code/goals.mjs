import { now } from "../store.mjs";
import { BLOCKED_ROUNDS, blockingKey, mayDeclareBlocked, onlyHard, trackBlocking } from "../guards.mjs";
import { GOAL_TURNS, GOAL_MARK, goalPrompt, clip } from "./shared.mjs";

/** CodeService methods: a task's goal — setting it and the turns Colmena gives on its own until it is met. */
export class GoalMethods {

  // ------------------------------------------------------------------ goals («/goal»)
  /** «/goal <qué es estar hecho>»: Bruno keeps going turn after turn until he says it is done. */
  async setGoal(taskId, { action = "set", text = "" }) {
    const task = this.mustTask(taskId);
    const goal = task.goal || null;
    if (action === "set") {
      const objective = clip(String(text || "").trim(), 2000);
      if (!objective) throw Object.assign(Error("Di qué es «hecho»: por ejemplo, /goal pasan todos los tests."), { status: 400 });
      // A task started with only its goal takes its name from it.
      const title = !(task.turns || []).length && task.title === "Tarea nueva" ? { title: clip(objective.split(/\r?\n/)[0], 70) } : {};
      this.setTask(taskId, { ...title, goal: { text: objective, status: "active", turns: 0, max: GOAL_TURNS, note: null, at: now() } });
      return this.goalTurn(taskId, "Objetivo: «" + clip(objective, 160) + "»");
    }
    if (!goal) throw Object.assign(Error("Esta tarea no tiene objetivo."), { status: 409 });
    if (action === "clear") { this.setTask(taskId, { goal: null }); this.addItem(taskId, { kind: "notice", text: "Has quitado el objetivo." }); return { ok: true }; }
    if (action === "pause") { this.setTask(taskId, { goal: { ...goal, status: "paused", note: "Lo has pausado." } }); return { ok: true }; }
    if (action === "complete") { this.setTask(taskId, { goal: { ...goal, status: "complete", note: "Lo diste por cumplido." } }); return { ok: true }; }
    if (action === "resume") {
      this.setTask(taskId, { goal: { ...goal, status: "active", turns: 0, note: null } });
      return this.goalTurn(taskId, "Sigues con el objetivo");
    }
    throw Object.assign(Error("Acción de objetivo desconocida."), { status: 400 });
  }

  /** Starts (or queues behind the running turn) the next turn toward the goal. */
  async goalTurn(taskId, line) {
    const task = this.mustTask(taskId);
    const prompt = goalPrompt(task.goal, true);
    if (this.engines.get(taskId)?.turn || this.starting.has(taskId)) return { queued: true }; // the turn that ends picks it up
    void this.startTurn(task.saved ? await this.recover(taskId) : task, prompt, "build", { goal: line });
    return { started: true };
  }

  /** After a turn: Bruno's mark says whether the goal is done, goes on or is blocked. */
  goalAfter(taskId, turn, { failed, stopped }) {
    const task = this.mustTask(taskId);
    const goal = task.goal;
    if (!goal || goal.status !== "active" || turn.mode === "plan") return null;
    // The mark is read from the turn's last answer and taken out of what the person sees.
    const last = [...this.items(taskId)].reverse().find((i) => i.kind === "text" && i.turn === turn.n);
    const m = last ? GOAL_MARK.exec(last.text) : null;
    if (last && m) this.patchItem(last.id, { text: last.text.replace(GOAL_MARK, "").trim() || "…" });
    const set = (changes) => this.setTask(taskId, { goal: { ...goal, ...changes } });
    if (stopped) { set({ status: "paused", note: "Lo paraste." }); return null; }
    if (failed) { set({ status: "paused", note: "El turno falló." }); return null; }
    const said = (m?.[1] || "sigue").toLowerCase();
    if (said === "cumplido") {
      set({ status: "complete", note: null, turns: goal.turns + 1 });
      this.addItem(taskId, { kind: "notice", text: "Objetivo cumplido: «" + clip(goal.text, 120) + "».", tone: "done" });
      return { kind: "done", notice: "Objetivo cumplido: " + goal.text };
    }
    // Anti-false-blocked (guards.mjs): blocked only when the same condition held for
    // BLOCKED_ROUNDS turns in a row; «it is difficult» is not blocked; anything else resets.
    const why = said === "bloqueado" ? clip((m?.[2] || "").trim() || "Necesita algo de ti para seguir.", 300) : null;
    const blocking = trackBlocking(goal.blocking, why && !onlyHard(why) ? blockingKey("objetivo", why) : null);
    if (why && mayDeclareBlocked(blocking, { reason: why })) {
      set({ status: "blocked", note: why, turns: goal.turns + 1, blocking });
      this.addItem(taskId, { kind: "notice", text: "Objetivo bloqueado: " + why, tone: "warn" });
      return { kind: "needs", notice: "Objetivo bloqueado: " + why };
    }
    const turns = goal.turns + 1;
    if (why && turns < (goal.max || GOAL_TURNS)) {
      set({ turns, blocking });
      const hard = !blocking.key;
      return {
        next: goalPrompt({ ...goal, turns }, false) + "\n" + (hard
          ? `Dijiste «${why}», pero que algo sea difícil no es un bloqueo: sigue intentándolo de otra forma.`
          : `Dijiste que estás bloqueado («${why}»). Solo es un bloqueo si la misma condición sigue ${BLOCKED_ROUNDS} vueltas seguidas (van ${blocking.rounds}): antes intenta otra forma de avanzar o deja preparado todo lo demás; si sigue igual, vuelve a marcarlo con el mismo motivo.`),
        line: `Sigue con el objetivo · vuelta ${turns + 1} de ${goal.max || GOAL_TURNS}`,
      };
    }
    if (turns >= (goal.max || GOAL_TURNS)) {
      set({ status: "limited", note: `Ha dado ${turns} vueltas sin cumplirlo.`, turns });
      this.addItem(taskId, { kind: "notice", text: `Bruno ha parado tras ${turns} vueltas: el objetivo aún no se cumple. Reanúdalo o cámbialo.`, tone: "warn" });
      return { kind: "needs", notice: `Ha dado ${turns} vueltas sin cumplir el objetivo.` };
    }
    set({ turns, blocking: null });
    return { next: goalPrompt({ ...goal, turns }, false), line: `Sigue con el objetivo · vuelta ${turns + 1} de ${goal.max || GOAL_TURNS}` };
  }
}
