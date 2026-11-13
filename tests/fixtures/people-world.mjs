// Colmenas of several people on a local mailbox (relay/server.mjs), each with a scripted model:
// the world tests/room-bots.test.mjs builds, shared by the tests of the rules of shared rooms
// and teams (tests/room-rules.test.mjs, tests/team-rules.test.mjs).
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { answer } from "./runtime-fixture.mjs";
import { Store } from "../../server/store.mjs";
import { Runtime } from "../../server/runtime.mjs";
import { Connections } from "../../server/connections.mjs";
import { createApp } from "../../server/app.mjs";
import { Peers } from "../../server/peers/service.mjs";
import { Teams } from "../../server/peers/teams.mjs";
import { PeerBots } from "../../server/peers/bots.mjs";
import { PeerFiles, artifactSource } from "../../server/peers/files.mjs";
import { Errands } from "../../server/peers/errands.mjs";
import { Rooms } from "../../server/room.mjs";
import { roomTimeline } from "../../server/room-timeline.mjs";
import { startRelay } from "../../relay/server.mjs";

export const until = async (fn, what = "condición", ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error("No llegó a cumplirse: " + what);
    await new Promise((r) => setTimeout(r, 30));
  }
};
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const addr = (p) => p.peers.address;
const messageView = (m) => ({ id: m.id, role: m.role, botId: m.botId ?? null, text: m.text || "", at: m.at, kind: m.kind || "message", ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
const stepView = (s) => ({ id: s.id, status: s.status });
export const timeline = (p, id) => roomTimeline({ store: p.store, room: p.rooms.must(id), peers: p.rooms.peers, me: p.rooms.me(), messageView, stepView, work: p.rooms.work });
export const peerRows = (p, shareId) => p.store.ordered("peerMessages", "shareId", shareId, { asc: true });
export const names = (params) => params.tools.map((t) => t.name);
export const lines = (p, room) => timeline(p, room.id).items.filter((x) => x.engine === "line").map((x) => x.text);

/** A Gmail account behind the connections hub: reads return `inbox`, everything committed is noted in `effects`. */
export function hub(effects, inbox = { messages: [] }) {
  return {
    dispatch: async (_profile, op, args) => {
      if (op === "status") return { configured: true, provider: "Composio" };
      if (op === "prepare") {
        const tool = String(args.tool);
        const read = /FETCH|LIST|GET/.test(tool);
        return { proposal: "p-" + tool, tool, toolkit: "gmail", name: tool, account: args.account, account_alias: "Personal", arguments: JSON.parse(args.arguments_json), read_scope: read ? "read-v1" : null, read_grant: read ? "grant-read" : null };
      }
      if (op === "commit") {
        effects.push(args.proposal);
        return /FETCH|LIST|GET/.test(args.proposal) ? { ok: true, data: inbox } : { ok: true, data: { id: "done" } };
      }
      return {};
    },
  };
}

/**
 * `people` on one mailbox. Each: {name, store, runtime, peers, teams, rooms, bots, connections,
 * calls (what the model was sent), out (every envelope it sealed), notices, live, effects, skew,
 * reply}. `app`: names served over HTTP too (`call`). `inbox`: what a mail read returns.
 */
export async function world(t, people = ["Sergio Rico", "Marta Ruiz"], { app = [], inbox = undefined, web = async (url) => ({ url, finalUrl: url, title: "Página", text: "Contenido de la página.", truncated: false, untrusted: true }) } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-people-"));
  let relay = await startRelay({ port: 0, directory: path.join(base, "relay") });
  const url = relay.url, port = Number(new URL(url).port);
  const made = [];
  const open = async (name, { offline = false } = {}) => {
    const store = new Store(path.join(base, name.split(" ")[0]));
    store.patch("settings", "main", { model: "fixture", learning: false, userName: name });
    const p = { name, store, notices: [], calls: [], out: [], live: [], effects: [], skew: 0, reply: () => answer("Hecho.") };
    p.connections = new Connections(store, hub(p.effects, inbox));
    p.runtime = new Runtime(store, { respond: async (params) => { p.calls.push(params); return p.reply(params); } }, p.connections, { web });
    p.peers = new Peers({ store, vault: null, relayUrl: url, nameOf: () => name, notifier: { notify: (n) => p.notices.push(n) }, log: () => {}, clock: () => Date.now() + p.skew });
    const enqueue = p.peers.enqueue.bind(p.peers), ephemeral = p.peers.ephemeral.bind(p.peers);
    p.peers.enqueue = (to, body, options) => { p.out.push({ to, body, kept: true }); return enqueue(to, body, options); };
    p.peers.ephemeral = (to, body, options) => { p.out.push({ to, body, kept: false }); return ephemeral(to, body, options); };
    p.peers.on("live", (event) => p.live.push(event));
    p.teams = new Teams({ peers: p.peers }).start();
    if (app.includes(name)) {
      let origin;
      const web2 = createApp({ store, runtime: p.runtime, session: { status: () => null, models: [] }, getOrigin: () => origin });
      web2.locals.peers = p.peers;
      p.rooms = web2.locals.rooms;
      p.server = http.createServer(web2);
      await new Promise((r) => p.server.listen(0, "127.0.0.1", r));
      origin = "http://127.0.0.1:" + p.server.address().port;
      const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
      p.call = async (method, route, body) => {
        const res = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }) });
        return { status: res.status, json: await res.json() };
      };
    } else p.rooms = new Rooms({ store, runtime: p.runtime, getPeers: () => p.peers, log: () => {} }).start();
    p.rooms.attach(p.peers);
    p.bots = new PeerBots({ peers: p.peers, store, runtime: p.runtime, log: () => {} }).start();
    p.peers.files = new PeerFiles({ peers: p.peers, store, artifactFile: artifactSource({ store, rootOf: (id) => p.runtime.root(id) }) }).start();
    p.peers.errands = new Errands({ peers: p.peers, store, runtime: p.runtime }).start();
    await p.peers.start();
    if (!offline) await until(() => p.peers.relayStatus.status === "online", name + " conectado al buzón");
    p.close = async () => {
      p.rooms.stop(); p.bots.stop(); p.peers.files.stop(); p.peers.errands.stop(); p.teams.stop(); p.peers.stop();
      for (const timer of p.connections.timers?.values?.() || []) clearTimeout(timer);
      await pause(200);
      await p.runtime.shutdown();
      if (p.server) { p.server.closeAllConnections(); await new Promise((r) => p.server.close(r)); }
      p.store.close();
      p.closed = true;
    };
    return p;
  };
  for (const name of people) made.push(await open(name));
  t.after(async () => {
    for (const p of made) if (!p.closed) await p.close();
    if (relay) await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  /** The mailbox goes down (nobody reaches it) and comes back on the same address, with what it kept. */
  made.relay = {
    stop: async () => { await relay.close(); relay = null; },
    start: async () => { relay = await startRelay({ port, directory: path.join(base, "relay") }); },
  };
  /** The same person's Colmena opened again on the same data (a restart). */
  made.reopen = async (p, options = {}) => {
    if (!p.closed) await p.close();
    const again = await open(p.name, options);
    made.push(again);
    return again;
  };
  /** The same, while the mailbox is down: it does not wait to be connected. */
  made.reopenOffline = (p) => made.reopen(p, { offline: true });
  return made;
}
export async function friends(a, b) {
  const inv = await a.peers.createInvite(b.name);
  await b.peers.acceptInvite(inv.code);
  await until(() => a.peers.contact(addr(b))?.status === "active" && b.peers.contact(addr(a))?.status === "active", a.name + " y " + b.name + " se hablan");
  await until(() => b.peers.contact(addr(a))?.bots?.length && a.peers.contact(addr(b))?.bots?.length, "se conocen los bots");
}
/** A room of `owner` with Vera and `guests` in it. */
export async function sharedRoom(owner, guests, title = "Informe Q3") {
  const list = Array.isArray(guests) ? guests : [guests];
  const room = owner.rooms.create({ title, botIds: ["vera"] });
  for (const g of list) await owner.rooms.invite(room.id, { address: addr(g) });
  for (const g of list) await until(() => g.rooms.resolveRoom(room.id), g.name + " ve la sala");
  return owner.rooms.detail(room.id);
}
/** `who` names `owner`'s bot in the room, picked with «@» (the message says whose bot it is). */
export const ask = (who, room, owner, text, bot = "vera", extra = {}) => who.rooms.send(room.id, { text, mentions: [{ owner: addr(owner), bot }], ...extra });
export const rule = (owner, person, encargos) => owner.peers.updateContact(addr(person), { asks: { encargos } });
export const card = (p) => p.store.list("approvals").find((a) => a.roomRequest && a.status === "pending");
export const asks = (p) => p.store.list("roomAsks");
export const botAnswer = (p, room, text) => until(() => peerRows(p, room.id).find((m) => m.bot && m.text === text), p.name + " recibe «" + text + "»");
/** A team of `owner` with everyone else in it, through codes. */
export async function team(owner, others, name = "Acme") {
  const made = owner.teams.create(name);
  for (const o of others) {
    const inv = await owner.teams.invite(made.id, o.name);
    await o.teams.join(inv.code);
    await until(() => o.teams.membership(made.id)?.state === "active", o.name + " entra en el equipo");
  }
  return owner.teams.view(made.id);
}
