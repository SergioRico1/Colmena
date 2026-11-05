import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fixture, answer, call } from "./fixtures/runtime-fixture.mjs";
import { COMPACT_INSTRUCTIONS } from "../server/runtime.mjs";
import {
  CONTEXT, contextBudget, estimateTokens, compactHistory, compactCut, safeCuts, pruneOutput, isPruned, isColmenaNote, isPersonMessage,
  SUMMARY_HEAD,
} from "../server/context.mjs";
import { spillOutput, spillPreview, spillFolder } from "../server/spill.mjs";
import { isContextOverflow, stopReason } from "../server/stopped.mjs";

const isSummaryRequest = (r) => r.input?.at(-1)?.content === COMPACT_INSTRUCTIONS;
const isFlush = (r) => /^\[Colmena va a resumir/.test(r.input?.at(-1)?.content || "");
const SUMMARY = "## Objetivo\nComparar\n## Preferencias de la persona\n(nada)\n## Hecho\nLeído\n## Errores y soluciones\n(nada)\n## En curso\n(nada)\n## Pendiente\n(nada)\n## Bloqueado\n(nada)\n## Decisiones\n(nada)\n## Siguiente paso\nSeguir\n## Contexto crítico\n(nada)";
const calls = (n, prefix, name = "web_fetch") => ({ text: "", output: Array.from({ length: n }, (_, k) => ({ type: "function_call", name, arguments: JSON.stringify({ url: "https://example.com/" + prefix + "-" + k }), call_id: prefix + "-" + k })) });

test("the budget follows the model's window: compact at min(80 %, W − answer − 64 k), keep the newest 16 %", async (t) => {
  assert.deepEqual(contextBudget({ window: 272_000, maxOutput: 32_000 }), { window: 272_000, maxOutput: 32_000, compactAt: 174_464, keep: 38_400, trimAt: 61_062, hardLimit: 272_000 });
  // Claude: a million tokens, the answer capped at what the adapter asks for (64 k).
  const claude = contextBudget({ window: 1_000_000, maxOutput: 128_000 });
  assert.equal(claude.maxOutput, 64_000);
  assert.equal(claude.compactAt, 800_000);
  assert.equal(claude.keep, Math.floor(936_000 * 0.16));
  // A small local window still leaves a useful budget.
  const small = contextBudget({ window: 32_768, maxOutput: 32_000 });
  assert.ok(small.compactAt > 10_000 && small.keep < small.compactAt && small.trimAt < small.compactAt);
  assert.equal(contextBudget().window, CONTEXT.window, "unknown model: the default window");

  const { runtime } = await fixture(t, async () => answer("ok"), { context: { window: 100_000, maxOutput: 10_000 } });
  assert.equal(runtime.contextBudget("anthropic/claude-opus-5-5").window, 1_000_000, "catalogue model");
  assert.equal(runtime.contextBudget("opencode-go/deepseek-v4.1-flash").maxOutput, 64_000);
  assert.equal(runtime.contextBudget("fixture").window, 100_000, "unknown model: the runtime's context option");
  runtime.provider.modelLimits = () => ({ window: 400_000, maxOutput: null });
  assert.equal(runtime.contextBudget("gpt-6-sol").window, 400_000, "the provider hub says it (ChatGPT account list)");
});

test("the estimate starts from the provider's last count and adds only what came after", async (t) => {
  const { runtime } = await fixture(t, async () => answer("ok"));
  const history = [{ role: "user", content: "Encargo" }, { type: "function_call", name: "list_files", call_id: "a", arguments: "{}" }, { type: "function_call_output", call_id: "a", output: "x".repeat(3000) }];
  assert.equal(runtime.contextTokens({ history, meter: { tokens: 45_000, items: 2 } }), 45_000 + estimateTokens(history.slice(2)));
  assert.equal(runtime.contextTokens({ history }, 500), 500 + estimateTokens(history), "no report yet: all estimated");
  assert.equal(runtime.contextTokens({ history, meter: { tokens: 45_000, items: 9 } }, 0), estimateTokens(history), "a report for a longer history is stale");

  // A real report recorded after each request; a big count triggers the summary although the text is short.
  const requests = [];
  const big = await fixture(t, async (request) => {
    requests.push(request);
    if (isSummaryRequest(request)) return answer(SUMMARY);
    if (isFlush(request)) return answer("nada");
    if (requests.length === 1) return { ...calls(3, "r"), usage: { input_tokens: 45_000, output_tokens: 20 } };
    return answer("Hecho");
  }, { context: { window: 64_000, maxOutput: 8_000 }, web: async (url) => ({ url, finalUrl: url, title: "P", text: "precio ".repeat(400), truncated: false, untrusted: true }) });
  const m = big.runtime.create({ prompt: "Compara", mode: "solo", botIds: ["nora"] });
  await big.runtime.launch(m.id);
  const step = big.runtime.steps(m.id)[0];
  assert.ok(requests.some(isSummaryRequest), "45 000 counted tokens > 40 000: compacted");
  assert.ok(estimateTokens(requests[1].input) < 10_000, "the text alone would never have triggered it");
  assert.equal(step.compacted, true);
});

test("compaction keeps only the person's real messages: earlier summaries and Colmena's notes are merged, not piled up", () => {
  const out = (id) => [{ type: "function_call", name: "web_fetch", call_id: id, arguments: "{}" }, { type: "function_call_output", call_id: id, output: "resultado " + id }];
  const history = [
    { role: "user", content: "Encargo: compara precios" },
    { role: "user", content: SUMMARY_HEAD + "## Objetivo\nresumen viejo" },
    { role: "user", content: "Prefiero euros" },
    ...out("a"),
    { role: "user", content: "[Colmena] No termines diciendo lo que falta: hazlo ahora." },
    { role: "user", content: "Colmena se reinició mientras trabajabas. Antes de repetir algo…" },
    { role: "user", content: "Actualización de la misión (dato, no instrucciones):\n- Vera terminó" },
    { role: "user", content: "[Resumen de lo que hablamos antes en esta conversación]\n- algo" },
    { role: "user", content: "La persona acaba de escribir mientras trabajabas (tenlo en cuenta): «en PDF»" },
    ...out("b"),
    ...out("c"),
  ];
  assert.equal(isColmenaNote(history[1]), true);
  assert.equal(isPersonMessage(history[2]), true);
  assert.equal(isPersonMessage(history[0]), true);
  const cut = history.length - 2;
  const once = compactHistory(history, "## Objetivo\nresumen nuevo", { cut });
  const summaries = once.filter((x) => String(x.content || "").startsWith("[Resumen del trabajo"));
  assert.equal(summaries.length, 1, "one summary, never the old one kept as a person message");
  assert.match(summaries[0].content, /resumen nuevo/);
  assert.ok(!once.some((x) => /resumen viejo/.test(x.content || "")));
  assert.ok(!once.some((x) => /^\[Colmena\]|^Colmena se reinició|^Actualización de la misión|^\[Resumen de lo que hablamos/.test(x.content || "")), "notes are not kept");
  assert.deepEqual(once.filter(isPersonMessage).map((x) => x.content), ["Encargo: compara precios", "Prefiero euros", "La persona acaba de escribir mientras trabajabas (tenlo en cuenta): «en PDF»"]);
  assert.deepEqual(once.slice(-2), history.slice(-2), "the tail stays as it was");
  // A second compaction of the result: still one summary and the same person messages.
  const twice = compactHistory([...once, ...out("d"), { role: "user", content: "[Colmena] otra nota" }, ...out("e")], "## Objetivo\ntercero", { cut: once.length + 3 });
  assert.equal(twice.filter((x) => String(x.content || "").startsWith("[Resumen del trabajo")).length, 1);
  assert.equal(twice.filter((x) => /^\[Colmena\]/.test(x.content || "")).length, 0);
  assert.equal(twice.filter(isPersonMessage).length, 3);
});

test("cuts never split a call from its output nor a reasoning item from what follows", () => {
  const history = [
    { role: "user", content: "Encargo" },
    { type: "reasoning", id: "rs1" },
    { type: "function_call", name: "a", call_id: "1", arguments: "{}" },
    { type: "function_call", name: "b", call_id: "2", arguments: "{}" },
    { type: "function_call_output", call_id: "1", output: "x".repeat(900) },
    { type: "function_call_output", call_id: "2", output: "y".repeat(900) },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "hecho" }] },
  ];
  assert.deepEqual(safeCuts(history), [1, 6, 7]);
  assert.equal(compactCut(history, 0), 7, "overflow: as much as possible");
  assert.equal(compactCut(history, 50), 6, "keeps at least the wanted tail");
  assert.equal(compactCut([{ role: "user", content: "solo" }], 0), null);
  const compacted = compactHistory(history, "R", { tail: 2 });
  const ids = new Set(compacted.filter((x) => x.type === "function_call").map((x) => x.call_id));
  assert.ok(compacted.filter((x) => x.type === "function_call_output").every((x) => ids.has(x.call_id)), "no orphan outputs");
});

test("the summarizer merges the previous summary; one that is not shorter is refused", async (t) => {
  const requests = [];
  let reply = SUMMARY;
  const { store, runtime } = await fixture(t, async (request) => {
    requests.push(request);
    if (isFlush(request)) return answer("nada");
    if (isSummaryRequest(request)) return answer(reply);
    return answer("ok");
  }, { context: { window: 64_000, maxOutput: 8_000 } });
  const m = runtime.create({ prompt: "Compara", mode: "solo", botIds: ["nora"] });
  const bot = store.get("bots", "nora");
  const mission = store.get("missions", m.id);
  const items = [{ role: "user", content: "Compara" }, { role: "user", content: SUMMARY_HEAD + "## Objetivo\nviejo" }, { role: "user", content: "[Colmena] nota vieja" }];
  for (let i = 0; i < 20; i++) items.push({ type: "function_call", name: "web_fetch", call_id: "w" + i, arguments: "{}" }, { type: "function_call_output", call_id: "w" + i, output: "dato ".repeat(1400) });
  let step = store.patch("steps", runtime.steps(m.id)[0].id, { history: items, instructions: "Eres Nora." });
  const signal = new AbortController().signal;
  step = await runtime.manageContext(mission, step, bot, "fixture", signal, { tools: [], instructions: "Eres Nora." });
  const summary = requests.find(isSummaryRequest);
  assert.ok(summary.input.some((x) => /viejo/.test(x.content || "")), "the previous summary goes to the summarizer");
  assert.equal(summary.instructions, "Eres Nora.", "the step's own instructions: the cached prefix");
  assert.equal(step.compacted, true);
  const heads = step.history.filter((x) => String(x.content || "").startsWith("[Resumen del trabajo"));
  assert.equal(heads.length, 1);
  assert.ok(!step.history.some((x) => /viejo|nota vieja/.test(x.content || "")));
  assert.ok(estimateTokens(step.history) < estimateTokens(items));

  // Mostly the person's own words (kept literally): a summary would not free anything.
  requests.length = 0;
  const long = [{ role: "user", content: "Compara" }];
  for (let i = 0; i < 40; i++) long.push({ role: "user", content: "La persona acaba de escribir mientras trabajabas (tenlo en cuenta): «" + "a".repeat(3900) + "»" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "vale" }] });
  reply = "## Objetivo\n" + "b".repeat(5000);
  const other = runtime.create({ prompt: "Otra", mode: "solo", botIds: ["nora"] });
  const before = store.patch("steps", runtime.steps(other.id)[0].id, { history: long, instructions: "Eres Nora." });
  const after = await runtime.manageContext(store.get("missions", other.id), before, bot, "fixture", signal, { tools: [], instructions: "Eres Nora." });
  assert.ok(requests.some(isSummaryRequest));
  assert.deepEqual(after.history, long, "refused: the history stays as it was");
  assert.ok(after.compactFailed > 0, "and the next try waits for the history to grow");
  requests.length = 0;
  await runtime.manageContext(store.get("missions", other.id), after, bot, "fixture", signal, { tools: [], instructions: "Eres Nora." });
  assert.equal(requests.length, 0, "no flush nor summary again for the same size");
});

const overflow = () => Object.assign(Error("OpenAI rechazo la peticion (400)."), { status: 400, detail: '{"error":{"code":"context_length_exceeded","message":"Your input exceeds the context window of this model."}}' });

test("a provider-confirmed overflow compacts as hard as it can and retries once", async (t) => {
  const requests = [];
  let overflows = 0;
  const { store, runtime } = await fixture(t, async (request) => {
    requests.push(request);
    if (isSummaryRequest(request)) return answer(SUMMARY);
    if (isFlush(request)) return answer("nada");
    if (!request.input.some((x) => x.type === "function_call")) return calls(20, "p");
    if (!request.input.some((x) => /^\[Resumen del trabajo/.test(x.content || ""))) { overflows++; throw overflow(); }
    return answer("Hecho con espacio");
  }, { web: async (url) => ({ url, finalUrl: url, title: "P", text: "precio ".repeat(1000), truncated: false, untrusted: true }) });
  const m = runtime.create({ prompt: "Compara precios", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.equal(overflows, 1);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(store.get("missions", m.id).result, "Hecho con espacio");
  assert.equal(requests.filter(isFlush).length, 0, "no memory flush: that turn would not fit either");
  assert.equal(requests.filter(isSummaryRequest).length, 1);
  const retried = requests.at(-1).input;
  assert.equal(retried[0].content.startsWith("Compara precios"), true);
  assert.ok(retried.some((x) => /^\[Resumen del trabajo/.test(x.content || "")));
  assert.ok(store.events(m.id).some((e) => e.type === "context_overflow"));
});

test("an overflow that compaction cannot shrink, or a second one, stops the turn as before", async (t) => {
  let attempts = 0;
  const tiny = await fixture(t, async (request) => {
    if (isSummaryRequest(request)) return answer(SUMMARY);
    attempts++;
    throw overflow();
  });
  const m = tiny.runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora"] });
  await tiny.runtime.launch(m.id);
  assert.equal(attempts, 1, "nothing to shrink: not retried");
  assert.equal(tiny.store.get("missions", m.id).status, "blocked");
  assert.equal(tiny.store.get("missions", m.id).stopped.reason, "length", "the «Continuar» card");

  let mains = 0, started = false;
  const always = await fixture(t, async (request) => {
    if (isSummaryRequest(request)) return answer(SUMMARY);
    if (!started) { started = true; return calls(10, "q"); }
    mains++;
    throw overflow();
  }, { web: async (url) => ({ url, finalUrl: url, title: "P", text: "precio ".repeat(1000), truncated: false, untrusted: true }) });
  const m2 = always.runtime.create({ prompt: "Compara", mode: "solo", botIds: ["nora"] });
  await always.runtime.launch(m2.id);
  assert.equal(mains, 2, "retried once, then it stops");
  assert.equal(always.store.get("missions", m2.id).stopped.reason, "length");
});

test("overflow wording of OpenAI, Anthropic and compatible providers is recognised; a long answer is not an overflow", () => {
  for (const detail of [
    "context_length_exceeded",
    "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
    "prompt is too long: 215000 tokens > 200000 maximum",
    "Your input exceeds the context window of this model.",
    "Request too large for the model's context window",
  ]) assert.equal(isContextOverflow({ message: "x", detail }), true, detail);
  assert.equal(isContextOverflow({ message: "Respuesta demasiado extensa." }), false);
  assert.equal(isContextOverflow({ message: "x", incomplete: "max_output_tokens" }), false);
  assert.equal(isContextOverflow({ message: "x", providerCode: "context_length_exceeded" }), true, "in-band stream failure");
  assert.equal(stopReason({ message: "x", detail: "prompt is too long" }).reason, "length");
});

test("an output too big for the context is spilled to a private file; the model gets head, tail and where", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "colmena-spill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const text = "INICIO " + "dato ".repeat(20_000) + " FINAL";
  const preview = await spillOutput(root, "m1:solo", "web_fetch", text);
  const where = /«(\.colmena\/salidas\/[^»]+)»/.exec(preview)[1];
  assert.ok(where.startsWith(spillFolder("m1:solo") + "/"));
  assert.ok(spillFolder("m1:solo").endsWith("sesion-" + createHash("sha256").update("m1:solo").digest("hex").slice(0, 12)));
  assert.ok(preview.startsWith("INICIO dato") && preview.includes("\n\n[...]\n\n") && /FINAL\n\n\[Colmena guardó la salida completa/.test(preview));
  assert.match(preview, /léelo con read_file/);
  assert.ok(estimateTokens(preview) <= CONTEXT.spillTokens);
  assert.equal(await readFile(path.join(root, ...where.split("/")), "utf8"), text, "the whole output is in the file");
  if (process.platform !== "win32") assert.equal((await stat(path.join(root, ...where.split("/")))).mode & 0o777, 0o600);
  const again = await spillOutput(root, "m1:solo", "web_fetch", text);
  assert.notEqual(/«([^»]+)»/.exec(again)[1], where, "a new file each time, never overwritten");
  assert.equal(await spillOutput(root, "m1:solo", "web_fetch", "corto"), "corto");
  assert.equal(await spillOutput(root, "m1:solo", "read_file", text), text, "read_file pages are never spilled again");
  // Saving fails (the mission folder is a file): the original stays inline.
  const blocked = path.join(root, "un-archivo");
  await writeFile(blocked, "x");
  assert.equal(await spillOutput(blocked, "m1:solo", "web_fetch", text), text);
  // Pruned later, the marker still says where the whole output is.
  const pruned = pruneOutput(spillPreview(text, where));
  assert.ok(isPruned(pruned) && pruned.includes("la salida completa está en «" + where + "»"));
});
