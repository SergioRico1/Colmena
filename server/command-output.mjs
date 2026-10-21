// Live output of the commands bots run (T3 Code CommandOutputHub). Output never becomes a
// record or an event for everyone: run_command writes its chunks here, the hub keeps a
// bounded tail per running command, and only a row that is unfolded in the chat subscribes
// (GET /api/commands/output): first the tail so far, then the new text in ~100 ms frames,
// then «done». Memory stays bounded per command and in the number of commands.

export const TAIL_CHARS = 16_000;
export const FRAME_MS = 100;
const MAX_LIVE = 64;
const MAX_FINISHED = 16;

export class CommandOutputHub {
  constructor({ tailChars = TAIL_CHARS, frameMs = FRAME_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.tailChars = tailChars;
    this.frameMs = frameMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.live = new Map(); // key → { tail, subs: Set }
    this.finished = new Map(); // key → { tail, exitCode }
  }

  /** A command starts (key: `${stepId}:${callId}`). */
  start(key) {
    this.finished.delete(key);
    if (!this.live.has(key)) this.live.set(key, { tail: "", subs: new Set() });
    while (this.live.size > MAX_LIVE) this.drop(this.live.keys().next().value);
  }

  write(key, text) {
    const entry = this.live.get(key);
    if (!entry || !text) return;
    entry.tail = (entry.tail + text).slice(-this.tailChars);
    for (const sub of entry.subs) {
      sub.pending += text;
      // Fell far behind (a flood of output): the next frame sends the whole tail instead.
      if (sub.pending.length > this.tailChars) { sub.pending = ""; sub.replace = true; }
      sub.timer ??= this.setTimer(() => this.frame(sub, entry), this.frameMs);
    }
  }

  frame(sub, entry) {
    sub.timer = null;
    if (sub.replace) { sub.replace = false; sub.pending = ""; sub.send({ type: "replace", text: entry.tail }); return; }
    if (!sub.pending) return;
    const text = sub.pending;
    sub.pending = "";
    sub.send({ type: "append", text });
  }

  /** The command ended: subscribers get what is left and «done». */
  finish(key, { exitCode = null } = {}) {
    const entry = this.live.get(key);
    if (!entry) return;
    this.live.delete(key);
    for (const sub of entry.subs) {
      if (sub.timer) this.clearTimer(sub.timer);
      sub.timer = null;
      if (sub.replace) sub.send({ type: "replace", text: entry.tail });
      else if (sub.pending) sub.send({ type: "append", text: sub.pending });
      sub.send({ type: "done", exitCode });
    }
    this.finished.set(key, { tail: entry.tail, exitCode });
    while (this.finished.size > MAX_FINISHED) this.finished.delete(this.finished.keys().next().value);
  }

  drop(key) {
    const entry = this.live.get(key);
    if (!entry) return;
    this.live.delete(key);
    for (const sub of entry.subs) { if (sub.timer) this.clearTimer(sub.timer); sub.send({ type: "done", exitCode: null }); }
  }

  isLive(key) {
    return this.live.has(key);
  }

  /**
   * `send(frame)` receives { type: "replace", text } (the tail so far), { type: "append", text }
   * and { type: "done", exitCode }. Returns the function that stops it.
   */
  subscribe(key, send) {
    const entry = this.live.get(key);
    if (!entry) {
      const done = this.finished.get(key);
      send({ type: "replace", text: done?.tail || "" });
      send({ type: "done", exitCode: done?.exitCode ?? null, known: !!done });
      return () => {};
    }
    const sub = { send, pending: "", replace: false, timer: null };
    entry.subs.add(sub);
    send({ type: "replace", text: entry.tail });
    return () => {
      if (sub.timer) this.clearTimer(sub.timer);
      entry.subs.delete(sub);
    };
  }
}

/** The one hub of this Colmena. */
export const commandOutput = new CommandOutputHub();
