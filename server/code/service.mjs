// «Código»: projects (a folder or a repository), tasks (one thread each, optionally in its own
// git worktree) and the engine that does the work: Claude Code or Codex of this computer
// (claude.mjs, codex.mjs), both turned into the same events (onEvent). Each turn is bracketed by restore points, so the timeline shows what the turn
// changed, «Volver aquí» puts any point back and «Editar desde aquí» rewrites a message.
//
// Records: codeProjects, codeTasks, codeItems (the task's timeline). Live text and updates go
// to the open «Código» screen through `events` (routes.mjs streams them as SSE); the records
// stay out of the app-wide /api/events stream so a long turn never refreshes other screens.
import { EventEmitter } from "node:events";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { now } from "../store.mjs";
import { killTree } from "../projects/run.mjs";
import { ClaudeCodeEngine } from "./claude.mjs";
import { CodexEngine, codexModels, findCodexCli } from "./codex.mjs";
import { OpenCodeEngine, OPENCODE_MODELS, findOpenCode, installOpenCode } from "./opencode.mjs";
import { decide, askTitle, ACCESS } from "./policy.mjs";
import { Snapshots, repoInfo, addWorktree, removeWorktree, git, slug, copyIncluded, savedRef, keepCommit, dropRef, restoreWorktree } from "./git.mjs";
import { taskPorts, descendants, stopFamily } from "./ports.mjs";
import { Terminals, projectScripts } from "./terminal.mjs";
import { expandSkills } from "./context.mjs";

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
  newTerminal: "mod+shift+t", save: "mod+shift+s", shortcuts: "f1",
});
/** Bruno's look at the preview through his shell (preview-cli.mjs). */
export const PREVIEW_CLI = fileURLToPath(new URL("./preview-cli.mjs", import.meta.url));
const IDLE_MS = 30 * 60 * 1000;
const MAX_OUTPUT = 12000;
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
    case "TodoWrite": return { verb: "plan", text: "Actualizó su lista de pasos", detail: "" };
    case "ToolSearch": return { verb: "search", text: "Buscó una herramienta", detail: "" };
    default: return { verb: "tool", text: "Usó " + tool, detail: "" };
  }
}

export class CodeService {
  constructor({ store, directory = store.directory, command = null, codexCommand = undefined, opencodeCommand = undefined, goKey = null, ptySpawn = null, notifier = null, computer = null } = {}) {
    this.computer = computer; // the desktop browser (server/computer/bridge.mjs): Bruno's look at the preview
    this.apiBase = null; // http://127.0.0.1:<port>/api, set once the server listens (preview-cli.mjs)
    this.store = store;
    this.directory = path.resolve(directory);
    this.command = command; // Claude Code ([exe, ...args] in tests)
    this.codexCommand = codexCommand === undefined ? findCodexCli() : codexCommand;
    this.codexList = null; // Codex's models for this account (asked once)
    this.opencodeFixed = opencodeCommand; // tests; otherwise Colmena's own install, looked up each time
    this.goKey = goKey; // async () => the OpenCode Go key (DPAPI vault), or null
    this.events = new EventEmitter();
    this.events.setMaxListeners(50);
    this.engines = new Map(); // taskId → {engine, turn, idle}
    this.asks = new Map(); // ask item id → {resolve}
    this.snaps = new Map();
    this.seq = new Map();
    this.starting = new Set(); // tasks whose turn is starting (a message now waits in the queue)
    this.families = new Map(); // taskId → Map(pid → {pid, command}): what its engine started
    this.terminals = new Terminals({ directory: this.directory, spawn: ptySpawn });
    this.terminals.onSetup = (e) => this.setupDone(e);
    this.notifier = notifier; // Avisos (server/notifications.mjs): Windows notice and sound
    this.watch = { task: null, focused: false, until: 0 }; // the task the person has in front of them
    // Questions that were open when Colmena closed can no longer be answered.
    for (const item of store.list("codeItems").filter((i) => i.kind === "ask" && i.status === "pending")) store.put("codeItems", { ...item, status: "expired" });
    for (const task of store.list("codeTasks").filter((t) => ["working", "waiting"].includes(t.status))) store.put("codeTasks", { ...task, status: "idle", queue: task.queue || [] });
    void this.pruneSaved().catch(() => {});
  }

  emit(event) { this.events.emit("event", event); }

  /** A setup script of a new copy ended: its «Preparando…» line says how. */
  setupDone({ taskId, id, title, ok }) {
    const notice = this.store.get("codeTasks", taskId) && this.items(taskId).find((i) => i.kind === "notice" && i.setup === id);
    if (!notice) return;
    this.patchItem(notice.id, { text: ok ? "Copia lista: «" + title + "» terminó bien." : "«" + title + "» falló al preparar la copia: mira su terminal.", tone: ok ? "done" : "warn", setup: null });
  }

  /** The «Código» screen says which task it shows and whether the window has the focus. */
  setWatch({ task = null, focused = false } = {}) {
    this.watch = { task: task ? String(task) : null, focused: !!focused, until: Date.now() + 90000 };
    return { ok: true };
  }
  watching(taskId) {
    return this.watch.task === taskId && this.watch.focused && Date.now() < this.watch.until;
  }

  /**
   * A Windows notice and its sound (Ajustes › Avisos) when a task ends («done»), needs the person
   * («needs») or gets stuck («failed»); not while the person is looking at that very task.
   */
  notifyTask(taskId, kind, text) {
    const task = this.store.get("codeTasks", taskId);
    if (!this.notifier || !task || this.watching(taskId)) return null;
    const name = this.bot().name;
    const title = kind === "done" ? `${name} ha terminado «${task.title}»` : kind === "failed" ? `«${task.title}» se ha atascado` : `${name} te espera en «${task.title}»`;
    try {
      return this.notifier.notify({ kind, botId: "bruno", title: clip(title, 120), text: clip(String(text || "").replace(/\s+/g, " ").trim(), 240), url: "/codigo/" + taskId, extra: { codeTask: taskId } });
    } catch (error) {
      console.warn("Código: sin aviso: " + error.message);
      return null;
    }
  }

  /** The engines of this computer with their models: [{id, label, available, models}]. */
  async catalog() {
    if (this.codexCommand && !this.codexList) {
      this.codexLoading ||= codexModels({ command: this.codexCommand }).then((list) => { this.codexList = list.length ? list : [...CODEX_FALLBACK]; }).catch(() => { this.codexList = [...CODEX_FALLBACK]; });
      await Promise.race([this.codexLoading, new Promise((r) => setTimeout(r, 8000))]);
    }
    const hasGo = !!(await Promise.resolve(this.goKey?.()).catch(() => null));
    return [
      { id: "claude-code", label: ENGINE_LABEL["claude-code"], available: true, models: CODE_MODELS },
      { id: "codex", label: ENGINE_LABEL.codex, available: !!this.codexCommand, models: this.codexList || [...CODEX_FALLBACK] },
      { id: "opencode", label: ENGINE_LABEL.opencode, available: !!this.opencodeCommand(), installable: !this.opencodeCommand(), installing: !!this.opencodeInstall, models: this.opencodeModels(hasGo) },
    ];
  }
  opencodeCommand() { return this.opencodeFixed !== undefined ? this.opencodeFixed : findOpenCode(this.directory); }
  /** OpenCode Go's models only with your Go key; the free ones always. */
  opencodeModels(hasGo = this.hasGo !== false) {
    this.hasGo = hasGo;
    return OPENCODE_MODELS.filter((m) => hasGo || !m.go).map((m) => ({ ...m, isDefault: hasGo ? !!m.isDefault : m.id === "opencode/deepseek-v4.1-flash-free" }));
  }
  /** «Instalar OpenCode»: npm into Colmena's own folder (the person's click is the OK). */
  async installOpenCode() {
    if (this.opencodeCommand()) return { ok: true };
    this.opencodeInstall ||= installOpenCode(this.directory).finally(() => { this.opencodeInstall = null; this.emit({ type: "projects" }); });
    this.emit({ type: "projects" });
    return this.opencodeInstall;
  }
  modelsOf(engine) { return engine === "codex" ? this.codexList || [...CODEX_FALLBACK] : engine === "opencode" ? this.opencodeModels() : CODE_MODELS; }
  defaultModel(engine) { const list = this.modelsOf(engine); return (list.find((m) => m.isDefault) || list[0]).id; }

  // ------------------------------------------------------------------ projects
  projects() {
    const tasks = this.store.list("codeTasks");
    return this.store.list("codeProjects").map((p) => ({ ...p, tasks: tasks.filter((t) => t.projectId === p.id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((t) => this.taskView(t)) }));
  }

  async addProject({ folder }) {
    const root = path.resolve(String(folder || ""));
    let info;
    try { info = statSync(root); } catch { throw Object.assign(Error("No encuentro esa carpeta."), { status: 404 }); }
    if (!info.isDirectory()) throw Object.assign(Error("Eso no es una carpeta."), { status: 400 });
    if (root.toLowerCase().startsWith(this.directory.toLowerCase())) throw Object.assign(Error("Esa carpeta es de Colmena: elige una tuya."), { status: 400 });
    const existing = this.store.list("codeProjects").find((p) => p.root.toLowerCase() === root.toLowerCase());
    if (existing) return existing;
    const repo = await repoInfo(root);
    const project = { id: "cp-" + randomUUID().slice(0, 8), name: base(root), root, repo: repo.repo, top: repo.top, base: repo.branch, allow: [], createdAt: now(), updatedAt: now() };
    this.store.put("codeProjects", project);
    this.emit({ type: "projects" });
    return project;
  }

  /** «Empezar de cero»: a new folder in Documentos\Colmena (with Git when it is installed). */
  async newProject({ name }) {
    const docs = path.join(os.homedir(), "Documents");
    const parent = path.join(existsSync(docs) ? docs : os.homedir(), "Colmena");
    let dir = path.join(parent, slug(name || "proyecto"));
    for (let n = 2; existsSync(dir); n++) dir = path.join(parent, slug(name || "proyecto") + "-" + n);
    await mkdir(dir, { recursive: true });
    await git(["init", "-q", "-b", "main"], { cwd: dir }).catch(() => {});
    return this.addProject({ folder: dir });
  }

  /** «Clonar de GitHub»: `git clone <url>` into Documentos\Colmena. */
  async cloneProject({ url }) {
    const u = String(url || "").trim();
    if (!/^https:\/\/[\w.-]+\/[\w.~-]+\/[\w.~-]+?(\.git)?\/?$/.test(u)) throw Object.assign(Error("Pega la dirección https del repositorio (por ejemplo https://github.com/usuario/proyecto)."), { status: 400 });
    const docs = path.join(os.homedir(), "Documents");
    const parent = path.join(existsSync(docs) ? docs : os.homedir(), "Colmena");
    const name = slug(u.replace(/\/$/, "").split("/").pop().replace(/\.git$/, ""));
    let dir = path.join(parent, name);
    for (let n = 2; existsSync(dir); n++) dir = path.join(parent, name + "-" + n);
    await mkdir(parent, { recursive: true });
    try {
      await git(["clone", "--", u, dir], { cwd: parent, timeout: 600000 });
    } catch (error) {
      throw Object.assign(Error("No se pudo clonar: " + error.message), { status: 422 });
    }
    return this.addProject({ folder: dir });
  }

  removeProject(id) {
    const project = this.mustProject(id);
    for (const t of this.store.list("codeTasks").filter((t) => t.projectId === id)) void this.deleteTask(t.id);
    this.store.remove("codeProjects", project.id);
    this.emit({ type: "projects" });
    return { ok: true };
  }

  mustProject(id) {
    const p = this.store.get("codeProjects", String(id));
    if (!p) throw Object.assign(Error("Proyecto no encontrado."), { status: 404 });
    return p;
  }
  mustTask(id) {
    const t = this.store.get("codeTasks", String(id));
    if (!t) throw Object.assign(Error("Tarea no encontrada."), { status: 404 });
    return t;
  }

  // ------------------------------------------------------------------ tasks
  taskView(t) {
    const turns = t.turns || [];
    const live = this.engines.get(t.id);
    return {
      id: t.id, projectId: t.projectId, title: t.title, botId: t.botId, status: t.status, engine: t.engine || "claude-code", model: t.model, effort: t.effort, access: t.access,
      isolated: !!t.isolated, branch: t.branch || null, base: t.base || null, cwd: t.cwd, add: turns.reduce((n, x) => n + (x.add || 0), 0), del: turns.reduce((n, x) => n + (x.del || 0), 0),
      turns: turns.length, lastChanged: [...turns].reverse().find((x) => x.files?.length)?.n || null, queue: t.queue || [], error: t.error || null, merged: t.merged || null, usage: t.usage || null, limit: t.limit || null, running: !!live?.turn, createdAt: t.createdAt, updatedAt: t.updatedAt,
      goal: t.goal || null, saved: t.saved ? { at: t.saved.at, until: t.saved.until, expired: !!t.saved.expired } : null, included: t.included || null,
      merging: t.merging || null, review: t.review || null, previewCheck: t.previewCheck || null,
    };
  }

  items(taskId) {
    return this.store.list("codeItems").filter((i) => i.taskId === taskId).sort((a, b) => a.seq - b.seq);
  }

  detail(taskId) {
    const task = this.mustTask(taskId);
    const project = this.store.get("codeProjects", task.projectId);
    const live = this.engines.get(taskId);
    if (task.engine === "codex" && !this.codexList) void this.catalog(); // its names, for the next refresh
    return { task: this.taskView(task), project, items: this.items(taskId), live: live?.turn ? { text: live.turn.live || "" } : null, models: this.modelsOf(task.engine), commands: live?.engine?.commands || [] };
  }

  nextSeq(taskId) {
    let n = this.seq.get(taskId);
    if (n === undefined) n = this.items(taskId).reduce((m, i) => Math.max(m, i.seq || 0), 0);
    n += 1;
    this.seq.set(taskId, n);
    return n;
  }

  putItem(item) {
    const record = this.store.put("codeItems", item);
    this.emit({ type: "item", task: item.taskId, item: record });
    return record;
  }
  addItem(taskId, data) {
    return this.putItem({ id: "ci-" + randomUUID(), taskId, seq: this.nextSeq(taskId), at: now(), ...data });
  }
  patchItem(id, changes) {
    const old = this.store.get("codeItems", id);
    if (!old) return null;
    return this.putItem({ ...old, ...changes });
  }
  setTask(id, changes) {
    const next = this.store.patch("codeTasks", id, changes);
    this.emit({ type: "task", task: this.taskView(next) });
    return next;
  }

  snapsOf(task) {
    let s = this.snaps.get(task.id);
    if (!s) this.snaps.set(task.id, (s = new Snapshots({ key: task.id, dir: path.join(this.directory, "code", "snapshots", task.id), root: task.cwd })));
    return s;
  }

  /** Shortcuts: the defaults with the person's changes («» = no shortcut for that action). */
  keybindings() {
    const mine = this.store.get("codeSettings", "keybindings")?.bindings || {};
    return { defaults: KEYBINDINGS, bindings: { ...KEYBINDINGS, ...Object.fromEntries(Object.entries(mine).filter(([k]) => k in KEYBINDINGS)) } };
  }
  setKeybindings(bindings) {
    const clean = Object.fromEntries(Object.entries(bindings || {}).filter(([k]) => k in KEYBINDINGS).map(([k, v]) => [k, String(v).toLowerCase()]));
    this.store.put("codeSettings", { id: "keybindings", bindings: clean, updatedAt: now() });
    return this.keybindings();
  }

  /** colmena.json / t3.json / package.json scripts of the task's folder and of the project. */
  scriptsOf(task) {
    const project = this.store.get("codeProjects", task.projectId);
    return projectScripts(task.cwd, project?.root);
  }

  bot() {
    return this.store.get("bots", "bruno") || { id: "bruno", name: "Bruno", instructions: "" };
  }

  async createTask({ projectId, text, engine = "claude-code", model = null, effort = "high", access = "project", isolated = true, mode = "build", attachments = [], label = null }) {
    const project = this.mustProject(projectId);
    if (!ENGINES.includes(engine)) engine = "claude-code";
    if (engine === "codex" && !this.codexCommand) throw Object.assign(Error("Codex no está instalado en este ordenador."), { status: 409 });
    if (engine === "opencode" && !this.opencodeCommand()) throw Object.assign(Error("OpenCode no está instalado para Colmena: pulsa «Instalar OpenCode»."), { status: 409 });
    if (!model || !this.modelsOf(engine).some((m) => m.id === model)) model = this.defaultModel(engine);
    const repo = project.repo ? await repoInfo(project.root) : { repo: false };
    const id = "ct-" + randomUUID().slice(0, 8);
    // Several engines at once: each task says which one it is.
    const title = clip(String(text || "").trim().split(/\r?\n/)[0] || "Tarea nueva", label ? 50 : 70) + (label ? " · " + clip(label, 30) : "");
    let cwd = project.root, branch = null, baseRef = null, baseCommit = null;
    const copy = isolated && repo.repo && !!repo.head;
    if (copy) {
      branch = "colmena/" + slug(title).slice(0, 32) + "-" + id.slice(3, 7);
      baseRef = repo.branch || repo.head;
      baseCommit = repo.head;
      cwd = path.join(this.directory, "code", "worktrees", project.id, id);
      // A sub-folder of a repository keeps its place inside the copy.
      const rel = path.relative(repo.top, project.root);
      await addWorktree({ repo: repo.top, dir: cwd, branch, base: baseCommit });
      if (rel && !rel.startsWith("..")) cwd = path.join(cwd, rel);
    }
    // The copy starts ready: ignored files listed in .worktreeinclude (like .env) come along.
    const included = copy ? await copyIncluded({ from: repo.top, to: path.join(this.directory, "code", "worktrees", project.id, id) }).catch(() => []) : [];
    const task = {
      id, projectId: project.id, title, botId: "bruno", engine, model, effort, access: ACCESS.includes(access) ? access : "project",
      isolated: copy, cwd, branch, base: baseRef, baseCommit, worktree: copy ? path.join(this.directory, "code", "worktrees", project.id, id) : null, repoTop: repo.top || null,
      status: "idle", turns: [], queue: [], session: { id: randomUUID(), started: false, forkAt: null }, createdAt: now(), updatedAt: now(),
      included: included.length ? included.slice(0, 50) : null,
    };
    this.store.put("codeTasks", task);
    try { task.baseSnap = await this.snapsOf(task).capture("base"); this.store.put("codeTasks", task); } catch (e) { console.warn("Código: sin punto base: " + e.message); }
    this.store.patch("codeProjects", project.id, { updatedAt: now() });
    this.emit({ type: "projects" });
    if (included.length) this.addItem(id, { kind: "notice", text: "Copia preparada con " + (included.length === 1 ? included[0] : included.length + " archivos de .worktreeinclude (" + included.slice(0, 3).join(", ") + (included.length > 3 ? "…" : "") + ")") + "." });
    // The project's setup scripts (colmena.json «onCreate», T3 Code's runOnWorktreeCreate) run
    // in a terminal of the new copy, like installing its dependencies; each says when it ends.
    for (const script of this.scriptsOf(task).filter((x) => x.onCreate).slice(0, 3)) {
      const opened = await this.terminals.open(task.id, { cwd: task.cwd, command: script.command, title: script.name, setup: true }).catch(() => null);
      if (opened) this.addItem(id, { kind: "notice", text: "Preparando la copia: «" + script.name + "» en una terminal…", setup: opened.id });
    }
    if (String(text || "").trim() || attachments.length) await this.send(id, { text, mode, attachments });
    else this.emit({ type: "projects" });
    return this.taskView(this.mustTask(id));
  }

  patchTask(id, { title, model, effort, access }) {
    const task = this.mustTask(id);
    const changes = {};
    if (title) changes.title = clip(title.trim(), 70);
    if (access && ACCESS.includes(access)) changes.access = access;
    if (model && this.modelsOf(task.engine).some((m) => m.id === model) && model !== task.model) changes.model = model;
    if (effort && EFFORTS.includes(effort) && effort !== task.effort) changes.effort = effort;
    const next = this.setTask(id, changes);
    // A new model or effort takes effect on the next turn (the session is resumed with it).
    if ((changes.model || changes.effort) && !this.engines.get(id)?.turn) this.closeEngine(id);
    this.emit({ type: "projects" });
    return this.taskView(next);
  }

  // ------------------------------------------------------------------ the engine
  instructions(task) {
    const bot = this.bot();
    const project = this.store.get("codeProjects", task.projectId);
    return [
      `Eres ${bot.name}, el bot de código de Colmena. ${bot.instructions || ""}`.trim(),
      "",
      `Trabajas en la carpeta ${task.cwd}.`,
      task.isolated
        ? `Es una copia aparte (git worktree) del proyecto ${project?.root || ""}, en la rama ${task.branch}. La carpeta original y ${task.base || "su rama"} no cambian hasta que la persona lo guarde. No hagas commit, merge ni push: Colmena lo hace con sus botones.`
        : "Es la carpeta del proyecto: Colmena guarda un punto de restauración antes y después de cada turno.",
      "La persona no es técnica. Escribe en español también la descripción (description) de cada orden que ejecutes. Responde siempre en español claro: primero qué has hecho o la conclusión, luego lo importante, y como mucho una pregunta al final.",
      ...(() => {
        const setup = this.scriptsOf(task).filter((x) => x.onCreate).map((x) => x.command);
        return setup.length ? ["Al crear esta tarea, Colmena ha lanzado en una terminal: " + setup.join(" · ") + ". No lo repitas salvo que falle."] : [];
      })(),
      "Antes de decir que algo está listo, pruébalo (tests, build o arrancando la app) y di qué has comprobado.",
      "Para ver la app, arranca su servidor de desarrollo en segundo plano (run_in_background) y di su dirección (http://127.0.0.1:PUERTO): Colmena la enseña en la vista previa. Comprueba que esa dirección se ve como página y no como su código: el servidor debe enviar el HTML con Content-Type text/html (y CSS y JS con su tipo). Si faltan las dependencias (node_modules), instálalas.",
      "Publicar, subir a GitHub, borrar o escribir fuera del proyecto, instalar programas para todo el ordenador o cerrar programas por su nombre necesita el OK de la persona: Colmena se lo pregunta. Si dice que no, no lo intentes de otra manera. Parar por su PID los procesos que tú mismo arrancaste no necesita OK.",
      ...(this.computer?.available && this.apiBase ? [
        `Para mirar la app como la persona (errores de la consola, cargas que fallan, el texto, los elementos y una captura), con su servidor en marcha ejecuta: node "${PREVIEW_CLI}" ver [ruta o puerto]. Después: node "${PREVIEW_CLI}" pulsa <ref> · escribe <ref> <texto> · tecla <tecla>. Hazlo tras cada cambio visible y antes de decir que está listo.`,
      ] : []),
    ].join("\n");
  }

  async engineFor(task) {
    const live = this.engines.get(task.id);
    if (live?.engine.alive) return live;
    const session = task.session || { id: randomUUID(), started: false };
    const env = this.apiBase ? { COLMENA_CODE_API: this.apiBase, COLMENA_CODE_TASK: task.id } : {};
    const common = { cwd: task.cwd, model: task.model, effort: task.effort, access: task.access, env, instructions: this.instructions(task), authorize: (req) => this.authorize(task.id, req) };
    const engine = task.engine === "codex"
      ? new CodexEngine({ ...common, command: this.codexCommand, threadId: session.started ? session.id : null, rollback: session.rollback || 0 })
      : task.engine === "opencode"
        ? new OpenCodeEngine({ ...common, command: this.opencodeCommand(), sessionId: session.started ? session.id : null, forkAt: session.forkAt || null, apiKey: String(task.model).startsWith("opencode-go/") ? await Promise.resolve(this.goKey?.()).catch(() => null) : null })
        : new ClaudeCodeEngine({ ...common, command: this.command, sessionId: session.id, resume: !!session.started, resumeAt: session.forkAt || null, tempDir: path.join(this.directory, "code", "tmp") });
    const entry = { engine, turn: null, idle: null };
    this.engines.set(task.id, entry);
    engine.on("event", (e) => { try { this.onEvent(task.id, entry, e); } catch (err) { console.warn("Código: " + err.message); } });
    if (process.env.COLMENA_CODE_DEBUG) engine.on("message", (m) => console.log("[code]", task.id, entry.turn ? "t" + entry.turn.n : "-", m.type, m.subtype || "", JSON.stringify(m).slice(0, 300)));
    engine.on("exit", (error) => this.onExit(task.id, entry, error));
    try {
      await engine.start();
    } catch (error) {
      this.engines.delete(task.id);
      if (engine.proc) killTree(engine.proc);
      throw error;
    }
    const now_ = this.mustTask(task.id).session || session;
    if (now_.forkAt || now_.rollback || !now_.started) this.setTask(task.id, { session: { ...now_, started: true, forkAt: null, rollback: 0 } });
    return entry;
  }

  closeEngine(taskId) {
    const entry = this.engines.get(taskId);
    if (!entry) return;
    this.engines.delete(taskId);
    clearTimeout(entry.idle);
    entry.closed = true;
    entry.engine.close();
    // Its dev servers and background shells go with it, before the engine exits on its own
    // and leaves them without a parent (they would keep their port and lock the folder).
    if (entry.engine.proc) killTree(entry.engine.proc);
    const family = this.families.get(taskId);
    this.families.delete(taskId);
    if (family?.size) void stopFamily([...family.values()]).catch(() => {});
  }

  /**
   * Sends a message: starts a turn, waits in the queue, or reaches the running turn now (steer).
   * `mode` «plan» asks for a plan first (nothing changes until the person says «Implementar»).
   * `attachments` are files saved by saveAttachment (absolute paths the engine reads).
   */
  async send(taskId, { text, when = "queue", mode = "build", attachments = [], contexts = [] }) {
    let task = this.mustTask(taskId);
    const message = String(text || "").trim();
    // A preview note's capture must be one Colmena saved (an attachment), like any file.
    const notes = cleanContexts(contexts).map((c) => (c.image && !this.checkAttachments([{ path: c.image }]).length ? { ...c, image: undefined } : c));
    if (!message && !attachments.length && !notes.length) throw Object.assign(Error("Escribe algo para Bruno."), { status: 400 });
    const files = this.checkAttachments(attachments);
    const live = this.engines.get(taskId);
    if (live?.turn || this.starting.has(taskId)) {
      if (when === "steer" && live?.turn) {
        await live.engine.steer(await this.prepare(task, message, files, notes));
        this.addItem(taskId, { kind: "user", text: message, attachments: files.length ? files : undefined, contexts: notes.length ? notes : undefined, steer: true, turn: live.turn.n });
        return { steered: true };
      }
      const queue = [...(task.queue || []), { id: randomUUID().slice(0, 8), text: message, mode, attachments: files, contexts: notes, at: now() }];
      this.setTask(taskId, { queue });
      return { queued: true };
    }
    // A copy cleaned up after «Guardar en …» comes back from its hidden ref to go on.
    if (task.saved) task = await this.recover(taskId);
    // The turn starts in the background (restore point, the engine starting): the answer to
    // the person comes at once and the timeline shows the rest live.
    void this.startTurn(task, message, mode, { attachments: files, contexts: notes });
    return { started: true };
  }

  /** Only files Colmena saved for the composer may be handed to an engine. */
  checkAttachments(list = []) {
    const dir = path.join(this.directory, "code", "attachments").toLowerCase();
    return (Array.isArray(list) ? list : []).slice(0, 20).filter((a) => a && typeof a.path === "string" && path.resolve(a.path).toLowerCase().startsWith(dir + path.sep) && existsSync(a.path))
      .map((a) => ({ path: path.resolve(a.path), name: path.basename(a.path), image: /\.(png|jpe?g|gif|webp)$/i.test(a.path) }));
  }

  /** What the engine gets: the message, the `$skills` it names and where the attachments are. */
  async prepare(task, text, files = [], contexts = []) {
    const { text: withSkills } = await expandSkills(text, task.cwd).catch(() => ({ text }));
    let out = withSkills;
    // Context chips (a terminal excerpt, a comment on a diff line…) go after the words.
    if (contexts.length) out = (out || "Mira esto.") + "\n\n" + contexts.map(contextBlock).join("\n\n");
    if (!files.length) return out;
    return (out || "Mira lo que te adjunto.") + "\n\nArchivos adjuntos (léelos desde estas rutas):\n" + files.map((f) => "- " + f.path + (f.image ? " (imagen)" : "")).join("\n");
  }

  /** «Compactar»: the engine summarizes the conversation so far to free context (T3 Code). */
  async compact(taskId) {
    const task = this.mustTask(taskId);
    if (this.engines.get(taskId)?.turn || this.starting.has(taskId)) throw Object.assign(Error("Bruno está trabajando: compacta cuando acabe."), { status: 409 });
    if (!task.session?.started) throw Object.assign(Error("Aún no hay conversación que compactar."), { status: 409 });
    void this.startTurn(task, "", "build", { compact: true });
    return { started: true };
  }

  async startTurn(task, text, mode = "build", { attachments = [], contexts = [], compact = false, goal = null } = {}) {
    const n = (task.turns || []).length + 1;
    this.starting.add(task.id);
    try {
      // A goal's own turns show as a quiet line, not as a message of the person.
      const user = compact
        ? this.addItem(task.id, { kind: "notice", text: "Compactando la conversación para liberar contexto…", compact: true, turn: n })
        : goal ? this.addItem(task.id, { kind: "notice", text: goal, goal: true, turn: n })
          : this.addItem(task.id, { kind: "user", text, attachments: attachments.length ? attachments : undefined, contexts: contexts.length ? contexts : undefined, turn: n, mode: mode === "plan" ? "plan" : undefined });
      this.setTask(task.id, { status: "working", error: null });
      let startSnap = null;
      try { startSnap = await this.snapsOf(task).capture("t" + n + "-start-" + Date.now()); } catch {}
      let entry;
      try {
        entry = await this.engineFor(this.mustTask(task.id));
      } catch (error) {
        this.addItem(task.id, { kind: "error", text: error.message });
        this.setTask(task.id, { status: "error", error: error.message });
        return;
      }
      clearTimeout(entry.idle);
      entry.turn = { n, mode, compact, startSnap, userItemId: user.id, started: Date.now(), live: "", tools: new Map(), lastAssistant: null };
      try {
        if (compact) await (entry.engine.compact ? entry.engine.compact() : entry.engine.send("/compact", { mode: "build" }));
        else await entry.engine.send(await this.prepare(task, text, attachments, contexts), { mode });
      } catch (error) {
        await this.finishTurn(task.id, entry, error);
        return;
      }
      this.emit({ type: "task", task: this.taskView(this.mustTask(task.id)) });
    } finally {
      this.starting.delete(task.id);
    }
  }

  /** The events of any engine (claude.mjs normalize, codex.mjs notification). */
  onEvent(taskId, entry, e) {
    const turn = entry.turn;
    if (e.type === "session") {
      if (e.id) this.store.patch("codeTasks", taskId, (t) => ({ session: { ...(t.session || {}), id: e.id, started: true } }));
      return;
    }
    if (e.type === "limit") {
      this.setTask(taskId, { limit: { status: e.status, type: e.kind, resetsAt: e.resetsAt, utilization: e.utilization } });
      return;
    }
    if (e.type === "usage") { this.setTask(taskId, { usage: { used: e.used, window: e.window || null, at: now() } }); return; }
    if (!turn) return;
    if (e.type === "child") {
      const row = turn.tools.get(e.parent);
      if (row) this.patchItem(row, { steps: (this.store.get("codeItems", row)?.steps || 0) + 1 });
      return;
    }
    if (e.type === "delta") {
      turn.live += e.text || "";
      this.emit({ type: "delta", task: taskId, text: e.text || "" });
      return;
    }
    if (e.type === "mark") { turn.lastAssistant = e.at; return; }
    if (e.type === "text") {
      this.addItem(taskId, { kind: "text", text: e.text, turn: turn.n });
      turn.live = "";
      this.emit({ type: "delta", task: taskId, reset: true });
      return;
    }
    if (e.type === "plan") {
      turn.plan = true;
      turn.live = "";
      this.emit({ type: "delta", task: taskId, reset: true });
      this.addItem(taskId, { kind: "plan", text: clip(e.text, 40000), status: "open", turn: turn.n });
      return;
    }
    if (e.type === "tool" && !turn.tools.has(e.id)) {
      const line = toolLine(e.name, e.input || {});
      const item = this.addItem(taskId, { kind: "tool", tool: e.name, verb: line.verb, text: line.text, detail: clip(line.detail, 600), status: "running", toolUseId: e.id, turn: turn.n });
      turn.tools.set(e.id, item.id);
      return;
    }
    if (e.type === "toolDone") {
      const row = turn.tools.get(e.id);
      if (!row || this.store.get("codeItems", row)?.status === "denied") return;
      this.patchItem(row, { status: e.error ? "error" : "done", output: clip(e.output, MAX_OUTPUT) });
      return;
    }
    if (e.type === "done") void this.finishTurn(taskId, entry, e.error && !e.interrupted ? Error(e.error) : null, { interrupted: !!e.interrupted, soft: !!e.error });
  }

  async finishTurn(taskId, entry, error = null, { interrupted = false, soft = false } = {}) {
    const turn = entry.turn;
    if (!turn) return;
    entry.turn = null;
    const task = this.mustTask(taskId);
    for (const id of turn.tools.values()) {
      const item = this.store.get("codeItems", id);
      if (item?.status === "running") this.patchItem(id, { status: error && !soft ? "error" : "done" });
    }
    if (turn.live.trim()) this.addItem(taskId, { kind: "text", text: turn.live, turn: turn.n });
    this.emit({ type: "delta", task: taskId, reset: true });
    let endSnap = null, stat = { files: [], add: 0, del: 0 };
    try {
      endSnap = await this.snapsOf(task).capture("t" + turn.n + "-end-" + Date.now());
      stat = await this.snapsOf(task).diff(turn.startSnap, endSnap);
    } catch {}
    const files = stat.files.map((f) => ({ path: f.path, status: f.status, add: f.add, del: f.del }));
    const record = { n: turn.n, mode: turn.mode, userItemId: turn.userItemId, startSnap: turn.startSnap, endSnap, add: stat.add, del: stat.del, files, sessionAt: turn.lastAssistant, durationMs: Date.now() - turn.started };
    if (files.length) this.addItem(taskId, { kind: "turn", n: turn.n, files: files.slice(0, 200), add: stat.add, del: stat.del, endSnap, turn: turn.n });
    void this.remember(taskId, entry);
    const failed = !!error && !turn.stopped && !interrupted;
    if (failed) this.addItem(taskId, { kind: "error", text: clip(error.message || "Bruno no pudo terminar este turno.", 600), turn: turn.n });
    if (turn.stopped) this.addItem(taskId, { kind: "notice", text: "Has parado a Bruno.", turn: turn.n });
    // A plan waits for the person (Implementar · En una tarea nueva · Refinar).
    const next = this.setTask(taskId, { turns: [...(task.turns || []), record], status: failed ? "error" : turn.plan ? "planned" : "idle", error: failed ? "turn" : null });
    entry.idle = setTimeout(() => { if (!entry.turn) this.closeEngine(taskId); }, IDLE_MS);
    entry.idle.unref?.();
    // Conflicts with the base: closed when Bruno left no marks. The preview: looked at after a change.
    if (next.merging && !failed && !turn.stopped) await this.closeMerge(taskId).catch((e) => console.warn("Código: merge abierto: " + e.message));
    if (files.length && !failed && !turn.stopped) void this.checkAfterTurn(taskId, turn.n);
    const goal = turn.compact ? null : this.goalAfter(taskId, turn, { failed, stopped: !!turn.stopped || interrupted });
    // The queue goes on by itself (T3 Code): the next message starts the next turn.
    const [first, ...rest] = next.queue || [];
    if (first && !error) {
      this.setTask(taskId, { queue: rest });
      await this.startTurn(this.mustTask(taskId), first.text, first.mode || "build", { attachments: this.checkAttachments(first.attachments), contexts: cleanContexts(first.contexts) });
      return;
    }
    if (goal?.next) { await this.startTurn(this.mustTask(taskId), goal.next, "build", { goal: goal.line }); return; }
    if (turn.stopped || turn.compact) return;
    // Avisos: the turn ended, Bruno needs the person, or it got stuck.
    const said = [...this.items(taskId)].reverse().find((i) => i.kind === "text" && i.turn === turn.n)?.text || "";
    if (failed) this.notifyTask(taskId, "failed", error.message || "Bruno no pudo terminar este turno.");
    else if (goal?.notice) this.notifyTask(taskId, goal.kind, goal.notice);
    else if (turn.plan) this.notifyTask(taskId, "needs", "Te propone un plan: nada cambia hasta que digas «Implementar».");
    else this.notifyTask(taskId, "done", (files.length ? (files.length === 1 ? "1 archivo cambiado. " : files.length + " archivos cambiados. ") : "") + said.replace(GOAL_MARK, "").slice(0, 200));
  }

  // ------------------------------------------------------------------ goals («/goal»)
  /** «/goal <qué es estar hecho>»: Bruno keeps going turn after turn until he says it is done. */
  async setGoal(taskId, { action = "set", text = "" }) {
    const task = this.mustTask(taskId);
    const goal = task.goal || null;
    if (action === "set") {
      const objective = clip(String(text || "").trim(), 2000);
      if (!objective) throw Object.assign(Error("Di qué es «hecho»: por ejemplo, /goal pasan todos los tests."), { status: 400 });
      // A task started with only its goal takes its name from it.
      const title = !(task.turns || []).length && task.title === "Tarea nueva" ? { title: clip(objective.split(/\r?\n/)[0], 70) } : {};
      this.setTask(taskId, { ...title, goal: { text: objective, status: "active", turns: 0, max: GOAL_TURNS, note: null, at: now() } });
      return this.goalTurn(taskId, "Objetivo: «" + clip(objective, 160) + "»");
    }
    if (!goal) throw Object.assign(Error("Esta tarea no tiene objetivo."), { status: 409 });
    if (action === "clear") { this.setTask(taskId, { goal: null }); this.addItem(taskId, { kind: "notice", text: "Has quitado el objetivo." }); return { ok: true }; }
    if (action === "pause") { this.setTask(taskId, { goal: { ...goal, status: "paused", note: "Lo has pausado." } }); return { ok: true }; }
    if (action === "complete") { this.setTask(taskId, { goal: { ...goal, status: "complete", note: "Lo diste por cumplido." } }); return { ok: true }; }
    if (action === "resume") {
      this.setTask(taskId, { goal: { ...goal, status: "active", turns: 0, note: null } });
      return this.goalTurn(taskId, "Sigues con el objetivo");
    }
    throw Object.assign(Error("Acción de objetivo desconocida."), { status: 400 });
  }

  /** Starts (or queues behind the running turn) the next turn toward the goal. */
  async goalTurn(taskId, line) {
    const task = this.mustTask(taskId);
    const prompt = goalPrompt(task.goal, true);
    if (this.engines.get(taskId)?.turn || this.starting.has(taskId)) return { queued: true }; // the turn that ends picks it up
    void this.startTurn(task.saved ? await this.recover(taskId) : task, prompt, "build", { goal: line });
    return { started: true };
  }

  /** After a turn: Bruno's mark says whether the goal is done, goes on or is blocked. */
  goalAfter(taskId, turn, { failed, stopped }) {
    const task = this.mustTask(taskId);
    const goal = task.goal;
    if (!goal || goal.status !== "active" || turn.mode === "plan") return null;
    // The mark is read from the turn's last answer and taken out of what the person sees.
    const last = [...this.items(taskId)].reverse().find((i) => i.kind === "text" && i.turn === turn.n);
    const m = last ? GOAL_MARK.exec(last.text) : null;
    if (last && m) this.patchItem(last.id, { text: last.text.replace(GOAL_MARK, "").trim() || "…" });
    const set = (changes) => this.setTask(taskId, { goal: { ...goal, ...changes } });
    if (stopped) { set({ status: "paused", note: "Lo paraste." }); return null; }
    if (failed) { set({ status: "paused", note: "El turno falló." }); return null; }
    const said = (m?.[1] || "sigue").toLowerCase();
    if (said === "cumplido") {
      set({ status: "complete", note: null, turns: goal.turns + 1 });
      this.addItem(taskId, { kind: "notice", text: "Objetivo cumplido: «" + clip(goal.text, 120) + "».", tone: "done" });
      return { kind: "done", notice: "Objetivo cumplido: " + goal.text };
    }
    if (said === "bloqueado") {
      const why = clip((m?.[2] || "").trim() || "Necesita algo de ti para seguir.", 300);
      set({ status: "blocked", note: why, turns: goal.turns + 1 });
      this.addItem(taskId, { kind: "notice", text: "Objetivo bloqueado: " + why, tone: "warn" });
      return { kind: "needs", notice: "Objetivo bloqueado: " + why };
    }
    const turns = goal.turns + 1;
    if (turns >= (goal.max || GOAL_TURNS)) {
      set({ status: "limited", note: `Ha dado ${turns} vueltas sin cumplirlo.`, turns });
      this.addItem(taskId, { kind: "notice", text: `Bruno ha parado tras ${turns} vueltas: el objetivo aún no se cumple. Reanúdalo o cámbialo.`, tone: "warn" });
      return { kind: "needs", notice: `Ha dado ${turns} vueltas sin cumplir el objetivo.` };
    }
    set({ turns });
    return { next: goalPrompt({ ...goal, turns }, false), line: `Sigue con el objetivo · vuelta ${turns + 1} de ${goal.max || GOAL_TURNS}` };
  }

  /** «Implementar» / «En una tarea nueva» / «Refinar» on a plan (T3 Code proposed plan). */
  async planAction(taskId, { item: itemId, action, text = "" }) {
    const task = this.mustTask(taskId);
    const plan = this.store.get("codeItems", String(itemId));
    if (!plan || plan.taskId !== taskId || plan.kind !== "plan") throw Object.assign(Error("Plan no encontrado."), { status: 404 });
    const body = "Implementa este plan:\n\n" + plan.text;
    if (action === "refine") {
      if (!String(text).trim()) throw Object.assign(Error("Di qué quieres cambiar del plan."), { status: 400 });
      this.patchItem(plan.id, { status: "refined" });
      return this.send(taskId, { text, mode: "plan" });
    }
    if (action === "new") {
      const created = await this.createTask({ projectId: task.projectId, text: body, engine: task.engine, model: task.model, effort: task.effort, access: task.access, isolated: task.isolated || !!task.worktree });
      this.patchItem(plan.id, { status: "moved", movedTo: created.id });
      return { task: created };
    }
    this.patchItem(plan.id, { status: "implemented" });
    return this.send(taskId, { text: "Implementa el plan que acabas de proponer.", mode: "build" });
  }

  onExit(taskId, entry, error) {
    if (this.engines.get(taskId) === entry) this.engines.delete(taskId);
    clearTimeout(entry.idle);
    for (const [askId, pending] of this.asks) if (pending.taskId === taskId) { pending.resolve({ behavior: "deny", message: DENIED }); this.asks.delete(askId); this.patchItem(askId, { status: "expired" }); }
    if (entry.turn) void this.finishTurn(taskId, entry, error || Error((ENGINE_LABEL[entry.engine.kind] || "El motor") + " se cerró."));
  }

  async stop(taskId) {
    const entry = this.engines.get(taskId);
    if (!entry?.turn) return { ok: true };
    entry.turn.stopped = true;
    for (const [askId, pending] of this.asks) if (pending.taskId === taskId) { pending.resolve({ behavior: "deny", message: "La persona ha parado la tarea." }); this.asks.delete(askId); this.patchItem(askId, { status: "expired" }); }
    const answered = await entry.engine.interrupt();
    if (!answered) this.closeEngine(taskId);
    return { ok: true };
  }

  // ------------------------------------------------------------------ permissions
  async authorize(taskId, { tool, input, toolUseId, signal }) {
    const task = this.mustTask(taskId);
    const project = this.store.get("codeProjects", task.projectId) || { allow: [] };
    const turn = this.engines.get(taskId)?.turn?.n || null;
    if (tool === "AskUserQuestion") {
      const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 4).map((q) => ({
        question: clip(q.question, 400), header: clip(q.header, 40), multiSelect: !!q.multiSelect,
        options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map((o) => ({ label: clip(o.label, 80), description: clip(o.description, 200) })),
      }));
      const answer = await this.waitAsk(taskId, { kind: "ask", ask: "question", tool, title: "Bruno te pregunta", questions, turn, toolUseId }, signal);
      if (answer.behavior !== "allow") return answer;
      return { behavior: "allow", updatedInput: { ...input, answers: answer.answers || {} } };
    }
    // Codex asking to leave its sandbox (more folders, the network) is the person's call.
    const d = tool === "Permissions" ? { decision: "approval", reason: "Codex pide más permisos de los que tiene esta tarea." }
      : decide({ tool, input, access: task.access, cwd: task.cwd, roots: [task.cwd], allowed: project.allow || [] });
    if (d.decision === "allow") return { behavior: "allow" };
    const line = toolLine(tool, input);
    return this.waitAsk(taskId, {
      kind: "ask", ask: d.decision === "redline" ? "redline" : "approval", tool, rule: d.rule || null, durable: !!d.durable,
      title: d.decision === "redline" ? redTitle(d.rule) : askTitle(tool, input), reason: d.reason || "", command: clip(input.command || input.file_path || line.detail || "", 2000), turn, toolUseId,
    }, signal);
  }

  waitAsk(taskId, data, signal) {
    const item = this.addItem(taskId, { ...data, status: "pending" });
    this.setTask(taskId, { status: "waiting" });
    this.emit({ type: "attention", task: taskId });
    this.notifyTask(taskId, "needs", data.ask === "question" ? data.questions?.[0]?.question || "Bruno te pregunta algo." : data.title + (data.command ? ": " + data.command : ""));
    return new Promise((resolve) => {
      const done = (value) => {
        if (!this.asks.has(item.id)) return;
        this.asks.delete(item.id);
        const t = this.store.get("codeTasks", taskId);
        if (t && !this.items(taskId).some((i) => i.kind === "ask" && i.status === "pending")) this.setTask(taskId, { status: this.engines.get(taskId)?.turn ? "working" : "idle" });
        resolve(value);
      };
      this.asks.set(item.id, { taskId, resolve: done });
      signal?.addEventListener("abort", () => { this.patchItem(item.id, { status: "expired" }); done({ behavior: "deny", message: "Cancelado." }); }, { once: true });
    });
  }

  /** The person's answer: allow (once or always in this project), deny, or the chosen options. */
  answer(taskId, askId, { decision, answers }) {
    const item = this.store.get("codeItems", String(askId));
    if (!item || item.taskId !== taskId || item.kind !== "ask") throw Object.assign(Error("Pregunta no encontrada."), { status: 404 });
    const pending = this.asks.get(item.id);
    if (!pending || item.status !== "pending") throw Object.assign(Error("Esa pregunta ya no está abierta."), { status: 409 });
    if (item.ask === "question") {
      const clean = {};
      for (const q of item.questions || []) if (answers && typeof answers[q.question] === "string") clean[q.question] = clip(answers[q.question], 500);
      this.patchItem(item.id, { status: "answered", answers: clean });
      pending.resolve({ behavior: "allow", answers: clean });
      return { ok: true };
    }
    if (decision === "always" && item.durable && item.rule) {
      const project = this.store.get("codeProjects", this.mustTask(taskId).projectId);
      if (project && !(project.allow || []).includes(item.rule)) this.store.put("codeProjects", { ...project, allow: [...(project.allow || []), item.rule], updatedAt: now() });
    }
    const allow = decision === "allow" || decision === "always";
    this.patchItem(item.id, { status: allow ? "allowed" : "denied", always: decision === "always" });
    if (!allow && item.toolUseId) {
      const row = this.items(taskId).find((i) => i.kind === "tool" && i.toolUseId === item.toolUseId);
      if (row) this.patchItem(row.id, { status: "denied" });
    }
    pending.resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: DENIED });
    return { ok: true };
  }

  // ------------------------------------------------------------------ changes and restore points
  async diff(taskId, { turn = null } = {}) {
    const task = this.mustTask(taskId);
    const snaps = this.snapsOf(task);
    if (turn) {
      const t = (task.turns || []).find((x) => x.n === Number(turn));
      if (!t) throw Object.assign(Error("Ese turno no existe."), { status: 404 });
      return { scope: "turn", turn: t.n, ...(await snaps.diff(t.startSnap, t.endSnap)) };
    }
    if (!task.baseSnap) return { scope: "task", files: [], add: 0, del: 0 };
    const current = this.engines.get(taskId)?.turn ? null : await snaps.capture("view-" + Date.now()).catch(() => null);
    const last = current || (task.turns || []).at(-1)?.endSnap || task.baseSnap;
    return { scope: "task", ...(await snaps.diff(task.baseSnap, last)) };
  }

  busy(taskId) {
    if (this.engines.get(taskId)?.turn) throw Object.assign(Error("Bruno está trabajando: páralo antes."), { status: 409 });
  }

  /** «Volver aquí»: the folder as it was right after turn n (n = 0: before the first turn). */
  async restore(taskId, { turn = null, undo = null }) {
    this.busy(taskId);
    if (this.mustTask(taskId).saved) await this.recover(taskId);
    const task = this.mustTask(taskId);
    if (undo) { // «Deshacer» right after a «Volver aquí»: the folder as it was before it
      const notice = this.items(taskId).find((i) => i.kind === "notice" && i.undo === undo);
      if (!notice) throw Object.assign(Error("Ya no se puede deshacer."), { status: 409 });
      await this.snapsOf(task).restore(undo);
      this.patchItem(notice.id, { undo: null });
      this.addItem(taskId, { kind: "notice", text: "Deshecho: la carpeta vuelve a estar como antes." });
      return { ok: true };
    }
    const n = Number(turn);
    const target = n === 0 ? task.baseSnap : (task.turns || []).find((t) => t.n === n)?.endSnap;
    if (!target) throw Object.assign(Error("No hay punto de restauración para ese turno."), { status: 404 });
    const result = await this.snapsOf(task).restore(target);
    this.addItem(taskId, { kind: "notice", text: n === 0 ? "Has vuelto al principio: la carpeta está como antes de la tarea." : `Has vuelto al punto ${n}: la carpeta está como justo después de ese turno.`, undo: result.before });
    return { ok: true, ...result };
  }

  /** «Editar desde aquí»: files back to before that message, the conversation cut there. */
  async editFrom(taskId, { item: itemId }) {
    this.busy(taskId);
    if (this.mustTask(taskId).saved) await this.recover(taskId);
    const task = this.mustTask(taskId);
    const item = this.store.get("codeItems", String(itemId));
    if (!item || item.taskId !== taskId || item.kind !== "user" || item.steer) throw Object.assign(Error("Solo puedes editar desde un mensaje tuyo."), { status: 400 });
    const turns = task.turns || [];
    const idx = turns.findIndex((t) => t.userItemId === item.id);
    if (idx < 0) throw Object.assign(Error("Ese mensaje aún no tiene un turno terminado."), { status: 409 });
    const target = turns[idx].startSnap || (idx === 0 ? task.baseSnap : turns[idx - 1].endSnap);
    if (target) await this.snapsOf(task).restore(target);
    for (const later of this.items(taskId).filter((i) => i.seq >= item.seq)) this.store.remove("codeItems", later.id);
    this.closeEngine(taskId);
    const prev = turns[idx - 1];
    // Claude Code forks the session at the answer before; Codex rolls its thread back.
    const session = task.engine === "codex"
      ? (task.session?.started && idx > 0 ? { ...task.session, rollback: (task.session.rollback || 0) + turns.length - idx } : { id: randomUUID(), started: false, rollback: 0 })
      : prev?.sessionAt ? { ...task.session, started: true, forkAt: prev.sessionAt } : { id: randomUUID(), started: false, forkAt: null };
    this.setTask(taskId, { turns: turns.slice(0, idx), session, status: "idle", queue: [] });
    this.seq.delete(taskId);
    this.emit({ type: "reload", task: taskId });
    return { text: item.text };
  }

  async ports(taskId) {
    const task = this.mustTask(taskId);
    const entry = this.engines.get(taskId);
    const family = [...(this.families.get(taskId)?.keys() || [])];
    return taskPorts({ rootPids: [entry?.engine?.pid, ...this.terminals.pids(taskId), ...family].filter(Boolean), folders: [task.cwd], exclude: this.excludePorts || [] });
  }

  /** Remembers what the engine started (servers outlive the shell that started them). */
  async remember(taskId, entry) {
    if (!entry.engine?.pid) return;
    const found = await descendants([entry.engine.pid]).catch(() => []);
    let family = this.families.get(taskId);
    if (!family) this.families.set(taskId, (family = new Map()));
    for (const p of found) family.set(p.pid, p);
  }

  async deleteTask(taskId) {
    const task = this.mustTask(taskId);
    const hadEngine = this.engines.has(taskId) || this.terminals.pids(taskId).length > 0;
    this.closeEngine(taskId);
    this.closePreview(taskId);
    await this.terminals.closeTask(taskId);
    // Windows keeps a folder while a process still runs in it: give the tree a moment to go.
    if (hadEngine) await new Promise((r) => setTimeout(r, 1500));
    let branchKept = false;
    if (task.isolated && task.worktree && task.repoTop && !task.saved) ({ branchKept } = await removeWorktree({ repo: task.repoTop, dir: task.worktree, branch: task.branch, base: task.baseCommit }).catch(() => ({ branchKept: true })));
    await this.snapsOf(task).drop();
    this.snaps.delete(taskId);
    for (const item of this.items(taskId)) this.store.remove("codeItems", item.id);
    this.store.remove("codeTasks", taskId);
    this.emit({ type: "projects" });
    return { ok: true, branchKept, branch: task.branch };
  }

  // ------------------------------------------------------------------ the preview through Bruno's eyes
  /**
   * Opens the task's web server in Colmena's desktop browser (its «preview» op: console errors,
   * failed loads, visible text, a capture) and reads its elements with refs for «pulsa» and
   * «escribe». The capture is saved for the engine to read; the result is kept as previewCheck.
   */
  async previewCheck(taskId, { path: route = "/", port = null } = {}) {
    const task = this.mustTask(taskId);
    if (!this.computer?.available) throw Object.assign(Error("Mirar la vista previa así solo funciona en Colmena de escritorio."), { status: 409 });
    const ports = await this.ports(taskId);
    const chosen = port ? ports.find((p) => p.port === Number(port)) : ports[0];
    if (!chosen) throw Object.assign(Error(port ? "Ese puerto no es de un servidor de esta tarea." : "No hay ningún servidor de esta tarea en marcha: arráncalo primero."), { status: 409 });
    const url = new URL("/" + String(route || "").replace(/^\/+/, ""), "http://127.0.0.1:" + chosen.port).href;
    const page = await this.computer.call("preview", { missionId: "code:" + taskId, botId: "bruno", botName: this.bot().name, color: "#FF7A1A", url, port: chosen.port, waitMs: 1500 }, { timeout: 70000 });
    return this.previewResult(task, page);
  }

  /** «pulsa», «escribe», «tecla» on the page of the last check (refs from its elements). */
  async previewAct(taskId, { kind, ref = "", text = "" }) {
    const task = this.mustTask(taskId);
    if (!this.computer?.available) throw Object.assign(Error("Mirar la vista previa así solo funciona en Colmena de escritorio."), { status: 409 });
    const keys = { missionId: "code:" + taskId, botId: "bruno" };
    const done = await this.computer.call("act", { ...keys, kind, ref, text }, { timeout: 30000 });
    const shot = await this.computer.call("screenshot", { ...keys, width: 1280, quality: 62 }, { timeout: 20000 }).catch(() => null);
    return this.previewResult(task, { ...done, url: done?.url || shot?.url, title: done?.title || shot?.title, jpegBase64: shot?.jpegBase64, console: done?.console || [] });
  }

  async previewResult(task, page) {
    const keys = { missionId: "code:" + task.id, botId: "bruno" };
    const snap = await this.computer.call("snapshot", { ...keys, mode: "elementos", maxChars: 6000 }, { timeout: 30000 }).catch(() => null);
    const log = Array.isArray(page.console) ? page.console : [];
    const line = (e) => clip(String(e.text || e.message || e).replace(/\s+/g, " "), 300) + (e.url ? " (" + clip(e.url, 120) + ")" : "");
    const errors = log.filter((e) => e.level === "error").map(line).slice(0, 20);
    const warnings = log.filter((e) => e.level === "warning").map(line).slice(0, 10);
    let screenshot = null;
    if (page.jpegBase64) {
      screenshot = path.join(this.directory, "code", "tmp", "vista-" + task.id + ".jpg");
      await mkdir(path.dirname(screenshot), { recursive: true });
      await writeFile(screenshot, Buffer.from(page.jpegBase64, "base64"));
    }
    const check = { url: page.url, errors: errors.length, warnings: warnings.length, loadError: page.loadError || null, first: errors[0] || page.loadError || null, at: now() };
    this.setTask(task.id, { previewCheck: check });
    return { url: page.url, title: page.title || "", loadError: page.loadError || null, errors, warnings, text: clip(page.text || snap?.text || "", 1500), elements: snap?.text ? clip(snap.text, 6000) : "", screenshot };
  }

  /** The desktop browser's page of this task goes with it (and its port stops being allowed). */
  closePreview(taskId) {
    if (!this.computer?.available) return;
    this.computer.call("closeMission", { missionId: "code:" + taskId }).catch(() => {});
    this.computer.call("previewRevoke", { missionId: "code:" + taskId }).catch(() => {});
  }

  /** After a turn that changed files: Bruno looks at the preview, and the timeline says how it went. */
  async checkAfterTurn(taskId, n) {
    if (!this.computer?.available) return;
    const ports = await this.ports(taskId).catch(() => []);
    if (!ports.length) return;
    const item = this.addItem(taskId, { kind: "tool", tool: "Preview", verb: "web", text: "Revisando la vista previa en 127.0.0.1:" + ports[0].port, detail: "", status: "running", turn: n });
    try {
      const r = await this.previewCheck(taskId, { port: ports[0].port });
      const said = r.loadError ? "no cargó" : r.errors.length ? (r.errors.length === 1 ? "1 error" : r.errors.length + " errores") : "0 errores";
      this.patchItem(item.id, { text: "Revisó la vista previa en " + r.url.replace(/^http:\/\//, "").replace(/\/$/, "") + " · " + said, status: r.loadError || r.errors.length ? "error" : "done", output: clip([r.loadError, ...r.errors, ...r.warnings].filter(Boolean).join("\n") || "Consola: sin errores.", MAX_OUTPUT) });
    } catch (error) {
      this.patchItem(item.id, { text: "No se pudo revisar la vista previa", status: "error", output: clip(error.message, 600) });
    }
  }

  // ------------------------------------------------------------------ review before saving (OpenClaw autoreview)
  /**
   * A reviewer without tools reads the task's changes and answers with findings P0–P3
   * (P0 breaks something, P3 is a nit). Kept as a «review» item; each finding can go to Bruno.
   */
  async review(taskId) {
    this.busy(taskId);
    let task = this.mustTask(taskId);
    if (task.saved) task = await this.recover(taskId);
    const d = await this.diff(taskId);
    if (!d.files.length) throw Object.assign(Error("No hay cambios que revisar."), { status: 409 });
    const patch = clip(d.files.map((f) => f.patch || "Binary or empty: " + f.path).join("\n"), 80000);
    const prompt = [
      "You are a careful code reviewer. Review ONLY the changes below for real problems: bugs, crashes, security holes, data loss, broken behaviour, missing error handling, and clear quality issues.",
      "Severity: P0 = breaks the app or loses data, P1 = a real bug the person will hit, P2 = should be fixed, P3 = minor polish. Do not invent problems; an empty list is a good answer.",
      "Reply with JSON only: {\"summary\": string, \"findings\": [{\"severity\": \"P0\"|\"P1\"|\"P2\"|\"P3\", \"title\": string, \"file\": string, \"line\": number|null, \"detail\": string}]}.",
      "Write summary, title and detail in plain Spanish for a non-technical person (detail: what goes wrong and how to fix it, two sentences at most). At most 8 findings, most severe first.",
      "", "Task: " + task.title, "", patch,
    ].join("\n");
    const said = await this.quickText(task, prompt, { model: "claude-sonnet-5-5", timeout: 240000 });
    if (!said) throw Object.assign(Error("No se pudo hacer la revisión: ni Claude Code ni Codex respondieron."), { status: 502 });
    let parsed;
    try { parsed = JSON.parse(String(said).replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch { throw Object.assign(Error("La revisión no vino en el formato esperado. Vuelve a intentarlo."), { status: 502 }); }
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : []).slice(0, 8).map((f) => ({
      severity: /^P[0-3]$/.test(f.severity) ? f.severity : "P2", title: clip(f.title || "Sin título", 160), file: f.file ? clip(f.file, 300) : null,
      line: Number.isFinite(Number(f.line)) && f.line !== null ? Number(f.line) : null, detail: clip(f.detail || "", 800),
    })).sort((a, b) => a.severity.localeCompare(b.severity));
    const turns = (task.turns || []).length;
    const item = this.addItem(taskId, { kind: "review", summary: clip(parsed.summary || "", 600), findings, files: d.files.length, turnsAt: turns });
    this.setTask(taskId, { review: { at: now(), turns, item: item.id, serious: findings.filter((f) => f.severity <= "P1").length, total: findings.length } });
    return { item, findings, serious: findings.filter((f) => f.severity <= "P1").length };
  }

  // ------------------------------------------------------------------ «Ponerse al día» with the base
  /**
   * Brings the base branch's newest commits into the task's copy (OpenClaw managed worktrees:
   * the copy absorbs the base, then saving into it is clean). Conflicts are Bruno's to resolve
   * in his copy; Colmena closes the merge when no conflict marks are left.
   */
  async catchUp(taskId) {
    this.busy(taskId);
    let task = this.mustTask(taskId);
    if (!task.isolated) throw Object.assign(Error("Esta tarea trabaja directamente en tu carpeta."), { status: 409 });
    if (task.merging) throw Object.assign(Error("Bruno aún está resolviendo los conflictos con " + task.base + "."), { status: 409 });
    if (task.saved) task = await this.recover(taskId);
    await this.commit(taskId);
    const base = task.base || "main";
    const behind = Number((await git(["rev-list", "--count", "HEAD.." + base], { cwd: task.cwd })).stdout.trim()) || 0;
    if (!behind) { this.addItem(taskId, { kind: "notice", text: "Ya estaba al día con " + base + "." }); return { upToDate: true }; }
    try {
      await git([...(await identity(task.cwd)), "merge", "--no-edit", "-m", "Merge " + base + " into " + task.branch, base], { cwd: task.cwd });
      this.addItem(taskId, { kind: "notice", text: `Traído lo último de ${base} (${behind === 1 ? "1 cambio" : behind + " cambios"}): sin conflictos.`, tone: "done" });
      return { merged: true, behind };
    } catch (error) {
      const files = (await git(["diff", "--name-only", "--diff-filter=U"], { cwd: task.cwd, ok: [0, 1] }).catch(() => ({ stdout: "" }))).stdout.split(/\r?\n/).filter(Boolean);
      if (!files.length) {
        await git(["merge", "--abort"], { cwd: task.cwd, ok: [0, 128] }).catch(() => {});
        throw Object.assign(Error("No se pudo traer lo último de " + base + ": " + error.message), { status: 409 });
      }
      this.setTask(taskId, { merging: { base, files: files.slice(0, 50), at: now() } });
      const prompt = [
        `Colmena ha traído lo último de ${base} a tu copia y hay conflictos en: ${files.join(", ")}.`,
        "Resuélvelos editando esos archivos: quita las marcas <<<<<<<, ======= y >>>>>>> y deja lo correcto de los dos lados (lo tuyo y lo nuevo de " + base + ").",
        "Después comprueba que todo funciona (tests o build). No hagas commit ni merge: Colmena cierra el merge cuando acabes.",
      ].join("\n");
      void this.startTurn(this.mustTask(taskId), prompt, "build", { goal: `Bruno resuelve los conflictos con ${base}: ${files.slice(0, 3).join(", ")}${files.length > 3 ? "…" : ""}` });
      return { resolving: true, files };
    }
  }

  /** After Bruno's turn on conflicts: closes the merge when no marks are left. */
  async closeMerge(taskId) {
    const task = this.mustTask(taskId);
    if (!task.merging) return null;
    const marked = (await git(["grep", "-l", "-E", "^(<<<<<<<|>>>>>>>)( |$)", "--", ...task.merging.files], { cwd: task.cwd, ok: [0, 1] }).catch(() => ({ stdout: "" }))).stdout.split(/\r?\n/).filter(Boolean);
    if (marked.length) {
      this.addItem(taskId, { kind: "notice", text: "Aún quedan conflictos en " + marked.join(", ") + ". Pídele a Bruno que los termine.", tone: "warn" });
      return { left: marked };
    }
    await git(["add", "-A"], { cwd: task.cwd });
    await git([...(await identity(task.cwd)), "commit", "--no-edit", "-q"], { cwd: task.cwd, ok: [0, 1] });
    this.setTask(taskId, { merging: null });
    this.addItem(taskId, { kind: "notice", text: "Conflictos resueltos: tu copia ya tiene lo último de " + task.merging.base + ". Ya puedes guardar.", tone: "done" });
    return { closed: true };
  }

  // ------------------------------------------------------------------ saving (commit, merge, push, PR)
  /** Commits everything in the task's copy, with a message Bruno writes (or the title). */
  async commit(taskId, { message = null } = {}) {
    this.busy(taskId);
    if (this.mustTask(taskId).saved) await this.recover(taskId);
    const task = this.mustTask(taskId);
    const info = await repoInfo(task.cwd);
    if (!info.repo) throw Object.assign(Error("Esta carpeta no usa Git."), { status: 409 });
    if (!info.dirty) return { committed: false, message: null };
    const text = clip(String(message || "").trim() || (await this.commitMessage(task).catch(() => null)) || task.title, 400);
    await git(["add", "-A"], { cwd: task.cwd });
    await git([...(await identity(task.cwd)), "commit", "-q", "-m", text], { cwd: task.cwd });
    this.addItem(taskId, { kind: "notice", text: "Guardado en la rama " + (task.branch || info.branch) + ": «" + text.split("\n")[0] + "»" });
    return { committed: true, message: text };
  }

  /** «Guardar en main»: commit, then merge the task's branch into the base in the project folder. */
  async merge(taskId) {
    const task = this.mustTask(taskId);
    if (!task.isolated) throw Object.assign(Error("Esta tarea trabaja directamente en tu carpeta."), { status: 409 });
    if (task.saved) throw Object.assign(Error("Ya está guardada en " + (task.base || "main") + "."), { status: 409 });
    if (task.merging) throw Object.assign(Error("Bruno aún está resolviendo los conflictos con " + task.base + ": guarda cuando acabe."), { status: 409 });
    await this.commit(taskId);
    const project = this.mustProject(task.projectId);
    const root = await repoInfo(project.root);
    if (root.branch !== task.base) throw Object.assign(Error(`Tu carpeta está en la rama ${root.branch || "(ninguna)"}, no en ${task.base}. Cámbiala a ${task.base} y vuelve a intentarlo.`), { status: 409 });
    if (root.dirty) throw Object.assign(Error(`Tu carpeta tiene cambios sin guardar en ${task.base}. Guárdalos o descártalos y vuelve a intentarlo.`), { status: 409 });
    // OpenClaw's ancestor check: when the base moved on, the copy takes it in first (Bruno
    // resolves any conflict there), so saving into the base never conflicts.
    const ancestor = await git(["merge-base", "--is-ancestor", task.base, task.branch], { cwd: root.top, ok: [0, 1] });
    if (ancestor.code === 1) {
      const up = await this.catchUp(taskId);
      if (up.resolving) return { resolving: true, files: up.files };
    }
    try {
      await git([...(await identity(root.top)), "merge", "--no-ff", "--no-edit", "-m", `Merge ${task.branch}: ${task.title}`, task.branch], { cwd: root.top });
    } catch (error) {
      await git(["merge", "--abort"], { cwd: root.top, ok: [0, 128] }).catch(() => {});
      throw Object.assign(Error("No se pudo juntar con " + task.base + ": hay cambios que chocan. Pídele a Bruno que traiga lo último de " + task.base + " y lo resuelva."), { status: 409 });
    }
    this.addItem(taskId, { kind: "notice", text: "Guardado en " + task.base + ". Ya está en tu carpeta " + project.root + ".", tone: "done" });
    this.setTask(taskId, { merged: now() });
    // Its copy is no longer needed: cleaned up, its last commit kept 30 days under a hidden ref.
    await this.cleanUpCopy(taskId).catch((e) => console.warn("Código: la copia sigue: " + e.message));
    return { ok: true };
  }

  /** After «Guardar en …»: the copy goes, recoverable for 30 days (OpenClaw managed worktrees). */
  async cleanUpCopy(taskId) {
    const task = this.mustTask(taskId);
    if (!task.isolated || !task.worktree || !task.repoTop || task.saved) return;
    const head = (await git(["rev-parse", "HEAD"], { cwd: task.worktree })).stdout.trim();
    const ref = savedRef(taskId);
    await keepCommit({ repo: task.repoTop, ref, commit: head });
    const busy = this.engines.has(taskId) || this.terminals.pids(taskId).length > 0;
    this.closeEngine(taskId);
    this.closePreview(taskId);
    await this.terminals.closeTask(taskId, { forget: false });
    if (busy) await new Promise((r) => setTimeout(r, 1500)); // Windows keeps a folder while a process runs in it
    await removeWorktree({ repo: task.repoTop, dir: task.worktree, branch: task.branch, base: head });
    const until = new Date(Date.now() + KEEP_SAVED_MS).toISOString();
    this.store.put("codeSaved", { id: taskId, repo: task.repoTop, ref, commit: head, until });
    this.setTask(taskId, { saved: { ref, commit: head, at: now(), until } });
    this.addItem(taskId, { kind: "notice", text: "Copia limpiada. Si vuelves a escribir aquí, Colmena la recupera tal cual (hasta 30 días)." });
  }

  /** Brings a cleaned-up copy back: same folder, same branch, same commit. */
  async recover(taskId) {
    const task = this.mustTask(taskId);
    if (!task.saved) return task;
    if (task.saved.expired) throw Object.assign(Error("Esta copia se limpió hace más de 30 días y ya no se puede recuperar. Empieza una tarea nueva."), { status: 409 });
    await restoreWorktree({ repo: task.repoTop, dir: task.worktree, branch: task.branch, ref: task.saved.ref });
    await copyIncluded({ from: task.repoTop, to: task.worktree }).catch(() => []);
    await dropRef({ repo: task.repoTop, ref: task.saved.ref });
    this.store.remove("codeSaved", taskId);
    this.snaps.delete(taskId);
    this.addItem(taskId, { kind: "notice", text: "Copia recuperada en la rama " + task.branch + "." });
    return this.setTask(taskId, { saved: null, merged: null });
  }

  /** Hidden refs of cleaned-up copies older than 30 days go (their task can no longer recover). */
  async pruneSaved(time = Date.now()) {
    for (const rec of this.store.list("codeSaved")) {
      if (Date.parse(rec.until) > time) continue;
      await dropRef({ repo: rec.repo, ref: rec.ref });
      this.store.remove("codeSaved", rec.id);
      const task = this.store.get("codeTasks", rec.id);
      if (task?.saved) this.setTask(task.id, { saved: { ...task.saved, expired: true } });
    }
  }

  /** «Guardar y subir»: commit, then `git push -u origin <branch>` (the button is the person's OK). */
  async push(taskId) {
    const task = this.mustTask(taskId);
    await this.commit(taskId);
    const branch = task.branch || (await repoInfo(task.cwd)).branch;
    if (!branch) throw Object.assign(Error("No hay una rama que subir."), { status: 409 });
    const origin = await git(["remote", "get-url", "origin"], { cwd: task.cwd, ok: [0, 2, 128] });
    if (!origin.stdout.trim()) throw Object.assign(Error("Este proyecto no está conectado a GitHub (no tiene «origin»). Pídele a Bruno que lo conecte o súbelo tú primero."), { status: 409 });
    try {
      await git(["push", "-u", "origin", "HEAD:refs/heads/" + branch], { cwd: task.cwd, timeout: 300000 });
    } catch (error) {
      const said = String(error.stderr || error.message);
      const why = /could not read Username|Authentication failed|403|denied/i.test(said) ? "GitHub no te reconoce en este ordenador: inicia sesión en Git (por ejemplo, haz un push desde una terminal una vez)."
        : /rejected|non-fast-forward|fetch first/i.test(said) ? "La rama de GitHub tiene cambios que aquí no están. Pídele a Bruno que traiga lo último y lo junte."
        : "No se pudo subir: " + error.message;
      throw Object.assign(Error(why), { status: 409 });
    }
    this.addItem(taskId, { kind: "notice", text: "Subido a GitHub en la rama " + branch + ".", tone: "done" });
    this.setTask(taskId, { pushed: now() });
    return { ok: true, branch, remote: origin.stdout.trim() };
  }

  /** «Guardar, subir y abrir PR»: push, then GitHub's new pull request page, filled in by Bruno. */
  async pullRequest(taskId) {
    const task = this.mustTask(taskId);
    const { branch, remote } = await this.push(taskId);
    const repo = githubRepo(remote);
    if (!repo) throw Object.assign(Error("El PR se abre solo en GitHub y este proyecto está en otro sitio. La rama ya está subida: " + branch + "."), { status: 409 });
    const base_ = task.base || "main";
    const log = (await git(["log", "--format=%s%n%b", (task.baseCommit || base_) + "..HEAD"], { cwd: task.cwd, ok: [0, 128] }).catch(() => ({ stdout: "" }))).stdout;
    const stat = (await git(["diff", "--stat", (task.baseCommit || base_) + "..HEAD"], { cwd: task.cwd, ok: [0, 128] }).catch(() => ({ stdout: "" }))).stdout;
    const said = await this.quickText(task, "Write a GitHub pull request for these changes. Reply with JSON only: {\"title\": string (max 72 chars, imperative, English), \"body\": string (English markdown: what changed and how it was tested, short)}.\n\nTask: " + task.title + "\n\nCommits:\n" + clip(log, 8000) + "\n\nFiles:\n" + clip(stat, 8000)).catch(() => null);
    let title = task.title, body = "";
    try { const j = JSON.parse(String(said || "").replace(/^[^{]*/, "").replace(/[^}]*$/, "")); title = clip(j.title || title, 120); body = clip(j.body || "", 6000); } catch {}
    const url = `https://github.com/${repo}/compare/${encodeURIComponent(base_)}...${encodeURIComponent(branch)}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    this.addItem(taskId, { kind: "notice", text: "PR preparado: revisa el título y la descripción en GitHub y pulsa «Create pull request».", url, tone: "done" });
    return { ok: true, url, title };
  }

  /** One-line commit message from the diff (T3 Code: a quick read-only call to an engine). */
  async commitMessage(task) {
    const stat = (await git(["diff", "HEAD", "--stat"], { cwd: task.cwd })).stdout + (await git(["status", "--porcelain"], { cwd: task.cwd })).stdout;
    const patch = clip((await git(["diff", "HEAD"], { cwd: task.cwd })).stdout, 40000);
    const text = await this.quickText(task, "Write a git commit message (Conventional Commits, English, imperative, max 72 chars subject, optional short body) for these changes. Reply with the message only.\n\nTask: " + task.title + "\n\n" + stat + "\n\n" + patch);
    return text ? text.replace(/^```\w*\n?|```$/g, "").trim() : null;
  }

  /** A short text from Claude Code (Haiku) or, without it, from Codex; null when neither answers. */
  async quickText(task, prompt, { model = "claude-haiku-5-5", timeout = 120000 } = {}) {
    const { cleanEnv, findClaudeCli } = await import("../providers/claude-cli.mjs");
    const run = (command, args, opts = {}) => new Promise((resolve) => {
      const [exe, ...lead] = Array.isArray(command) ? command : [command];
      const child = execFile(exe, [...lead, ...args], { cwd: task.cwd, env: cleanEnv(), windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024, ...opts }, (error, stdout) => resolve(error ? null : String(stdout || "").trim() || null));
      child.stdin.end(prompt);
    });
    const claude = this.command || findClaudeCli();
    if (claude && task.engine !== "codex") {
      const out = await run(claude, ["--print", "--model", model, "--tools", "", "--setting-sources", "", "--no-session-persistence", "--permission-mode", "dontAsk"]);
      if (out) return out;
    }
    if (this.codexCommand) {
      const file = path.join(this.directory, "code", "tmp", "quick-" + randomUUID() + ".txt");
      await mkdir(path.dirname(file), { recursive: true });
      await run(this.codexCommand, ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-c", "mcp_servers={}", "-o", file, "-"]);
      const text = await readFile(file, "utf8").catch(() => null);
      await rm(file, { force: true }).catch(() => {});
      if (text?.trim()) return text.trim();
    }
    if (claude && task.engine === "codex") return run(claude, ["--print", "--model", model, "--tools", "", "--setting-sources", "", "--no-session-persistence", "--permission-mode", "dontAsk"]);
    return null;
  }

  shutdown() {
    for (const id of [...this.engines.keys()]) this.closeEngine(id);
    this.terminals.shutdown();
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
