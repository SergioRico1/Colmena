// What team messaging adds to Slack's basics (server/cloud/chat-plus.mjs, when.mjs): encargos for
// people with their state on the message and in the thread, polls, saved messages, scheduled
// messages sent by the alarm as their person, reminders in your own conversation, and «cuándo» in
// Spanish read in the person's time zone.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../server/store.mjs";
import { DoDriver } from "../server/store-driver.mjs";
import { FakeDurableStorage } from "../server/do-sql-fake.mjs";
import { hostWorkspace } from "../server/cloud/host.mjs";
import { SqlFiles } from "../server/file-store.mjs";
import { SqlBlobs } from "../server/cloud/blobs.mjs";
import { parseWhen, whenLabel } from "../server/cloud/when.mjs";

const ANA = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" };
const BETO = { id: "22222222-2222-4222-8222-222222222222", name: "Beto", email: "beto@example.com", role: "member" };
const GIL = { id: "33333333-3333-4333-8333-333333333333", name: "Gil", email: "gil@example.com", role: "guest" };
const DORA = { id: "44444444-4444-4444-8444-444444444444", name: "Dora", email: "dora@example.net", role: "member" };

async function company(t, people = [ANA, BETO, GIL, DORA]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-plus-"));
  const key = randomBytes(32);
  const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
  const store = new Store(path.join(dir, "virtual-root"), { driver: new DoDriver(storage), keyProvider: () => key });
  const host = hostWorkspace({ store, workspace: { id: randomBytes(16).toString("hex"), name: "Pruebas" }, files: new SqlFiles(storage.sql), blobs: new SqlBlobs(storage.sql), previews: false, defer: () => {}, log: () => {}, presence: () => new Map([[BETO.id, "active"]]) });
  host.syncMembers(people, { name: "Pruebas" });
  const server = http.createServer(host.app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await host.runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  const as = (person) => async (method, route, body) => {
    const r = await fetch(base + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Person": JSON.stringify(person) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const feed = (person) => {
    const got = [];
    t.after(host.openFeed(person, (e) => { if (String(e.type).startsWith("chat.")) got.push(e); }, { watching: () => null }));
    return got;
  };
  const general = (await as(ANA)("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  return { host, store, as, feed, general };
}
const threadOf = async (as, id) => (await as("GET", "/chat/messages/" + id + "/thread")).data;

test("«cuándo» in Spanish, in the person's time zone; only times to come", () => {
  const now = Date.UTC(2026, 10, 16, 17, 0); // Monday 16 November 2026, 18:00 in Madrid
  const tz = "Europe/Madrid";
  const at = (s) => { const r = parseWhen(s, { now, tz }); return r && { iso: new Date(r.at).toISOString(), rest: r.rest }; };
  assert.deepEqual(at("mañana llamar a Ana"), { iso: "2026-11-17T08:00:00.000Z", rest: "llamar a Ana" });
  assert.deepEqual(at("en 20 minutos revisar el horno"), { iso: "2026-11-16T17:20:00.000Z", rest: "revisar el horno" });
  assert.deepEqual(at("revisar el informe el viernes a las 10"), { iso: "2026-11-20T09:00:00.000Z", rest: "revisar el informe" });
  assert.deepEqual(at("hoy a las 8 de la tarde cena"), { iso: "2026-11-16T19:00:00.000Z", rest: "cena" });
  assert.deepEqual(at("a las 9 enviar la factura"), { iso: "2026-11-17T08:00:00.000Z", rest: "enviar la factura" }, "9:00 already past today: tomorrow");
  assert.deepEqual(at("el lunes hacer X"), { iso: "2026-11-23T08:00:00.000Z", rest: "hacer X" }, "said on a Monday: next week's");
  assert.deepEqual(at("el 3/1 felicitar"), { iso: "2027-01-03T08:00:00.000Z", rest: "felicitar" });
  assert.equal(at("hoy a las 5 de la tarde algo"), null, "17:00 is already past");
  assert.equal(at("algo sin fecha"), null);
  // Summer time: 9:00 in Madrid in July is 7:00 UTC.
  assert.equal(new Date(parseWhen("el 15/7 a las 9 x", { now, tz }).at).toISOString(), "2027-07-15T07:00:00.000Z");
  assert.equal(whenLabel(Date.UTC(2026, 10, 17, 8, 0), { now, tz }), "mañana a las 09:00");
  assert.equal(whenLabel(Date.UTC(2026, 10, 20, 9, 0), { now, tz }), "el viernes a las 10:00");
});

test("an encargo on a message: the person is told, everyone sees its state, the thread says who asked and when it was done", async (t) => {
  const { as, general, feed } = await company(t);
  const betoSees = feed(BETO);
  const sent = (await as(ANA)("POST", "/chat/channels/" + general.id + "/messages", { text: "Hay que preparar el presupuesto de Acme" })).data.message;
  const made = await as(ANA)("POST", "/chat/channels/" + general.id + "/tasks", { message: sent.id, assignee: BETO.id, due: "el 25/12 a las 10" });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.status, "open");
  assert.equal(made.data.title, "Hay que preparar el presupuesto de Acme");
  assert.ok(made.data.due > Date.now());
  // The card on the message, for everyone in the channel.
  const page = (await as(DORA)("GET", "/chat/channels/" + general.id + "/messages")).data;
  const card = page.messages.find((m) => m.id === sent.id).tasks[0];
  assert.deepEqual([card.assignee, card.createdBy, card.status], [BETO.id, ANA.id, "open"]);
  // The thread says who asked whom.
  let thread = await threadOf(as(ANA), sent.id);
  assert.match(thread.replies.at(-1).text, /^Ana le encargó esto a Beto para /);
  // «Para ti» and the list of encargos.
  assert.ok((await as(BETO)("GET", "/chat/mentions")).data.items.some((i) => i.kind === "task" && i.message.id === sent.id));
  assert.ok(betoSees.some((e) => e.type === "chat.notify" && /te ha encargado algo/.test(e.title)));
  const mine = (await as(BETO)("GET", "/chat/tasks?scope=para-mi")).data.items;
  assert.equal(mine.length, 1);
  assert.equal((await as(ANA)("GET", "/chat/tasks?scope=pedidos")).data.items.length, 1);
  // Only Beto, Ana (or an admin) may change it.
  assert.equal((await as(DORA)("PATCH", "/chat/tasks/" + made.data.id, { status: "done" })).status, 403);
  const done = await as(BETO)("PATCH", "/chat/tasks/" + made.data.id, { status: "done" });
  assert.equal(done.data.status, "done");
  assert.equal(done.data.doneBy, BETO.id);
  thread = await threadOf(as(ANA), sent.id);
  assert.equal(thread.replies.at(-1).text, "Beto marcó como hecho «Hay que preparar el presupuesto de Acme» ✓");
  assert.ok((await as(ANA)("GET", "/chat/mentions")).data.items.some((i) => i.kind === "task"), "Ana hears it is done");
  // Reopening says so too.
  await as(ANA)("PATCH", "/chat/tasks/" + made.data.id, { status: "open" });
  assert.match((await threadOf(as(ANA), sent.id)).replies.at(-1).text, /^Ana volvió a abrir/);
});

test("«/encargo»: a new message with its encargo; someone outside a private conversation cannot get one; guests never give one to a bot", async (t) => {
  const { as, general } = await company(t);
  const made = await as(ANA)("POST", "/chat/channels/" + general.id + "/tasks", { assignee: BETO.id, title: "Revisar el contrato" });
  assert.equal(made.status, 201);
  const page = (await as(BETO)("GET", "/chat/channels/" + general.id + "/messages")).data;
  const msg = page.messages.at(-1);
  assert.equal(msg.text, "Revisar el contrato");
  assert.equal(msg.tasks[0].id, made.data.id);
  // A private channel: only its people.
  const secret = (await as(ANA)("POST", "/chat/channels", { name: "secreto", kind: "private" })).data;
  const refused = await as(ANA)("POST", "/chat/channels/" + secret.id + "/tasks", { assignee: BETO.id, title: "x" });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /no está en esta conversación/);
  assert.equal((await as(BETO)("POST", "/chat/channels/" + secret.id + "/tasks", { assignee: BETO.id, title: "x" })).status, 404, "Beto cannot see it");
  // A guest: not to a bot.
  await as(ANA)("POST", "/chat/channels/" + general.id + "/members", { people: [GIL.id] });
  assert.equal((await as(GIL)("POST", "/chat/channels/" + general.id + "/tasks", { assignee: "bot:nora", title: "x" })).status, 403);
  assert.equal((await as(ANA)("POST", "/chat/channels/" + general.id + "/tasks", { assignee: BETO.id, title: "x", due: "cuando sea" })).status, 400);
});

test("polls: one vote each (or several), changing it, closing by its author; search finds them", async (t) => {
  const { as, general } = await company(t);
  assert.equal((await as(ANA)("POST", "/chat/channels/" + general.id + "/polls", { question: "¿Comida?", options: ["Pizza"] })).status, 400);
  const sent = (await as(ANA)("POST", "/chat/channels/" + general.id + "/polls", { question: "¿Comida el viernes?", options: ["Pizza", "Sushi", "Pizza", " "] })).data.message;
  assert.deepEqual(sent.poll.options.map((o) => o.text), ["Pizza", "Sushi"]);
  const vote = (who, options) => as(who)("POST", "/chat/messages/" + sent.id + "/vote", { options });
  await vote(BETO, ["o1"]);
  await vote(DORA, ["o2"]);
  let view = (await vote(BETO, ["o2", "o1"])).data; // one choice only: the first counts
  assert.deepEqual(view.poll.options.map((o) => o.count), [0, 2]);
  assert.equal(view.poll.voters, 2);
  assert.deepEqual(view.poll.options[1].people.sort(), [BETO.id, DORA.id].sort());
  assert.equal((await as(BETO)("POST", "/chat/messages/" + sent.id + "/poll", { closed: true })).status, 403);
  view = (await as(ANA)("POST", "/chat/messages/" + sent.id + "/poll", { closed: true })).data;
  assert.equal(view.poll.closed, true);
  assert.equal((await vote(DORA, ["o1"])).status, 409);
  // Several choices when the poll allows it; found by its words.
  const multi = (await as(ANA)("POST", "/chat/channels/" + general.id + "/polls", { question: "¿Qué días podéis?", options: ["Lunes", "Martes", "Miércoles"], multi: true })).data.message;
  view = (await as(BETO)("POST", "/chat/messages/" + multi.id + "/vote", { options: ["o1", "o3"] })).data;
  assert.deepEqual(view.poll.options.map((o) => o.count), [1, 0, 1]);
  assert.ok((await as(BETO)("GET", "/chat/search?q=miercoles")).data.results.some((r) => r.message.id === multi.id));
});

test("saved for later: yours only, and only what you can still read", async (t) => {
  const { as, general } = await company(t);
  const sent = (await as(ANA)("POST", "/chat/channels/" + general.id + "/messages", { text: "Léelo luego" })).data.message;
  await as(BETO)("POST", "/chat/messages/" + sent.id + "/save", { on: true });
  assert.deepEqual((await as(BETO)("GET", "/chat/bootstrap")).data.saved, [sent.id]);
  assert.deepEqual((await as(ANA)("GET", "/chat/bootstrap")).data.saved, []);
  assert.equal((await as(BETO)("GET", "/chat/saved")).data.items[0].message.id, sent.id);
  const secret = (await as(ANA)("POST", "/chat/channels", { name: "secreto", kind: "private" })).data;
  const hidden = (await as(ANA)("POST", "/chat/channels/" + secret.id + "/messages", { text: "privado" })).data.message;
  assert.equal((await as(BETO)("POST", "/chat/messages/" + hidden.id + "/save", { on: true })).status, 404);
  await as(BETO)("POST", "/chat/messages/" + sent.id + "/save", { on: false });
  assert.equal((await as(BETO)("GET", "/chat/saved")).data.items.length, 0);
});

test("scheduled messages: sent by the alarm as their person, editable and cancellable until then; a failure comes back to you", async (t) => {
  const { as, host, general } = await company(t);
  assert.equal((await as(BETO)("POST", "/chat/scheduled", { channel: general.id, text: "hola", at: Date.now() - 1000 })).status, 400);
  const made = (await as(BETO)("POST", "/chat/scheduled", { channel: general.id, text: "Buenos días, equipo <@" + ANA.id + ">", when: "mañana a las 9" })).data;
  assert.match(made.label, /^mañana a las 09:00$/);
  assert.ok(host.nextAlarm(Date.now()) <= made.at, "the alarm wakes for it");
  assert.equal((await as(ANA)("GET", "/chat/scheduled")).data.items.length, 0, "only Beto sees his");
  const edited = (await as(BETO)("PATCH", "/chat/scheduled/" + made.id, { text: "Buenos días a todos" })).data;
  assert.equal(edited.text, "Buenos días a todos");
  const other = (await as(BETO)("POST", "/chat/scheduled", { channel: general.id, text: "otro", at: Date.now() + 3600000 })).data;
  await as(BETO)("DELETE", "/chat/scheduled/" + other.id);
  // The alarm, after the time: sent as Beto.
  await host.plus.due(made.at + 1000);
  const last = (await as(ANA)("GET", "/chat/channels/" + general.id + "/messages")).data.messages.at(-1);
  assert.equal(last.author, BETO.id);
  assert.equal(last.text, "Buenos días a todos");
  assert.equal((await as(BETO)("GET", "/chat/scheduled")).data.items.length, 0);
  // Archived in the meantime: it comes back to Beto in his own conversation.
  const sales = (await as(ANA)("POST", "/chat/channels", { name: "ventas" })).data;
  await as(BETO)("POST", "/chat/channels/" + sales.id + "/join");
  const lost = (await as(BETO)("POST", "/chat/scheduled", { channel: sales.id, text: "Cifras de hoy", at: Date.now() + 60000 })).data;
  await as(ANA)("PATCH", "/chat/channels/" + sales.id, { archived: true });
  await host.plus.due(lost.at + 1000);
  const self = (await as(BETO)("GET", "/chat/channels")).data.channels.find((c) => c.kind === "dm" && c.people.length === 1);
  assert.ok(self, "his own conversation exists");
  const back = (await as(BETO)("GET", "/chat/channels/" + self.id + "/messages")).data.messages.at(-1);
  assert.match(back.text, /No pude enviar tu mensaje programado a #ventas: .*archivado[\s\S]*Cifras de hoy/);
});

test("reminders: «/recordar» reads when from the words; at that time Colmena writes to you, with the message it was about", async (t) => {
  const { as, host, general } = await company(t);
  assert.equal((await as(BETO)("POST", "/chat/reminders", { text: "llamar a Ana" })).status, 400, "no time");
  const made = (await as(BETO)("POST", "/chat/reminders", { text: "en 2 horas llamar a Ana" })).data;
  assert.equal(made.text, "llamar a Ana");
  assert.ok(Math.abs(made.at - (Date.now() + 7200000)) < 60000);
  const sent = (await as(ANA)("POST", "/chat/channels/" + general.id + "/messages", { text: "El informe de ventas" })).data.message;
  const about = (await as(BETO)("POST", "/chat/reminders", { message: sent.id, when: "en 1 hora" })).data;
  assert.equal(about.text, "El informe de ventas");
  assert.equal((await as(BETO)("GET", "/chat/reminders")).data.items.length, 2);
  await host.plus.due(made.at + 1000);
  const self = (await as(BETO)("GET", "/chat/channels")).data.channels.find((c) => c.kind === "dm" && c.people.length === 1);
  const msgs = (await as(BETO)("GET", "/chat/channels/" + self.id + "/messages")).data.messages;
  assert.deepEqual(msgs.map((m) => m.text), ["⏰ Recordatorio: El informe de ventas", "⏰ Recordatorio: llamar a Ana"]);
  assert.equal(msgs[0].author, "bot:colmena");
  assert.ok((await as(BETO)("GET", "/chat/mentions")).data.items.some((i) => i.kind === "dm"), "in «Para ti»");
  assert.equal((await as(ANA)("GET", "/chat/channels")).data.channels.some((c) => c.id === self.id), false, "nobody else sees it");
});
