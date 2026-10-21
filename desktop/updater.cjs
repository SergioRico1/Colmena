// Updates the way Claude Desktop and Codex do them: electron-updater on GitHub Releases.
// It looks for a new version a little after start and every few hours, downloads it in the
// background, and installs it when you restart or quit Colmena. It never restarts in the
// middle of a running mission: «Reiniciar para actualizar» then waits for the team to finish.
// Ajustes › Actualizaciones picks the channel (stable or beta) and can check right away.
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, powerMonitor, shell } = require("electron");

const FIRST_CHECK_MS = 10 * 1000;
const EVERY_MS = 4 * 60 * 60 * 1000;
const RELEASES = "https://github.com/SergioRico1/Colmena/releases";

function prefsFile() { return path.join(app.getPath("userData"), "desktop-prefs.json"); }
function readPrefs() { try { return JSON.parse(fs.readFileSync(prefsFile(), "utf8")) || {}; } catch { return {}; } }
function savePref(key, value) {
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), [key]: value }, null, 2)); } catch {}
}

/** GitHub sends the release notes as HTML (or one entry per version): plain text for the UI. */
function plainNotes(notes) {
  const html = Array.isArray(notes) ? notes.map((n) => n?.note || "").join("\n") : String(notes || "");
  return html
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

function setupUpdater({ isBusy }) {
  const feed = process.env.COLMENA_UPDATE_FEED || "";
  const state = {
    supported: app.isPackaged || !!feed,
    current: app.getVersion(),
    channel: readPrefs().updateChannel === "beta" ? "beta" : "stable",
    status: "idle", // idle | checking | none | downloading | ready | error
    version: null,
    notes: "",
    percent: 0,
    checkedAt: null,
    waiting: false, // «Reiniciar» pressed while a mission runs: restarts when the team is free
    error: null,
    manual: false, // this computer cannot install it by itself (unsigned Mac): download it instead
  };
  const send = () => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("colmena-update", { ...state });
  };
  const set = (patch) => { Object.assign(state, patch); send(); };

  let updater = null;
  if (state.supported) {
    ({ autoUpdater: updater } = require("electron-updater"));
    const log = path.join(app.getPath("userData"), "logs", "updates.log");
    const write = (level) => (message) => {
      try {
        fs.mkdirSync(path.dirname(log), { recursive: true });
        fs.appendFileSync(log, `${new Date().toISOString()} ${level} ${String(message?.stack || message)}\n`);
      } catch {}
    };
    updater.logger = { info: write("info"), warn: write("warn"), error: write("error"), debug: () => {} };
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true; // the full NSIS installer, never a web installer
    updater.allowPrerelease = state.channel === "beta";
    // A local feed for testing an installed copy (docs/RELEASING.md): same files as a release.
    if (feed) updater.setFeedURL({ provider: "generic", url: feed });

    updater.on("checking-for-update", () => set({ status: state.status === "ready" ? "ready" : "checking", error: null }));
    updater.on("update-not-available", () => set({ status: state.status === "ready" ? "ready" : "none", checkedAt: new Date().toISOString() }));
    updater.on("update-available", (info) => set({ status: "downloading", version: info.version, notes: plainNotes(info.releaseNotes), percent: 0, checkedAt: new Date().toISOString() }));
    updater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent || 0) }));
    updater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, notes: plainNotes(info.releaseNotes) || state.notes, percent: 100 }));
    updater.on("error", (error) => {
      // Without a signed build macOS refuses to swap the app: offer the download instead.
      const manual = process.platform === "darwin" && /sign|code ?signature|ShipIt/i.test(String(error?.message || error));
      set({ status: state.status === "ready" ? "ready" : "error", error: manual ? "Descárgala desde la web para instalarla." : "No se pudo comprobar. Lo intentará más tarde.", manual, checkedAt: new Date().toISOString() });
    });
  }

  let checking = null;
  const check = () => {
    if (!updater || state.status === "downloading") return Promise.resolve();
    checking ??= updater.checkForUpdates().catch(() => {}).finally(() => { checking = null; });
    return checking;
  };
  const installNow = () => {
    // Silent install, then Colmena opens again on the new version.
    setImmediate(() => updater.quitAndInstall(true, true));
  };
  const restart = () => {
    if (!updater || state.status !== "ready") return;
    if (isBusy()) return set({ waiting: true });
    installNow();
  };
  /** The team's work changed (the server's «presence»): a pending restart may go ahead. */
  const workChanged = () => {
    if (state.waiting && state.status === "ready" && !isBusy()) installNow();
  };
  const setChannel = (channel) => {
    const next = channel === "beta" ? "beta" : "stable";
    if (next === state.channel) return;
    savePref("updateChannel", next);
    if (updater) updater.allowPrerelease = next === "beta";
    set({ channel: next, status: state.status === "ready" ? "ready" : "idle" });
    check();
  };

  ipcMain.handle("colmena-update", (_event, op, arg) => {
    if (op === "check") check();
    else if (op === "restart") restart();
    else if (op === "channel") setChannel(arg);
    else if (op === "download") shell.openExternal(RELEASES + "/latest");
    else if (op === "cancel-wait") set({ waiting: false });
    return { ...state };
  });

  if (updater) {
    setTimeout(check, FIRST_CHECK_MS).unref?.();
    setInterval(check, EVERY_MS).unref?.();
    // After the computer sleeps for hours, look again when it wakes.
    powerMonitor.on("resume", () => setTimeout(check, 30 * 1000));
  }
  return { check, workChanged, state };
}

module.exports = { setupUpdater, plainNotes };
