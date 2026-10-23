// «Personas» phase 3: bots of different owners agree a meeting. Each Colmena shares only busy
// blocks (by its owner's rule for whoever asks), the organizer alone sees them, everyone votes,
// and each one puts the agreed slot in its own calendar with no guests.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Peers } from "../server/peers/service.mjs";
import { PeerBots } from "../server/peers/bots.mjs";
import { Meetings, isMeetingRequest, parseRequest } from "../server/peers/meetings.mjs";
import { busyFromEvents, freeSlots, mergeBlocks } from "../server/peers/calendar.mjs";
import { startRelay } from "../relay/server.mjs";

const until = async (fn, what, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error("No llegó a cumplirse: " + what);
    await new Promise((r) => setTimeout(r, 30));
  }
};
const day = (base, n, h, m = 0) => { const d = new Date(base); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
const nextMonday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return d; };

test("what is asked: minutes, days and part of the day, from the request and the last messages", () => {
  assert.ok(isMeetingRequest("@Atlas búscanos un hueco con Leo y Nico"));
  assert.ok(isMeetingRequest("¿cuándo podemos vernos?"));
  assert.ok(!isMeetingRequest("@Vera resume lo que tenemos"));
  const now = new Date(2026, 9, 21, 10, 0).getTime(); // a Wednesday
  const r = parseRequest(["@Atlas búscanos un hueco, por las mañanas mejor", "Tenemos que vernos antes del viaje. ¿La semana que viene, 45 minutos?"], now);
  assert.equal(r.minutes, 45);
  assert.deepEqual([r.dayStart, r.dayEnd], ["09:00", "13:30"]);
  assert.equal(new Date(r.from).getDay(), 1);
  assert.equal(new Date(r.from).getDate(), 26);
  assert.equal(parseRequest("media hora esta tarde", now).minutes, 30);
  assert.equal(parseRequest("una hora por las tardes", now).dayStart, "15:00");
  const d = parseRequest("quedamos", now);
  assert.equal(d.minutes, 45);
  assert.ok(Date.parse(d.to) - Date.parse(d.from) <= 14 * 86400000);
});

test("busy blocks keep only times (rounded out to 15 min); free slots avoid them, on weekdays", () => {
  const blocks = busyFromEvents([
    { summary: "Médico", location: "Calle Mayor", attendees: [{ email: "x@y.z" }], start: { dateTime: "2026-10-26T09:10:00+01:00" }, end: { dateTime: "2026-10-26T10:05:00+01:00" } },
    { summary: "Libre", transparency: "transparent", start: { dateTime: "2026-10-26T11:00:00+01:00" }, end: { dateTime: "2026-10-26T12:00:00+01:00" } },
    { summary: "Cancelada", status: "cancelled", start: { dateTime: "2026-10-26T12:00:00+01:00" }, end: { dateTime: "2026-10-26T13:00:00+01:00" } },
    { summary: "Festivo", start: { date: "2026-10-27" }, end: { date: "2026-10-28" } },
  ], "2026-10-26T00:00:00+01:00", "2026-10-31T00:00:00+01:00");
  assert.deepEqual(blocks, [{ s: new Date("2026-10-26T09:00:00+01:00").toISOString(), e: new Date("2026-10-26T10:15:00+01:00").toISOString() }]);
  assert.ok(!JSON.stringify(blocks).match(/Médico|Mayor|x@y/));
  assert.equal(mergeBlocks([{ s: "2026-10-26T09:00:00Z", e: "2026-10-26T10:00:00Z" }, { s: "2026-10-26T10:00:00Z", e: "2026-10-26T11:00:00Z" }]).length, 1);
  const mon = nextMonday();
  const busy = [{ s: day(mon, 0, 9), e: day(mon, 0, 13) }, { s: day(mon, 1, 9), e: day(mon, 1, 10) }];
  const slots = freeSlots({ from: mon.toISOString(), to: day(mon, 7, 0), dayStart: "09:00", dayEnd: "13:30", minutes: 45, busy, now: Date.now() });
  assert.equal(slots.length, 3);
  for (const s of slots) {
    const d = new Date(s.s);
    assert.ok(d.getDay() >= 1 && d.getDay() <= 5, "entre semana");
    assert.ok(!busy.some((b) => Date.parse(s.s) < Date.parse(b.e) && Date.parse(s.e) > Date.parse(b.s)), "sin pisar lo ocupado");
  }
  assert.equal(new Date(slots[0].s).getDate(), new Date(day(mon, 1, 10)).getDate()); // Monday morning is full
  assert.equal(new Date(slots[0].s).getHours(), 10);
  assert.equal(new Set(slots.map((s) => new Date(s.s).toDateString())).size, 3, "un hueco por día");
  assert.equal(slots.filter((s) => s.calm).length, 1);
  // Only one day free: the slots on it are real alternatives, not 15 minutes apart.
  const one = freeSlots({ from: day(mon, 2, 0), to: day(mon, 3, 0), dayStart: "09:00", dayEnd: "13:30", minutes: 45, busy: [], now: Date.now() });
  assert.equal(one.length, 3);
  for (let i = 1; i < one.length; i++) assert.ok(Date.parse(one[i].s) - Date.parse(one[i - 1].s) >= 90 * 60000);
});

async function world(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-meet-"));
  // COLMENA_TEST_RELAY=<url> runs the same test against another mailbox (the Cloudflare one).
  const relay = process.env.COLMENA_TEST_RELAY ? { url: process.env.COLMENA_TEST_RELAY, close: async () => {} } : await startRelay({ port: 0, directory: path.join(base, "relay") });
  const mon = nextMonday();
  // Their agendas (only this code sees the titles).
  const agendas = {
    "Sergio Rico": [{ s: day(mon, 0, 9), e: day(mon, 0, 13, 30), title: "Comité de dirección" }],
    "Marta Ruiz": [{ s: day(mon, 1, 9), e: day(mon, 1, 10, 30), title: "Dentista" }],
    "Luis Gómez": [{ s: day(mon, 1, 11), e: day(mon, 1, 13), title: "Entrevista con un cliente" }],
  };
  const people = [];
  for (const name of Object.keys(agendas)) {
    const store = new Store(path.join(base, name.split(" ")[0]));
    const created = [];
    const calendar = {
      reads: 0,
      async busy(from, to) { this.reads++; return { calendar: true, blocks: busyFromEvents(agendas[name].map((e) => ({ summary: e.title, start: { dateTime: e.s }, end: { dateTime: e.e } })), from, to) }; },
      async create(event) { created.push(event); return { ok: true, calendar: true }; },
    };
    const peers = await new Peers({ store, vault: null, relayUrl: relay.url, nameOf: () => name, log: () => {} }).start();
    peers.meetings = new Meetings({ peers, store, calendar, log: () => {} }).start();
    const runtime = { infer: async () => ({ text: "ok" }), modelFor: () => "m", reasoningFor: () => null };
    const bots = new PeerBots({ peers, store, runtime, log: () => {} }).start();
    people.push({ name, store, peers, calendar, created, bots });
  }
  t.after(async () => {
    for (const p of people) { p.bots.stop(); p.peers.meetings.stop(); p.peers.stop(); p.store.close(); }
    await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  await until(() => people.every((p) => p.peers.relayStatus.status === "online"), "conectados");
  const [sergio, marta, luis] = people;
  for (const other of [marta, luis]) {
    const inv = await sergio.peers.createInvite(other.name);
    await other.peers.acceptInvite(inv.code);
    await until(() => sergio.peers.contact(other.peers.address)?.status === "active" && other.peers.contact(sergio.peers.address)?.status === "active", "contacto con " + other.name);
  }
  const group = sergio.peers.createGroup("viaje-lisboa", [marta.peers.address, luis.peers.address]);
  await until(() => marta.store.get("peerShares", group.id) && luis.store.get("peerShares", group.id), "la sala llega");
  return { people, group, mon };
}

test("three owners: free/busy only, the organizer alone sees it, all agree, each one's own calendar", async (t) => {
  const { people: [sergio, marta, luis], group } = await world(t);
  // Marta lets Sergio see when she is free without asking; Luis keeps «Pregúntame».
  marta.peers.updateContact(sergio.peers.address, { asks: { libre: "siempre" } });
  sergio.peers.post(group.id, "@Atlas búscanos un hueco la semana que viene, 45 minutos, por las mañanas");
  await sergio.bots.idle();
  const id = sergio.store.list("peerMeetings")[0]?.id;
  assert.ok(id, "Sergio's Atlas organizes it");
  // Marta's Colmena answers alone; Luis is asked first.
  await until(() => sergio.peers.meetings.get(id).answers[marta.peers.address]?.status === "shared", "Marta comparte libre/ocupado");
  const lm = await until(() => luis.peers.meetings.get(id), "a Luis le llega la petición");
  assert.equal(lm.ask, "pending");
  assert.equal(luis.calendar.reads, 0, "nada se mira sin su OK");
  const preview = await luis.peers.meetings.preview(id);
  assert.equal(preview.blocks.length, 1);
  assert.ok(!JSON.stringify(preview).includes("Entrevista"));
  await luis.peers.meetings.shareFree(id);
  // The organizer gets everyone's blocks; nobody else does, and no titles anywhere.
  const m = await until(() => sergio.peers.meetings.get(id).status === "voting" && sergio.peers.meetings.get(id), "huecos propuestos");
  assert.equal(m.slots.length, 3);
  assert.ok(!JSON.stringify(m).match(/Dentista|Entrevista|Comité/));
  const atMarta = await until(() => marta.peers.meetings.get(id)?.status === "voting" && marta.peers.meetings.get(id), "Marta ve los huecos");
  assert.equal(atMarta.blocks, undefined);
  assert.deepEqual(atMarta.slots, m.slots);
  for (const s of m.slots) {
    for (const p of [sergio, marta, luis]) {
      // No proposed slot touches anyone's busy time.
      const name = p.name;
      assert.ok(!(name === "Sergio Rico" && new Date(s.s).getDay() === 1 && new Date(s.s).getHours() < 14));
    }
  }
  // The card shows in the conversation for everyone.
  const card = marta.peers.messages(group.id).messages.find((x) => x.card?.kind === "meeting");
  assert.equal(card.bot.name, "Atlas");
  assert.equal(card.meeting.status, "voting");
  // Everyone says yes to the same slot.
  sergio.peers.meetings.vote(id, 0);
  marta.peers.meetings.vote(id, 0);
  await until(() => sergio.peers.meetings.get(id).votes[marta.peers.address] === 0, "el voto de Marta llega");
  assert.equal(sergio.peers.meetings.get(id).status, "voting");
  luis.peers.meetings.vote(id, 0);
  await until(() => [sergio, marta, luis].every((p) => p.peers.meetings.get(id)?.created?.status === "done"), "cada uno lo apunta en su calendario");
  for (const p of [sergio, marta, luis]) {
    assert.equal(p.created.length, 1);
    assert.equal(p.created[0].start, m.slots[0].s);
    assert.equal(p.created[0].minutes, 45);
    assert.equal(p.created[0].attendees, undefined);
  }
});

test("«Nunca» declines; a slot nobody can take brings new ones; only the organizer speaks for it", async (t) => {
  const { people: [sergio, marta, luis], group } = await world(t);
  luis.peers.updateContact(sergio.peers.address, { asks: { libre: "nunca" } });
  marta.peers.updateContact(sergio.peers.address, { asks: { libre: "siempre" } });
  sergio.peers.post(group.id, "@Atlas ¿cuándo podemos quedar media hora?");
  await sergio.bots.idle();
  const id = sergio.store.list("peerMeetings")[0].id;
  await until(() => sergio.peers.meetings.get(id).status === "voting", "huecos sin la agenda de Luis");
  assert.equal(sergio.peers.meetings.get(id).answers[luis.peers.address].status, "declined");
  assert.equal(luis.calendar.reads, 0);
  const first = sergio.peers.meetings.get(id).slots;
  // Marta forges the meeting's state: Luis ignores it (she is not the organizer).
  await until(() => luis.peers.meetings.get(id)?.status === "voting", "Luis ve los huecos");
  marta.peers.enqueue(luis.peers.address, { type: "meet.state", meeting: { id, status: "confirmed", slots: first, votes: {}, answers: {}, confirmed: first[0] } });
  await marta.peers.flushOutbox();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(luis.peers.meetings.get(id).status, "voting");
  // Luis says none fits: a new round with other slots.
  sergio.peers.meetings.vote(id, 0);
  marta.peers.meetings.vote(id, 0);
  luis.peers.meetings.vote(id, -1);
  await until(() => sergio.peers.meetings.get(id).round === 2, "otra ronda");
  const second = sergio.peers.meetings.get(id).slots;
  assert.ok(second.length && !second.some((s) => first.some((f) => f.s === s.s)));
  assert.equal(sergio.created.length, 0);
});
