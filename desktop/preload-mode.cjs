// The first-run choice (desktop/cloud/mode.html): only the choice and closing cross over.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("colmenaMode", {
  choose: (mode) => ipcRenderer.send("colmena-mode-choice", mode === "cloud" ? "cloud" : "local"),
  close: () => ipcRenderer.send("colmena-mode-window", "close"),
});
