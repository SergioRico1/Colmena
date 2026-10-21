// The area picker of «Pregunta rápida»: it only receives its frozen picture and answers
// with the rectangle you chose (or that you cancelled). Nothing else is exposed.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("colmenaArea", {
  onImage: (callback) => {
    ipcRenderer.once("colmena-area-image", (_event, payload) => callback(payload));
    ipcRenderer.send("colmena-area", "ready");
  },
  done: (rect) => ipcRenderer.send("colmena-area", "done", {
    x: Number(rect?.x) || 0, y: Number(rect?.y) || 0, width: Number(rect?.width) || 0, height: Number(rect?.height) || 0,
  }),
  cancel: () => ipcRenderer.send("colmena-area", "cancel"),
});
