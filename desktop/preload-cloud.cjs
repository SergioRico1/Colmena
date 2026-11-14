// The cloud window's bridge (desktop/cloud.cjs): Colmena's own title bar, theme, sounds,
// updates, captures and «Pregunta rápida» as in the local mode, plus `cloud`: this computer's
// identity for «Tus dispositivos», the sign-in hand-back, presence for the tray and badge, and
// notices. The page is a website: nothing here reads files, picks folders or changes what this
// computer lends (that is the local «Este ordenador» window, out of the page's reach).
const { contextBridge, ipcRenderer } = require("electron");

const cloud = (op, args) => ipcRenderer.invoke("colmena-cloud", op, args || {});
contextBridge.exposeInMainWorld("colmenaWindow", {
  minimize: () => ipcRenderer.send("colmena-window", "minimize"),
  toggleMaximize: () => ipcRenderer.send("colmena-window", "toggle-maximize"),
  close: () => ipcRenderer.send("colmena-window", "close"),
  capture: {
    windows: () => ipcRenderer.invoke("colmena-main-capture", "windows"),
    window: (id) => ipcRenderer.invoke("colmena-main-capture", "window", { id: String(id || "") }),
    screen: () => ipcRenderer.invoke("colmena-main-capture", "screen"),
    area: () => ipcRenderer.invoke("colmena-main-capture", "area"),
  },
  quick: {
    hide: () => ipcRenderer.send("colmena-quick", "hide"),
    open: (url) => ipcRenderer.send("colmena-quick", "open", String(url || "/")),
    size: (which) => ipcRenderer.send("colmena-quick", "size", typeof which === "number" ? which : which === "large" ? "large" : "small"),
    source: () => ipcRenderer.invoke("colmena-quick-op", "source"),
    readText: () => ipcRenderer.invoke("colmena-quick-op", "text"),
    windows: () => ipcRenderer.invoke("colmena-quick-op", "windows"),
    captureWindow: (id) => ipcRenderer.invoke("colmena-quick-op", "captureWindow", id ? { id: String(id) } : {}),
    captureArea: () => ipcRenderer.invoke("colmena-quick-op", "captureArea"),
    paste: (text) => ipcRenderer.invoke("colmena-quick-op", "paste", { text: String(text || "") }),
    onShown: (callback) => {
      const listener = (_event, payload) => callback(payload || {});
      ipcRenderer.on("colmena-quick-shown", listener);
      return () => ipcRenderer.removeListener("colmena-quick-shown", listener);
    },
  },
  onSound: (callback) => {
    const listener = (_event, kind) => callback(kind === "needs" ? "needs" : "done");
    ipcRenderer.on("colmena-sound", listener);
    return () => ipcRenderer.removeListener("colmena-sound", listener);
  },
  updates: {
    state: () => ipcRenderer.invoke("colmena-update", "state"),
    check: () => ipcRenderer.invoke("colmena-update", "check"),
    restart: () => ipcRenderer.invoke("colmena-update", "restart"),
    cancelWait: () => ipcRenderer.invoke("colmena-update", "cancel-wait"),
    download: () => ipcRenderer.invoke("colmena-update", "download"),
    setChannel: (channel) => ipcRenderer.invoke("colmena-update", "channel", channel === "beta" ? "beta" : "stable"),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("colmena-update", listener);
      return () => ipcRenderer.removeListener("colmena-update", listener);
    },
  },
  setTheme: (mode) => ipcRenderer.send("colmena-theme", ["system", "light", "dark"].includes(mode) ? mode : "system"),
  edit: (action) => ["cut", "copy", "paste", "selectAll"].includes(action) && ipcRenderer.send("colmena-window", "edit:" + action),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("colmena-window-state", listener);
    ipcRenderer.send("colmena-window", "state");
    return () => ipcRenderer.removeListener("colmena-window-state", listener);
  },
  // Cloud mode only.
  cloud: {
    identity: () => cloud("identity"),
    registered: (workspaceId, deviceId) => cloud("registered", { workspaceId: String(workspaceId || ""), deviceId: String(deviceId || "") }),
    reconnect: () => cloud("reconnect"),
    openApproval: (id) => cloud("open-approval", { id: String(id || "") }),
    openAgentSettings: () => cloud("agent-settings"),
    agent: () => cloud("agent"),
    presence: (p) => cloud("presence", { working: Number(p?.working) || 0, waiting: Number(p?.waiting) || 0, paused: !!p?.paused, finished: Number(p?.finished) || 0 }),
    notify: (n) => cloud("notify", { title: String(n?.title || "").slice(0, 120), body: String(n?.body || "").slice(0, 300), url: String(n?.url || "").slice(0, 300) }),
    switchToLocal: () => cloud("mode"),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload || {});
      ipcRenderer.on("colmena-cloud-event", listener);
      return () => ipcRenderer.removeListener("colmena-cloud-event", listener);
    },
  },
});
