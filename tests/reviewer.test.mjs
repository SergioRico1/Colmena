import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { deniedResult } from "../server/denial.mjs";

const deliverable = () => call("create_deliverable", { title: "Resumen de ventas", kind: "document", content: "# Ventas\nSubieron un 4 %.", format: "md" }, "d1");

async function reviewed(t, verdict) {
  let round = 0;
  const env = await fixture(t, async ({ instructions, input }) => {
    if (/Eres el revisor de Colmena/.test(instructions)) return answer(JSON.stringify(verdict));
    round += 1;
    if (round === 1) return deliverable();
    return answer("Listo: " + JSON.stringify(outputs(input).at(-1)).slice(0, 40));
  }, { review: true });
  env.runtime.provider.session = { models: [{ slug: "fixture" }] };
  env.store.patch("bots", "nora", { autonomy: "sugiere" });
  const m = env.runtime.create({ prompt: "Resume las ventas del trimestre", mode: "solo", botIds: ["nora"] });
  await env.runtime.launch(m.id);
  await settle(env.runtime);
  return { ...env, m };
}

test("the reviewer approves routine work inside Colmena and the bot carries on", async (t) => {
  const { store, m } = await reviewed(t, { aprobar: true, motivo: "Es el resumen que se pidió." });
  const a = store.list("approvals").find((x) => x.missionId === m.id);
  assert.equal(a.decidedBy, "revisor");
  assert.equal(a.resolution, "Aprobado por el revisor: Es el resumen que se pidió.");
  assert.equal(a.status, "executed");
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("when the reviewer doubts, the card stays for the person", async (t) => {
  const { store, m } = await reviewed(t, { aprobar: false, motivo: "No está claro que se pidiera guardarlo." });
  const a = store.list("approvals").find((x) => x.missionId === m.id);
  assert.equal(a.status, "pending");
  assert.equal(a.reviewing, false);
  assert.equal(a.reviewNote, "No está claro que se pidiera guardarlo.");
});

test("actions that cost money or leave Colmena never reach the reviewer", async (t) => {
  let reviewerCalls = 0;
  let round = 0;
  const { store, runtime } = await fixture(t, async ({ instructions }) => {
    if (/Eres el revisor de Colmena/.test(instructions)) { reviewerCalls += 1; return answer('{"aprobar": true}'); }
    round += 1;
    return round === 1 ? call("create_image", { title: "Logo", prompt: "Un logo con una abeja", size: "1024x1024" }, "i1") : answer("ok");
  }, { review: true });
  runtime.provider.session = { models: [{ slug: "fixture" }] };
  store.patch("bots", "iris", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Haz un logo", mode: "solo", botIds: ["iris"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(reviewerCalls, 0);
});

test("a denial with a reason reaches the bot", async (t) => {
  assert.match(deniedResult({ denyReason: "Usa el formato de la plantilla" }).message, /explica por qué: «Usa el formato de la plantilla»/);
  assert.match(deniedResult({}).message, /No la repitas/);
  let seen = null;
  let round = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    round += 1;
    if (round === 1) return deliverable();
    seen = outputs(input).at(-1);
    return answer("Entendido, lo rehago con la plantilla.");
  });
  store.patch("bots", "nora", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Resume las ventas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const a = store.list("approvals").find((x) => x.missionId === m.id);
  store.patch("approvals", a.id, { denyReason: "Usa la plantilla de la empresa" });
  runtime.approve(a.id, "denied");
  await settle(runtime);
  assert.equal(seen.reason, "Usa la plantilla de la empresa");
  assert.match(seen.message, /explica por qué/);
});
