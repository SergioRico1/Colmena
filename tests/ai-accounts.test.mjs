// Gemini, OpenRouter, DeepSeek, Kimi and «Servidor propio»: the shared Chat Completions adapter,
// each provider's configuration, URL validation, key storage and fallback. No real network:
// local fake HTTP servers or a recording fetch. Never real keys.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { Store } from "../server/store.mjs";
import { ProviderHub } from "../server/provider.mjs";
import { chooseModel } from "../server/models.mjs";
import { cheapestModel } from "../server/checkins.mjs";
import { isContextOverflow } from "../server/stopped.mjs";
import { usageLimitOf } from "../server/limits.mjs";
import { CompletionsProvider, toChatMessages, chatError, GEMINI_SKIP_SIGNATURE } from "../server/providers/completions.mjs";
import { checkKey, openrouterModel, OPENROUTER_HEADERS, looksVisual } from "../server/providers/accounts.mjs";
import { validateBaseUrl, hostKind } from "../server/providers/endpoint.mjs";
import { supportsVision, supportsPdf, setDynamicModels } from "../server/providers/catalog.mjs";

const KEYS = {
  gemini: "AIzaTEST_ONLY_gemini_0000000000000001",
  openrouter: "sk-or-v1-TEST_ONLY_openrouter_000000002",
  deepseek: "sk-TEST_ONLY_deepseek_0000000000003",
  moonshot: "sk-TEST_ONLY_moonshot_0000000000004",
  custom: "TEST_ONLY_custom_5",
};
const sse = (chunks, { done = true } = {}) => chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + (done ? "data: [DONE]\n\n" : "");
const names = { name: "Prueba", limit: "Has llegado al límite de uso de Prueba.", auth: "Prueba no acepta la clave guardada." };

/** A local fake server: `handle(req, body)` returns {status, headers, body, pieces}. */
async function fakeServer(t, handle) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const out = await handle(req, body);
    res.writeHead(out.status || 200, { "content-type": out.type || "text/event-stream", ...(out.headers || {}) });
    // Split the stream at awkward places: in the middle of events and of JSON.
    for (const piece of out.pieces || [out.body || ""]) { res.write(piece); await new Promise((r) => setTimeout(r, 2)); }
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  return { base: "http://127.0.0.1:" + server.address().port + "/v1", seen };
}

const cut = (text, n = 7) => Array.from({ length: Math.ceil(text.length / n) }, (_, i) => text.slice(i * n, i * n + n));

test("adapter: streamed text, reasoning, parallel tool calls with streamed arguments and usage", async (t) => {
  const chunks = [
    { id: "r1", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Pienso" } }] },
    { id: "r1", choices: [{ index: 0, delta: { content: "Miro dos " } }] },
    { id: "r1", choices: [{ index: 0, delta: { content: "archivos." } }] },
    { id: "r1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "read_file", arguments: "" } }] } }] },
    { id: "r1", choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "read_file", arguments: "{\"pa" } }] } }] },
    { id: "r1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"path\":" } }] } }] },
    { id: "r1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"a.txt\"}" } }] } }] },
    { id: "r1", choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: "th\":\"b.txt\"}" } }] } }] },
    { id: "r1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    { id: "r1", choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 9 } } },
  ];
  const fake = await fakeServer(t, () => ({ pieces: cut(sse(chunks)) }));
  setDynamicModels("custom", [{ id: "qwen3-coder", families: ["luna", "sol", "astra"], utility: true }]);
  const p = new CompletionsProvider({ engine: "custom", loadKey: async () => KEYS.custom, baseUrl: () => fake.base, keyOptional: true, names });
  const deltas = [], events = [];
  const r = await p.respond({ model: "custom/qwen3-coder", instructions: "Sys", input: "lee a y b", tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } }], onDelta: (d) => deltas.push(d), onEvent: (e) => events.push(e.type) });
  assert.equal(fake.seen[0].url, "/v1/chat/completions");
  assert.equal(fake.seen[0].headers.authorization, "Bearer " + KEYS.custom);
  assert.equal(fake.seen[0].body.stream, true);
  assert.deepEqual(fake.seen[0].body.stream_options, { include_usage: true });
  assert.equal(fake.seen[0].body.max_tokens, undefined, "a home server gets no answer cap");
  assert.equal(fake.seen[0].body.tools[0].function.name, "read_file");
  assert.equal(deltas.join(""), "Miro dos archivos.");
  assert.ok(events.includes("response.reasoning_summary_text.delta") && events.includes("response.function_call_arguments.delta"));
  assert.deepEqual(r.output.map((x) => x.type), ["native_turn", "message", "function_call", "function_call"]);
  assert.equal(r.output[0].engine, "custom");
  assert.equal(r.output[0].reasoning, "Pienso");
  assert.deepEqual(r.output.slice(2).map((c) => [c.call_id, c.arguments]), [["call_a", "{\"path\":\"a.txt\"}"], ["call_b", "{\"path\":\"b.txt\"}"]]);
  assert.deepEqual(r.usage, { input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 9 } });
  assert.equal(r.model, "custom/qwen3-coder");
});

test("adapter: calls without an index, a server without finish reason, and a cut stream", async (t) => {
  let mode = "noindex";
  const fake = await fakeServer(t, () => {
    if (mode === "noindex") return { body: sse([
      { choices: [{ delta: { tool_calls: [{ id: "g1", type: "function", function: { name: "a", arguments: "{\"x\":1}" }, extra_content: { google: { thought_signature: "SIG1" } } }, { id: "g2", type: "function", function: { name: "b", arguments: "{}" } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]) };
    if (mode === "nofinish") return { body: sse([{ choices: [{ delta: { content: "hola" } }] }]) };
    return { body: sse([{ choices: [{ delta: { content: "ho" } }] }], { done: false }).slice(0, -3) };
  });
  setDynamicModels("custom", [{ id: "m", families: ["luna"] }]);
  const p = new CompletionsProvider({ engine: "custom", loadKey: async () => null, keyOptional: true, baseUrl: () => fake.base, names });
  const r = await p.respond({ model: "custom/m", input: "x" });
  assert.deepEqual(r.output.filter((x) => x.type === "function_call").map((c) => [c.call_id, c.name, c.arguments]), [["g1", "a", "{\"x\":1}"], ["g2", "b", "{}"]]);
  assert.deepEqual(r.output[0].extras, { g1: { google: { thought_signature: "SIG1" } } }, "Gemini's signature is kept for the same model");
  assert.equal(fake.seen[0].headers.authorization, undefined, "no key: no Authorization header");
  mode = "nofinish";
  assert.equal((await p.respond({ model: "custom/m", input: "x" })).text, "hola", "a home server may end without finish_reason");
  mode = "cut";
  await assert.rejects(p.respond({ model: "custom/m", input: "x" }), (e) => e.transient === true && /a medias/.test(e.message));
});

test("adapter: provider errors become plain sentences (bad key, no credit, rate limit, quota, no model, context too long)", async (t) => {
  const answers = {
    "bad-key": { status: 401, type: "application/json", body: JSON.stringify({ error: { message: "Incorrect API key provided", type: "authentication_error" } }) },
    "no-credit": { status: 402, type: "application/json", body: JSON.stringify({ error: { message: "Insufficient Balance" } }) },
    "rate": { status: 429, type: "application/json", headers: { "retry-after": "3" }, body: JSON.stringify({ error: { message: "Too many requests, slow down" } }) },
    "quota": { status: 429, type: "application/json", body: JSON.stringify([{ error: { code: 429, message: "You exceeded your current quota", status: "RESOURCE_EXHAUSTED" } }]) },
    "no-model": { status: 404, type: "application/json", body: JSON.stringify({ error: { message: "The model `nope` does not exist" } }) },
    "too-long": { status: 400, type: "application/json", body: JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.", code: "context_length_exceeded" } }) },
    "down": { status: 503, type: "application/json", body: "{}" },
  };
  let which = "bad-key";
  const fake = await fakeServer(t, () => answers[which]);
  setDynamicModels("custom", [{ id: "m", label: "Modelo M", families: ["luna"] }]);
  const p = new CompletionsProvider({ engine: "custom", loadKey: async () => KEYS.custom, baseUrl: () => fake.base, keyOptional: true, names: { ...names, credit: "Sin saldo en Prueba." } });
  const fail = async (w) => { which = w; try { await p.respond({ model: "custom/m", input: "x" }); } catch (e) { return e; } throw Error("no error"); };
  const original = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = original; });
  let e = await fail("bad-key");
  assert.equal(e.status, 401); assert.equal(e.message, "Prueba no acepta la clave guardada.");
  assert.doesNotMatch(e.message + e.detail, /TEST_ONLY/, "the key never shows up in an error");
  e = await fail("no-credit");
  assert.equal(e.status, 402); assert.equal(e.message, "Sin saldo en Prueba.");
  e = await fail("rate");
  assert.equal(e.status, 429); assert.match(e.message, /más despacio/);
  assert.equal(e.headers["retry-after"], "3");
  assert.equal(usageLimitOf(e)?.kind, "rate", "a short rate limit is retried in place");
  e = await fail("quota");
  assert.equal(e.status, 429); assert.equal(e.message, "Has llegado al límite de uso de Prueba.");
  assert.equal(usageLimitOf(e)?.kind, "usage", "an exhausted quota pauses the engine until it renews");
  e = await fail("no-model");
  assert.equal(e.status, 404); assert.match(e.message, /no tiene el modelo «Modelo M»/);
  e = await fail("too-long");
  assert.equal(e.status, 400); assert.match(e.message, /demasiado larga/);
  assert.equal(isContextOverflow(e), true, "the runtime compacts and retries");
  e = await fail("down");
  assert.equal(e.status, 503); assert.match(e.message, /no responde ahora mismo/);
  // OpenRouter's mid-stream error (after the 200): a typed code inside the stream.
  const mid = chatError({ status: 402, detail: JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), names, model: "x" });
  assert.equal(mid.status, 402);
});

test("adapter: an error after the 200 (OpenRouter mid-stream) is mapped; a 5xx one is retried", async (t) => {
  let code = 402;
  const fake = await fakeServer(t, () => ({ body: sse([{ choices: [{ delta: { content: "a" } }] }, { error: { code, message: code === 402 ? "Insufficient credits" : "Provider returned error", metadata: { error_type: "provider_error" } }, choices: [{ delta: {}, finish_reason: "error" }] }]) }));
  setDynamicModels("openrouter", [{ id: "x/y", families: ["luna"] }]);
  const p = new CompletionsProvider({ engine: "openrouter", loadKey: async () => KEYS.openrouter, baseUrl: () => fake.base, names });
  await assert.rejects(p.respond({ model: "openrouter/x/y", input: "x" }), (e) => e.status === 402);
  code = 502;
  await assert.rejects(p.respond({ model: "openrouter/x/y", input: "x" }), (e) => e.transient === true && e.providerCode === "provider_error");
});

test("history: Gemini signatures, OpenRouter reasoning_details and PDFs go back only where they belong", () => {
  const history = [
    { role: "user", content: [{ type: "input_text", text: "lee" }, { type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,JVBERi0=" }] },
    { type: "native_turn", provider: "completions", engine: "gemini", model: "gemini-3.8-flash", count: 2, reasoning: "", extras: { c1: { google: { thought_signature: "SIG" } } }, details: [{ type: "reasoning.encrypted", data: "x" }] },
    { type: "function_call", call_id: "c1", name: "read_file", arguments: "{}" },
    { type: "function_call", call_id: "c2", name: "read_file", arguments: "{}" },
    { type: "function_call_output", call_id: "c1", output: "uno" },
    { type: "function_call_output", call_id: "c2", output: "dos" },
    { type: "native_turn", provider: "anthropic", model: "claude-opus-5-5", count: 1 },
    { type: "function_call", call_id: "c3", name: "read_file", arguments: "{}" },
    { type: "function_call_output", call_id: "c3", output: "tres" },
  ];
  const same = toChatMessages(history, { model: "gemini-3.8-flash", engine: "gemini", signatures: true, replayReasoning: false });
  const rounds = same.filter((m) => m.role === "assistant");
  assert.deepEqual(rounds[0].tool_calls[0].extra_content, { google: { thought_signature: "SIG" } }, "its own signature");
  assert.equal(rounds[0].tool_calls[1].extra_content, undefined, "only the first call of a round carries it");
  assert.deepEqual(rounds[0].reasoning_details, [{ type: "reasoning.encrypted", data: "x" }]);
  assert.equal(rounds[1].tool_calls[0].extra_content.google.thought_signature, GEMINI_SKIP_SIGNATURE, "another model's call skips the check");
  assert.match(same[0].content, /PDF omitido/, "Gemini's OpenAI route does not take PDFs");
  const other = toChatMessages(history, { model: "gemini-3.8-flash", engine: "openrouter" });
  assert.ok(other.every((m) => !m.reasoning_details && !m.tool_calls?.some((c) => c.extra_content)), "nothing native crosses to another engine");
  const pdf = toChatMessages(history, { model: "x", engine: "openrouter", pdf: true });
  assert.deepEqual(pdf[0].content[1], { type: "file", file: { filename: "a.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } });
});

// ------------------------------------------------------------------ the hub
async function hubFor(t, fetchImpl, { session = { status: () => null, models: [] } } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-accounts-"));
  const store = new Store(directory);
  const saved = new Map();
  const vault = { load: async (b) => saved.get(b.profile) || null, save: async (b, c) => saved.set(b.profile, c), remove: async (p) => saved.delete(p) };
  const hub = new ProviderHub({ session, store, vault, fetchImpl });
  t.after(async () => { hub.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { hub, store, saved };
}
const capture = (respond) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: init.body ? JSON.parse(init.body) : null });
    return respond(calls.at(-1), calls.length);
  };
  return { calls, fetchImpl };
};
const okChat = () => Response.json({ id: "x", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });
const streamOk = (text) => new Response(sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]));

test("providers: Gemini, DeepSeek and Kimi connect with their key, check it cheaply and think with their catalogue", async (t) => {
  const { calls, fetchImpl } = capture((c) => (c.body?.stream ? streamOk(c.url) : okChat()));
  const { hub, store, saved } = await hubFor(t, fetchImpl);
  await assert.rejects(hub.accounts.connect("gemini", { key: KEYS.deepseek }), /empiezan por «AIza»/);
  await hub.accounts.connect("gemini", { key: " " + KEYS.gemini + "\n" });
  let check = calls.at(-1);
  assert.equal(check.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(check.headers.authorization, "Bearer " + KEYS.gemini);
  assert.deepEqual([check.body.model, check.body.max_tokens, check.body.stream, check.body.reasoning_effort], ["gemini-3.5-flash-lite", 16, false, "minimal"]);
  assert.equal(saved.get("gemini-apikey").key, KEYS.gemini);
  assert.doesNotMatch(JSON.stringify(store.list("providers")), /TEST_ONLY/, "SQLite keeps only the last four");
  assert.doesNotMatch(JSON.stringify(hub.engines()), /TEST_ONLY/);
  assert.equal(hub.engines().find((e) => e.id === "gemini").detail, "Clave ····0001");
  assert.equal(hub.primary, "gemini");
  // «Automático»: every family on 3.8 Flash (free tier), side tasks on Flash-Lite.
  const gem = hub.modelsFor("gemini");
  for (const bot of [{ id: "atlas" }, { id: "vera", role: "Redacta" }, { id: "bruno", role: "Programa" }]) assert.equal(chooseModel(bot, gem).slug, "gemini/gemini-3.8-flash");
  assert.equal(cheapestModel(gem), "gemini/gemini-3.5-flash-lite");
  await hub.accounts.setModel("gemini", "gemini/gemini-4-carbon");
  assert.equal(chooseModel({ id: "vera", role: "Redacta" }, hub.modelsFor("gemini")).slug, "gemini/gemini-4-carbon");
  await hub.accounts.setModel("gemini", null);
  assert.equal(chooseModel({ id: "vera" }, hub.modelsFor("gemini")).slug, "gemini/gemini-3.8-flash");
  await hub.respond({ model: "gemini/gemini-3.8-flash", input: "hola", reasoning: { effort: "medium" } });
  assert.equal(calls.at(-1).body.reasoning_effort, "medium");
  assert.equal(calls.at(-1).body.model, "gemini-3.8-flash");

  await hub.accounts.connect("deepseek", { key: KEYS.deepseek });
  check = calls.at(-1);
  assert.equal(check.url, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(check.body.thinking, { type: "disabled" }, "the check does not think");
  await hub.respond({ model: "deepseek/deepseek-flash", input: "hola", reasoning: { effort: "medium" } });
  assert.deepEqual([calls.at(-1).body.thinking, calls.at(-1).body.reasoning_effort], [{ type: "enabled" }, "high"]);
  assert.equal(calls.at(-1).headers.authorization, "Bearer " + KEYS.deepseek, "each provider gets only its own key");

  await hub.accounts.connect("moonshot", { key: KEYS.moonshot });
  check = calls.at(-1);
  assert.equal(check.url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(check.body.max_completion_tokens, 16);
  await hub.respond({ model: "moonshot/kimi-k3.1-pro", input: "hola", reasoning: { effort: "low" } });
  assert.deepEqual([calls.at(-1).body.reasoning_effort, typeof calls.at(-1).body.max_completion_tokens, calls.at(-1).body.max_tokens], ["low", "number", undefined]);
  assert.equal(chooseModel({ id: "atlas" }, hub.modelsFor("moonshot")).slug, "moonshot/kimi-k3.1-pro");
  assert.equal(chooseModel({ id: "vera", role: "Redacta" }, hub.modelsFor("moonshot")).slug, "moonshot/kimi-k3.1-pro-highspeed");
  for (const c of calls) {
    const host = new URL(c.url).host;
    const expected = { "generativelanguage.googleapis.com": KEYS.gemini, "api.deepseek.com": KEYS.deepseek, "api.moonshot.ai": KEYS.moonshot }[host];
    assert.equal(c.headers.authorization, "Bearer " + expected, "never another provider's key: " + c.url);
  }
  // Vision per model, for the image and PDF input.
  assert.equal(hub.supportsVision("deepseek/deepseek-flash"), true);
  assert.equal(hub.supportsVision("deepseek/deepseek-v4-pro"), false);
  assert.equal(hub.supportsPdf("gemini/gemini-3.8-flash"), false);
  assert.equal(supportsPdf("anthropic/claude-opus-5-5"), true);
  assert.equal(supportsVision("gpt-6.1-sol"), true);

  await hub.clear("gemini");
  assert.equal(saved.has("gemini-apikey"), false);
  assert.equal(hub.connected("gemini"), false);
  assert.equal(hub.config().pins?.gemini, undefined);
});

test("providers: a bad key, no credit or a rate limit at «Probar» is said plainly; nothing is saved", async (t) => {
  let status = 401;
  const { fetchImpl } = capture(() => Response.json({ error: { message: status === 402 ? "Insufficient Balance" : "Invalid API key" } }, { status }));
  const { hub, saved } = await hubFor(t, fetchImpl);
  await assert.rejects(hub.accounts.test("deepseek", { key: KEYS.deepseek }), /DeepSeek no acepta esa clave\. Cópiala de nuevo de platform\.deepseek\.com/);
  status = 402;
  await assert.rejects(hub.accounts.connect("deepseek", { key: KEYS.deepseek }), /no tiene saldo\. Recárgala en platform\.deepseek\.com/);
  assert.equal(saved.size, 0);
  assert.equal(hub.connected("deepseek"), false);
  assert.match(checkKey("openrouter", "sk-TEST_ONLY_not_openrouter_000").error, /sk-or-/);
  assert.match(checkKey("moonshot", "abc def ghijklmnopqrstu").error, /en medio/);
  assert.match(checkKey("deepseek", "short").error, /demasiado corta/);
  assert.deepEqual(checkKey("custom", ""), { key: "" }, "a server without a key is fine");
});

test("OpenRouter: app headers, the model list (only models that call tools), «Automático» and reasoning", async (t) => {
  const list = { data: [
    { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", context_length: 1000000, architecture: { input_modalities: ["text", "image", "file"] }, supported_parameters: ["tools", "reasoning"], pricing: { prompt: "0.000002", completion: "0.00001" }, top_provider: { max_completion_tokens: 64000 } },
    { id: "meta/llama-text", name: "Llama text", context_length: 128000, architecture: { input_modalities: ["text"] }, supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" } },
    { id: "someone/no-tools", name: "No tools", architecture: { input_modalities: ["text"] }, supported_parameters: ["temperature"] },
  ] };
  const { calls, fetchImpl } = capture((c) => {
    if (c.url.endsWith("/models")) return Response.json(list);
    return c.body?.stream ? streamOk("or") : okChat();
  });
  const { hub } = await hubFor(t, fetchImpl);
  const models = await hub.accounts.listModels("openrouter", { key: KEYS.openrouter });
  assert.deepEqual(models.map((m) => m.id), ["openrouter/auto", "anthropic/claude-sonnet-5.5", "meta/llama-text"]);
  assert.deepEqual(openrouterModel(list.data[0]).cost, [2, 10]);
  await hub.accounts.connect("openrouter", { key: KEYS.openrouter });
  const check = calls.at(-1);
  assert.equal(check.url, "https://openrouter.ai/api/v1/chat/completions");
  for (const [k, v] of Object.entries(OPENROUTER_HEADERS)) assert.equal(check.headers[k.toLowerCase()], v);
  assert.equal(check.body.model, "openrouter/auto");
  assert.equal(hub.engines().find((e) => e.id === "openrouter").modelLabel, "Automático");
  assert.equal(chooseModel({ id: "atlas" }, hub.modelsFor("openrouter")).slug, "openrouter/openrouter/auto");
  await hub.accounts.setModel("openrouter", "anthropic/claude-sonnet-5.5");
  assert.equal(chooseModel({ id: "atlas" }, hub.modelsFor("openrouter")).slug, "openrouter/anthropic/claude-sonnet-5.5");
  assert.equal(hub.supportsVision("openrouter/anthropic/claude-sonnet-5.5"), true);
  assert.equal(hub.supportsPdf("openrouter/anthropic/claude-sonnet-5.5"), true);
  await assert.rejects(hub.accounts.setModel("openrouter", "someone/no-tools"), /con herramientas/);
  await hub.respond({ model: "openrouter/anthropic/claude-sonnet-5.5", input: "hola", reasoning: { effort: "high" } });
  const sent = calls.at(-1);
  assert.equal(sent.body.model, "anthropic/claude-sonnet-5.5");
  assert.deepEqual(sent.body.reasoning, { effort: "high" });
  assert.equal(sent.headers["x-openrouter-title"], "Colmena");
  assert.equal(sent.body.max_tokens, 64000);
  await hub.accounts.setModel("openrouter", "meta/llama-text");
  assert.equal(hub.supportsVision("openrouter/meta/llama-text"), false, "a text-only model drops images");
});

test("Servidor propio: a local fake server, only its base URL is called, its /models list is read", async (t) => {
  const fake = await fakeServer(t, (req, body) => {
    if (req.url === "/v1/models") return { type: "application/json", body: JSON.stringify({ object: "list", data: [{ id: "qwen3-coder", max_model_len: 32768 }, { id: "llava-1.6" }, { id: "nomic-embed-text" }] }) };
    if (!body.stream) return { type: "application/json", body: JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }) };
    return { body: sse([{ choices: [{ delta: { content: "desde casa" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]) };
  });
  const { hub, saved, store } = await hubFor(t, fetch);
  await assert.rejects(hub.accounts.connect("custom", { baseUrl: "http://example.com/v1", model: "x" }), /https:\/\//);
  const models = await hub.accounts.listModels("custom", { baseUrl: fake.base + "/chat/completions" });
  assert.deepEqual(models.map((m) => [m.id, m.vision]), [["qwen3-coder", false], ["llava-1.6", true]]);
  await hub.accounts.connect("custom", { baseUrl: fake.base, model: "qwen3-coder", key: KEYS.custom });
  assert.equal(saved.get("custom-apikey").key, KEYS.custom);
  const view = hub.engines().find((e) => e.id === "custom");
  assert.equal(view.connected, true);
  assert.equal(view.detail, new URL(fake.base).host + " · Clave ····om_5 · qwen3-coder");
  assert.doesNotMatch(JSON.stringify(store.list("providers")), /TEST_ONLY/);
  const r = await hub.respond({ model: "custom/qwen3-coder", input: "hola" });
  assert.equal(r.text, "desde casa");
  assert.equal(r.engine, "custom");
  assert.ok(fake.seen.every((s) => s.url.startsWith("/v1/")), "only the base URL the person typed");
  assert.ok(fake.seen.filter((s) => s.method === "POST").every((s) => s.headers.authorization === "Bearer " + KEYS.custom));
  assert.equal(hub.modelLimits("custom/qwen3-coder").window, 32768);
  // Disconnecting forgets the key and the address.
  await hub.clear("custom");
  assert.equal(hub.connected("custom"), false);
  assert.equal(saved.has("custom-apikey"), false);
});

test("URL validation: http only on this computer or the local network; no credentials, query or link-local", () => {
  assert.equal(validateBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
  assert.equal(validateBaseUrl("192.168.1.20:8000/v1"), "http://192.168.1.20:8000/v1");
  assert.equal(validateBaseUrl("http://10.0.0.5/v1/chat/completions"), "http://10.0.0.5/v1");
  assert.equal(validateBaseUrl("http://gpu-box:8000/v1"), "http://gpu-box:8000/v1");
  assert.equal(validateBaseUrl("http://ollama.local:11434/v1"), "http://ollama.local:11434/v1");
  assert.equal(validateBaseUrl("http://[::1]:8080/v1"), "http://[::1]:8080/v1");
  assert.equal(validateBaseUrl("https://llm.example.com/v1/models"), "https://llm.example.com/v1");
  assert.throws(() => validateBaseUrl("http://llm.example.com/v1"), /https:\/\//);
  assert.throws(() => validateBaseUrl("http://8.8.8.8/v1"), /https:\/\//);
  assert.throws(() => validateBaseUrl("http://169.254.169.254/latest"), /no es la de un servidor/);
  assert.throws(() => validateBaseUrl("https://user:pass@llm.example.com/v1"), /usuario y la contraseña/);
  assert.throws(() => validateBaseUrl("https://llm.example.com/v1?key=1"), /«\?»/);
  assert.throws(() => validateBaseUrl("ftp://llm.example.com"), /http:\/\/ o https:\/\//);
  assert.throws(() => validateBaseUrl(""), /Escribe la dirección/);
  assert.equal(hostKind("172.20.1.1"), "lan");
  assert.equal(hostKind("172.32.1.1"), "public");
  assert.equal(hostKind("100.100.1.1"), "lan", "Tailscale (CGNAT)");
  assert.equal(looksVisual("qwen2.5-vl:7b"), true);
  assert.equal(looksVisual("llama3.1:8b"), false);
});

test("fallback: Gemini out of quota hands over to DeepSeek with the same family", async (t) => {
  const { calls, fetchImpl } = capture((c) => {
    if (!c.body?.stream) return okChat();
    if (c.url.includes("googleapis")) return Response.json([{ error: { code: 429, message: "You exceeded your current quota", status: "RESOURCE_EXHAUSTED" } }], { status: 429 });
    return streamOk("sustituto");
  });
  const { hub } = await hubFor(t, fetchImpl);
  const original = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = original; });
  await hub.accounts.connect("gemini", { key: KEYS.gemini });
  await hub.accounts.connect("deepseek", { key: KEYS.deepseek });
  hub.setEngines({ primary: "gemini", fallback: "deepseek" });
  const r = await hub.respond({ model: "gemini/gemini-3.8-flash", input: "hola" });
  assert.equal(r.text, "sustituto");
  assert.equal(r.model, "deepseek/deepseek-flash");
  assert.equal(r.fellBack, "DeepSeek");
  assert.equal(hub.resting("gemini"), true, "the quota ran out: Gemini rests until it renews");
  assert.ok(hub.limitOf("gemini"));
  assert.equal(calls.at(-1).headers.authorization, "Bearer " + KEYS.deepseek);
  // Disconnecting the backup leaves «Si falla, usar» on «Nada».
  await hub.clear("deepseek");
  assert.equal(hub.config().fallback, "none");
});
