import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAIProvider, LocalProvider, ProviderHub, isTransientError } from "../server/provider.mjs";
import { IMAGES_UNSUPPORTED } from "../server/images.mjs";
import { webSearchesOf, citationsOf } from "../server/tools.mjs";
import { Store } from "../server/store.mjs";
import { makePng } from "./fixtures/core-files.mjs";

const frame = (x) => "data: " + JSON.stringify(x) + "\n\n";
const sse = (events) => new Response(events.map(frame).join(""));
const message = (text, annotations = []) => ({ type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text, annotations }] });
const search = { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "precio luz hoy", sources: [{ type: "url", url: "https://www.omie.es/precios" }, { type: "url", url: "https://ree.es/datos" }] } };
const done = (output) => [
  ...output.map((item, i) => ({ type: "response.output_item.done", output_index: i, item })),
  { type: "response.completed", response: { id: "r1", status: "completed", output } },
];
const request = { model: "fixture", instructions: "Test", input: [{ role: "user", content: "hola" }], signal: AbortSignal.timeout(3000) };
const chatgpt = (fetchImpl) => new OpenAIProvider({ accessToken: async () => "TEST_ONLY" }, { fetchImpl });

test("hosted web search is added on request; searches and citations become sources", async () => {
  const bodies = [];
  const events = [];
  const output = [search, message("La luz cuesta 0,12 €/kWh.", [{ type: "url_citation", url: "https://www.omie.es/precios", title: "Precios OMIE", start_index: 0, end_index: 5 }])];
  const p = chatgpt(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return sse([{ type: "response.web_search_call.searching", item_id: "ws_1" }, ...done(output)]);
  });
  const result = await p.respond({ ...request, webSearch: true, onEvent: (e) => events.push(e.type) });
  assert.deepEqual(bodies[0].tools.at(-1), { type: "web_search" });
  assert.ok(bodies[0].include.includes("web_search_call.action.sources"));
  assert.ok(bodies[0].include.includes("reasoning.encrypted_content"));
  assert.equal(result.webSearch, "native");
  assert.deepEqual(events, ["response.web_search_call.searching"]);
  const [s] = webSearchesOf(result.output);
  assert.equal(s.query, "precio luz hoy");
  assert.equal(s.count, 2);
  assert.deepEqual(s.sources[0], { url: "https://www.omie.es/precios", title: "Precios OMIE", domain: "omie.es" });
  assert.deepEqual(citationsOf(result.output).map((c) => c.url), ["https://www.omie.es/precios"]);
  await p.respond(request);
  assert.equal(bodies[1].tools.some((t) => t.type === "web_search"), false, "only when asked");
});

test("a 400 for the search tool retries once without it and keeps it off for the session", async () => {
  const bodies = [];
  const p = chatgpt(async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.tools.some((t) => t.type === "web_search")) return new Response(JSON.stringify({ detail: "Unsupported tool type: web_search" }), { status: 400 });
    return sse(done([message("Sin búsqueda")]));
  });
  const first = await p.respond({ ...request, webSearch: true });
  assert.equal(first.text, "Sin búsqueda");
  assert.equal(first.webSearch, "unavailable");
  assert.equal(bodies.length, 2);
  assert.equal(p.nativeSearchAvailable(), false);
  await p.respond({ ...request, webSearch: true });
  assert.equal(bodies.length, 3, "no second attempt with the tool in the same session");
  assert.equal(bodies[2].tools.length, 0);
});

test("a 400 naming the sources include keeps the search but drops the include", async () => {
  const bodies = [];
  const p = chatgpt(async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.include?.includes("web_search_call.action.sources")) return new Response('{"error":{"message":"Invalid value for include"}}', { status: 400 });
    return sse(done([message("ok")]));
  });
  const r = await p.respond({ ...request, webSearch: true });
  assert.equal(r.webSearch, "native");
  assert.ok(bodies[1].tools.some((t) => t.type === "web_search"));
  assert.ok(!bodies[1].include.includes("web_search_call.action.sources"));
});

test("the local model never gets hosted search, encrypted reasoning or image generation", async () => {
  const bodies = [];
  const local = new LocalProvider(() => ({ baseUrl: "http://127.0.0.1:11434", model: "qwen" }), {
    fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return sse(done([message("local")])); },
  });
  await local.respond({ ...request, webSearch: true, input: [{ role: "user", content: "x" }, { type: "reasoning", encrypted_content: "e" }, search, message("y")] });
  assert.equal(bodies[0].tools.length, 0);
  assert.deepEqual(bodies[0].input.map((x) => x.type || x.role), ["user", "message"]);
  await assert.rejects(local.generateImage({ prompt: "x" }), /modelo local no puede crear imágenes/);
});

test("image generation: forced image_generation tool, PNG from the stream, clear error when the plan lacks it", async () => {
  const png = makePng().toString("base64");
  const bodies = [], phases = [];
  const p = chatgpt(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return sse([
      { type: "response.image_generation_call.in_progress" },
      { type: "response.image_generation_call.generating" },
      ...done([{ type: "image_generation_call", id: "ig_1", status: "completed", result: png, revised_prompt: "Un faro al atardecer" }]),
    ]);
  });
  const r = await p.generateImage({ model: "gpt-5", prompt: "faro", size: "1536x1024", signal: AbortSignal.timeout(3000), onPhase: (x) => phases.push(x) });
  assert.equal(r.base64, png);
  assert.equal(r.revisedPrompt, "Un faro al atardecer");
  assert.deepEqual(bodies[0].tools, [{ type: "image_generation", size: "1536x1024", output_format: "png" }]);
  assert.deepEqual(bodies[0].tool_choice, { type: "image_generation" });
  assert.equal(bodies[0].store, false);
  assert.deepEqual(phases, ["Preparando", "Dibujando"]);
  const refused = chatgpt(async () => new Response('{"detail":"Tool \'image_generation\' is not supported with this plan"}', { status: 400 }));
  await assert.rejects(refused.generateImage({ model: "gpt-5", prompt: "x", size: "1024x1024" }), (e) => e.message === IMAGES_UNSUPPORTED);
  const text = chatgpt(async () => sse(done([{ type: "message", content: [{ type: "refusal", refusal: "No puedo crear esa imagen." }] }])));
  await assert.rejects(text.generateImage({ model: "gpt-5", prompt: "x" }), /No puedo crear esa imagen/);
});

test("transient errors are classified; the hub skips its own local fallback when asked", async (t) => {
  assert.equal(isTransientError(Object.assign(Error("x"), { status: 429 })), true);
  assert.equal(isTransientError(Object.assign(Error("x"), { status: 503 })), true);
  assert.equal(isTransientError(Object.assign(Error("x"), { status: 400 })), false);
  assert.equal(isTransientError(Object.assign(Error("x"), { status: 401 })), false);
  assert.equal(isTransientError(new DOMException("t", "TimeoutError")), true);
  assert.equal(isTransientError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })), true);
  assert.equal(isTransientError(Object.assign(Error("cap"), { code: "COLMENA_MONTHLY_LIMIT", status: 429 })), false);
  const cut = chatgpt(async () => new Response(frame({ type: "response.output_text.delta", delta: "a" })));
  await assert.rejects(cut.respond(request), (e) => isTransientError(e));

  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-core-hub-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  store.patch("settings", "main", { fallback: "local" });
  const calls = [];
  const hub = new ProviderHub({
    session: { status: () => ({ email: "a@b.c" }), accessToken: async () => "T", models: [] }, store, vault: null,
    fetchImpl: async (url) => { calls.push(String(url)); return String(url).includes("127.0.0.1") ? sse(done([message("local")])) : new Response("", { status: 429 }); },
  });
  hub.saveConfig({ local: { baseUrl: "http://127.0.0.1:11434", model: "qwen" } });
  assert.equal(hub.fallbackProvider(), hub.local);
  await assert.rejects(hub.respond({ ...request, fallback: false }), (e) => e.status === 429);
  assert.equal((await hub.respond(request)).text, "local", "other callers keep the immediate fallback");
  assert.equal(hub.nativeSearchAvailable(), true);
});

test("prompt_cache_key goes with every call that has one, and is dropped if the endpoint refuses it", async () => {
  const bodies = [];
  let refuse = true;
  const p = chatgpt(async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (refuse && body.prompt_cache_key) {
      refuse = false;
      return new Response(JSON.stringify({ error: { message: "Unsupported parameter: prompt_cache_key" } }), { status: 400 });
    }
    return sse(done([message("hola")]));
  });
  let headers = null;
  const ok = chatgpt(async (_url, init) => { headers = init.headers; bodies.push(JSON.parse(init.body)); return sse(done([message("hola")])); });
  await ok.respond({ ...request, cacheKey: "colmena-abc" });
  assert.equal(bodies.at(-1).prompt_cache_key, "colmena-abc");
  assert.equal(headers.session_id, "colmena-abc", "the ChatGPT backend routes its cache by this header");
  assert.equal((await p.respond({ ...request, cacheKey: "colmena-abc" })).text, "hola");
  assert.equal(bodies.at(-1).prompt_cache_key, undefined, "retried without it");
  await p.respond({ ...request, cacheKey: "colmena-abc" });
  assert.equal(bodies.at(-1).prompt_cache_key, undefined, "and not sent again this session");
  const local = new LocalProvider(() => ({ baseUrl: "http://127.0.0.1:11434", model: "qwen" }), { fetchImpl: async (_u, init) => { bodies.push(JSON.parse(init.body)); return sse(done([message("x")])); } });
  await local.respond({ ...request, cacheKey: "colmena-abc" });
  assert.equal(bodies.at(-1).prompt_cache_key, undefined, "never to a local server");
});

test("the ChatGPT plan's windows are read from the response headers when the backend sends them", async () => {
  const { planLimitsOf } = await import("../server/provider.mjs");
  const at = Date.parse("2026-10-16T10:00:00Z");
  const headers = new Headers({ "x-codex-primary-used-percent": "37.4", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": "3600", "x-codex-secondary-used-percent": "12" });
  const limits = planLimitsOf(headers, at);
  assert.deepEqual(limits.primary, { usedPercent: 37, windowMinutes: 300, resetsAt: "2026-10-16T11:00:00.000Z" });
  assert.equal(limits.secondary.usedPercent, 12);
  assert.equal(planLimitsOf(new Headers({}), at), null, "nothing reported, nothing shown");
});
