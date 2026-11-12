// Performance budgets (T3 Code docs/internals/performance-regressions.md): payload sizes and
// hot paths are pinned by tests that fail locally, on synthetic «big user» data in a temporary
// directory (tests/fixtures/perf-data.mjs) — never the person's real data.
//
//  - /api/state stays under ~150 KB: it is fetched again after every change;
//  - opening a chat of 800 messages downloads under ~120 KB (latest page, no tool bodies);
//  - the hot paths never go back to store.list for a kind that has the mission index;
//  - the server is ready, with that data, within a reasonable time.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Store } from "../server/store.mjs";
import { encryptDatabase } from "../server/db-crypto.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { Peers } from "../server/peers/service.mjs";
import { Teams } from "../server/peers/teams.mjs";
import { newIdentity } from "../server/peers/protocol.mjs";
import { SIZES, seedBigUser } from "./fixtures/perf-data.mjs";
import { fixture, answer, call, settle } from "./fixtures/runtime-fixture.mjs";

const KB = 1024;
// Encrypted times are generous on purpose (a slow test machine): measured ~50 ms and ~130 ms on the big user.
export const BUDGETS = Object.freeze({ stateBytes: 150 * KB, missionSummaryBytes: 900, roomBytes: 160, teamsAndRoomsBytes: 4 * KB, peersBytes: 70 * KB, chatOpenBytes: 120 * KB, chatPageBytes: 120 * KB, bootMs: 8000, encryptedStateMs: 1500, encryptedChatMs: 2000 });
// Kinds read per mission through the missionId index (store.where): listing them all is the
// regression this guards against (each one grows with every chat, step and tool call).
const PER_MISSION = new Set(["messages", "steps", "receipts", "thread", "artifacts"]);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The big data set (encrypted with `encrypted`: db-crypto.mjs), an app on a free port and a spy on Store#list. */
async function bigApp(t, { encrypted = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-perf-"));
  let store = new Store(directory);
  const { longChatId } = seedBigUser(store);
  if (encrypted) {
    store.close();
    const key = randomBytes(32);
    encryptDatabase(path.join(directory, "colmena.sqlite"), key);
    store = new Store(directory, { key });
  }
  const runtime = new Runtime(store, { respond: async () => answer("ok") }, null, { seed: false });
  let origin;
  const app = createApp({ store, runtime, session: { status: () => null }, getOrigin: () => origin });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const listed = [];
  t.mock.method(store, "list", function (kind) { listed.push(kind); return Store.prototype.list.call(this, kind); });
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const get = async (route) => {
    listed.length = 0;
    const response = await fetch(origin + "/api" + route);
    assert.equal(response.status, 200, route);
    const text = await response.text();
    return { bytes: Buffer.byteLength(text), json: JSON.parse(text), listed: [...listed] };
  };
  return { store, get, longChatId, app };
}
const sizes = (json) => Object.entries(json).map(([k, v]) => k + " " + Math.round(Buffer.byteLength(JSON.stringify(v ?? null)) / KB) + " KB").join(", ");

test("/api/state stays under its budget with a big user's data, and carries no bodies", async (t) => {
  const { get } = await bigApp(t);
  const { bytes, json, listed } = await get("/state");
  assert.ok(json.missions.length >= SIZES.chats + SIZES.rooms + SIZES.automationRuns, "every mission is there");
  assert.ok(bytes <= BUDGETS.stateBytes, `/api/state is ${Math.round(bytes / KB)} KB (budget ${BUDGETS.stateBytes / KB} KB): ${sizes(json)}`);
  const perMission = Math.round(Buffer.byteLength(JSON.stringify(json.missions)) / json.missions.length);
  assert.ok(perMission <= BUDGETS.missionSummaryBytes, `a mission summary averages ${perMission} bytes (budget ${BUDGETS.missionSummaryBytes})`);
  // Histories, tool outputs, deliverable bodies and messages stay out of the shell.
  const text = JSON.stringify(json);
  for (const leak of ['"history"', '"content"', '"messages"', '"result"']) assert.ok(!text.includes(leak), "no " + leak + " in /api/state");
  assert.deepEqual(listed.filter((k) => PER_MISSION.has(k)), [], "no per-mission kind is listed whole");
});

// Teams and rooms in the state. The room list is light and has its own budget. What does NOT
// fit yet is older than rooms: `peers` carries every conversation with every member in full
// (name, initials, colour, presence, status) and every contact with its bots and safety words,
// which today's screens for people read. With 30 people it is ~63 KB on its own, so the state
// of someone in three teams is over 150 KB. It is pinned here so it cannot grow unseen; the
// single room screen reads members with the room (GET /api/rooms/:id) and can drop it.
test("/api/state with teams and rooms: 3 teams, 41 rooms, 30 people; the room list is light", async (t) => {
  const { store, get, app } = await bigApp(t);
  const before = (await get("/state")).bytes;
  // «Personas» with its keys and no mailbox: nothing leaves this computer.
  const peers = await new Peers({ store, vault: null, relayUrl: null, nameOf: () => "Sergio Rico", log: () => {} }).start();
  peers.teams = new Teams({ peers }).start();
  t.after(() => peers.stop());
  app.locals.peers = peers;
  app.locals.rooms.attach(peers);
  const me = peers.address, at = "2026-11-01T10:00:00.000Z";
  const people = Array.from({ length: 30 }, () => newIdentity()).map((id, i) => ({ id: id.sign.pub, box: id.box.pub, name: "Persona Número " + i }));
  const face = (n) => ({ id: "bot-" + n, name: "Bot " + n, role: "Ayudante de pruebas", color: "#7B4DFF", shape: "leaf" });
  store.tx(() => {
    for (const [i, p] of people.entries()) store.put("peerContacts", { ...p, status: i < 10 ? "active" : "known", addedAt: at, bots: [face(1), face(2), face(3)] });
    for (let n = 0; n < 3; n++) {
      const members = [{ id: me, role: "owner", box: peers.identity.box.pub, name: "Sergio Rico" }, ...people.slice(n * 10, n * 10 + 10).map((p) => ({ ...p, role: "member" }))];
      store.put("teams", { id: "team-000" + n, name: "Equipo " + n, owner: me, version: 11, room: "general-000" + n, at, createdAt: at, gone: [], members });
      store.put("teamMemberships", { id: "team-000" + n, state: "active", owner: me, joinedAt: at, version: 11 });
      const inRoom = members.map((m) => ({ id: m.id, role: m.role }));
      store.put("peerShares", { id: "general-000" + n, kind: "group", title: "general", owner: me, version: 11, createdAt: at, lastAt: at, unread: n, teamId: "team-000" + n, general: true, members: inRoom, lastLine: "Última línea de la sala general", lastFrom: people[n].id });
      // Six more rooms in each team, of six people.
      for (let r = 0; r < 6; r++) store.put("peerShares", { id: `sala-${n}-${r}-0000`, kind: "group", title: "sala-" + n + "-" + r, owner: me, version: 3, createdAt: at, lastAt: at, unread: r % 3, teamId: "team-000" + n, members: inRoom.slice(0, 6), lastLine: "Lo último que se dijo aquí", lastFrom: people[n].id });
    }
    for (const p of people.slice(0, 10)) peers.ensureDm(p.id);
  });
  const { bytes, json } = await get("/state");
  assert.equal(json.teams.length, 3);
  assert.deepEqual(json.teams[0], { id: "team-0000", name: "Equipo 0", people: 11, bots: json.teams[0].bots, admin: true, current: true });
  // Every sala of the big user and every room with people, once: 20 + 21.
  assert.equal(json.rooms.length, SIZES.rooms + 21);
  assert.equal(json.rooms.filter((r) => r.teamId === "team-0001").length, 7);
  assert.equal(json.rooms.filter((r) => r.general).length, 3);
  assert.ok(json.rooms.every((r) => !("people" in r) && !("bots" in r) && !("href" in r)), "who is in a room is read with the room, not with the state");
  const perRoom = Math.round(Buffer.byteLength(JSON.stringify(json.rooms)) / json.rooms.length);
  assert.ok(perRoom <= BUDGETS.roomBytes, `a room averages ${perRoom} bytes in the state (budget ${BUDGETS.roomBytes})`);
  const peersBytes = Buffer.byteLength(JSON.stringify(json.peers));
  assert.ok(json.peers.shares.length === 31 && json.peers.contacts.length === 30);
  // Three teams and 21 rooms with people on top of the big user (already near its budget, first
  // test of this file) cost 3 KB, the old `peers` view apart…
  const added = bytes - peersBytes - before;
  assert.ok(added <= BUDGETS.teamsAndRoomsBytes, `teams and 21 rooms with people added ${added} bytes to /api/state (budget ${BUDGETS.teamsAndRoomsBytes}): ${sizes(json)}`);
  // …and that view is held where it is until it goes.
  assert.ok(peersBytes <= BUDGETS.peersBytes, `«peers» is ${Math.round(peersBytes / KB)} KB in /api/state (held at ${BUDGETS.peersBytes / KB} KB)`);
});

test("/api/state carries neither the memory archive nor the diff of a pending note change: both are read on demand", async (t) => {
  const { store, get } = await bigApp(t);
  const before = (await get("/state")).bytes;
  // An archive without a limit: thousands of memories that no longer fit among the ever-present ones.
  const ARCHIVED = 3000;
  for (let i = 0; i < ARCHIVED; i++)
    store.put("memories", { id: "arch-" + i, botId: i % 2 ? "nora" : null, scope: i % 2 ? "bot" : "equipo", text: "Recuerdo archivado número " + i + ": el cliente " + (i % 7 ? "Acme" : "Lozano") + " prefiere que le escriban por la mañana.", source: "dedujo", review: false, active: true, tier: "archive", archivedAt: "2026-10-01T08:00:00.000Z", createdAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 60_000).toISOString() });
  // «En duda» (archived, waiting for the person) and what it contradicts stay in the state: the review needs both.
  store.put("memories", { id: "said", botId: null, scope: "equipo", text: "Los viernes salgo a las 15:00.", source: "dijiste", review: false, active: true, tier: "archive", createdAt: "2026-02-01T00:00:00.000Z" });
  store.put("memories", { id: "doubt", botId: "nora", scope: "bot", text: "Los viernes sale a las 17:00.", source: "dedujo", review: true, doubt: true, contradicts: "said", active: true, tier: "archive", createdAt: "2026-02-02T00:00:00.000Z" });
  // A note change that waits, with the biggest diff an approval keeps.
  const mission = store.list("missions")[0];
  const patch = "@@ -1,1 +1,900 @@\n" + Array.from({ length: 900 }, (_, i) => "+Línea " + i + " del acta de la reunión con el cliente, con todo su detalle.").join("\n");
  store.put("approvals", {
    id: "note-ask", missionId: mission.id, botId: "nora", stepId: null, tool: "wiki_write", kind: "write", scope: "notas", status: "pending", title: "Cambiar la nota «Acta»", summary: "Nora quiere cambiar la nota «Acta».",
    args: { page: "Acta", action: "replace", section: "", content: "x", revision: 1 }, canAlways: true, createdAt: new Date().toISOString(),
    wiki: { slug: "acta", title: "Acta", action: "replace", create: false, section: null, baseRevision: 1, patch: patch.slice(0, 60000), added: 900, removed: 1, truncated: false, outside: { suspicious: false } },
  });
  const { bytes, json } = await get("/state");
  assert.ok(bytes <= BUDGETS.stateBytes, `/api/state is ${Math.round(bytes / KB)} KB (budget ${BUDGETS.stateBytes / KB} KB): ${sizes(json)}`);
  assert.ok(bytes - before < 4 * KB, `3000 archived memories and a 60 KB diff added ${bytes - before} bytes to /api/state`);
  assert.deepEqual(json.memoryArchive, { count: ARCHIVED });
  assert.ok(!json.memories.some((m) => m.id.startsWith("arch-")), "no settled archive memory in the state");
  assert.deepEqual(["said", "doubt"].map((id) => !!json.memories.find((m) => m.id === id)), [true, true]);
  const ask = json.approvals.find((a) => a.id === "note-ask");
  assert.deepEqual(ask.wiki, { slug: "acta", title: "Acta", action: "replace", create: false, section: null, added: 900, removed: 1, truncated: false, outside: { suspicious: false } });
  // The diff, when the card is opened.
  const diff = (await get("/approvals/note-ask/wiki")).json;
  assert.deepEqual([diff.patch.length, diff.added, diff.removed, diff.truncated], [Math.min(patch.length, 60000), 900, 1, false]);
  // The archive, by pages (newest first) and by what it says.
  const first = (await get("/memories?tier=archive")).json;
  assert.deepEqual([first.items.length, first.total, first.items[0].id, first.items[0].tier], [50, ARCHIVED, "arch-" + (ARCHIVED - 1), "archive"]);
  const second = (await get("/memories?tier=archive&limit=200&cursor=" + first.cursor)).json;
  assert.deepEqual([second.items.length, second.items[0].id, second.cursor], [200, "arch-" + (ARCHIVED - 51), "250"]);
  const found = (await get("/memories?tier=archive&q=" + encodeURIComponent("numero 2999 acme"))).json;
  assert.deepEqual([found.total, found.items.map((m) => m.id), found.cursor], [1, ["arch-2999"], null]);
  const last = (await get("/memories?tier=archive&cursor=" + (ARCHIVED - 10))).json;
  assert.deepEqual([last.items.length, last.cursor], [10, null]);
});

test("opening a chat of 800 messages brings its latest page and stays under budget", async (t) => {
  const { get, longChatId } = await bigApp(t);
  const open = await get("/missions/" + longChatId);
  assert.equal(open.json.messages.filter((m) => m.kind !== "progress").length, 75, "the latest 75 messages");
  assert.ok(open.json.olderCount >= SIZES.longChat - 75);
  assert.ok(open.bytes <= BUDGETS.chatOpenBytes, `opening the chat is ${Math.round(open.bytes / KB)} KB (budget ${BUDGETS.chatOpenBytes / KB} KB): ${sizes(open.json)}`);
  const text = JSON.stringify(open.json);
  assert.ok(!text.includes('"history"') && !text.includes("function_call_output"), "no tool history on the wire");
  assert.deepEqual(open.listed.filter((k) => PER_MISSION.has(k)), []);
  // Each page up is bounded the same way.
  const older = await get(`/missions/${longChatId}/history?antes=${encodeURIComponent(open.json.cursor)}`);
  assert.equal(older.json.messages.filter((m) => m.kind !== "progress").length, 75);
  assert.ok(older.bytes <= BUDGETS.chatPageBytes, `a page up is ${Math.round(older.bytes / KB)} KB`);
  assert.deepEqual(older.listed.filter((k) => PER_MISSION.has(k)), [], "a page reads its mission only");
});

test("encrypted database: the same budgets, no per-mission kind listed whole, and still quick", async (t) => {
  const { get, store, longChatId } = await bigApp(t, { encrypted: true });
  assert.equal(store.encrypted, true);
  const timed = async (route) => { const started = performance.now(); const r = await get(route); return { ...r, ms: performance.now() - started }; };
  const state = await timed("/state");
  assert.ok(state.bytes <= BUDGETS.stateBytes, `/api/state is ${Math.round(state.bytes / KB)} KB`);
  assert.deepEqual(state.listed.filter((k) => PER_MISSION.has(k)), [], "encrypted: still read through the readable mission index");
  assert.ok(state.ms < BUDGETS.encryptedStateMs, `/api/state took ${Math.round(state.ms)} ms (budget ${BUDGETS.encryptedStateMs} ms)`);
  const open = await timed("/missions/" + longChatId);
  assert.ok(open.bytes <= BUDGETS.chatOpenBytes, `opening the chat is ${Math.round(open.bytes / KB)} KB`);
  assert.deepEqual(open.listed.filter((k) => PER_MISSION.has(k)), []);
  assert.ok(open.ms < BUDGETS.encryptedChatMs, `opening the chat took ${Math.round(open.ms)} ms (budget ${BUDGETS.encryptedChatMs} ms)`);
});

test("a bot's turn with tools and deliverables never lists a per-mission kind whole", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async () => {
    round += 1;
    if (round === 1) return call("web_fetch", { url: "https://example.com" }, "w1");
    if (round === 2) return call("create_deliverable", { title: "Informe", kind: "document", format: "md", content: "# Hola" }, "d1");
    if (round === 3) return call("create_deliverable", { title: "Informe", kind: "document", format: "md", content: "# Hola v2" }, "d2");
    return answer("Listo.");
  }, { web: async (url) => ({ url, finalUrl: url, title: "Ejemplo", text: "Hola", truncated: false, untrusted: true }) });
  const listed = [];
  t.mock.method(store, "list", function (kind) { listed.push(kind); return Store.prototype.list.call(this, kind); });
  const m = runtime.create({ prompt: "Haz un informe", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(store.where("artifacts", "missionId", m.id).find((a) => a.id.endsWith("d2")).version, 2, "versions still found through the index");
  assert.deepEqual([...new Set(listed.filter((k) => PER_MISSION.has(k)))], [], "listed: " + [...new Set(listed)].join(", "));
});

test("no server code filters a whole list by missionId: that is what store.where is for", async () => {
  const files = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(dir, e.name));
      else if (e.name.endsWith(".mjs")) files.push(path.join(dir, e.name));
    }
  };
  await walk(path.join(ROOT, "server"));
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    // store.list("kind") … .filter/.find/.some((x) => x.missionId === …) in the same statement.
    for (const m of source.matchAll(/\.list\(\s*"(\w+)"\s*\)([^;]{0,240})/g))
      if (/\.(filter|find|some|every)\(\s*\(?(\w+)\)?\s*=>\s*\2\.missionId\s*===?/.test(m[2]))
        offenders.push(path.relative(ROOT, file) + ": list(\"" + m[1] + "\") filtered by missionId");
  }
  assert.deepEqual(offenders, []);
});

test("the server is ready with a big user's data within its budget", { skip: !existsSync(path.join(ROOT, "dist", "index.html")) && "needs npm run build" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-boot-"));
  const store = new Store(directory);
  seedBigUser(store);
  store.close();
  const started = performance.now();
  const child = spawn(process.execPath, [path.join(ROOT, "server", "index.mjs"), "--production"], {
    cwd: ROOT, env: { ...process.env, COLMENA_DATA_DIR: directory, COLMENA_PORT: "0", COLMENA_RELAY_URL: "off", NODE_TEST_CONTEXT: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once("exit", r)); }
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  });
  let out = "";
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("not ready after " + BUDGETS.bootMs * 2 + " ms:\n" + out)), BUDGETS.bootMs * 2);
    child.stdout.on("data", (d) => { out += d; const m = /COLMENA_READY (\S+)/.exec(out); if (m) { clearTimeout(timer); resolve(m[1]); } });
    child.stderr.on("data", (d) => { out += d; });
    child.once("exit", (code) => { clearTimeout(timer); reject(Error("the server exited (" + code + "):\n" + out)); });
  });
  const response = await fetch(origin + "/api/state");
  assert.equal(response.status, 200);
  await response.text();
  const ms = Math.round(performance.now() - started);
  assert.ok(ms <= BUDGETS.bootMs, `ready and first /api/state in ${ms} ms (budget ${BUDGETS.bootMs} ms)`);
});
