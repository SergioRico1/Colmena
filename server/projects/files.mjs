// Projects of a mission: a real folder «proyectos/<nombre>/» a bot edits, runs and previews
// (Codex's workspace). Every path goes through files.mjs safePath: no «..», no absolute
// paths, no links, no reserved Windows names. node_modules and .git are never written by a
// bot; deleting moves to the mission's bin («.papelera/…»), never erases.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { safePath } from "../files.mjs";

export const PROJECTS_DIR = "proyectos";
export const TRASH_DIR = ".papelera";
export const TEMPLATES = ["vite-react", "html", "vacio"];
export const FILE_LIMIT = 400 * 1024;
const LIST_LIMIT = 400;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite", ".cache", "build", "coverage"]);
const PROTECTED = new Set(["node_modules", ".git"]);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COLMENA_ROOT = path.resolve(HERE, "..", "..");
const TEMPLATE_ROOT = path.join(HERE, "templates");

/** «Tienda de Ana» → «tienda-de-ana». Throws when nothing usable is left. */
export function projectName(raw) {
  const name = String(raw || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  if (!name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(name)) throw Error("Nombre de proyecto no válido: usa letras, números y guiones.");
  return name;
}

/** Validates a path inside a project: forward slashes, no leading «/», nothing hidden behind «..». */
export function projectRelative(rel, { allowEmpty = false } = {}) {
  const clean = String(rel ?? "").trim().replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
  if (!clean) {
    if (allowEmpty) return "";
    throw Error("Indica la ruta del archivo dentro del proyecto (p. ej. «src/App.jsx»).");
  }
  if (clean.includes("\\")) throw Error("Usa «/» en las rutas, no «\\».");
  if (clean.length > 200) throw Error("Ruta demasiado larga.");
  return clean;
}

const isProtected = (rel) => PROTECTED.has(rel.split("/")[0].toLowerCase());

/** Absolute folder of a project (it must exist unless create). */
export async function projectRoot(missionRoot, name, { create = false } = {}) {
  const target = await safePath(missionRoot, PROJECTS_DIR + "/" + projectName(name), { parent: true });
  let info = null;
  try { info = await lstat(target); } catch {}
  if (!info) {
    if (!create) throw Error("No existe el proyecto «" + projectName(name) + "». Créalo antes con project_create.");
    await mkdir(target, { recursive: true });
  } else if (!info.isDirectory()) throw Error("«" + name + "» no es una carpeta.");
  return target;
}

/** Absolute path of a file of a project. write: refuses node_modules/.git and creates folders. */
export async function projectFile(missionRoot, name, rel, { write = false } = {}) {
  const clean = projectRelative(rel);
  if (write && isProtected(clean)) throw Error("No se escribe en node_modules ni en .git: instala con project_run (action install).");
  await projectRoot(missionRoot, name);
  try {
    return { clean, target: await safePath(missionRoot, PROJECTS_DIR + "/" + projectName(name) + "/" + clean, { parent: write }) };
  } catch (error) {
    if (error.code === "ENOENT") throw Error("No existe «" + clean + "» en el proyecto.");
    throw error;
  }
}

/** Projects of a mission: [{name, template, files}]. */
export async function listProjects(missionRoot) {
  let entries = [];
  try { entries = await readdir(path.join(missionRoot, PROJECTS_DIR), { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => ({ name: e.name }));
}

/** Recursive listing without node_modules, .git or build output: {files:[{path,size}], truncated}. */
export async function listProjectFiles(missionRoot, name, rel = "") {
  const root = await projectRoot(missionRoot, name);
  const start = projectRelative(rel, { allowEmpty: true });
  const base = start ? await safePath(missionRoot, PROJECTS_DIR + "/" + projectName(name) + "/" + start) : root;
  const files = [], skipped = new Set();
  let truncated = false;
  const walk = async (dir, prefix) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { throw Error("No existe la carpeta «" + (prefix || start) + "»."); }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= LIST_LIMIT) { truncated = true; return; }
      if (e.isSymbolicLink()) continue;
      const relPath = prefix ? prefix + "/" + e.name : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) { skipped.add(e.name); continue; }
        await walk(path.join(dir, e.name), relPath);
      } else if (e.isFile()) {
        let size = null;
        try { size = (await lstat(path.join(dir, e.name))).size; } catch {}
        files.push({ path: relPath, size });
      }
    }
  };
  await walk(base, start);
  return {
    project: projectName(name), folder: PROJECTS_DIR + "/" + projectName(name), files, truncated,
    omitted: [...skipped], dependencies: existsSync(path.join(root, "node_modules")) ? "instaladas" : existsSync(path.join(root, "package.json")) ? "sin instalar" : "no usa",
    hint: "Lee un archivo con read_file y la ruta «" + PROJECTS_DIR + "/" + projectName(name) + "/<archivo>».",
  };
}

/** Creates or replaces a text file of a project. */
export async function writeProjectFile(missionRoot, name, rel, content) {
  if (typeof content !== "string") throw Error("El contenido debe ser texto.");
  const bytes = Buffer.byteLength(content);
  if (bytes > FILE_LIMIT) throw Error("Archivo demasiado grande (máximo 400 KB). Divídelo en varios.");
  const { clean, target } = await projectFile(missionRoot, name, rel, { write: true });
  let existed = false;
  try { existed = (await lstat(target)).isFile(); } catch {}
  await writeFile(target, content);
  return { project: projectName(name), path: clean, bytes, created: !existed };
}

const occurrences = (text, piece) => {
  let n = 0;
  for (let i = text.indexOf(piece); i >= 0; i = text.indexOf(piece, i + piece.length)) n++;
  return n;
};

/**
 * Patch by exact replacement (Codex apply_patch, simplified): each `old` must appear exactly
 * once in the file at the time it is applied; all or nothing.
 */
export async function editProjectFile(missionRoot, name, rel, edits = []) {
  if (!Array.isArray(edits) || !edits.length) throw Error("Indica al menos un cambio {old, new}.");
  const { clean, target } = await projectFile(missionRoot, name, rel, { write: true });
  let text;
  try { text = await readFile(target, "utf8"); } catch { throw Error("No existe «" + clean + "»: créalo con project_write."); }
  edits.forEach((edit, i) => {
    const old = String(edit?.old ?? "");
    if (!old) throw Error("Cambio " + (i + 1) + ": «old» vacío. Para escribir el archivo entero usa project_write.");
    const n = occurrences(text, old);
    if (n === 0) throw Error("Cambio " + (i + 1) + ": el texto «old» no aparece en «" + clean + "». Léelo otra vez con read_file y copia el trozo exacto.");
    if (n > 1) throw Error("Cambio " + (i + 1) + ": el texto «old» aparece " + n + " veces en «" + clean + "». Añade líneas de alrededor para que sea único.");
    text = text.replace(old, () => String(edit.new ?? ""));
  });
  if (Buffer.byteLength(text) > FILE_LIMIT) throw Error("El archivo resultante supera 400 KB.");
  await writeFile(target, text);
  return { project: projectName(name), path: clean, edits: edits.length, bytes: Buffer.byteLength(text) };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15) + "-" + randomBytes(2).toString("hex");

/** Moves a file or folder of a project to «.papelera/<fecha>/proyectos/<nombre>/<ruta>». */
export async function trashProjectPath(missionRoot, name, rel) {
  const { clean, target } = await projectFile(missionRoot, name, rel);
  if (clean.split("/")[0].toLowerCase() === ".git") throw Error("No se borra .git.");
  let info;
  try { info = await lstat(target); } catch { throw Error("No existe «" + clean + "»."); }
  const where = TRASH_DIR + "/" + stamp() + "/" + PROJECTS_DIR + "/" + projectName(name) + "/" + clean;
  const destination = await safePath(missionRoot, where, { parent: true });
  await rename(target, destination);
  return { project: projectName(name), path: clean, folder: info.isDirectory(), movedTo: where, note: "Está en la papelera de la misión («" + where + "»): se puede recuperar." };
}

// ---------------------------------------------------------------- templates
/** Versions Colmena itself ships (the template uses them, so nothing is downloaded). */
export function colmenaVersion(pkg, root = COLMENA_ROOT) {
  try { return JSON.parse(readFileSync(path.join(root, "node_modules", pkg, "package.json"), "utf8")).version; } catch { return null; }
}

/** Packages needed by `names` in Colmena's node_modules (dependencies, installed optional ones). */
export function dependencyClosure(names, root = COLMENA_ROOT) {
  const modules = path.join(root, "node_modules");
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    const file = path.join(modules, name, "package.json");
    if (!existsSync(file)) return;
    seen.add(name);
    let pkg = {};
    try { pkg = JSON.parse(readFileSync(file, "utf8")); } catch {}
    for (const dep of Object.keys(pkg.dependencies || {})) walk(dep);
    for (const dep of Object.keys(pkg.optionalDependencies || {})) walk(dep);
    for (const dep of Object.keys(pkg.peerDependencies || {})) if (existsSync(path.join(modules, dep))) walk(dep);
  };
  names.forEach(walk);
  return [...seen].sort();
}

const VITE_REACT_DEPS = { dependencies: ["react", "react-dom"], devDependencies: ["vite", "@vitejs/plugin-react"] };

/** «.bin» shims (cmd-shim) so `npm run` finds the tools of copied packages. */
async function writeBinShims(projectDir, packages) {
  const bin = path.join(projectDir, "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  for (const name of packages) {
    let pkg;
    try { pkg = JSON.parse(await readFile(path.join(projectDir, "node_modules", name, "package.json"), "utf8")); } catch { continue; }
    const bins = typeof pkg.bin === "string" ? { [name.split("/").pop()]: pkg.bin } : pkg.bin || {};
    for (const [command, file] of Object.entries(bins)) {
      if (!/^[\w.-]+$/.test(command)) continue;
      const target = path.win32.join("..", name, file).replace(/\//g, "\\");
      await writeFile(path.join(bin, command + ".cmd"), `@ECHO off\r\nnode "%~dp0\\${target}" %*\r\n`);
    }
  }
}

/**
 * Creates proyectos/<name>/ from a template shipped with Colmena. vite-react copies its
 * dependencies from Colmena's own node_modules: ready to run with no download.
 */
export async function createProject(missionRoot, rawName, template, { colmenaRoot = COLMENA_ROOT, title = "" } = {}) {
  if (!TEMPLATES.includes(template)) throw Error("Plantilla no válida: vite-react, html o vacio.");
  const name = projectName(rawName);
  const dir = await safePath(missionRoot, PROJECTS_DIR + "/" + name, { parent: true });
  if (existsSync(dir)) throw Error("Ya existe el proyecto «" + name + "». Edítalo con project_write o project_edit, o elige otro nombre.");
  await mkdir(dir, { recursive: true });
  const heading = String(title || rawName || name).replace(/[<>&"]/g, "").slice(0, 80);
  if (template !== "vacio") {
    await cp(path.join(TEMPLATE_ROOT, template), dir, { recursive: true, force: false });
    // The page's title is the project's name.
    for (const file of ["index.html", "src/App.jsx"]) {
      const target = path.join(dir, ...file.split("/"));
      if (existsSync(target)) await writeFile(target, (await readFile(target, "utf8")).replaceAll("__TITLE__", heading));
    }
  }
  let copied = [];
  if (template === "vite-react") {
    const version = (p) => "^" + (colmenaVersion(p, colmenaRoot) || "0.0.0");
    const pkg = {
      name, private: true, version: "0.1.0", type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies: Object.fromEntries(VITE_REACT_DEPS.dependencies.map((p) => [p, version(p)])),
      devDependencies: Object.fromEntries(VITE_REACT_DEPS.devDependencies.map((p) => [p, version(p)])),
    };
    await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    copied = dependencyClosure([...VITE_REACT_DEPS.dependencies, ...VITE_REACT_DEPS.devDependencies], colmenaRoot);
    const from = path.join(colmenaRoot, "node_modules");
    for (const p of copied)
      await cp(path.join(from, p), path.join(dir, "node_modules", p), { recursive: true, dereference: true, filter: (src) => !/[\\/]node_modules[\\/]\.bin([\\/]|$)/.test(src.slice(from.length)) });
    await writeBinShims(dir, copied);
  }
  const listing = await listProjectFiles(missionRoot, name);
  return {
    project: name, template, folder: PROJECTS_DIR + "/" + name, files: listing.files,
    ...(template === "vite-react" ? { dependencies: "Listas: " + copied.length + " paquetes copiados de Colmena (Vite " + colmenaVersion("vite", colmenaRoot) + ", React " + colmenaVersion("react", colmenaRoot) + "), sin descargar nada." } : {}),
    next: template === "vacio"
      ? "Escribe los archivos con project_write. Para una web estática basta un index.html; para Node, un package.json."
      : "Edita los archivos con project_edit o project_write y compruébalo con project_preview (arranca el servidor solo).",
  };
}
