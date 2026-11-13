// Which missions are rooms («Salas») and which are tasks (Trabajo): the rule for missions made
// before kinds existed (server/mission-kind.mjs › inferKind), the sweep that applies it to inferred
// kinds only (server/room.mjs), the QA seed as the person sees it, and «Mover a Salas / a Trabajo».
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { Runtime, roomSlug } from "../server/runtime.mjs";
import { titleFromPrompt } from "../server/runtime/helpers.mjs";
import { createApp } from "../server/app.mjs";
import { Rooms } from "../server/room.mjs";
import { KIND_RULE, inferKind, missionHref, placeName } from "../server/mission-kind.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** A mission as the code before kinds wrote it (runtime.create): title and #slug made from the request unless given. */
function legacy(prompt, { title = null, ...rest } = {}) {
  const t = title || titleFromPrompt(prompt);
  return { id: "x", title: t, room: roomSlug(t), prompt, mode: "equipo", botIds: [], conversation: false, safety: "preguntar", status: "completed", ...rest };
}

test("the rule: a mission used as a conversation or named by the person is a room; one with task markers a task", () => {
  const cases = [
    // How the old screens made them.
    ["«Nueva sala» (a name of its own)", legacy("Empezamos a mirar hoteles", { title: "Viaje a Oporto", botIds: ["nora"] }), {}, "sala", "team work the person named"],
    ["«Nueva tarea» for the team (titled from the request)", legacy("Prepara el informe de gastos del mes"), {}, "tarea", "titled from the request"],
    ["«Nueva tarea» for one bot", legacy("Resume el contrato", { mode: "solo", botIds: ["nora"] }), {}, "tarea", "work for one bot"],
    ["Ctrl+K / Inicio ask to the team", legacy("Busca hoteles en Oporto para tres noches"), {}, "tarea", "titled from the request"],
    // How they were used.
    ["the person wrote again", legacy("Busca hoteles en Oporto"), { userMessages: 3 }, "sala", "the person wrote in it after the first request"],
    ["a one-bot task the person kept talking in", legacy("Resume el contrato", { mode: "solo", botIds: ["nora"] }), { userMessages: 2 }, "sala", "the person wrote in it after the first request"],
    ["a #slug renamed by the person", { ...legacy("Prepara el presupuesto de la obra"), room: "obra-nueva" }, {}, "sala", "team work the person named"],
    ["a #slug that was only taken («-2»)", { ...legacy("Prepara el presupuesto de la obra"), room: roomSlug(titleFromPrompt("Prepara el presupuesto de la obra")) + "-2" }, {}, "tarea", "titled from the request"],
    ["a named room with a due date (#informe-q3)", legacy("Necesito el informe del tercer trimestre", { title: "Informe del tercer trimestre para el comité", dueAt: "2026-12-01T10:00:00Z", botIds: ["tomas", "nora"] }), { userMessages: 1 }, "sala", "team work the person named"],
    ["an unnamed one with a due date", legacy("Prepara el informe de gastos", { dueAt: "2026-12-01T10:00:00Z" }), {}, "tarea", "it has a due date"],
    ["a goal's milestone", legacy("Prepara el informe de gastos"), { goal: true }, "tarea", "a goal's milestone points at it"],
    // What the shape alone says.
    ["a chat with one bot", legacy("Hola", { mode: "solo", botIds: ["nora"], conversation: true }), { userMessages: 9 }, "chat", "a conversation with one bot"],
    ["a chat someone added bots to", legacy("Hola", { mode: "solo", botIds: ["nora", "vera"], conversation: true }), {}, "sala", "a conversation with several bots"],
    ["a routine's run", legacy("Resumen diario", { automationId: "a1", title: "Resumen diario" }), { userMessages: 2 }, "tarea", "a run of a routine"],
  ];
  for (const [name, m, signals, kind, why] of cases) assert.deepEqual(inferKind(m, signals), { kind, why }, name);
});

test("a task is never cited or linked as a room", () => {
  const room = { id: "r", kind: "sala", room: "informe-q3", title: "Informe", mode: "equipo", botIds: ["nora"] };
  const task = { ...room, id: "t", kind: "tarea" };
  assert.equal(placeName(room), "#informe-q3");
  assert.equal(missionHref(room), "/sala/r");
  assert.equal(placeName(task), "Informe");
  assert.equal(missionHref(task), "/encargo/t");
});

/** The QA seed (scripts/seed-qa.mjs) in its own folder, served like the app does. */
async function seeded(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-kind-seed-"));
  execFileSync(process.execPath, [path.join(root, "scripts", "seed-qa.mjs")], { cwd: root, env: { ...process.env, COLMENA_DATA_DIR: dir }, stdio: "ignore" });
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store };
}

test("the QA seed: #informe-q3 is a room again; the one-bot job stays a task", async (t) => {
  const { store } = await seeded(t);
  const rooms = new Rooms({ store, log: () => {} });
  rooms.sweep();
  const kinds = Object.fromEntries(store.list("missions").map((m) => [m.id, [m.kind, m.kindBy, m.kindRule]]));
  assert.deepEqual(kinds, {
    "m-q3": ["sala", "inferred", KIND_RULE], "m-camp": ["sala", "inferred", KIND_RULE],
    "m-fact": ["tarea", "inferred", KIND_RULE], "m-chat": ["chat", "inferred", KIND_RULE],
  });
  assert.equal(rooms.resolveRoom("m-q3")?.missionId, "m-q3");
  assert.equal(rooms.resolveRoom("m-fact"), null);
});

test("re-inference touches inferred kinds only, once per rule, and never a created or chosen one", async (t) => {
  const { store } = await seeded(t);
  // What the earlier rule left: m-q3 a task with no flag, m-camp inferred by rule 1, m-fact
  // made as a task by the new code, m-chat moved to... nothing (a chat stays a chat).
  store.patch("missions", "m-q3", { kind: "tarea" });
  store.patch("missions", "m-camp", { kind: "tarea", kindBy: "inferred", kindRule: 1 });
  store.patch("missions", "m-fact", { kind: "sala", kindBy: "created" });
  store.put("rooms", { id: "m-camp", title: "campaña-primavera", slug: "campaña-primavera", teamId: null, missionId: "m-camp", shareId: null, general: false, createdBy: null, createdAt: null, archived: false, snoozedUntil: null, seenAt: null });
  const rooms = new Rooms({ store, log: () => {} }).start(); // start() sweeps and then follows the store
  t.after(() => rooms.stop());
  assert.equal(store.get("missions", "m-q3").kind, "sala", "an unflagged kind is an inferred one");
  assert.equal(store.get("missions", "m-camp").kind, "sala", "an older rule's answer is worked out again");
  assert.equal(store.get("missions", "m-fact").kind, "sala", "what the new code said stays");
  assert.ok(rooms.resolveRoom("m-q3"));
  // The person moves #informe-q3 to Trabajo: no later rule brings it back.
  store.patch("missions", "m-q3", { kind: "tarea", kindBy: "person" });
  const before = JSON.stringify(store.list("missions"));
  rooms.sweep();
  assert.equal(JSON.stringify(store.list("missions")), before, "again: nothing to do, nothing written");
  assert.equal(rooms.resolveRoom("m-q3"), null);
  assert.equal(store.list("rooms").some((r) => r.missionId === "m-q3"), false, "its private room went with it");
});

test("«Mover a Trabajo» and «Mover a Salas»: one route, the same kind everywhere", async (t) => {
  const { store } = await seeded(t);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls in API tests"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await runtime.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const call = async (method, route, body) => {
    const res = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }) });
    return { status: res.status, json: await res.json() };
  };
  const listed = async () => (await call("GET", "/state")).json.rooms.map((r) => r.missionId || r.id);

  assert.equal((await call("GET", "/rooms/m-q3")).status, 200, "#informe-q3 is a room");
  assert.equal((await call("POST", "/rooms/m-q3/seen")).status, 200);
  assert.ok((await listed()).includes("m-q3"), "and it is in the sidebar's list");
  assert.equal((await call("GET", "/rooms/m-fact")).status, 404, "the one-bot job is a task");

  const moved = await call("PATCH", "/missions/m-q3", { kind: "tarea" });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.json.kind, moved.json.kindBy], ["tarea", "person"]);
  assert.equal((await call("GET", "/rooms/m-q3")).status, 404);
  assert.equal((await listed()).includes("m-q3"), false);
  const summary = (await call("GET", "/state")).json.missions.find((m) => m.id === "m-q3");
  assert.equal(summary.kind, "tarea", "the state says it, so every screen reads the same kind");

  assert.equal((await call("PATCH", "/missions/m-q3", { kind: "sala" })).status, 200);
  assert.equal((await call("GET", "/rooms/m-q3")).status, 200, "and back");
  assert.ok((await listed()).includes("m-q3"));
  assert.equal((await call("PATCH", "/missions/m-fact", { kind: "sala" })).json.kind, "sala");
  assert.equal((await call("GET", "/rooms/m-fact")).status, 200, "a task moved to Salas is a room");
  assert.equal((await call("PATCH", "/missions/m-chat", { kind: "sala" })).status, 409, "a chat with one bot does not move");
});
