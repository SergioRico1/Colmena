// «Este ordenador» (desktop/cloud/agent.html): the local allowlist of what this computer lends
// to the person's cloud bots, and «Llevar mis datos a la nube». A local page only the main
// process serves; the cloud's page has no way to it.
const { contextBridge, ipcRenderer } = require("electron");

const call = (op, args) => ipcRenderer.invoke("colmena-agent", op, args || {});
contextBridge.exposeInMainWorld("colmenaAgent", {
  identity: () => call("identity"),
  status: () => call("status"),
  setPolicy: (policy) => call("setPolicy", policy),
  pickFolder: (purpose) => call("pick-folder", { purpose: purpose === "code" ? "code" : "share" }),
  apps: () => call("apps"),
  managers: () => call("managers"),
  managerItems: (manager) => call("managerItems", { manager: String(manager || "") }),
  chooseLogin: (manager, itemId) => call("chooseLogin", { manager: String(manager || ""), itemId: String(itemId || "") }),
  claude: () => call("claude"),
  restart: () => call("restart"),
  migratePreview: () => call("migrate-preview"),
  migrate: (kinds) => call("migrate", { kinds: Array.isArray(kinds) ? kinds.map(String) : undefined }),
  window: (action) => call("window", { action: action === "minimize" ? "minimize" : "close" }),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("colmena-cloud-event", listener);
    return () => ipcRenderer.removeListener("colmena-cloud-event", listener);
  },
});
