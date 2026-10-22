// The preview's port scanner (T3 Code PortScanner: netstat + the process list on Windows,
// lsof + ps on macOS and Linux): which local web servers belong to a task — those started by its engine (descendants of the
// engine process or of its terminals) or whose command line runs inside the task folder.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const run = (file, args, timeout = 8000) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : String(stdout || "")));
});

/** Listening TCP ports on loopback/any → pid (from `netstat -ano -p TCP`). */
export function parseNetstat(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    const host = m[1].replace(/^\[|\]$/g, "");
    if (!["0.0.0.0", "127.0.0.1", "::", "::1"].includes(host)) continue;
    out.push({ port: Number(m[2]), pid: Number(m[3]) });
  }
  return out;
}

/** Listening TCP ports on loopback/any → pid (from `lsof -nP -iTCP -sTCP:LISTEN -F pn`). */
export function parseLsof(text) {
  const out = [];
  let pid = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith("p")) { pid = Number(line.slice(1)) || null; continue; }
    const m = /^n(.*):(\d+)$/.exec(line);
    if (!m || !pid) continue;
    const host = m[1].replace(/^\[|\]$/g, "");
    if (!["*", "localhost", "0.0.0.0", "127.0.0.1", "::", "::1"].includes(host)) continue;
    out.push({ port: Number(m[2]), pid });
  }
  return out;
}

/** `ps -axww -o pid=,ppid=,command=` → Map(pid → {pid, parent, name, command}). */
export function parsePs(text) {
  const processes = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[3].trim();
    processes.set(Number(m[1]), { pid: Number(m[1]), parent: Number(m[2]), name: path.posix.basename(command.split(/\s+/)[0] || ""), command });
  }
  return processes;
}

let cache = { at: 0, value: null };
async function snapshot() {
  if (cache.value && Date.now() - cache.at < 2500) return cache.value;
  if (process.platform !== "win32") {
    const lsof = ["/usr/sbin/lsof", "/usr/bin/lsof"].find((f) => existsSync(f)) || "lsof";
    const [net, procs] = await Promise.all([run(lsof, ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"]), run("/bin/ps", ["-axww", "-o", "pid=,ppid=,command="])]);
    cache = { at: Date.now(), value: { listening: parseLsof(net), processes: parsePs(procs) } };
    return cache.value;
  }
  const system = process.env.SystemRoot || "C:\\Windows";
  const [net, procs] = await Promise.all([
    run(path.join(system, "System32", "NETSTAT.EXE"), ["-ano", "-p", "TCP"]),
    run(path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"], 15000),
  ]);
  let list = [];
  try { list = JSON.parse(procs || "[]"); } catch {}
  if (!Array.isArray(list)) list = [list];
  const processes = new Map(list.filter(Boolean).map((p) => [p.ProcessId, { pid: p.ProcessId, parent: p.ParentProcessId, name: p.Name || "", command: p.CommandLine || "" }]));
  cache = { at: Date.now(), value: { listening: parseNetstat(net), processes } };
  return cache.value;
}

/**
 * Every process now below `rootPids` (the engine's family). Remembered by the task, they
 * still count as its own after their parent exits (a server started with Start-Process).
 */
export async function descendants(rootPids = []) {
  if (!rootPids.length) return [];
  cache.at = 0; // fresh: what was started a moment ago counts
  const { processes } = await snapshot();
  const out = [];
  for (const p of processes.values()) {
    for (let q = processes.get(p.parent), hops = 0; q && hops < 40; q = processes.get(q.parent), hops++) {
      if (rootPids.includes(q.pid)) { out.push({ pid: p.pid, command: p.command }); break; }
    }
  }
  return out;
}

/** Stops remembered processes that are still the same ones (same PID and command line). */
export async function stopFamily(family = []) {
  if (!family.length) return 0;
  cache.at = 0;
  const { processes } = await snapshot();
  const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
  let n = 0;
  for (const { pid, command } of family) {
    if (processes.get(pid)?.command !== command) continue; // gone, or the PID now belongs to another program
    if (process.platform === "win32") await run(taskkill, ["/PID", String(pid), "/T", "/F"]);
    else try { process.kill(pid, "SIGTERM"); } catch { continue; }
    n++;
  }
  return n;
}

/** Ports of a task: [{port, pid, name, url}] (Colmena's own port left out). */
export async function taskPorts({ rootPids = [], folders = [], exclude = [] } = {}) {
  const { listening, processes } = await snapshot();
  const lowered = folders.filter(Boolean).map((f) => path.resolve(f).toLowerCase());
  const belongs = (pid) => {
    for (let p = processes.get(pid), hops = 0; p && hops < 40; p = processes.get(p.parent), hops++) {
      if (rootPids.includes(p.pid)) return true;
      const cmd = p.command.toLowerCase();
      if (lowered.some((f) => cmd.includes(f))) return true;
    }
    return false;
  };
  const seen = new Set();
  const out = [];
  for (const { port, pid } of listening) {
    if (seen.has(port) || exclude.includes(port) || !belongs(pid)) continue;
    seen.add(port);
    out.push({ port, pid, name: processes.get(pid)?.name || "", url: "http://127.0.0.1:" + port + "/" });
  }
  await Promise.all(out.map(async (p) => Object.assign(p, await probePage(p.url))));
  return out.sort((a, b) => a.port - b.port);
}

/**
 * What the page at `url` really is: a web page served as text («text/plain») shows its source
 * code in the preview instead of the page — the app's server must send it as text/html.
 */
export async function probePage(url, timeout = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: "follow" });
    const type = res.headers.get("content-type") || "";
    const reader = res.body?.getReader();
    let head = "";
    while (reader && head.length < 2048) {
      const { value, done } = await reader.read();
      if (done) break;
      head += new TextDecoder().decode(value);
    }
    reader?.cancel().catch(() => {});
    const html = /^﻿?\s*(<!doctype html|<html|<head|<body)/i.test(head);
    return { contentType: type.split(";")[0].trim() || null, source: html && !!type && !/html/i.test(type) };
  } catch {
    return { contentType: null, source: false };
  }
}
