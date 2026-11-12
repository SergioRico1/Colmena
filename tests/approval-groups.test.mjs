import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { approvalGroup } from "../server/approval-groups.mjs";
import { groupApprovals, groupable, groupTitle, groupLine, groupShown, batchOutcome, failureText } from "../src/lib/approvalGroups.js";
import { HOLD_MS, CONFIRM_GUARD_MS, HOLD_IDLE, holdNext, holdLabel, needsHold } from "../src/lib/holdApprove.js";

// «Aprobar todas» (several requests of the same kind in one card) and «mantén pulsado» for red
// lines: the pure grouping (src/lib/approvalGroups.js), which approvals the server lets go
// together (server/approval-groups.mjs), POST /api/approvals/batch, and the hold logic.

// ---------------------------------------------------------------- grouping (client, pure)
const g = (key, label = "crear archivos") => ({ key, label });
const view = (id, extra = {}) => ({ id, status: "pending", kind: "write", botId: "nora", missionId: "m1", title: "Crear «" + id + ".md»", summary: "Nora quiere crear el archivo «" + id + ".md» en la misión.", group: g("k-files"), ...extra });

test("neighbours with the same group key fold into one card, in the order given", () => {
  const out = groupApprovals([view("a"), view("b"), view("c")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "group");
  assert.deepEqual(out[0].items.map((a) => a.id), ["a", "b", "c"]);
  assert.equal(out[0].botId, "nora");
  assert.equal(out[0].missionId, "m1");
  assert.equal(groupTitle(out[0], "Nora"), "3 peticiones de Nora: crear archivos");
  assert.equal(groupLine(out[0].items[0], "Nora"), "Crear el archivo «a.md» en la misión");
  // The state lists the newest first: inside the card they read oldest first.
  const newestFirst = groupApprovals([view("c", { createdAt: "2026-11-12T10:00:03Z" }), view("b", { createdAt: "2026-11-12T10:00:02Z" }), view("a", { createdAt: "2026-11-12T10:00:01Z" })]);
  assert.deepEqual(newestFirst[0].items.map((a) => a.id), ["a", "b", "c"]);
  assert.equal(newestFirst[0].id, "grupo:a");
  // One alone is the usual card; an empty list gives nothing.
  assert.deepEqual(groupApprovals([view("a")]).map((e) => e.type), ["one"]);
  assert.deepEqual(groupApprovals([]), []);
});

test("a different tool, bot or mission breaks the run; what comes after starts a new one", () => {
  const cal = g("k-calendar", "crear un evento en Google Calendar");
  const other = g("k-files-tomas");
  const out = groupApprovals([
    view("a"), view("b"),
    view("c", { group: cal }), view("d", { group: cal }), view("e", { group: cal }),
    view("f"), // same key as the first run, but no longer consecutive: alone
    view("g", { botId: "tomas", group: other }), view("h", { botId: "tomas", group: other }),
  ]);
  assert.deepEqual(out.map((e) => (e.type === "group" ? e.items.map((a) => a.id).join("") : e.a.id)), ["ab", "cde", "f", "gh"]);
  assert.equal(groupTitle(out[1], "Nora"), "3 peticiones de Nora: crear un evento en Google Calendar");
  assert.equal(out[3].botId, "tomas");
  // Every approval comes out exactly once, in the same order.
  assert.deepEqual(out.flatMap((e) => (e.type === "group" ? e.items : [e.a])).map((a) => a.id), ["a", "b", "c", "d", "e", "f", "g", "h"]);
});

test("red lines, sends, questions, plans and proposals never share a card, and they break the run", () => {
  const never = [
    view("send", { kind: "send" }), view("red", { redLine: true }), view("q", { kind: "question" }), view("plan", { kind: "plan" }),
    view("skill", { kind: "skill" }), view("soul", { kind: "soul" }), view("revert", { kind: "revert" }), view("secret", { kind: "secret" }),
    view("auto", { autoSendAt: new Date().toISOString() }), view("later", { deferred: true }), view("done", { status: "approved" }),
    view("nogroup", { group: null }),
  ];
  for (const a of never) {
    assert.equal(groupable(a), false, a.id);
    // Even with the same key on both sides, it stays alone and nothing folds across it.
    const out = groupApprovals([view("a"), a, a.id === "red" ? { ...a, id: "red2" } : view("b")]);
    assert.deepEqual(out.map((e) => e.type), ["one", "one", "one"], a.id);
  }
  const mixed = groupApprovals([view("a"), view("b"), view("x", { redLine: true }), view("c"), view("d")]);
  assert.deepEqual(mixed.map((e) => (e.type === "group" ? e.items.length : e.a.id)), [2, "x", 2]);
});

test("what a batch answer means, in the card's words", () => {
  const { done, failed } = batchOutcome([{ id: "a", ok: true }, { id: "b", ok: false, error: "El contenido ha cambiado; revísalo de nuevo." }, { id: "c", ok: false }]);
  assert.deepEqual(done, ["a"]);
  assert.deepEqual([...failed], [["b", "El contenido ha cambiado; revísalo de nuevo."], ["c", "No se pudo completar."]]);
  assert.equal(failureText(0), "");
  assert.equal(failureText(1), "No se pudo aprobar 1. Sigue pendiente.");
  assert.equal(failureText(2, "denied"), "No se pudieron descartar 2. Siguen pendientes.");
  assert.equal(groupTitle({ items: [view("a")], label: "" }, ""), "1 petición de un bot");
  // A line does not repeat what the card's title already says.
  const label = "crear un evento en Google Calendar";
  assert.equal(groupLine({ summary: "Tomás quiere crear un evento en Google Calendar: «Comité», 14 nov." }, "Tomás", label), "«Comité», 14 nov");
  assert.equal(groupLine({ title: "Crear un evento en Google Calendar" }, "Tomás", label), "Crear un evento en Google Calendar");
  // Up to six are listed whole; beyond that, five and «y N más» (never «y 1 más»).
  const many = (n) => Array.from({ length: n }, (_, i) => view("f" + i));
  assert.deepEqual([groupShown(many(6)).shown.length, groupShown(many(6)).more], [6, 0]);
  assert.deepEqual([groupShown(many(9)).shown.length, groupShown(many(9)).more], [5, 4]);
});

// ---------------------------------------------------------------- which ones the server lets go together
const stored = (extra = {}) => ({ id: "s1:c1", missionId: "m1", botId: "nora", stepId: "s1", tool: "write_file", kind: "write", status: "pending", title: "Crear «a.md»", canAlways: true, ...extra });
const event = (extra = {}) => stored({
  tool: "apps_execute", kind: "write", redLine: false, uiKind: "write",
  review: { tool: "GOOGLECALENDAR_CREATE_EVENT", toolkit: "googlecalendar", name: "Crear evento" }, ...extra,
});

test("the server groups only internal writes and non-red-line app actions", () => {
  const files = approvalGroup(stored());
  assert.equal(files.label, "crear archivos");
  assert.equal(files.key, approvalGroup(stored({ id: "s1:c2", title: "Crear «b.md»" })).key, "same mission, bot and tool");
  assert.notEqual(files.key, approvalGroup(stored({ botId: "tomas" })).key);
  assert.notEqual(files.key, approvalGroup(stored({ missionId: "m2" })).key);
  assert.notEqual(files.key, approvalGroup(stored({ tool: "create_document" })).key);
  assert.equal(approvalGroup(stored({ tool: "remember", kind: "memory" })).label, "cambiar la memoria");

  const cal = approvalGroup(event());
  assert.match(cal.label, /^crear .* en Google Calendar$/);
  assert.equal(cal.key, approvalGroup(event({ id: "s1:c9" })).key);
  assert.notEqual(cal.key, approvalGroup(event({ review: { tool: "GOOGLECALENDAR_UPDATE_EVENT", toolkit: "googlecalendar" } })).key, "another action");
  assert.notEqual(cal.key, approvalGroup(event({ review: { tool: "GOOGLECALENDAR_CREATE_EVENT", toolkit: "outlook" } })).key, "another app");

  // Never: red lines, sends, questions, plans, proposals, keys, what waits for later, a send
  // about to leave, computer and project actions, unknown tools, flagged steps, settled ones.
  for (const [why, a, opts] of [
    ["red line", stored({ redLine: true })], ["app red line", event({ redLine: true })], ["send", event({ kind: "send", redLine: true })],
    ["send shown as such", event({ uiKind: "send" })], ["with an email", stored({ email: { to: ["a@b.es"] } })],
    ["question", stored({ tool: "ask_user", kind: "question" })], ["plan", stored({ tool: "propose_plan", kind: "plan" })],
    ["skill", stored({ kind: "skill" })], ["soul", stored({ kind: "soul" })], ["revert", stored({ kind: "revert" })], ["secret", stored({ kind: "secret", secret: { name: "K" } })],
    ["deferred", stored({ deferred: true })], ["auto send", stored({ autoSendAt: new Date().toISOString() })],
    ["computer", stored({ tool: "run_command", kind: "permission", computer: { program: "git" } })], ["project", stored({ tool: "project_run", kind: "permission", project: { name: "web" } })],
    ["external", stored({ external: true })], ["unknown tool", stored({ tool: "mcp_notion_create", kind: "permission" })],
    ["permission kind on a write tool", stored({ kind: "permission" })], ["app without action", event({ review: { toolkit: "googlecalendar" } })],
    ["settled", stored({ status: "approved" })], ["flagged step", stored(), { flagged: true }], ["no mission", stored({ missionId: null })],
  ]) assert.equal(approvalGroup(a, opts), null, why);
});

// ---------------------------------------------------------------- POST /api/approvals/batch
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-approval-groups-")),
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
  const post = (route, body = {}) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const get = async (route) => (await fetch(origin + "/api" + route)).json();
  store.put("missions", { id: "m1", title: "Informe", prompt: "x", mode: "solo", botIds: ["nora"], status: "waiting", createdAt: new Date().toISOString() });
  store.put("steps", { id: "m1:answer", key: "answer", missionId: "m1", botId: "nora", kind: "solo", status: "waiting", deps: [], history: [], pending: [] });
  const file = (n, extra = {}) => store.put("approvals", stored({ id: "m1:answer:c" + n, stepId: "m1:answer", args: { path: n + ".md" }, title: "Crear «" + n + ".md»", summary: "Nora quiere crear el archivo «" + n + ".md» en la misión.", createdAt: new Date(Date.now() - 60000 + n).toISOString(), ...extra }));
  return { store, runtime, post, get, file };
}
const itemsOf = (state, ids) => ids.map((id) => ({ id, revision: state.approvals.find((a) => a.id === id).revision }));

test("the state marks what may go together, and one call approves every request once", async (t) => {
  const { store, runtime, post, get, file } = await setup(t);
  const ids = [1, 2, 3].map((n) => file(n).id);
  store.put("approvals", stored({ id: "m1:answer:red", stepId: "m1:answer", tool: "apps_execute", kind: "send", redLine: true, email: { to: ["a@b.es"], cc: [], cco: [], subject: "Hola", body: "x", attachments: [] }, createdAt: new Date().toISOString() }));
  const state = await get("/state");
  const views = ids.map((id) => state.approvals.find((a) => a.id === id));
  assert.ok(views.every((a) => a.group?.key && a.group.key === views[0].group.key), "the three files share a key");
  assert.equal(views[0].group.label, "crear archivos");
  assert.equal(state.approvals.find((a) => a.id === "m1:answer:red").group, null, "a send has no group");
  // The client folds them exactly as the server marked them.
  const folded = groupApprovals(state.approvals.filter((a) => a.status === "pending").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
  assert.deepEqual(folded.map((e) => (e.type === "group" ? e.items.length : e.a.id)), [3, "m1:answer:red"]);

  const calls = [];
  runtime.approve = async (...args) => { calls.push(args); store.patch("approvals", args[0], { status: args[1] }); };
  const r = await post("/approvals/batch", { decision: "approved", items: itemsOf(state, ids) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, results: ids.map((id) => ({ id, ok: true })) });
  // The same decision as alone, once each, in order, and never «Siempre».
  assert.deepEqual(calls, ids.map((id) => [id, "approved", { always: false }]));
  assert.equal((await post("/approvals/batch", { decision: "approved", always: true, items: itemsOf(state, ids) })).status, 400, "no «Siempre» in a batch");
});

test("one request that fails does not stop the rest, and comes back with its reason", async (t) => {
  const { store, runtime, post, get, file } = await setup(t);
  const ids = [1, 2, 3, 4].map((n) => file(n).id);
  const state = await get("/state");
  const items = itemsOf(state, ids);
  // The second changed after the person saw it; the third fails while it runs.
  store.patch("approvals", ids[1], { title: "Crear «otro.md»", args: { path: "otro.md" } });
  const calls = [];
  runtime.approve = async (id, decision) => {
    calls.push(id);
    if (id === ids[2]) throw Error("No se pudo escribir el archivo.");
    store.patch("approvals", id, { status: decision });
  };
  const r = await post("/approvals/batch", { decision: "approved", items });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.results.map((x) => x.ok), [true, false, false, true]);
  assert.equal(body.results[1].error, "El contenido ha cambiado; revísalo de nuevo.");
  assert.match(body.results[1].revision, /^[a-f0-9]{64}$/, "the new revision comes back");
  assert.equal(body.results[2].error, "No se pudo escribir el archivo.");
  assert.deepEqual(calls, [ids[0], ids[2], ids[3]], "the stale one never ran; the others ran once");
  assert.deepEqual(ids.map((id) => store.get("approvals", id).status), ["approved", "pending", "pending", "approved"]);

  // Again with what remains: the settled ones are reported, not decided twice.
  calls.length = 0;
  const again = await (await post("/approvals/batch", { decision: "denied", reason: "Ya no hace falta", items: itemsOf(await get("/state"), [ids[1]]).concat(items[0]) })).json();
  assert.deepEqual(again.results.map((x) => [x.id, x.ok]), [[ids[1], true], [ids[0], false]]);
  assert.equal(again.results[1].error, "Esta solicitud ya está resuelta.");
  assert.deepEqual(calls, [ids[1]]);
  assert.equal(store.get("approvals", ids[1]).denyReason, "Ya no hace falta");
});

test("a red line, a send or a question in a batch refuses the whole call before anything runs", async (t) => {
  const { store, runtime, post, get, file } = await setup(t);
  const ids = [1, 2].map((n) => file(n).id);
  const red = file(3, { redLine: true }).id;
  const send = store.put("approvals", stored({ id: "m1:answer:send", stepId: "m1:answer", tool: "apps_execute", kind: "send", redLine: true, email: { to: ["a@b.es"], cc: [], cco: [], subject: "Hola", body: "x", attachments: [] }, createdAt: new Date().toISOString() })).id;
  const question = store.put("approvals", { id: "m1:answer:q", missionId: "m1", botId: "nora", stepId: "m1:answer", tool: "ask_user", kind: "question", status: "pending", title: "¿Formato?", summary: "¿Formato?", options: [{ id: "o1", label: "A", primary: true }], createdAt: new Date().toISOString() }).id;
  const other = store.put("approvals", stored({ id: "m1:answer:doc", stepId: "m1:answer", tool: "create_document", title: "Crear el documento «Acta»", createdAt: new Date().toISOString() })).id;
  const calls = [];
  runtime.approve = async (...args) => calls.push(args);
  runtime.answer = async (...args) => calls.push(args);
  const state = await get("/state");
  for (const [extra, message] of [[red, /se decide de una en una/], [send, /se decide de una en una/], [question, /se decide de una en una/], [other, /no son del mismo tipo/]]) {
    for (const decision of ["approved", "denied"]) {
      const r = await post("/approvals/batch", { decision, items: itemsOf(state, [...ids, extra]) });
      assert.equal(r.status, 400, extra + " " + decision);
      assert.match((await r.json()).error, message);
    }
  }
  // Injection phrases read by the step: nothing it proposed goes in one click any more.
  store.patch("steps", "m1:answer", { suspicious: ["ignore previous instructions"] });
  assert.equal((await get("/state")).approvals.find((a) => a.id === ids[0]).group, null);
  assert.equal((await post("/approvals/batch", { decision: "approved", items: itemsOf(state, ids) })).status, 400);
  assert.equal(calls.length, 0, "nothing was decided");
  assert.ok([...ids, red, send, question, other].every((id) => store.get("approvals", id).status === "pending"));
  // Malformed calls.
  assert.equal((await post("/approvals/batch", { decision: "approved", items: [] })).status, 400);
  assert.equal((await post("/approvals/batch", { decision: "approved", items: [{ id: ids[0] }] })).status, 400, "revision is mandatory");
  const twice = itemsOf(state, [ids[0], ids[0]]);
  assert.equal((await post("/approvals/batch", { decision: "approved", items: twice })).status, 400, "no request twice");
});

// ---------------------------------------------------------------- hold to approve
const run = (events, state = HOLD_IDLE) => {
  let fired = 0;
  for (const e of events) {
    const next = holdNext(state, e);
    state = next.state;
    if (next.fire) fired++;
  }
  return { state, fired };
};

test("only sends and red lines ask for the hold", () => {
  assert.equal(needsHold({ kind: "send" }), true);
  assert.equal(needsHold({ kind: "permission", redLine: true }), true);
  assert.equal(needsHold({ kind: "write", redLine: false }), false);
  assert.equal(needsHold({ kind: "permission" }), false);
  assert.equal(needsHold(null), false);
});

test("holding the button for the whole time approves once; letting go early does not", () => {
  // Held until the timer ends, then released.
  let r = run([{ type: "press", via: "pointer", at: 0 }, { type: "complete", at: HOLD_MS }, { type: "release", at: HOLD_MS + 40 }]);
  assert.equal(r.fired, 1);
  assert.equal(r.state.phase, "idle");
  // Released after the time, before the timer told us: still once.
  assert.equal(run([{ type: "press", via: "pointer", at: 0 }, { type: "release", at: HOLD_MS }, { type: "complete", at: HOLD_MS + 5 }]).fired, 1);
  // A click: nothing, only the hint, which goes away by itself.
  r = run([{ type: "press", via: "pointer", at: 0 }, { type: "release", at: 120 }]);
  assert.equal(r.fired, 0);
  assert.equal(r.state.phase, "hint");
  assert.equal(holdLabel(r.state, "Aprobar y enviar"), "Mantén pulsado");
  assert.equal(run([{ type: "timeout" }], r.state).state.phase, "idle");
  // Many quick clicks never add up to an approval.
  const clicks = Array.from({ length: 12 }, (_, i) => [{ type: "press", via: "pointer", at: i * 100 }, { type: "release", at: i * 100 + 60 }]).flat();
  assert.equal(run(clicks).fired, 0);
  // The pointer leaves, focus goes, Escape: the hold is dropped and a late timer does nothing.
  r = run([{ type: "press", via: "pointer", at: 0 }, { type: "cancel", at: 500 }, { type: "complete", at: HOLD_MS }, { type: "release", at: HOLD_MS + 10 }]);
  assert.equal(r.fired, 0);
  assert.equal(r.state.phase, "idle");
  // A timer from an earlier press does not complete a newer one.
  assert.equal(run([{ type: "press", via: "pointer", at: 0 }, { type: "cancel", at: 100 }, { type: "press", via: "pointer", at: 300 }, { type: "complete", at: HOLD_MS }]).fired, 0);
});

test("keyboard: hold Space or Enter, or press, then press «Confirmar»", () => {
  assert.equal(run([{ type: "press", via: "key", at: 0 }, { type: "complete", at: HOLD_MS }, { type: "release", at: HOLD_MS + 30 }]).fired, 1);
  let r = run([{ type: "press", via: "key", at: 0 }, { type: "release", at: 90 }]);
  assert.equal(r.fired, 0);
  assert.equal(r.state.phase, "confirm");
  assert.equal(holdLabel(r.state, "Aprobar"), "Confirmar");
  assert.equal(run([{ type: "press", via: "key", at: 90 + CONFIRM_GUARD_MS }], r.state).fired, 1);
  // «Confirmar» left alone goes back to the button; Escape too.
  assert.equal(run([{ type: "timeout" }], r.state).state.phase, "idle");
  assert.equal(run([{ type: "cancel" }, { type: "press", via: "key", at: 2000 }, { type: "release", at: 2050 }], r.state).fired, 0);
});

test("reduced motion and assistive clicks: two plain steps, and a double click is not two", () => {
  let r = run([{ type: "press", via: "pointer", reduced: true, at: 0 }, { type: "release", at: 50 }]);
  assert.equal(r.fired, 0);
  assert.equal(r.state.phase, "confirm");
  // The second click of a double click lands too soon: ignored.
  assert.equal(run([{ type: "press", via: "pointer", reduced: true, at: 180 }, { type: "release", at: 220 }], r.state).fired, 0);
  r = run([{ type: "press", via: "pointer", reduced: true, at: CONFIRM_GUARD_MS + 10 }], r.state);
  assert.equal(r.fired, 1);
  assert.equal(r.state.phase, "idle");
  // A click with no press (screen reader): the same two steps.
  assert.equal(run([{ type: "click", at: 0 }]).state.phase, "confirm");
  assert.equal(run([{ type: "click", at: 0 }, { type: "click", at: 1000 }]).fired, 1);
  assert.equal(run([{ type: "click", at: 0 }, { type: "click", at: 100 }]).fired, 0);
  // Unknown events change nothing.
  assert.deepEqual(holdNext(HOLD_IDLE, { type: "nope" }), { state: HOLD_IDLE, fire: false });
});
