import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { trailGroups } from "../src/lib/trail.js";
import { composeInstructions } from "../server/soul.mjs";

// A round where the bot says one line and calls a tool in the same turn (Codex preamble).
const sayAndCall = (text, name, args, call_id) => ({
  text,
  output: [
    { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    { type: "function_call", name, arguments: JSON.stringify(args), call_id },
  ],
});

test("a line said beside tool calls is a progress line of the step, not a message", async (t) => {
  const deltas = [];
  const { store, runtime } = await fixture(t, async ({ input, onDelta }) => {
    const done = outputs(input).length;
    if (done === 0) { onDelta?.("Busco los correos de pedidos de los últimos 30 días."); return sayAndCall("Busco los correos de pedidos de los últimos 30 días.", "list_files", {}, "c1"); }
    if (done === 1) return sayAndCall("Hay pedidos repetidos; saco el total de cada uno.", "list_files", {}, "c2");
    return answer("En 30 días se facturaron 3.245,10 € en 41 pedidos.");
  });
  runtime.emit = ((emit) => (e) => { if (e?.type === "delta") deltas.push(e); return emit?.(e); })(runtime.emit?.bind(runtime));
  const m = runtime.create({ prompt: "¿Cuánto se facturó?", mode: "solo", botIds: ["vera"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  const mine = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant");
  assert.deepEqual(mine.map((x) => [x.kind, x.text]), [
    ["progress", "Busco los correos de pedidos de los últimos 30 días."],
    ["progress", "Hay pedidos repetidos; saco el total de cada uno."],
    ["message", "En 30 días se facturaron 3.245,10 € en 41 pedidos."],
  ]);
  assert.deepEqual(mine[0].callIds, ["c1"]);
  assert.equal(mine[0].stepId, mine[2].stepId);
  // A short line never streamed as a draft first.
  assert.ok(!deltas.some((d) => /Busco los correos/.test(d.text || "")));
  // The model's next turns never see progress lines as turns of the conversation.
  const turns = runtime.conversationTurns(m.id);
  assert.ok(!turns.some((x) => /Busco los correos/.test(String(x.content))));
});

test("a long text with tool calls is still a message, and routines that run alone say no lines", async (t) => {
  const long = "Aquí tienes el resumen de la semana. ".repeat(12).trim();
  const { store, runtime } = await fixture(t, async ({ input }) => (outputs(input).length ? answer("Listo.") : sayAndCall(long, "list_files", {}, "c1")));
  const m = runtime.create({ prompt: "Resumen", mode: "solo", botIds: ["vera"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  const kinds = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant").map((x) => x.kind);
  assert.deepEqual(kinds, ["message", "message"]);
  assert.match(composeInstructions(store, { id: "vera", name: "Vera" }, { mission: { id: "x" } }), /# Mientras trabajas/);
  assert.doesNotMatch(composeInstructions(store, { id: "vera", name: "Vera" }, { mission: { id: "x", automationId: "r1" } }), /# Mientras trabajas/);
});

test("each line goes with the tools it announced; earlier tools join the first line", () => {
  const tools = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const lines = [{ id: "l1", callIds: ["b"] }, { id: "l2", callIds: ["d"] }];
  assert.deepEqual(trailGroups(lines, tools).map((g) => g.tools.map((x) => x.id)), [["a", "b", "c"], ["d"]]);
  // A line whose calls have not shown up yet has no tools for now.
  assert.deepEqual(trailGroups([{ callIds: ["a"] }, { callIds: ["z"] }], tools).map((g) => g.tools.length), [4, 0]);
});
