import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { APPROVAL_TTL_MS, approvalRevision, toolCalls } from "../server/state.mjs";

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-api-approvals-")),
    store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls in API tests"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const send = (method) => (route, body = {}) =>
    fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const get = async (route) => (await fetch(origin + "/api" + route)).json();
  return { store, runtime, post: send("POST"), patch: send("PATCH"), get };
}

const mission = (store) =>
  store.put("missions", { id: "m1", title: "Resumen", prompt: "x", mode: "solo", botIds: ["vera"], status: "waiting", createdAt: new Date().toISOString() });
const sendApproval = (store, extra = {}) =>
  store.put("approvals", {
    id: "e1", missionId: "m1", botId: "vera", kind: "send", status: "pending", createdAt: new Date().toISOString(),
    email: { to: ["a@b.es"], cc: [], cco: [], subject: "Hola", body: "Texto", attachments: [] }, ...extra,
  });

test("approval state exposes a revision bound to the reviewed content", async (t) => {
  const { store, get } = await setup(t);
  mission(store);
  const a = sendApproval(store);
  const view = (await get("/state")).approvals.find((x) => x.id === "e1");
  assert.match(view.revision, /^[a-f0-9]{64}$/);
  assert.equal(view.revision, approvalRevision(a));
  assert.ok(view.expiresAt, "sends expire");
  assert.equal(view.external, true);
  // The same content gives the same revision; any change in what is reviewed changes it.
  assert.equal(approvalRevision({ ...a }), view.revision);
  assert.notEqual(approvalRevision({ ...a, email: { ...a.email, to: ["otra@b.es"] } }), view.revision);
  assert.notEqual(approvalRevision({ ...a, account: "cuenta-2" }), view.revision);
  assert.notEqual(approvalRevision({ ...a, args: { command: "rm" } }), approvalRevision({ ...a, args: { command: "ls" } }));
});

test("POST /approvals/:id and /answer require the current revision (409 when it changed)", async (t) => {
  const { store, runtime, post, patch } = await setup(t);
  mission(store);
  sendApproval(store);
  const calls = [];
  runtime.approve = async (...args) => calls.push(["approve", ...args]);
  runtime.answer = async (...args) => calls.push(["answer", ...args]);

  assert.equal((await post("/approvals/e1", { decision: "approved" })).status, 400, "revision is mandatory");
  const stale = approvalRevision(store.get("approvals", "e1"));
  // The bot (or someone) edits the email after the person opened it.
  assert.equal((await patch("/approvals/e1/email", { to: ["dir@b.es"], cc: [], cco: [], subject: "Hola", body: "Otro" })).status, 200);
  const r = await post("/approvals/e1", { decision: "approved", revision: stale });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.error, "El contenido ha cambiado; revísalo de nuevo.");
  assert.equal(body.revision, approvalRevision(store.get("approvals", "e1")));
  assert.equal(calls.length, 0, "nothing decided with stale content");
  assert.equal((await post("/approvals/e1", { decision: "approved", revision: body.revision })).status, 200);
  assert.deepEqual(calls[0].slice(0, 3), ["approve", "e1", "approved"]);

  store.put("approvals", { id: "q1", missionId: "m1", botId: "vera", kind: "question", title: "¿Formato?", summary: "¿Formato?", status: "pending", options: [{ id: "o1", label: "A", primary: true }], createdAt: new Date().toISOString() });
  const q = approvalRevision(store.get("approvals", "q1"));
  assert.equal((await post("/approvals/q1/answer", { optionId: "o1" })).status, 400);
  assert.equal((await post("/approvals/q1/answer", { optionId: "o1", revision: "0".repeat(64) })).status, 409);
  assert.equal((await post("/approvals/q1/answer", { optionId: "o1", revision: q })).status, 200);
  assert.deepEqual(calls[1], ["answer", "q1", { optionId: "o1" }]);
});

test("sends expire after 30 minutes; only denial or «Volver a preparar» remain", async (t) => {
  const { store, runtime, post, get } = await setup(t);
  mission(store);
  sendApproval(store, { createdAt: new Date(Date.now() - APPROVAL_TTL_MS - 60000).toISOString() });
  // Local questions never expire.
  store.put("approvals", { id: "q1", missionId: "m1", botId: "vera", kind: "question", status: "pending", options: [], createdAt: new Date(Date.now() - 5 * 3600000).toISOString() });
  const state = await get("/state");
  const view = state.approvals.find((x) => x.id === "e1");
  assert.equal(view.status, "expired");
  assert.equal(state.approvals.find((x) => x.id === "q1").status, "pending");
  const calls = [];
  runtime.approve = async (...args) => calls.push(args);
  runtime.addMessage = async (missionId, text) => {
    calls.push(["message", missionId, text]);
    return { id: "msg1" };
  };
  const r = await post("/approvals/e1", { decision: "approved", revision: view.revision });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /30 minutos/);
  assert.equal(calls.length, 0);
  const renew = await post("/approvals/e1/renew", { revision: view.revision });
  assert.equal(renew.status, 200);
  assert.deepEqual(calls[0].slice(0, 2), ["e1", "denied"]);
  assert.equal(calls[1][0], "message");
  assert.match(calls[1][2], /Vuelve a preparar/);
  assert.equal(store.get("approvals", "e1").resolution, "Caducó · se pidió de nuevo");
});

test("tool calls of a step become cards with state, from the stored history", () => {
  const step = {
    id: "s1", status: "running",
    history: [
      { type: "function_call", call_id: "c1", name: "web_fetch", arguments: JSON.stringify({ url: "https://www.example.com/a" }) },
      { type: "function_call_output", call_id: "c1", output: JSON.stringify({ title: "Ejemplo", finalUrl: "https://www.example.com/a", text: "Hola ".repeat(200) }) },
      { type: "function_call", call_id: "c2", name: "read_folder_file", arguments: JSON.stringify({ folderId: "f", path: "docs/oferta.pdf", page: 2 }) },
      { type: "function_call_output", call_id: "c2", output: JSON.stringify({ name: "oferta.pdf", page: 2, pages: 14, content: "…" }) },
      { type: "function_call", call_id: "c3", name: "ask_bot", arguments: JSON.stringify({ botId: "tomas", question: "¿Cuadran las cifras?" }) },
      { type: "function_call_output", call_id: "c3", output: JSON.stringify({ error: "Tomás no está disponible." }) },
    ],
    pending: [{ type: "function_call", call_id: "c4", name: "apps_execute", arguments: JSON.stringify({ tool: "GMAIL_SEND_EMAIL", account: "acc", arguments_json: "{}" }) }],
  };
  const cards = toolCalls(step, { bots: new Map([["tomas", { name: "Tomás" }]]) });
  assert.deepEqual(cards.map((c) => [c.name, c.status]), [["web_fetch", "done"], ["read_folder_file", "done"], ["ask_bot", "error"], ["apps_execute", "running"]]);
  assert.equal(cards[0].card.domain, "example.com");
  assert.equal(cards[0].card.title, "Ejemplo");
  assert.ok(cards[0].card.excerpt.length <= 260);
  assert.deepEqual([cards[1].card.name, cards[1].card.page, cards[1].card.pages], ["oferta.pdf", 2, 14]);
  assert.equal(cards[2].card.botName, "Tomás");
  assert.equal(cards[2].error, "Tomás no está disponible.");
  assert.deepEqual([cards[3].card.app, cards[3].card.action], ["Gmail", "enviar correo"]);
});
