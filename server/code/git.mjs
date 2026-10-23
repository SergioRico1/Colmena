// Git for «Código»: the person's repository (worktrees, branch, commit) through their own Git,
// and restore points of each turn in a hidden Git store of Colmena's own (server/checkpoints.mjs
// GitBackend: GIT_DIR under the data folder, work tree = the task folder), so turns can be
// compared and put back whether the folder is a repository or not, without ever touching the
// person's .git (T3 Code keeps them as hidden commits under private refs; same idea).
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { copyFile, mkdir, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { GitBackend, walkFolder, CHECKPOINT_LIMITS } from "../checkpoints.mjs";

/** The person's Git, without inherited GIT_* overrides and never prompting. */
export function git(args, { cwd, input = null, timeout = 120000, ok = [0] } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GCM_INTERACTIVE: "never" });
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8"), stderr = Buffer.concat(err).toString("utf8");
      if (ok.includes(code)) resolve({ stdout, stderr, code });
      else reject(Object.assign(Error((stderr.trim().split("\n").at(-1) || "git " + args[0] + " falló (" + code + ")").replace(/^(fatal|error): /, "")), { code, stderr }));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? undefined);
  });
}

/** What kind of folder this is: {repo, top, branch, head, dirty}. */
export async function repoInfo(folder) {
  try {
    const top = (await git(["rev-parse", "--show-toplevel"], { cwd: folder, timeout: 15000 })).stdout.trim();
    const head = (await git(["rev-parse", "--verify", "-q", "HEAD"], { cwd: folder, timeout: 15000, ok: [0, 1] })).stdout.trim() || null;
    const branch = head ? (await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: folder, timeout: 15000 })).stdout.trim() : null;
    const dirty = !!(await git(["status", "--porcelain", "--untracked-files=normal"], { cwd: folder, timeout: 30000 })).stdout.trim();
    return { repo: true, top: path.resolve(top), branch: branch === "HEAD" ? null : branch, head, dirty };
  } catch {
    return { repo: false, top: null, branch: null, head: null, dirty: false };
  }
}

export const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tarea";

/** A task's own copy: `git worktree add -b <branch> <dir> <base>` (T3 Code / OpenClaw). */
export async function addWorktree({ repo, dir, branch, base }) {
  await mkdir(path.dirname(dir), { recursive: true });
  await git(["worktree", "add", "-b", branch, "--", dir, base], { cwd: repo, timeout: 300000 });
}

/**
 * Deletes a task's copy without ever touching what its links point to (T3 Code worktreeRemoval).
 * Git for Windows before 2.54 follows NTFS junctions in `git worktree remove` and deletes what
 * they point to (a shared node_modules of pnpm, a linked folder). On Windows Git never deletes
 * the files here: Colmena checks it is a registered, unlocked worktree of `repo`, deletes the
 * folder with Node's `rm` (which unlinks junctions without following them), then lets Git drop
 * the missing worktree's metadata. Elsewhere Git only unlinks links, so it runs as before.
 */
export async function removeLinkedWorktree({ repo, dir, platform = process.platform }) {
  const gitFile = path.join(dir, ".git");
  let linked = false;
  try { linked = platform === "win32" && statSync(gitFile).isFile(); } catch {}
  if (!linked) {
    if (existsSync(dir)) await git(["-c", "status.showUntrackedFiles=normal", "worktree", "remove", "--force", "--", dir], { cwd: repo, ok: [0, 128] });
    await git(["worktree", "prune"], { cwd: repo, ok: [0, 128] }).catch(() => {});
    return { removed: !existsSync(dir), byGit: true };
  }
  const real = (p) => { try { return realpathSync.native(p).toLowerCase(); } catch { return null; } };
  const refuse = (why) => Object.assign(Error(`No se borra la copia ${dir}: ${why}`), { status: 409 });
  // A worktree of this repository: its .git file names an admin folder under the common
  // worktrees/, whose gitdir points back to this .git file.
  const adminDir = path.resolve(dir, (await git(["rev-parse", "--absolute-git-dir"], { cwd: dir }).catch(() => { throw refuse("no es una copia de Git"); })).stdout.trim());
  const commonDir = path.resolve(repo, (await git(["rev-parse", "--git-common-dir"], { cwd: repo })).stdout.trim());
  let back = null;
  try { back = path.resolve(adminDir, readFileSync(path.join(adminDir, "gitdir"), "utf8").trim()); } catch {}
  if (!back || real(back) !== real(gitFile) || real(path.dirname(adminDir)) !== real(path.join(commonDir, "worktrees"))) throw refuse("no es una copia de este proyecto");
  if (existsSync(path.join(adminDir, "locked"))) throw refuse("está bloqueada (git worktree lock)");
  // A file held open can stop the delete halfway: putting .git back leaves a copy a retry can remove.
  const contents = readFileSync(gitFile, "utf8");
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  } catch (error) {
    await writeFile(gitFile, contents).catch(() => {});
    throw refuse("no se pudo borrar (" + error.message + ")");
  }
  await git(["worktree", "remove", "--force", "--force", "--", dir], { cwd: repo, ok: [0, 128] }).catch(() => {});
  await git(["worktree", "prune"], { cwd: repo, ok: [0, 128] }).catch(() => {});
  return { removed: !existsSync(dir), byGit: false };
}

/** Removes the copy; the branch stays unless it has nothing beyond its base. */
export async function removeWorktree({ repo, dir, branch, base }) {
  await removeLinkedWorktree({ repo, dir }).catch(() => {});
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
  await rmdir(path.dirname(dir)).catch(() => {}); // the project's folder of copies, once empty
  await git(["worktree", "prune"], { cwd: repo, ok: [0, 128] }).catch(() => {});
  if (!branch || !base) return { branchKept: !!branch };
  const ahead = await git(["rev-list", "--count", base + ".." + branch], { cwd: repo, ok: [0, 128] }).catch(() => null);
  if (ahead && Number(ahead.stdout.trim()) === 0) {
    await git(["branch", "-D", branch], { cwd: repo, ok: [0, 1] }).catch(() => {});
    return { branchKept: false };
  }
  return { branchKept: true };
}

/**
 * `.worktreeinclude` (Claude Code / OpenClaw): ignored files of the project a new copy needs to
 * start, like `.env`. Only files Git ignores are copied (tracked ones are in the copy already),
 * up to 400 files and 50 MB. Returns the copied paths.
 */
export async function copyIncluded({ from, to, maxFiles = 400, maxBytes = 50 * 1024 * 1024 }) {
  const list = path.join(from, ".worktreeinclude");
  if (!existsSync(list)) return [];
  const listed = (await git(["ls-files", "-z", "--others", "--ignored", "--exclude-from=" + list], { cwd: from, ok: [0, 128] }).catch(() => ({ stdout: "" }))).stdout.split("\0").filter(Boolean);
  if (!listed.length) return [];
  const ignored = (await git(["check-ignore", "-z", "--stdin"], { cwd: from, input: listed.join("\0") + "\0", ok: [0, 1, 128] }).catch(() => ({ stdout: "" }))).stdout.split("\0").filter(Boolean);
  const copied = [];
  let bytes = 0;
  for (const rel of ignored.slice(0, maxFiles)) {
    const src = path.join(from, rel);
    try {
      const size = statSync(src).size;
      if (bytes + size > maxBytes) break;
      await mkdir(path.dirname(path.join(to, rel)), { recursive: true });
      await copyFile(src, path.join(to, rel));
      bytes += size;
      copied.push(rel.replace(/\\/g, "/"));
    } catch {}
  }
  return copied;
}

/** A hidden ref that keeps a saved copy's last commit (OpenClaw managed-worktree snapshot). */
export const savedRef = (taskId) => "refs/colmena/saved/" + taskId;
export async function keepCommit({ repo, ref, commit }) {
  await git(["update-ref", ref, commit], { cwd: repo });
}
export async function dropRef({ repo, ref }) {
  await git(["update-ref", "-d", ref], { cwd: repo, ok: [0, 1, 128] }).catch(() => {});
}
/** Brings a cleaned-up copy back from its hidden ref (its branch again, from the same commit). */
export async function restoreWorktree({ repo, dir, branch, ref }) {
  await mkdir(path.dirname(dir), { recursive: true });
  const exists = (await git(["rev-parse", "--verify", "-q", "refs/heads/" + branch], { cwd: repo, ok: [0, 1] })).stdout.trim();
  await git(exists ? ["worktree", "add", "--", dir, branch] : ["worktree", "add", "-b", branch, "--", dir, ref], { cwd: repo, timeout: 300000 });
}

// ------------------------------------------------------------------ restore points
const CODE_LIMITS = Object.freeze({ ...CHECKPOINT_LIMITS, maxFiles: 60000, maxTotalBytes: 1500 * 1024 * 1024 });
const MAX_PATCH = 3 * 1024 * 1024;

/** Restore points of one task folder (one hidden store per task). */
export class Snapshots {
  constructor({ dir, root, key }) {
    this.scope = { key, dir, root };
    this.backend = new GitBackend();
    this.ready = null;
  }
  async init() {
    this.ready ||= (async () => {
      await this.backend.init(this.scope);
      // Like the chat's restore points, byte for byte, but text files keep their diffs here.
      await writeFile(path.join(this.scope.dir, "git", "info", "attributes"), "* -text -eol -filter -ident -working-tree-encoding\n");
    })();
    return this.ready;
  }
  g(args, opts) { return this.backend.git(this.scope, args, opts); }
  /** Keeps the folder as it is now; returns the point's id (a commit of the hidden store). */
  async capture(tag) {
    await this.init();
    const walk = await walkFolder(this.scope.root, CODE_LIMITS);
    if (walk.tooBig) throw Error("La carpeta es demasiado grande para guardar puntos de restauración.");
    return this.backend.capture(this.scope, walk, tag);
  }
  /** Files changed from point `a` to point `b`: [{path, from, status, add, del, binary, patch}]. */
  async diff(a, b) {
    await this.init();
    if (!a || !b || a === b) return { files: [], add: 0, del: 0, truncated: false };
    const num = (await this.g(["diff", "--numstat", "-z", "-M", "--no-ext-diff", a, b])).stdout.toString("utf8");
    const status = (await this.g(["diff", "--name-status", "-z", "-M", "--no-ext-diff", a, b])).stdout.toString("utf8");
    const files = parseNumstat(num);
    const kinds = parseNameStatus(status);
    for (const f of files) f.status = kinds.get(f.path) || "M";
    let patch = (await this.g(["diff", "--patch", "-M", "--no-color", "--no-ext-diff", "--unified=3", a, b])).stdout;
    const truncated = patch.length > MAX_PATCH;
    if (truncated) patch = patch.subarray(0, MAX_PATCH);
    const chunks = splitPatch(patch.toString("utf8"));
    for (const f of files) f.patch = chunks.get(f.path) || "";
    return { files, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0), truncated };
  }
  /** Puts the folder back as it was at point `target`; files made later are removed. */
  async restore(target) {
    await this.init();
    const now = await this.capture("restore-" + Date.now());
    const [want, have] = [await this.backend.files(this.scope, target), await this.backend.files(this.scope, now)];
    const write = [...want].filter(([rel, hash]) => have.get(rel) !== hash).map(([rel]) => rel);
    const gone = [...have.keys()].filter((rel) => !want.has(rel));
    await this.backend.write(this.scope, target, write);
    for (const rel of gone) await unlink(path.join(this.scope.root, rel)).catch(() => {});
    return { written: write.length, removed: gone.length, before: now };
  }
  /** Puts only `rels` back as they were at point `target` (a file new since then is removed). */
  async restoreFiles(target, rels) {
    await this.init();
    const want = await this.backend.files(this.scope, target);
    const key = (rel) => String(rel).replace(/\\/g, "/");
    const back = rels.map(key).filter((rel) => want.has(rel));
    await this.backend.write(this.scope, target, back);
    for (const rel of rels.map(key).filter((r) => !want.has(r))) await unlink(path.join(this.scope.root, rel)).catch(() => {});
    return { written: back.length, removed: rels.length - back.length };
  }
  async drop() {
    await rm(this.scope.dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function parseNumstat(text) {
  const out = [];
  const parts = text.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    let file = m[3], from = null;
    if (file === "") { from = parts[++i]; file = parts[++i]; } // rename: «add\tdel\t» then from, to
    const binary = m[1] === "-";
    out.push({ path: file, from, add: binary ? 0 : Number(m[1]), del: binary ? 0 : Number(m[2]), binary });
  }
  return out;
}

export function parseNameStatus(text) {
  const map = new Map();
  const parts = text.split("\0").filter((p) => p !== "");
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i][0];
    if (code === "R" || code === "C") { i++; map.set(parts[++i], code); }
    else map.set(parts[++i], code);
  }
  return map;
}

/** «diff --git a/x b/y» sections keyed by the new path. */
export function splitPatch(patch) {
  const map = new Map();
  const sections = patch.split(/^(?=diff --git )/m);
  for (const s of sections) {
    if (!s.startsWith("diff --git ")) continue;
    const plus = /^\+\+\+ b\/(.*)$/m.exec(s)?.[1];
    const head = /^diff --git a\/(.*?) b\/(.*)$/m.exec(s);
    const key = plus && plus !== "/dev/null" ? plus : head?.[2] || head?.[1];
    if (key) map.set(key.replace(/\t$/, ""), s);
  }
  return map;
}
