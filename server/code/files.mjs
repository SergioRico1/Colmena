// «Archivos» of a «Código» task (DeepSeek Harness file tree): the task copy's folder, one directory
// at a time, read-only, and «Mostrar en el Explorador». Every path comes from the page as a path
// relative to the task folder and must stay inside it: no «..», no absolute paths, no drive
// letters or streams, and its real path (links and junctions followed) inside the folder's real path.
import { open, readdir, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

/** Folders shown but never opened (dependencies, version control, caches): heavy and not yours. */
export const HEAVY_DIRS = Object.freeze([
  ".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".tox",
  ".next", ".nuxt", ".turbo", ".cache", ".parcel-cache", ".svelte-kit", ".gradle", "target",
]);
const HEAVY = new Set(HEAVY_DIRS);
export const MAX_TEXT = 400 * 1024;
export const MAX_IMAGE = 4 * 1024 * 1024;
export const MAX_ENTRIES = 2000;
const IMAGES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif" };

const fail = (status, message) => Object.assign(Error(message), { status });

/**
 * A path from the page → «src/app.js» («» is the folder itself), or a 400. Separators may be
 * either slash; «.» segments go; «..», absolute paths, drive letters, «:» and NUL are refused.
 */
export function cleanRel(rel) {
  const text = String(rel ?? "").trim();
  if (text.length > 1000 || /[\0:]/.test(text) || /^[\\/]/.test(text) || path.isAbsolute(text) || path.win32.isAbsolute(text)) throw fail(400, "Esa ruta no es de la tarea.");
  const parts = text.split(/[\\/]+/).filter((p) => p && p !== ".");
  if (parts.some((p) => p === ".." || /^\.{2,}$/.test(p.trim()))) throw fail(400, "Esa ruta no es de la tarea.");
  return parts.join("/");
}

/** Whether `child` is `root` or below it (both already real, absolute paths). */
export function within(root, child) {
  const rel = path.relative(root, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The real path of `rel` inside `root`, or a 400/403/404. → {rel, full, real, root} */
export async function resolveInside(root, rel) {
  const clean = cleanRel(rel);
  let realRoot;
  try { realRoot = await realpath(root); } catch { throw fail(409, "La copia de esta tarea ya no está en el disco."); }
  let real;
  try { real = await realpath(path.join(realRoot, clean)); } catch { throw fail(404, "Ese archivo ya no está."); }
  if (!within(realRoot, real)) throw fail(403, "Esa ruta lleva fuera de la tarea.");
  return { rel: clean, full: path.join(root, clean), real, root: realRoot };
}

/** The task's file list (listFiles: Git's view, .gitignore respected) as sets for the tree. */
const trackedCache = new WeakMap();
export function trackedSets(files) {
  if (!Array.isArray(files) || !files.length) return null;
  if (trackedCache.has(files)) return trackedCache.get(files);
  const set = new Set(files), dirs = new Set();
  for (const f of files) for (let i = f.indexOf("/"); i > 0; i = f.indexOf("/", i + 1)) dirs.add(f.slice(0, i));
  const value = { files: set, dirs };
  trackedCache.set(files, value);
  return value;
}

const order = (a, b) => (a.type === "dir") !== (b.type === "dir") ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" });

/**
 * One directory of the task: {dir, entries: [{name, path, type: "dir"|"file", size?, heavy?,
 * link?}], hidden, truncated}. Heavy folders come closed (`heavy`); with `tracked`
 * (trackedSets) what Git ignores is left out and counted in `hidden`.
 */
export async function listDir(root, rel = "", { tracked = null, max = MAX_ENTRIES } = {}) {
  const at = await resolveInside(root, rel);
  if (!(await stat(at.real)).isDirectory()) throw fail(400, "Eso no es una carpeta.");
  const dirents = await readdir(at.real, { withFileTypes: true });
  const entries = [];
  let hidden = 0;
  for (const e of dirents) {
    const childRel = at.rel ? at.rel + "/" + e.name : e.name;
    if (e.name === ".git" && e.isFile()) continue; // a worktree's pointer to its repository
    const heavy = HEAVY.has(e.name.toLowerCase()) && (e.isDirectory() || e.isSymbolicLink());
    if (heavy) { entries.push({ name: e.name, path: childRel, type: "dir", heavy: true }); continue; }
    let type = e.isDirectory() ? "dir" : e.isFile() ? "file" : null;
    let link = false;
    if (e.isSymbolicLink()) {
      // A link counts only when it lands inside the task (otherwise it is listed but cannot be opened).
      link = true;
      try {
        const target = await realpath(path.join(at.real, e.name));
        if (!within(at.root, target)) { entries.push({ name: e.name, path: childRel, type: "file", link: "out" }); continue; }
        type = (await stat(target)).isDirectory() ? "dir" : "file";
      } catch { continue; }
    }
    if (!type) continue;
    if (tracked && (type === "file" ? !tracked.files.has(childRel) : !tracked.dirs.has(childRel))) { hidden++; continue; }
    entries.push({ name: e.name, path: childRel, type, ...(link ? { link: true } : {}) });
  }
  entries.sort(order);
  const truncated = entries.length > max;
  const shown = entries.slice(0, max);
  await Promise.all(shown.filter((e) => e.type === "file" && !e.link).map(async (e) => { try { e.size = (await stat(path.join(at.real, e.name))).size; } catch {} }));
  return { dir: at.rel, entries: shown, hidden, truncated };
}

/**
 * A file to look at: text (the first 400 KB, `truncated` beyond), an image as a data URL, or
 * `binary` (it cannot be shown). → {path, size, kind: "text"|"image"|"binary", text?, dataUrl?, truncated?}
 */
export async function readPreview(root, rel, { maxText = MAX_TEXT, maxImage = MAX_IMAGE } = {}) {
  const at = await resolveInside(root, rel);
  const info = await stat(at.real);
  if (info.isDirectory()) throw fail(400, "Es una carpeta.");
  const base = { path: at.rel, size: info.size };
  const mime = IMAGES[path.extname(at.rel).toLowerCase()];
  const handle = await open(at.real, "r");
  try {
    if (mime) {
      if (info.size > maxImage) return { ...base, kind: "binary", reason: "big" };
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(info.size), 0, info.size, 0);
      return { ...base, kind: "image", dataUrl: "data:" + mime + ";base64," + buffer.subarray(0, bytesRead).toString("base64") };
    }
    const want = Math.min(info.size, maxText);
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(want), 0, want, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.subarray(0, 8000).includes(0)) return { ...base, kind: "binary" };
    let text = bytes.toString("utf8");
    const truncated = info.size > maxText;
    if (truncated) text = text.slice(0, Math.max(0, text.lastIndexOf("\n")) || text.length); // never half a line
    return { ...base, kind: "text", text, truncated };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * How the system shows `full` in its file manager: Explorer with the item selected, Finder
 * (open -R), or the folder elsewhere. `folder`: open it rather than select it in its parent.
 */
export function revealCommand(full, { platform = process.platform, folder = false } = {}) {
  if (platform === "win32") return { file: path.win32.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), args: folder ? [full] : ["/select," + '"' + full + '"'], verbatim: !folder };
  if (platform === "darwin") return { file: "open", args: folder ? [full] : ["-R", full], verbatim: false };
  return { file: "xdg-open", args: [folder ? full : path.dirname(full)], verbatim: false };
}

/** Shows it (the server's way, when Colmena is not the desktop app). */
export function reveal(full, opts = {}) {
  const { file, args, verbatim } = revealCommand(full, opts);
  const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: verbatim });
  child.on("error", () => {});
  child.unref();
}
