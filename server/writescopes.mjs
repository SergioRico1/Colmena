// Write scopes of a mission's steps (DeepSeek Harness agent-team `writeScopes`): the files and
// folders of the mission folder a part declares (plan «writes»), names in its task, or
// actually writes. Two parts running at once whose scopes overlap get an advisory note —
// never a lock. Cheap: strings only, no filesystem.
import { PROJECTS_DIR, projectName } from "./projects/files.mjs";

const MAX_SCOPES = 24;
const FILE_EXT = "md|txt|csv|tsv|json|html?|css|m?js|cjs|jsx|tsx?|py|sql|xlsx|docx|pptx|svg|png|ya?ml|xml";
// «proyectos/tienda/», «src/App.jsx», «informe.md»: path-like words of a task text.
const PATHISH = new RegExp("(?:^|[\\s«\"'(`\\[])((?:[\\w.-]+/)+[\\w.-]*|[\\w-]+\\.(?:" + FILE_EXT + "))(?=$|[\\s»\"').,;:`\\]])", "gi");

/** «./Proyectos\\Tienda/» → «proyectos/tienda» (lowercase, forward slashes, no edges). */
export function normalizeScope(raw) {
  const clean = String(raw || "").trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/").toLowerCase();
  if (!clean || clean === "." || clean.split("/").includes("..") || /^[a-z]:/.test(clean) || /^https?:/.test(clean)) return "";
  return clean;
}

/** Whether two normalized scopes overlap on whole path components (one contains the other). */
export function scopesOverlap(a, b) {
  return !!a && !!b && (a === b || a.startsWith(b + "/") || b.startsWith(a + "/"));
}

/** Path-like words of a task text («proyectos/tienda», «informe.md»), normalized. */
export function inferScopes(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(PATHISH)) {
    const scope = normalizeScope(m[1]);
    // Not «y/o», «km/h» or «24/7»: a real name has a word in it.
    if (scope && scope.length >= 4 && /[a-z]{3}/.test(scope)) out.add(scope);
    if (out.size >= MAX_SCOPES) break;
  }
  return [...out];
}

/** What a write call touches in the mission folder, or "" (reads and other tools). */
export function scopeOfCall(name, args = {}) {
  try {
    if (name === "write_file") return normalizeScope(args.path);
    if (name === "project_create") return PROJECTS_DIR + "/" + projectName(args.name);
    if (["project_write", "project_edit", "project_delete"].includes(name))
      return normalizeScope(PROJECTS_DIR + "/" + projectName(args.project) + "/" + String(args.path || ""));
  } catch {}
  return "";
}

// A task that only reads a file («resume informe.md») does not claim it.
const WRITES = /\b(escrib|cre[ae]|edit|modific|cambi|actualiz|gener|guard|añad|borr|program|redact|arregl|implement|rellen|sobrescrib)/i;

/** A step's scopes: declared (plan «writes»), named in a task that writes, and written so far. */
export function stepScopes(step) {
  const named = WRITES.test(String(step?.task || "")) ? inferScopes(step.task) : [];
  const all = [...(step?.writes || []).map(normalizeScope), ...named, ...(step?.wrote || [])];
  return [...new Set(all.filter(Boolean))].slice(0, MAX_SCOPES * 2);
}

/** The scopes of `scopes` that overlap any of `others` (the more specific of each pair). */
export function overlapping(scopes, others) {
  const out = new Set();
  for (const a of scopes) for (const b of others) if (scopesOverlap(a, b)) out.add(a.length >= b.length ? a : b);
  return [...out];
}
