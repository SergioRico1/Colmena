import test from "node:test";
import assert from "node:assert/strict";
import { CommandOutputHub } from "../server/command-output.mjs";
import { runProgram } from "../server/computer/system.mjs";

const manual = () => {
  const timers = [];
  return { timers, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {}, tick: () => { const all = timers.splice(0); for (const fn of all) fn(); } };
};

test("a subscriber gets the tail so far, then frames, then done; nobody else gets anything", () => {
  const clock = manual();
  const hub = new CommandOutputHub({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  hub.start("s:c1");
  hub.write("s:c1", "uno\n");
  const frames = [];
  const stop = hub.subscribe("s:c1", (f) => frames.push(f));
  assert.deepEqual(frames, [{ type: "replace", text: "uno\n" }]);
  hub.write("s:c1", "dos\n");
  hub.write("s:c1", "tres\n");
  assert.equal(frames.length, 1, "appends wait for the frame");
  clock.tick();
  assert.deepEqual(frames[1], { type: "append", text: "dos\ntres\n" });
  hub.write("s:c1", "fin");
  hub.finish("s:c1", { exitCode: 0 });
  assert.deepEqual(frames.slice(2), [{ type: "append", text: "fin" }, { type: "done", exitCode: 0 }]);
  stop();
  // Asking after it ended: what it printed, then done.
  const late = [];
  hub.subscribe("s:c1", (f) => late.push(f));
  assert.deepEqual(late, [{ type: "replace", text: "uno\ndos\ntres\nfin" }, { type: "done", exitCode: 0, known: true }]);
});

test("the tail stays bounded and a subscriber that falls behind gets the whole tail", () => {
  const clock = manual();
  const hub = new CommandOutputHub({ tailChars: 10, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  hub.start("k");
  const frames = [];
  hub.subscribe("k", (f) => frames.push(f));
  hub.write("k", "0123456789abcdef");
  clock.tick();
  assert.deepEqual(frames.at(-1), { type: "replace", text: "6789abcdef" });
});

test("runProgram passes its output on as it comes", async () => {
  const seen = [];
  const result = await runProgram(process.execPath, ["-e", "process.stdout.write('hola '); setTimeout(() => process.stdout.write('señor'), 50)"], { cwd: process.cwd(), onOutput: (t) => seen.push(t) });
  assert.equal(result.stdout, "hola señor");
  assert.equal(seen.join(""), "hola señor");
});
