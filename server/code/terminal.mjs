// The «Terminal» of a «Código» task (T3 Code: node-pty, scrollback kept on disk): real shells
// in the task folder, for the person (Bruno uses his engine's own shell). Each terminal keeps
// the last 512 KB of output in memory and, 250 ms after it changes, in
// <data>/code/terminals/<task>/<id>.log, so reopening Colmena shows what was there.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { killTree } from "../projects/run.mjs";

const require = createRequire(import.meta.url);
const MAX_BUFFER = 512 * 1024;
const MAX_TERMINALS = 6;

let pty = null;
function loadPty() {
  pty ||= require("node-pty");
  return pty;
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

/**
 * The project's scripts, for the buttons under the terminal: colmena.json (or T3 Code's
 * t3.json) `{scripts: [{name, command, onCreate | runOnWorktreeCreate}]}` first, then the
 * package.json scripts. The first folder wins (the task's copy, then the project folder).
 * @returns {{name:string, command:string, onCreate:boolean, source:string}[]}
 */
export function projectScripts(...folders) {
  const out = new Map();
  for (const folder of folders.flat().filter(Boolean)) {
    for (const file of ["colmena.json", "t3.json"]) {
      const list = readJson(path.join(folder, file))?.scripts;
      for (const s of Array.isArray(list) ? list : []) {
        const name = String(s?.name || "").trim().slice(0, 60);
        const command = String(s?.command || "").trim().slice(0, 1000);
        if (!name || !command || out.has(name)) continue;
        out.set(name, { name, command, onCreate: !!(s.onCreate || s.runOnWorktreeCreate), source: file });
      }
    }
    const pkg = readJson(path.join(folder, "package.json"));
    for (const name of Object.keys(pkg?.scripts || {})) if (!out.has(name)) out.set(name, { name, command: "npm run " + name, onCreate: false, source: "package.json" });
  }
  return [...out.values()].slice(0, 16);
}

/** Adds (or replaces) a script in the project's colmena.json. */
export async function saveScript(folder, { name, command, onCreate = false }) {
  const file = path.join(folder, "colmena.json");
  const data = readJson(file) || {};
  const scripts = (Array.isArray(data.scripts) ? data.scripts : []).filter((s) => s?.name !== name);
  scripts.push({ name, command, ...(onCreate ? { onCreate: true } : {}) });
  await writeFile(file, JSON.stringify({ ...data, scripts }, null, 2) + "\n", "utf8");
  return scripts;
}

/** Keeps the tail of a terminal's output, never cutting an escape sequence in half. */
export function trimBuffer(text, max = MAX_BUFFER) {
  if (text.length <= max) return text;
  let cut = text.length - max;
  const nl = text.indexOf("\n", cut);
  if (nl >= 0 && nl - cut < 4096) cut = nl + 1;
  return text.slice(cut);
}

export class Terminals {
  constructor({ directory, spawn = null }) {
    this.directory = path.join(directory, "code", "terminals");
    this.spawnImpl = spawn; // tests: a fake pty
    this.sessions = new Map(); // `${task}:${id}` → session
  }

  key(taskId, id) { return taskId + ":" + id; }
  logFile(taskId, id) { return path.join(this.directory, taskId, id + ".log"); }

  /** Live terminals and closed ones that still have their scrollback. */
  async list(taskId) {
    const live = [...this.sessions.values()].filter((s) => s.taskId === taskId).map((s) => this.view(s));
    let saved = [];
    try { saved = (await readdir(path.join(this.directory, taskId))).filter((f) => f.endsWith(".log")).map((f) => f.slice(0, -4)); } catch {}
    for (const id of saved) {
      if (live.some((t) => t.id === id)) continue;
      let meta = {};
      try { meta = JSON.parse(readFileSync(this.logFile(taskId, id).replace(/\.log$/, ".json"), "utf8")); } catch {}
      live.push({ id, title: meta.title || "Terminal", running: false, command: meta.command || null });
    }
    return live;
  }

  view(s) { return { id: s.id, title: s.title, running: !s.exited, command: s.command, pid: s.pid }; }

  /** Opens a shell in `cwd` (and types `command` in it), or brings a saved one back to life. */
  async open(taskId, { cwd, id = null, command = null, title = null, cols = 100, rows = 30 }) {
    if (id && this.sessions.get(this.key(taskId, id))?.exited === false) return this.view(this.sessions.get(this.key(taskId, id)));
    if (!id && [...this.sessions.values()].filter((s) => s.taskId === taskId && !s.exited).length >= MAX_TERMINALS)
      throw Object.assign(Error("Ya hay " + MAX_TERMINALS + " terminales abiertas en esta tarea: cierra alguna."), { status: 409 });
    id ||= "t" + randomUUID().slice(0, 6);
    let buffer = "";
    try { buffer = readFileSync(this.logFile(taskId, id), "utf8"); } catch {}
    if (buffer) buffer = trimBuffer(buffer + "\r\n\x1b[2m— sesión anterior —\x1b[0m\r\n");
    const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
    const args = process.platform === "win32" ? ["-NoLogo"] : [];
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
    for (const k of Object.keys(env)) if (/^COLMENA_/.test(k)) delete env[k];
    const proc = (this.spawnImpl || ((...a) => loadPty().spawn(...a)))(shell, args, { name: "xterm-256color", cols, rows, cwd, env });
    if (!title) try { title = JSON.parse(readFileSync(this.logFile(taskId, id).replace(/\.log$/, ".json"), "utf8")).title; } catch {}
    const s = { taskId, id, title: title || (command ? command : "Terminal"), command, cwd, proc, pid: proc.pid, buffer, listeners: new Set(), exited: false, saveTimer: null };
    this.sessions.set(this.key(taskId, id), s);
    // Its name survives a restart next to its scrollback.
    const meta = this.logFile(taskId, id).replace(/\.log$/, ".json");
    mkdir(path.dirname(meta), { recursive: true }).then(() => writeFile(meta, JSON.stringify({ title: s.title, command }), "utf8")).catch(() => {});
    proc.onData((data) => {
      s.buffer = trimBuffer(s.buffer + data);
      for (const fn of s.listeners) fn({ type: "data", data });
      this.saveSoon(s);
    });
    proc.onExit(({ exitCode }) => {
      s.exited = true;
      for (const fn of s.listeners) fn({ type: "exit", code: exitCode });
      this.saveSoon(s);
    });
    if (command) setTimeout(() => { try { proc.write(command + "\r"); } catch {} }, 300);
    return this.view(s);
  }

  saveSoon(s) {
    clearTimeout(s.saveTimer);
    if (s.closed) return; // closed on purpose: its scrollback is gone with it
    s.saveTimer = setTimeout(() => {
      const file = this.logFile(s.taskId, s.id);
      mkdir(path.dirname(file), { recursive: true }).then(() => writeFile(file, s.buffer, "utf8")).catch(() => {});
    }, 250);
    s.saveTimer.unref?.();
  }

  /** Follows a terminal: first everything it has, then what comes. Returns the unsubscribe. */
  attach(taskId, id, fn) {
    const s = this.sessions.get(this.key(taskId, id));
    if (!s) {
      let saved = "";
      try { saved = readFileSync(this.logFile(taskId, id), "utf8"); } catch {}
      fn({ type: "replay", data: saved });
      fn({ type: "exit", code: null });
      return () => {};
    }
    fn({ type: "replay", data: s.buffer });
    if (s.exited) fn({ type: "exit", code: null });
    s.listeners.add(fn);
    return () => s.listeners.delete(fn);
  }

  write(taskId, id, data) {
    const s = this.sessions.get(this.key(taskId, id));
    if (!s || s.exited) throw Object.assign(Error("Esa terminal ya no está abierta."), { status: 409 });
    s.proc.write(String(data));
  }

  resize(taskId, id, cols, rows) {
    const s = this.sessions.get(this.key(taskId, id));
    if (s && !s.exited) try { s.proc.resize(Math.max(20, Math.min(400, cols)), Math.max(5, Math.min(200, rows))); } catch {}
  }

  /** Closes a terminal and forgets its scrollback. */
  async close(taskId, id) {
    const s = this.sessions.get(this.key(taskId, id));
    if (s) {
      this.sessions.delete(this.key(taskId, id));
      clearTimeout(s.saveTimer);
      this.kill(s);
    }
    await rm(this.logFile(taskId, id), { force: true }).catch(() => {});
    await rm(this.logFile(taskId, id).replace(/\.log$/, ".json"), { force: true }).catch(() => {});
    return { ok: true };
  }

  /** The shell and whatever it started (a dev server outlives a plain kill on Windows). */
  kill(s, { forget = true } = {}) {
    s.closed = forget;
    if (!this.spawnImpl && s.pid && !s.exited) killTree({ pid: s.pid, exitCode: null });
    try { s.proc.kill(); } catch {}
  }

  /** PIDs of the task's live shells (their servers count as the task's for the preview). */
  pids(taskId) {
    return [...this.sessions.values()].filter((s) => s.taskId === taskId && !s.exited).map((s) => s.pid).filter(Boolean);
  }

  async closeTask(taskId, { forget = true } = {}) {
    for (const s of [...this.sessions.values()].filter((x) => x.taskId === taskId)) {
      this.sessions.delete(this.key(taskId, s.id));
      clearTimeout(s.saveTimer);
      this.kill(s, { forget });
    }
    if (forget) await rm(path.join(this.directory, taskId), { recursive: true, force: true }).catch(() => {});
  }

  shutdown() {
    for (const s of this.sessions.values()) {
      clearTimeout(s.saveTimer);
      try { if (existsSync(path.dirname(this.logFile(s.taskId, s.id)))) require("node:fs").writeFileSync(this.logFile(s.taskId, s.id), s.buffer, "utf8"); } catch {}
      this.kill(s, { forget: false });
    }
    this.sessions.clear();
  }
}
