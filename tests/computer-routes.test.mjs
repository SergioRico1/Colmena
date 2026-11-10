import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Store } from "../server/store.mjs";
import { createBridge } from "../server/computer/bridge.mjs";
import { registerComputerRoutes } from "../server/computer/routes.mjs";
import { allowedApps, appPathOk, defaultApps } from "../server/computer/system.mjs";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

async function setup(t, handlers = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-routes-"));
  const store = new Store(dir);
  const calls = { stop: [], relaunch: [], hints: [] };
  const runtime = {
    root: (id) => path.join(dir, "workspaces", id),
    stop: (id) => {
      calls.stop.push(id);
      store.patch("missions", id, { status: "paused" });
    },
    relaunch: (id) => calls.relaunch.push(id),
    threadHint: (id, text) => calls.hints.push(text),
  };
  const computer = createBridge({
    available: true,
    send: (message) => setImmediate(async () => {
      try {
        computer.handleMessage({ type: "computer-result", id: message.id, ok: true, result: await handlers[message.op](message.args) });
      } catch (error) {
        computer.handleMessage({ type: "computer-result", id: message.id, ok: false, error: { message: error.message } });
      }
    }),
  });
  const app = express();
  app.use(express.json());
  registerComputerRoutes(app, { store, runtime, computer });
  app.use((err, _req, res, _next) => res.status(err.status || (err.name === "ZodError" ? 400 : 422)).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/computer";
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, store, computer, calls, base };
}

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("approval capture is served only from the mission's capturas folder", async (t) => {
  const { dir, store, base } = await setup(t);
  await mkdir(path.join(dir, "workspaces", "m1", "capturas"), { recursive: true });
  await writeFile(path.join(dir, "workspaces", "m1", "capturas", "envio-1.jpg"), JPEG);
  store.put("approvals", { id: "a1", missionId: "m1", tool: "browser_submit", redLine: true, status: "pending", computer: { shot: "capturas/envio-1.jpg", fields: [{ label: "Nombre", value: "Ana" }], domain: "tienda.es", button: "Comprar" } });
  store.put("approvals", { id: "a2", missionId: "m1", tool: "browser_submit", status: "pending", computer: { shot: "../../colmena.sqlite" } });
  const shot = await fetch(base + "/shot/a1");
  assert.equal(shot.status, 200);
  assert.equal(shot.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await shot.arrayBuffer()), JPEG);
  assert.equal((await fetch(base + "/shot/a2")).status, 404);
  assert.equal((await fetch(base + "/shot/nada")).status, 404);
  const info = await (await fetch(base + "/approval/a1")).json();
  assert.equal(info.hasShot, true);
  assert.equal(info.domain, "tienda.es");
  assert.deepEqual(info.fields, [{ label: "Nombre", value: "Ana" }]);
  assert.equal((await (await fetch(base + "/approval/a2")).json()).hasShot, false);
});

test("taking control pauses the running mission; giving it back resumes with a hint", async (t) => {
  const { store, computer, calls, base } = await setup(t, {
    takeover: (a) => ({ missionId: a.missionId, botId: "nora", takeover: a.action === "take" }),
  });
  store.put("bots", { id: "nora", name: "Nora" });
  store.put("missions", { id: "m1", title: "Compra", status: "running" });
  const take = await fetch(base + "/takeover", json({ missionId: "m1", action: "take" }));
  assert.equal(take.status, 200);
  assert.equal((await take.json()).paused, true);
  assert.deepEqual(calls.stop, ["m1"]);
  assert.equal(store.events("m1").at(-1).type, "computer_takeover");
  // Electron reports the return (button in Colmena, the window bar, or closing the window).
  computer.handleMessage({ type: "computer-event", event: "returned", missionId: "m1", botId: "nora" });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.relaunch, ["m1"]);
  assert.match(calls.hints[0], /vuelve a leer la página/);
  assert.equal((await fetch(base + "/takeover", json({ missionId: "m1", action: "jump" }))).status, 400);
  assert.equal((await fetch(base + "/takeover", json({ missionId: "nada", action: "take" }))).status, 404);
});

test("frames reach store listeners and the mission's own stream, never the database", async (t) => {
  const { store, computer, base } = await setup(t);
  const seen = [];
  store.listeners.add((e) => e.type === "browser_frame" && seen.push(e));
  const controller = new AbortController();
  const response = await fetch(base + "/events?mission=m1", { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read(); // ready
  computer.handleMessage({ type: "computer-frame", missionId: "m1", botId: "nora", url: "https://a.es/", title: "A", jpegBase64: JPEG.toString("base64") });
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /"type":"browser_frame"/);
  assert.match(text, /data:image\/jpeg;base64,/);
  controller.abort();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].mission, "m1");
  const last = await (await fetch(base + "/frame/m1")).json();
  assert.equal(last.frame.title, "A");
  const rows = store.db.prepare("SELECT count(*) AS n FROM records WHERE data LIKE '%base64%'").get();
  assert.equal(rows.n, 0);
});

// A real app and one that is not there: an .exe on Windows, an .app bundle on macOS.
const APPS = { win32: { real: process.execPath, missing: "C:\\no\\existe.exe" }, darwin: { real: "/System/Applications/Calculator.app", missing: "/Applications/No Existe.app" } }[process.platform];

test("allowed apps are edited only through the API with real app paths (.exe, .app on macOS)", { skip: APPS ? false : "allowed apps exist on Windows and macOS only" }, async (t) => {
  const { base, store } = await setup(t);
  store.put("settings", { id: "main" });
  const list = await (await fetch(base + "/apps")).json();
  assert.deepEqual(list.defaults.map((a) => a.id), ["excel", "word", "powerpoint", "calculadora", "bloc-de-notas", "explorador"]);
  const bad = await fetch(base + "/apps", { ...json({ apps: [{ label: "Malo", path: APPS.missing }] }), method: "PUT" });
  assert.equal(bad.status, 422);
  const script = await fetch(base + "/apps", { ...json({ apps: [{ label: "Script", path: "C:\\x\\a.bat" }] }), method: "PUT" });
  assert.equal(script.status, 400);
  const relative = await fetch(base + "/apps", { ...json({ apps: [{ label: "Suelta", path: process.platform === "darwin" ? "Calculator.app" : "calc.exe" }] }), method: "PUT" });
  assert.equal(relative.status, 400);
  const ok = await fetch(base + "/apps", { ...json({ apps: ["calculadora", { label: "Node", path: APPS.real }] }), method: "PUT" });
  assert.equal(ok.status, 200);
  assert.deepEqual(store.get("settings", "main").allowedApps.length, 2);
});

test("allowed apps per platform: .exe paths on Windows, .app bundles on macOS, the same six defaults", () => {
  assert.ok(appPathOk("C:\\Program Files\\App\\app.exe", "win32"));
  assert.ok(!appPathOk("C:\\x\\a.bat", "win32"));
  assert.ok(!appPathOk("/Applications/Notas.app", "win32"));
  assert.ok(appPathOk("/Applications/Notas.app", "darwin"));
  assert.ok(!appPathOk("Notas.app", "darwin"), "absolute only");
  assert.ok(!appPathOk("/usr/bin/osascript", "darwin"), "an app, not a program");
  assert.ok(!appPathOk("C:\\x\\app.exe", "darwin"));
  assert.ok(!appPathOk("/usr/bin/gedit", "linux"));
  assert.deepEqual(defaultApps("darwin").map((a) => a.id), defaultApps("win32").map((a) => a.id));
  const mac = allowedApps({ allowedApps: ["calculadora", "excel", { label: "Notas", path: "/Applications/Notas.app" }, { label: "Malo", path: "C:\\x\\malo.exe" }] },
    { platform: "darwin", exists: (p) => p === "/System/Applications/Calculator.app" || p === "/Applications/Notas.app" });
  assert.deepEqual(mac.map((a) => [a.id, a.installed, a.path]), [["calculadora", true, "/System/Applications/Calculator.app"], ["excel", false, null], ["notas", true, "/Applications/Notas.app"]]);
  const win = allowedApps({ allowedApps: [{ label: "Notas", path: "/Applications/Notas.app" }, { label: "Bueno", path: "C:\\x\\bueno.exe" }] }, { platform: "win32", exists: () => true });
  assert.deepEqual(win.map((a) => a.id), ["bueno"]);
});
