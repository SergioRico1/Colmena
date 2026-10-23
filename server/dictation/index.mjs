// Dictation with the speech recognizer of the computer itself, no key and (when the system can)
// no network: a small helper program per system that listens to the microphone and writes what
// it hears as JSON lines (see windows/ColmenaDictation.cs and macos/ColmenaDictation.swift).
//
//  · Windows: the offline desktop recognizer (System.Speech), compiled once on this computer
//    with the csc.exe of .NET Framework 4, which every Windows 10/11 has, into the data folder.
//  · macOS: Apple's Speech framework, a universal binary built by macos/build.sh (CI) and
//    packaged with the app; on-device recognition whenever the Mac has the language.
//
// A session is one dictation: start → {ready, level, partial, final…, end}; stop() lets the
// last phrase finish, cancel() drops it.
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WINDOWS_SOURCE = path.join(HERE, "windows", "ColmenaDictation.cs");
export const MAC_BINARY = path.join(HERE, "bin", "colmena-dictation");
export const LANG = "es-ES";
export const MAX_MS = 120000;

const fail = (code, message) => Object.assign(Error(message), { code });

/** The .NET Framework 4 folder with csc.exe and System.Speech.dll, or null. */
export function frameworkDir(env = process.env, exists = fs.existsSync) {
  const windows = env.WINDIR || env.SystemRoot || "C:\\Windows";
  for (const bits of ["Framework64", "Framework"]) {
    const dir = path.win32.join(windows, "Microsoft.NET", bits, "v4.0.30319");
    if (exists(path.win32.join(dir, "csc.exe")) && exists(path.win32.join(dir, "WPF", "System.Speech.dll"))) return dir;
  }
  return null;
}

const compiling = new Map();
/** Path of the compiled Windows helper (compiles it the first time, ~1 s). */
export async function windowsHelper({ cacheDir, env = process.env, run = execFile } = {}) {
  const source = await fs.promises.readFile(WINDOWS_SOURCE);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const exe = path.join(cacheDir, `colmena-dictation-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  if (compiling.has(exe)) return compiling.get(exe);
  const job = (async () => {
    const dir = frameworkDir(env);
    if (!dir) throw fail("no-compiler", "This Windows has no .NET Framework 4 compiler.");
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const tmp = path.join(cacheDir, `colmena-dictation-${hash}-${process.pid}.exe`);
    await new Promise((resolve, reject) => {
      run(path.win32.join(dir, "csc.exe"), ["/nologo", "/optimize+", "/target:exe", "/out:" + tmp, "/r:" + path.win32.join(dir, "WPF", "System.Speech.dll"), WINDOWS_SOURCE], { windowsHide: true, timeout: 60000 }, (error, stdout) => {
        error ? reject(fail("no-compiler", "The dictation helper did not compile: " + String(stdout || error.message).slice(0, 400))) : resolve();
      });
    });
    await fs.promises.rename(tmp, exe).catch(async (e) => { if (!fs.existsSync(exe)) throw e; await fs.promises.rm(tmp, { force: true }); });
    // Older builds of the helper are of no use any more.
    for (const name of await fs.promises.readdir(cacheDir).catch(() => [])) {
      if (/^colmena-dictation-[0-9a-f]{12}(-\d+)?\.exe$/.test(name) && name !== path.basename(exe)) await fs.promises.rm(path.join(cacheDir, name), { force: true }).catch(() => {});
    }
    return exe;
  })().finally(() => compiling.delete(exe));
  compiling.set(exe, job);
  return job;
}

/** {command} of this system's helper. Throws {code:"unsupported"|"no-compiler"|"missing"}. */
export async function resolveHelper({ platform = process.platform, cacheDir, env = process.env } = {}) {
  if (platform === "win32") return { command: await windowsHelper({ cacheDir, env }) };
  if (platform === "darwin") {
    if (!fs.existsSync(MAC_BINARY)) throw fail("missing", "The macOS dictation helper is not built (server/dictation/macos/build.sh).");
    return { command: MAC_BINARY };
  }
  throw fail("unsupported", "No system dictation on " + platform + ".");
}

/** Runs `command args` and returns its JSON lines. */
export function runOnce(command, args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout, encoding: "utf8", maxBuffer: 1 << 20 }, (error, stdout) => {
      const events = parseLines(stdout);
      if (error && !events.length) reject(fail("failed", error.message));
      else resolve(events);
    });
  });
}

export function parseLines(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event.type === "string") out.push(event);
    } catch {}
  }
  return out;
}

/** What this computer can do: {available, engine, lang, onDevice, code, installed, microphoneBlocked}. */
export async function probe({ platform = process.platform, cacheDir, env = process.env, launchOnce = runOnce, resolve = resolveHelper } = {}) {
  const engine = platform === "win32" ? "sapi" : platform === "darwin" ? "apple" : null;
  let helper;
  try {
    helper = await resolve({ platform, cacheDir, env });
  } catch (e) {
    return { available: false, engine, code: e.code || "failed" };
  }
  let events;
  try {
    events = await launchOnce(helper.command, ["--probe", "--lang", LANG]);
  } catch {
    return { available: false, engine, code: "failed" };
  }
  const p = events.find((e) => e.type === "probe");
  if (!p) return { available: false, engine, code: "failed" };
  const installed = String(p.installed || "").split(",").map((s) => s.trim().replace("_", "-")).filter(Boolean);
  const lang = installed.find((l) => l.toLowerCase() === LANG.toLowerCase()) || installed.find((l) => /^es([-_]|$)/i.test(l)) || null;
  if (!lang) return { available: false, engine, code: "no-language", installed };
  // macOS: 1 and 2 are «denied» and «restricted» in both SFSpeechRecognizerAuthorizationStatus
  // and AVAuthorizationStatus (0 = not asked yet: the helper asks when you first dictate).
  if (platform === "darwin" && (p.speech === 1 || p.speech === 2)) return { available: false, engine, code: "denied-speech", lang, installed };
  if (platform === "darwin" && (p.microphone === 1 || p.microphone === 2)) return { available: false, engine, code: "denied-microphone", lang, installed };
  return { available: true, engine, lang, installed, onDevice: platform === "darwin" ? !!p.onDevice : true, microphoneBlocked: !!p.microphoneBlocked, ...(platform === "darwin" && p.available === false ? { offline: true } : {}) };
}

const spawnHelper = (command, args) => spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });

/** One dictation. Events go to listeners and stay in `events` for a late subscriber. */
export class DictationSession extends EventEmitter {
  constructor({ command, args = [], launch = spawnHelper, maxMs = MAX_MS, id = randomUUID() }) {
    super();
    this.id = id;
    this.events = [];
    this.done = false;
    this.startedAt = Date.now();
    const child = launch(command, ["--lang", LANG, "--max-ms", String(maxMs), ...args]);
    this.child = child;
    let buffer = "";
    child.stdout.setEncoding?.("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        for (const event of parseLines(line)) this.push(event);
      }
    });
    child.on("error", () => this.push({ type: "error", code: "failed", message: "The dictation helper did not start." }));
    child.on("exit", (code) => {
      for (const event of parseLines(buffer)) this.push(event);
      buffer = "";
      if (!this.done) {
        if (code) this.push({ type: "error", code: "failed", message: "The dictation helper stopped (" + code + ")." });
        this.push({ type: "end" });
      }
    });
    child.stdin?.on?.("error", () => {});
    // Never longer than the limit: the helper stops itself, this is the safety net.
    this.limit = setTimeout(() => this.stop(), maxMs + 4000);
    this.limit.unref?.();
  }

  push(event) {
    if (this.done) return;
    if (event.type === "end") {
      this.done = true;
      clearTimeout(this.limit);
      clearTimeout(this.killer);
    }
    if (event.type !== "level") this.events.push(event);
    this.emit("event", event);
  }

  send(line) {
    try { this.child.stdin?.write(line + "\n"); } catch {}
  }

  /** Lets the last phrase finish, then ends (forced after 6 s). */
  stop() {
    if (this.done || this.stopping) return;
    this.stopping = true;
    this.send("stop");
    this.killer = setTimeout(() => { try { this.child.kill(); } catch {} }, 6000);
    this.killer.unref?.();
  }

  cancel() {
    if (this.done) return;
    this.cancelled = true;
    this.send("cancel");
    this.killer = setTimeout(() => { try { this.child.kill(); } catch {} }, 1000);
    this.killer.unref?.();
  }
}
