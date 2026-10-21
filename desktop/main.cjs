const { app, BrowserWindow, shell, Notification, ipcMain, dialog } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const { existsSync, readFileSync } = require("node:fs");
const { createBrowserManager, attachBackend, toBackend } = require("./browser.cjs");
const { render } = require("./render.cjs");
const { setupBackground } = require("./background.cjs");
const { setupUpdater } = require("./updater.cjs");
let backend, computer, backendOrigin = null, mainWin = null, background = null, updater = null;
// The team at work, from the server ("presence"): the tray face and the updater read it.
let presence = {};
app.setName("Colmena");
// A separate desktop profile (window state, tray choices, single-instance lock) for testing
// an installed copy next to the one in use; pair it with COLMENA_DATA_DIR for the data.
if (process.env.COLMENA_USER_DATA) app.setPath("userData", process.env.COLMENA_USER_DATA);
// Own taskbar identity and icon (not Electron's). The id changed when Colmena got its own
// executable (scripts/desktop.mjs → Colmena.exe, icon embedded): Windows caches a taskbar
// icon per id, and the old one had cached electron.exe's.
const APP_ID = "Colmena.App";
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
const ICON = path.join(__dirname, "icons", process.platform === "win32" ? "colmena.ico" : "colmena.png");
// Where Windows reads the icon from: the branded executable itself when it is ours.
const ICON_SOURCE = process.platform === "win32" && /^colmena\.exe$/i.test(path.basename(process.execPath)) ? process.execPath : ICON;
/**
 * Windows resolves a taskbar button's icon from a Start Menu shortcut that carries the same
 * AppUserModelID; without one it may fall back to electron.exe's icon. Colmena keeps its own
 * shortcut (as an installer would) with its id and icon, created or refreshed at start.
 */
function ensureShortcut() {
  // Installed copies get theirs from the installer (same id and icon).
  if (process.platform !== "win32" || app.isPackaged) return;
  try {
    const link = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Colmena.lnk");
    const wanted = { target: process.execPath, args: '"' + path.join(__dirname, "main.cjs") + '"', icon: ICON_SOURCE, iconIndex: 0, appUserModelId: APP_ID, description: "Colmena", cwd: path.join(__dirname, "..") };
    let current = null;
    try { current = shell.readShortcutLink(link); } catch {}
    // An installed Colmena owns that shortcut: development runs never take it over.
    if (current?.target && !current.args && existsSync(current.target)) return;
    const same = current && ["target", "args", "icon", "appUserModelId"].every((k) => String(current[k] || "") === String(wanted[k]));
    if (!same) shell.writeShortcutLink(link, current ? "replace" : "create", wanted);
  } catch {}
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(async () => {
    ensureShortcut();
    updater = setupUpdater({ isBusy: () => (presence.working || 0) > 0 });
    const openWindow = (origin) => {
      backendOrigin = backendOrigin || origin;
      const win = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 760,
        minHeight: 600,
        title: "Colmena",
        icon: ICON,
        // Started with Windows («Abrir Colmena al iniciar Windows»): next to the clock, not in your face.
        show: !process.argv.includes("--hidden"),
        backgroundColor: "#EEF0F4",
        autoHideMenuBar: true,
        // Colmena draws its own title bar (minimise / maximise / close), as NEXO does.
        // Frameless windows keep Windows 11's rounded corners and native resizing.
        frame: false,
        thickFrame: true,
        roundedCorners: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: path.join(__dirname, "preload-window.cjs"),
          // The notice sounds play while the window is hidden next to the clock.
          autoplayPolicy: "no-user-gesture-required",
        },
      });
      // Windows takes the taskbar button's icon from the app identity, not only from the
      // window: give that identity Colmena's icon and name (otherwise Electron's shows).
      if (process.platform === "win32") {
        win.setIcon(ICON);
        win.setAppDetails({
          appId: APP_ID,
          appIconPath: ICON_SOURCE,
          appIconIndex: 0,
          relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${path.join(__dirname, "main.cjs")}"`,
          relaunchDisplayName: "Colmena",
        });
      }
      const sendState = () => {
        if (!win.isDestroyed()) win.webContents.send("colmena-window-state", { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() });
      };
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
      // «Elegir carpeta…»: the system folder dialog; only the chosen path goes back.
      if (!ipcMain.listenerCount("colmena-pick-folder") && !ipcMain._colmenaPick) {
        ipcMain._colmenaPick = true;
        ipcMain.handle("colmena-pick-folder", async (event, purpose) => {
          const owner = BrowserWindow.fromWebContents(event.sender);
          // «Código» opens a project folder; elsewhere a folder is shared with the team.
          const labels = purpose === "code" ? { title: "Elige la carpeta del proyecto", buttonLabel: "Abrir proyecto" } : { title: "Elige una carpeta para tu equipo", buttonLabel: "Compartir esta carpeta" };
          const result = await dialog.showOpenDialog(owner, { ...labels, properties: ["openDirectory", "dontAddToRecent"] });
          return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
        });
      }
      win.on("closed", () => ipcMain.removeListener("colmena-window", onWindow));
      // Login pages (ChatGPT and app connections) open in the system browser;
      // the window itself only ever shows the local Colmena origin.
      const external = (url) => {
        try {
          const u = new URL(url);
          if (
            u.protocol === "https:" &&
            ["auth.openai.com", "github.com", "connect.composio.dev", "app.composio.dev"].includes(u.hostname) &&
            !u.username && !u.password && !u.port
          )
            shell.openExternal(u.href);
        } catch {}
      };
      win.webContents.setWindowOpenHandler(({ url }) => {
        external(url);
        return { action: "deny" };
      });
      win.webContents.on("will-navigate", (event, url) => {
        let target = null;
        try {
          target = new URL(url).origin;
        } catch {}
        if (target === origin) return;
        event.preventDefault();
        external(url);
      });
      // Hidden bot browser windows must not keep Colmena alive.
      win.on("closed", () => app.quit());
      win.loadURL(origin);
      mainWin = win;
      // Tray icon, «Pregunta rápida» shortcut and keep-running-when-closed.
      background = background || setupBackground({ icon: ICON, preload: path.join(__dirname, "preload-window.cjs"), getMain: () => mainWin, getOrigin: () => backendOrigin });
      background.keepRunning(win);
    };
    app.on("second-instance", () => background?.showMain());
    try {
      const directory =
        process.env.COLMENA_DATA_DIR ||
        path.join(
          process.env.LOCALAPPDATA ||
            path.join(os.homedir(), ".local", "share"),
          "Colmena",
        );
      const existing = JSON.parse(
        readFileSync(path.join(directory, "instance.json"), "utf8"),
      );
      const url = new URL(existing.origin);
      if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
        throw Error("Invalid local origin");
      const status = await (
        await fetch(url.origin + "/api/health", {
          signal: AbortSignal.timeout(2000),
        })
      ).json();
      if (status.application === "Colmena" && status.pid === existing.pid) {
        openWindow(url.origin);
        return;
      }
    } catch {}
    // Installed, the server runs on Electron's own Node (the same Node 24), so nobody has to
    // install Node.js; while developing, on the Node.js of this computer as before.
    const ownNode = app.isPackaged && !process.env.COLMENA_NODE;
    backend = spawn(
      process.env.COLMENA_NODE || (ownNode ? process.execPath : "node"),
      [path.join(__dirname, "../server/index.mjs"), "--production"],
      {
        cwd: path.join(__dirname, ".."),
        windowsHide: true,
        // Node keeps the compiled server modules between launches (faster start).
        env: { ...process.env, ...(ownNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), COLMENA_PORT: "0", COLMENA_COMPUTER: "1", NODE_COMPILE_CACHE: path.join(app.getPath("userData"), "node-compile-cache") },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    // Computer bridge: {type:'computer', id, op, args} -> {type:'computer-result', id, ok, result|error}.
    computer = createBrowserManager({
      sendFrame: (frame) => toBackend(backend, { type: "computer-frame", ...frame }),
      sendEvent: (event) => toBackend(backend, { type: "computer-event", ...event }),
    });
    // «render» draws Colmena's own pages (presentations and documents: pictures, PDF, layout checks).
    attachBackend(backend, { handle: (op, args) => (op === "render" ? render(args) : computer.handle(op, args)) });
    // «Una novedad»: Windows notification; a click brings Colmena to the related screen.
    // With one pending approval it also carries buttons (see quickActions on the server):
    // «Permitir» for local permissions, a question's options, «Aprobar el plan». Anything
    // that leaves this computer only opens Colmena.
    const showIn = (url) => {
      const win = mainWin && !mainWin.isDestroyed() ? mainWin : null;
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (String(url || "").startsWith("/")) win.webContents.executeJavaScript(`history.pushState(null,"",${JSON.stringify(url)});dispatchEvent(new Event("colmena:navigate"))`).catch(() => {});
    };
    const toast = (title, body, url) => {
      const n = new Notification({ title, body, silent: true });
      if (url) n.on("click", () => showIn(url));
      n.show();
    };
    const decideFromNotice = async (quick, choice, url) => {
      try {
        const origin = backendOrigin;
        const token = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
        const state = await (await fetch(origin + "/api/state")).json();
        const a = (state.approvals || []).find((x) => x.id === quick.approvalId);
        if (!a || a.status !== "pending") return toast("Ya estaba resuelto", "Esto ya no esperaba tu respuesta.", url);
        const send = (route, body) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": token }, body: JSON.stringify(body) })
          .then(async (r) => { if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || "No se pudo."); });
        if (quick.kind === "permission") await send(`/approvals/${a.id}`, { decision: "approved", revision: a.revision });
        else if (quick.kind === "question") await send(`/approvals/${a.id}/answer`, { optionId: choice, revision: a.revision });
        else if (quick.kind === "plan") await send(`/missions/${a.missionId}/plan`, { decision: "approved" });
        toast("Hecho", quick.kind === "question" ? "Respuesta enviada. El equipo sigue." : quick.kind === "plan" ? "Plan aprobado. El equipo empieza." : "Permitido. El bot sigue.", url);
      } catch (error) {
        toast("No se pudo desde el aviso", String(error.message || error) + " Ábrelo en Colmena.", url);
      }
    };
    // The face of each Windows notification says what kind it is.
    const noticeFace = (message) => {
      const name = message.quick?.kind === "question" ? "duda" : message.kind === "done" ? "feliz" : message.kind === "failed" ? "plano" : message.kind === "digest" ? "guino" : "alerta";
      return path.join(__dirname, "icons", "faces", name + "-256.png");
    };
    // «Cómo te avisa» (Ajustes › Avisos): the server says whether this notice is a Windows
    // notice, a sound («done» or «needs», played by the window: each kind its own), or both.
    const playSound = (sound) => {
      const win = mainWin && !mainWin.isDestroyed() ? mainWin : null;
      if (win && ["done", "needs"].includes(sound)) win.webContents.send("colmena-sound", sound);
    };
    backend.on("message", (message) => {
      if (message?.type === "presence") { presence = message; background?.setPresence?.(message); updater?.workChanged(); return; }
      if (message?.type !== "notify") return;
      playSound(message.sound);
      if (message.toast === false || !Notification.isSupported()) return;
      const quick = message.quick || null;
      const buttons = !quick ? [] : quick.kind === "question" ? quick.options.map((o) => ({ type: "button", text: o.label, choice: o.id }))
        : quick.kind === "plan" ? [{ type: "button", text: "Aprobar el plan" }] : [{ type: "button", text: "Permitir" }];
      if (buttons.length) buttons.push({ type: "button", text: "Abrir" });
      // A short hashed tag (Windows drops long ones); the room's newer notice replaces its older one.
      const tag = /^[0-9a-f]{16}$/.test(String(message.tag || "")) ? message.tag : undefined;
      const note = new Notification({ ...(tag ? { id: tag } : {}), title: String(message.title || "Colmena").slice(0, 120), body: String(message.text || "").slice(0, 300), silent: true, icon: noticeFace(message), actions: buttons.map(({ type, text }) => ({ type, text })) });
      note.on("click", () => showIn(message.url));
      note.on("action", (_event, index) => {
        const b = buttons[index];
        if (!b || b.text === "Abrir") return showIn(message.url);
        decideFromNotice(quick, b.choice, message.url);
      });
      note.show();
    });
    let output = "",
      opened = false;
    backend.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/COLMENA_READY (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match || opened) return;
      opened = true;
      backendOrigin = match[1];
      openWindow(match[1]);
    });
    backend.stderr.on("data", (chunk) => console.error(String(chunk)));
    backend.on("error", (error) => {
      require("electron").dialog.showErrorBox(
        "No se pudo iniciar Colmena",
        error.message,
      );
      app.quit();
    });
    backend.on("exit", (code) => {
      if (code && !opened)
        require("electron").dialog.showErrorBox(
          "No se pudo iniciar Colmena",
          app.isPackaged ? "El servicio local terminó. Vuelve a abrir Colmena; si sigue pasando, reinstálala: tus datos se conservan." : "El servicio local termino. Comprueba Node 24 y ejecuta npm run build.",
        );
      app.quit();
    });
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  computer?.shutdown();
  if (backend?.connected) backend.disconnect();
});
