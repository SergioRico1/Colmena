// Cloud mode of the desktop app (docs/CLOUD.md › Phase 5): the window opens the company's
// workspace at app.colmena.team with Colmena's own window chrome, tray, notifications, badge,
// «Pregunta rápida» and captures, in a session partition of its own (persist:colmena-cloud) so
// nothing mixes with the local mode. Next to it runs this computer's local agent
// (server/agent-link/main.mjs), which lends the person's cloud bots what only this computer has.
//
// - Sign-in: the window shows /entrar/escritorio; the person approves in their system browser
//   (signed in there), which hands back a code to the app by a colmena:// link (or typed). The
//   window then gets a session of its own from the Worker: no cookie is copied anywhere.
// - The device key (Ed25519) is made here once and kept with the OS's protection (safeStorage:
//   DPAPI, Keychain); only the agent process gets it, in memory, over IPC.
// - The cloud's page never reaches the local allowlist: what this computer lends is edited in a
//   local window («Este ordenador», desktop/cloud/agent.html) that only the main process serves.
const { app, BrowserWindow, Notification, ipcMain, dialog, shell, session, safeStorage, nativeTheme } = require("electron");
const { spawn } = require("node:child_process");
const { createHash, generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PARTITION, cloudUrl, dataDir, writeMode } = require("./mode.cjs");
const { createBrowserManager, attachBackend, toBackend } = require("./browser.cjs");
const { render } = require("./render.cjs");

const UUID = /^[0-9a-f-]{36}$/;
// Tests (COLMENA_EXTERNAL_LOG): links for the system browser are written to that file instead of
// opening the browser of the computer running them.
const openExternal = (url) => {
  if (process.env.COLMENA_EXTERNAL_LOG) { fs.appendFileSync(process.env.COLMENA_EXTERNAL_LOG, url + "\n"); return Promise.resolve(); }
  return shell.openExternal(url);
};
const DEVICE = /^[a-f0-9]{24}$/;
const HANDBACK = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i;

/** The cloud mode's own folder: the agent's allowlist, its device key, downloads of cloud missions. */
const agentDir = (env = process.env) => path.join(dataDir(env), "nube");

// ------------------------------------------------------------------ the device key
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file); }
function fingerprintOf(publicKey) {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 12).toUpperCase().match(/.{4}/g).join("-");
}
/** This computer's identity: made once; the private half sealed by the OS (DPAPI / Keychain). */
function loadDevice(dir) {
  const file = path.join(dir, "device.json");
  let d = readJson(file);
  if (!d?.publicKey || !d?.privateKey) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ format: "pem", type: "pkcs8" });
    const sealed = safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(pem).toString("base64") } : { pem };
    d = { publicKey: publicKey.export({ format: "jwk" }).x, privateKey: sealed, name: deviceName(), platform: process.platform, createdAt: new Date().toISOString(), registration: null };
    writeJson(file, d);
  }
  const privateKey = () => (d.privateKey.enc ? safeStorage.decryptString(Buffer.from(d.privateKey.enc, "base64")) : d.privateKey.pem);
  return {
    get view() { return { publicKey: d.publicKey, fingerprint: fingerprintOf(d.publicKey), name: d.name, platform: d.platform, registration: d.registration || null, sealed: !!d.privateKey.enc }; },
    privateKey,
    register(registration) { d = { ...d, registration }; writeJson(file, d); },
    forget() { d = { ...d, registration: null }; writeJson(file, d); },
  };
}
function deviceName() {
  const user = (os.userInfo().username || "").replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 30);
  return (user ? "Ordenador de " + user : os.hostname()).slice(0, 60);
}

// ------------------------------------------------------------------ the mode
/** Asks before switching (a native dialog: the page cannot switch silently), then restarts. */
async function switchMode(owner, mode) {
  const to = mode === "cloud" ? "Colmena en la nube" : "Colmena solo en este ordenador";
  const { response } = await dialog.showMessageBox(owner, {
    type: "question", buttons: ["Cambiar y reiniciar", "Cancelar"], defaultId: 0, cancelId: 1, title: "Colmena",
    message: "¿Cambiar a " + to + "?",
    detail: mode === "cloud"
      ? "Tus datos de este ordenador se quedan aquí, sin tocar. En la nube entras con tu correo; luego puedes llevar tus bots y conversaciones con «Llevar mis datos a la nube»."
      : "Tu sesión de la nube se queda guardada en este ordenador por si vuelves. Colmena abrirá tus datos de este ordenador, como antes.",
  });
  if (response !== 0) return false;
  writeMode(app.getPath("userData"), mode);
  app.relaunch();
  app.exit(0);
  return true;
}

/** The first-run choice (desktop/cloud/mode.html): resolves "local" or "cloud". */
function chooseMode({ icon, background }) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 760, height: 560, resizable: false, maximizable: false, fullscreenable: false, frame: false, roundedCorners: true, center: true,
      show: false, title: "Colmena", icon, backgroundColor: background,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload-mode.cjs") },
    });
    let done = false;
    const onChoice = (event, mode) => {
      if (event.sender !== win.webContents || !["local", "cloud"].includes(mode)) return;
      done = true;
      ipcMain.removeListener("colmena-mode-choice", onChoice);
      writeMode(app.getPath("userData"), mode);
      // Hidden now, closed once the next window exists (a moment with no window would quit the app).
      win.hide();
      app.once("browser-window-created", () => setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 1500));
      resolve(mode);
    };
    ipcMain.on("colmena-mode-choice", onChoice);
    ipcMain.on("colmena-mode-window", (event, action) => { if (event.sender === win.webContents && action === "close") win.close(); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.on("closed", () => { if (!done) app.quit(); });
    win.once("ready-to-show", () => win.show());
    win.loadFile(path.join(__dirname, "cloud", "mode.html"));
  });
}

// ------------------------------------------------------------------ cloud mode
/**
 * `deps`: {icon, iconSource, appId, windowBackground, log, setupBackground, updater, hidden,
 * onBackground(background)}. Returns {window, agent}.
 */
function startCloud(deps) {
  const { icon, iconSource, appId, windowBackground, log = () => {}, setupBackground, updater = null, hidden = false } = deps;
  const CLOUD = cloudUrl();
  const dir = agentDir();
  fs.mkdirSync(dir, { recursive: true });
  const device = loadDevice(dir);
  const ses = session.fromPartition(PARTITION);
  const fromCloud = (url) => { try { return new URL(url).origin === CLOUD; } catch { return false; } };
  // The cloud page may ask for the microphone (dictation in the browser) and notifications; nothing else.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(fromCloud(details?.requestingUrl || wc.getURL()) && ["media", "notifications", "clipboard-sanitized-write", "fullscreen"].includes(permission)));
  ses.setPermissionCheckHandler((wc, permission, origin) => fromCloud(origin) && ["media", "notifications", "clipboard-sanitized-write", "fullscreen"].includes(permission));

  // Deep links (colmena://entrar?c=<id>&k=<code>) reach the installed app; development runs never
  // take the scheme over from an installed Colmena.
  if (app.isPackaged) { try { app.setAsDefaultProtocolClient("colmena"); } catch {} }

  // ---------------------------------------------------------------- the local agent
  let agent = null, agentState = { status: "starting" }, agentLends = { folders: [] }, computer = null, seq = 0;
  const waiting = new Map();
  const agentReq = (op, args = {}, timeout = 120000) => new Promise((resolve, reject) => {
    if (!agent?.connected) return reject(Error("El agente de este ordenador no está en marcha."));
    const id = "r" + ++seq;
    const timer = setTimeout(() => { waiting.delete(id); reject(Error("El agente no respondió.")); }, timeout);
    waiting.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    toBackend(agent, { type: "agent-req", id, op, args });
  });
  const pushIdentity = () => {
    const reg = device.view.registration;
    if (!reg) return Promise.resolve();
    let key = null;
    try { key = device.privateKey(); } catch (error) { log("device key: " + error.message + "\n"); return Promise.resolve(); }
    return agentReq("identity", { ...reg, privateKey: key }).catch((e) => log("agent identity: " + e.message + "\n")).finally(() => { key = null; });
  };
  const broadcast = (event) => { for (const w of [cloudWin, agentWin]) if (w && !w.isDestroyed()) w.webContents.send("colmena-cloud-event", event); };
  const startAgent = () => {
    const ownNode = app.isPackaged && !process.env.COLMENA_NODE;
    agent = spawn(process.env.COLMENA_NODE || (ownNode ? process.execPath : "node"), [path.join(__dirname, "../server/agent-link/main.mjs")], {
      cwd: path.join(__dirname, ".."), windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, ...(ownNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), COLMENA_COMPUTER: "1", COLMENA_AGENT_DIR: dir, COLMENA_CLOUD_URL: CLOUD, NODE_COMPILE_CACHE: path.join(app.getPath("userData"), "node-compile-cache") },
    });
    computer = computer || createBrowserManager({
      sendFrame: (frame) => toBackend(agent, { type: "computer-frame", ...frame }),
      sendEvent: (event) => toBackend(agent, { type: "computer-event", ...event }),
    });
    attachBackend(agent, { handle: (op, args) => (op === "render" ? render(args) : computer.handle(op, args)) });
    agent.stdout.on("data", (chunk) => log(chunk));
    agent.stderr.on("data", (chunk) => log(chunk));
    agent.on("message", (m) => {
      if (m?.type === "agent-ready") pushIdentity();
      else if (m?.type === "agent-res") { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); m.ok ? w.resolve(m.result) : w.reject(Error(m.error)); } }
      else if (m?.type === "agent-status") { agentState = m.state || agentState; agentLends = m.lends || agentLends; broadcast({ type: "agent", state: agentState, lends: agentLends }); }
      else if (m?.type === "agent-migrate") broadcast({ type: "migrate", progress: m });
    });
    agent.on("exit", (code) => {
      for (const w of waiting.values()) w.reject(Error("El agente se detuvo."));
      waiting.clear();
      agentState = { status: "stopped" };
      broadcast({ type: "agent", state: agentState, lends: agentLends });
      log("agente terminó (" + code + ")\n");
      // It comes back by itself unless Colmena is quitting.
      if (!quitting) setTimeout(() => { if (!quitting) startAgent(); }, 3000);
    });
  };
  let quitting = false;
  app.on("before-quit", () => { quitting = true; computer?.shutdown(); if (agent?.connected) agent.disconnect(); });
  startAgent();

  // ---------------------------------------------------------------- the window
  let cloudWin = null, agentWin = null, background = null;
  const signInPage = CLOUD + "/entrar/escritorio";
  const isSignIn = (url) => { try { const u = new URL(url); return u.origin === CLOUD && /^\/entrar\/?$/.test(u.pathname); } catch { return false; } };
  const external = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && !u.username && !u.password) openExternal(u.href);
    } catch {}
  };
  const open = async () => {
    const win = new BrowserWindow({
      width: 1440, height: 960, minWidth: 760, minHeight: 600, title: "Colmena", icon, show: false, backgroundColor: windowBackground(),
      autoHideMenuBar: true, frame: false, thickFrame: true, roundedCorners: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: PARTITION, preload: path.join(__dirname, "preload-cloud.cjs"), autoplayPolicy: "no-user-gesture-required" },
    });
    cloudWin = win;
    if (process.platform === "win32") {
      win.setIcon(icon);
      win.setAppDetails({ appId, appIconPath: iconSource, appIconIndex: 0, relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${path.join(__dirname, "main.cjs")}"`, relaunchDisplayName: "Colmena" });
    }
    const sendState = () => { if (!win.isDestroyed()) win.webContents.send("colmena-window-state", { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() }); };
    for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "focus", "blur"]) win.on(event, sendState);
    const onWindow = (event, action) => {
      if (event.sender !== win.webContents) return;
      if (action === "minimize") win.minimize();
      else if (action === "toggle-maximize") (win.isMaximized() ? win.unmaximize() : win.maximize());
      else if (action === "close") win.close();
      else if (action === "state") sendState();
      else if (["edit:cut", "edit:copy", "edit:paste", "edit:selectAll"].includes(action)) win.webContents[action.slice(5)]();
    };
    ipcMain.on("colmena-window", onWindow);
    win.on("closed", () => { ipcMain.removeListener("colmena-window", onWindow); app.quit(); });
    win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: "deny" }; });
    win.webContents.on("will-navigate", (event, url) => {
      if (fromCloud(url)) {
        // Signed out (or never signed in): the desktop's own way in instead of the web form.
        if (isSignIn(url)) { event.preventDefault(); win.loadURL(signInPage); }
        return;
      }
      event.preventDefault();
      external(url);
    });
    win.webContents.on("did-navigate", (_e, url) => { if (isSignIn(url)) win.loadURL(signInPage); });
    win.once("ready-to-show", () => { if (!hidden) win.show(); });
    win.webContents.once("did-fail-load", () => { if (!hidden && !win.isDestroyed()) win.show(); });
    const signedIn = (await ses.cookies.get({ url: CLOUD })).some((c) => c.name === "__Host-colmena" || c.name === "colmena_local");
    win.loadURL(signedIn ? CLOUD + "/" : signInPage);
    background = background || setupBackground({ icon, preload: path.join(__dirname, "preload-cloud.cjs"), partition: PARTITION, getMain: () => cloudWin, getOrigin: () => CLOUD });
    background.keepRunning(win);
    deps.onBackground?.(background);
    return win;
  };

  // ---------------------------------------------------------------- «Este ordenador» (the local allowlist)
  const openAgentWindow = () => {
    if (agentWin && !agentWin.isDestroyed()) { agentWin.show(); agentWin.focus(); return; }
    agentWin = new BrowserWindow({
      width: 880, height: 820, minWidth: 640, minHeight: 560, title: "Colmena · Este ordenador", icon, show: false, backgroundColor: windowBackground(),
      autoHideMenuBar: true, frame: false, thickFrame: true, roundedCorners: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload-agent.cjs") },
    });
    agentWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    agentWin.webContents.on("will-navigate", (event) => event.preventDefault());
    agentWin.once("ready-to-show", () => agentWin.show());
    agentWin.on("closed", () => { agentWin = null; });
    agentWin.loadFile(path.join(__dirname, "cloud", "agent.html"));
  };

  // ---------------------------------------------------------------- IPC
  const fromWindow = (event) => cloudWin && event.sender === cloudWin.webContents && fromCloud(event.senderFrame?.url || cloudWin.webContents.getURL());
  ipcMain.handle("colmena-cloud", async (event, op, args = {}) => {
    if (!fromWindow(event)) throw Error("No permitido.");
    if (op === "identity") return { ...device.view, agent: agentState.status, cloud: CLOUD, version: app.getVersion() };
    if (op === "registered") {
      const workspaceId = String(args.workspaceId || ""), deviceId = String(args.deviceId || "");
      if (!UUID.test(workspaceId) || !DEVICE.test(deviceId)) throw Error("Registro no válido.");
      device.register({ workspaceId, deviceId });
      await pushIdentity();
      return { ok: true };
    }
    if (op === "reconnect") { await agentReq("restart").catch(() => null); return { ok: true }; }
    if (op === "open-approval") {
      const id = String(args.id || "");
      if (!UUID.test(id)) throw Error("Petición no válida.");
      await openExternal(CLOUD + "/entrar/escritorio/aprobar?c=" + id);
      return { ok: true };
    }
    if (op === "agent-settings") { openAgentWindow(); return { ok: true }; }
    if (op === "agent") return { state: agentState, lends: agentLends };
    if (op === "presence") {
      const p = { working: Math.max(0, Math.min(999, Number(args.working) || 0)), waiting: Math.max(0, Math.min(999, Number(args.waiting) || 0)), paused: !!args.paused, finished: Math.max(0, Number(args.finished) || 0) };
      background?.setPresence?.(p);
      deps.onPresence?.(p);
      updater?.workChanged?.();
      return { ok: true };
    }
    if (op === "notify") {
      if (!Notification.isSupported()) return { ok: false };
      const url = String(args.url || "");
      const n = new Notification({ title: String(args.title || "Colmena").slice(0, 120), body: String(args.body || "").slice(0, 300), silent: true, icon: path.join(__dirname, "icons", "faces", "alerta-256.png") });
      n.on("click", () => background?.showMain(url.startsWith("/") ? url : undefined));
      n.show();
      return { ok: true };
    }
    if (op === "mode") return { mode: "cloud", switched: await switchMode(cloudWin, "local") };
    throw Error("Operación desconocida.");
  });
  const fromAgentWindow = (event) => agentWin && event.sender === agentWin.webContents;
  ipcMain.handle("colmena-agent", async (event, op, args = {}) => {
    if (!fromAgentWindow(event)) throw Error("No permitido.");
    if (op === "identity") return { ...device.view, agent: agentState, lends: agentLends, cloud: CLOUD, localData: dataDir() };
    if (op === "pick-folder") {
      const r = await dialog.showOpenDialog(agentWin, { title: args.purpose === "code" ? "Elige la carpeta del proyecto" : "Elige una carpeta para tus bots", buttonLabel: "Prestar esta carpeta", properties: ["openDirectory", "dontAddToRecent"] });
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
    }
    if (op === "window") {
      if (args.action === "close") agentWin.close();
      else if (args.action === "minimize") agentWin.minimize();
      return { ok: true };
    }
    if (op === "migrate-preview") return agentReq("migratePreview", { source: dataDir() });
    if (op === "migrate") return agentReq("migrate", { source: dataDir(), kinds: Array.isArray(args.kinds) ? args.kinds : undefined }, 30 * 60 * 1000);
    const allowed = { status: "status", setPolicy: "setPolicy", apps: "apps", managers: "managers", managerItems: "managerItems", chooseLogin: "chooseLogin", claude: "claude", restart: "restart" };
    if (!allowed[op]) throw Error("Operación desconocida.");
    return agentReq(allowed[op], args);
  });

  // ---------------------------------------------------------------- deep links back from the browser
  const handback = (argv) => {
    const link = (argv || []).find((a) => typeof a === "string" && a.toLowerCase().startsWith("colmena://"));
    if (!link) return false;
    try {
      const u = new URL(link);
      const id = u.searchParams.get("c") || "", code = u.searchParams.get("k") || "";
      if (UUID.test(id) && HANDBACK.test(code) && cloudWin && !cloudWin.isDestroyed()) {
        cloudWin.webContents.send("colmena-cloud-event", { type: "handback", id, code: code.toUpperCase() });
        if (cloudWin.isMinimized()) cloudWin.restore();
        cloudWin.show();
        cloudWin.focus();
      }
    } catch {}
    return true;
  };
  app.on("second-instance", (_event, argv) => { if (!handback(argv)) background?.showMain(); });
  app.on("open-url", (event, url) => { event.preventDefault(); handback([url]); });

  open().then(() => handback(process.argv));
  nativeTheme.on("updated", () => { if (cloudWin && !cloudWin.isDestroyed()) cloudWin.setBackgroundColor(windowBackground()); });
  return { get window() { return cloudWin; }, openAgentWindow, agentReq };
}

module.exports = { startCloud, chooseMode, switchMode, agentDir, fingerprintOf, loadDevice };
