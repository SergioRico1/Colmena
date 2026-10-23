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
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { SIZES, seedBigUser } from "./fixtures/perf-data.mjs";
import { fixture, answer, call, settle } from "./fixtures/runtime-fixture.mjs";

const KB = 1024;
export const BUDGETS = Object.freeze({ stateBytes: 150 * KB, missionSummaryBytes: 900, chatOpenBytes: 120 * KB, chatPageBytes: 120 * KB, bootMs: 8000 });
// Kinds read per mission through the missionId index (store.where): listing them all is the
// regression this guards against (each one grows with every chat, step and tool call).
const PER_MISSION = new Set(["messages", "steps", "receipts", "thread", "artifacts"]);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The big data set, an app on a free port and a spy on Store#list. */
async function bigApp(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-perf-"));
  const store = new Store(directory);
  const { longChatId } = seedBigUser(store);
  const runtime = new Runtime(store, { respond: async () => answer("ok") }, null, { seed: false });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null }, getOrigin: () => origin }));
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
  return { store, get, longChatId };
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
