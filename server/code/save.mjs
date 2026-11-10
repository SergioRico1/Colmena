import { now } from "../store.mjs";
import { repoInfo, removeWorktree, git, copyIncluded, savedRef, keepCommit, dropRef, restoreWorktree } from "./git.mjs";
import { AUTH_FAIL, signInHint } from "./pr.mjs";
import { KEEP_SAVED_MS, githubRepo, clip, identity } from "./shared.mjs";

/** CodeService methods: keeping a task's work — commit, merge into the project, push and pull request, and tidying its copy. */
export class SaveMethods {

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
    void this.checkOverlaps(taskId); // merged: its changes are in the base now, not a copy to collide with
    // Its copy is no longer needed: cleaned up, its last commit kept 30 days under a hidden ref.
    await this.cleanUpCopy(taskId).catch((e) => console.warn("Código: la copia sigue: " + e.message));
    if (this.rulesFor(this.mustTask(taskId)).onSave) await this.archiveTask(taskId, { by: "saved" }).catch(() => null);
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
    const back = this.setTask(taskId, { saved: null, merged: null });
    void this.checkOverlaps(taskId);
    return back;
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

  /**
   * A cheap look at the remote before pushing (git ls-remote, no prompts, 15 s): when it fails
   * because nobody is signed in, a 409 that says how. Any other failure leaves it to the push.
   */
  async checkSignIn(cwd, remote) {
    try {
      await git(["ls-remote", "--heads", "origin"], { cwd, timeout: 15000 });
    } catch (error) {
      if (!AUTH_FAIL.test(String(error.stderr || error.message))) return;
      const why = githubRepo(remote) ? signInHint(await this.ghStatus().catch(() => ({}))) : "El servidor de Git no te reconoce en este ordenador: inicia sesión en Git (por ejemplo, haz un push desde una terminal una vez) y vuelve a intentarlo.";
      throw Object.assign(Error(why), { status: 409, signIn: true });
    }
  }

  /** What the «Más» menu says before you push: gh's sign-in, when it is already known (never waits). */
  githubHint() {
    const known = this.ghCache;
    if ((!known || Date.now() - known.at > 60000) && !this.ghAsking) this.ghAsking = this.ghStatus().catch(() => {}).finally(() => { this.ghAsking = null; }); // for the next look
    return known ? { installed: known.installed, authed: known.authed } : null;
  }

  /** «Guardar y subir»: commit, then `git push -u origin <branch>` (the button is the person's OK). */
  async push(taskId) {
    let task = this.mustTask(taskId);
    if (task.saved) task = await this.recover(taskId);
    const origin = await git(["remote", "get-url", "origin"], { cwd: task.cwd, ok: [0, 2, 128] });
    if (!origin.stdout.trim()) throw Object.assign(Error("Este proyecto no está conectado a GitHub (no tiene «origin»). Pídele a Bruno que lo conecte o súbelo tú primero."), { status: 409 });
    // Signed in? Asked before anything is saved, so it never fails halfway.
    await this.checkSignIn(task.cwd, origin.stdout);
    await this.commit(taskId);
    const branch = task.branch || (await repoInfo(task.cwd)).branch;
    if (!branch) throw Object.assign(Error("No hay una rama que subir."), { status: 409 });
    try {
      await git(["push", "-u", "origin", "HEAD:refs/heads/" + branch], { cwd: task.cwd, timeout: 300000 });
    } catch (error) {
      const said = String(error.stderr || error.message);
      const why = AUTH_FAIL.test(said) ? (githubRepo(origin.stdout) ? signInHint(await this.ghStatus().catch(() => ({}))) : "El servidor de Git no te reconoce en este ordenador: inicia sesión en Git (por ejemplo, haz un push desde una terminal una vez).")
        : /rejected|non-fast-forward|fetch first/i.test(said) ? "La rama de GitHub tiene cambios que aquí no están. Pídele a Bruno que traiga lo último y lo junte."
        : "No se pudo subir: " + error.message;
      throw Object.assign(Error(why), { status: 409 });
    }
    this.addItem(taskId, { kind: "notice", text: "Subido a GitHub en la rama " + branch + ".", tone: "done" });
    this.setTask(taskId, { pushed: now() });
    // Its PR is followed with gh (CI, conflicts, comments) when GitHub is where it went.
    if (githubRepo(origin.stdout)) await this.followPr(taskId, branch).catch(() => {});
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
}
