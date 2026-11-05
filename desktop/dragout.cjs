// Dragging a file out of Colmena into Explorer, Outlook, Word… (webContents.startDrag). The
// page names the file by the link it already shows (a work file, a deliverable, an
// attachment, an image); the local service says where that file is (GET /api/files/locate)
// and this process checks it itself before handing it to the system: a real file (no link),
// inside the chats' folders of Colmena's data folder or a folder you shared with the team.
// Nothing else on disk can be dragged, whatever the page asks.
const path = require("node:path");
const { realpathSync, lstatSync } = require("node:fs");

const inside = (file, root) => {
  const rel = path.relative(root, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};
const real = (p) => { try { return realpathSync.native(p); } catch { return null; } };
const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * The file to drag, or null: `file` must exist, be a plain file with one link, and its real
 * path be inside one of `roots` (also by their real paths). `dataDir`/workspaces is always a
 * root; `extra` are the shared folders the service listed.
 */
function allowedFile(file, { dataDir, extra = [] } = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file)) return null;
  let info;
  try { info = lstatSync(file); } catch { return null; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) return null;
  const target = real(file);
  if (!target) return null;
  const roots = [path.join(dataDir, "workspaces"), ...extra.filter((r) => typeof r === "string" && path.isAbsolute(r))]
    .map(real).filter(Boolean);
  // Colmena's own data (database, keys, vault) never, even when a shared folder holds it.
  const data = real(dataDir);
  if (data && inside(fold(target), fold(data)) && !inside(fold(target), fold(path.join(data, "workspaces")))) return null;
  return roots.some((r) => inside(fold(target), fold(r))) ? target : null;
}

/** The link → path lookups, kept a moment (the press warms it, the drag uses it). */
function setupDragOut({ ipcMain, app, nativeImage, getOrigin, dataDir, icon }) {
  const cache = new Map(); // url → {at, promise}
  const locate = (url) => {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < 30000) return hit.promise;
    const promise = (async () => {
      const origin = getOrigin();
      if (!origin) throw Error("Colmena aún está arrancando.");
      const r = await fetch(origin + "/api/files/locate?url=" + encodeURIComponent(url), { signal: AbortSignal.timeout(4000) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || "Ese archivo no se puede arrastrar.");
      return body;
    })();
    promise.catch(() => cache.delete(url));
    cache.set(url, { at: Date.now(), promise });
    while (cache.size > 50) cache.delete(cache.keys().next().value);
    return promise;
  };
  const fromColmena = (event) => {
    const origin = getOrigin();
    try { return !!origin && new URL(event.senderFrame?.url || event.sender.getURL()).origin === origin; } catch { return false; }
  };
  const fallbackIcon = () => {
    try { const img = nativeImage.createFromPath(icon); return img.isEmpty() ? img : img.resize({ width: 32, height: 32 }); } catch { return nativeImage.createEmpty(); }
  };
  ipcMain.on("colmena-drag-warm", (event, url) => {
    if (fromColmena(event) && typeof url === "string" && url.length <= 2000) locate(url).catch(() => {});
  });
  ipcMain.handle("colmena-drag-file", async (event, url) => {
    if (!fromColmena(event) || typeof url !== "string" || !url || url.length > 2000) return { ok: false, error: "Ese archivo no se puede arrastrar." };
    try {
      const found = await locate(url);
      const file = allowedFile(found.path, { dataDir, extra: found.roots || [] });
      if (!file) return { ok: false, error: "Ese archivo no se puede arrastrar fuera de Colmena." };
      let image = null;
      try { image = await Promise.race([app.getFileIcon(file, { size: "normal" }), new Promise((r) => setTimeout(() => r(null), 300))]); } catch {}
      if (!image || image.isEmpty()) image = fallbackIcon();
      event.sender.startDrag({ file, icon: image });
      return { ok: true, name: path.basename(file) };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
}

module.exports = { allowedFile, setupDragOut };
