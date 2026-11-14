// The hosted workspace (server/cloud/host.mjs) in Node: the desktop's app over one company's
// store, answering as the person of each request. Identity, guests, private conversations,
// per-person read state, the live feed, isolation between companies and the envelope vault.
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
import { asPerson, currentPerson, DESKTOP_PERSON, personalFields } from "../server/identity.mjs";

const ANA = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" };
const BETO = { id: "22222222-2222-4222-8222-222222222222", name: "Beto", email: "beto@example.com", role: "member" };
const GIL = { id: "33333333-3333-4333-8333-333333333333", name: "Gil", email: "gil@example.com", role: "guest" };
const CORA = { id: "44444444-4444-4444-8444-444444444444", name: "Cora", email: "cora@example.org", role: "owner" };

async function company(t, name, people) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-host-"));
  const key = randomBytes(32);
  const store = new Store(dir, { driver: new DoDriver(new FakeDurableStorage(path.join(dir, "do.sqlite"))), keyProvider: () => key });
  const host = hostWorkspace({ store, workspace: { id: randomBytes(16).toString("hex"), name }, masters: [{ kid: "m1", secret: randomBytes(32).toString("hex") }], log: () => {} });
  host.syncMembers(people, { name });
  const server = http.createServer(host.app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await host.runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {}); // Windows may still hold the file a moment
  });
  const as = (person) => async (method, route, body) => {
    const r = await fetch(base + "/api" + route, {
      method, headers: { "Content-Type": "application/json", ...(person ? { "X-Colmena-Person": JSON.stringify(person) } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
  return { store, host, as };
}

test("identity seam: the desktop is always its one person; hosted code runs as each person", async () => {
  assert.equal(currentPerson(), DESKTOP_PERSON);
  await asPerson(ANA, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(currentPerson().id, ANA.id, "survives awaits and timers");
  });
  assert.equal(currentPerson(), DESKTOP_PERSON);
  assert.throws(() => asPerson({ name: "nobody" }, () => {}));
});

test("personal fields: read marks per person, authors and deciders stamped, stored values untouched", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-personal-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  // Desktop (no personal fields): unchanged behaviour.
  store.put("notifications", { id: "n1", read: false });
  store.patch("notifications", "n1", { read: true });
  assert.equal(store.get("notifications", "n1").read, true);
  store.personal = personalFields();
  store.put("notifications", { id: "n2", read: false, missionId: "m" });
  asPerson(ANA, () => store.patch("notifications", "n2", { read: true, readAt: "2026-11-14T10:00:00.000Z" }));
  assert.equal(asPerson(ANA, () => store.get("notifications", "n2").read), true);
  assert.equal(asPerson(BETO, () => store.get("notifications", "n2").read), false, "Beto has not read it");
  assert.equal(store.raw("notifications", "n2").read, false, "the stored flag stays everyone's");
  asPerson(BETO, () => store.put("rooms", { id: "r1", seenAt: "2026-11-14T11:00:00.000Z" }));
  assert.equal(asPerson(BETO, () => store.get("rooms", "r1").seenAt), "2026-11-14T11:00:00.000Z");
  assert.equal(asPerson(ANA, () => store.get("rooms", "r1").seenAt), null);
  const msg = asPerson(BETO, () => store.put("messages", { id: "m1", missionId: "x", role: "user", text: "hola" }));
  assert.deepEqual(msg.by, { id: BETO.id, name: "Beto" });
  assert.equal(store.put("messages", { id: "m2", missionId: "x", role: "user", text: "sin persona" }).by, undefined);
  store.put("approvals", { id: "a1", status: "pending" });
  asPerson(ANA, () => store.patch("approvals", "a1", { status: "approved" }));
  assert.deepEqual(store.get("approvals", "a1").decidedBy, { id: ANA.id, name: "Ana" });
});

test("a request is the person the Worker says; nobody else gets in", async (t) => {
  const { as } = await company(t, "Norte", [ANA, BETO, GIL]);
  assert.equal((await as(null)("GET", "/state")).status, 401);
  assert.equal((await as({ ...CORA, role: "owner" })("GET", "/state")).status, 403, "not one of this company");
  assert.equal((await as({ ...ANA, role: "boss" })("GET", "/state")).status, 401);
  const s = await as(BETO)("GET", "/state");
  assert.equal(s.status, 200);
  assert.equal(s.data.cloud.me.id, BETO.id);
  assert.equal(s.data.settings.userName, "Beto");
  assert.equal(s.data.settings.onboarded, true);
  assert.equal(s.data.teams[0].people, 3);
  assert.ok(s.data.cloud.hidden.includes("codigo"));
  assert.equal((await as(BETO)("GET", "/peers/state")).status, 404, "the desktop mailbox is not in the cloud");
  assert.equal((await as(BETO)("GET", "/code/tasks")).status, 404);
});

test("a room of people: each message names its author, no bot takes a turn, unread counts the others", async (t) => {
  const { as, store } = await company(t, "Norte", [ANA, BETO, GIL]);
  const room = await as(ANA)("POST", "/rooms", { title: "General" });
  assert.equal(room.status, 201);
  const missionId = room.data.missionId;
  assert.equal(store.get("missions", missionId).people, true);
  assert.equal((await as(BETO)("POST", `/missions/${missionId}/messages`, { text: "Hola a todos" })).status, 200);
  const forAna = await as(ANA)("GET", `/missions/${missionId}`);
  const said = forAna.data.messages.find((m) => m.text === "Hola a todos");
  assert.deepEqual(said.author, { kind: "person", address: "u:" + BETO.id, name: "Beto", you: false });
  const forBeto = await as(BETO)("GET", `/missions/${missionId}`);
  assert.equal(forBeto.data.messages.find((m) => m.text === "Hola a todos").author.you, true);
  assert.equal(forAna.data.steps.length, 0, "nobody named a bot");
  // Ana saw the room before Beto spoke again: one unread for her, none for Beto.
  await as(ANA)("POST", `/rooms/${room.data.id}/seen`, {});
  await new Promise((r) => setTimeout(r, 5));
  await as(BETO)("POST", `/missions/${missionId}/messages`, { text: "¿Lo veis?" });
  const rowA = (await as(ANA)("GET", "/state")).data.rooms.find((r) => r.missionId === missionId || r.id === missionId || r.id === room.data.id);
  assert.equal(rowA?.unread, 1);
  const detail = await as(ANA)("GET", `/rooms/${room.data.id}`);
  assert.deepEqual(detail.data.people.map((p) => p.name).sort(), ["Ana", "Beto", "Gil"]);
});

test("a direct message is seen by its two people only; a guest talks but does not manage", async (t) => {
  const { as } = await company(t, "Norte", [ANA, BETO, GIL]);
  const dm = await as(ANA)("POST", "/cloud/dm", { person: BETO.id });
  assert.equal(dm.status, 201);
  assert.equal((await as(ANA)("POST", "/cloud/dm", { person: BETO.id })).data.missionId, dm.data.missionId, "the same conversation again");
  await as(ANA)("POST", `/missions/${dm.data.missionId}/messages`, { text: "Entre tú y yo" });
  assert.ok((await as(BETO)("GET", "/state")).data.missions.some((m) => m.id === dm.data.missionId));
  const gil = await as(GIL)("GET", "/state");
  assert.ok(!gil.data.missions.some((m) => m.id === dm.data.missionId));
  assert.equal((await as(GIL)("GET", `/missions/${dm.data.missionId}`)).status, 404);
  assert.equal((await as(GIL)("POST", `/missions/${dm.data.missionId}/messages`, { text: "hola" })).status, 404);
  const room = await as(ANA)("POST", "/rooms", { title: "General" });
  assert.equal((await as(GIL)("POST", `/missions/${room.data.missionId}/messages`, { text: "Hola" })).status, 200);
  assert.equal((await as(GIL)("PATCH", "/settings", { language: "es" })).status, 403);
  assert.equal((await as(GIL)("POST", "/rooms", { title: "Mía" })).status, 403);
});

test("the live feed: each person's frames, never a private conversation of others", async (t) => {
  const { as, host } = await company(t, "Norte", [ANA, BETO, GIL]);
  const frames = { beto: [], gil: [] };
  const closeB = host.openFeed(BETO, (f) => frames.beto.push(f));
  const closeG = host.openFeed(GIL, (f) => frames.gil.push(f));
  t.after(() => { closeB(); closeG(); });
  const room = await as(ANA)("POST", "/rooms", { title: "General" });
  const dm = await as(ANA)("POST", "/cloud/dm", { person: BETO.id });
  await as(ANA)("POST", `/missions/${room.data.missionId}/messages`, { text: "Para todos" });
  await as(ANA)("POST", `/missions/${dm.data.missionId}/messages`, { text: "Solo para Beto" });
  await new Promise((r) => setTimeout(r, 250));
  const pushed = (list) => list.filter((f) => f.type === "push" && f.kind === "messages").map((f) => f.record.text);
  assert.deepEqual(pushed(frames.beto).sort(), ["Para todos", "Solo para Beto"]);
  assert.deepEqual(pushed(frames.gil), ["Para todos"]);
  const toBeto = frames.beto.find((f) => f.record?.text === "Para todos");
  assert.equal(toBeto.record.author.name, "Ana", "rendered as Beto sees it");
});

test("two companies share nothing", async (t) => {
  const one = await company(t, "Uno", [ANA, BETO]);
  const two = await company(t, "Dos", [CORA]);
  const room = await one.as(ANA)("POST", "/rooms", { title: "Secreta" });
  assert.equal((await two.as(CORA)("GET", `/missions/${room.data.missionId}`)).status, 404);
  assert.ok(!(await two.as(CORA)("GET", "/state")).data.missions.some((m) => m.id === room.data.missionId));
  assert.equal((await two.as(ANA)("GET", "/state")).status, 403, "Ana is not in Dos");
  one.host.syncMembers([ANA]);
  assert.equal((await one.as(BETO)("GET", "/state")).status, 403, "removed from Uno");
});

test("secrets go through the envelope vault, sealed per secret", async (t) => {
  const { host, store } = await company(t, "Norte", [ANA]);
  await asPerson(ANA, () => host.runtime.secrets.change((data) => { data.values.demo = { value: "valor-de-prueba" }; }));
  const sealed = store.list("sealedSecrets");
  assert.equal(sealed.length, 1);
  assert.ok(!JSON.stringify(sealed).includes("valor-de-prueba"));
  assert.ok(store.get("cloud", "vault-key").wrapped.startsWith("v1."));
});
