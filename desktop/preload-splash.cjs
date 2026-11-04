// The start-up window (desktop/splash/splash.html): «Reintentar» and «Abrir el registro».
// Only these two calls cross into the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("colmenaSplash", {
  retry: () => ipcRenderer.send("colmena-startup", "retry"),
  openLog: () => ipcRenderer.send("colmena-startup", "log"),
});
