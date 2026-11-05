// «Mostrar en el Explorador» (Finder on macOS) for a file of a «Código» task, and «Abrir la
// carpeta de la copia». The page names the task and a path relative to its folder; the local
// service says where that is (GET /api/code/tasks/:id/locate, which refuses anything outside the
// task folder) and this process checks it again before handing it to the system.
const path = require("node:path");
const { realpathSync, existsSync } = require("node:fs");

const real = (p) => { try { return realpathSync.native(p); } catch { return null; } };
const within = (root, child) => {
  const rel = path.relative(root, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The located path when it is safe to show: absolute, existing, its real self, inside its real root. */
function allowedReveal(found) {
  if (!found || typeof found.path !== "string" || typeof found.root !== "string") return null;
  if (!path.isAbsolute(found.path) || !path.isAbsolute(found.root) || !existsSync(found.path)) return null;
  const target = real(found.path), root = real(found.root);
  if (!target || !root || !within(root, target)) return null;
  return target;
}

function setupReveal({ ipcMain, shell, getOrigin }) {
  const fromColmena = (event) => {
    const origin = getOrigin();
    try { return !!origin && new URL(event.senderFrame?.url || event.sender.getURL()).origin === origin; } catch { return false; }
  };
  ipcMain.handle("colmena-reveal-path", async (event, request) => {
    const task = String(request?.task || ""), rel = String(request?.path ?? "");
    if (!fromColmena(event) || !/^[\w.-]{1,80}$/.test(task) || rel.length > 1000) return { ok: false, error: "No se puede mostrar." };
    try {
      const origin = getOrigin();
      const r = await fetch(origin + "/api/code/tasks/" + encodeURIComponent(task) + "/locate?path=" + encodeURIComponent(rel), { signal: AbortSignal.timeout(4000) });
      const found = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: found.error || "No se puede mostrar." };
      const target = allowedReveal(found);
      if (!target) return { ok: false, error: "Eso está fuera de la tarea." };
      if (found.top) {
        const problem = await shell.openPath(target);
        return problem ? { ok: false, error: problem } : { ok: true };
      }
      shell.showItemInFolder(target);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
}

module.exports = { allowedReveal, setupReveal };
