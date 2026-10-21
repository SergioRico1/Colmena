// desktop/updater.cjs with Electron and electron-updater stubbed: it waits for a running
// mission before restarting, keeps the channel, and turns GitHub's HTML notes into text.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
// Each test's stubs answer require("electron") and require("electron-updater").
let stubs = null;
const original = Module._load;
Module._load = function (request, ...rest) {
  if (stubs && request === "electron") return stubs.electron;
  if (stubs && request === "electron-updater") return { autoUpdater: stubs.autoUpdater };
  return original.call(this, request, ...rest);
};
test.after(() => { Module._load = original; });

function load({ packaged = true } = {}) {
  const userData = mkdtempSync(path.join(os.tmpdir(), "colmena-updater-"));
  const handlers = new Map();
  const sent = [];
  const autoUpdater = Object.assign(new EventEmitter(), {
    checks: 0,
    installs: [],
    checkForUpdates() { this.checks++; return Promise.resolve(null); },
    quitAndInstall(...args) { this.installs.push(args); },
    setFeedURL(feed) { this.feed = feed; },
  });
  const electron = {
    app: { isPackaged: packaged, getVersion: () => "2.0.0", getPath: () => userData },
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel, state) => sent.push([channel, state]) } }] },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    powerMonitor: { on() {} },
    shell: { openExternal() {} },
  };
  stubs = { electron, autoUpdater };
  const file = require.resolve("../desktop/updater.cjs");
  delete require.cache[file];
  const mod = require(file);
  return { mod, autoUpdater, handlers, sent, userData, call: (op, arg) => handlers.get("colmena-update")({}, op, arg) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a restart waits for the team to finish, then installs", async () => {
  const { mod, autoUpdater, call } = load();
  let busy = true;
  const updater = mod.setupUpdater({ isBusy: () => busy });
  autoUpdater.emit("update-available", { version: "2.0.1", releaseNotes: "<p>Arreglos</p>" });
  autoUpdater.emit("update-downloaded", { version: "2.0.1", releaseNotes: "<ul><li>Uno</li><li>Dos</li></ul>" });
  let state = await call("restart");
  await flush();
  assert.equal(state.status, "ready");
  assert.equal(state.waiting, true);
  assert.equal(autoUpdater.installs.length, 0, "never in the middle of a mission");
  updater.workChanged();
  await flush();
  assert.equal(autoUpdater.installs.length, 0, "still working");
  busy = false;
  updater.workChanged();
  await flush();
  assert.deepEqual(autoUpdater.installs, [[true, true]], "silent install, then Colmena opens again");
  state = await call("state");
  assert.equal(state.notes, "• Uno\n• Dos");
});

test("an idle team restarts right away; closing installs it too", async () => {
  const { mod, autoUpdater, call } = load();
  mod.setupUpdater({ isBusy: () => false });
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  assert.equal(autoUpdater.allowDowngrade, false);
  await call("restart");
  await flush();
  assert.equal(autoUpdater.installs.length, 0, "nothing downloaded yet");
  autoUpdater.emit("update-downloaded", { version: "2.0.1" });
  await call("restart");
  await flush();
  assert.equal(autoUpdater.installs.length, 1);
});

test("the beta channel allows pre-releases and is remembered", async () => {
  const { mod, autoUpdater, call, userData } = load();
  mod.setupUpdater({ isBusy: () => false });
  assert.equal(autoUpdater.allowPrerelease, false);
  const state = await call("channel", "beta");
  assert.equal(state.channel, "beta");
  assert.equal(autoUpdater.allowPrerelease, true);
  assert.equal(JSON.parse(readFileSync(path.join(userData, "desktop-prefs.json"), "utf8")).updateChannel, "beta");
  assert.ok(autoUpdater.checks >= 1, "looks again on the new channel");
});

test("development runs without a feed never check", async () => {
  const { mod, autoUpdater, call } = load({ packaged: false });
  mod.setupUpdater({ isBusy: () => false });
  const state = await call("check");
  assert.equal(state.supported, false);
  assert.equal(autoUpdater.checks, 0);
});

test("release notes from GitHub read as plain text", () => {
  const { plainNotes } = load().mod;
  assert.equal(plainNotes("<h2>Novedades</h2><p>Avisos &amp; más</p>"), "Novedades\nAvisos & más");
  assert.equal(plainNotes([{ version: "2.0.1", note: "<p>Uno</p>" }, { version: "2.0.2", note: "<p>Dos</p>" }]), "Uno\n\nDos");
  assert.equal(plainNotes(null), "");
});
