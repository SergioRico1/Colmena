import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../server/provider.mjs";
const message = {
  type: "message",
  id: "m1",
  role: "assistant",
  content: [{ type: "output_text", text: "Respuesta" }],
};
const frame = (x) => "data: " + JSON.stringify(x) + "\n\n";
const request = {
  model: "fixture",
  input: [{ role: "user", content: "hola" }],
  instructions: "Test",
  signal: AbortSignal.timeout(3000),
};
const provider = (events) =>
  new OpenAIProvider(
    { accessToken: async () => "TEST_ONLY" },
    { fetchImpl: async () => new Response(events.map(frame).join("")) },
  );
test("SSE requires final response before returning executable tools", async () => {
  const p = provider([
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        call_id: "c1",
        name: "write_file",
        arguments: "{}",
      },
    },
  ]);
  await assert.rejects(p.respond(request), /confirmacion final/);
});
test("SSE accepts complete confirmed message", async () => {
  const p = provider([
    { type: "response.output_text.delta", delta: "Respuesta" },
    { type: "response.output_item.done", output_index: 0, item: message },
    {
      type: "response.completed",
      response: { id: "r1", status: "completed", output: [message] },
    },
  ]);
  const deltas = [];
  assert.equal(
    (await p.respond({ ...request, onDelta: (d) => deltas.push(d) })).text,
    "Respuesta",
  );
  assert.equal(deltas.join(""), "Respuesta");
});
test("SSE preserves completed items omitted from final aggregate", async () => {
  const p = provider([
    { type: "response.output_item.done", output_index: 0, item: message },
    {
      type: "response.completed",
      response: { id: "r1", status: "completed", output: [] },
    },
  ]);
  assert.equal((await p.respond(request)).text, "Respuesta");
});
test("SSE rejects conflicting tools and mixed response IDs", async () => {
  const tool = {
    type: "function_call",
    id: "t1",
    call_id: "c1",
    name: "read_file",
    arguments: "{}",
  };
  await assert.rejects(
    provider([
      { type: "response.output_item.done", output_index: 0, item: tool },
      {
        type: "response.completed",
        response: {
          id: "r1",
          status: "completed",
          output: [{ ...tool, name: "write_file" }],
        },
      },
    ]).respond(request),
    /contradictoria/,
  );
  await assert.rejects(
    provider([
      { type: "response.created", response: { id: "a" } },
      {
        type: "response.completed",
        response: { id: "b", status: "completed", output: [] },
      },
    ]).respond(request),
    /distintas/,
  );
});
test("usage limit does not retry or switch to API billing", async () => {
  let count = 0;
  const p = new OpenAIProvider(
    { accessToken: async () => "TEST_ONLY" },
    {
      fetchImpl: async () => {
        count++;
        return new Response("", { status: 429 });
      },
    },
  );
  await assert.rejects(p.respond(request), /limite/);
  assert.equal(count, 1);
});

import { ProviderHub, normalizeLocalUrl } from "../server/provider.mjs";
import { Store } from "../server/store.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const completed = [
  { type: "response.output_item.done", output_index: 0, item: message },
  { type: "response.completed", response: { id: "r1", status: "completed", output: [message], usage: { input_tokens: 3, output_tokens: 2 } } },
];
test("reasoning effort is sent when supported and retried once without it on 400", async () => {
  const bodies = [];
  const p = new OpenAIProvider(
    { accessToken: async () => "TEST_ONLY", models: [{ slug: "fixture", reasoning_efforts: ["low", "medium", "high"] }] },
    { fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? new Response("", { status: 400 }) : new Response(completed.map(frame).join(""));
    } },
  );
  const result = await p.respond({ ...request, reasoning: { effort: "high" } });
  assert.equal(result.text, "Respuesta");
  assert.deepEqual(result.usage, { input_tokens: 3, output_tokens: 2 });
  assert.deepEqual(bodies[0].reasoning, { effort: "high" });
  assert.equal(bodies[1].reasoning, undefined);
  assert.equal(bodies.length, 2);
  const unsupported = [];
  await new OpenAIProvider(
    { accessToken: async () => "T", models: [{ slug: "fixture", reasoning_efforts: [] }] },
    { fetchImpl: async (_u, init) => { unsupported.push(JSON.parse(init.body)); return new Response(completed.map(frame).join("")); } },
  ).respond({ ...request, reasoning: { effort: "low" } });
  assert.equal(unsupported[0].reasoning, undefined);
});

test("ProviderHub: API key in the vault, loopback-only local model, status and clear", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-hub-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const saved = new Map(), calls = [];
  const vault = {
    load: async (b) => saved.get(b.profile) || null,
    save: async (b, c) => saved.set(b.profile, c),
    remove: async (profile) => saved.delete(profile),
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization, body: init.body && JSON.parse(init.body) });
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "gpt-5" }, { id: "text-embedding-3" }] });
    return new Response(completed.map(frame).join(""));
  };
  const hub = new ProviderHub({ session: { status: () => null, models: [] }, store, vault, fetchImpl });
  assert.deepEqual(hub.status(), { kind: null, label: "Sin conectar", connected: false });
  await assert.rejects(hub.setApiKey("not-a-key"), /formato/);
  await hub.setApiKey("sk-test_0123456789abcdefghijkl");
  assert.equal(saved.get("openai-apikey").key, "sk-test_0123456789abcdefghijkl");
  assert.doesNotMatch(JSON.stringify(store.list("providers")), /0123456789abcdef/);
  assert.deepEqual(hub.status(), { kind: "apikey", label: "Clave de OpenAI ····ijkl", connected: true });
  assert.deepEqual(await hub.models(), [{ slug: "gpt-5", label: "gpt-5" }]);
  await hub.respond({ ...request, model: "gpt-5", reasoning: { effort: "medium" } });
  assert.equal(calls.at(-1).url, "https://api.openai.com/v1/responses");
  assert.equal(calls.at(-1).auth, "Bearer sk-test_0123456789abcdefghijkl");
  assert.deepEqual(calls.at(-1).body.reasoning, { effort: "medium" });

  assert.throws(() => hub.setLocal({ baseUrl: "http://192.168.1.5:11434", model: "llama3" }), /127\.0\.0\.1/);
  assert.throws(() => hub.setLocal({ baseUrl: "https://localhost:11434", model: "llama3" }), /127\.0\.0\.1/);
  assert.equal(normalizeLocalUrl("http://localhost:11434/v1/"), "http://localhost:11434");
  hub.setLocal({ baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1:8b" });
  assert.equal(hub.status().kind, "local");
  await hub.respond({ ...request, model: "gpt-5", reasoning: { effort: "high" } });
  assert.equal(calls.at(-1).url, "http://127.0.0.1:11434/v1/responses");
  assert.equal(calls.at(-1).body.model, "llama3.1:8b");
  assert.equal(calls.at(-1).body.reasoning, undefined);
  assert.equal(calls.at(-1).auth, undefined);

  await hub.clear("local");
  assert.equal(hub.status().kind, "apikey");
  await hub.clear("apikey");
  assert.equal(saved.size, 0);
  assert.equal(hub.status().kind, null);
});
