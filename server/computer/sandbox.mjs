// Process sandbox for the commands bots run (run_command, project scripts): the program may
// read the computer but writes only inside its work folder and a private temp folder.
// Backends:
//   - Windows: the Codex CLI of this computer (`codex sandbox -P :workspace`, a restricted
//     token; its own CODEX_HOME under Colmena's data folder, «unelevated», never the person's
//     Codex config). It confines writes, not the network. It grants the work folder to the
//     sandbox with an ACE, so on Windows only folders inside Colmena's data folder are confined
//     (never a shared folder of the person).
//   - macOS: sandbox-exec with a generated Seatbelt profile (also without network).
//   - Linux: bubblewrap (bwrap) when it is installed (also without network).
// Detection only looks for files (cached); a runner that fails at start marks the backend
// broken for a while so the next commands fail closed instead of retrying it each time.
import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";

export const SANDBOX_MODES = ["aislado", "amplio"];
const BROKEN_MS = 10 * 60 * 1000;
const WIN_TRIPLES = { x64: ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc"], arm64: ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"] };

const onPath = (name, { envPath = process.env.PATH || "", exists = existsSync, platform = process.platform } = {}) => {
  for (const dir of envPath.split(platform === "win32" ? ";" : ":").filter(Boolean)) {
    const candidate = path.join(dir.replace(/^"|"$/g, ""), name);
    if (exists(candidate)) return candidate;
  }
  return null;
};

/** The native codex.exe of the npm install (never through cmd or a .ps1 shim), or null. */
export function findCodexBinary({ env = process.env, exists = existsSync, arch = process.arch } = {}) {
  if (env.COLMENA_SANDBOX_CODEX) return exists(env.COLMENA_SANDBOX_CODEX) ? env.COLMENA_SANDBOX_CODEX : null;
  const appdata = env.APPDATA || path.join(env.USERPROFILE || os.homedir(), "AppData", "Roaming");
  const root = path.join(appdata, "npm", "node_modules", "@openai", "codex");
  const [pkg, triple] = WIN_TRIPLES[arch] || WIN_TRIPLES.x64;
  const candidates = [
    path.join(root, "node_modules", ...pkg.split("/"), "vendor", triple, "bin", "codex.exe"),
    path.join(root, "vendor", triple, "bin", "codex.exe"),
  ];
  return candidates.find((p) => exists(p)) || null;
}

/** {kind:'codex'|'seatbelt'|'bwrap', command} or null. Only checks that files exist. */
export function detectBackend({ platform = process.platform, env = process.env, exists = existsSync, arch = process.arch } = {}) {
  if (env.COLMENA_SANDBOX === "off") return null;
  if (platform === "win32") {
    const exe = findCodexBinary({ env, exists, arch });
    return exe ? { kind: "codex", command: exe } : null;
  }
  if (platform === "darwin") return exists("/usr/bin/sandbox-exec") ? { kind: "seatbelt", command: "/usr/bin/sandbox-exec" } : null;
  if (platform === "linux") {
    const bwrap = onPath("bwrap", { envPath: env.PATH || "", exists, platform });
    return bwrap ? { kind: "bwrap", command: bwrap } : null;
  }
  return null;
}

const sbString = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

/** Seatbelt profile: read everything, write only the given roots, no network (unless asked). */
export function seatbeltProfile({ writable = [], network = false } = {}) {
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow file-read*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow ipc-posix-sem)",
    "(allow iokit-open)",
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))',
    ...(writable.length ? ["(allow file-write* " + writable.map((w) => "(subpath " + sbString(w) + ")").join(" ") + ")"] : []),
    network ? "(allow network*)" : '(allow network* (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
  ].join("\n");
}

const insideOf = (child, parent, platform = process.platform) => {
  const norm = (p) => { const r = path.resolve(p); return platform === "win32" ? r.toLowerCase() : r; };
  const a = norm(child), b = norm(parent);
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
};

// What a sandboxed program prints when the sandbox, not the program, said no.
const BLOCKED = /(access is denied|acceso denegado|\bEPERM\b|\bEACCES\b|operation not permitted|permission denied|permissionerror|unauthorizedaccess|read-only file system|sistema de archivos de solo lectura|\bENETUNREACH\b|network is unreachable|\bEAI_AGAIN\b|getaddrinfo|sandbox(?:-exec)?: .*deny)/i;
// What the runner prints when it could not start the program at all.
const RUNNER = /(^error: (the following required arguments|unexpected argument|invalid value)|^Error: (default_permissions|windows sandbox|sandbox setup)|windows sandbox (setup )?failed|CreateProcess(AsUser)?W? failed|codex-command-runner|^bwrap: |^sandbox-exec: |^sandbox_apply)/im;

/**
 * Why a sandboxed run failed: 'runner' (the sandbox could not start the program: exit 127, a
 * spawn error or the runner's own error), 'blocked' (the program ran and the sandbox denied a
 * write or the network) or null (an ordinary result, success or the program's own error).
 */
export function sandboxFailure(result, { error = null } = {}) {
  if (error) return "runner";
  if (!result || result.timedOut || result.exitCode === 0) return null;
  const said = String(result.stderr || "") + "\n" + String(result.stdout || "");
  if (result.exitCode === 127 || RUNNER.test(String(result.stderr || ""))) return "runner";
  return BLOCKED.test(said) ? "blocked" : null;
}

const INTERPRETERS = new Set(["python", "python3", "py", "pythonw", "node", "deno", "bun", "ruby", "perl", "php", "rscript", "lua", "java", "javaw", "dotnet", "go", "julia", "tclsh", "wish", "groovy", "kotlin", "scala", "swift", "osascript", "electron"]);
const baseName = (program) => path.win32.basename(path.posix.basename(String(program || "").trim())).toLowerCase().replace(/\.(exe|com)$/i, "");

/**
 * Runs code the bot itself wrote or brought (null when it is an ordinary program): a program
 * inside a work folder (written or downloaded there), or an interpreter given a script file.
 */
export function untrustedCommand(program, args = [], { resolved = null, folders = [] } = {}) {
  const exe = resolved || String(program || "");
  if (path.isAbsolute(exe) && folders.filter(Boolean).some((f) => insideOf(exe, f))) return "Es un programa de la carpeta de trabajo (escrito o descargado aquí).";
  const name = baseName(program);
  if (INTERPRETERS.has(name) || /^python\d/.test(name)) {
    const list = (Array.isArray(args) ? args : []).map(String);
    if (list.some((a) => a && !a.startsWith("-") && /\.[a-z0-9]{1,6}$/i.test(a))) return "Ejecuta un script (código que no es un programa instalado).";
  }
  return null;
}

/** Key of one exact command in a step: a blocked run asked again with the same argv. */
export const sandboxKey = (tool, value) => createHash("sha256").update(tool + "\n" + JSON.stringify(value)).digest("hex").slice(0, 24);

export const BLOCKED_NOTE = "El entorno aislado ha bloqueado algo de esta orden: solo puede escribir en su carpeta de trabajo (y, donde el sistema lo permite, sin red). Si de verdad hace falta más (escribir fuera o usar internet), vuelve a llamar exactamente igual una vez: Colmena pedirá a la persona permiso para ejecutarla sin aislamiento. Si no es imprescindible, cambia de enfoque y no lo repitas.";
export const RUNNER_NOTE = "El entorno aislado no ha podido arrancar esta orden (fallo del aislamiento, no de tu programa: no se ha ejecutado). No es un bloqueo: vuelve a llamar igual; un programa normal correrá como siempre y, si es código tuyo, Colmena pedirá permiso a la persona para ejecutarlo sin aislamiento.";
export const REBLOCKED_NOTE = "El entorno aislado lo ha vuelto a bloquear y ya pediste ejecutarlo sin aislamiento: no insistas, cambia de enfoque o explica a la persona qué falta.";

/**
 * One per server. `directory` is Colmena's data folder: the sandbox's own CODEX_HOME and its
 * temp folders live there. `detect` and `platform` are injectable (tests never need codex).
 */
export class Sandbox {
  constructor({ directory, platform = process.platform, detect = detectBackend, env = process.env, now = Date.now } = {}) {
    Object.assign(this, { directory, platform, detect, env, now });
    this.cache = undefined;
    this.brokenUntil = 0;
    this.brokenReason = null;
  }

  /** The backend, detected once (null when this computer has none or it just failed). */
  backend() {
    if (this.brokenUntil > this.now()) return null;
    if (this.cache === undefined) {
      try { this.cache = this.detect({ platform: this.platform, env: this.env }) || null; } catch { this.cache = null; }
    }
    return this.cache;
  }

  /** The runner failed to start a program: fail closed for a while, then detect again. */
  markBroken(reason = "") {
    this.brokenUntil = this.now() + BROKEN_MS;
    this.brokenReason = String(reason || "").slice(0, 300);
    this.cache = undefined;
  }

  /** True when a command in `cwd` can run confined. */
  canConfine(cwd) {
    const backend = this.backend();
    if (!backend || !cwd) return false;
    // The Windows sandbox grants its folders with an ACE: only Colmena's own folders.
    if (backend.kind === "codex") return !!this.directory && insideOf(cwd, this.directory, this.platform);
    return true;
  }

  /** Private temp folder of one run (inside Colmena's data folder). */
  tempDir() {
    const base = path.join(this.directory || os.tmpdir(), "sandbox", "tmp", String(this.now()) + "-" + Math.random().toString(36).slice(2, 8));
    mkdirSync(base, { recursive: true });
    return base;
  }

  /** The sandbox's own Codex home: «unelevated» restricted token, nothing of the person's config. */
  codexHome() {
    const home = path.join(this.directory || os.tmpdir(), "sandbox", "codex-home");
    const config = path.join(home, "config.toml");
    if (!existsSync(config)) {
      mkdirSync(home, { recursive: true });
      writeFileSync(config, '# Colmena: sandbox for bot commands only.\n[windows]\nsandbox = "unelevated"\n');
    }
    return home;
  }

  /**
   * argv and environment that run `file args` confined to `cwd` (+ a private temp folder).
   * Returns {file, args, env, kind, temp} or null when it cannot be confined.
   */
  wrap(file, args = [], { cwd, env = {}, network = false } = {}) {
    if (!this.canConfine(cwd)) return null;
    const backend = this.backend();
    const temp = this.tempDir();
    const scratch = { TEMP: temp, TMP: temp, TMPDIR: temp, npm_config_cache: path.join(temp, "npm-cache") };
    if (backend.kind === "codex") {
      return {
        kind: "codex", temp,
        file: backend.command,
        args: ["sandbox", "-P", ":workspace", "-C", cwd, "--", file, ...args],
        env: { ...env, ...scratch, CODEX_HOME: this.codexHome() },
      };
    }
    if (backend.kind === "seatbelt") {
      return { kind: "seatbelt", temp, file: backend.command, args: ["-p", seatbeltProfile({ writable: [cwd, temp], network }), "--", file, ...args], env: { ...env, ...scratch } };
    }
    return {
      kind: "bwrap", temp, file: backend.command,
      args: ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--bind", cwd, cwd, "--bind", temp, temp,
        ...(network ? [] : ["--unshare-net"]), "--die-with-parent", "--new-session", "--chdir", cwd, "--", file, ...args],
      env: { ...env, ...scratch },
    };
  }

  /** Lines the runner itself prints that are not the program's («WARNING: proceeding…»). */
  clean(result) {
    if (!result || typeof result.stderr !== "string") return result;
    return { ...result, stderr: result.stderr.split(/\r?\n/).filter((l) => !/^WARNING: proceeding, even though we could not create PATH aliases/.test(l)).join("\n") };
  }

  /** Removes the private temp folder of a finished run (Colmena made it, nothing else). */
  dispose(spec) {
    if (!spec?.temp || !this.directory || !insideOf(spec.temp, path.join(this.directory, "sandbox", "tmp"), this.platform)) return;
    try { rmSync(spec.temp, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Runs a command confined when it can. `run(file, args, env)` starts the program (runProgram /
 * runArgv). mode 'amplio' (approved by the person) or no sandbox configured (legacy) runs it
 * as before. Returns {result, sandbox: {mode, kind?, blocked?, runner?, note?} | null}.
 * A runner that fails marks the backend broken and the call gets an error (never run twice):
 * the next ordinary command runs as before, and code the bot wrote fails closed into an approval.
 */
export async function runConfined(sandbox, { file, args, cwd, env, mode = "aislado", untrusted = false }, run) {
  if (!sandbox) return { result: await run(file, args, env), sandbox: null };
  if (mode === "amplio") return { result: await run(file, args, env), sandbox: { mode: "amplio" } };
  const spec = sandbox.wrap(file, args, { cwd, env });
  if (!spec) {
    if (untrusted) throw Error("Este ordenador no tiene un entorno aislado para ejecutar código escrito por el bot: hace falta la aprobación de la persona.");
    return { result: await run(file, args, env), sandbox: { mode: "sin-aislar" } };
  }
  let result = null, error = null;
  try {
    result = sandbox.clean(await run(spec.file, spec.args, spec.env));
  } catch (e) {
    error = e;
  } finally {
    sandbox.dispose(spec);
  }
  const failure = sandboxFailure(result, { error });
  if (failure === "runner") {
    sandbox.markBroken(error?.message || result?.stderr);
    return { result: { error: RUNNER_NOTE, sandboxRunner: true }, sandbox: { mode: "aislado", kind: spec.kind, runner: true, note: RUNNER_NOTE } };
  }
  if (failure === "blocked") return { result, sandbox: { mode: "aislado", kind: spec.kind, blocked: true, note: BLOCKED_NOTE } };
  return { result, sandbox: { mode: "aislado", kind: spec.kind } };
}
