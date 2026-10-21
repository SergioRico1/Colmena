// Window controls for Colmena's own title bar (frameless window, like NEXO).
// Only these calls cross into the main process; nothing else is exposed.
// edit(): cut / copy / paste / selectAll for Colmena's own context menu.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("colmenaWindow", {
  minimize: () => ipcRenderer.send("colmena-window", "minimize"),
  toggleMaximize: () => ipcRenderer.send("colmena-window", "toggle-maximize"),
  close: () => ipcRenderer.send("colmena-window", "close"),
  pickFolder: (purpose) => ipcRenderer.invoke("colmena-pick-folder", purpose === "code" ? "code" : "share"),
  // «+» › Captura: {dataUrl, width, height, bytes, name}, or null when you cancel an area.
  capture: {
    windows: () => ipcRenderer.invoke("colmena-main-capture", "windows"),
    window: (id) => ipcRenderer.invoke("colmena-main-capture", "window", { id: String(id || "") }),
    screen: () => ipcRenderer.invoke("colmena-main-capture", "screen"),
    area: () => ipcRenderer.invoke("colmena-main-capture", "area"),
  },
  // «Pregunta rápida» window only (the main process ignores it from other windows).
  quick: {
    hide: () => ipcRenderer.send("colmena-quick", "hide"),
    open: (url) => ipcRenderer.send("colmena-quick", "open", String(url || "/")),
    // A height in px (the card asks for what its content needs) or "large"/"small".
    size: (which) => ipcRenderer.send("colmena-quick", "size", typeof which === "number" ? which : which === "large" ? "large" : "small"),
    // The window you came from, its text, screenshots and «Pegar en …» (OpenClaw Quick Chat).
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
  // A notice's sound («done» | «needs»), sent by the main process (Ajustes › Avisos).
  onSound: (callback) => {
    const listener = (_event, kind) => callback(kind === "needs" ? "needs" : "done");
    ipcRenderer.on("colmena-sound", listener);
    return () => ipcRenderer.removeListener("colmena-sound", listener);
  },
  // New versions (desktop/updater.cjs): its state, «Buscar actualizaciones», «Reiniciar», channel.
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
  edit: (action) => ["cut", "copy", "paste", "selectAll"].includes(action) && ipcRenderer.send("colmena-window", "edit:" + action),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("colmena-window-state", listener);
    ipcRenderer.send("colmena-window", "state");
    return () => ipcRenderer.removeListener("colmena-window-state", listener);
  },
});
