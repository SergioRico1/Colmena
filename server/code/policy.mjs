// Who may do what in a «Código» task without asking (OpenClaw exec approvals, T3 runtime modes,
// in Colmena's words). Three accesses:
//   'project' «Su copia del proyecto» — reads, edits, runs and installs inside the task folder
//             freely; only red lines ask (the default).
//   'ask'     «Pregunta antes de cada cambio» — every edit and command waits for an OK.
//   'full'    «Todo el ordenador» — no folder limit; red lines still ask.
// Red lines always ask, whatever the access: publishing (git push, npm publish, deploys, PRs),
// sending data out, deleting or writing outside the project, installing for the whole computer,
// changing the system and closing other programs.
import path from "node:path";
import { realpathSync } from "node:fs";

export const ACCESS = Object.freeze(["project", "ask", "full"]);

/** Tools that only look (never asked about). */
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "TodoWrite", "Task", "Agent", "TaskStop", "Skill", "ToolSearch", "BashOutput", "KillShell", "EnterPlanMode"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

const norm = (p) => path.resolve(String(p || "")).replace(/[\\/]+$/, "").toLowerCase();
/** The path with its symlinks resolved, as far as it exists on disk. */
function real(p) {
  let head = path.resolve(String(p || "")), tail = "";
  for (;;) {
    try { return path.join(realpathSync.native(head), tail); } catch {}
    const up = path.dirname(head);
    if (up === head) return path.join(head, tail);
    tail = path.join(path.basename(head), tail);
    head = up;
  }
}
const within = (r, f) => f === r || f.startsWith(r + path.sep) || f.startsWith(r + "/");
/**
 * Whether `file` is `root` or inside it (case-insensitive, any slash). The same place under
 * two names counts too: on macOS the temp folder is /var/… for Colmena and /private/var/… for
 * the engine, whose working directory comes with its symlinks resolved.
 */
export function inside(root, file) {
  if (!root || !file) return false;
  return within(norm(root), norm(file)) || within(norm(real(root)), norm(real(file)));
}

// ------------------------------------------------------------------ shell parsing
/** Splits a command line into simple commands (on ; && || | and newlines), each a token list. */
export function splitCommands(line) {
  const commands = [];
  let tokens = [], cur = "", quote = null, has = false;
  const push = () => { if (has) tokens.push(cur); cur = ""; has = false; };
  const end = () => { push(); if (tokens.length) commands.push(tokens); tokens = []; };
  const s = String(line || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === "\n" || c === ";" || c === "&" || c === "|") {
      end();
      if ((c === "&" || c === "|") && s[i + 1] === c) i++;
      continue;
    }
    if (/\s/.test(c)) { push(); continue; }
    if (c === "$" && s[i + 1] === "(") { end(); i++; continue; } // $(…) runs its own command
    if (c === "(" || c === ")" || c === "`" || c === "{" || c === "}") { end(); continue; }
    cur += c; has = true;
  }
  end();
  return commands;
}

const program = (t) => path.win32.basename(path.posix.basename(String(t || ""))).toLowerCase().replace(/\.(exe|cmd|bat|ps1|com)$/i, "");
const WRAPPERS = new Set(["sudo", "env", "time", "nohup", "command", "exec", "call", "start", "cmd", "/c", "start-process"]);

/** Shells that take the command line as one argument: «zsh -lc "…"», «cmd /c "…"», «pwsh -Command "…"». */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "powershell", "pwsh", "cmd"]);
const SHELL_COMMAND_FLAG = /^(-[a-z]*c|-command|\/c|\/k)$/i;

const SYSTEM = new Set(["winget", "choco", "chocolatey", "scoop", "msiexec", "reg", "regedit", "shutdown", "restart-computer", "stop-computer", "format",
  "diskpart", "bcdedit", "takeown", "icacls", "cacls", "setx", "schtasks", "sc", "netsh", "net", "net1", "runas", "wmic", "vssadmin", "cipher",
  "manage-bde", "powercfg", "dism", "sfc", "fsutil", "pnputil", "set-itemproperty", "new-itemproperty", "remove-itemproperty", "set-executionpolicy",
  "install-module", "install-package", "add-appxpackage", "register-scheduledtask", "new-service", "set-service",
  // macOS
  "brew", "port", "installer", "softwareupdate", "launchctl", "csrutil", "spctl", "dscl", "networksetup", "systemsetup", "pmset", "scutil", "nvram",
  "diskutil", "tccutil"]);
const REMOTE = new Set(["ssh", "scp", "sftp", "ftp", "telnet", "rsync", "plink", "pscp", "mstsc"]);
const KILLERS = new Set(["taskkill", "stop-process", "kill", "pkill", "killall", "spps"]);
const DELETERS = new Set(["rm", "del", "erase", "rmdir", "rd", "remove-item", "ri", "rimraf", "shred", "sdelete"]);
const SENDERS = new Set(["curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm"]);
const JS_PMS = new Set(["npm", "pnpm", "yarn", "bun"]);
const DEPLOYERS = { vercel: null, netlify: /^deploy$/, firebase: /^deploy$/, fly: /^(deploy|launch)$/, flyctl: /^(deploy|launch)$/, wrangler: /^(deploy|publish|pages)$/, surge: null, heroku: /./, railway: /^(up|deploy)$/, eas: /^(submit|update)$/ };

const red = (rule, reason, extra = {}) => ({ redLine: true, rule, reason, ...extra });

/** Arguments that look like paths (not flags). */
const pathArgs = (args) => args.filter((a) => a && !/^-/.test(a) && !/^\/[A-Za-z?]{1,3}(:.*)?$/.test(a));
const isAbsolute = (p) => /^([A-Za-z]:[\\/]|[\\/]{1,2}[^\\/]|~|\$home|\$env:|%userprofile%)/i.test(p) || p === "/" || p === "\\";

/** Whether a path argument (relative to cwd) escapes the allowed roots. */
function escapes(arg, cwd, roots) {
  const a = String(arg).replace(/^["']|["']$/g, "");
  if (!a || a === ".") return false;
  if (/^(~|\$home|\$env:|%)/i.test(a)) return true;
  if (/^[A-Za-z]:$/.test(a) || a === "/" || a === "\\" || /^[A-Za-z]:[\\/]?\*?$/.test(a)) return true;
  const full = isAbsolute(a) ? (/^\/[a-z]\//i.test(a) ? a[1] + ":" + a.slice(2) : a) : path.resolve(cwd, a);
  return !roots.some((r) => inside(r, full));
}

/** Classifies one simple command (token list). */
function classifyOne(tokens, { cwd, roots, depth = 0 }) {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || WRAPPERS.has(program(tokens[i])) || WRAPPERS.has(tokens[i].toLowerCase()))) i++;
  // «cmd /c "git push"»: cmd and /c are skipped above, the quoted line is one token.
  if (i > 0 && i === tokens.length - 1 && /\s/.test(tokens[i]) && SHELL_COMMAND_FLAG.test(tokens[i - 1]) && depth < 3) {
    const hit = classifyShell(tokens[i], { cwd, roots, depth: depth + 1 });
    return hit.redLine ? hit : null;
  }
  const name = program(tokens[i]);
  const args = tokens.slice(i + 1);
  const lower = args.map((a) => a.toLowerCase());
  const sub = lower.find((a) => !a.startsWith("-")) || "";
  if (!name) return null;
  if (SHELLS.has(name)) {
    // The line a shell is given to run is judged like any other (Codex on macOS: «/bin/zsh -lc "…"»).
    const at = args.findIndex((a) => SHELL_COMMAND_FLAG.test(a));
    if (at >= 0 && args[at + 1] && depth < 3) {
      const hit = classifyShell(args.slice(at + 1).join(" "), { cwd, roots, depth: depth + 1 });
      if (hit.redLine) return hit;
    }
    return null;
  }
  if (name === "git") {
    if (sub === "push") return red("git-push", "Publica tu rama en el repositorio remoto.", { durable: true });
    if (sub === "config" && lower.some((a) => a === "--global" || a === "--system")) return red("system", "Cambia tu configuración de Git para todo el ordenador.");
    if (sub === "send-email") return red("send", "Envía correo.");
    return null;
  }
  if (JS_PMS.has(name)) {
    if (/^(publish|unpublish|deprecate|owner|adduser|login|logout|token|dist-tag)$/.test(sub)) return red("publish", "Publica un paquete o toca tu cuenta de " + name + ".");
    if (lower.includes("-g") || lower.includes("--global") || (name === "yarn" && sub === "global")) return red("global-install", "Instala para todo el ordenador, no solo en el proyecto.");
    return null;
  }
  if (name === "gh") {
    const [a, b] = lower.filter((x) => !x.startsWith("-"));
    if (a === "pr" && /^(create|merge|close|ready|comment|review|edit)$/.test(b || "")) return red("publish", "Crea o cambia un pull request en GitHub.");
    if (a === "release" || a === "gist" || (a === "repo" && /^(create|delete|edit|rename|archive|fork)$/.test(b || "")) || (a === "issue" && /^(create|close|comment|edit|delete)$/.test(b || "")) || a === "api")
      return red("publish", "Cambia cosas en GitHub.");
    return null;
  }
  if (name in DEPLOYERS) {
    const rule = DEPLOYERS[name];
    if (!rule || rule.test(sub)) return red("publish", "Publica la aplicación en internet.");
    return null;
  }
  if (name === "docker" && /^(push|login)$/.test(sub)) return red("publish", "Publica una imagen o entra en tu cuenta de Docker.");
  if (SYSTEM.has(name)) return red("system", "Cambia la configuración del sistema o instala programas.");
  if (name === "defaults" && /^(write|delete|import|rename)$/.test(sub)) return red("system", "Cambia la configuración del sistema o instala programas.");
  if (REMOTE.has(name)) return red("remote", "Se conecta a otro equipo.");
  if ((name === "pip" || name === "pip3") && sub === "install" && lower.includes("--user")) return red("global-install", "Instala para todo el ordenador, no solo en el proyecto.");
  if (KILLERS.has(name)) {
    const byName = lower.some((a) => a === "/im" || a === "-name" || a === "-processname") || name === "pkill" || name === "killall";
    if (byName || lower.includes("/f") && !lower.includes("/pid")) return red("kill", "Cierra programas por su nombre (podrían ser tuyos).");
    return null;
  }
  if (SENDERS.has(name)) {
    const sends = lower.some((a, k) => /^(-d|--data.*|-f|--form.*|-t|--upload-file|--post-data|--post-file|-body|-infile)$/.test(a)
      || ((a === "-x" || a === "--request" || a === "-method") && /^(post|put|patch|delete)$/i.test(lower[k + 1] || "")));
    if (sends) return red("send", "Envía datos a internet.");
    const out = lower.findIndex((a) => a === "-o" || a === "--output" || a === "-outfile");
    if (out >= 0 && args[out + 1] && escapes(args[out + 1], cwd, roots)) return red("write-outside", "Guarda un archivo fuera del proyecto.");
    return null;
  }
  if (DELETERS.has(name)) {
    // rm (Git Bash) has no «/x» switches: /c is the C: drive there.
    const targets = name === "rm" || name === "rimraf" || name === "shred" ? args.filter((a) => a && !a.startsWith("-")) : pathArgs(args);
    if (targets.some((t) => escapes(t, cwd, roots))) return red("delete-outside", "Borra archivos fuera del proyecto.");
    return null;
  }
  if (name === "mv" || name === "move" || name === "move-item" || name === "cp" || name === "copy" || name === "copy-item" || name === "robocopy" || name === "xcopy") {
    const targets = pathArgs(args);
    const dest = targets.at(-1);
    if (dest && escapes(dest, cwd, roots)) return red("write-outside", "Mueve o copia archivos fuera del proyecto.");
    if ((name === "mv" || name === "move" || name === "move-item") && targets.slice(0, -1).some((t) => escapes(t, cwd, roots))) return red("delete-outside", "Mueve archivos que están fuera del proyecto.");
    return null;
  }
  return null;
}

/** Output redirections (> file, >> file, Out-File, Set-Content) that land outside the roots. */
function redirectsOutside(line, cwd, roots) {
  const targets = [];
  for (const m of String(line).matchAll(/(?:^|[^0-9&>])>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) targets.push(m[1]);
  for (const m of String(line).matchAll(/\b(?:out-file|set-content|add-content|tee-object)\b[^;|&\n]*?(?:-(?:file)?path\s+|\s)("[^"]+"|'[^']+'|[^\s;&|-][^\s;&|]*)/gi)) targets.push(m[1]);
  return targets.some((t) => !/^(\/dev\/null|nul|\$null|&\d)$/i.test(t.replace(/^["']|["']$/g, "")) && escapes(t, cwd, roots));
}

/** Classifies a whole shell command line. {redLine, rule, reason, durable?} */
export function classifyShell(line, { cwd, roots = [cwd], depth = 0 } = {}) {
  const all = roots.filter(Boolean);
  for (const tokens of splitCommands(line)) {
    const hit = classifyOne(tokens, { cwd, roots: all, depth });
    if (hit) return hit;
  }
  if (redirectsOutside(line, cwd, all)) return red("write-outside", "Escribe un archivo fuera del proyecto.");
  return { redLine: false, rule: null, reason: null };
}

/** Short Spanish sentence for the card title. */
export function askTitle(tool, input = {}) {
  if (SHELL_TOOLS.has(tool)) return "Quiere ejecutar una orden";
  if (EDIT_TOOLS.has(tool)) return "Quiere cambiar " + path.basename(String(input.file_path || input.notebook_path || "un archivo"));
  return "Quiere usar " + tool;
}

/**
 * The decision for one tool call.
 * @returns {{decision:'allow'|'ask'|'redline', rule?:string, reason?:string, durable?:boolean}}
 */
export function decide({ tool, input = {}, access = "project", cwd, roots = [cwd], allowed = [], taskAllow = [], commands = [] }) {
  const all = [cwd, ...roots].filter(Boolean);
  if (READ_TOOLS.has(tool) || tool === "AskUserQuestion" || tool === "ExitPlanMode") return { decision: "allow" };
  // «En esta tarea» (taskAllow: a red line's rule, or «edit» / «shell» / a tool) and «Siempre
  // aquí» (commands: exact command lines of this project) answer before asking again
  // (OpenClaw exec approvals). Changing the system and deleting outside always ask.
  const scoped = (rule) => !ONCE_ONLY.has(rule);
  const ask = (reason, scope) => ({ decision: "ask", reason, taskScope: scope });
  if (tool.startsWith("mcp__")) return access === "ask" && !taskAllow.includes(tool) ? ask("Usa una herramienta externa.", tool) : { decision: "allow" };
  if (EDIT_TOOLS.has(tool)) {
    const file = input.file_path || input.notebook_path || "";
    if (access !== "full" && !all.some((r) => inside(r, path.resolve(cwd || ".", String(file))))) {
      if (taskAllow.includes("write-outside")) return { decision: "allow", rule: "write-outside" };
      return { decision: "redline", rule: "write-outside", reason: "Cambia un archivo fuera del proyecto.", taskScope: "write-outside" };
    }
    return access === "ask" && !taskAllow.includes("edit") ? ask("Cambia un archivo del proyecto.", "edit") : { decision: "allow" };
  }
  if (SHELL_TOOLS.has(tool)) {
    // Deleting or writing outside the project stays a red line even with «Todo el ordenador».
    const hit = classifyShell(input.command, { cwd, roots: all });
    const exact = commandKey(input.command);
    if (hit.redLine) {
      if (hit.durable && allowed.includes(hit.rule)) return { decision: "allow", rule: hit.rule };
      if (scoped(hit.rule) && (taskAllow.includes(hit.rule) || commands.includes(exact))) return { decision: "allow", rule: hit.rule };
      return { decision: "redline", rule: hit.rule, reason: hit.reason, durable: !!hit.durable, ...(scoped(hit.rule) ? { taskScope: hit.rule, exact } : {}) };
    }
    if (access !== "ask" || taskAllow.includes("shell") || commands.includes(exact)) return { decision: "allow" };
    return { ...ask("Ejecuta una orden en el proyecto.", "shell"), exact };
  }
  // Anything new or unknown: free inside the project, asked when the person wants to see every step.
  return access === "ask" && !taskAllow.includes(tool) ? ask("Usa " + tool + ".", tool) : { decision: "allow" };
}

/** Red lines that never become «En esta tarea» or «Siempre aquí»: asked every time. */
export const ONCE_ONLY = new Set(["system", "delete-outside"]);
/** One command line as «Siempre aquí» keeps it: trimmed, spaces collapsed. */
export const commandKey = (line) => String(line || "").trim().replace(/\s+/g, " ").slice(0, 2000);
