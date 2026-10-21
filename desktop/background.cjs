// Colmena keeps working when its window is closed (as Slack does): an icon next to the clock,
// a global shortcut that opens «Pregunta rápida» over whatever you are doing, and the window
// hiding instead of quitting. «Salir» in the tray menu quits for real.
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, globalShortcut, ipcMain, nativeImage, powerSaveBlocker, screen } = require("electron");
const { WinHelper } = require("./winhelper.cjs");
const { listWindows, captureWindow, captureArea, captureScreen } = require("./capture.cjs");

// The tray icon's face says how the team is, at a glance (faces from icons/faces/).
const FACES = path.join(__dirname, "icons", "faces");
const face = (name) => nativeImage.createFromPath(path.join(FACES, "tray-" + name + ".png"));
// The taskbar counter (T3 Code setNotificationBadge): what waits for you, 1–9 and 9+.
const BADGES = path.join(__dirname, "icons", "badges");
const badge = (n) => nativeImage.createFromPath(path.join(BADGES, "badge-" + (n > 9 ? "9plus" : n) + ".png"));
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const keysLabel = (keys) => String(keys || "").replace("Control", "Ctrl").replace("Space", "Espacio");

const SHORTCUTS = ["Alt+Space", "Control+Alt+Space"];
// Quick window: 680 wide; its height follows its content (OpenClaw: compact, with text, with reply).
const QUICK = { width: 680, min: 120, max: 640 };

// Tray choices kept on this computer (OpenClaw keeps them per profile).
function prefsFile() { return path.join(app.getPath("userData"), "desktop-prefs.json"); }
function readPrefs() { try { return JSON.parse(fs.readFileSync(prefsFile(), "utf8")) || {}; } catch { return {}; } }
function writePrefs(p) { try { fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2)); } catch {} }

function setupBackground({ icon, preload, getMain, getOrigin }) {
  let quitting = false;
  let toldHidden = false;
  let quick = null;
  let shortcut = null;
  let capturing = false; // the area picker or a paste is under way: losing focus does not hide
  let source = null; // the window you were in when you opened «Pregunta rápida»
  let presence = {};
  const prefs = { keepAwake: true, ...readPrefs() };
  const helper = new WinHelper();
  // Warm it up in the background: the first shortcut press is then instant.
  setTimeout(() => helper.start(), 1500).unref?.();

  app.on("before-quit", () => { quitting = true; helper.stop(); });

  const showMain = (url) => {
    const win = getMain();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (String(url || "").startsWith("/"))
      win.webContents.executeJavaScript(`history.pushState(null,"",${JSON.stringify(url)});dispatchEvent(new Event("colmena:navigate"))`).catch(() => {});
  };

  // Close button → hide; the bots keep going. The first time, say where Colmena went.
  const keepRunning = (win) => {
    win.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      win.hide();
      if (!toldHidden && Notification.isSupported()) {
        toldHidden = true;
        new Notification({ title: "Colmena sigue trabajando", body: "Tus bots continúan en segundo plano. Ábrela o ciérrala del todo desde el icono junto al reloj. Pregunta rápida: " + keysLabel(shortcut || "Alt+Space") + ".", silent: true }).show();
      }
    });
  };

  // OpenClaw places Quick Chat centred, its top edge at 22 % of the screen under the cursor.
  const placeQuick = (height = quick.getBounds().height) => {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    quick.setBounds({ x: Math.round(area.x + (area.width - QUICK.width) / 2), y: Math.round(area.y + area.height * 0.22), width: QUICK.width, height });
  };
  const sendShown = () => { if (quick && !quick.isDestroyed()) quick.webContents.send("colmena-quick-shown", { source }); };
  const showQuick = () => {
    placeQuick();
    quick.show();
    quick.focus();
    sendShown();
  };
  const openQuick = async () => {
    const origin = getOrigin();
    if (!origin) return;
    if (quick && !quick.isDestroyed() && quick.isVisible()) { quick.hide(); return; }
    // Which window you were in, before Colmena takes the focus (for its text, a screenshot
    // of it, and «Pegar en …» afterwards).
    source = await helper.foreground();
    if (!quick || quick.isDestroyed()) {
      quick = new BrowserWindow({
        width: QUICK.width, height: QUICK.min, show: false, frame: false, transparent: true, resizable: false,
        alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, maximizable: false, minimizable: false,
        title: "Colmena · Pregunta rápida", icon, backgroundColor: "#00000000",
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload },
      });
      quick.setAlwaysOnTop(true, "floating");
      quick.on("blur", () => { if (!capturing && !quick.webContents.isDevToolsOpened()) quick.hide(); });
      quick.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      quick.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(origin)) event.preventDefault(); });
      quick.loadURL(origin + "/rapida");
      quick.once("ready-to-show", showQuick);
      return;
    }
    showQuick();
  };

  ipcMain.on("colmena-quick", (event, action, value) => {
    if (!quick || event.sender !== quick.webContents) return;
    if (action === "hide") quick.hide();
    else if (action === "open") { quick.hide(); showMain(typeof value === "string" ? value : "/"); }
    else if (action === "size") {
      // The card asks for the height its content needs (compact, chips, reply).
      const h = typeof value === "number" ? value : value === "large" ? 560 : QUICK.min;
      const height = Math.max(QUICK.min, Math.min(QUICK.max, Math.round(h)));
      if (Math.abs(quick.getBounds().height - height) > 1) quick.setBounds({ ...quick.getBounds(), height });
    }
  });

  // What the card can ask of the desktop. Every answer is data for the card; the window you
  // came from is the one remembered at the shortcut press, never one the page names.
  ipcMain.handle("colmena-quick-op", async (event, op, args = {}) => {
    if (!quick || event.sender !== quick.webContents) throw Error("No permitido.");
    if (op === "source") return source;
    if (op === "text") {
      if (!source) throw Error("Abre la pregunta rápida desde otra app para traer su texto.");
      const r = await helper.text(source.hwnd);
      if (!r.text.trim()) throw Error(`No encuentro texto que leer en ${source.app}.`);
      return { ...r, app: source.app, title: source.title };
    }
    if (op === "windows") {
      const own = new Set(BrowserWindow.getAllWindows().map((w) => { try { return String(w.getNativeWindowHandle().readBigUInt64LE()); } catch { return ""; } }));
      return await listWindows({ exclude: (s) => own.has((/^window:(\d+):/.exec(s.id) || [])[1]) || /^Colmena/i.test(s.name) });
    }
    if (op === "captureWindow") {
      const target = args.id ? { id: String(args.id) } : source ? { hwnd: source.hwnd } : null;
      if (!target) throw Error("Elige qué ventana capturar.");
      return await captureWindow(target);
    }
    if (op === "captureArea") {
      capturing = true;
      quick.hide();
      try {
        await new Promise((r) => setTimeout(r, 120)); // the card is gone from the screen before it is frozen
        return await captureArea({ origin: getOrigin() });
      } finally {
        capturing = false;
        showQuick();
      }
    }
    if (op === "paste") {
      if (!source) throw Error("No sé en qué app pegarlo.");
      const text = String(args.text || "");
      if (!text.trim()) throw Error("No hay respuesta que pegar.");
      clipboard.writeText(text);
      capturing = true;
      quick.hide();
      try {
        const r = await helper.paste(source.hwnd);
        if (r?.ok) return { ok: true, app: source.app };
        showQuick();
        throw Error(r?.reason === "gone" ? `${source.app} ya no está abierta. La respuesta está copiada: pégala con Ctrl+V.` : `No pude volver a ${source.app}. La respuesta está copiada: pégala con Ctrl+V.`);
      } finally {
        capturing = false;
      }
    }
    throw Error("Operación desconocida.");
  });

  // «+» › Captura in the main window (Codex «Añadir»): the whole screen, an area or another
  // window. Colmena steps out of the way for the shot and comes back; only the picture goes
  // to the page, as data, and only to the main window.
  ipcMain.handle("colmena-main-capture", async (event, op, args = {}) => {
    const main = getMain();
    if (!main || main.isDestroyed() || event.sender !== main.webContents) throw Error("No permitido.");
    const away = async (fn) => {
      const bounds = main.getBounds();
      capturing = true;
      main.hide();
      try {
        await new Promise((r) => setTimeout(r, 250)); // the window has faded out before the shot
        return await fn(bounds);
      } finally {
        capturing = false;
        main.show();
        main.focus();
      }
    };
    if (op === "windows") {
      const own = new Set(BrowserWindow.getAllWindows().map((w) => { try { return String(w.getNativeWindowHandle().readBigUInt64LE()); } catch { return ""; } }));
      return await listWindows({ exclude: (s) => own.has((/^window:(\d+):/.exec(s.id) || [])[1]) || /^Colmena/i.test(s.name) });
    }
    if (op === "window") {
      if (!args.id) throw Error("Elige qué ventana capturar.");
      return await captureWindow({ id: String(args.id) });
    }
    if (op === "screen") return await away((bounds) => captureScreen({ near: bounds }));
    if (op === "area") return await away(() => captureArea({ origin: getOrigin() }));
    throw Error("Operación desconocida.");
  });

  // «Mantener el ordenador despierto mientras trabajan» (OpenClaw Keep computer awake): only
  // idle system sleep is prevented, the screen may still turn off, and only while bots work.
  let blocker = null;
  const syncAwake = () => {
    const want = prefs.keepAwake !== false && (Number(presence.working) || 0) > 0 && !presence.paused;
    if (want && blocker === null) { try { blocker = powerSaveBlocker.start("prevent-app-suspension"); } catch { blocker = null; } }
    else if (!want && blocker !== null) { try { powerSaveBlocker.stop(blocker); } catch {} blocker = null; }
  };
  // In development the executable needs the app script; packaged, it does not.
  const loginArgs = () => (app.isPackaged ? ["--hidden"] : [path.join(__dirname, "main.cjs"), "--hidden"]);
  const loginOn = () => { try { return !!app.getLoginItemSettings({ args: loginArgs() }).openAtLogin || !!app.getLoginItemSettings().openAtLogin; } catch { return false; } };
  // Already on: register it again with the current executable (Colmena.exe, its own icon).
  if (loginOn()) { try { app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: loginArgs() }); } catch {} }

  const tray = new Tray(icon);
  tray.setToolTip("Colmena");
  const statusLine = () => {
    const w = Number(presence.waiting) || 0, k = Number(presence.working) || 0;
    if (presence.paused) return "Equipo en pausa";
    if (w) return plural(w, "cosa te espera", "cosas te esperan") + (k ? " · " + plural(k, "misión en marcha", "misiones en marcha") : "");
    if (k) return plural(k, "misión en marcha", "misiones en marcha");
    return "Todo tranquilo";
  };
  const menu = () => Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    ...(Number(presence.waiting) ? [{ label: "Ver lo que te espera", click: () => showMain("/bandeja") }] : []),
    { type: "separator" },
    { label: "Abrir Colmena", click: () => showMain() },
    { label: "Pregunta rápida" + (shortcut ? "  (" + keysLabel(shortcut) + ")" : ""), click: () => openQuick() },
    { type: "separator" },
    {
      label: "Mantener el ordenador despierto mientras trabajan" + (prefs.keepAwake !== false && Number(presence.working) && blocker === null ? " (no disponible)" : ""),
      type: "checkbox", checked: prefs.keepAwake !== false,
      click: (item) => { prefs.keepAwake = item.checked; writePrefs(prefs); syncAwake(); refreshMenu(); },
    },
    {
      label: "Abrir Colmena al iniciar Windows", type: "checkbox", checked: loginOn(),
      click: (item) => { try { app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: loginArgs() }); } catch {} refreshMenu(); },
    },
    { type: "separator" },
    { label: "Salir de Colmena", click: () => { quitting = true; app.quit(); } },
  ]);
  const refreshMenu = () => tray.setContextMenu(menu());
  refreshMenu();
  tray.on("click", () => showMain());

  for (const keys of SHORTCUTS) {
    try {
      if (globalShortcut.register(keys, openQuick)) { shortcut = keys; break; }
    } catch {}
  }
  refreshMenu();
  console.log(shortcut ? "Colmena: pregunta rápida en " + shortcut : "Colmena: ningún atajo libre para la pregunta rápida (usa el icono junto al reloj)");
  app.on("will-quit", () => { globalShortcut.unregisterAll(); if (blocker !== null) try { powerSaveBlocker.stop(blocker); } catch {} });

  /**
   * presence {working, waiting, paused, finished}: dormido when the team is paused, alerta
   * when something waits for you, cargando while bots work, feliz for a few seconds when a
   * mission just finished; the normal logo otherwise. The taskbar button shows how many
   * things wait for you as a counter.
   */
  let lastFinished = null, happyUntil = 0, happyTimer = null, lastLine = "";
  const setPresence = (p = {}) => {
    presence = p;
    const finished = Number(p.finished) || 0;
    if (lastFinished !== null && finished > lastFinished) {
      happyUntil = Date.now() + 6000;
      clearTimeout(happyTimer);
      happyTimer = setTimeout(() => setPresence(p), 6100);
    }
    lastFinished = finished;
    const happy = Date.now() < happyUntil;
    const mood = p.paused ? "dormido" : p.waiting ? "alerta" : happy ? "feliz" : p.working ? "cargando" : null;
    try { tray.setImage(mood ? face(mood) : icon); } catch {}
    tray.setToolTip("Colmena · " + (happy && !p.waiting ? "misión terminada" : statusLine().toLowerCase()));
    const win = getMain();
    if (win && !win.isDestroyed() && process.platform === "win32") {
      const count = Number(p.pending ?? p.waiting) || 0;
      try { win.setOverlayIcon(count ? badge(count) : null, count ? plural(count, "cosa te espera", "cosas te esperan") : ""); } catch {}
    }
    syncAwake();
    const line = statusLine() + "|" + (blocker !== null);
    if (line !== lastLine) { lastLine = line; refreshMenu(); }
  };

  return { keepRunning, showMain, openQuick, setPresence, get shortcut() { return shortcut; } };
}

module.exports = { setupBackground };
