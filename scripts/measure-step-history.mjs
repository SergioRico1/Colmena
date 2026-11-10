// Measures what the provider conversations cost the hot paths, before and after they move
// out of the step records (server/histories.mjs). It builds a throwaway database in the
// system's temp folder — never your own data — with one long mission whose steps carry their
// conversation inline (as older versions wrote them), times the paths, moves the
// conversations and times them again. Prints one JSON object.
// Usage: node scripts/measure-step-history.mjs [steps=200] [KB of conversation per step=400]
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { buildState, context, toolCalls } from "../server/state.mjs";
import { HISTORIES, migrateHistories } from "../server/histories.mjs";

const STEPS = Number(process.argv[2]) || 200;
const KB = Number(process.argv[3]) || 400;
const CALLS = 20;
const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-measure-"));
const store = new Store(directory);
store.patch("settings", "main", { model: "fixture", learning: false });
const runtime = new Runtime(store, { respond: async () => ({ text: "", output: [] }) });
const page = "Texto de una página leída. ".repeat(Math.ceil((KB * 1024) / CALLS / 27));
const conversation = (n) => [
  { role: "user", content: "Encargo " + n },
  ...Array.from({ length: CALLS }, (_, i) => [
    { type: "function_call", name: "web_fetch", call_id: `c${n}-${i}`, arguments: JSON.stringify({ url: `https://example.com/${n}/${i}` }) },
    { type: "function_call_output", call_id: `c${n}-${i}`, output: JSON.stringify({ url: `https://example.com/${n}/${i}`, title: "Página " + i, text: page }) },
  ]).flat(),
];
const at = new Date().toISOString();
store.tx(() => {
  store.put("missions", { id: "larga", title: "Chat largo", prompt: "x", mode: "solo", botIds: ["nora"], status: "completed", conversation: true, createdAt: at });
  // Other rooms, so «all missions» paths have something else to walk.
  for (let m = 0; m < 20; m++) store.put("missions", { id: "otra" + m, title: "Sala " + m, prompt: "x", mode: "solo", botIds: ["nora"], status: "completed", createdAt: at });
  for (let n = 0; n < STEPS; n++)
    store.put("steps", {
      id: "larga:k" + n, key: "k" + n, missionId: "larga", botId: "nora", kind: "followup", status: "completed", deps: [], rounds: CALLS, pending: [],
      text: "Respuesta " + n, title: "Respuesta de Nora", words: 2, reads: CALLS, seconds: 30, model: "fixture", instructions: "Eres Nora.", startedAt: at, completedAt: at, updatedAt: at,
      history: conversation(n),
    });
});

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const time = (fn, runs = 5) => {
  fn();
  const times = [];
  for (let i = 0; i < runs; i++) { const s = performance.now(); fn(); times.push(performance.now() - s); }
  return Math.round(median(times) * 100) / 100;
};
const last = "larga:k" + (STEPS - 1);
const measure = ({ append = true } = {}) => ({
  stepRecordsMB: Math.round(store.db.prepare("SELECT coalesce(sum(length(data)),0) AS n FROM records WHERE kind='steps'").get().n / 1024 / 10.24) / 100,
  // runtime.steps(missionId): called many times per turn.
  stepsMs: time(() => runtime.steps("larga")),
  // The index /api/state builds over every step, and the whole state.
  stateContextMs: time(() => context(store, runtime)),
  stateMs: time(() => buildState(store, runtime, {})),
  // Opening the chat: its steps and the tool cards of each (app.mjs stepView).
  chatOpenMs: time(() => {
    const bots = new Map(store.list("bots").map((b) => [b.id, b]));
    return store.where("steps", "missionId", "larga").map((s) => toolCalls(s, { bots, receipt: (id) => store.get("receipts", s.id + ":" + id) }));
  }),
  // One small change to a step record (a tool round makes about ten).
  stepPatchMs: time(() => store.patch("steps", last, { reads: 1 }), 20),
  // Adding one item to a step's conversation (it would move the step: only measured after).
  ...(append ? { historyAppendMs: time(() => runtime.setHistory(last, [...runtime.history(last), { role: "user", content: "Nota" }]), 10) } : {}),
});

const beforeNumbers = measure({ append: false });

// The move, as at startup: short batches; the longest one is how long the server would stall.
let after = "", moved = 0, batches = 0, longest = 0;
const moveStart = performance.now();
for (;;) {
  const s = performance.now();
  const r = migrateHistories(store, { after });
  longest = Math.max(longest, performance.now() - s);
  batches++;
  moved += r.moved;
  after = r.after;
  if (r.done) break;
}
const migration = { moved, batches, workMs: Math.round(performance.now() - moveStart), longestBatchMs: Math.round(longest), histories: store.list(HISTORIES).length };
const afterNumbers = measure();

console.log(JSON.stringify({ steps: STEPS, kbPerStep: KB, before: beforeNumbers, migration, after: afterNumbers }, null, 2));
await runtime.shutdown();
store.close();
await rm(directory, { recursive: true, force: true });
