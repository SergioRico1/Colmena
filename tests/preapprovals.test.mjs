// «Aprobado por adelantado» (server/preapprovals.mjs): a routine keeps what it may do at its
// time with nobody there. Keys, exclusions, «Solo la próxima vez» / «Siempre», isolation
// between routines, the apps and run_command paths, and the routes that manage it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { Connections } from "../server/connections.mjs";
import { createApp } from "../server/app.mjs";
import { approvalRevision } from "../server/state.mjs";
import { computerExtraTools } from "../server/computer/wire.mjs";
import { eligibility, entryFrom, findPreapproval, keyOf, matches, recipientsOf, takePreapproval, withEntry } from "../server/preapprovals.mjs";

async function tmpStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-preapprovals-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store };
}
const routineMission = { id: "m1", automationId: "r1", status: "running" };
const send = (to, extra = {}) => ({
  id: "s1:c1", tool: "apps_execute", kind: "send", status: "pending", redLine: true,
  review: { tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", account: "Trabajo · acc1", account_alias: "Trabajo", name: "Enviar correo", arguments: { recipient_email: to, subject: "Informe", body: "Hola" } },
  ...extra,
});
const command = (args = ["-e", "1"]) => ({ id: "s1:c2", tool: "run_command", kind: "permission", status: "pending", redLine: true, args: { program: "node", args, folderId: null, reason: "Probar" } });

test("keys: an app action by its slug, app, account and everyone it goes to; a command by its exact words", () => {
  const k = keyOf(send("Ana <ANA@acme.es>, luis@acme.es", { review: { ...send("").review, arguments: { recipient_email: "ana@acme.es", cc: ["Jefa@Acme.es"], subject: "x", body: "y" } } }));
  assert.deepEqual(k, { tool: "apps_execute", slug: "GMAIL_SEND_EMAIL", toolkit: "gmail", account: "Trabajo · acc1", recipients: ["ana@acme.es", "jefa@acme.es"] });
  assert.deepEqual(recipientsOf({ recipient_email: "Ana <ANA@acme.es>, luis@acme.es" }), ["ana@acme.es", "luis@acme.es"]);
  assert.deepEqual(keyOf(command()), { tool: "run_command", command: { program: "node", args: ["-e", "1"], folderId: null } });
  assert.equal(keyOf({ tool: "write_file", args: {} }), null);
});

test("eligibility: money, vaults, sign-ins, questions, plans, skills, soul, reverts, flagged, errands and incognito never", () => {
  const ok = (a, m = routineMission, flagged = false) => eligibility(a, { mission: m, flagged }).ok;
  assert.equal(ok(send("ana@acme.es")), true);
  assert.equal(ok(command()), true);
  for (const slug of ["STRIPE_CREATE_PAYMENT", "PAYPAL_PAYOUT", "SQUARE_REFUND_PAYMENT", "WISE_TRANSFER", "AMAZON_PURCHASE", "SHOPIFY_CREATE_ORDER", "XERO_CHARGE_CARD"])
    assert.equal(ok({ ...send("a@b.es"), kind: "write", review: { tool: slug, toolkit: slug.split("_")[0].toLowerCase(), arguments: {} } }), false, slug);
  assert.equal(ok({ ...send("a@b.es"), kind: "write", review: { tool: "ONEPASSWORD_GET_ITEM", toolkit: "1password", arguments: {} } }), false, "a password vault");
  assert.equal(ok({ ...send("a@b.es"), kind: "write", review: { tool: "NOTION_UPDATE_PASSWORD", toolkit: "notion", arguments: {} } }), false, "a password");
  assert.equal(ok({ ...command(), args: { program: "op", args: ["item", "get", "x"], folderId: null } }), false, "a vault on the command line");
  for (const kind of ["question", "plan", "skill", "soul", "revert", "secret"]) assert.equal(ok({ ...command(), kind }), false, kind);
  assert.equal(ok({ id: "x", tool: "browser_sign_in", kind: "permission", args: {} }), false, "a browser sign-in");
  assert.equal(ok(send("a@b.es"), routineMission, true), false, "a step flagged for injection");
  assert.equal(ok(send("a@b.es"), { ...routineMission, peerErrand: "e1" }), false, "another person's errand");
  assert.equal(ok(send("a@b.es"), { ...routineMission, incognito: true }), false, "incognito");
  assert.equal(ok(send("a@b.es"), { id: "m2", status: "running" }), false, "not a routine");
});

test("matching: recipients must be a subset of the saved ones; a command must be exactly the same", () => {
  const entry = entryFrom(send("ana@acme.es, luis@acme.es"), { uses: "always" });
  const key = (to) => keyOf(send(to));
  assert.equal(matches(entry, key("ana@acme.es"), "m1"), true, "fewer people");
  assert.equal(matches(entry, key("luis@acme.es, ana@acme.es"), "m1"), true);
  assert.equal(matches(entry, key("ana@acme.es, otro@fuera.com"), "m1"), false, "someone new");
  assert.equal(matches(entry, { ...key("ana@acme.es"), account: "Otra · acc2" }, "m1"), false, "another account");
  assert.equal(matches(entry, { ...key("ana@acme.es"), slug: "GMAIL_REPLY_TO_THREAD" }, "m1"), false, "another action");
  const run = entryFrom(command(), { uses: "always" });
  assert.equal(matches(run, keyOf(command()), "m1"), true);
  assert.equal(matches(run, keyOf(command(["-e", "2"])), "m1"), false);
  assert.equal(matches(run, keyOf(command(["-e"])), "m1"), false);
  assert.equal(matches(run, keyOf({ ...command(), args: { program: "node", args: ["-e", "1"], folderId: "docs" } }), "m1"), false, "another folder");
});

test("«Solo la próxima vez» binds to the first run that uses it; «Siempre» keeps matching; another routine never", async (t) => {
  const { store } = await tmpStore(t);
  const next = entryFrom(send("ana@acme.es"), { uses: "next" });
  const always = entryFrom(command(), { uses: "always" });
  store.put("automations", { id: "r1", name: "Informe semanal", preapprovals: withEntry(withEntry([], next), always) });
  store.put("automations", { id: "r2", name: "Otra rutina", preapprovals: [] });
  const m1 = store.put("missions", { id: "m1", automationId: "r1", status: "running" });
  const m2 = store.put("missions", { id: "m2", automationId: "r1", status: "running" });
  const other = store.put("missions", { id: "m3", automationId: "r2", status: "running" });
  const hit = takePreapproval(store, send("ana@acme.es"), { mission: m1, botId: "vera" });
  assert.equal(hit.resolution, "Aprobado por adelantado en la rutina «Informe semanal»");
  let saved = store.get("automations", "r1").preapprovals.find((x) => x.id === next.id);
  assert.equal(saved.boundMission, "m1");
  assert.equal(saved.usedCount, 1);
  assert.ok(saved.lastUsedAt);
  assert.match(store.where("messages", "missionId", "m1").at(-1).text, /Aprobado por adelantado en la rutina «Informe semanal»/i);
  assert.ok(takePreapproval(store, send("ana@acme.es"), { mission: m1 }), "still inside that same run");
  assert.equal(takePreapproval(store, send("ana@acme.es"), { mission: m2 }), null, "never in a later run");
  saved = store.get("automations", "r1").preapprovals.find((x) => x.id === next.id);
  assert.equal(saved.usedCount, 2);
  assert.ok(takePreapproval(store, command(), { mission: m1 }));
  assert.ok(takePreapproval(store, command(), { mission: m2 }), "«Siempre» in every run");
  assert.equal(takePreapproval(store, command(), { mission: other }), null, "another routine's run");
  assert.equal(findPreapproval(store.get("automations", "r1"), command(), { mission: other }), null);
  assert.equal(takePreapproval(store, command(), { mission: m2, flagged: true }), null, "a flagged step");
});

// ------------------------------------------------------------ the apps path
function fakeHub(effects) {
  return {
    dispatch: async (_profile, op, args) => {
      if (op === "prepare") {
        const json = JSON.parse(args.arguments_json || "{}");
        return { proposal: "p-" + Math.random(), tool: args.tool, toolkit: "googlecalendar", account: args.account, arguments: json, name: args.tool };
      }
      if (op === "commit") { effects.push(args.proposal); return { ok: true, data: { id: "evt-new" } }; }
      return { ok: true };
    },
  };
}

test("apps: a pre-approved red line goes out at its time, attended or not, and only in that routine", async (t) => {
  const { store } = await tmpStore(t);
  store.patch("settings", "main", { unattended: true });
  const effects = [];
  const connections = new Connections(store, fakeHub(effects));
  store.put("bots", { id: "nora", name: "Nora", enabled: true, autonomy: "solo", tools: { calendario: "escribe" } });
  const sample = { id: "old", tool: "apps_execute", kind: "write", redLine: true, review: { tool: "GOOGLECALENDAR_DELETE_EVENT", toolkit: "googlecalendar", account: "acc", arguments: { event_id: "evt-1" } } };
  store.put("automations", { id: "r1", name: "Limpiar agenda", preapprovals: [entryFrom(sample, { uses: "always" })] });
  const mission = store.put("missions", { id: "m1", title: "Agenda", status: "running", botIds: ["nora"], automationId: "r1" });
  const step = store.put("steps", { id: "s1", missionId: "m1", botId: "nora", kind: "solo", status: "running", history: [], pending: [] });
  const ask = (args, callId, m = mission, s = step) => connections.request(m, s, { call_id: callId }, { tool: "GOOGLECALENDAR_DELETE_EVENT", account: "acc", arguments_json: JSON.stringify(args) }, new AbortController().signal);
  const out = await ask({ event_id: "evt-9" }, "c1");
  assert.equal(out.ok, true, "it ran, nobody asked");
  const a = store.get("approvals", "s1:c1");
  assert.equal(a.status, "executed");
  assert.equal(a.decidedBy, "rutina");
  assert.equal(a.resolution, "Aprobado por adelantado en la rutina «Limpiar agenda»");
  assert.equal(store.get("automations", "r1").preapprovals[0].usedCount, 1);
  // Another routine's run: left for later as before.
  store.put("missions", { id: "m2", title: "Otra", status: "running", botIds: ["nora"], automationId: "r2" });
  const s2 = store.put("steps", { id: "s2", missionId: "m2", botId: "nora", kind: "solo", status: "running", history: [], pending: [] });
  const later = await ask({ event_id: "evt-9" }, "c2", store.get("missions", "m2"), s2);
  assert.equal(later.deferred, true);
  // A step that read injection phrases: never on its own.
  store.patch("steps", "s1", { suspicious: [{ tool: "web_fetch", found: ["ignora"], at: "x" }] });
  const flagged = await ask({ event_id: "evt-9" }, "c3", mission, store.get("steps", "s1"));
  assert.notEqual(flagged.ok, true);
  assert.equal(store.get("approvals", "s1:c3").status, "pending");
  assert.equal(effects.length, 1);
});

// ------------------------------------------------------------ run_command
test("run_command: a pre-approved command runs in its routine; «next» only in the first run", async (t) => {
  const { store, dir } = await tmpStore(t);
  const runtime = new Runtime(store, { respond: async () => { throw Error("no"); } });
  runtime.relaunch = () => {};
  t.after(() => runtime.shutdown());
  store.put("bots", { id: "nora", name: "Nora", enabled: true, autonomy: "solo" });
  const args = { program: process.execPath, args: ["-e", "1"], folderId: null, reason: "Probar" };
  store.put("automations", { id: "r1", name: "Copia diaria", preapprovals: [entryFrom({ id: "x", tool: "run_command", kind: "permission", args }, { uses: "next" })] });
  for (const id of ["m1", "m2"]) {
    store.put("missions", { id, title: "Rutina", status: "running", botIds: ["nora"], automationId: "r1", steps: ["s"] });
    store.put("steps", { id: id + ":s", key: "s", missionId: id, botId: "nora", kind: "solo", status: "running", history: [], pending: [] });
    await mkdir(path.join(dir, "workspaces", id), { recursive: true });
  }
  const tools = computerExtraTools(runtime, { computer: { available: false } })({ id: "nora", name: "Nora" });
  const run = tools.find((x) => x.name === "run_command");
  const ctx = (missionId, callId) => ({ mission: store.get("missions", missionId), step: store.get("steps", missionId + ":s"), bot: runtime.bot("nora"), call: { call_id: callId } });
  const first = await run.run(args, ctx("m1", "c1"));
  assert.equal(first.exitCode, 0);
  const a = store.get("approvals", "m1:s:c1");
  assert.equal(a.decidedBy, "rutina");
  assert.match(a.resolution, /Aprobado por adelantado en la rutina «Copia diaria»/);
  assert.deepEqual(await run.run(args, ctx("m2", "c2")), { waiting: true }, "spent: the next run asks");
});

// ------------------------------------------------------------ routes
async function api(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-preapprovals-api-"));
  const store = new Store(dir);
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
  const call = (method) => async (route, body) => {
    const r = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  return { store, runtime, post: call("POST"), del: call("DELETE"), put: call("PUT"), get: async (route) => (await fetch(origin + "/api" + route)).json() };
}
const seed = (store) => {
  store.put("automations", { id: "r1", name: "Informe semanal", botId: "vera", prompt: "x", enabled: true, trigger: { type: "semana", config: {} } });
  store.put("missions", { id: "m1", title: "Informe", status: "waiting", botIds: ["vera"], automationId: "r1", createdAt: new Date().toISOString() });
  store.put("missions", { id: "m9", title: "Chat", status: "waiting", botIds: ["vera"], createdAt: new Date().toISOString() });
  return store.put("approvals", { ...command(), id: "m1:s:c1", missionId: "m1", botId: "vera", stepId: "m1:s", title: "Ejecutar «node -e 1»", createdAt: new Date().toISOString() });
};

test("POST /approvals/:id with preapprove keeps it in the routine; refused when denied, with «Siempre» or not eligible", async (t) => {
  const { store, runtime, post, get } = await api(t);
  const a = seed(store);
  const calls = [];
  runtime.approve = async (...args) => { calls.push(args); store.patch("approvals", args[0], { status: args[1] }); };
  const revision = approvalRevision(a);
  const view = (await get("/state")).approvals.find((x) => x.id === a.id);
  assert.equal(view.preapprove, true, "the card offers it");
  assert.deepEqual(view.routine, { id: "r1", name: "Informe semanal" });
  assert.equal((await post("/approvals/" + a.id, { decision: "denied", revision, preapprove: "always" })).status, 400);
  assert.equal((await post("/approvals/" + a.id, { decision: "approved", revision, always: true, preapprove: "always" })).status, 400);
  assert.equal((await post("/approvals/" + a.id, { decision: "approved", revision, preapprove: "luego" })).status, 400);
  assert.equal(calls.length, 0, "nothing decided while refused");
  const ok = await post("/approvals/" + a.id, { decision: "approved", revision, preapprove: "next" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.preapproval.uses, "next");
  assert.equal(calls.length, 1);
  const saved = store.get("automations", "r1").preapprovals;
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].command, { program: "node", args: ["-e", "1"], folderId: null });
  // Not in a routine, or money: refused.
  const chat = store.put("approvals", { ...command(), id: "m9:s:c1", missionId: "m9", botId: "vera", createdAt: new Date().toISOString() });
  assert.equal((await post("/approvals/" + chat.id, { decision: "approved", revision: approvalRevision(chat), preapprove: "always" })).status, 400);
  const pay = store.put("approvals", { id: "m1:s:c2", missionId: "m1", botId: "vera", tool: "apps_execute", kind: "write", redLine: true, status: "pending", review: { tool: "STRIPE_CREATE_PAYMENT_INTENT", toolkit: "stripe", arguments: {} }, createdAt: new Date().toISOString() });
  const refused = await post("/approvals/" + pay.id, { decision: "approved", revision: approvalRevision(pay), preapprove: "always" });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /dinero/);
});

test("routine page routes: list, «Añadir» only what it asked for, «Quitar», and who decides its red lines", async (t) => {
  const { store, post, del, put, get } = await api(t);
  const a = seed(store);
  store.put("approvals", { ...command(["-e", "1"]), id: "m1:s:c5", missionId: "m1", botId: "vera", status: "executed", createdAt: new Date(Date.now() - 1000).toISOString() });
  store.put("approvals", { id: "m9:s:c1", missionId: "m9", botId: "vera", ...command(["-e", "9"]), status: "executed" });
  let page = await get("/automations/r1/preapprovals");
  assert.equal(page.entries.length, 0);
  assert.equal(page.candidates.length, 1, "deduped by key, only its own runs");
  assert.equal(page.candidates[0].command, "node -e 1");
  assert.equal((await post("/automations/r1/preapprovals", { approvalId: "m9:s:c1", uses: "always" })).status, 404, "never asked for by this routine");
  const added = await post("/automations/r1/preapprovals", { approvalId: a.id, uses: "always" });
  assert.equal(added.status, 201);
  assert.equal(added.body.entries.length, 1);
  assert.equal(added.body.candidates.length, 0, "already kept");
  const entryId = added.body.entries[0].id;
  assert.equal((await del("/automations/r1/preapprovals/" + entryId, {})).body.entries.length, 0);
  // Who decides: only an active contact.
  assert.equal((await put("/automations/r1/approver", { contactId: "nadie" })).status, 400);
  store.put("peerContacts", { id: "addr-marta", name: "Marta Ruiz", status: "active" });
  const chosen = await put("/automations/r1/approver", { contactId: "addr-marta" });
  assert.equal(chosen.status, 200);
  assert.deepEqual(chosen.body.approver, { contactId: "addr-marta", name: "Marta Ruiz", active: true });
  assert.deepEqual(chosen.body.people, [{ id: "addr-marta", name: "Marta Ruiz" }]);
  page = (await put("/automations/r1/approver", { contactId: null })).body;
  assert.equal(page.approver, null);
});
