// No action runs twice (T3 Code EventSink + CommandReceiptStore): one receipt per call, the
// intent written before every effect, and an effect a close caught «running» is «sin
// confirmar» on the next start — never repeated on its own.
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { Runtime } from "../server/runtime.mjs";
import { RECEIPT, beginEffect, isEffect, recoverEffects } from "../server/receipts.mjs";

const effectTool = (onRun) => (bot, mission) => [{
  name: "send_fax", description: "Envía un fax", strict: false, capability: "apps",
  parameters: { type: "object", properties: { to: { type: "string" } } },
  run: (args, ctx) => onRun(args, ctx),
}];

test("reads are not effects; anything that may change something is", () => {
  for (const name of ["web_fetch", "read_file", "recall", "gmail_fetch_emails", "googlecalendar_list_events", "browser_read", "desktop_look", "apps_table"]) assert.equal(isEffect(name), false, name);
  for (const name of ["write_file", "create_deliverable", "remember", "apps_execute", "gmail_send_email", "gmail_create_email_draft", "run_command", "browser_act", "desktop_do", "mcp_call", "api_request", "project_run", "send_fax"]) assert.equal(isEffect(name), true, name);
});

test("the intent is written before the effect, the outcome after, in their own transactions", async (t) => {
  let seen = null;
  let round = 0;
  const { store, runtime } = await fixture(t, async () => (++round === 1 ? call("send_fax", { to: "+34 600" }, "f1") : answer("Enviado.")));
  runtime.extraTools = effectTool(async (_args, { step }) => {
    // While it runs, the receipt already says so, and the step knows it is in flight.
    seen = { receipt: store.get("receipts", step.id + ":f1"), inflight: store.get("steps", step.id).inflight };
    return { ok: true };
  });
  const m = runtime.create({ prompt: "Manda el fax", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const step = runtime.steps(m.id)[0];
  assert.equal(seen.receipt.status, RECEIPT.running);
  assert.match(seen.receipt.intent.args, /^[0-9a-f]{24}$/);
  assert.deepEqual(seen.inflight, [step.id + ":f1"]);
  const receipt = store.get("receipts", step.id + ":f1");
  assert.equal(receipt.status, RECEIPT.done);
  assert.deepEqual(receipt.result, { ok: true });
  assert.deepEqual(store.get("steps", step.id).inflight, []);
  // Reads keep a plain receipt, without an intent.
  assert.equal(beginEffect(store, { id: step.id + ":f1", tool: "send_fax" }).fresh, false, "a finished call never starts again");
});

test("a close in the middle of an effect: on the next start it is «sin confirmar» and never runs again", async (t) => {
  let runs = 0;
  let round = 0;
  const { store, runtime } = await fixture(t, async () => (++round === 1 ? call("send_fax", { to: "+34 600" }, "f1") : answer("x")));
  // The fax machine never answers: Colmena «closes» meanwhile (the old process only lets go at the end).
  runtime.extraTools = effectTool((_a, { signal }) => { runs += 1; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
  const m = runtime.create({ prompt: "Manda el fax", mode: "solo", botIds: ["nora"] });
  const first = runtime.launch(m.id).catch(() => {});
  for (let i = 0; i < 100 && !runs; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(runs, 1);
  const step = runtime.steps(m.id)[0];
  assert.equal(store.get("receipts", step.id + ":f1").status, RECEIPT.running);

  // Colmena starts again on the same data (the old process is gone).
  const seen = [];
  const next = new Runtime(store, { respond: async ({ input }) => { seen.push(outputs(input)); return answer("No sé si salió: compruébalo en el fax."); } }, null, { seed: false });
  next.extraTools = effectTool(() => { runs += 1; return { ok: true }; });
  t.after(async () => { await runtime.shutdown().catch(() => {}); await first; await next.shutdown(); });
  const receipt = store.get("receipts", step.id + ":f1");
  assert.equal(receipt.status, RECEIPT.uncertain);
  assert.equal(receipt.result.uncertain, true);
  assert.match(receipt.result.error, /No se repetirá solo/);
  assert.equal(next.recovered.length, 1);
  assert.equal(store.get("missions", m.id).status, "paused");
  next.resumeInterrupted();
  await settle(next);
  await Promise.all([...next.missionJobs.values()]);
  assert.equal(runs, 1, "the fax was not sent twice");
  assert.match(JSON.stringify(seen.at(-1)), /No se repetirá solo/, "the bot is told it is unconfirmed");
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("stopped by you mid-way: an outside effect is «sin confirmar», a keyed internal write may run again", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async () => (++round === 1 ? call("send_fax", { to: "+34 600" }, "f1") : answer("x")));
  let started;
  const going = new Promise((r) => { started = r; });
  runtime.extraTools = effectTool((_a, { signal }) => { started(); return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
  const m = runtime.create({ prompt: "Manda el fax", mode: "solo", botIds: ["nora"] });
  const run = runtime.launch(m.id).catch(() => {});
  await going;
  runtime.stop(m.id);
  await run;
  const step = runtime.steps(m.id)[0];
  assert.equal(store.get("receipts", step.id + ":f1").status, RECEIPT.uncertain);
});

test("a write that waits for your OK runs once when you approve, and never again", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    round += 1;
    if (!outputs(input).length) return call("create_deliverable", { title: "Informe", kind: "document", format: "md", content: "# Hola" }, "d1");
    return answer("Guardado.");
  });
  store.patch("bots", "nora", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Haz el informe", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const step = runtime.steps(m.id)[0];
  const id = step.id + ":d1";
  assert.equal(store.get("receipts", id).status, RECEIPT.waiting, "waiting for your OK, nothing done");
  assert.equal(store.where("artifacts", "missionId", m.id).filter((a) => !a.id.endsWith(":result")).length, 0);
  runtime.approve(id, "approved");
  await settle(runtime);
  await Promise.all([...runtime.missionJobs.values()]);
  assert.equal(store.get("receipts", id).status, RECEIPT.done);
  assert.equal(store.where("artifacts", "missionId", m.id).filter((a) => !a.id.endsWith(":result")).length, 1);
  assert.equal(store.get("approvals", id).status, "executed");
  // Running the step again changes nothing.
  store.patch("steps", step.id, { status: "pending", pending: [{ type: "function_call", name: "create_deliverable", call_id: "d1", arguments: JSON.stringify({ title: "Informe", kind: "document", format: "md", content: "# Otra" }) }] });
  store.patch("missions", m.id, { status: "queued" });
  await runtime.launch(m.id);
  assert.equal(store.where("artifacts", "missionId", m.id).filter((a) => !a.id.endsWith(":result")).length, 1);
  assert.equal(store.get("artifacts", id).content, "# Hola", "the same deliverable, not written again");
});

test("on start, an approved effect left half-way closes its approval as «sin confirmar»; a deliverable already saved counts as done", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const at = new Date().toISOString();
  store.put("steps", { id: "s1", missionId: "m1", botId: "nora", status: "running", history: [], pending: [] });
  store.put("approvals", { id: "s1:c1", missionId: "m1", botId: "nora", tool: "run_command", status: "approved", createdAt: at });
  beginEffect(store, { id: "s1:c1", tool: "run_command", missionId: "m1", stepId: "s1", args: "{}" });
  store.put("approvals", { id: "s1:c2", missionId: "m1", botId: "nora", tool: "create_deliverable", status: "approved", createdAt: at });
  beginEffect(store, { id: "s1:c2", tool: "create_deliverable", missionId: "m1", stepId: "s1", args: "{}" });
  store.put("artifacts", { id: "s1:c2", missionId: "m1", title: "Informe", kind: "document", content: "# Hola", version: 1, createdAt: at });
  assert.deepEqual(store.get("steps", "s1").inflight.sort(), ["s1:c1", "s1:c2"]);
  const changed = recoverEffects(store);
  assert.equal(changed.length, 2);
  assert.equal(store.get("receipts", "s1:c1").status, RECEIPT.uncertain);
  assert.equal(store.get("approvals", "s1:c1").status, "executed");
  assert.equal(store.get("approvals", "s1:c1").result.uncertain, true);
  assert.equal(store.get("receipts", "s1:c2").status, RECEIPT.done);
  assert.equal(store.get("receipts", "s1:c2").result.recovered, true);
  assert.deepEqual(store.get("steps", "s1").inflight, []);
  assert.deepEqual(recoverEffects(store), [], "nothing left running");
});
