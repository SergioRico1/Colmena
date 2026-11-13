// Finding and running the password managers' own command-line programs: 1Password's `op` and
// Bitwarden's `bw` (docs/COMPUTER.md › «Gestores de contraseñas»).
// - Spawned WITHOUT a shell, with argv and a minimal environment, 30 s at most.
// - What they print is returned as Buffers so the caller can wipe them after reading
//   (`wipe`). Nothing here logs, and errors never carry what the program printed on stdout.
// - A path that ends in .js/.mjs/.cjs runs with this Node (Bitwarden installed with npm, and
//   the fake programs of the tests: tests/fixtures/fake-op.mjs, fake-bw.mjs).
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const WIN = process.platform === "win32";
const LIMIT = 8 * 1024 * 1024;
const TIMEOUT_MS = 30000;

/** Where each manager usually installs its program, after PATH. */
function commonPaths(kind, env = process.env) {
  const local = env.LOCALAPPDATA || "", appdata = env.APPDATA || "", home = env.USERPROFILE || env.HOME || "";
  const programFiles = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
  if (WIN) {
    const winget = local ? path.join(local, "Microsoft", "WinGet", "Links", kind + ".exe") : null;
    const packages = (() => {
      // winget without links: %LOCALAPPDATA%\Microsoft\WinGet\Packages\AgileBits.1Password.CLI_…\op.exe
      const dir = local ? path.join(local, "Microsoft", "WinGet", "Packages") : null;
      const prefix = kind === "op" ? "AgileBits.1Password.CLI" : "Bitwarden.CLI";
      try { return dir ? readdirSync(dir).filter((d) => d.startsWith(prefix)).map((d) => path.join(dir, d, kind + ".exe")) : []; } catch { return []; }
    })();
    if (kind === "op")
      return [winget, ...packages, ...programFiles.map((p) => path.join(p, "1Password CLI", "op.exe")), local && path.join(local, "1Password", "app", "8", "op.exe")].filter(Boolean);
    return [
      winget, ...packages,
      home && path.join(home, "scoop", "shims", "bw.exe"),
      env.ChocolateyInstall ? path.join(env.ChocolateyInstall, "bin", "bw.exe") : "C:\\ProgramData\\chocolatey\\bin\\bw.exe",
      // npm install -g @bitwarden/cli: bw.cmd cannot run without a shell, its script can.
      appdata && path.join(appdata, "npm", "node_modules", "@bitwarden", "cli", "build", "bw.js"),
    ].filter(Boolean);
  }
  return ["/opt/homebrew/bin/" + kind, "/usr/local/bin/" + kind, home && path.join(home, ".local", "bin", kind), "/snap/bin/" + kind].filter(Boolean);
}

/**
 * The program of a manager: COLMENA_OP_PATH / COLMENA_BW_PATH (tests and QA point them at the
 * fakes), then PATH, then the usual install places. Null when it is not installed.
 */
export function findCli(kind, { env = process.env, override } = {}) {
  const forced = override ?? env[kind === "op" ? "COLMENA_OP_PATH" : "COLMENA_BW_PATH"];
  if (forced) return existsSync(forced) ? forced : null;
  const names = WIN ? [kind + ".exe"] : [kind];
  for (const dir of String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean))
    for (const name of names) {
      const full = path.join(dir, name);
      if (existsSync(full)) return full;
    }
  return commonPaths(kind, env).find((p) => existsSync(p)) || null;
}

/** The environment a manager's program gets: what it needs to find its app and its data, nothing of Colmena's. */
export function cliEnv(extra = {}, env = process.env) {
  const keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
    "ProgramData", "ProgramFiles", "HOMEDRIVE", "HOMEPATH", "USERNAME", "USER", "LANG", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "OP_ACCOUNT",
    "OP_BIOMETRIC_UNLOCK_ENABLED", "BITWARDENCLI_APPDATA_DIR", "NODE_EXTRA_CA_CERTS", "OP_FAKE_STATE", "BW_FAKE_STATE"];
  const out = {};
  for (const k of keep) if (env[k] !== undefined) out[k] = env[k];
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/** Zeroes Buffers that held what a manager printed. */
export function wipe(...buffers) {
  for (const b of buffers) if (Buffer.isBuffer(b)) b.fill(0);
}

/**
 * Runs `file args…` and resolves {code, stdout: Buffer, stderr: string}. Never rejects with
 * what the program printed on stdout; stderr is cut to 300 characters (it only explains errors).
 */
export function runCli(file, args, { env = {}, timeout = TIMEOUT_MS, signal } = {}) {
  const script = /\.(m|c)?js$/i.test(file);
  const command = script ? process.execPath : file;
  const argv = script ? [file, ...args] : args;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, argv, { env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal });
    } catch {
      reject(Error("No se pudo abrir el programa del gestor de contraseñas."));
      return;
    }
    const out = [], err = [];
    let size = 0;
    child.stdout.on("data", (d) => {
      size += d.length;
      if (size > LIMIT) { wipe(d); child.kill(); return; }
      out.push(d);
    });
    child.stderr.on("data", (d) => { if (err.length < 64) err.push(d); });
    const timer = setTimeout(() => child.kill(), timeout);
    timer.unref?.();
    child.on("error", () => {
      clearTimeout(timer);
      wipe(...out);
      reject(Error("No se pudo abrir el programa del gestor de contraseñas."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      wipe(...out);
      resolve({ code: code ?? -1, stdout, stderr: Buffer.concat(err).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 300) });
    });
  });
}
