// «Corregir mientras trabaja»: a message sent while Bruno works reaches the running turn.
//   Codex     `turn/steer` (app-server JSON-RPC) adds it to the active turn; the userMessage item
//             that records it carries our id (clientUserMessageId), so it shows as read. A CLI
//             without turn/steer: the message waits for the end of the turn, said in one sentence.
//   Claude    a `user` line on stdin (stream-json input): Claude Code takes it at its next step,
//             or, when the turn is already giving its last answer, runs it right after as a turn
//             of its own — that «overrun» is adopted here as the next turn, so nothing is lost.
//   OpenCode  `prompt_async` on the busy session: its loop takes it before going idle.
// The correction is a «user» row with `steer: true` and `ack` (sending → sent | received → read;
// «lost» when the engine closed before reading it: it then waits in the queue).
import { now } from "../store.mjs";

export const STEER_OFF = "Tu versión de Codex no deja corregir mientras trabaja: se lo paso cuando acabe. Actualiza Codex para corregirle al momento.";
const OVERRUN_MS = 60000; // how long a Claude Code correction may still come as a turn of its own
const GRACE_MS = 3000; // what the queue, the goal and the notice wait for it after a turn
const DISCARD_MS = 30000; // after «Parar», a correction Claude Code still had is not run
const ADOPT = new Set(["delta", "text", "tool", "toolDone", "plan", "mark", "child", "tokens"]);

/** CodeService methods: corrections into the running turn and what follows from them. */
export class SteerMethods {
  /**
   * Delivers a correction. Its row goes in the conversation at the moment it is sent (before
   * the engine answers, so what Bruno does after it comes below). When the engine cannot take it
   * — a Codex without turn/steer, or the turn ended meanwhile — the row goes and the caller
   * queues the message (or starts the next turn with it) instead.
   */
  async steer(taskId, entry, task, message, files, notes) {
    const engine = entry.engine;
    if (engine.steerable === false) return { steered: false, note: STEER_OFF };
    const turn = entry.turn;
    const body = await this.prepare(task, message, files, notes);
    if (entry.turn !== turn || !engine.alive) return { steered: false };
    const item = this.addItem(taskId, { kind: "user", text: message, attachments: files.length ? files : undefined, contexts: notes.length ? notes : undefined, steer: true, ack: "sending", engine: engine.kind, turn: turn.n });
    // Counted before it is written: a turn that ends meanwhile knows a correction may follow.
    turn.steered = (turn.steered || 0) + 1;
    try {
      const r = await engine.steer(body, { id: item.id });
      // Codex may have recorded it before its answer to the request came back.
      if (this.store.get("codeItems", item.id)?.ack === "sending") this.patchItem(item.id, { ack: r?.ack || "sent" });
      return { steered: true, item: item.id };
    } catch (error) {
      turn.steered -= 1;
      this.store.remove("codeItems", item.id);
      this.emit({ type: "reload", task: taskId });
      if (!error.unsupported && !error.ended) console.warn("Código: corrección no entregada: " + error.message);
      if (error.unsupported) this.emit({ type: "task", task: this.taskView(this.mustTask(taskId)) });
      return { steered: false, note: error.unsupported ? STEER_OFF : undefined };
    }
  }

  /** Codex recorded a correction (its userMessage item carried our id). */
  steerRead(taskId, id) {
    const item = this.store.get("codeItems", String(id || ""));
    if (item?.taskId === taskId && item.steer && item.ack !== "read") this.patchItem(item.id, { ack: "read" });
  }

  expectOverrun(entry, from) {
    entry.overrun = { from, until: Date.now() + OVERRUN_MS, adopted: null };
  }

  /** At the very end of a Claude Code turn with corrections, before anything is awaited. */
  overrunAfter(entry, turn, { failed = false, stopped = false } = {}) {
    if (turn.steered && entry.engine.kind === "claude-code" && !failed && !stopped) this.expectOverrun(entry, turn.n);
  }

  /**
   * An event with no turn open. A Claude Code follow-up (the correction run as a turn of its
   * own) becomes the next turn; after «Parar» it is interrupted instead. → the turn, or null.
   */
  strayEvent(taskId, entry, e) {
    if (entry.discard && Date.now() < entry.discard && e.type !== "done") {
      entry.discard = 0;
      void entry.engine.interrupt();
      return null;
    }
    const o = entry.overrun;
    if (!o || !ADOPT.has(e.type)) return null;
    entry.overrun = null;
    o.adopted?.();
    if (Date.now() > o.until) return null;
    const task = this.mustTask(taskId);
    const n = Math.max((task.turns || []).length, o.from, entry.lastN || 0) + 1;
    entry.lastN = n;
    const answers = this.items(taskId).find((i) => i.kind === "user" && i.steer && i.turn === o.from && i.ack !== "lost");
    clearTimeout(entry.idle);
    // It starts where the turn before it ended (its end point, captured in finishTurn).
    entry.turn = { n, mode: "build", compact: false, startSnap: entry.lastEnd || null, userItemId: answers?.id || null, started: Date.now(), live: "", tools: new Map(), lastAssistant: null, overrun: true };
    this.setTask(taskId, { status: "working", error: null });
    return entry.turn;
  }

  /**
   * After a turn with corrections. Corrections the engine never confirmed when the turn was cut
   * (the engine closed or failed) are marked «lost» and wait in the queue. A Claude Code turn
   * that ends normally may still have one to run: waits briefly for it → true when it came
   * (that turn takes over what comes after: queue, goal, notice).
   */
  async afterSteers(taskId, entry, turn, { cut = false, stopped = false } = {}) {
    if (!turn.steered) return false;
    if (stopped) {
      if (entry.engine.kind === "claude-code") entry.discard = Date.now() + DISCARD_MS;
      return false;
    }
    if (cut) {
      const lost = this.items(taskId).filter((i) => i.kind === "user" && i.steer && i.turn === turn.n && i.ack !== "read");
      if (!lost.length) return false;
      for (const i of lost) this.patchItem(i.id, { ack: "lost" });
      const task = this.mustTask(taskId);
      const back = lost.map((i) => ({ id: i.id.slice(-8), text: i.text, mode: "build", attachments: i.attachments || [], contexts: i.contexts || [], line: null, at: now() }));
      this.setTask(taskId, { queue: [...back, ...(task.queue || [])] });
      return false;
    }
    if (entry.engine.kind !== "claude-code" || !entry.engine.alive) return false;
    if (entry.turn) return true; // it came already (or the next turn started): that turn goes on
    const o = entry.overrun; // set by overrunAfter, when the turn ended
    if (!o || o.from !== turn.n) return false;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { o.adopted = null; resolve(false); }, GRACE_MS);
      timer.unref?.();
      o.adopted = () => { clearTimeout(timer); resolve(true); };
    });
  }
}
