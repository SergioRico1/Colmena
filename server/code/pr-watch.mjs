import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { now } from "../store.mjs";
import { BOT_ROUNDS, botName, mergeRefusal, prRepo, reviewPayload, rightLines, sortFeedback } from "./pr.mjs";
import { PR_POLL_MS, clip, whichCommand, runCmd, lastLine, ghMessage, BOT_ADVICE } from "./shared.mjs";

/** CodeService methods: the pull request of a task on GitHub — following it (checks, reviews, comments) and acting on it. */
export class PrWatchMethods {

  // ------------------------------------------------------------------ following the pull request (gh)
  /** GitHub CLI of this computer: {installed, authed} (asked once a minute at most). */
  async ghStatus() {
    if (this.ghCache && Date.now() - this.ghCache.at < 60000) return this.ghCache;
    const cmd = this.ghCommand === undefined ? ((await whichCommand("gh")) ? ["gh"] : null) : this.ghCommand;
    let authed = false;
    if (cmd) authed = (await runCmd(cmd, ["auth", "status"], { timeout: 20000 })).ok;
    this.ghCache = { installed: !!cmd, authed, cmd, at: Date.now() };
    return this.ghCache;
  }

  /** After «subir»: Colmena follows the branch's PR, or says how to let it. */
  async followPr(taskId, branch) {
    const gh = await this.ghStatus();
    if (!gh.installed || !gh.authed) {
      this.addItem(taskId, { kind: "notice", text: gh.installed ? "Para que Bruno siga la PR (CI, conflictos y comentarios), inicia sesión una vez con «gh auth login» en una terminal." : "Para que Bruno siga la PR (CI, conflictos y comentarios), instala GitHub CLI (gh) e inicia sesión con «gh auth login»." });
      return false;
    }
    const task = this.mustTask(taskId);
    this.setTask(taskId, { pr: { ...(task.pr || {}), branch, watching: true, since: task.pr?.since || now(), seen: task.pr?.seen || [] } });
    this.startPrWatch();
    return true;
  }

  startPrWatch(ms = PR_POLL_MS) {
    if (this.prTimer) return;
    this.prTimer = setInterval(() => { void this.checkPrs().catch((e) => console.warn("Código: PR: " + e.message)); }, ms);
    this.prTimer.unref?.();
  }

  /** One round over the followed PRs: merged or closed, failing CI, conflicts, new comments. */
  async checkPrs() {
    const tasks = this.store.list("codeTasks").filter((t) => t.pr?.watching);
    if (!tasks.length) { clearInterval(this.prTimer); this.prTimer = null; return; }
    const gh = await this.ghStatus();
    if (!gh.authed) return;
    for (const t of tasks) await this.checkPr(t.id, gh.cmd).catch((e) => console.warn("Código: PR " + t.id + ": " + e.message));
  }

  async checkPr(taskId, cmd) {
    const task = this.mustTask(taskId);
    const cwd = this.prCwd(task);
    const r = await runCmd(cmd, ["pr", "view", task.pr.branch, "--json", "number,url,state,mergeable,headRefOid,isDraft,reviewDecision,statusCheckRollup,comments,reviews"], { cwd, timeout: 60000 });
    if (!r.ok) return null; // no PR for this branch yet
    const pr = JSON.parse(r.stdout);
    const checks = (pr.statusCheckRollup || []).map((c) => ({ name: c.name || c.context || "check", state: String(c.conclusion || c.state || c.status || "").toUpperCase(), url: c.detailsUrl || c.targetUrl || "" }));
    const failing = checks.filter((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(c.state));
    const pending = checks.some((c) => ["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING"].includes(c.state));
    const view = {
      number: pr.number, url: pr.url, state: pr.state, mergeable: pr.mergeable, headRefOid: pr.headRefOid || null, isDraft: !!pr.isDraft, reviewDecision: pr.reviewDecision || null,
      checks: failing.length ? "failing" : pending ? "pending" : checks.length ? "passing" : "none",
    };
    const prev = task.pr;
    const seen = new Set(prev.seen || []);
    const since = Date.parse(prev.since || 0);
    const said = [...(pr.comments || []), ...(pr.reviews || []).filter((x) => x.body?.trim())]
      .filter((c) => !seen.has(c.id || c.url) && Date.parse(c.createdAt || c.submittedAt || 0) >= since && !c.viewerDidAuthor);
    for (const c of said) seen.add(c.id || c.url);
    const onLines = pr.state === "OPEN" ? await this.lineComments(cmd, cwd, pr, { seen, since }) : [];
    for (const c of onLines) seen.add("lc:" + c.id);
    // Automated reviewers apart: fallible, and only BOT_ROUNDS review runs each per PR.
    const bots = new Set();
    for (const c of said) if (await this.isBot(cmd, cwd, c.author?.login)) bots.add(botName(c.author.login));
    for (const c of onLines) if (await this.isBot(cmd, cwd, c.user?.login, c.user?.type)) bots.add(botName(c.user.login));
    const sorted = sortFeedback({ said, lines: onLines, bots, rounds: prev.botRounds || {}, capped: prev.botCapped || [], head: pr.headRefOid });
    const next = { ...prev, ...view, seen: [...seen].slice(-200), botRounds: sorted.rounds, botCapped: sorted.capped, checkedAt: now() };
    if (pr.state !== "OPEN") return this.prClosed(taskId, { ...next, watching: false });
    // Something for Bruno: each one wakes him once (signature), never twice for the same thing.
    const wake = [];
    const ciKey = failing.length ? pr.headRefOid + ":" + failing.map((c) => c.name).sort().join(",") : null;
    if (ciKey && ciKey !== prev.ciKey) {
      next.ciKey = ciKey;
      const logs = [];
      for (const c of failing.slice(0, 3)) {
        const run = /\/runs\/(\d+)/.exec(c.url)?.[1];
        if (!run) continue;
        const log = await runCmd(cmd, ["run", "view", run, "--log-failed"], { cwd, timeout: 90000 });
        if (log.ok && log.stdout.trim()) logs.push("--- " + c.name + " ---\n" + log.stdout.slice(-4000));
      }
      wake.push(`Falla el CI de la PR #${pr.number}: ${failing.map((c) => c.name).join(", ")}.` + (logs.length ? "\n\nLo que dice:\n```\n" + clip(logs.join("\n"), 9000) + "\n```" : ""));
    }
    if (pr.mergeable === "CONFLICTING" && prev.mergeable !== "CONFLICTING") wake.push(`La PR #${pr.number} tiene conflictos con ${task.base || "main"}.`);
    const decided = view.reviewDecision !== (prev.reviewDecision ?? null) ? view.reviewDecision : null;
    if (decided === "CHANGES_REQUESTED") wake.push(`Piden cambios en la PR #${pr.number}.`);
    const body = (c) => clip(String(c.body || "").replace(/\s+/g, " "), 600);
    const where = (c) => c.path + (c.line || c.original_line ? ":" + (c.line || c.original_line) : "");
    const { people } = sorted;
    if (people.said.length) wake.push(`Han comentado en la PR #${pr.number}:\n` + people.said.slice(0, 10).map((c) => `- ${c.author?.login || "alguien"}: ${body(c)}`).join("\n"));
    if (people.lines.length) wake.push(`Han comentado líneas de la PR #${pr.number}:\n` + people.lines.slice(0, 15).map((c) => `- ${c.user?.login || "alguien"} en ${where(c)}: ${body(c)}`).join("\n"));
    for (const [name, b] of sorted.bots)
      wake.push(`Revisión automática de ${name} en la PR #${pr.number} (ronda ${sorted.rounds[name].length} de ${BOT_ROUNDS}):\n` + [...b.said.map((c) => `- ${body(c)}`), ...b.lines.map((c) => `- en ${where(c)}: ${body(c)}`)].slice(0, 15).join("\n"));
    this.setTask(taskId, { pr: next });
    for (const name of sorted.newlyCapped)
      this.addItem(taskId, { kind: "notice", text: `${name} ya ha revisado ${BOT_ROUNDS} veces la PR #${pr.number}: Bruno no atiende más revisiones automáticas suyas.`, url: pr.url });
    if (decided === "APPROVED") {
      // Good news only: a notice, never a turn for Bruno.
      this.addItem(taskId, { kind: "notice", text: `La PR #${pr.number} está aprobada.`, url: pr.url, tone: "done" });
      this.notifyTask(taskId, "done", `La PR #${pr.number} está aprobada.`);
    }
    if (!wake.length) return next;
    this.addItem(taskId, { kind: "notice", text: wake.map((w) => w.split("\n")[0]).join(" "), url: pr.url, tone: "warn" });
    this.notifyTask(taskId, "needs", wake.map((w) => w.split("\n")[0]).join(" "));
    await this.send(taskId, { line: "Bruno se pone con la PR #" + pr.number + ": " + wake.map((w) => w.split("\n")[0]).join(" "), text: wake.join("\n\n") + (sorted.bots.size ? "\n\n" + BOT_ADVICE : "") + "\n\nArréglalo en tu copia y comprueba que funciona. Para subirlo de nuevo, pide permiso: subir sigue necesitando el OK de la persona." }).catch((e) => console.warn("Código: PR: " + e.message));
    return next;
  }

  /** Merged or closed: a notice, a Windows notice, and the archived shelf (if it may). */
  async prClosed(taskId, next) {
    const merged = next.state === "MERGED";
    const text = `La PR #${next.number} ${merged ? "se ha fusionado" : "se ha cerrado"}.`;
    this.setTask(taskId, { pr: next });
    this.addItem(taskId, { kind: "notice", text, url: next.url, tone: merged ? "done" : undefined });
    this.notifyTask(taskId, "done", text);
    if (this.rulesFor(this.mustTask(taskId)).onPr) await this.archiveTask(taskId, { by: "pr" }).catch(() => null);
    return next;
  }

  /** Inline review comments not seen yet (newest 100), without the person's own or Colmena's review. */
  async lineComments(cmd, cwd, pr, { seen, since }) {
    const repo = prRepo(pr.url);
    if (!repo) return [];
    const r = await runCmd(cmd, ["api", `repos/${repo}/pulls/${pr.number}/comments?sort=created&direction=desc&per_page=100`], { cwd, timeout: 60000 });
    let list = [];
    try { list = r.ok ? JSON.parse(r.stdout) : []; } catch { return []; }
    const me = await this.ghLogin(cmd);
    return (Array.isArray(list) ? list : [])
      .filter((c) => c?.id && !seen.has("lc:" + c.id) && !seen.has("review:" + c.pull_request_review_id) && Date.parse(c.created_at || 0) >= since && !(me && c.user?.login === me))
      .reverse();
  }

  /** The signed-in GitHub login (asked once; null while gh cannot say). */
  async ghLogin(cmd) {
    if (this.ghUser) return this.ghUser;
    const r = await runCmd(cmd, ["api", "user", "--jq", ".login"], { timeout: 20000 });
    return (this.ghUser = r.ok ? r.stdout.trim() || null : null);
  }

  /**
   * Whether a GitHub login is an automated account. gh pr view drops the «[bot]» of apps, so an
   * unknown login is asked once as «<login>[bot]» (a GitHub App answers type Bot, a person 404).
   * A failed lookup (no network) is not remembered: it counts as a person and is asked again.
   */
  async isBot(cmd, cwd, login, type = null) {
    if (!login) return false;
    if (type === "Bot" || /\[bot\]$/i.test(login)) return true;
    this.botCache ||= new Map();
    if (this.botCache.has(login)) return this.botCache.get(login);
    const r = await runCmd(cmd, ["api", "users/" + encodeURIComponent(login + "[bot]"), "--jq", ".type"], { cwd, timeout: 20000 });
    const bot = r.ok && r.stdout.trim() === "Bot";
    if (r.ok || /Not Found|\b404\b/.test(r.stderr + r.stdout)) this.botCache.set(login, bot);
    return bot;
  }

  // ------------------------------------------------------------------ acting on the PR (the person's buttons)
  // Merging, marking ready and publishing a review go out to GitHub: only from the person's
  // click (HTTP routes with the app token). Bruno's own «gh pr merge» stays a red line (policy.mjs).
  /** The task's open PR and a signed-in gh, or a clear 409. */
  async openPr(taskId) {
    const task = this.mustTask(taskId);
    const pr = task.pr;
    if (!pr?.number || pr.state !== "OPEN") throw Object.assign(Error("Esta tarea no tiene una PR abierta en GitHub."), { status: 409 });
    const repo = prRepo(pr.url);
    if (!repo) throw Object.assign(Error("No sé en qué repositorio de GitHub está la PR #" + pr.number + "."), { status: 409 });
    const gh = await this.ghStatus();
    if (!gh.installed || !gh.authed) throw Object.assign(Error(gh.installed ? "Inicia sesión en GitHub con «gh auth login» en una terminal y vuelve a intentarlo." : "Para esto hace falta GitHub CLI (gh): instálalo e inicia sesión con «gh auth login»."), { status: 409 });
    return { task, pr, repo, gh, cwd: this.prCwd(task) };
  }

  /**
   * «Fusionar la PR #N en GitHub»: merges only the commit the person saw (--match-head-commit),
   * so a push after they looked makes GitHub refuse. Then the usual «merged» path.
   */
  async mergePr(taskId) {
    const { task, pr, repo, gh, cwd } = await this.openPr(taskId);
    const base = task.base || "main";
    const refuse = (text) => Object.assign(Error(text), { status: 409 });
    if (pr.isDraft) throw refuse(mergeRefusal("draft", { number: pr.number, base }));
    if (pr.mergeable === "CONFLICTING") throw refuse(mergeRefusal("conflict", { number: pr.number, base }));
    if (pr.checks === "failing") throw refuse(`Falla el CI de la PR #${pr.number}: arréglalo antes de fusionarla.`);
    if (!pr.headRefOid) throw refuse(`Colmena aún no ha visto el último commit de la PR #${pr.number}: espera un momento y vuelve a intentarlo.`);
    const r = await runCmd(gh.cmd, ["pr", "merge", String(pr.number), "--repo", repo, "--merge", "--match-head-commit", pr.headRefOid], { cwd, timeout: 120000 });
    if (!r.ok) {
      await this.checkPr(taskId, gh.cmd).catch(() => null); // what changed shows on screen
      throw refuse(mergeRefusal(r.stderr + "\n" + r.stdout, { number: pr.number, base }));
    }
    const after = await this.checkPr(taskId, gh.cmd).catch(() => null);
    if (after?.state !== "MERGED" && this.mustTask(taskId).pr?.state === "OPEN") {
      // A merge queue (or GitHub being slow): the watch says when it is in.
      this.addItem(taskId, { kind: "notice", text: `GitHub ha recibido la orden de fusionar la PR #${pr.number}. Colmena te avisa cuando esté fusionada.`, url: pr.url });
      if (!this.mustTask(taskId).pr.watching) await this.followPr(taskId, pr.branch || task.branch).catch(() => false);
    }
    return { ok: true, task: this.taskView(this.mustTask(taskId)) };
  }

  /** «Marcar la PR como lista»: a draft PR goes up for review (gh pr ready). */
  async readyPr(taskId) {
    const { pr, repo, gh, cwd } = await this.openPr(taskId);
    if (!pr.isDraft) return { ok: true, task: this.taskView(this.mustTask(taskId)) };
    const r = await runCmd(gh.cmd, ["pr", "ready", String(pr.number), "--repo", repo], { cwd, timeout: 60000 });
    if (!r.ok) throw Object.assign(Error(`GitHub no ha marcado la PR #${pr.number} como lista: ` + clip(lastLine(r.stderr || r.stdout), 300)), { status: 409 });
    this.setTask(taskId, { pr: { ...this.mustTask(taskId).pr, isDraft: false } });
    this.addItem(taskId, { kind: "notice", text: `La PR #${pr.number} ya está lista para revisar.`, url: pr.url });
    return { ok: true, task: this.taskView(this.mustTask(taskId)) };
  }

  /**
   * «Publicar en la PR #N»: Código's P0–P3 review as one GitHub review on the head commit,
   * findings on a line of the PR diff inline, the rest in its body. Once per review item.
   */
  async publishReview(taskId, { item: itemId }) {
    const item = this.store.get("codeItems", itemId);
    if (!item || item.taskId !== taskId || item.kind !== "review") throw Object.assign(Error("No encuentro esa revisión."), { status: 404 });
    if (item.published) throw Object.assign(Error(`Esta revisión ya está publicada en la PR #${item.published.number}.`), { status: 409 });
    this.publishing ||= new Set();
    if (this.publishing.has(itemId)) throw Object.assign(Error("Ya se está publicando esta revisión."), { status: 409 });
    this.publishing.add(itemId);
    try {
      const { pr, repo, gh, cwd } = await this.openPr(taskId);
      if (!pr.headRefOid) throw Object.assign(Error(`Colmena aún no ha visto el último commit de la PR #${pr.number}: espera un momento y vuelve a intentarlo.`), { status: 409 });
      const diff = await runCmd(gh.cmd, ["pr", "diff", String(pr.number), "--repo", repo], { cwd, timeout: 60000 });
      const payload = reviewPayload(item, { commit: pr.headRefOid, lines: rightLines(diff.ok ? diff.stdout : "") });
      const file = path.join(this.directory, "code", "tmp", "review-" + randomUUID() + ".json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(payload));
      const r = await runCmd(gh.cmd, ["api", `repos/${repo}/pulls/${pr.number}/reviews`, "-X", "POST", "--input", file], { cwd, timeout: 60000 }).finally(() => rm(file, { force: true }).catch(() => {}));
      if (!r.ok) throw Object.assign(Error("GitHub no ha aceptado la revisión: " + clip(ghMessage(r.stderr + "\n" + r.stdout), 300)), { status: 409 });
      let res = {};
      try { res = JSON.parse(r.stdout || "{}"); } catch {}
      const published = { number: pr.number, url: res.html_url || pr.url, id: res.id || null, inline: payload.comments.length, at: now() };
      // Its own inline comments never come back to Bruno as somebody else's.
      if (res.id) { const t = this.mustTask(taskId); this.setTask(taskId, { pr: { ...t.pr, seen: [...(t.pr.seen || []), "review:" + res.id].slice(-200) } }); }
      return { item: this.patchItem(itemId, { published }), published };
    } finally { this.publishing.delete(itemId); }
  }

  /** «Dejar de seguir» / «Seguir la PR». */
  async setPrWatch(taskId, on) {
    const task = this.mustTask(taskId);
    if (on) return { following: await this.followPr(taskId, task.pr?.branch || task.branch) };
    this.setTask(taskId, { pr: task.pr ? { ...task.pr, watching: false } : null });
    return { following: false };
  }
}
