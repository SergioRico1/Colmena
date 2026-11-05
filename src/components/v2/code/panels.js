// Pure helpers of the «Archivos» and «Procesos» tabs (Files.jsx, Processes.jsx), kept apart so
// tests can load them without JSX.

/** «12 s», «5 min», «2 h 3 min», «3 d» (how long a process has been running). */
export function uptime(started, now = Date.now()) {
  if (!started) return null;
  const s = Math.max(0, Math.round((now - started) / 1000));
  if (s < 60) return s + " s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
  return Math.floor(h / 24) + " d";
}

/** What «Parar todo» would stop (as server/code/processes.mjs leftovers). */
export function leftoverPids(rows) {
  const keep = new Set(rows.filter((r) => r.depth === 0 && (r.kind === "engine" || r.kind === "terminal")).map((r) => r.pid));
  return rows.filter((r) => (r.depth === 0 && !keep.has(r.pid)) || (r.depth === 1 && keep.has(r.parent))).map((r) => r.pid);
}

/** «512 B», «1,5 KB», «3,0 MB». */
export function sizeLabel(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace(".", ",") + " KB";
  return (n / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
}

/** The line under a folder's entries: cut lists and what .gitignore leaves out. */
export const noteOf = (d) => [
  d.truncated ? "Solo se muestran las primeras " + d.entries.length + " entradas" : null,
  d.hidden ? (d.hidden === 1 ? "1 oculto" : d.hidden + " ocultos") + " por .gitignore" : null,
].filter(Boolean).join(" · ");

/** The visible rows of the tree: open folders' entries under them, `depth` for the indent. */
export function visibleRows(dirs, open, dir = "", depth = 0, out = []) {
  const d = dirs[dir];
  if (!d?.entries) return out;
  for (const e of d.entries) {
    out.push({ ...e, depth });
    if (e.type === "dir" && !e.heavy && open.has(e.path)) {
      const child = dirs[e.path];
      if (child?.entries) visibleRows(dirs, open, e.path, depth + 1, out);
      else out.push({ note: child?.error || "Cargando…", path: e.path + "/…", depth: depth + 1, error: !!child?.error });
      if (child?.hidden || child?.truncated) out.push({ note: noteOf(child), path: e.path + "/…more", depth: depth + 1 });
    }
  }
  return out;
}
