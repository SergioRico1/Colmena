import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { Connections, categoryOf, classify, runsWithoutAsking, AUTO_SEND_MS } from "../server/connections.mjs";
import { describeAppAction, explicitlyAsked, isNo, isYes } from "../server/appactions.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-app-permissions-")),
    store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store };
}

const event = (args = {}) => ({ tool: "GOOGLECALENDAR_CREATE_EVENT", toolkit: "googlecalendar", arguments: { summary: "Renovar PlayStation Plus", start_date: "2026-11-11", send_updates: "none", ...args } });

test("a calendar event in your own calendar is a change, not a red line", () => {
  assert.deepEqual(classify(event()), { kind: "write", redLine: false });
  assert.equal(categoryOf(event()), "calendario");
  // With guests that get notified it leaves your account.
  assert.equal(classify(event({ attendees: ["ana@ejemplo.com"], send_updates: "all" })).redLine, true);
  assert.equal(classify({ tool: "SLACK_SEND_MESSAGE", toolkit: "slack", arguments: {} }).redLine, true);
  assert.equal(classify({ tool: "GMAIL_MOVE_TO_TRASH", toolkit: "gmail", arguments: {} }).redLine, true);
  assert.deepEqual(classify({ tool: "GMAIL_FETCH_EMAILS", toolkit: "gmail", arguments: {}, read_scope: "inbox" }), { kind: "read", redLine: false });
});

test("connecting an app allows reading it; changes in your own account run where the bot writes; red lines always ask", () => {
  const read = { kind: "read", redLine: false }, write = { kind: "write", redLine: false }, red = { kind: "write", redLine: true };
  assert.equal(runsWithoutAsking(read, "lee"), true);
  assert.equal(runsWithoutAsking(read, undefined), true);
  assert.equal(runsWithoutAsking(read, "none"), false);
  assert.equal(runsWithoutAsking(write, "escribe"), true);
  assert.equal(runsWithoutAsking(write, undefined), true, "an app without a column (Notion…) changes your own account without asking");
  assert.equal(runsWithoutAsking(write, "pide"), false);
  assert.equal(runsWithoutAsking(write, "lee"), false);
  assert.equal(runsWithoutAsking(red, "escribe"), false);
  assert.equal(runsWithoutAsking(red, undefined), false);
});

test("«Lee» becomes «Escribe» once for existing bots; «Pide» and «No» stay, and a later «Lee» is kept", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-appwrites-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let store = new Store(dir);
  assert.equal(store.get("settings", "main").appWrites, true, "fresh spaces start with the flag");
  assert.equal(store.get("bots", "atlas").tools.correo, "escribe", "seeds already write in your accounts");
  // An older space: the flag is missing and Nora reads Drive, asks for Sheets, has no mail.
  store.put("settings", { ...store.get("settings", "main"), appWrites: undefined });
  store.patch("bots", "nora", { tools: { ...store.get("bots", "nora").tools, carpeta: "lee", hojas: "pide", correo: "none" } });
  store.close();
  store = new Store(dir);
  assert.deepEqual(["carpeta", "hojas", "correo"].map((k) => store.get("bots", "nora").tools[k]), ["escribe", "pide", "none"]);
  store.patch("bots", "nora", { tools: { ...store.get("bots", "nora").tools, carpeta: "lee" } });
  store.close();
  store = new Store(dir);
  assert.equal(store.get("bots", "nora").tools.carpeta, "lee", "your later choice stays");
  store.close();
});

test("the request reads as a sentence", () => {
  const said = describeAppAction({ kind: "write", review: { tool: "GOOGLECALENDAR_CREATE_EVENT", toolkit: "googlecalendar" } }, event().arguments);
  assert.equal(said.title, "Crear un evento en Google Calendar");
  assert.equal(said.sentence, "crear un evento en Google Calendar: «Renovar PlayStation Plus», 11 nov.");
});

test("a short yes or no in the chat is an answer", () => {
  for (const t of ["sí", "Sí, estás autorizado", "vale, hazlo", "adelante", "sí, envíalo", "te autorizo"]) assert.equal(isYes(t), true, t);
  for (const t of ["sí pero cambia el asunto", "¿y si lo envías mañana?", "no"]) assert.equal(isYes(t), false, t);
  for (const t of ["no", "ahora no", "No lo hagas."]) assert.equal(isNo(t), true, t);
});

test("an email you asked for, naming who gets it, needs no second OK", async (t) => {
  const { store } = await fixture(t);
  let clock = Date.parse("2026-10-18T10:00:00Z");
  const say = (text) => store.put("messages", { id: "m" + clock, missionId: "x", role: "user", text, at: new Date((clock += 1000)).toISOString() });
  say("Envíale a oriol@orvalia.es la revisión de septiembre");
  assert.equal(explicitlyAsked(store, "x", ["oriol@orvalia.es"]), true);
  assert.equal(explicitlyAsked(store, "x", ["oriol@orvalia.es", "otro@fuera.com"]), false);
  say("Responde a Oriol que está todo OK");
  assert.equal(explicitlyAsked(store, "x", ["oriol.vidal@orvalia.es"]), true);
  say("Resume mis correos de hoy");
  assert.equal(explicitlyAsked(store, "x", ["oriol@orvalia.es"]), false);
});

// A fake connections service: prepare → proposal, commit → ok.
function hub(prepared) {
  const calls = [];
  return {
    calls,
    async dispatch(_profile, op, args) {
      calls.push(op);
      if (op === "prepare") return { proposal: "p1", name: "Create Event", account: "Calendar · ca_1", account_alias: "Calendar", ...prepared };
      if (op === "commit") return { ok: true, receipt: { id: "r1" } };
      return {};
    },
  };
}
const call = { call_id: "c1" };
const args = { tool: "GOOGLECALENDAR_CREATE_EVENT", account: "ca_1", arguments_json: "{}" };
const signal = new AbortController().signal;

test("Vera with «escribe» on the calendar creates the event without asking", async (t) => {
  const { store } = await fixture(t);
  store.put("bots", { id: "vera", name: "Vera", tools: { calendario: "escribe" } });
  store.put("missions", { id: "mi", status: "running" });
  const h = hub(event());
  const connections = new Connections(store, h);
  const result = await connections.request({ id: "mi" }, { id: "s1", botId: "vera" }, call, args, signal);
  assert.equal(result.ok, true);
  assert.equal(store.get("approvals", "s1:c1").decidedBy, "automático");
  assert.ok(h.calls.includes("commit"));
});

test("with «lee» it asks once; «Siempre en Google Calendar» gives it «escribe»", async (t) => {
  const { store } = await fixture(t);
  store.put("bots", { id: "vera", name: "Vera", tools: { calendario: "lee" } });
  store.put("missions", { id: "mi", status: "running" });
  const connections = new Connections(store, hub(event()));
  const result = await connections.request({ id: "mi" }, { id: "s1", botId: "vera" }, call, args, signal);
  assert.deepEqual(result, { waiting: true });
  const { revision } = await connections.review("s1:c1");
  const done = await connections.decide("s1:c1", { decision: "approved", revision, remember: true });
  assert.equal(done.ok, true);
  assert.equal(store.get("bots", "vera").tools.calendario, "escribe");
});

test("a send you asked for leaves on its own after the undo window", async (t) => {
  const { store } = await fixture(t);
  store.put("bots", { id: "vera", name: "Vera", tools: { correo: "escribe" } });
  store.put("missions", { id: "mi", status: "running" });
  store.put("messages", { id: "u1", missionId: "mi", role: "user", text: "Envía a ana@ejemplo.com el resumen", at: new Date().toISOString() });
  const h = hub({ tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", arguments: { recipient_email: "ana@ejemplo.com", subject: "Resumen", body: "Hola" } });
  const connections = new Connections(store, h);
  let resumed = null;
  connections.onDecided = (id) => { resumed = id; };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = await connections.request({ id: "mi" }, { id: "s1", botId: "vera" }, call, { ...args, tool: "GMAIL_SEND_EMAIL" }, signal);
  assert.deepEqual(result, { waiting: true });
  assert.ok(store.get("approvals", "s1:c1").autoSendAt);
  t.mock.timers.tick(AUTO_SEND_MS + 10);
  t.mock.timers.reset();
  for (let i = 0; i < 20 && !resumed; i++) await new Promise((r) => setImmediate(r));
  assert.equal(store.get("approvals", "s1:c1").status, "executed");
  assert.equal(resumed, "mi");
});
