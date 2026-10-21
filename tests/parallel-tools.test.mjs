import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";

const calls = (...list) => ({ text: "", usage: { input_tokens: 10, output_tokens: 5 }, output: list.map(([name, args, id]) => ({ type: "function_call", name, arguments: JSON.stringify(args), call_id: id })) });

test("read-only calls in the same round run at the same time; outputs keep their order", async (t) => {
  let round = 0, live = 0, peak = 0;
  const { store, runtime } = await fixture(t, async () => (++round === 1 ? calls(["list_files", {}, "a"], ["list_files", {}, "b"], ["list_files", {}, "c"]) : answer("Listo.")));
  const original = runtime.tool.bind(runtime);
  runtime.tool = async (...args) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 120));
    live -= 1;
    return original(...args);
  };
  const m = runtime.create({ prompt: "Mira los archivos", mode: "solo", botIds: ["nora"] });
  const began = Date.now();
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(peak, 3, "the three reads ran together");
  const step = runtime.steps(m.id)[0];
  assert.deepEqual(step.history.filter((x) => x.type === "function_call_output").map((x) => x.call_id), ["a", "b", "c"]);
  assert.ok(store.get("receipts", step.id + ":a").ms >= 100, "each receipt records how long the tool took");
});

test("a call that changes something still runs alone and in order", async (t) => {
  let round = 0, live = 0, peak = 0;
  const { runtime } = await fixture(t, async () => (++round === 1 ? calls(["list_files", {}, "a"], ["write_file", { path: "x.md", content: "hola" }, "b"], ["list_files", {}, "c"]) : answer("Listo.")));
  const original = runtime.tool.bind(runtime);
  runtime.tool = async (...args) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 30));
    live -= 1;
    return original(...args);
  };
  const m = runtime.create({ prompt: "Escribe", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(peak, 1);
});

test("the same page is fetched once: in parallel, and again within 15 minutes", async (t) => {
  let fetched = 0;
  const web = async (url) => {
    fetched += 1;
    await new Promise((r) => setTimeout(r, 40));
    if (url.includes("refusa")) throw Error("La página respondió con el estado 429.");
    return { url, text: "Contenido de " + url };
  };
  let round = 0;
  const { runtime } = await fixture(t, async () => {
    round += 1;
    if (round === 1) return calls(["web_fetch", { url: "https://ejemplo.es/a" }, "a"], ["web_fetch", { url: "https://ejemplo.es/a" }, "b"]);
    if (round === 2) return calls(["web_fetch", { url: "https://ejemplo.es/a" }, "c"], ["web_fetch", { url: "https://ejemplo.es/refusa" }, "d"]);
    if (round === 3) return calls(["web_fetch", { url: "https://ejemplo.es/refusa" }, "e"]);
    return answer("Listo.");
  }, { web });
  const m = runtime.create({ prompt: "Lee", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(fetched, 2, "one download of /a and one of /refusa");
  const out = Object.fromEntries(runtime.steps(m.id)[0].history.filter((x) => x.type === "function_call_output").map((x) => [x.call_id, JSON.parse(x.output)]));
  assert.equal(out.c.cachedMinutesAgo, 0);
  assert.match(out.e.error, /429.*prueba otra fuente/);
});
