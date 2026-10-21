// «Deshacer lo que hizo el bot» (T3 Code checkpoints): before a bot changes files in a turn,
// Colmena keeps a restore point of the folders that turn may touch — the mission folder
// (workspaces/<missionId>, its projects included) and the shared folders the bot may write
// to — and another when the turn ends. The difference is what the turn created, edited and
// deleted, and either point can be put back: «Deshacer cambios» (that turn's files) or
// «Volver a este punto» (that turn and every later one).
//
// Each folder gets a hidden Git store of Colmena's own (GIT_DIR under the data folder,
// GIT_WORK_TREE = the folder): it works whether the folder is a repository or not and never
// reads or writes the person's .git. Without Git, a plain copy of the files (content-addressed,
// one copy per distinct content) does the same job. Dependency and build folders are left
// out, as are files over the size limit; a folder that is too big gets no point at all.
// Only files of this computer go back: what went out (mail, events, messages, apps) stays.
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { now } from "./store.mjs";

export const CHECKPOINT_LIMITS = Object.freeze({
  keepTurns: 30, // restore points kept per mission (turns that changed files)
  keepDays: 30, // and never older than this
  maxFileBytes: 25 * 1024 * 1024, // bigger files are not kept
  maxFiles: 10000, // a folder with more files gets no restore point
  maxTotalBytes: 400 * 1024 * 1024, // nor one whose kept files add up to more
});

/** Folders never kept (dependencies, builds, caches, version control). Any depth. */
export const EXCLUDED_DIRS = Object.freeze([
  "node_modules", "dist", "build", ".cache", ".vite", ".next", ".nuxt", ".turbo", ".parcel-cache", ".svelte-kit",
  "coverage", "__pycache__", ".pytest_cache", ".mypy_cache", ".venv", "venv", ".tox", "target", ".gradle",
  ".git", ".hg", ".svn", ".colmena",
]);
// Kept (undoing a deletion empties the mission's trash too) but never listed.
const HIDDEN = /^\.papelera\//;
export const hiddenPath = (rel) => HIDDEN.test(rel);
const EXCLUDED_FILES = Object.freeze(["Thumbs.db", "desktop.ini", ".DS_Store", "~$*", "*.tmp", "*.swp"]);
const EXCLUDED_DIR_SET = new Set(EXCLUDED_DIRS.map((d) => d.toLowerCase()));
const excludedFile = (name) => /^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(name) || name.startsWith("~$") || /\.(tmp|swp)$/i.test(name);

/** Tools that can change files of the mission folder. */
const MISSION_TOOLS = new Set([
  "write_file", "create_deliverable", "create_presentation", "create_document", "create_spreadsheet", "fill_pdf",
  "create_image", "browser_download", "run_command",
]);
const READ_ONLY_PROJECT_TOOLS = new Set(["project_files", "project_preview"]);
export const changesFiles = (name) => MISSION_TOOLS.has(name) || (String(name).startsWith("project_") && !READ_ONLY_PROJECT_TOOLS.has(name));

export const OUTSIDE_NOTE = "Solo vuelven atrás los archivos de este ordenador: lo que salió fuera (correos, eventos, mensajes, cambios en tus apps) no se deshace.";

const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160) || "x";
/** The restore point of a turn: one per step, with an id safe in a URL and in a Git ref. */
export const cpIdOf = (stepId) => "cp-" + safeName(stepId);
const sameDir = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Every file of `root` the restore point keeps (relative paths with «/»), never following
 * links. `big` are files over the size limit, `nested` folders that hold their own repository
 * (left out whole); `tooBig` means the folder is over the count or total size limit.
 */
export async function walkFolder(root, limits = CHECKPOINT_LIMITS) {
  const files = [], big = [], nested = [];
  let total = 0, tooBig = false;
  const visit = async (rel) => {
    if (tooBig) return;
    let entries;
    try { entries = await readdir(rel ? path.join(root, rel) : root, { withFileTypes: true }); } catch { return; }
    if (rel && entries.some((e) => e.name === ".git")) { nested.push(rel); return; }
    for (const e of entries) {
      if (tooBig) return;
      const child = rel ? rel + "/" + e.name : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!EXCLUDED_DIR_SET.has(e.name.toLowerCase())) await visit(child);
        continue;
      }
      if (!e.isFile() || excludedFile(e.name)) continue;
      let info;
      try { info = await lstat(path.join(root, child)); } catch { continue; }
      if (info.size > limits.maxFileBytes) { big.push(child); continue; }
      files.push({ rel: child, size: info.size, mtimeMs: info.mtimeMs });
      total += info.size;
      if (files.length > limits.maxFiles || total > limits.maxTotalBytes) tooBig = true;
    }
  };
  await visit("");
  return { files, big, nested, tooBig, total };
}

// ---------- Hidden Git store ----------

const GIT_CONFIG = [
  ["core.autocrlf", "false"], ["core.safecrlf", "false"], ["core.longpaths", "true"], ["core.quotepath", "false"],
  ["core.fsmonitor", "false"], ["core.filemode", "false"], ["core.symlinks", "false"], ["core.untrackedCache", "false"],
  ["core.ignorecase", process.platform === "win32" ? "true" : "false"], ["gc.auto", "0"], ["maintenance.auto", "false"],
  ["advice.addEmbeddedRepo", "false"], ["safe.directory", "*"], ["index.threads", "true"],
];

function gitEnv(gitDir, workTree) {
  const env = {};
  // Nothing of the person's own Git setup (their repository, hooks, global or system config).
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  Object.assign(env, {
    GIT_DIR: gitDir, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: path.join(gitDir, "colmena-index"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(gitDir, "no-global-config"),
    GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1",
    GIT_AUTHOR_NAME: "Colmena", GIT_AUTHOR_EMAIL: "colmena@localhost", GIT_COMMITTER_NAME: "Colmena", GIT_COMMITTER_EMAIL: "colmena@localhost",
    GIT_CONFIG_COUNT: String(GIT_CONFIG.length),
  });
  GIT_CONFIG.forEach(([k, v], i) => { env["GIT_CONFIG_KEY_" + i] = k; env["GIT_CONFIG_VALUE_" + i] = v; });
  return env;
}

function run(command, args, { cwd, env, input = null, timeout = 120000, ok = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out), stderr = Buffer.concat(err).toString("utf8");
      if (ok.includes(code)) resolve({ stdout, stderr, code });
      else reject(Object.assign(Error("git " + args[0] + ": " + (stderr.trim().split("\n").at(-1) || "código " + code)), { code, stderr }));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? undefined);
  });
}

let gitProbe = null;
/** Whether a usable Git is on this computer (asked once). */
export function gitAvailable(command = "git") {
  gitProbe ||= run(command, ["--version"], { timeout: 10000 }).then((r) => /git version/.test(r.stdout.toString()), () => false);
  return gitProbe;
}

const escapeGlob = (rel) => "/" + rel.replace(/[\\*?[\]!#]/g, (c) => "\\" + c).replace(/ $/, "\\ ");

export class GitBackend {
  constructor(command = "git") {
    this.kind = "git";
    this.command = command;
    this.lastGc = new Map(); // scope key → last «git gc»
  }
  git(scope, args, opts = {}) {
    return run(this.command, args, { cwd: scope.root, env: gitEnv(path.join(scope.dir, "git"), scope.root), ...opts });
  }
  async init(scope) {
    const gitDir = path.join(scope.dir, "git");
    try { await stat(path.join(gitDir, "HEAD")); return; } catch {}
    await mkdir(gitDir, { recursive: true });
    const env = gitEnv(gitDir, scope.root);
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    await run(this.command, ["init", "-q", "--bare"], { cwd: gitDir, env });
    await mkdir(path.join(gitDir, "info"), { recursive: true });
    // Files go in and out byte for byte, whatever .gitattributes the folder has.
    await writeFile(path.join(gitDir, "info", "attributes"), "* -text -eol -filter -ident -diff -merge -working-tree-encoding\n");
  }
  async capture(scope, walk, tag) {
    await this.init(scope);
    const exclude = [
      ...EXCLUDED_DIRS.map((d) => d + "/"), ...EXCLUDED_FILES,
      ...walk.big.map(escapeGlob), ...walk.nested.map((d) => escapeGlob(d) + "/"),
    ];
    await writeFile(path.join(scope.dir, "git", "info", "exclude"), exclude.join("\n") + "\n");
    // The index is kept between points (fast: unchanged files are not read again); files
    // that became excluded (now too big, a new nested repository) leave it first.
    const stale = (await this.git(scope, ["ls-files", "-z", "--cached", "--ignored", "--exclude-standard"])).stdout;
    if (stale.length) await this.git(scope, ["rm", "-q", "-r", "--cached", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"], { input: stale });
    await this.git(scope, ["add", "-A", "--ignore-errors", "--", "."], { ok: [0, 1] });
    const tree = (await this.git(scope, ["write-tree"])).stdout.toString().trim();
    const commit = (await this.git(scope, ["commit-tree", tree, "-m", "colmena " + tag])).stdout.toString().trim();
    if (!/^[0-9a-f]{40,64}$/.test(commit)) throw Error("No se pudo guardar el punto de restauración.");
    await this.git(scope, ["update-ref", "refs/colmena/" + tag, commit]);
    return commit;
  }
  async tag(scope, snap, tag) {
    await this.git(scope, ["update-ref", "refs/colmena/" + tag, snap]);
  }
  async files(scope, snap) {
    await this.init(scope);
    const out = (await this.git(scope, ["ls-tree", "-r", "-z", "--full-tree", snap])).stdout.toString("utf8");
    const map = new Map();
    for (const entry of out.split("\0")) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(entry);
      if (m) map.set(m[2], m[1]);
    }
    return map;
  }
  /** Hash of the files as they are now (null: missing), comparable to files(). */
  async hashNow(scope, rels) {
    await this.init(scope);
    const present = [];
    for (const rel of rels) try { if ((await lstat(path.join(scope.root, rel))).isFile()) present.push(rel); } catch {}
    const map = new Map(rels.map((r) => [r, null]));
    if (!present.length) return map;
    const out = (await this.git(scope, ["hash-object", "--stdin-paths"], { input: present.join("\n") + "\n" })).stdout.toString().trim().split(/\r?\n/);
    present.forEach((rel, i) => map.set(rel, out[i] || null));
    return map;
  }
  async write(scope, snap, rels) {
    if (!rels.length) return;
    await this.git(scope, ["restore", "--source=" + snap, "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], { input: rels.join("\0") + "\0" });
  }
  async drop(scope, tags) {
    if (!tags.length) return;
    await this.init(scope);
    await this.git(scope, ["update-ref", "--stdin"], { input: tags.map((t) => "delete refs/colmena/" + t + "\n").join("") });
    // What no point keeps any more leaves the disk (one store per folder), at most hourly:
    // on a big folder it takes a while and the next turn's point waits for it.
    if (Date.now() - (this.lastGc.get(scope.key) || 0) < 3600000) return;
    this.lastGc.set(scope.key, Date.now());
    await this.git(scope, ["gc", "--quiet", "--prune=now"], { ok: [0, 1, 128] }).catch(() => {});
  }
}

// ---------- Plain copy (no Git on this computer) ----------

export class CopyBackend {
  constructor() {
    this.kind = "copy";
    this.last = new Map(); // scope key → latest manifest (size + time decide whether to read again)
  }
  dirs(scope) {
    const base = path.join(scope.dir, "copy");
    return { base, objects: path.join(base, "objects"), manifests: path.join(base, "manifests") };
  }
  manifestFile(scope, snap) {
    return path.join(this.dirs(scope).manifests, safeName(String(snap).replace(/^copy:/, "")) + ".json");
  }
  async capture(scope, walk, tag) {
    const { objects, manifests } = this.dirs(scope);
    await mkdir(objects, { recursive: true });
    await mkdir(manifests, { recursive: true });
    const before = this.last.get(scope.key)?.files || {};
    const files = {};
    for (const f of walk.files) {
      const known = before[f.rel];
      if (known && known.size === f.size && known.mtimeMs === f.mtimeMs) { files[f.rel] = known; continue; }
      let bytes;
      try { bytes = await readFile(path.join(scope.root, f.rel)); } catch { continue; } // locked or gone: not kept
      const hash = sha256(bytes);
      const object = path.join(objects, hash.slice(0, 2), hash);
      try { await stat(object); } catch {
        await mkdir(path.dirname(object), { recursive: true });
        const tmp = object + "." + randomUUID() + ".tmp";
        await writeFile(tmp, bytes);
        await rename(tmp, object);
      }
      files[f.rel] = { hash, size: f.size, mtimeMs: f.mtimeMs };
    }
    const snap = "copy:" + safeName(tag.replace(/\//g, "__"));
    const manifest = { at: now(), files };
    await writeFile(this.manifestFile(scope, snap), JSON.stringify(manifest));
    this.last.set(scope.key, manifest);
    return snap;
  }
  async tag(scope, snap, tag) {
    await copyFile(this.manifestFile(scope, snap), this.manifestFile(scope, "copy:" + tag.replace(/\//g, "__")));
  }
  async files(scope, snap) {
    const manifest = JSON.parse(await readFile(this.manifestFile(scope, snap), "utf8"));
    return new Map(Object.entries(manifest.files).map(([rel, f]) => [rel, f.hash]));
  }
  async hashNow(scope, rels) {
    const map = new Map();
    for (const rel of rels) {
      try { map.set(rel, sha256(await readFile(path.join(scope.root, rel)))); } catch { map.set(rel, null); }
    }
    return map;
  }
  async write(scope, snap, rels) {
    const files = await this.files(scope, snap);
    for (const rel of rels) {
      const hash = files.get(rel);
      const target = path.join(scope.root, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(this.dirs(scope).objects, hash.slice(0, 2), hash), target);
    }
  }
  async drop(scope, tags) {
    if (!tags.length) return;
    for (const tag of tags) await rm(this.manifestFile(scope, "copy:" + tag.replace(/\//g, "__")), { force: true });
    // Contents no remaining point needs are deleted.
    const { objects, manifests } = this.dirs(scope);
    const keep = new Set();
    for (const name of await readdir(manifests).catch(() => []))
      try { for (const f of Object.values(JSON.parse(await readFile(path.join(manifests, name), "utf8")).files)) keep.add(f.hash); } catch {}
    for (const sub of await readdir(objects).catch(() => []))
      for (const name of await readdir(path.join(objects, sub)).catch(() => []))
        if (!keep.has(name)) await rm(path.join(objects, sub, name), { force: true });
  }
}

// ---------- Restore points per turn ----------

const KIND = "checkpoints";
const label = (kind) => (kind === "mission" ? "la carpeta del chat" : "carpeta");

export class Checkpoints {
  /**
   * @param store Colmena's store (records kind «checkpoints», one per turn that may change files)
   * @param options.directory where the hidden stores live (default <data>/checkpoints)
   * @param options.git true (use Git if there is one), false (always copies) or a Git command
   * @param options.root missionId → mission folder
   */
  constructor(store, { directory = path.join(store.directory, "checkpoints"), git = true, root = (missionId) => path.join(store.directory, "workspaces", missionId), limits = CHECKPOINT_LIMITS } = {}) {
    this.store = store;
    this.directory = path.resolve(directory);
    this.gitOption = git;
    this.rootOf = root;
    this.limits = { ...CHECKPOINT_LIMITS, ...limits };
    this.locks = new Map(); // scope key → tail of its queue (one Git or copy job at a time)
    this.backendPromise = null;
    this.finishing = new Map(); // missionId → the end-of-turn job in progress
  }
  /** finish() in the background, one at a time per mission. */
  finishSoon(missionId) {
    const job = (this.finishing.get(missionId) || Promise.resolve())
      .then(() => this.finish(missionId))
      .catch((error) => console.warn("Colmena: no se pudieron cerrar los puntos de restauración: " + error.message));
    this.finishing.set(missionId, job);
    job.then(() => { if (this.finishing.get(missionId) === job) this.finishing.delete(missionId); });
    return job;
  }
  /** Resolves once the end-of-turn points of a mission are saved. */
  async idle(missionId) {
    while (this.finishing.get(missionId)) await this.finishing.get(missionId);
  }
  backend() {
    this.backendPromise ||= (async () => {
      if (this.gitOption === false) return new CopyBackend();
      const command = typeof this.gitOption === "string" ? this.gitOption : "git";
      return (await gitAvailable(command)) ? new GitBackend(command) : new CopyBackend();
    })();
    return this.backendPromise;
  }
  lock(key, fn) {
    const tail = this.locks.get(key) || Promise.resolve();
    const next = tail.then(fn, fn);
    const settled = next.catch(() => {});
    this.locks.set(key, settled);
    settled.then(() => { if (this.locks.get(key) === settled) this.locks.delete(key); });
    return next;
  }
  scopeOf(entry) {
    return { key: entry.key, kind: entry.kind, root: entry.root, dir: path.join(this.directory, entry.key) };
  }
  /** Folders a tool call may change: the mission's, and a shared folder it may write to. */
  scopesFor({ missionId, botId, tool, args = {} }) {
    if (!changesFiles(tool)) return [];
    const scopes = [{ key: "m-" + safeName(missionId), kind: "mission", root: path.resolve(this.rootOf(missionId)), label: label("mission"), folderId: null }];
    const folderId = typeof args.folderId === "string" && args.folderId && args.folderId !== "mision" ? args.folderId : null;
    if (folderId) {
      const folder = this.store.get("folders", folderId);
      if (folder && folder.access === "escribe" && Array.isArray(folder.botIds) && folder.botIds.includes(botId) && typeof folder.path === "string") {
        const resolved = path.resolve(folder.path);
        scopes.push({ key: "f-" + sha256(process.platform === "win32" ? resolved.toLowerCase() : resolved).slice(0, 16), kind: "folder", root: resolved, label: folder.label || path.basename(resolved), folderId });
      }
    }
    return scopes;
  }
  forStep(stepId) {
    return this.store.get(KIND, cpIdOf(stepId));
  }
  /**
   * Before a tool call that may change files: the restore point of each folder it may touch,
   * once per turn (a turn = one step). Never throws: a failed point is noted, the work goes on.
   */
  async before({ mission, step, botId, tool, args }) {
    const wanted = this.scopesFor({ missionId: mission.id, botId: botId || step.botId, tool, args });
    if (!wanted.length) return null;
    const cpId = cpIdOf(step.id);
    let record = this.store.get(KIND, cpId);
    if (!record)
      record = this.store.put(KIND, { id: cpId, missionId: mission.id, stepId: step.id, botId: botId || step.botId, at: now(), status: "open", scopes: [], changes: [], notified: [] });
    else if (record.status !== "open") record = this.store.patch(KIND, cpId, { status: "open" });
    const missing = wanted.filter((s) => !record.scopes.some((x) => x.key === s.key));
    for (const s of missing) {
      const entry = { ...s, before: null, after: null, skipped: null, bigFiles: 0 };
      try {
        await mkdir(s.root, { recursive: true });
        await this.lock(s.key, async () => {
          const walk = await walkFolder(s.root, this.limits);
          if (walk.tooBig) { entry.skipped = "grande"; return; }
          entry.bigFiles = walk.big.length;
          entry.before = await (await this.backend()).capture(this.scopeOf(s), walk, safeName(mission.id) + "/" + cpId + "/before");
        });
      } catch (error) {
        entry.skipped = "error";
        console.warn("Colmena: no se pudo guardar el punto de restauración de " + s.root + ": " + error.message);
      }
      record = this.store.patch(KIND, cpId, (r) => ({ scopes: [...r.scopes.filter((x) => x.key !== s.key), entry] }));
    }
    return record;
  }
  /**
   * When the mission stops working (done, waiting for you, stopped): the second point of each
   * open turn, and what changed between both. Turns that changed nothing are forgotten.
   */
  async finish(missionId) {
    const open = this.store.where(KIND, "missionId", missionId).filter((r) => r.status === "open");
    if (!open.length) return [];
    const backend = await this.backend();
    const after = new Map(); // scope key → snapshot taken now (shared by the turns that touched it)
    const done = [];
    for (const record of open) {
      const scopes = [];
      const changes = [];
      for (const entry of record.scopes) {
        const next = { ...entry };
        if (entry.before) {
          try {
            const scope = this.scopeOf(entry);
            const tag = safeName(missionId) + "/" + record.id + "/after";
            // One snapshot per folder, kept under every turn's own name (each can be dropped alone).
            if (!after.has(entry.key)) after.set(entry.key, await this.lock(entry.key, async () => backend.capture(scope, await walkFolder(entry.root, this.limits), tag)));
            else await this.lock(entry.key, () => backend.tag(scope, after.get(entry.key), tag));
            next.after = after.get(entry.key);
            for (const c of diffFiles(await backend.files(scope, entry.before), await backend.files(scope, next.after))) changes.push({ scope: entry.key, ...c, ...(hiddenPath(c.path) ? { hidden: true } : {}) });
          } catch (error) {
            next.skipped = "error";
            console.warn("Colmena: no se pudo cerrar el punto de restauración: " + error.message);
          }
        }
        scopes.push(next);
      }
      if (!changes.some((c) => !c.hidden) && !scopes.some((s) => s.skipped)) {
        await this.drop([record]);
        continue;
      }
      done.push(this.store.patch(KIND, record.id, { status: "done", finishedAt: now(), scopes, changes: changes.slice(0, 2000), more: Math.max(0, changes.length - 2000) }));
    }
    await this.prune(missionId);
    return done;
  }
  /** Restore points of a mission, oldest first. */
  list(missionId) {
    return this.store.where(KIND, "missionId", missionId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  /** What the chat shows next to each turn that changed files. */
  views(missionId) {
    return this.list(missionId).filter((r) => r.status === "done").map((r) => view(r));
  }
  /**
   * What a restore would do. mode «turn»: this turn's files back as they were before it;
   * «point»: every file this turn or a later one changed, back as before this turn.
   * Each file says how it was left (created/edited/deleted) and whether it changed again
   * afterwards (by a later turn or by you): those changes are lost too.
   */
  async plan(missionId, cpId, mode = "turn") {
    const all = this.list(missionId).filter((r) => r.status === "done");
    const index = all.findIndex((r) => r.id === cpId);
    if (index < 0) throw Object.assign(Error("Ese punto de restauración ya no existe."), { status: 404 });
    const chosen = mode === "point" ? all.slice(index) : [all[index]];
    const backend = await this.backend();
    const byScope = new Map(); // key → { entry, target snapshot, turns: [{before, after}], paths: Map(rel → change) }
    for (const record of chosen) {
      for (const entry of record.scopes) {
        if (!entry.before || !entry.after) continue;
        if (!byScope.has(entry.key)) byScope.set(entry.key, { entry, target: entry.before, turns: [], paths: new Map() });
        const group = byScope.get(entry.key);
        group.turns.push({ before: entry.before, after: entry.after });
        for (const c of record.changes) if (c.scope === entry.key && !group.paths.has(c.path)) group.paths.set(c.path, c.change);
      }
    }
    const files = [];
    const groups = [];
    for (const group of byScope.values()) {
      const scope = this.scopeOf(group.entry);
      const cache = new Map();
      const filesOf = async (snap) => { if (!cache.has(snap)) cache.set(snap, await backend.files(scope, snap)); return cache.get(snap); };
      const target = await filesOf(group.target);
      // What changed outside the chosen turns (you, or a turn not being undone) is lost too:
      // between one turn's end and the next one's start, and after the last one.
      const gaps = [];
      for (let k = 0; k + 1 < group.turns.length; k++) gaps.push([await filesOf(group.turns[k].after), await filesOf(group.turns[k + 1].before)]);
      for (const t of group.turns) { await filesOf(t.before); await filesOf(t.after); }
      const rels = [...group.paths.keys()];
      const current = await backend.hashNow(scope, rels);
      const write = [], remove = [];
      for (const rel of rels) {
        const was = target.get(rel) ?? null;
        const nowHash = current.get(rel) ?? null;
        if (was === nowHash) continue; // already as it was
        // Now it is as one of these turns started or left it (an earlier undo of a later turn
        // included), or something else changed it since.
        const known = new Set([...group.turns.flatMap((t) => [t.before, t.after]).map((snap) => cache.get(snap)?.get(rel) ?? null)]);
        const later = !known.has(nowHash) || gaps.some(([a, b]) => (a.get(rel) ?? null) !== (b.get(rel) ?? null));
        // The change as it stands since the point (what undoing it does), not what one turn did.
        const change = !was ? "created" : !nowHash ? "deleted" : "edited";
        files.push({ path: rel, change, folder: group.entry.kind === "mission" ? null : group.entry.label, later, ...(hiddenPath(rel) ? { hidden: true } : {}) });
        if (was) write.push(rel); else remove.push(rel);
      }
      groups.push({ scope, target: group.target, write, remove, entry: group.entry });
    }
    const skipped = chosen.flatMap((r) => r.scopes.filter((s) => s.skipped).map((s) => ({ folder: s.kind === "mission" ? null : s.label, reason: s.skipped })));
    return { mode, records: chosen, files, groups, skipped };
  }
  /**
   * Puts the files back. `busy(record) → string|null` says why it cannot happen now
   * (the bot is working there): nothing is touched then.
   */
  async restore(missionId, cpId, mode = "turn", { busy = () => null } = {}) {
    const plan = await this.plan(missionId, cpId, mode);
    const reason = busy(plan);
    if (reason) throw Object.assign(Error(reason), { status: 409 });
    const backend = await this.backend();
    const failed = [];
    const restored = [];
    for (const g of plan.groups) {
      await this.lock(g.entry.key, async () => {
        try {
          await backend.write(g.scope, g.target, g.write);
          restored.push(...g.write.map((rel) => ({ scope: g.entry.key, path: rel })));
        } catch (error) {
          failed.push(...g.write.map((rel) => ({ path: rel, error: error.message })));
        }
        for (const rel of g.remove) {
          try {
            await rm(path.join(g.scope.root, rel), { force: true });
            restored.push({ scope: g.entry.key, path: rel, removed: true });
            await pruneEmptyDirs(g.scope.root, path.dirname(rel));
          } catch (error) { failed.push({ path: rel, error: error.message }); }
        }
      });
    }
    const at = now();
    for (const r of plan.records) this.store.patch(KIND, r.id, { restoredAt: at, restoredMode: mode, restoredFrom: cpId });
    // What the bots are told in their next turn: how the files stand now.
    this.store.patch(KIND, cpId, (r) => ({ restores: [...(r.restores || []), { at, mode, files: plan.files.filter((f) => !f.hidden).map((f) => ({ path: f.path, change: f.change, folder: f.folder })) }], notified: [] }));
    return { mode, files: plan.files, failed, restoredAt: at, records: plan.records.map((r) => r.id) };
  }
  /** Restores this bot has not been told about yet (its next turn reads them once). */
  takeNotice(missionId, botId) {
    const pending = this.list(missionId).filter((r) => r.restores?.length && !(r.notified || []).includes(botId));
    for (const r of pending) this.store.patch(KIND, r.id, (cur) => ({ notified: [...(cur.notified || []), botId] }));
    return pending.length ? pending.flatMap((r) => r.restores).sort((a, b) => String(a.at).localeCompare(String(b.at))) : null;
  }
  /** Keeps the last N turns with changes per mission, none older than the day limit. */
  async prune(missionId) {
    const done = this.list(missionId).filter((r) => r.status === "done");
    const cutoff = Date.now() - this.limits.keepDays * 86400000;
    const old = done.filter((r, i) => i < done.length - this.limits.keepTurns || Date.parse(r.at) < cutoff);
    if (old.length) await this.drop(old);
    return old.length;
  }
  async drop(records) {
    const backend = await this.backend();
    const tags = new Map(); // scope key → [tags]
    for (const r of records) {
      for (const s of r.scopes || []) {
        const list = tags.get(s.key) || { entry: s, tags: [] };
        for (const which of ["before", "after"]) list.tags.push(safeName(r.missionId) + "/" + r.id + "/" + which);
        tags.set(s.key, list);
      }
      this.store.remove(KIND, r.id);
    }
    for (const { entry, tags: list } of tags.values())
      await this.lock(entry.key, () => backend.drop(this.scopeOf(entry), list)).catch(() => {});
  }
  /** Deleting a mission: its points and its folder's hidden store go with it. */
  async purgeMission(missionId) {
    const records = this.list(missionId);
    const shared = records.filter((r) => r.scopes?.some((s) => s.kind === "folder"));
    // Shared folders keep their store for other chats: only this mission's points leave it.
    if (shared.length) await this.drop(shared.map((r) => ({ ...r, scopes: r.scopes.filter((s) => s.kind === "folder") })));
    for (const r of records) this.store.remove(KIND, r.id);
    const key = "m-" + safeName(missionId);
    await this.lock(key, () => rm(path.join(this.directory, key), { recursive: true, force: true })).catch(() => {});
  }
}

/** Created, edited and deleted paths between two lists of {path → content hash}. */
export function diffFiles(before, after) {
  const out = [];
  for (const [rel, hash] of after) {
    if (!before.has(rel)) out.push({ path: rel, change: "created" });
    else if (before.get(rel) !== hash) out.push({ path: rel, change: "edited" });
  }
  for (const rel of before.keys()) if (!after.has(rel)) out.push({ path: rel, change: "deleted" });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function pruneEmptyDirs(root, rel) {
  let dir = rel;
  while (dir && dir !== "." && dir !== "/") {
    try { await rmdir(path.join(root, dir)); } catch { return; }
    dir = path.posix.dirname(dir);
  }
}

function view(r) {
  const shown = r.changes.filter((c) => !c.hidden);
  const count = (change) => shown.filter((c) => c.change === change).length;
  return {
    id: r.id, stepId: r.stepId, botId: r.botId, at: r.at, finishedAt: r.finishedAt || null,
    created: count("created"), edited: count("edited"), deleted: count("deleted"), total: shown.length + (r.more || 0),
    folders: [...new Set(r.scopes.filter((s) => s.kind === "folder" && s.before).map((s) => s.label))],
    skipped: r.scopes.some((s) => s.skipped) ? r.scopes.filter((s) => s.skipped).map((s) => (s.kind === "mission" ? "la carpeta del chat" : s.label)) : [],
    restoredAt: r.restoredAt || null, restoredMode: r.restoredMode || null,
  };
}

export const changeLabel = { created: "creado", edited: "editado", deleted: "borrado" };
const UNDONE = { created: "ya no está", edited: "vuelve a una versión anterior", deleted: "vuelve a estar" };

/** The line the thread gets, and the note the bot reads in its next turn. */
export function restoreLine(result, botName, at = null) {
  const failed = new Set(result.failed.map((f) => f.path));
  const n = result.files.filter((f) => !f.hidden && !failed.has(f.path)).length;
  const files = n === 1 ? "1 archivo" : n + " archivos";
  // Which answer: the line lands at the end of the thread, far from it.
  const when = at ? " de las " + new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
  const head = result.mode === "point"
    ? "Has vuelto los archivos a como estaban antes de la respuesta de " + botName + when + " (" + files + ")."
    : "Has deshecho los cambios de " + botName + " en " + files + (when ? " (su respuesta" + when + ")" : "") + ".";
  return head + (result.failed.length ? " " + result.failed.length + " no se pudieron restaurar (¿abiertos en otro programa?)." : "");
}

/** The note a bot reads in its next turn: each file as it stands after the latest restore. */
export function restoreNotice(restores) {
  const files = new Map(); // path → { change, folder }: the latest restore wins
  for (const r of restores) for (const f of r.files || []) files.set((f.folder || "") + "/" + f.path, f);
  const list = [...files.values()];
  const shown = list.slice(0, 15).map((f) => "«" + f.path + "»" + (f.folder ? " en «" + f.folder + "»" : "") + " (" + UNDONE[f.change] + ")");
  return "Aviso de Colmena: la persona ha deshecho cambios de archivos de esta conversación" + (restores.some((r) => r.mode === "point") ? " (volvió a un punto anterior)" : "") +
    ". Ahora están así: " + shown.join(", ") + (list.length > 15 ? " y " + (list.length - 15) + " más" : "") +
    ". Si vas a tocarlos, léelos antes; no rehagas esos cambios salvo que te lo pida.";
}
