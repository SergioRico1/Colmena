// The files a bot's turn changed (server/turn-changes.mjs): one request per turn, shared by the
// «Archivos cambiados» card and the links in the bot's closing text; and the pure words.

const cache = new Map(); // missionId + cp + restoredAt → promise of {files, more}

/** The turn's changed files (cached; a restore changes which ones can still be opened). */
export function turnChanges(missionId, cpId, key = "") {
  const id = missionId + "\u0000" + cpId + "\u0000" + key;
  if (!cache.has(id)) {
    const p = fetch(`/api/missions/${encodeURIComponent(missionId)}/checkpoints/${encodeURIComponent(cpId)}/changes`)
      .then(async (r) => { const body = await r.json().catch(() => ({})); if (!r.ok) throw Error(body.error || "No pude ver los cambios."); return body; });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
    while (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return cache.get(id);
}

export const sizeLabel = (n) => (n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1).replace(".", ",") + " MB");

/** «+12 −3» for text (and Office files by their text); «2 KB → 3 KB» otherwise. */
export function deltaLabel(f) {
  if (f.added != null || f.removed != null) {
    const parts = [];
    if (f.added) parts.push("+" + f.added);
    if (f.removed) parts.push("−" + f.removed);
    return { kind: "lines", added: f.added || 0, removed: f.removed || 0, text: parts.join(" ") || "sin cambios de texto" };
  }
  if (f.change === "created") return { kind: "size", text: sizeLabel(f.after) };
  if (f.change === "deleted") return { kind: "size", text: sizeLabel(f.before) };
  return { kind: "size", text: sizeLabel(f.before) + " → " + sizeLabel(f.after) };
}

export const CHANGE_WORD = { created: "nuevo", edited: "editado", deleted: "borrado" };

/** The Files panel type of a changed file (its tab icon). */
export const fileTypeOf = (kind, path = "") => (kind === "image" ? "image" : kind === "pdf" ? "pdf" : kind === "document" || kind === "office" ? "document" : /\.(md|markdown)$/i.test(path) ? "markdown" : /\.(csv|tsv)$/i.test(path) ? "csv" : kind === "text" ? "text" : "binary");

const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Names of the turn's files in the bot's text become links («[informe.docx](#file:informe.docx)»):
 * the path or the bare name, not inside code, links or longer words or paths. Inline code that
 * is exactly a file's name or path is handled by the Markdown renderer.
 */
export function withFileLinks(md, files = []) {
  const byName = new Map();
  for (const f of files) {
    byName.set(f.path, f.path);
    // A bare name only when it is not ambiguous.
    if (!byName.has(f.name)) byName.set(f.name, f.path);
    else if (byName.get(f.name) !== f.path && f.name !== f.path) byName.set(f.name, null);
  }
  const names = [...byName.keys()].filter((n) => byName.get(n) && n.length >= 3 && /\.[A-Za-z0-9]{1,6}$/.test(n)).sort((a, b) => b.length - a.length);
  if (!names.length) return md;
  const re = new RegExp("(?<![\\p{L}\\d_/\\\\.\\-#\\[])(" + names.map(escapeRe).join("|") + ")(?![\\p{L}\\d_\\-]|\\.[\\p{L}\\d])", "gu");
  // Code (fenced and inline) and existing links stay as they are.
  return String(md || "").split(/(```[\s\S]*?```|`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]+>|https?:\/\/\S+)/).map((part, i) => (i % 2 ? part
    : part.replace(re, (name) => `[${name}](#file:${encodeURIComponent(byName.get(name))})`))).join("");
}

/** The file a «#file:» link or an inline code names, or null. */
export function fileOfLink(files, hrefOrText) {
  const s = String(hrefOrText || "");
  const target = s.startsWith("#file:") ? decodeURIComponent(s.slice(6)) : s.trim();
  return files.find((f) => f.path === target) || files.filter((f) => f.name === target).length === 1 && files.find((f) => f.name === target) || null;
}
