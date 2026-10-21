import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { ProviderHub } from "../server/provider.mjs";
import { chooseModel } from "../server/models.mjs";
import { cheapestModel } from "../server/checkins.mjs";
import { AnthropicProvider, validateSetupToken, CLAUDE_CODE_VERSION } from "../server/providers/anthropic.mjs";
import { toMessages, fromMessage } from "../server/providers/anthropic-items.mjs";
import { CompletionsProvider, toChatMessages } from "../server/providers/completions.mjs";
import { ClaudeCliProvider, probeClaudeCli, transcriptOf } from "../server/providers/claude-cli.mjs";

const ev = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const anthropicStream = (blocks, { stop = "end_turn", usage = { input_tokens: 10, output_tokens: 5 } } = {}) => {
  const events = [{ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage } }];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
    } else if (b.type === "thinking") {
      events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking } });
      events.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: b.signature } });
    } else if (b.type === "tool_use") {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: usage.output_tokens } });
  events.push({ type: "message_stop" });
  return new Response(events.map(ev).join(""), { headers: { "content-type": "text/event-stream" } });
};
const capture = (respond) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: init.body ? JSON.parse(init.body) : null });
    return respond(calls.at(-1), calls.length);
  };
  return { calls, fetchImpl };
};
const readFile = { type: "function", name: "read_file", description: "Lee", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("Claude: tools, images, effort and thinking go out as Messages; the round comes back as Colmena items", async () => {
  const { calls, fetchImpl } = capture(() => anthropicStream([{ type: "thinking", thinking: "pienso", signature: "SIG1" }, { type: "text", text: "Lo leo." }, { type: "tool_use", id: "toolu_9", name: "read_file", input: { path: "b.txt" } }], { stop: "tool_use" }));
  const p = new AnthropicProvider({ credential: async () => ({ type: "api_key", key: "sk-ant-api03-TEST_ONLY" }), fetchImpl });
  const history = [
    { role: "user", content: "Lee a.txt" },
    { type: "reasoning", id: "rs_1", encrypted_content: "openai-only" },
    { type: "function_call", call_id: "call_1|fc_1", name: "read_file", arguments: "{\"path\":\"a.txt\"}" },
    { type: "function_call_output", call_id: "call_1|fc_1", output: [{ type: "input_text", text: "{\"ok\":true}" }, { type: "input_image", image_url: PNG }] },
    { role: "user", content: "[Colmena] Sigue." },
  ];
  const deltas = [];
  const r = await p.respond({ model: "anthropic/claude-opus-5-5", instructions: "Eres Atlas.", input: history, tools: [readFile], reasoning: { effort: "high" }, onDelta: (d) => deltas.push(d) });
  const { url, headers, body } = calls[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(headers["x-api-key"], "sk-ant-api03-TEST_ONLY");
  assert.equal(headers.authorization, undefined);
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } });
  assert.match(headers["anthropic-beta"], /thinking-binding-controls-2026-08-01/);
  assert.deepEqual(body.output_config, { effort: "high" });
  assert.equal(body.tools[0].name, "read_file");
  assert.equal(body.tools[0].strict, undefined, "Colmena validates arguments itself");
  assert.deepEqual(body.system.at(-1), { type: "text", text: "Eres Atlas.", cache_control: { type: "ephemeral" } });
  // OpenAI reasoning is dropped; the call id is made valid on both sides; tool_result comes first.
  assert.deepEqual(body.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(body.messages[1].content, [{ type: "tool_use", id: "call_1_fc_1", name: "read_file", input: { path: "a.txt" } }]);
  const [result, nudge] = body.messages[2].content;
  assert.equal(result.type, "tool_result");
  assert.equal(result.tool_use_id, "call_1_fc_1");
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].source.media_type, "image/png");
  assert.deepEqual(nudge, { type: "text", text: "[Colmena] Sigue." });
  // Output: native turn (signed thinking kept), then what the runtime reads.
  assert.deepEqual(r.output.map((x) => x.type), ["native_turn", "message", "function_call"]);
  assert.equal(r.output[0].content[0].signature, "SIG1");
  assert.deepEqual(r.output[2], { type: "function_call", call_id: "toolu_9", name: "read_file", arguments: "{\"path\":\"b.txt\"}", status: "completed" });
  assert.equal(r.text, "Lo leo.");
  assert.deepEqual(deltas, ["Lo leo."]);
  assert.equal(r.model, "anthropic/claude-opus-5-5");
  assert.equal(r.usage.total_tokens, 15);
});

test("Claude: signed thinking is replayed only to the model that wrote it", () => {
  const round = fromMessage({ content: [{ type: "thinking", thinking: "t", signature: "S" }, { type: "text", text: "Hecho" }, { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "x" } }] }, { model: "claude-opus-5-5" });
  const history = [{ role: "user", content: "hola" }, ...round, { type: "function_call_output", call_id: "toolu_1", output: "ok" }];
  const same = toMessages(history, { model: "claude-opus-5-5" }).messages;
  assert.deepEqual(same[1].content.map((b) => b.type), ["thinking", "text", "tool_use"], "native blocks once, derived copies skipped");
  const other = toMessages(history, { model: "claude-sonnet-5-5" }).messages;
  assert.deepEqual(other[1].content.map((b) => b.type), ["text", "tool_use"]);
  // A cut round (tool call without its output) is answered so the API accepts it.
  const cut = toMessages([{ role: "user", content: "x" }, { type: "function_call", call_id: "c9", name: "read_file", arguments: "{}" }], { model: "m" }).messages;
  assert.equal(cut.at(-1).content[0].type, "tool_result");
  assert.equal(cut.at(-1).content[0].is_error, true);
});

test("Claude subscription token: Bearer plus the Claude Code identity, as OpenClaw sends it", async () => {
  assert.match(validateSetupToken("sk-ant-api03-x").error, /sk-ant-oat01-/);
  assert.match(validateSetupToken("sk-ant-oat01-short").error, /incompleto/);
  const token = "sk-ant-oat01-" + "a".repeat(80);
  assert.equal(validateSetupToken(" " + token.slice(0, 40) + "\n" + token.slice(40) + " ").token, token);
  const { calls, fetchImpl } = capture(() => anthropicStream([{ type: "tool_use", id: "toolu_2", name: "Read", input: { path: "a" } }], { stop: "tool_use" }));
  const p = new AnthropicProvider({ credential: async () => ({ type: "token", token }), fetchImpl });
  const tools = [{ ...readFile, name: "read" }];
  const r = await p.respond({ model: "anthropic/claude-sonnet-5-5", instructions: "Colmena", input: "hola", tools });
  const { headers, body } = calls[0];
  assert.equal(headers.authorization, "Bearer " + token);
  assert.equal(headers["x-api-key"], undefined);
  assert.equal(headers["anthropic-beta"], "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14");
  assert.equal(headers["x-app"], "cli");
  assert.equal(headers["user-agent"], "claude-cli/" + CLAUDE_CODE_VERSION);
  assert.equal(body.system[0].text, `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}; cc_entrypoint=sdk-cli;`);
  assert.equal(body.system[1].text, "You are Claude Code, Anthropic's official CLI for Claude.");
  assert.equal(body.system[2].text, "Colmena");
  assert.equal(body.thinking.block_binding, undefined, "binding controls are API-key only");
  assert.equal(body.tools[0].name, "Read", "Claude Code tool casing on the wire");
  assert.equal(r.output.find((x) => x.type === "function_call").name, "read", "and Colmena's name back");
});

test("Claude: a stale thinking signature is retried once without thinking; a refusal is not retried", async () => {
  let n = 0;
  const { calls, fetchImpl } = capture(() => (++n === 1 ? Response.json({ type: "error", error: { type: "invalid_request_error", message: "messages.1.content.0: Invalid `signature` in `thinking` block." } }, { status: 400 }) : anthropicStream([{ type: "text", text: "ok" }])));
  const p = new AnthropicProvider({ credential: async () => ({ type: "api_key", key: "sk-ant-api03-T" }), fetchImpl });
  const history = [{ role: "user", content: "a" }, ...fromMessage({ content: [{ type: "thinking", thinking: "t", signature: "S" }, { type: "text", text: "b" }] }, { model: "claude-opus-5-5" }), { role: "user", content: "c" }];
  const r = await p.respond({ model: "anthropic/claude-opus-5-5", input: history });
  assert.equal(r.text, "ok");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.messages[1].content[0].type, "thinking");
  assert.equal(calls[1].body.messages[1].content[0].type, "text");
  const refusing = new AnthropicProvider({ credential: async () => ({ type: "api_key", key: "sk-ant-api03-T" }), fetchImpl: async () => anthropicStream([], { stop: "refusal" }) });
  await assert.rejects(refusing.respond({ model: "anthropic/claude-opus-5-5", input: "x" }), /declinado/);
  const limited = new AnthropicProvider({ credential: async () => ({ type: "api_key", key: "sk-ant-api03-T" }), fetchImpl: async () => Response.json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { status: 429 }) });
  await assert.rejects(limited.respond({ model: "anthropic/claude-opus-5-5", input: "x" }), (e) => e.status === 429 && /límite/.test(e.message));
});

test("OpenCode Go Chat Completions: tool calls and outputs, DeepSeek reasoning replayed, streamed calls assembled", async () => {
  const history = [
    { role: "user", content: [{ type: "input_text", text: "mira" }, { type: "input_image", image_url: PNG }] },
    { type: "native_turn", provider: "completions", model: "deepseek-v4-pro", count: 1, reasoning: "razono" },
    { type: "function_call", call_id: "c1", name: "read_file", arguments: "{\"path\":\"a\"}" },
    { type: "function_call_output", call_id: "c1", output: "contenido" },
  ];
  const msgs = toChatMessages(history, { instructions: "Sys", model: "deepseek-v4-pro", vision: false });
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[1].content, /no puede ver imágenes/);
  assert.deepEqual(msgs[2], { role: "assistant", content: null, reasoning_content: "razono", tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a\"}" } }] });
  assert.deepEqual(msgs[3], { role: "tool", tool_call_id: "c1", content: "contenido" });
  assert.equal(toChatMessages(history, { model: "kimi-k3" })[2].reasoning_content, undefined, "another model never gets it");

  const chunks = [
    { id: "x1", choices: [{ index: 0, delta: { reasoning_content: "pien" } }] },
    { id: "x1", choices: [{ index: 0, delta: { content: "Busco." } }] },
    { id: "x1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "read_", arguments: "{\"pa" } }] } }] },
    { id: "x1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "file", arguments: "th\":\"b\"}" } }] } }] },
    { id: "x1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    { id: "x1", choices: [], usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38, prompt_tokens_details: { cached_tokens: 12 } } },
  ];
  const { calls, fetchImpl } = capture(() => new Response(chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + "data: [DONE]\n\n"));
  const p = new CompletionsProvider({ loadKey: async () => "go-TEST_ONLY_KEY", fetchImpl, baseUrl: "https://opencode.ai/zen/go/v1" });
  const r = await p.respond({ model: "opencode-go/deepseek-v4-pro", instructions: "Sys", input: history, tools: [readFile], reasoning: { effort: "low" }, cacheKey: "colmena-bot-mision" });
  assert.equal(calls[0].headers["x-opencode-session"], "colmena-bot-mision", "OpenCode refuses requests without their conversation id");
  assert.equal(calls[0].url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer go-TEST_ONLY_KEY");
  assert.deepEqual(calls[0].body.thinking, { type: "enabled" });
  assert.equal(calls[0].body.reasoning_effort, "high");
  assert.ok(calls[0].body.messages.filter((m) => m.role === "assistant").every((m) => "reasoning_content" in m), "DeepSeek gets reasoning_content on every assistant turn");
  assert.equal(calls[0].body.tools[0].function.name, "read_file");
  assert.deepEqual(r.output.map((x) => x.type), ["native_turn", "message", "function_call"]);
  assert.equal(r.output[0].reasoning, "pien");
  assert.deepEqual(r.output[2], { type: "function_call", call_id: "call_a", name: "read_file", arguments: "{\"path\":\"b\"}", status: "completed" });
  assert.equal(r.usage.input_tokens_details.cached_tokens, 12);
  const kimi = capture(() => new Response("data: " + JSON.stringify({ choices: [{ delta: { content: "hola" }, finish_reason: "stop" }] }) + "\n\n"));
  await new CompletionsProvider({ loadKey: async () => "k".repeat(20), fetchImpl: kimi.fetchImpl, baseUrl: "https://x/v1" }).respond({ model: "opencode-go/kimi-k2.6", input: history, reasoning: { effort: "high" } });
  assert.equal(kimi.calls[0].body.reasoning_effort, undefined, "Kimi K2 without reasoning (OpenClaw)");
  assert.ok(kimi.calls[0].body.messages.every((m) => !("reasoning_content" in m)));
});

async function hubFor(t, fetchImpl, { session = { status: () => null, models: [] } } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-engines-"));
  const store = new Store(directory);
  const saved = new Map();
  const vault = { load: async (b) => saved.get(b.profile) || null, save: async (b, c) => saved.set(b.profile, c), remove: async (p) => saved.delete(p) };
  const hub = new ProviderHub({ session, store, vault, fetchImpl });
  t.after(async () => { hub.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { hub, store, saved };
}

test("ProviderHub: Claude and OpenCode keys live in the vault; each bot thinks with its engine's family", async (t) => {
  const { calls, fetchImpl } = capture((c) => {
    if (c.url === "https://opencode.ai/zen/go/v1/models") return Response.json({ data: [{ id: "kimi-k3" }] });
    if (c.url.endsWith("/v1/models") && c.headers["x-api-key"] === "sk-ant-api03-GOOD_KEY_0123456789") return Response.json({ data: [] });
    if (c.url.endsWith("/v1/models")) return new Response("", { status: 401 });
    if (c.url.endsWith("/chat/completions")) return new Response("data: " + JSON.stringify({ choices: [{ delta: { content: "go" }, finish_reason: "stop" }] }) + "\n\n");
    return anthropicStream([{ type: "text", text: "claude" }]);
  });
  const { hub, store, saved } = await hubFor(t, fetchImpl);
  assert.equal(hub.primary, null);
  await assert.rejects(hub.connectAnthropic({ method: "api_key", secret: "sk-ant-api03-BAD_KEY_0123456789" }), /no acepta/);
  await hub.connectAnthropic({ method: "api_key", secret: "sk-ant-api03-GOOD_KEY_0123456789" });
  assert.equal(saved.get("anthropic-apikey").key, "sk-ant-api03-GOOD_KEY_0123456789");
  assert.doesNotMatch(JSON.stringify(store.list("providers")), /GOOD_KEY/);
  assert.equal(hub.primary, "anthropic");
  assert.deepEqual(hub.status(), { kind: "anthropic", label: "Claude · Clave de API ····6789", connected: true });

  const claude = hub.modelsFor("anthropic");
  assert.equal(chooseModel({ id: "atlas", role: "Coordina el equipo" }, claude).slug, "anthropic/claude-opus-5-5");
  assert.equal(chooseModel({ id: "vera", role: "Redacta" }, claude).slug, "anthropic/claude-sonnet-5-5");
  assert.equal(chooseModel({ id: "bruno", role: "Programa" }, claude).label, "Claude Opus 5.5");
  assert.equal(cheapestModel(claude), "anthropic/claude-haiku-5-5");

  assert.equal((await hub.respond({ model: "anthropic/claude-opus-5-5", input: "hola" })).text, "claude");
  // An old bare ChatGPT slug (settings.model) with no OpenAI account goes to the team engine.
  assert.equal(hub.resolveModel("gpt-6-luna"), "anthropic/claude-sonnet-5-5");

  await hub.connectOpenCode({ key: "oc-TEST_ONLY_KEY_123456" });
  assert.equal(saved.get("opencode-apikey").key, "oc-TEST_ONLY_KEY_123456");
  assert.equal(hub.engineFor({ engine: "opencode-go" }), "opencode-go");
  assert.equal(hub.engineFor({ engine: "openai" }), "anthropic", "not connected: the team's engine");
  // The key is checked with a one-token answer (the Go model list is public).
  const check = calls.find((c) => c.url === "https://opencode.ai/zen/go/v1/chat/completions" && c.body?.max_tokens === 1);
  assert.equal(check.body.model, "deepseek-v4.1-flash");
  assert.equal(check.headers.authorization, "Bearer oc-TEST_ONLY_KEY_123456");
  assert.match(check.headers["x-opencode-session"], /^colmena-/);
  // Every family thinks with DeepSeek V4.1 Flash; Muse Spark 1.3 is there to pin.
  for (const bot of [{ id: "atlas" }, { id: "vera", role: "Redacta" }, { id: "bruno", role: "Programa" }]) assert.equal(chooseModel(bot, hub.modelsFor("opencode-go")).slug, "opencode-go/deepseek-v4.1-flash");
  assert.equal(cheapestModel(hub.modelsFor("opencode-go")), "opencode-go/deepseek-v4.1-flash");
  assert.equal((await hub.respond({ model: "opencode-go/deepseek-v4.1-flash", input: "hola" })).text, "go");
  assert.equal(calls.at(-1).url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(hub.providerFor("opencode-go/muse-spark-1.3-contributor"), hub.goResponses, "Muse Spark speaks Responses");
  assert.deepEqual(hub.goResponses.requestHeaders({ cacheKey: "k9" }), { "x-opencode-session": "k9" });
  hub.setEngines({ pins: { "opencode-go": { sol: "opencode-go/muse-spark-1.3-contributor" } } });
  assert.equal(chooseModel({ id: "bruno", role: "Programa" }, hub.modelsFor("opencode-go")).slug, "opencode-go/muse-spark-1.3-contributor");
  hub.setEngines({ pins: { "opencode-go": {} } });
  // A pin saved before the catalogue changed (a model OpenCode Go no longer has here) is ignored.
  hub.saveConfig({ pins: { ...hub.config().pins, "opencode-go": { luna: "opencode-go/deepseek-v4-flash", sol: "opencode-go/deepseek-v4-flash", astra: "opencode-go/deepseek-v4-flash" } } });
  assert.equal(chooseModel({ id: "atlas" }, hub.modelsFor("opencode-go")).slug, "opencode-go/deepseek-v4.1-flash");
  // A bot on OpenCode Go never falls back to a ChatGPT slug.
  const { Runtime } = await import("../server/runtime.mjs");
  const runtime = new Runtime(store, hub);
  t.after(() => runtime.shutdown());
  assert.equal(runtime.fallbackModel({ engine: "opencode-go" }, "gpt-6.1-sol"), "opencode-go/deepseek-v4.1-flash");
  assert.equal(runtime.modelFor({ id: "atlas", engine: "opencode-go" }, "gpt-6.1-sol"), "opencode-go/deepseek-v4.1-flash");
  hub.saveConfig({ pins: { ...hub.config().pins, "opencode-go": {} } });

  // Pins from Ajustes › Avanzado win their family.
  hub.setEngines({ pins: { anthropic: { luna: "anthropic/claude-haiku-5-5" } } });
  assert.equal(chooseModel({ id: "vera", role: "Redacta" }, hub.modelsFor("anthropic")).slug, "anthropic/claude-haiku-5-5");
  assert.throws(() => hub.setEngines({ primary: "openai" }), /Conecta/);

  // Substitute engine: same family on the other connected engine.
  hub.setEngines({ fallback: "opencode-go" });
  assert.equal(hub.fallbackFor("anthropic/claude-opus-5-5").model, "opencode-go/deepseek-v4.1-flash");
  hub.setEngines({ fallback: "none" });
  assert.equal(hub.fallbackFor("anthropic/claude-opus-5-5"), null);

  await hub.clear("anthropic");
  assert.equal(saved.has("anthropic-apikey"), false);
  assert.equal(hub.primary, "opencode-go");
});

test("ProviderHub: a provider at its limit rests and the call goes to the substitute engine", async (t) => {
  const { calls, fetchImpl } = capture((c) => {
    if (c.url.endsWith("/v1/models")) return Response.json({ data: [] });
    if (c.url.includes("api.anthropic.com")) return Response.json({ type: "error", error: { type: "rate_limit_error", message: "x" } }, { status: 429 });
    return new Response("data: " + JSON.stringify({ choices: [{ delta: { content: "sustituto" }, finish_reason: "stop" }] }) + "\n\n");
  });
  const { hub } = await hubFor(t, fetchImpl);
  await hub.connectAnthropic({ method: "api_key", secret: "sk-ant-api03-GOOD_KEY_0123456789" });
  await hub.connectOpenCode({ key: "oc-TEST_ONLY_KEY_123456" });
  hub.setEngines({ primary: "anthropic", fallback: "opencode-go" });
  const r = await hub.respond({ model: "anthropic/claude-sonnet-5-5", input: "hola" });
  assert.equal(r.text, "sustituto");
  assert.equal(r.model, "opencode-go/deepseek-v4.1-flash", "the same family on the other engine");
  assert.equal(r.fellBack, "OpenCode Go");
  assert.equal(hub.resting("anthropic"), true);
  assert.equal(hub.engines().find((e) => e.id === "anthropic").resting, true);
  await assert.rejects(hub.respond({ model: "anthropic/claude-sonnet-5-5", input: "x", fallback: false }), (e) => e.status === 429 && e.engine === "anthropic");
  assert.ok(calls.some((c) => c.url.endsWith("/chat/completions")));
});

test("Claude Code CLI: an old CLI or an unknown model is said plainly and not retried", async () => {
  const { cliFailure, newerOrEqual } = await import("../server/providers/claude-cli.mjs");
  const old = cliFailure("API Error: 400 Claude Code 2.1.258 does not support this model; version 2.1.280 or newer is required. Run 'claude update'");
  assert.equal(old.status, 426);
  assert.equal(old.transient, undefined);
  assert.match(old.message, /demasiado antiguo .*2\.1\.280.*claude update/);
  assert.equal(cliFailure("Not logged in · Please run /login").status, 401);
  assert.equal(cliFailure("Claude AI usage limit reached").status, 429);
  assert.equal(cliFailure("Overloaded").transient, true);
  assert.equal(newerOrEqual("2.1.304", "2.1.280"), true);
  assert.equal(newerOrEqual("2.1.258", "2.1.280"), false);
  assert.equal(newerOrEqual("2.1.280", "2.1.280"), true);
});

test("Claude Code CLI: Colmena tools over loopback MCP, the call handed to the runtime and the stream continued", async (t) => {
  const fake = fileURLToPath(new URL("./fixtures/fake-claude-cli.mjs", import.meta.url));
  const command = [process.execPath, fake];
  assert.deepEqual(await probeClaudeCli({ command }), { status: "available", authMethod: "claude.ai", email: "persona@example.com" });
  assert.deepEqual(await probeClaudeCli({ command: null }), { status: "not_installed" });
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-cli-"));
  const cli = new ClaudeCliProvider({ directory, command });
  t.after(async () => { cli.close(); await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  const echo = { type: "function", name: "echo", description: "Repite", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } };
  const history = [{ role: "user", content: "usa echo por favor" }];
  const deltas = [];
  const first = await cli.respond({ model: "anthropic/claude-opus-5-5", instructions: "Eres Atlas", input: history, tools: [echo], cacheKey: "k1", onDelta: (d) => deltas.push(d), signal: AbortSignal.timeout(20000) });
  assert.deepEqual(first.output.map((x) => x.type), ["message", "function_call"]);
  const call = first.output[1];
  assert.equal(call.call_id, "toolu_A", "the CLI's tool_use id");
  assert.equal(call.name, "echo");
  assert.deepEqual(JSON.parse(call.arguments), { text: "hola" });
  // The runtime runs the tool and asks again with the output: same process, stream goes on.
  const pid = cli.sessions.get("k1").proc.pid;
  const second = await cli.respond({ model: "anthropic/claude-opus-5-5", instructions: "Eres Atlas", input: [...history, ...first.output, { type: "function_call_output", call_id: "toolu_A", output: "HOLA" }], tools: [echo], cacheKey: "k1", onDelta: (d) => deltas.push(d), signal: AbortSignal.timeout(20000) });
  assert.equal(second.text, "eco: HOLA (echo)");
  assert.equal(cli.sessions.get("k1").proc.pid, pid);
  assert.ok(deltas.includes("eco: HOLA (echo)"));
  assert.ok(second.usage.total_tokens > 0);
  // A new step (different history) starts a fresh process reseeded from the transcript.
  const third = await cli.respond({ model: "anthropic/claude-opus-5-5", instructions: "Eres Atlas", input: [{ role: "user", content: "otra cosa" }, { role: "assistant", content: "vale" }, { role: "user", content: "y ahora" }], tools: [echo], cacheKey: "k1", signal: AbortSignal.timeout(20000) });
  assert.match(third.text, /^ok: Continúa este trabajo/);
  assert.notEqual(cli.sessions.get("k1").proc.pid, pid);
  assert.match(transcriptOf([{ role: "user", content: "a" }, { type: "function_call", name: "x", arguments: "{}" }, { type: "function_call_output", output: "r" }]), /\[Persona\] a[\s\S]*herramienta x[\s\S]*Resultado: r/);
});

test("OpenCode key: spaces, line breaks and invisible characters around it are dropped; errors say what is wrong", async (t) => {
  const { checkOpenCodeKey, cleanSecret } = await import("../server/providers/secret-input.mjs");
  // Same shape as a real key (oc_sk_ + 12 hex + _ + 32 letters and digits); a fake, never a real one.
  const fake = "oc_sk_0123456789ab_" + "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  assert.equal(fake.length, 51);
  assert.deepEqual(checkOpenCodeKey("  " + fake + " \r\n"), { key: fake });
  assert.deepEqual(checkOpenCodeKey(" ​" + fake + "﻿ "), { key: fake });
  assert.equal(cleanSecret("\tabc \n"), "abc");
  assert.match(checkOpenCodeKey(fake.slice(0, 20) + " " + fake.slice(20)).error, /espacio .* en medio \(después del carácter 20\)/);
  assert.match(checkOpenCodeKey(fake.slice(0, 10) + "/" + fake.slice(10)).error, /«\/», en la posición 11/);
  assert.match(checkOpenCodeKey("oc_sk_12").error, /demasiado corta \(8 caracteres\)/);
  assert.match(checkOpenCodeKey("   ").error, /Pega tu clave/);

  // Through the real route, as the UI sends it: the saved and sent key is the clean one.
  const http = (await import("node:http")).default;
  const { createApp } = await import("../server/app.mjs");
  const { Runtime } = await import("../server/runtime.mjs");
  const seen = [];
  const { hub, store, saved } = await hubFor(t, async (url, init = {}) => {
    seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
    return Response.json({ data: [{ id: "kimi-k3" }] });
  });
  const runtime = new Runtime(store, hub);
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await runtime.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const post = (route, body) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const bad = await post("/auth/opencode", { key: fake.slice(0, 20) + " " + fake.slice(20) });
  assert.equal(bad.status >= 400, true);
  assert.match((await bad.json()).error, /en medio/);
  const ok = await post("/auth/opencode", { key: " ​" + fake + "\n" });
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  assert.equal(seen.at(-1).auth, "Bearer " + fake);
  assert.equal(saved.get("opencode-apikey").key, fake);
  assert.equal(hub.connected("opencode-go"), true);
});
