// «Buscar en las tareas» of Código: words in task titles and in what was said in them (your
// messages, Bruno's answers and plans, Colmena's notices; never tool outputs), across every
// project, archived tasks included. Accent- and case-insensitive like the palette (search.mjs).
import { fold } from "../search.mjs";

/** The timeline kinds whose words are searched (tool calls and their outputs are not). */
export const SEARCH_KINDS = Object.freeze(["user", "text", "plan", "notice"]);
const KINDS = new Set(SEARCH_KINDS);
const GOAL_MARK = /\[\s*objetivo\s*:\s*(cumplido|sigue|bloqueado)[^\]]*\]/gi;

/** A short piece of `text` around the first match of `query` (already folded). */
export function snippetOf(text, query, width = 150) {
  const plain = String(text || "").replace(GOAL_MARK, "").replace(/\s+/g, " ").trim();
  const at = fold(plain).indexOf(query);
  if (at < 0) return plain.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return (start > 0 ? "…" : "") + plain.slice(start, start + width).trim() + (start + width < plain.length ? "…" : "");
}

/**
 * Hits for `q`: tasks whose title matches first (newest first), then what was said, newest
 * first, at most `perTask` per task and `limit` in all. Each hit: {taskId, title, projectId,
 * project, archived, itemId (null for a title), kind, who, snippet, at}.
 */
export function searchTasks({ tasks = [], projects = [], items = [] }, q, { limit = 30, perTask = 3, bot = "Bruno" } = {}) {
  const query = fold(q).replace(/\s+/g, " ").trim();
  if (query.length < 2) return { hits: [], more: false };
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const view = (t) => ({ taskId: t.id, title: t.title, projectId: t.projectId, project: names.get(t.projectId) || null, archived: !!t.archived });
  const recent = (a, b) => String(b).localeCompare(String(a));
  const titles = tasks.filter((t) => fold(t.title).includes(query)).sort((a, b) => recent(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt))
    .map((t) => ({ ...view(t), itemId: null, kind: "title", who: null, snippet: t.title, at: t.updatedAt || t.createdAt || null }));
  const said = [];
  const seen = new Map();
  for (const i of [...items].sort((a, b) => recent(a.at, b.at))) {
    if (!KINDS.has(i.kind) || typeof i.text !== "string" || !i.text) continue;
    const t = byTask.get(i.taskId);
    if (!t || (seen.get(t.id) || 0) >= perTask || !fold(i.text).replace(/\s+/g, " ").includes(query)) continue;
    seen.set(t.id, (seen.get(t.id) || 0) + 1);
    said.push({ ...view(t), itemId: i.id, kind: i.kind, who: i.kind === "user" ? "Tú" : i.kind === "notice" ? "Colmena" : bot, snippet: snippetOf(i.text, query), at: i.at || null });
    if (said.length > limit) break;
  }
  const all = [...titles, ...said];
  return { hits: all.slice(0, limit), more: all.length > limit };
}
