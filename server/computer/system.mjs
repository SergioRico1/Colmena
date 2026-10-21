// Files, apps and commands on this computer. No shell anywhere: argv only.
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { fileOpenProblem } from "./policy.mjs";

// ------------------------------------------------------------------ folders
const insideOf = (child, parent) => {
  const a = process.platform === "win32" ? child.toLowerCase() : child;
  const b = process.platform === "win32" ? parent.toLowerCase() : parent;
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
};

/** Resolves `relative` inside `base` refusing absolute paths, '..', ADS and symlinks/junctions. */
export async function resolveInside(base, relative = "") {
  const rel = String(relative || "");
  if (rel.length > 500 || rel.includes("\0") || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw Error("Ruta no permitida.");
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === ".." || p === "." || p.includes(":") || /[<>"|?*\x00-\x1f]/.test(p))) throw Error("Ruta no permitida.");
  let root;
  try { root = await realpath(base); } catch { throw Error("La carpeta ya no existe."); }
  let target = root;
  for (const part of parts) {
    target = path.join(target, part);
    let info;
    try { info = await lstat(target); } catch { throw Error("No existe: " + rel); }
    if (info.isSymbolicLink()) throw Error("No se permiten enlaces simbólicos.");
  }
  const real = await realpath(target);
  if (!insideOf(real, root)) throw Error("Ruta fuera de la carpeta.");
  return real;
}

/**
 * Finds the base folder a computer tool may use.
 * folderId '' | 'mision' | null → the mission folder; otherwise a shared folder given to this bot.
 * need 'escribe' requires write access.
 */
export async function folderBase({ folderId, folders = [], botId, missionRoot, need = "lee" }) {
  if (!folderId || folderId === "mision") {
    if (!missionRoot) throw Error("Esta misión no tiene carpeta.");
    await mkdir(missionRoot, { recursive: true });
    return { base: missionRoot, label: "la carpeta de la misión", folderId: "mision" };
  }
  const folder = folders.find((f) => f.id === folderId);
  if (!folder || !Array.isArray(folder.botIds) || (botId && !folder.botIds.includes(botId)) || typeof folder.path !== "string")
    throw Error("No tienes acceso a esa carpeta.");
  if (need === "escribe" && folder.access !== "escribe") throw Error("En «" + (folder.label || folder.path) + "» solo puedes leer.");
  if ((await lstat(folder.path)).isSymbolicLink()) throw Error("No se permiten enlaces simbólicos.");
  return { base: folder.path, label: "«" + (folder.label || path.basename(folder.path)) + "»", folderId };
}

/** Absolute path of a document that open_file may open, or throws. */
export async function documentPath(ctx, folderId, relative) {
  const problem = fileOpenProblem(relative);
  if (problem) throw Error(problem);
  const { base, label } = await folderBase({ folderId, folders: ctx.folders, botId: ctx.botId, missionRoot: ctx.missionRoot });
  const target = await resolveInside(base, relative);
  if (!(await lstat(target)).isFile()) throw Error("No es un archivo.");
  const again = fileOpenProblem(target);
  if (again) throw Error(again);
  return { path: target, label };
}

// --------------------------------------------------------------------- apps
const env = (name, fallback) => process.env[name] || fallback;
function officeCandidates(exe) {
  const roots = [env("ProgramFiles", "C:\\Program Files"), env("ProgramFiles(x86)", "C:\\Program Files (x86)")];
  const subs = ["Microsoft Office\\root\\Office16", "Microsoft Office\\Office16", "Microsoft Office\\root\\Office15", "Microsoft Office\\Office15"];
  return roots.flatMap((r) => subs.map((s) => path.win32.join(r, s, exe)));
}
const SYSTEM_ROOT = () => env("SystemRoot", "C:\\Windows");

export const DEFAULT_APPS = [
  { id: "excel", label: "Excel", candidates: () => officeCandidates("EXCEL.EXE") },
  { id: "word", label: "Word", candidates: () => officeCandidates("WINWORD.EXE") },
  { id: "powerpoint", label: "PowerPoint", candidates: () => officeCandidates("POWERPNT.EXE") },
  { id: "calculadora", label: "Calculadora", candidates: () => [path.win32.join(SYSTEM_ROOT(), "System32", "calc.exe")] },
  { id: "bloc-de-notas", label: "Bloc de notas", candidates: () => [path.win32.join(SYSTEM_ROOT(), "System32", "notepad.exe"), path.win32.join(SYSTEM_ROOT(), "notepad.exe")] },
  { id: "explorador", label: "Explorador de archivos", candidates: () => [path.win32.join(SYSTEM_ROOT(), "explorer.exe")] },
];

const slug = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Apps the bots may open. settings.allowedApps (edited only by the person):
 * array of default ids ('excel') or {label, path} with an absolute .exe path.
 * Unset → the six defaults.
 */
export function allowedApps(settings = {}, { exists = existsSync } = {}) {
  const list = Array.isArray(settings?.allowedApps) ? settings.allowedApps : DEFAULT_APPS.map((a) => a.id);
  const out = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      const known = DEFAULT_APPS.find((a) => a.id === entry);
      if (!known) continue;
      const found = known.candidates().find((p) => exists(p)) || null;
      out.push({ id: known.id, label: known.label, path: found, installed: !!found });
    } else if (entry && typeof entry === "object" && typeof entry.path === "string" && typeof entry.label === "string") {
      const ok = path.win32.isAbsolute(entry.path) && /\.exe$/i.test(entry.path);
      const id = slug(entry.id || entry.label);
      if (!ok || !id || out.some((a) => a.id === id)) continue;
      out.push({ id, label: entry.label.slice(0, 60), path: entry.path, installed: exists(entry.path) });
    }
  }
  return out;
}

export function resolveApp(appId, settings, options) {
  const app = allowedApps(settings, options).find((a) => a.id === slug(appId) || slug(a.label) === slug(appId));
  if (!app) throw Error("Esa aplicación no está en la lista de apps permitidas (Ajustes › Este ordenador).");
  if (!app.installed || !app.path) throw Error("No encuentro " + app.label + " en este ordenador.");
  return app;
}

// ----------------------------------------------------------------- commands
export const COMMAND_LIMITS = { timeoutMs: 120000, maxBytes: 200 * 1024 };
const ENV_KEEP = ["SystemRoot", "SystemDrive", "windir", "PATH", "Path", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE", "OS", "COMPUTERNAME", "USERNAME", "LANG", "HOME"];

/** Minimal environment: no tokens, keys or Colmena settings leak into child programs. */
export function minimalEnv(source = process.env) {
  const out = {};
  for (const key of ENV_KEEP) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Resolves a program name to an absolute executable (.exe/.com on Windows). Never a shell built-in or script. */
export function resolveProgram(program, { envPath = process.env.PATH || process.env.Path || "", platform = process.platform, exists = existsSync } = {}) {
  const raw = String(program || "").trim();
  if (!raw || raw.length > 260 || /[\0<>|"*?]/.test(raw)) throw Error("Programa no válido.");
  const win = platform === "win32";
  const isFile = (p) => {
    try { return exists(p) && statSync(p).isFile(); } catch { return exists(p); }
  };
  const okExt = (p) => !win || /\.(exe|com)$/i.test(p);
  if (/\.(bat|cmd|ps1|vbs|js|wsf|hta)$/i.test(raw))
    throw Error("Los scripts (.bat, .cmd, .ps1…) necesitan una consola: no se ejecutan.");
  if (path.isAbsolute(raw) || (win && path.win32.isAbsolute(raw))) {
    if (!okExt(raw)) throw Error("Solo se ejecutan programas .exe.");
    if (!isFile(raw)) throw Error("No existe el programa «" + raw + "».");
    return raw;
  }
  if (/[\\/]/.test(raw)) throw Error("Indica el nombre del programa o su ruta completa.");
  if (/^(npm|npx|pnpm|yarn)(\.cmd)?$/i.test(raw))
    throw Error("npm no se ejecuta con run_command: crea un proyecto con project_create y usa project_run (install, script) y project_server.");
  const names = win ? (/\.(exe|com)$/i.test(raw) ? [raw] : [raw + ".exe", raw + ".com"]) : [raw];
  for (const dir of envPath.split(win ? ";" : ":").filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir.replace(/^"|"$/g, ""), name);
      if (okExt(candidate) && isFile(candidate)) return candidate;
    }
  }
  throw Error("No encuentro el programa «" + raw + "». Si es una orden de la consola de Windows (dir, copy, del…), no se puede ejecutar.");
}

/**
 * Runs argv without a shell. cwd must already be validated by the caller.
 * @returns {Promise<{exitCode, stdout, stderr, truncated, timedOut, seconds}>}
 */
/** `onOutput(text)` receives the output as it comes (the chat's live view of a command). */
export function runProgram(file, args, { cwd, timeoutMs = COMMAND_LIMITS.timeoutMs, maxBytes = COMMAND_LIMITS.maxBytes, signal, spawnImpl = spawn, onOutput = null } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let child;
    try {
      child = spawnImpl(file, args, {
        cwd, env: minimalEnv(), shell: false, windowsHide: true, windowsVerbatimArguments: false, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return reject(Error("No se pudo iniciar el programa: " + error.message));
    }
    let used = 0, truncated = false, timedOut = false, finished = false;
    const out = [], err = [];
    const take = (bucket) => {
      const decoder = onOutput ? new StringDecoder("utf8") : null;
      return (chunk) => {
        if (used >= maxBytes) { truncated = true; return; }
        const room = maxBytes - used;
        const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
        if (piece.length < chunk.length) truncated = true;
        used += piece.length;
        bucket.push(piece);
        if (decoder) try { onOutput(decoder.write(piece)); } catch {}
      };
    };
    child.stdout?.on("data", take(out));
    child.stderr?.on("data", take(err));
    const kill = () => { try { child.kill(); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    timer.unref?.();
    const onAbort = () => kill();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(Error("No se pudo ejecutar: " + error.message));
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        truncated,
        timedOut,
        seconds: Math.round((Date.now() - started) / 100) / 10,
      });
    });
  });
}
