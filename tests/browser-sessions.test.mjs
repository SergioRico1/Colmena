// Named browser sessions («Sesiones del navegador», server/computer/sessions.mjs and
// desktop/browser.cjs): partition names, the old partition kept as «Principal», which session a
// bot opens in, deletion falling back to Principal, and request turns keeping their own.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { BrowserSessions, sessionFor, PRINCIPAL } from "../server/computer/sessions.mjs";
import { computerExtraTools } from "../server/computer/wire.mjs";
import { executeComputerTool } from "../server/computer/tools.mjs";

const require = createRequire(import.meta.url);
const { tabKey, partitionFor, profilePartition, cookieSites, PARTITION } = require("../desktop/browser.cjs");

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-sessions-"));
  const store = new Store(directory);
  store.put("bots", { id: "nora", name: "Nora" });
  store.put("bots", { id: "leo", name: "Leo" });
  const calls = [];
  const computer = { available: true, call: async (op, args) => { calls.push({ op, args }); return op === "sessionSites" ? { domains: ["holded.com", "google.com"] } : { cleared: true, opened: true }; } };
  const sessions = new BrowserSessions(store, { computer });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, sessions, calls, computer };
}

test("partitions: Principal is the old one, named sessions persist apart, request turns stay in memory", () => {
  assert.equal(PARTITION, "persist:colmena-navegador", "the bots' existing partition: nothing to migrate");
  assert.equal(partitionFor({ missionId: "m", botId: "nora" }), PARTITION);
  assert.equal(partitionFor({ missionId: "m", botId: "nora", profile: "principal" }), PARTITION);
  assert.equal(partitionFor({ missionId: "m", botId: "nora", profile: "a1b2c3" }), "persist:colmena-s-a1b2c3");
  assert.equal(profilePartition("principal"), PARTITION);
  assert.equal(profilePartition("a1b2c3"), "persist:colmena-s-a1b2c3");
  assert.equal(profilePartition("../x"), null);
  assert.equal(partitionFor({ missionId: "m", botId: "nora", profile: "Bad/Id" }), PARTITION, "a malformed id is ignored");
  // A turn for another person: its own in-memory session wins over any named one.
  const theirs = partitionFor({ missionId: "m", botId: "nora", session: "req-s1", profile: "a1b2c3" });
  assert.ok(!theirs.startsWith("persist:"));
  assert.notEqual(tabKey({ missionId: "m", botId: "nora", profile: "a1b2c3" }), tabKey({ missionId: "m", botId: "nora" }), "a bot in another session gets another tab");
  assert.equal(tabKey({ missionId: "m", botId: "nora", profile: "principal" }), tabKey({ missionId: "m", botId: "nora" }));
  assert.deepEqual(cookieSites([{ domain: ".www.holded.com" }, { domain: "holded.com" }, { domain: "accounts.google.com" }, { domain: "localhost" }]), ["accounts.google.com", "holded.com"]);
});

test("sessions: create, list with their bots, a bot's and a mission's session, deletion falls back to Principal", async (t) => {
  const { store, sessions, calls } = await setup(t);
  assert.deepEqual(sessions.list().map((s) => s.name), ["Principal"]);
  assert.ok(["leo", "nora"].every((id) => sessions.list()[0].bots.some((b) => b.id === id)), "every bot starts in Principal");
  const work = sessions.create("Trabajo");
  sessions.create("Cliente Acme");
  assert.throws(() => sessions.create("trabajo"), /se llama así/);
  assert.throws(() => sessions.create("Principal"), /se llama así/);
  assert.throws(() => sessions.create("   "), /nombre/);
  sessions.assignBot("nora", work.id);
  assert.deepEqual(sessions.get(work.id).bots.map((b) => b.id), ["nora"]);
  assert.equal(sessionFor(store, { id: "m" }, store.get("bots", "nora")), work.id);
  assert.equal(sessionFor(store, { id: "m" }, store.get("bots", "leo")), PRINCIPAL);
  // A room or mission may override the bots' own.
  store.put("missions", { id: "room1", title: "Sala" });
  sessions.assignMission("room1", work.id);
  assert.equal(sessionFor(store, store.get("missions", "room1"), store.get("bots", "leo")), work.id);
  sessions.assignMission("room1", PRINCIPAL);
  assert.equal(sessionFor(store, store.get("missions", "room1"), store.get("bots", "nora")), PRINCIPAL);
  sessions.assignMission("room1", work.id);
  // Sites: domains only, from Electron.
  assert.deepEqual((await sessions.sites(work.id)).domains, ["holded.com", "google.com"]);
  // Deleting: cookies wiped, bots and missions back to Principal.
  await sessions.remove(work.id);
  assert.equal(store.get("bots", "nora").browserSession, null);
  assert.equal(store.get("missions", "room1").browserSession, null);
  assert.equal(sessionFor(store, store.get("missions", "room1"), store.get("bots", "nora")), PRINCIPAL);
  assert.deepEqual(calls.filter((c) => c.op === "sessionClear").map((c) => c.args.profile), [work.id]);
  await assert.rejects(sessions.remove(PRINCIPAL), /no se puede borrar/);
  // A session deleted under a bot's feet (an old record) also falls back.
  store.patch("bots", "leo", { browserSession: "gone123" });
  assert.equal(sessionFor(store, { id: "m" }, store.get("bots", "leo")), PRINCIPAL);
});

test("the bot's browser opens in its session; a turn for another person never does", async (t) => {
  const { store, sessions } = await setup(t);
  const work = sessions.create("Trabajo");
  sessions.assignBot("nora", work.id);
  const ops = [];
  const computer = { available: true, call: async (op, args) => { ops.push({ op, args }); return { url: "https://example.com/", title: "Ejemplo", snapshot: "", refs: 0 }; } };
  const runtime = {
    store, settings: () => ({}), autonomy: () => "avisa", root: (id) => path.join(store.directory, "workspaces", id), setActivity: () => {}, announce: () => {},
  };
  const tools = computerExtraTools(runtime, { computer });
  const nora = store.get("bots", "nora");
  const read = tools(nora, { id: "m" }).find((d) => d.name === "browser_read");
  const call = { call_id: "c1" };
  store.put("missions", { id: "m", title: "Mía" });
  store.put("steps", { id: "s1", missionId: "m", botId: "nora" });
  await read.run({ mode: "texto", query: "" }, { mission: store.get("missions", "m"), step: store.get("steps", "s1"), bot: nora, call });
  assert.equal(ops.at(-1).args.profile, work.id);
  assert.equal(ops.at(-1).args.session, undefined);
  // Another person's request: its own separate session, never «Trabajo».
  store.put("missions", { id: "m2", title: "Suya", peerErrand: "e1" });
  store.put("steps", { id: "s2", missionId: "m2", botId: "nora" });
  await read.run({ mode: "texto", query: "" }, { mission: store.get("missions", "m2"), step: store.get("steps", "s2"), bot: nora, call: { call_id: "c2" } });
  assert.equal(ops.at(-1).args.profile, undefined);
  assert.match(ops.at(-1).args.session, /^req-/);
  // Principal sends no profile at all: the same tab and partition as before.
  await executeComputerTool("browser_read", { mode: "texto", query: "" }, { missionId: "m", botId: "leo", bot: store.get("bots", "leo"), computer, settings: {} });
  assert.equal(ops.at(-1).args.profile, undefined);
});
