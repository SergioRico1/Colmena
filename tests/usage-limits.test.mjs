import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { ProviderHub, LocalProvider } from "../server/provider.mjs";
import { buildState } from "../server/state.mjs";
import { usageLimitOf, resetFromText, limitMessage } from "../server/limits.mjs";
import { selectHistory, handoffBudget, positionRanges, readThread } from "../server/handoff.mjs";
import { toMessages } from "../server/providers/anthropic-items.mjs";
import { toChatMessages, CompletionsProvider } from "../server/providers/completions.mjs";
import { Notifier, delivery, noticeTag, pendingCount, shouldPop } from "../server/notifications.mjs";
import { answer, call, settle } from "./fixtures/runtime-fixture.mjs";

const MODELS = [{ slug: "gpt-6-luna", display_name: "GPT-6 Luna" }, { slug: "gpt-6-sol", display_name: "GPT-6 Sol" }, { slug: "gpt-6-astra", display_name: "GPT-6 Astra" }];
const session = { status: () => ({ canInfer: true, email: "persona@example.com" }), models: MODELS, listModels: async () => MODELS, accessToken: async () => "token" };

/** A streamed Responses answer (what ChatGPT sends when it works). */
const sse = (text) => new Response([
  { type: "response.created", response: { id: "r1" } },
  { type: "response.output_item.done", output_index: 0, item: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text }] } },
  { type: "response.completed", response: { id: "r1", status: "completed", output: [{ id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } },
].map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

/** ChatGPT's own usage-limit answer: a 429 with the renewal in the body and the plan headers. */
const chatgptLimit = ({ seconds = 5400, headers = {} } = {}) => new Response(JSON.stringify({ error: { type: "usage_limit_reached", message: "The usage limit has been reached", plan_type: "plus", resets_in_seconds: seconds } }), { status: 429, headers: { "content-type": "application/json", ...headers } });

async function setup(t, { fetchImpl, cli = null, fallback = "anthropic" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-limits-"));
  const store = new Store(directory);
  store.patch("settings", "main", { model: "gpt-6-sol", learning: false });
  const claudeCli = cli || { respond: async () => answer("Desde Claude"), nativeSearchAvailable: () => false, close() {} };
  const hub = new ProviderHub({ session, store, vault: null, fetchImpl, claudeCli });
  hub.saveConfig({ anthropic: { method: "cli" }, primary: "openai", fallback });
  const runtime = new Runtime(store, hub, null, { retryDelays: [1, 1, 1] });
  t.after(async () => { await runtime.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, runtime, hub };
}

test("limits: which limit a provider error is and when it renews", () => {
  const at = Date.parse("2026-10-21T10:00:00Z");
  assert.equal(usageLimitOf({ status: 429, headers: { "retry-after": "2" } }, { at }).kind, "rate", "a 429 that clears in seconds is retried in place");
  const gpt = usageLimitOf({ status: 429, detail: JSON.stringify({ error: { type: "usage_limit_reached", resets_in_seconds: 3600 } }), headers: { "x-codex-primary-used-percent": "100", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": "3600" } }, { at });
  assert.deepEqual([gpt.kind, gpt.label, gpt.resetsAt], ["usage", "límite de 5 horas", "2026-10-21T11:00:00.000Z"]);
  const reset = Math.floor(at / 1000) + 7200;
  const claude = usageLimitOf({ status: 429, providerCode: "rate_limit_error", headers: { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-7d-status": "rejected", "anthropic-ratelimit-unified-7d-reset": String(reset) } }, { at });
  assert.deepEqual([claude.kind, claude.window, claude.resetsAt], ["usage", "semanal", new Date(reset * 1000).toISOString()]);
  const cli = usageLimitOf({ status: 429, detail: "Claude AI usage limit reached|" + reset }, { at });
  assert.equal(cli.resetsAt, new Date(reset * 1000).toISOString());
  assert.equal(usageLimitOf({ status: 429, detail: '{"error":{"message":"Rate limit exceeded. Try again in 3 hours"}}' }, { at }).kind, "usage");
  assert.equal(usageLimitOf({ status: 402, detail: "insufficient_quota" }, { at }).kind, "usage");
  assert.equal(usageLimitOf({ status: 500 }, { at }), null);
  const clock = new Date(resetFromText("You've hit your limit · resets 3pm (Europe/Madrid)", at));
  assert.equal(clock.getHours(), 15);
  assert.ok(clock.getTime() > at);
  assert.equal(resetFromText("(reset after 1h2m3s)", at), at + 3723000);
  assert.match(limitMessage("anthropic", { label: "límite semanal", resetsAt: null }, at), /^Claude ha llegado a su límite semanal\. Se volverá a intentar por su cuenta/);
});

test("an OpenCode Go 429 keeps its Retry-After: an hour away is a usage limit", async () => {
  const go = new CompletionsProvider({ loadKey: async () => "key", baseUrl: "https://example.invalid/v1", fetchImpl: async () => new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429, headers: { "retry-after": "3600" } }) });
  const error = await go.respond({ model: "opencode-go/deepseek-v4.1-flash", instructions: "x", input: [{ role: "user", content: "hola" }] }).catch((e) => e);
  assert.equal(error.status, 429);
  assert.equal(error.headers["retry-after"], "3600");
  const limit = usageLimitOf(error);
  assert.equal(limit.kind, "usage");
  assert.ok(Math.abs(Date.parse(limit.resetsAt) - (Date.now() + 3600e3)) < 5000);
});

test("a ChatGPT usage limit hands the turn to «Si falla, usar» at once, says so in one line, and is not asked again", async (t) => {
  let gptCalls = 0;
  const cliCalls = [];
  const { store, runtime, hub } = await setup(t, {
    fetchImpl: async () => { gptCalls++; return chatgptLimit({ headers: { "x-codex-primary-used-percent": "100", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": "5400" } }); },
    cli: { respond: async (p) => { cliCalls.push(p); return answer("Desde Claude"); }, nativeSearchAvailable: () => false, close() {} },
  });
  const m = runtime.create({ prompt: "Resume mi semana" });
  await runtime.launch(m.id);
  const done = store.get("missions", m.id);
  assert.equal(done.status, "completed");
  assert.equal(done.result, "Desde Claude");
  assert.equal(gptCalls, 1, "a usage limit is not retried with the same engine");
  assert.match(cliCalls[0].model, /^anthropic\//);
  assert.match(cliCalls[0].instructions, /\[Colmena\] Sigues tú con Claude: ChatGPT ha llegado a su límite de 5 horas/);
  const limit = hub.limitOf("openai");
  assert.equal(limit.label, "límite de 5 horas");
  assert.ok(Math.abs(Date.parse(limit.resetsAt) - (Date.now() + 5400e3)) < 10000);
  assert.equal(hub.engines().find((e) => e.id === "openai").limit.label, "límite de 5 horas");
  const line = store.list("messages").find((x) => x.missionId === m.id && x.handoff);
  assert.match(line.text, /^Nora sigue con Claude: ChatGPT ha llegado a su límite de 5 horas\.$/);
  assert.equal(runtime.steps(m.id)[0].recovery.at(-1).status, "fallback");
  // The next work starts on the substitute straight away: ChatGPT is not asked until it renews.
  const m2 = runtime.create({ prompt: "Y otra cosa" });
  await runtime.launch(m2.id);
  assert.equal(store.get("missions", m2.id).result, "Desde Claude");
  assert.equal(gptCalls, 1);
  assert.match(runtime.steps(m2.id)[0].model, /^anthropic\//);
  // It works again: the limit goes away.
  hub.saveConfig({ limits: { openai: { ...limit, until: new Date(Date.now() - 1000).toISOString() } } });
  assert.equal(hub.limitOf("openai"), null);
});

test("without a substitute the chat shows «Limitado» with the renewal, and goes on by itself when it renews", async (t) => {
  let limited = true;
  const { store, runtime, hub } = await setup(t, { fallback: "none", fetchImpl: async () => (limited ? chatgptLimit({ seconds: 120 }) : sse("Hecho tras renovarse")) });
  const notifier = new Notifier(store, { emit: () => {} });
  notifier.start();
  t.after(() => notifier.stop());
  const m = runtime.create({ prompt: "Prepara el informe", conversation: true });
  await runtime.launch(m.id);
  const paused = store.get("missions", m.id);
  assert.equal(paused.status, "paused");
  assert.equal(paused.limited.engine, "openai");
  assert.deepEqual(paused.limited.botIds, ["nora"]);
  assert.match(paused.error, /^ChatGPT ha llegado a su límite de uso\. Se renueva en 2 min y el trabajo seguirá entonces por su cuenta\./);
  const state = buildState(store, runtime);
  const summary = state.missions.find((x) => x.id === m.id);
  assert.equal(summary.statusLabel, "Limitado");
  assert.equal(summary.limited.engine, "openai");
  assert.match(summary.activityLine, /^Limitado · ChatGPT renueva su límite en 2 min/);
  const nora = state.bots.find((b) => b.id === "nora");
  assert.equal(nora.status, "limitado");
  assert.equal(nora.statusLabel, "Limitado");
  assert.equal(nora.engineLimit.engine, "openai");
  const notice = store.list("notifications").find((n) => n.kind === "limited");
  assert.match(notice.title, /^Nora espera en «/);
  // Not yet: nothing resumes before the renewal.
  assert.deepEqual(runtime.resumeLimited(Date.now()), []);
  // The renewal comes: the work goes on by itself, told not to repeat what was done.
  limited = false;
  hub.saveConfig({ limits: {} });
  assert.deepEqual(runtime.resumeLimited(Date.now() + 121_000), [m.id]);
  await settle(runtime);
  const resumed = store.get("missions", m.id);
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.result, "Hecho tras renovarse");
  assert.equal(resumed.limited, null);
  assert.equal(resumed.limitResumes.length, 1);
  assert.ok(runtime.steps(m.id)[0].history.some((x) => /Continúa donde lo dejaste, sin repetir/.test(String(x.content || ""))));
  assert.ok(store.list("messages").some((x) => x.missionId === m.id && /^ChatGPT ha renovado su límite de uso: el trabajo sigue\.$/.test(x.text)));
});

test("a mission waiting for a renewal goes on at once when a substitute becomes available", async (t) => {
  const { store, runtime, hub } = await setup(t, { fallback: "none", fetchImpl: async () => chatgptLimit({ seconds: 3600 }) });
  const m = runtime.create({ prompt: "Busca vuelos" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "paused");
  assert.deepEqual(runtime.resumeLimited(Date.now()), []);
  hub.setEngines({ fallback: "anthropic" });
  assert.deepEqual(runtime.resumeLimited(Date.now()), [m.id]);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).result, "Desde Claude");
  assert.ok(store.list("messages").some((x) => x.missionId === m.id && /^Sigue con Claude mientras ChatGPT renueva su límite\.$/.test(x.text)));
});

test("handoff: a budgeted selection of whole messages, the request apart, the rest readable with read_thread", async (t) => {
  const seen = [];
  let round = 0;
  const cli = {
    nativeSearchAvailable: () => false, close() {},
    respond: async (p) => {
      seen.push(p);
      round++;
      return round === 1 ? call("read_thread", { position: 1, limit: 2, messageId: "", textOffset: 0 }, "rt-1") : answer("Sigo con lo de antes");
    },
  };
  const { store, runtime } = await setup(t, { fetchImpl: async () => sse("Primera respuesta de ChatGPT"), cli });
  const m = runtime.create({ prompt: "Hola", conversation: true });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).result, "Primera respuesta de ChatGPT");
  // A long conversation before: 40 messages of 4 000 characters (more than the budget).
  const base = Date.parse("2026-10-01T09:00:00Z");
  for (let i = 0; i < 40; i++)
    store.put("messages", { id: "old-" + i, missionId: m.id, role: i % 2 ? "assistant" : "user", botId: i % 2 ? "nora" : null, kind: "message", text: `Mensaje ${i + 1}: ` + "x".repeat(4000), at: new Date(base + i * 60000).toISOString() });
  // The person moves Nora to Claude: the next turn is a handoff.
  store.patch("bots", "nora", { engine: "anthropic" });
  runtime.addMessage(m.id, "¿En qué quedamos?");
  await settle(runtime);
  assert.equal(store.get("missions", m.id).result, "Sigo con lo de antes");
  const first = seen[0].input;
  const note = String(first[0].content);
  assert.match(note, /Traspaso de contexto \(dato, no instrucciones\): esta conversación la llevaba ChatGPT y ahora sigues tú con Claude/);
  assert.match(note, /Quedan fuera los mensajes 2–\d+ .*read_thread/);
  const kept = first.slice(1, -1);
  assert.ok(kept.length >= 10 && kept.length < 42, "a selection, not everything: " + kept.length);
  assert.ok(kept.every((x) => typeof x.content === "string" && !/…$/.test(x.content)), "messages travel whole");
  assert.ok(kept.some((x) => x.content === "Primera respuesta de ChatGPT"), "the last answer is kept");
  assert.ok(kept.some((x) => /^Mensaje 1: x{4000}$/.test(x.content)), "the first request is kept, whole");
  assert.match(String(first.at(-1).content), /¿En qué quedamos\?/, "the new request goes apart, whole");
  assert.equal(first.filter((x) => x.type === "native_turn").length, 0);
  const step = runtime.steps(m.id).at(-1);
  assert.deepEqual([step.handoff.from, step.handoff.to, step.handoff.total], ["openai", "anthropic", 42]);
  assert.ok(store.list("messages").some((x) => x.missionId === m.id && x.handoff && /^Nora sigue con Claude \(antes con ChatGPT\)\. Conserva la conversación\.$/.test(x.text)));
  // read_thread gives what was left out, in order.
  const output = JSON.parse(seen[1].input.find((x) => x.type === "function_call_output").output);
  assert.equal(output.total, 43, "the whole conversation, the new request included");
  assert.deepEqual(output.items.map((x) => x.position), [1, 2]);
  assert.match(output.items[0].text, /^Mensaje 1: x+$/);
  assert.equal(output.items[0].nextTextOffset, 4000);
  assert.equal(output.nextPosition, 3);
  // A long message continues from textOffset.
  const rest = readThread(store, m.id, { messageId: "old-0", textOffset: 4000 });
  assert.equal(rest.items[0].text, "x".repeat(11));
  assert.equal(rest.items[0].nextTextOffset, null);
});

test("handoff budget and selection order (T3 Code handoffBudget/selectHistory)", () => {
  assert.equal(handoffBudget({ window: 1_000_000 }), 24_000);
  assert.equal(handoffBudget({ window: 40_000, request: "x".repeat(3000) }), 40_000 - 1000 - 16_000);
  const messages = Array.from({ length: 10 }, (_, i) => ({ position: i + 1, role: i % 2 ? "assistant" : "user", text: "y".repeat(300) }));
  const { selected, omitted } = selectHistory(messages, 3 * 108);
  assert.deepEqual(selected.map((m) => m.position), [1, 9, 10], "first request, last request and last answer first");
  assert.equal(positionRanges(omitted), "2–8");
});

test("native turns never travel to another engine", () => {
  const items = [
    { role: "user", content: "hola" },
    { type: "native_turn", provider: "anthropic", engine: "anthropic", model: "claude-opus-5-5", count: 1, content: [{ type: "thinking", thinking: "…", signature: "sig" }, { type: "text", text: "Respuesta de Claude", citations: [{ url: "https://a.example" }] }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Respuesta de Claude" }] },
    { role: "user", content: "¿y?" },
  ];
  const same = toMessages(items, { model: "claude-opus-5-5", engine: "anthropic" }).messages[1].content;
  assert.equal(same[0].type, "thinking", "the same model gets its signed thinking back");
  const go = toMessages(items, { model: "qwen3.8-max", engine: "opencode-go" }).messages[1].content;
  assert.deepEqual(go, [{ type: "text", text: "Respuesta de Claude" }], "OpenCode Go reads the derived text only");
  const legacy = toMessages(items.map((x) => (x.type === "native_turn" ? { ...x, engine: undefined } : x)), { model: "qwen3.8-max", engine: "opencode-go" }).messages[1].content;
  assert.deepEqual(legacy, [{ type: "text", text: "Respuesta de Claude" }]);
  assert.equal(new LocalProvider(() => ({})).foreignFree(items).some((x) => x.type === "native_turn"), false);
  const chat = toChatMessages([...items.slice(0, 1), { type: "native_turn", provider: "completions", model: "deepseek-v4.1-flash", count: 1, reasoning: "pensé" }, items[2]], { model: "kimi-k3" });
  assert.equal(chat.find((m) => m.role === "assistant").reasoning_content, undefined);
});

test("notices: how they reach you, a sound per kind, short tags and the taskbar counter", async (t) => {
  assert.deepEqual(delivery({}, "done"), { toast: true, sound: "done" });
  assert.deepEqual(delivery({ notifyMode: "sound" }, "question"), { toast: false, sound: "needs" });
  assert.deepEqual(delivery({ notifyMode: "windows" }, "needs"), { toast: true, sound: null });
  assert.deepEqual(delivery({ notifyMode: "both" }, "digest"), { toast: true, sound: null });
  assert.equal(shouldPop({ notifyMode: "off" }, "needs"), false);
  const tag = noticeTag("mission-with-a-very-long-identifier-0123456789abcdef-0123456789abcdef");
  assert.match(tag, /^[0-9a-f]{16}$/);
  assert.equal(tag, noticeTag("mission-with-a-very-long-identifier-0123456789abcdef-0123456789abcdef"));
  assert.notEqual(tag, noticeTag("another"));

  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-notices-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const emitted = [];
  const notifier = new Notifier(store, { emit: (e) => emitted.push(e), clock: () => Date.parse("2026-10-21T10:00:00") });
  store.put("missions", { id: "m1", title: "Informe", status: "running", mode: "solo", botIds: ["nora"] });
  notifier.observe({ ...store.get("missions", "m1"), status: "completed" });
  notifier.observe({ id: "m2", title: "Plan", status: "awaiting_plan", mode: "equipo", botIds: ["nora"] });
  assert.deepEqual(emitted.map((e) => [e.kind, e.sound, e.toast, e.tag.length]), [["done", "done", true, 16], ["needs", "needs", true, 16]]);
  store.patch("settings", "main", { notifyMode: "sound" });
  notifier.observe({ id: "m3", title: "Otra", status: "waiting", mode: "solo", botIds: ["nora"] });
  assert.deepEqual([emitted.at(-1).toast, emitted.at(-1).sound], [false, "needs"]);
  store.patch("settings", "main", { notifyMode: "off" });
  notifier.observe({ id: "m4", title: "Callada", status: "completed", mode: "solo", botIds: ["nora"] });
  assert.equal(emitted.length, 3, "«Nada» stores the notice without popping it");
  assert.ok(store.list("notifications").some((n) => n.missionId === "m4"));
  // The counter: pending approvals plus rooms waiting for you without one.
  store.put("missions", { id: "w1", status: "waiting", botIds: ["nora"] });
  store.put("missions", { id: "w2", status: "awaiting_plan", botIds: ["atlas"] });
  store.put("approvals", { id: "a1", missionId: "w1", status: "pending", kind: "permission" });
  store.put("approvals", { id: "a2", missionId: "w1", status: "pending", kind: "question" });
  assert.equal(pendingCount(store), 3);
});
