import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { pendingCount } from "../server/notifications.mjs";
import { countIn, needsCount, needsOf, waitingBy, waitingOf } from "../src/components/v2/needs.js";
import { needEntries, needRow } from "../src/components/v3/dia/needRows.js";
import { needsYou } from "../src/lib/format.js";
import { tasksOf } from "../src/lib/rooms.js";
import { sidebarModel } from "../src/lib/sidebar.js";
import { memberPanel } from "../src/lib/roomView.js";

// Item 2 of the critique (2026-11-13): on the QA seed every surface's number and every bot's
// state agree, because each one is the one list (server/waiting.mjs) or a filter of it.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("on the QA seed, Inicio, the sidebar, Trabajo, Equipo, the room and the taskbar say the same", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-onecount-"));
  execFileSync(process.execPath, [path.join(root, "scripts", "seed-qa.mjs")], { env: { ...process.env, COLMENA_DATA_DIR: dir }, stdio: "pipe" });
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("no provider"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const state = await (await fetch(origin + "/api/state")).json();
  const total = needsCount(state);
  assert.ok(total > 0, "the seed has things that wait");

  // Inicio: the badge and its rows.
  const needs = needsOf(state);
  const rows = needEntries(needs);
  assert.equal(rows.reduce((n, e) => n + (e.count || 1), 0), total, "Inicio's rows add up to its number");
  // The sidebar's foot and its summary; the taskbar.
  const side = sidebarModel(state);
  assert.equal(side.waitingCount, total);
  assert.equal(side.summary.waiting, total);
  assert.equal(pendingCount(store), total, "taskbar and tray");

  // Every bot's state: «te espera» exactly when something of it is on the list, everywhere.
  const { bots: byBot } = waitingBy(waitingOf(state));
  for (const b of state.bots.filter((x) => x.enabled !== false)) {
    const waits = byBot.has(b.id);
    assert.equal(b.status === "espera", waits && b.status !== "pausado", `Equipo: ${b.id}`);
    assert.equal(side.bots.find((x) => x.id === b.id)?.state === "waiting", waits, `sidebar: ${b.id}`);
  }
  // A row of Inicio that names a bot names one that is «te espera»; a room-level one names none.
  for (const e of rows) {
    if (e.botId) assert.ok(byBot.has(e.botId), `${e.key}: ${e.botId} waits`);
    if (e.room) assert.equal(e.botId, null, `${e.key}: a room's decision is the room's`);
  }
  for (const item of waitingOf(state).filter((i) => i.kind === "mission" || i.what === "plan")) {
    const m = state.missions.find((x) => x.id === item.missionId);
    if (m && !(m.conversation && m.botIds?.length === 1)) assert.equal(item.botId, null, item.id + " is a room-level decision");
  }

  // Trabajo: its column counts exactly the cards it shows and links to the rest.
  const cards = tasksOf(state.missions).filter((m) => !m.archived && needsYou(m));
  const col = countIn(cards, total);
  assert.equal(col.text, String(cards.length));
  assert.equal(col.link, total > cards.length ? `ver las ${total}` : null);

  // A room's member panel: your bots' states come from the same list.
  const sala = state.missions.find((m) => m.id === "m-q3");
  const view = { private: true, people: [{ address: "me", name: "Tú", you: true }], bots: [{ owner: { address: "me", you: true }, bots: sala.botIds.map((id) => state.bots.find((b) => b.id === id)).filter(Boolean) }] };
  const panel = memberPanel(view, { waiting: [...byBot.keys()] });
  for (const b of panel.groups[0].bots) assert.equal(b.state === "waiting", byBot.has(b.id), "member panel: " + b.id);

  // What each surface says on the seed (for the record).
  const said = {
    inicio: total, rows: rows.length, sidebar: side.waitingCount, taskbar: pendingCount(store), trabajo: col.text + (col.link ? " · " + col.link : ""),
    waitingBots: [...byBot.keys()].sort().join(","), rooms: rows.filter((e) => e.room).map((e) => needRow(e, { roomName: state.missions.find((m) => m.id === e.missionId)?.room }).who).join(","),
  };
  t.diagnostic(JSON.stringify(said));
});
