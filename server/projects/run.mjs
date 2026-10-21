// npm and node for projects, without a console: node.exe runs npm-cli.js directly (npm.cmd
// would need cmd.exe), so a bot never gets a shell. Installs are the only calls that may use
// the network; everything else runs with npm offline and a dead proxy (best effort: the
// project's own code runs with the person's permissions, Windows cannot box it without admin).
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { minimalEnv } from "../computer/system.mjs";

export const RUN_LIMITS = { timeoutMs: 120000, longTimeoutMs: 600000, maxBytes: 200 * 1024 };
const DEAD_PROXY = "http://127.0.0.1:9";

/** Absolute node.exe: the one running Colmena's server (Node 24) or, in the installed app
 * (its server runs on Electron's Node), the Node.js of this computer found in PATH. */
export function nodeExecutable({ execPath = process.execPath, envPath = process.env.PATH || process.env.Path || "", exists = existsSync, platform = process.platform } = {}) {
  if (/(^|[\\/])node(\.exe)?$/i.test(execPath)) return execPath;
  const name = platform === "win32" ? "node.exe" : "node";
  const found = envPath.split(path.delimiter).filter(Boolean).map((dir) => path.join(dir.replace(/^"|"$/g, ""), name)).find((p) => exists(p));
  if (found) return found;
  throw Error("No encuentro Node.js para ejecutar el proyecto.");
}

/** npm-cli.js next to node.exe (or in a folder of PATH that has npm). */
export function npmCli({ execPath = process.execPath, envPath = process.env.PATH || process.env.Path || "", exists = existsSync, override = process.env.COLMENA_NPM_CLI } = {}) {
  const candidates = [
    override,
    path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    ...envPath.split(path.delimiter).filter(Boolean).map((dir) => path.join(dir.replace(/^"|"$/g, ""), "node_modules", "npm", "bin", "npm-cli.js")),
  ].filter(Boolean);
  const found = candidates.find((p) => exists(p));
  if (!found) throw Error("No encuentro npm en este ordenador (va con Node.js).");
  return found;
}

/** Child environment: no Colmena secrets; offline unless it is an approved install. */
export function projectEnv({ install = false, port = null, source = process.env } = {}) {
  const env = {
    ...minimalEnv(source),
    ComSpec: source.ComSpec || path.win32.join(source.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
    npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false",
    NO_UPDATE_NOTIFIER: "1", BROWSER: "none", FORCE_COLOR: "0", NO_COLOR: "1",
  };
  if (!install) {
    Object.assign(env, {
      npm_config_offline: "true",
      HTTP_PROXY: DEAD_PROXY, HTTPS_PROXY: DEAD_PROXY, http_proxy: DEAD_PROXY, https_proxy: DEAD_PROXY,
      NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", NODE_USE_ENV_PROXY: "1",
    });
  }
  if (port) Object.assign(env, { PORT: String(port), HOST: "127.0.0.1" });
  return env;
}

/** Ends a process and its children (npm run → cmd → node). Only the PID Colmena started. */
export function killTree(child, { spawnImpl = spawn, platform = process.platform } = {}) {
  if (!child?.pid || child.exitCode != null) return;
  if (platform === "win32") {
    try {
      const taskkill = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
      spawnImpl(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false }).on?.("error", () => {});
      return;
    } catch {}
  }
  try { child.kill("SIGTERM"); } catch {}
}

/**
 * Runs argv (no shell) in `cwd`. Output is kept to maxBytes (the end matters most for errors).
 * @returns {Promise<{exitCode, stdout, stderr, truncated, timedOut, seconds}>}
 */
export function runArgv(file, args, { cwd, env, timeoutMs = RUN_LIMITS.timeoutMs, maxBytes = RUN_LIMITS.maxBytes, signal, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let child;
    try {
      child = spawnImpl(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      return reject(Error("No se pudo iniciar: " + error.message));
    }
    const out = [], err = [];
    let used = 0, truncated = false, timedOut = false, done = false;
    const take = (bucket) => (chunk) => {
      bucket.push(chunk);
      used += chunk.length;
      // Keep the end: drop the oldest chunks once over the limit.
      while (used > maxBytes && bucket.length > 1) { used -= bucket.shift().length; truncated = true; }
    };
    child.stdout?.on("data", take(out));
    child.stderr?.on("data", take(err));
    const stop = () => killTree(child, { spawnImpl });
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    timer.unref?.();
    const onAbort = () => stop();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      fn();
    };
    child.on("error", (error) => finish(() => reject(Error("No se pudo ejecutar: " + error.message))));
    child.on("close", (code) => finish(() => resolve({
      exitCode: code,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
      truncated, timedOut,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    })));
  });
}

// ------------------------------------------------------------- package.json
const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
// Registry versions only: a range («^6.4.0», «~1.2», «>=2 <3», «1.x»), a tag or «*».
const SPEC = /^(latest|next|\*|[\^~]?(\d+|x|\*)(\.(\d+|x|\*)){0,2}([-+][\w.-]+)?|([<>]=?|=)?\s*\d[\w.\-+]*(\s+([<>]=?|=)?\s*\d[\w.\-+]*)*(\s*\|\|\s*[\^~<>=\d][\w.\-+ <>=^~]*)*)$/;

export async function readPackage(root) {
  try { return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw Error("package.json no es un JSON válido: " + error.message);
  }
}

/**
 * Dependencies to install: [{name, spec}]. Only registry packages: «file:», git, URLs,
 * aliases and links are refused (they would bring code from anywhere).
 */
export function packageDependencies(pkg) {
  const out = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, raw] of Object.entries(pkg?.[field] || {})) {
      const spec = String(raw).trim();
      if (!NAME.test(name)) throw Error("Nombre de paquete no válido: «" + name + "».");
      if (!SPEC.test(spec)) throw Error("«" + name + "»: solo se instalan versiones del registro de npm («^1.2.3», «latest»), no «" + spec + "».");
      if (!out.some((d) => d.name === name)) out.push({ name, spec });
    }
  }
  return out;
}

const SHELL_CHARS = /[&|<>^%"'`;()$!\r\n]/;

/** Splits a package.json script without a shell, or null when it needs one («a && b», quotes…). */
export function simpleScript(command) {
  const line = String(command || "").trim();
  if (!line || SHELL_CHARS.test(line)) return null;
  return line.split(/\s+/);
}

/** Absolute script of a local bin («vite» → node_modules/vite/bin/vite.js), or null. */
export async function localBin(root, command) {
  if (!/^[\w.-]+$/.test(command)) return null;
  const modules = path.join(root, "node_modules");
  const owner = command.startsWith("@") ? null : command;
  const candidates = owner && existsSync(path.join(modules, owner, "package.json")) ? [owner] : [];
  // Bins named differently from their package («tsc» in typescript): read the shims' targets.
  const shim = path.join(modules, ".bin", command + ".cmd");
  if (existsSync(shim)) {
    // Ours: node "%~dp0\..\vite\bin\vite.js" %* · npm's cmd-shim: "%dp0%\..\vite\bin\vite.js" %*
    const rel = /"%(?:~dp0|dp0%)\\([^"]+\.(?:c|m)?js)"/i.exec(await readFile(shim, "utf8"))?.[1];
    if (rel) {
      const file = path.resolve(modules, ".bin", rel.replace(/\\/g, path.sep));
      if (file.startsWith(modules) && /\.(c|m)?js$/i.test(file) && existsSync(file)) return file;
    }
  }
  for (const name of candidates) {
    try {
      const pkg = JSON.parse(await readFile(path.join(modules, name, "package.json"), "utf8"));
      const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[command];
      if (bin) {
        const file = path.resolve(modules, name, bin);
        if (file.startsWith(path.join(modules, name)) && existsSync(file)) return file;
      }
    } catch {}
  }
  return null;
}

/**
 * How to run a package.json script: {file, args, direct, line} — directly with node when it
 * is a local tool («vite build»), through npm run otherwise.
 */
export async function scriptCommand(root, pkg, script, extra = [], { node = nodeExecutable(), npm = () => npmCli() } = {}) {
  const command = pkg?.scripts?.[script];
  if (typeof command !== "string") {
    const names = Object.keys(pkg?.scripts || {});
    throw Error("El package.json no tiene el script «" + script + "»" + (names.length ? " (hay: " + names.join(", ") + ")." : "."));
  }
  const words = simpleScript(command);
  const bin = words ? await localBin(root, words[0]) : null;
  if (bin) return { file: node, args: [bin, ...words.slice(1), ...extra], direct: true, line: [...words, ...extra].join(" ") };
  return { file: node, args: [npm(), "run", script, ...(extra.length ? ["--", ...extra] : [])], direct: false, line: "npm run " + script + (extra.length ? " -- " + extra.join(" ") : "") };
}

export function installCommand({ node = nodeExecutable(), npm = npmCli() } = {}) {
  return { file: node, args: [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", "--loglevel=error"], line: "npm install --ignore-scripts" };
}
