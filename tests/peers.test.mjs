// «Personas»: Colmenas of different people talking through the mailbox (relay/server.mjs).
// Three real instances (Sergio, Marta, Luis) on one local mailbox: invitation and safety
// words, direct messages, a group of three, seen marks, reactions, leaving, and what the
// mailbox can and cannot see.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Peers, dmId, inviteText } from "../server/peers/service.mjs";
import {
  authHeader, checkAuth, newIdentity, open, parseInviteCode, safetyWords, seal, WORDS, formatInviteCode, newInviteCode,
} from "../server/peers/protocol.mjs";
import { startRelay } from "../relay/server.mjs";

const until = async (fn, what = "condición", ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error("No llegó a cumplirse: " + what);
    await new Promise((r) => setTimeout(r, 30));
  }
};

async function world(t, names = ["Sergio Rico", "Marta Ruiz", "Luis Gómez"]) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-peers-"));
  // COLMENA_TEST_RELAY=<url> runs the same test against another mailbox (the Cloudflare one).
  const relay = process.env.COLMENA_TEST_RELAY ? { url: process.env.COLMENA_TEST_RELAY, close: async () => {} } : await startRelay({ port: 0, directory: path.join(base, "relay") });
  const people = [];
  for (const name of names) {
    const store = new Store(path.join(base, name.split(" ")[0]));
    const notices = [];
    const peers = await new Peers({ store, vault: null, relayUrl: relay.url, nameOf: () => name, notifier: { notify: (n) => notices.push(n) }, log: () => {} }).start();
    people.push({ name, store, peers, notices });
  }
  t.after(async () => {
    for (const p of people) { p.peers.stop(); }
    await new Promise((r) => setTimeout(r, 300)); // in-flight mail settles
    for (const p of people) p.store.close();
    await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  await until(() => people.every((p) => p.peers.relayStatus.status === "online"), "todos conectados al buzón");
  return { relay, people, base };
}

/** a invites b; b looks at the card and accepts; both end up as contacts. */
async function connect(a, b) {
  const inv = await a.peers.createInvite(b.name);
  const preview = await b.peers.previewInvite(inv.code.toLowerCase());
  assert.equal(preview.name, a.name);
  await b.peers.acceptInvite(inv.code);
  await until(() => a.peers.contact(b.peers.address)?.status === "active", a.name + " ve a " + b.name);
  await until(() => b.peers.contact(a.peers.address)?.status === "active", b.name + " ve a " + a.name);
  return { inv, preview };
}

test("protocol: sealed, signed, for one recipient only; requests to the mailbox are signed", () => {
  const a = newIdentity(), b = newIdentity(), c = newIdentity();
  const env = seal(a, { to: b.sign.pub, toBox: b.box.pub, body: { type: "msg", text: "hola" } });
  assert.deepEqual(open(b, env), { type: "msg", text: "hola" });
  assert.ok(!JSON.stringify(env).includes("hola"));
  assert.throws(() => open(c, env), /wrong_recipient/);
  assert.throws(() => open(b, { ...env, to: c.sign.pub }), (e) => e.code === "bad_signature");
  assert.throws(() => open(b, { ...env, ts: env.ts - 40 * 86400 }), (e) => ["expired", "bad_signature"].includes(e.code));
  const header = authHeader(a, "POST", "/v1/send", "{}");
  assert.equal(checkAuth(header, "POST", "/v1/send", "{}").address, a.sign.pub);
  assert.equal(checkAuth(header, "POST", "/v1/send", "{\"x\":1}"), null);
  assert.equal(checkAuth(header, "POST", "/v1/send", "{}", Math.floor(Date.now() / 1000) + 600), null);
  assert.equal(WORDS.length, 256);
  assert.deepEqual(safetyWords(a.sign.pub, b.sign.pub), safetyWords(b.sign.pub, a.sign.pub));
  for (let i = 0; i < 200; i++) {
    const w = safetyWords(newIdentity().sign.pub, a.sign.pub);
    assert.equal(new Set(w).size, 4, "cuatro palabras distintas: " + w.join(" "));
  }
  const code = newInviteCode();
  assert.equal(parseInviteCode(" colmena-" + formatInviteCode(code).slice(8).toLowerCase().replace(/-/g, " ")), code);
  assert.equal(parseInviteCode("COLMENA-1234"), null);
});

test("an invitation connects two Colmenas once, with the same safety words on both sides", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  const inv = await sergio.peers.createInvite("Marta Ruiz");
  assert.match(inv.code, /^COLMENA-(?:[0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.match(inv.text, /Hola Marta, soy Sergio Rico/);
  assert.equal(inviteText("Ana", "Yo", "C"), inviteText("Ana", "Yo", "C"));
  const preview = await marta.peers.previewInvite(inv.code);
  assert.equal(preview.name, "Sergio Rico");
  await marta.peers.acceptInvite(inv.code);
  await until(() => sergio.peers.contact(marta.peers.address)?.status === "active", "Sergio ve a Marta");
  await until(() => marta.peers.contact(sergio.peers.address)?.status === "active", "Marta ve a Sergio");
  const fromSergio = sergio.peers.stateView().contacts[0], fromMarta = marta.peers.stateView().contacts[0];
  assert.equal(fromSergio.name, "Marta Ruiz");
  assert.equal(fromMarta.name, "Sergio Rico");
  assert.deepEqual(fromSergio.words, fromMarta.words);
  assert.deepEqual(fromSergio.words, preview.words);
  assert.ok(sergio.notices.some((n) => /Marta Ruiz ya está en tus personas/.test(n.title)));
  // Used once: the card is gone from the mailbox and the code no longer works.
  await until(async () => { try { await marta.peers.previewInvite(inv.code); return false; } catch (e) { return e.status === 404; } }, "la invitación se borra del buzón");
  const third = await mkdtemp(path.join(os.tmpdir(), "colmena-peers-x-"));
  t.after(() => rm(third, { recursive: true, force: true }));
  // Its own invitation is refused, and a made-up code too.
  const again = await sergio.peers.createInvite("Otra");
  await assert.rejects(sergio.peers.previewInvite(again.code), /la has creado tú/);
  await assert.rejects(marta.peers.previewInvite("COLMENA-0000-0000-0000-0000"), /no existe/);
});

test("a hello without the code is ignored, and strangers cannot write to you", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  await connect(sergio, marta);
  // Luis knows Sergio's address but has no invitation: his envelopes are dropped.
  luis.peers.store.put("peerContacts", { id: sergio.peers.address, box: sergio.peers.identity.box.pub, name: "Sergio", status: "active" });
  luis.peers.enqueue(sergio.peers.address, { type: "hello", invite: "x".repeat(32), proof: "nope", profile: { name: "Luis", box: luis.peers.identity.box.pub } });
  luis.peers.enqueue(sergio.peers.address, { type: "msg", share: dmId(sergio.peers.address, luis.peers.address), id: "11111111-2222-3333-4444-555555555555", at: new Date().toISOString(), text: "¡Gana un premio!" });
  await luis.peers.flushOutbox();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sergio.peers.contact(luis.peers.address), null);
  assert.equal(sergio.store.list("peerMessages").length, 0);
});

test("direct messages: sent, received, seen, reacted; the mailbox keeps nothing it can read", async (t) => {
  const { relay, people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  const dm = dmId(sergio.peers.address, marta.peers.address);
  const sent = sergio.peers.post(dm, "¿Cerramos el programa esta semana?");
  assert.equal(sent.from, "me");
  await until(() => sergio.store.get("peerMessages", sent.id)?.status === "sent", "enviado");
  const got = await until(() => marta.store.get("peerMessages", sent.id), "Marta lo recibe");
  assert.equal(got.text, "¿Cerramos el programa esta semana?");
  assert.equal(marta.peers.stateView().shares.find((s) => s.id === dm).unread, 1);
  assert.equal(marta.peers.stateView().shares.find((s) => s.id === dm).title, "Sergio Rico");
  assert.ok(marta.notices.some((n) => n.title === "Sergio Rico" && n.url === "/con/" + dm));
  marta.peers.seen(dm);
  assert.equal(marta.peers.stateView().shares.find((s) => s.id === dm).unread, 0);
  await until(() => sergio.peers.messages(dm).messages.at(-1).seenBy.includes("Marta Ruiz"), "visto por Marta");
  marta.peers.react(sent.id, "👍");
  await until(() => sergio.peers.messages(dm).messages.at(-1).reactions.find((r) => r.emoji === "👍" && r.who.includes("Marta Ruiz")), "la reacción llega");
  marta.peers.react(sent.id, "👍");
  await until(() => !sergio.peers.messages(dm).messages.at(-1).reactions.length, "la reacción se quita");
  const reply = marta.peers.post(dm, "Sí, el jueves.");
  await until(() => sergio.store.get("peerMessages", reply.id), "la respuesta llega");
  assert.deepEqual(sergio.peers.messages(dm).messages.map((m) => [m.from === "me" ? "yo" : m.author.name, m.text]), [["yo", "¿Cerramos el programa esta semana?"], ["Marta Ruiz", "Sí, el jueves."]]);
  // None of it is readable at the mailbox.
  assert.ok(relay.url);
  const raw = await readFile(path.join(path.dirname(sergio.store.directory), "relay", "relay.sqlite")).catch(() => Buffer.alloc(0));
  assert.ok(!raw.includes(Buffer.from("jueves")) && !raw.includes(Buffer.from("Cerramos")));
});

test("a message written while the other Colmena is closed arrives when it opens", async (t) => {
  const { relay, people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  const dm = dmId(sergio.peers.address, marta.peers.address);
  marta.peers.client.stop();
  const m = sergio.peers.post(dm, "Te lo dejo aquí para cuando vuelvas.");
  await until(() => sergio.store.get("peerMessages", m.id)?.status === "sent", "el buzón lo guarda");
  assert.equal(marta.store.get("peerMessages", m.id), null);
  marta.peers.connect();
  await until(() => marta.store.get("peerMessages", m.id), "llega al volver");
  assert.ok(relay.url);
});

test("a group of three: the owner signs who is in it, everyone gets every message once", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  await connect(sergio, marta);
  await connect(sergio, luis);
  // Marta and Luis do not know each other: Sergio's group introduces them.
  const group = sergio.peers.createGroup("viaje-lisboa", [marta.peers.address, luis.peers.address]);
  assert.equal(group.members.length, 3);
  assert.equal(group.more, 1);
  await until(() => marta.store.get("peerShares", group.id) && luis.store.get("peerShares", group.id), "los dos reciben la sala");
  assert.equal(marta.peers.contact(luis.peers.address).status, "known");
  assert.ok(marta.notices.some((n) => /te ha añadido a «viaje-lisboa»/.test(n.title)));
  const hi = marta.peers.post(group.id, "Tenemos que vernos antes del viaje.");
  await until(() => sergio.store.get("peerMessages", hi.id) && luis.store.get("peerMessages", hi.id), "Sergio y Luis lo reciben");
  assert.equal(luis.peers.messages(group.id).messages[0].author.name, "Marta Ruiz");
  const yes = luis.peers.post(group.id, "Me apunto, por las mañanas.");
  await until(() => sergio.store.get("peerMessages", yes.id) && marta.store.get("peerMessages", yes.id), "todos reciben a Luis");
  const view = sergio.peers.stateView().shares.find((s) => s.id === group.id);
  assert.equal(view.title, "viaje-lisboa");
  assert.equal(view.face.name, "Luis Gómez"); // the last one who wrote is the face of the row
  assert.equal(view.more, 1);
  // A «known» person cannot open a direct line: only the group.
  luis.peers.store.patch("peerContacts", marta.peers.address, { status: "active" });
  const sneaky = luis.peers.post(luis.peers.ensureDm(marta.peers.address).id, "Escríbeme a mí solo");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(marta.store.get("peerMessages", sneaky.id), null);
  // Luis leaves: the others see it; the owner signs the new list.
  luis.peers.leave(group.id);
  await until(() => sergio.store.get("peerShares", group.id).members.length === 2, "Sergio quita a Luis");
  await until(() => marta.store.get("peerShares", group.id).members.length === 2, "Marta recibe la lista nueva");
  const after = sergio.peers.post(group.id, "Seguimos Marta y yo.");
  await until(() => marta.store.get("peerMessages", after.id), "Marta lo recibe");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(luis.store.get("peerMessages", after.id), null);
});

test("only the owner changes who is in a group", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  await connect(sergio, marta);
  await connect(sergio, luis);
  const group = sergio.peers.createGroup("equipo", [marta.peers.address, luis.peers.address]);
  await until(() => luis.store.get("peerShares", group.id), "Luis recibe la sala");
  assert.throws(() => marta.peers.addMembers(group.id, [luis.peers.address]), /Solo quien creó/);
  // A forged list from Marta (not the owner) is ignored by Luis.
  luis.peers.store.patch("peerContacts", marta.peers.address, { status: "known" });
  marta.peers.enqueue(luis.peers.address, { type: "share", share: { id: group.id, kind: "group", title: "robada", owner: marta.peers.address, version: 9, members: [] } });
  await marta.peers.flushOutbox();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(luis.store.get("peerShares", group.id).title, "equipo");
  assert.equal(luis.store.get("peerShares", group.id).members.length, 3);
});

test("typing and presence are live only: never stored", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  // Right after connecting, each one sees the other as connected (no heartbeat needed).
  await until(() => sergio.peers.online(marta.peers.address) && marta.peers.online(sergio.peers.address), "conectados nada más aceptar");
  const dm = dmId(sergio.peers.address, marta.peers.address);
  const seen = [];
  sergio.peers.on("live", (e) => seen.push(e));
  marta.peers.broadcastPresence("online");
  marta.peers.typingNow(dm);
  await until(() => seen.some((e) => e.type === "typing" && e.names.includes("Marta Ruiz")), "escribiendo");
  await until(() => sergio.peers.online(marta.peers.address), "Marta conectada");
  assert.ok(!sergio.store.list("peerMessages").length);
  assert.ok(sergio.store.list("peerSeen").every((r) => r.id));
});

test("removing a contact tells them and stops their messages", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  const dm = dmId(sergio.peers.address, marta.peers.address);
  sergio.peers.removeContact(marta.peers.address);
  await until(() => marta.peers.contact(sergio.peers.address)?.status === "removed", "Marta se entera");
  assert.throws(() => marta.peers.post(dm, "¿Hola?"), /Ya no estás/);
  assert.equal(sergio.peers.stateView().contacts.length, 0);
});

test("the mailbox caps what one sender leaves in one mailbox, and live notes per minute", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-quota-"));
  const relay = await startRelay({ port: 0, directory: path.join(base, "relay"), limits: { perSenderDay: 3, livePerMinute: 2 } });
  t.after(async () => { await relay.close(); await rm(base, { recursive: true, force: true }); });
  const a = newIdentity(), b = newIdentity();
  const send = async (ephemeral = false) => {
    const env = seal(a, { to: b.sign.pub, toBox: b.box.pub, body: { type: "msg", text: "hola" } });
    const body = JSON.stringify({ to: b.sign.pub, env, ...(ephemeral ? { ephemeral: true } : {}) });
    return (await fetch(relay.url + "/v1/send", { method: "POST", headers: { Authorization: authHeader(a, "POST", "/v1/send", body) }, body })).status;
  };
  assert.deepEqual([await send(), await send(), await send(), await send()], [200, 200, 200, 429]);
  assert.deepEqual([await send(true), await send(true), await send(true)], [200, 200, 429]);
});

test("live notes only go to who is connected (each one costs a request at the mailbox)", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  await until(() => sergio.peers.online(marta.peers.address), "Marta conectada");
  const sent = [];
  const real = sergio.peers.client.send.bind(sergio.peers.client);
  sergio.peers.client.send = (to, env, opts) => { if (opts?.ephemeral) sent.push(to); return real(to, env, opts); };
  sergio.peers.heartbeat();
  assert.equal(sent.length, 1, "a Marta, que está conectada");
  // Marta leaves: no more typing or heartbeats to her.
  marta.peers.stop();
  await until(() => !sergio.peers.online(marta.peers.address), "Marta ya no está");
  sent.length = 0;
  sergio.peers.heartbeat();
  sergio.peers.typingNow(dmId(sergio.peers.address, marta.peers.address));
  assert.equal(sent.length, 0);
});
