import { OVERLAP_FILES, clip } from "./shared.mjs";

/** CodeService methods: tasks of one project that touch the same files. */
export class OverlapMethods {

  // ------------------------------------------------------------------ tasks changing the same files
  /** Copies whose changes can collide when both are merged: their own, not archived, not saved. */
  overlapCandidate(t) {
    return !!(t && t.isolated && t.worktree && t.baseSnap && !t.archived && !t.saved && !t.merged);
  }

  /** The files the task's copy differs in from its start (its base point → `snap`), kept on it. */
  async refreshChanged(taskId, snap) {
    const task = this.store.get("codeTasks", taskId);
    if (!this.overlapCandidate(task)) return null;
    const snaps = this.snapsOf(task);
    const point = snap === "now" ? await snaps.capture("overlap-" + Date.now()) : snap || (task.turns || []).at(-1)?.endSnap || null;
    const changed = point ? (await snaps.changedFiles(task.baseSnap, point)).slice(0, OVERLAP_FILES) : [];
    this.quietPut(taskId, { changed });
    return changed;
  }
  /** Overlap bookkeeping without touching updatedAt (the list's order stays the person's work). */
  quietPut(taskId, changes) {
    const now_ = this.store.get("codeTasks", taskId);
    return now_ ? this.store.put("codeTasks", { ...now_, ...changes }) : null;
  }

  /**
   * After a task's files changed (a turn, «Volver aquí», «Deshacer este archivo») or it left or
   * came back to the active ones: refreshes its changed files (`snap`: the point it is at now,
   * «now» to capture it, null to keep them) and the overlaps of its whole project. One check per
   * project at a time.
   */
  checkOverlaps(taskId, snap = null, projectId = this.store.get("codeTasks", taskId)?.projectId) {
    if (!projectId || this.closed) return Promise.resolve(null);
    this.overlapRuns ||= new Map();
    const run = (this.overlapRuns.get(projectId) || Promise.resolve()).then(async () => {
      if (this.closed) return null;
      if (snap !== null) await this.refreshChanged(taskId, snap);
      // Tasks from before this check have no list yet: worked out once, from their last turn.
      for (const t of this.store.list("codeTasks")) if (t.projectId === projectId && !Array.isArray(t.changed) && this.overlapCandidate(t) && (t.turns || []).some((x) => x.files?.length)) await this.refreshChanged(t.id);
      return this.overlapsIn(projectId);
    }).catch((e) => { console.warn("Código: archivos en común: " + e.message); return null; });
    this.overlapRuns.set(projectId, run);
    return run;
  }

  /**
   * Which active tasks of a project change the same files (their `changed` lists). Each task
   * keeps `overlaps` [{task, title, files, count}] for its header and list row; a notice goes to
   * its timeline only when an overlap is new or gains files (`overlapSeen`), and both clear when
   * the overlap is gone (or the other task is archived, saved or deleted).
   */
  overlapsIn(projectId) {
    const tasks = this.store.list("codeTasks").filter((t) => t.projectId === projectId);
    const active = tasks.filter((t) => this.overlapCandidate(t) && t.changed?.length);
    const name = this.bot().name;
    const short = (files) => files.slice(0, 3).map((f) => f.split("/").pop()).join(", ") + (files.length > 3 ? " y " + (files.length - 3 === 1 ? "1 más" : files.length - 3 + " más") : "");
    for (const t of tasks) {
      const mine = active.includes(t) ? new Set(t.changed) : null;
      const overlaps = [];
      const seen = {};
      for (const other of mine ? active : []) {
        if (other.id === t.id) continue;
        const shared = other.changed.filter((f) => mine.has(f));
        if (!shared.length) continue;
        overlaps.push({ task: other.id, title: other.title, files: shared.slice(0, 20), count: shared.length });
        seen[other.id] = shared.slice(0, 200);
        const before = new Set(t.overlapSeen?.[other.id] || []);
        if (shared.some((f) => !before.has(f))) this.addItem(t.id, { kind: "notice", tone: "warn", overlap: other.id, text: `${name} y la tarea «${clip(other.title, 60)}» están cambiando los mismos archivos: ${short(shared)}. Al fusionar pueden chocar.` });
      }
      if (JSON.stringify(overlaps) === JSON.stringify(t.overlaps || []) && JSON.stringify(seen) === JSON.stringify(t.overlapSeen || {})) continue;
      const next = this.quietPut(t.id, { overlaps, overlapSeen: seen });
      if (next) this.emit({ type: "task", task: this.taskView(next) });
    }
    return tasks.filter((t) => active.includes(t)).map((t) => ({ id: t.id, overlaps: this.store.get("codeTasks", t.id)?.overlaps || [] }));
  }
}
