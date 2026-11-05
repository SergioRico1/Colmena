// «Procesos» of a «Código» task (DeepSeek Harness background processes): what runs for it now —
// Bruno's engine, each terminal's shell, whatever they started (also what the engine started and
// left behind, remembered by the task) and local servers whose command line runs inside the task
// folder. Built from ports.mjs' snapshot (netstat + the process list on Windows, lsof + ps
// elsewhere). «Parar» only ever reaches a PID that is in this list right now: never by name.
import { execFile } from "node:child_process";
import path from "node:path";
import { forgetSnapshot, snapshot } from "./ports.mjs";

/** Programs that may mention the task folder but are never the task's own (the person's editor). */
const NEVER = /^(code|code - insiders|cursor|windsurf|explorer|devenv|idea64|webstorm64|sublime_text|notepad\+\+|zed|colmena|electron)(\.exe)?$/i;
const MAX_DEPTH = 40;

const childrenOf = (processes) => {
  const kids = new Map();
  for (const p of processes.values()) {
    if (!kids.has(p.parent)) kids.set(p.parent, []);
    kids.get(p.parent).push(p);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.started || 0) - (b.started || 0) || a.pid - b.pid);
  return kids;
};

/** `self` and every process above it (Colmena's own server, its Electron, the terminal it runs in). */
export function ancestry(processes, self) {
  const out = new Set();
  for (let p = processes.get(self), hops = 0; p && hops < MAX_DEPTH && !out.has(p.pid); p = processes.get(p.parent), hops++) out.add(p.pid);
  if (self) out.add(self);
  return out;
}

/**
 * The task's processes as rows, each tree in order (parent before children, `depth` for the indent):
 * {pid, parent, name, command, kind, label, depth, root, ports, started}.
 * - roots: [{pid, kind: "engine" | "terminal" | "family", label, command?}] — a remembered
 *   «family» process counts only while its PID still runs the same command line (PIDs are reused).
 * - folders: a listening process whose command line (or an ancestor's) is inside one of them is a
 *   «server» of the task, unless it is an editor or Colmena itself.
 * - exclude: {pids, ports} never listed (Colmena's own process tree and port).
 * Pure: `processes` is Map(pid → {pid, parent, name, command, started}), `listening` [{port, pid}].
 */
export function taskProcesses({ processes, listening = [], roots = [], folders = [], exclude = {} }) {
  const skip = new Set(exclude.pids || []);
  const skipPorts = new Set(exclude.ports || []);
  const kids = childrenOf(processes);
  const ports = new Map();
  for (const { port, pid } of listening) {
    if (skipPorts.has(port)) continue;
    if (!ports.has(pid)) ports.set(pid, new Set());
    ports.get(pid).add(port);
  }
  const rows = [];
  const seen = new Set();
  const add = (proc, kind, label) => {
    const walk = (p, depth, root) => {
      if (seen.has(p.pid) || skip.has(p.pid) || depth > MAX_DEPTH) return;
      seen.add(p.pid);
      rows.push({
        pid: p.pid, parent: p.parent, name: p.name || "", command: p.command || "", kind: depth ? "child" : kind, label: depth ? null : label || null,
        depth, root, ports: [...(ports.get(p.pid) || [])].sort((a, b) => a - b), started: p.started || null,
      });
      for (const k of kids.get(p.pid) || []) walk(k, depth + 1, root);
    };
    walk(proc, 0, proc.pid);
  };
  for (const r of roots) {
    const p = processes.get(Number(r.pid));
    if (!p || seen.has(p.pid)) continue;
    if (r.kind === "family" && r.command !== undefined && p.command !== r.command) continue; // gone, the PID is someone else's now
    add(p, r.kind, r.label);
  }
  // Leftover servers: listening, started from the task folder (the topmost such process of the chain).
  const lowered = folders.filter(Boolean).map((f) => path.resolve(f).toLowerCase());
  const inFolder = (p) => !!p?.command && lowered.some((f) => p.command.toLowerCase().includes(f)) && !NEVER.test(p.name || "");
  for (const pid of ports.keys()) {
    if (seen.has(pid) || skip.has(pid)) continue;
    let top = null;
    for (let p = processes.get(pid), hops = 0; p && hops < MAX_DEPTH && !skip.has(p.pid); p = processes.get(p.parent), hops++) {
      if (NEVER.test(p.name || "")) { top = null; break; } // an editor's own helper: not the task's
      if (inFolder(p)) top = p;
    }
    if (top && !seen.has(top.pid)) add(top, "server", null);
  }
  return rows;
}

/** Whether `pid` is one of the task's rows (the only PIDs «Parar» may touch). */
export function ownsPid(rows, pid) {
  return rows.some((r) => r.pid === Number(pid));
}

/**
 * What «Parar todo» stops: what was started (servers, remembered processes and the children of
 * the engine and of the terminals), never the engine nor a terminal's shell. One PID per tree.
 */
export function leftovers(rows) {
  const keep = new Set(rows.filter((r) => r.depth === 0 && (r.kind === "engine" || r.kind === "terminal")).map((r) => r.pid));
  return rows.filter((r) => (r.depth === 0 && !keep.has(r.pid)) || (r.depth === 1 && keep.has(r.parent))).map((r) => r.pid);
}

const run = (file, args) => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: 15000 }, (error) => resolve(!error)));

/** Stops `pid` and everything below it (`rows` gives its children elsewhere than Windows). */
export async function stopTree(pid, rows = [], { platform = process.platform, kill = process.kill.bind(process) } = {}) {
  if (platform === "win32") {
    const ok = await run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"]);
    forgetSnapshot();
    return ok;
  }
  const below = [];
  const collect = (p) => { for (const r of rows) if (r.parent === p && !below.includes(r.pid)) { below.push(r.pid); collect(r.pid); } };
  collect(Number(pid));
  let ok = false;
  for (const p of [...below.reverse(), Number(pid)]) try { kill(p, "SIGTERM"); ok = true; } catch {}
  forgetSnapshot();
  return ok;
}

/** The rows of a task now (a fresh look: what started a moment ago counts). */
export async function listTaskProcesses({ roots, folders, excludePorts = [], fresh = true }) {
  const { processes, listening } = await snapshot({ fresh });
  return taskProcesses({ processes, listening, roots, folders, exclude: { pids: [...ancestry(processes, process.pid)], ports: excludePorts } });
}
