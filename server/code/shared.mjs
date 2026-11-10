import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { git } from "./git.mjs";

// Constants and small helpers of «Código» (server/code/service.mjs and the files its methods live in).

export const CODE_MODELS = Object.freeze([
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
]);
/** Codex's models when model/list cannot be asked (the account's own list wins). */
export const CODEX_FALLBACK = Object.freeze([{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol", isDefault: true }]);
export const ENGINES = Object.freeze(["claude-code", "codex", "opencode"]);
export const ENGINE_LABEL = Object.freeze({ "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode" });
export const EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
/** Default shortcuts of «Código» («mod» = Ctrl on Windows). Ctrl+K stays the global palette. */
export const KEYBINDINGS = Object.freeze({
  newTask: "mod+n", focusComposer: "mod+l", togglePlan: "mod+shift+m", stop: "mod+.", compact: "mod+shift+c",
  togglePanel: "mod+j", widePanel: "mod+shift+j", tabChanges: "mod+1", tabPreview: "mod+2", tabTerminal: "mod+3",
  tabFiles: "mod+shift+f", tabProcesses: "mod+shift+o",
  newTerminal: "mod+shift+t", save: "mod+shift+s", shortcuts: "f1",
});
/** Bruno's look at the preview through his shell (preview-cli.mjs). */
export const PREVIEW_CLI = fileURLToPath(new URL("./preview-cli.mjs", import.meta.url));
const IDLE_MS = 30 * 60 * 1000;
/** A task cut by a restart goes on by itself at most this many times in RESUME_WINDOW_MS (crash-loop breaker). */
export const CODE_RESUMES = 3;
const RESUME_WINDOW_MS = 15 * 60000;
/** Automatic archiving (T3 Code auto-settle): after N days idle, when saved, when its PR closes. */
export const ARCHIVE_DEFAULTS = Object.freeze({ idleDays: 3, onSave: true, onPr: true, keepWithPr: false });
const SWEEP_MS = 30 * 1000;
/** How often a followed pull request is looked at (gh pr view). */
export const PR_POLL_MS = 2 * 60 * 1000;
const MAX_OUTPUT = 12000;
/** At most this many changed paths are kept per task to compare copies (tasks touching the same files). */
const OVERLAP_FILES = 2000;
/** A copy saved into its base is cleaned up; its last commit stays this long under a hidden ref. */
export const KEEP_SAVED_MS = 30 * 86400000;
/** `/goal`: turns Bruno may take on his own before he stops and asks (OpenClaw goal budget). */
export const GOAL_TURNS = 12;
/** The mark Bruno ends each goal turn with: «[objetivo: cumplido | sigue | bloqueado — motivo]». */
export const GOAL_MARK = /\[\s*objetivo\s*:\s*(cumplido|sigue|bloqueado)\s*(?:[—–:-]\s*([^\]]*))?\]/i;
const DENIED = "La persona ha dicho que no. No lo intentes de otra manera: sigue sin ello o explícale qué necesitas.";

const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };
/** Commits and merge commits need a name and email: the person's own Git identity, or
 * «Colmena» on a computer where Git was never set up (merging would fail otherwise). */
async function identity(cwd) {
  const who = (await git(["config", "user.email"], { cwd, ok: [0, 1] })).stdout.trim();
  return who ? [] : ["-c", "user.name=Colmena", "-c", "user.email=colmena@localhost"];
}
const base = (p) => path.basename(String(p || "")) || String(p || "");
const textOfContent = (c) => (typeof c === "string" ? c : (Array.isArray(c) ? c : []).map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[imagen]" : "")).filter(Boolean).join("\n"));

/** TodoWrite's list as Bruno's steps on screen: {text, status: done | now | todo}, at most 30. */
export function todoList(todos) {
  if (!Array.isArray(todos)) return null;
  const status = { completed: "done", in_progress: "now" };
  const list = todos.filter((t) => t && typeof t === "object" && String(t.content || "").trim()).slice(0, 30).map((t) => ({ text: clip(String(t.content).trim(), 200), status: status[t.status] || "todo" }));
  return list.length ? list : null;
}

/** A plain Spanish line for a tool call (the work log groups them). */
export function toolLine(tool, input = {}) {
  const host = (u) => { try { return new URL(u).host; } catch { return clip(u, 60); } };
  switch (tool) {
    case "Read": return { verb: "read", text: "Leyó " + base(input.file_path), detail: input.file_path || "" };
    case "Write": return { verb: "write", text: "Escribió " + base(input.file_path), detail: input.file_path || "" };
    case "Edit": case "MultiEdit": return { verb: "edit", text: "Editó " + base(input.file_path), detail: input.file_path || "" };
    case "NotebookEdit": return { verb: "edit", text: "Editó " + base(input.notebook_path), detail: input.notebook_path || "" };
    case "Bash": case "PowerShell": {
      // Codex has no description field: it writes «# Descripción: …» as the first line instead.
      const said = input.description || /^\s*#\s*(?:descripci[oó]n\s*:\s*)?(.+)$/im.exec(String(input.command || "").split(/\r?\n/)[0])?.[1];
      return { verb: "run", text: said ? clip(said.trim().replace(/\.$/, "").replace(/^./, (c) => c.toUpperCase()), 90) : "Ejecutó " + clip(input.command, 70), detail: input.command || "" };
    }
    case "Grep": return { verb: "search", text: "Buscó «" + clip(input.pattern, 40) + "»", detail: input.path || "" };
    case "Glob": return { verb: "search", text: "Buscó archivos " + clip(input.pattern, 50), detail: input.path || "" };
    case "WebFetch": return { verb: "web", text: "Leyó " + host(input.url), detail: input.url || "" };
    case "WebSearch": return { verb: "web", text: "Buscó en internet «" + clip(input.query, 50) + "»", detail: "" };
    case "Task": case "Agent": return { verb: "agent", text: "Encargó a un ayudante: " + clip(input.description || input.prompt, 70), detail: "" };
    case "Skill": return { verb: "skill", text: "Usó la habilidad " + clip(input.skill || input.name, 40), detail: "" };
    case "TodoWrite": return { verb: "plan", text: "Actualizó su lista de pasos", detail: "", todos: todoList(input.todos) };
    case "ToolSearch": return { verb: "search", text: "Buscó una herramienta", detail: "" };
    default: return { verb: "tool", text: "Usó " + tool, detail: "" };
  }
}

function redTitle(rule) {
  return {
    "git-push": "Bruno quiere publicar la rama en GitHub",
    publish: "Bruno quiere publicar",
    send: "Bruno quiere enviar datos a internet",
    "delete-outside": "Bruno quiere borrar fuera del proyecto",
    "write-outside": "Bruno quiere escribir fuera del proyecto",
    "global-install": "Bruno quiere instalar algo para todo el ordenador",
    system: "Bruno quiere cambiar la configuración de Windows",
    remote: "Bruno quiere conectarse a otro equipo",
    kill: "Bruno quiere cerrar programas",
  }[rule] || "Bruno necesita tu OK";
}

/**
 * What a turn used, as the engine reported it: Claude Code once at the end (tokens and its
 * estimated cost), Codex and OpenCode per model call. Null where the engine said nothing.
 */
export function turnUsage(turn) {
  const tokens = Number(turn?.reported?.tokens) || Number(turn?.tokens) || 0;
  const cost = typeof turn?.reported?.cost === "number" ? turn.reported.cost : Number(turn?.cost) || 0;
  return { tokens: tokens > 0 ? tokens : null, cost: cost > 0 ? Math.round(cost * 10000) / 10000 : null };
}

/** A program on the PATH (where / which), or null. */
function whichCommand(name) {
  return new Promise((resolve) => execFile(process.platform === "win32" ? "where" : "which", [name], { windowsHide: true, timeout: 10000 }, (e, out) => resolve(e ? null : String(out).split(/\r?\n/)[0].trim() || null)));
}
/** Runs [exe, ...lead] with args: {ok, stdout, stderr} (never throws). */
function runCmd(command, args, { cwd, timeout = 60000 } = {}) {
  const [exe, ...lead] = command;
  return new Promise((resolve) => execFile(exe, [...lead, ...args], { cwd, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || "") })));
}

const lastLine = (s) => String(s || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
/** gh api's error: its JSON «message» (with its «errors») when there is one, else the last line. */
function ghMessage(said) {
  try {
    const j = JSON.parse(/\{[\s\S]*\}/.exec(String(said || ""))?.[0]);
    const extra = (j.errors || []).map((e) => (typeof e === "string" ? e : e.message || e.code)).filter(Boolean);
    if (j.message) return j.message + (extra.length ? " (" + extra.join("; ") + ")" : "");
  } catch {}
  return lastLine(said);
}

/** What Bruno is told along with an automated review (dsh-superagent's take on review bots). */
const BOT_ADVICE = "Los revisores automáticos se equivocan a menudo: comprueba cada sugerencia contra el código y aplica solo las que lo mejoren claramente, sin añadir complejidad innecesaria. Las que no apliques, déjalas y di en una frase por qué.";

/** What a Código task is told when Colmena restarted in the middle of its turn. */
export const RESUME_NOTE = "Colmena se reinició mientras trabajabas y tu turno se cortó a medias. Antes de repetir nada, mira cómo está tu copia (git status, git log) y, si estabas tocando GitHub u otra cosa de fuera, cómo está allí. Luego sigue con lo que estabas haciendo.";

/** Context chips of a message: a terminal excerpt, a comment on diff lines, a preview note. */
export const CONTEXT_KINDS = ["terminal", "diff", "preview"];
export function cleanContexts(list = []) {
  return (Array.isArray(list) ? list : []).filter((c) => c && CONTEXT_KINDS.includes(c.kind) && String(c.text || c.note || "").trim()).slice(0, 20).map((c) => ({
    kind: c.kind, label: clip(String(c.label || "").trim() || { terminal: "Terminal", diff: "Cambio", preview: "Vista previa" }[c.kind], 160),
    text: clip(String(c.text || ""), 20000), note: c.note ? clip(String(c.note), 4000) : undefined,
    file: c.file ? clip(String(c.file), 400) : undefined, lines: Array.isArray(c.lines) ? c.lines.slice(0, 2).map(Number).filter(Number.isFinite) : undefined,
    url: c.url ? clip(String(c.url), 400) : undefined, image: c.image ? clip(String(c.image), 1000) : undefined,
  }));
}
/** How a context chip reaches the engine: its label, the person's note and the excerpt. */
export function contextBlock(c) {
  const head = c.kind === "diff" ? `Comentario sobre ${c.file || "un archivo"}${c.lines?.length ? (c.lines[0] === c.lines[1] || c.lines.length === 1 ? ", línea " + c.lines[0] : ", líneas " + c.lines[0] + "-" + c.lines[1]) : ""}`
    : c.kind === "preview" ? `Nota sobre la vista previa${c.url ? " (" + c.url + ")" : ""}` : c.label;
  return [head + ":", c.note ? c.note : null, c.text ? "```\n" + c.text.replace(/```/g, "ʼʼʼ") + "\n```" : null, c.image ? "Captura: " + c.image : null].filter(Boolean).join("\n");
}

/** The message of a goal's turn: the objective and how to say how it goes. */
export function goalPrompt(goal, first = false) {
  const mark = "Termina tu respuesta con una línea aparte con exactamente una de estas marcas: «[objetivo: cumplido]» si ya está hecho y comprobado, «[objetivo: sigue]» si queda trabajo, o «[objetivo: bloqueado — motivo]» si necesitas algo de la persona.";
  return first
    ? `Tu objetivo es: ${goal.text}\nTrabaja hasta cumplirlo: Colmena te dará más turnos por tu cuenta (hasta ${goal.max || GOAL_TURNS}). Comprueba de verdad que se cumple antes de darlo por hecho.\n${mark}`
    : `Sigue con el objetivo: ${goal.text}\n(vuelta ${goal.turns + 1} de ${goal.max || GOAL_TURNS}). Revisa lo que falta y avanza.\n${mark}`;
}

/** «https://github.com/a/b.git» / «git@github.com:a/b.git» → «a/b» (null for other hosts). */
export function githubRepo(remote) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(remote || "").trim());
  return m ? m[1] + "/" + m[2] : null;
}

export {
  IDLE_MS, RESUME_WINDOW_MS, SWEEP_MS, MAX_OUTPUT, OVERLAP_FILES, DENIED, clip, identity, base, textOfContent, redTitle, whichCommand, runCmd,
  lastLine, ghMessage, BOT_ADVICE,
};
