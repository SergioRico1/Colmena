import { existsSync } from "node:fs";
import { now } from "../store.mjs";
import { ARCHIVE_DEFAULTS, SWEEP_MS } from "./shared.mjs";

/** CodeService methods: archiving tasks (rules, by hand, on their own), putting them to sleep and the sweeps that do both. */
export class ArchiveMethods {

  // ------------------------------------------------------------------ archive and snooze (T3 Code settle / snooze)
  /** Ajustes › Bots y autonomía › Tareas de Código: when finished tasks leave the list on their own. */
  archiveSettings() {
    return { ...ARCHIVE_DEFAULTS, ...(this.store.get("codeSettings", "archive")?.rules || {}) };
  }
  setArchiveSettings(rules = {}) {
    const clean = {};
    if (rules.idleDays !== undefined) clean.idleDays = Math.max(0, Math.min(365, Math.round(Number(rules.idleDays) || 0)));
    for (const k of ["onSave", "onPr", "keepWithPr"]) if (typeof rules[k] === "boolean") clean[k] = rules[k];
    this.store.put("codeSettings", { id: "archive", rules: { ...(this.store.get("codeSettings", "archive")?.rules || {}), ...clean }, updatedAt: now() });
    return this.archiveSettings();
  }
  /** The rules for one task: Ajustes, with its project's own days and «conservar con PR» on top. */
  rulesFor(task) {
    const rules = this.archiveSettings();
    const own = this.store.get("codeProjects", task.projectId)?.archive || {};
    return { ...rules, ...(own.idleDays !== undefined && own.idleDays !== null ? { idleDays: own.idleDays } : {}), ...(typeof own.keepWithPr === "boolean" ? { keepWithPr: own.keepWithPr } : {}) };
  }
  setProjectArchive(projectId, { idleDays, keepWithPr }) {
    const project = this.mustProject(projectId);
    const archive = { ...(project.archive || {}) };
    if (idleDays !== undefined) archive.idleDays = idleDays === null ? null : Math.max(0, Math.min(365, Math.round(Number(idleDays) || 0)));
    if (keepWithPr !== undefined) archive.keepWithPr = keepWithPr === null ? null : !!keepWithPr;
    this.store.put("codeProjects", { ...project, archive, updatedAt: now() });
    this.emit({ type: "projects" });
    return this.mustProject(projectId);
  }

  /** Why a task must not leave the list on its own (null: it may). */
  holdsArchive(task) {
    if (task.archived) return "ya está archivada";
    if (task.pinned) return "está fijada";
    if (task.autoArchive === false) return "tiene el autoarchivado desactivado";
    if (task.snoozed) return "está pospuesta";
    if (this.engines.get(task.id)?.turn || this.starting.has(task.id) || task.status === "working") return "está trabajando";
    if (["waiting", "planned"].includes(task.status) || this.items(task.id).some((i) => i.kind === "ask" && i.status === "pending") || task.merging || ["blocked", "limited"].includes(task.goal?.status)) return "te espera";
    if ((task.queue || []).length) return "tiene mensajes en cola";
    if (task.goal?.status === "active" || ["queued", "running"].includes(task.tests?.status) || this.terminals.settling?.(task.id)) return "tiene trabajo en segundo plano";
    return null;
  }

  /**
   * «Archivar»: the task leaves the list for the archived shelf, nothing is deleted. Its copy's
   * closing scripts (onSettle / T3 Code runOnSettle) run to free disk, unless it works in the
   * project folder. Automatic archiving (`by` ≠ «manual») respects holdsArchive.
   */
  async archiveTask(taskId, { by = "manual" } = {}) {
    const task = this.mustTask(taskId);
    if (task.archived) return this.taskView(task);
    if (by === "manual") {
      if (this.engines.get(taskId)?.turn || this.starting.has(taskId)) throw Object.assign(Error("Bruno está trabajando: páralo antes de archivar."), { status: 409 });
      // Unanswered questions go without an answer (T3 Code: settling dismisses them).
      for (const [askId, pending] of this.asks) if (pending.taskId === taskId) { pending.resolve({ behavior: "deny", message: "La persona ha archivado la tarea." }); this.asks.delete(askId); this.patchItem(askId, { status: "expired" }); }
    } else if (this.holdsArchive(task)) return null;
    this.closeEngine(taskId);
    const next = this.setTask(taskId, { archived: { at: now(), by }, pinned: false, snoozed: null, status: ["waiting", "planned"].includes(task.status) ? "idle" : task.status, queue: [] });
    const why = { manual: "Archivada.", saved: "Archivada al guardarla en " + (task.base || "main") + ".", pr: "Archivada al cerrarse su PR.", idle: "Archivada tras " + this.rulesFor(task).idleDays + " días sin actividad." }[by] || "Archivada.";
    this.addItem(taskId, { kind: "notice", text: why });
    void this.checkOverlaps(taskId); // an archived task no longer counts for the others
    await this.runSettleScripts(next);
    this.emit({ type: "projects" });
    return this.taskView(this.mustTask(taskId));
  }

  /** «Desarchivar»: back to the list; it does not archive itself again until you write in it. */
  unarchiveTask(taskId) {
    const task = this.mustTask(taskId);
    if (!task.archived) return this.taskView(task);
    this.setTask(taskId, { archived: null, holdAuto: true });
    this.addItem(taskId, { kind: "notice", text: "Vuelve a tus tareas." });
    void this.checkOverlaps(taskId);
    this.emit({ type: "projects" });
    return this.taskView(this.mustTask(taskId));
  }

  /** The closing scripts of the project in the task's own copy (never in the project folder). */
  async runSettleScripts(task) {
    if (!task.isolated || !task.worktree || task.saved || !existsSync(task.cwd)) return 0;
    let n = 0;
    for (const script of this.scriptsOf(task).filter((x) => x.onSettle).slice(0, 3)) {
      const opened = await this.terminals.open(task.id, { cwd: task.cwd, command: script.command, title: script.name, setup: true }).catch(() => null);
      if (!opened) continue;
      this.addItem(task.id, { kind: "notice", text: "Liberando espacio: «" + script.name + "» en una terminal…", setup: opened.id, settle: true });
      n++;
    }
    return n;
  }

  /** «Posponer» until a time: hidden until then; it still works, and comes back early only to ask or fail. */
  snoozeTask(taskId, { until }) {
    const task = this.mustTask(taskId);
    const when = Date.parse(until || "");
    if (!Number.isFinite(when) || when <= Date.now() + 30000) throw Object.assign(Error("Elige un momento más adelante."), { status: 400 });
    if (when > Date.now() + 366 * 86400000) throw Object.assign(Error("Como mucho, un año."), { status: 400 });
    if (task.archived) throw Object.assign(Error("Una tarea archivada no se pospone: desarchívala antes."), { status: 409 });
    this.setTask(taskId, { snoozed: { until: new Date(when).toISOString(), at: now() } });
    this.emit({ type: "projects" });
    return this.taskView(this.mustTask(taskId));
  }
  wakeTask(taskId, { why = "manual" } = {}) {
    const task = this.store.get("codeTasks", taskId);
    if (!task?.snoozed) return task ? this.taskView(task) : null;
    this.setTask(taskId, { snoozed: null, wokeBy: why });
    this.emit({ type: "projects" });
    return this.taskView(this.mustTask(taskId));
  }

  /** Every 30 s: snoozed tasks whose time came; every 10 min: tasks idle for too long. */
  startSweeps() {
    if (this.sweepTimer) return;
    let n = 0;
    this.sweepTimer = setInterval(() => {
      this.sweepSnoozed();
      if (++n % 20 === 0) void this.sweepArchive().catch((e) => console.warn("Código: archivar: " + e.message));
    }, SWEEP_MS);
    this.sweepTimer.unref?.();
    this.firstSweep = setTimeout(() => void this.sweepArchive().catch(() => {}), 20000);
    this.firstSweep.unref?.();
  }
  sweepSnoozed(time = Date.now()) {
    for (const t of this.store.list("codeTasks")) if (t.snoozed && Date.parse(t.snoozed.until) <= time) this.wakeTask(t.id, { why: "time" });
  }
  async sweepArchive(time = Date.now()) {
    const archived = [];
    for (const t of this.store.list("codeTasks")) {
      if (t.archived || t.holdAuto) continue;
      const rules = this.rulesFor(t);
      if (!rules.idleDays) continue;
      if (time - Date.parse(t.activeAt || t.updatedAt || t.createdAt) < rules.idleDays * 86400000) continue;
      if (rules.keepWithPr && t.pr?.number && t.pr.state === "OPEN") continue;
      if (await this.archiveTask(t.id, { by: "idle" })) archived.push(t.id);
    }
    return archived;
  }
}
