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

const until_ = (...args) => until(...args); // for tests with a local named «until»

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
  // Ready to paste in WhatsApp or a mail: who, where to get Colmena, the code on its own line.
  assert.match(inv.text, /^Hola Marta, soy Sergio Rico\./);
  assert.ok(inv.text.includes("https://github.com/SergioRico1/Colmena/releases/latest"));
  assert.ok(inv.text.split("\n").includes(inv.code));
  assert.match(inviteText("Ana Pérez", "Yo", "C"), /^Hola Ana, soy Yo\./);
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

test("opening a Colmena a moment after the other: both see each other connected", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  // Sergio says «online» while Marta is closed (it never reaches her); she opens seconds later.
  marta.peers.client.stop();
  marta.peers.presence.delete(sergio.peers.address);
  sergio.peers.presence.delete(marta.peers.address);
  sergio.peers.broadcastPresence("online");
  await new Promise((r) => setTimeout(r, 200));
  marta.peers.connect();
  await until(() => sergio.peers.online(marta.peers.address) && marta.peers.online(sergio.peers.address), "se ven conectados");
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

test("statuses: «No molestar» and «Fuera hasta…» reach your contacts, expire, and silence your notices", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  const until = new Date(Date.now() + 3 * 864e5).toISOString();
  marta.peers.setStatus("away", until);
  await until_(() => sergio.peers.contactView(sergio.peers.contact(marta.peers.address)).away?.mode === "away", "Sergio ve que Marta está fuera");
  assert.equal(sergio.peers.contactView(sergio.peers.contact(marta.peers.address)).away.until, until);
  assert.equal(marta.peers.stateView().me.status.mode, "away");
  // While she is away nothing pops for her (it is kept in Hoy); back to available, it does.
  const { shouldPop, statusNow } = await import("../server/notifications.mjs");
  assert.equal(shouldPop(marta.store.get("settings", "main"), "mention"), false);
  marta.peers.setStatus("available");
  assert.equal(shouldPop(marta.store.get("settings", "main"), "mention"), true);
  await until_(() => !sergio.peers.contactView(sergio.peers.contact(marta.peers.address)).away, "vuelve a estar disponible");
  // An expired status is «available» everywhere.
  assert.equal(statusNow({ status: { mode: "dnd", until: new Date(Date.now() - 1000).toISOString() } }).mode, "available");
  assert.throws(() => marta.peers.setStatus("dnd", new Date(Date.now() - 1000).toISOString()), /aún no haya pasado/);
});

test("a message that names you is a «mention» (its own sound); others are «message»", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  const dm = dmId(sergio.peers.address, marta.peers.address);
  sergio.peers.post(dm, "Hola");
  sergio.peers.post(dm, "Marta, mira esto", { people: [marta.peers.address] });
  await until_(() => marta.notices.filter((n) => n.url === "/con/" + dm).length >= 2, "llegan los avisos");
  const kinds = marta.notices.filter((n) => n.url === "/con/" + dm).map((n) => n.kind);
  assert.deepEqual(kinds.slice(-2), ["message", "mention"]);
  assert.match(marta.notices.at(-1).title, /te ha mencionado/);
  const { delivery } = await import("../server/notifications.mjs");
  assert.equal(delivery({}, "mention").sound, "mention");
  assert.equal(delivery({}, "message").sound, "message");
});

test("threads: replies stay in their thread, the root counts them, and only those in it are called", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  await connect(sergio, marta);
  await connect(sergio, luis);
  const group = sergio.peers.createGroup("viaje-lisboa", [marta.peers.address, luis.peers.address]);
  await until(() => marta.store.get("peerShares", group.id) && luis.store.get("peerShares", group.id), "los dos reciben la sala");
  const root = marta.peers.post(group.id, "¿Hotel o apartamento?");
  await until(() => sergio.store.get("peerMessages", root.id) && luis.store.get("peerMessages", root.id), "llega la pregunta");
  const before = luis.notices.length;
  const reply = sergio.peers.post(group.id, "Apartamento, cerca de Alfama.", { thread: root.id });
  // A reply to a reply goes to the same thread.
  const again = sergio.peers.post(group.id, "O en Chiado.", { thread: reply.id });
  assert.equal(again.thread, root.id);
  await until(() => marta.store.get("peerMessages", again.id) && luis.store.get("peerMessages", again.id), "llegan las respuestas");
  // Marta wrote the root: she is called; Luis is not in the thread: no notice, no unread.
  assert.match(marta.notices.at(-1).title, /ha respondido en un hilo/);
  assert.ok(marta.notices.at(-1).url.endsWith("?hilo=" + root.id));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(luis.notices.length, before);
  const page = luis.peers.messages(group.id);
  assert.deepEqual(page.messages.map((m) => m.id), [root.id]);
  assert.equal(page.messages[0].replies.count, 2);
  assert.equal(page.messages[0].replies.people[0].initials, "SR");
  const thread = luis.peers.messages(group.id, { thread: root.id });
  assert.equal(thread.root.id, root.id);
  assert.deepEqual(thread.messages.map((m) => m.text), ["Apartamento, cerca de Alfama.", "O en Chiado."]);
  // Once Luis replies he is in it.
  luis.peers.post(group.id, "Yo prefiero hotel.", { thread: root.id });
  const n = luis.notices.length;
  marta.peers.post(group.id, "Votamos mañana.", { thread: root.id });
  await until(() => luis.notices.length > n, "Luis ya está en el hilo");
});

test("edit and delete: only the author's own Colmena can change a message, for everyone", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  await connect(sergio, marta);
  await connect(sergio, luis);
  const group = sergio.peers.createGroup("viaje-lisboa", [marta.peers.address, luis.peers.address]);
  await until(() => marta.store.get("peerShares", group.id) && luis.store.get("peerShares", group.id), "los dos reciben la sala");
  const m = sergio.peers.post(group.id, "Salimos el viernes a las 8");
  await until(() => marta.store.get("peerMessages", m.id) && luis.store.get("peerMessages", m.id), "llega");
  const edited = sergio.peers.edit(m.id, "Salimos el viernes a las 9");
  assert.ok(edited.edited);
  await until(() => marta.store.get("peerMessages", m.id).text === "Salimos el viernes a las 9" && luis.store.get("peerMessages", m.id).text.endsWith("9"), "llega la edición");
  assert.ok(marta.peers.messages(group.id).messages.find((x) => x.id === m.id).edited);
  assert.equal(marta.store.get("peerShares", group.id).lastLine, "Salimos el viernes a las 9");
  // Nobody else can: not through the API...
  assert.throws(() => marta.peers.edit(m.id, "Salimos el sábado"), /no se puede editar/);
  assert.throws(() => marta.peers.unsend(m.id), /no se puede borrar/);
  // ...nor by sending a signed «edit» of someone else's message from their own Colmena.
  marta.peers.enqueue(luis.peers.address, { type: "edit", share: group.id, msg: m.id, text: "Cancelado", at: new Date().toISOString() });
  marta.peers.enqueue(luis.peers.address, { type: "unsend", share: group.id, msg: m.id });
  void marta.peers.flushOutbox();
  const probe = marta.peers.post(group.id, "sigo aquí");
  await until(() => luis.store.get("peerMessages", probe.id), "llega lo de después");
  assert.equal(luis.store.get("peerMessages", m.id).text, "Salimos el viernes a las 9");
  // The author deletes it: «Mensaje borrado» everywhere, nothing of the text left.
  const gone = sergio.peers.unsend(m.id);
  assert.equal(gone.deleted, true);
  assert.equal(gone.text, "");
  await until(() => marta.store.get("peerMessages", m.id).deletedAt && luis.store.get("peerMessages", m.id).deletedAt, "se borra en todas");
  assert.equal(luis.store.get("peerMessages", m.id).text, "");
  assert.throws(() => sergio.peers.edit(m.id, "otra vez"), /no se puede editar/);
  assert.equal(marta.peers.search("viernes").hits.length, 0);
});

test("search: every word, accents and case out, newest first, in one conversation or all", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  const dm = dmId(sergio.peers.address, marta.peers.address);
  const a = sergio.peers.post(dm, "La reunión con el cliente de Lisboa es el martes.");
  const b = sergio.peers.post(dm, "Otra reunion, la de presupuesto, el jueves.");
  await until(() => marta.store.get("peerMessages", a.id) && marta.store.get("peerMessages", b.id), "llegan");
  const all = marta.peers.search("REUNION");
  assert.deepEqual(all.hits.map((h) => h.id), [b.id, a.id]);
  assert.equal(all.hits[0].author, "Sergio Rico");
  assert.equal(all.hits[0].title, "Sergio Rico");
  assert.deepEqual(marta.peers.search("reunión lisboa").hits.map((h) => h.id), [a.id]);
  assert.deepEqual(marta.peers.search("lisboa", { shareId: "dm-otra" }).hits, []);
  assert.deepEqual(marta.peers.search("a").hits, []);
  assert.match(marta.peers.search("cliente").hits[0].snippet, /cliente de Lisboa/);
});

test("rooms with roles: the owner renames, makes someone a guest, takes someone out; lists are signed", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  await connect(sergio, marta);
  await connect(sergio, luis);
  const group = sergio.peers.createGroup("viaje-lisboa", [marta.peers.address, luis.peers.address]);
  await until(() => marta.store.get("peerShares", group.id) && luis.store.get("peerShares", group.id), "los dos reciben la sala");
  sergio.peers.renameGroup(group.id, "viaje-oporto");
  await until(() => marta.store.get("peerShares", group.id).title === "viaje-oporto", "Marta ve el nombre nuevo");
  sergio.peers.setRole(group.id, luis.peers.address, "guest");
  await until(() => marta.peers.roleOf(marta.store.get("peerShares", group.id), luis.peers.address) === "guest", "Luis es invitado para Marta");
  assert.equal(marta.peers.shareView(marta.store.get("peerShares", group.id)).members.find((m) => m.id === luis.peers.address).role, "guest");
  // Only the owner: Marta cannot, and a list «from Sergio» with a bad signature is ignored.
  assert.throws(() => marta.peers.removeMember(group.id, luis.peers.address), /Solo quien creó/);
  const forged = { ...sergio.peers.roster(sergio.store.get("peerShares", group.id)), title: "hackeada", version: 99 };
  sergio.peers.enqueue(marta.peers.address, { type: "share", share: forged });
  void sergio.peers.flushOutbox();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(marta.store.get("peerShares", group.id).title, "viaje-oporto");
  // Luis is taken out: he is told, and gets nothing more.
  sergio.peers.removeMember(group.id, luis.peers.address);
  await until(() => luis.store.get("peerShares", group.id).removedAt, "Luis ya no está");
  assert.ok(luis.notices.some((n) => /te ha quitado de «viaje-oporto»/.test(n.title)));
  await until(() => marta.store.get("peerShares", group.id).members.length === 2, "Marta recibe la lista nueva");
  const after = sergio.peers.post(group.id, "Seguimos Marta y yo.");
  await until(() => marta.store.get("peerMessages", after.id), "Marta lo recibe");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(luis.store.get("peerMessages", after.id), null);
});

test("an invitation straight into a room: the code connects you and puts you in it with your role", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  await connect(sergio, marta);
  const group = sergio.peers.createGroup("presupuesto-2027", [marta.peers.address]);
  const inv = await sergio.peers.createInvite("Luis Gómez", { room: group.id, role: "guest" });
  assert.equal(inv.room, "presupuesto-2027");
  assert.match(inv.text, /a la conversación «presupuesto-2027»/);
  const preview = await luis.peers.previewInvite(inv.code);
  assert.equal(preview.room, "presupuesto-2027");
  await luis.peers.acceptInvite(inv.code);
  await until(() => luis.store.get("peerShares", group.id), "Luis está en la sala");
  assert.equal(luis.peers.roleOf(luis.store.get("peerShares", group.id), luis.peers.address), "guest");
  await until(() => marta.store.get("peerShares", group.id).members.some((m) => m.id === luis.peers.address), "Marta lo ve en la lista");
  // Only for rooms of yours.
  await assert.rejects(marta.peers.createInvite("Otra", { room: group.id }), /Solo quien creó/);
});

test("presence out of order: an «online» older than the «away» that came first changes nothing", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await connect(sergio, marta);
  const c = sergio.peers.contact(marta.peers.address);
  const t0 = Date.now();
  sergio.peers.dispatch(c, { type: "presence", state: "away", sent: t0 + 1000 });
  assert.equal(sergio.peers.online(marta.peers.address), false);
  sergio.peers.dispatch(c, { type: "presence", state: "online", sent: t0 + 500 });
  assert.equal(sergio.peers.online(marta.peers.address), false);
  sergio.peers.dispatch(c, { type: "presence", state: "online", sent: t0 + 2000 });
  assert.equal(sergio.peers.online(marta.peers.address), true);
});
