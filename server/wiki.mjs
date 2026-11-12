// «Notas»: a wiki the person and the bots share. Markdown pages about clients, projects,
// procedures and decisions, next to memory (short facts that go into every prompt) and
// deliverables (finished documents).
//
// Records (server/store.mjs):
//   wikiPages     {id, slug, title, body, aliases[], folder, tags[], archived, revision,
//                  createdAt, updatedAt, createdBy, updatedBy, external, size, excerpt}
//   wikiVersions  {id: «pageId:00000042», pageId, revision, title, body, by, at, reason,
//                  external, effect, size}: the page as it was after each save of its title or text
//   wikiLinks     {id: «page:<id>» | «message:<id>» | «artifact:<id>», from, targets[{slug, target, text}], at}
//                 one record per source; backlinks, «por crear» and the graph all read this kind
//
// Links are `[[Título]]` and `[[Título|texto]]`. A link names a slug (accents folded, lower
// case, hyphens): a page's own slug wins, then the aliases of the others — a renamed page
// keeps its old slug as an alias, so what pointed at it still does. A link to a page that
// does not exist is valid and listed as «por crear».
//
// The text of a page is data. Nothing here runs it, follows it or reads it as an instruction.
import { createHash } from "node:crypto";
import { id as newId, now } from "./store.mjs";
import { buildIndex, rank, foldText } from "./memory-rank.mjs";
import { diffText } from "./linediff.mjs";

export const WIKI_LIMITS = Object.freeze({
  title: 160, slug: 80, body: 200000, aliases: 20, tags: 20, tag: 40, folder: 200,
  pageSize: 50, pageMax: 200, searchResults: 20, linksPerSource: 300, backlinks: 200,
  graphNodes: 300, graphNodesMax: 1000, graphEdges: 2000,
  // Versions: all of the last 30 days; older ones, the last of each day; never more than
  // these per page (the oldest go first, the two newest always stay).
  versionDays: 30, versionsMax: 200, versionsBytes: 20 * 1024 * 1024, thinEvery: 10,
});
export const PERSON = Object.freeze({ kind: "person" });
const DAY = 86400000;

/** An error the routes answer as it is: {status, message, revision?, details?}. */
export class WikiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}
const missing = () => new WikiError(404, "Nota no encontrada.");

// ------------------------------------------------------------------ slugs and fields
/** «Año 2024 · Acme, S.L.» → «ano-2024-acme-s-l». Idempotent. Empty for an empty text. */
export function slugOf(text) {
  const raw = String(text ?? "").trim();
  const base = foldText(raw).replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, WIKI_LIMITS.slug).replace(/-+$/, "");
  if (base || !raw) return base;
  // A title with no Latin letter or digit (emoji, another script) still needs a stable slug.
  return "nota-" + createHash("sha256").update(raw).digest("hex").slice(0, 8);
}
const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// Characters that would break `[[Título|texto]]` or an Obsidian heading link.
const TITLE_BAD = /[[\]|#^]/;
export function cleanTitle(value) {
  const title = oneLine(value);
  if (!title) throw new WikiError(400, "Escribe un título para la nota.");
  if (title.length > WIKI_LIMITS.title) throw new WikiError(400, "El título es demasiado largo (máx. " + WIKI_LIMITS.title + " caracteres).");
  if (TITLE_BAD.test(title)) throw new WikiError(400, "El título no puede llevar [ ] | # ni ^.");
  return title;
}
/** A title made safe for an import: the characters a link cannot carry become spaces. */
export const safeTitle = (value) => oneLine(String(value ?? "").replace(/[[\]|#^]/g, " ")).slice(0, WIKI_LIMITS.title).trim();
function cleanBody(value) {
  const body = String(value ?? "").replace(/\r\n?/g, "\n");
  if (body.length > WIKI_LIMITS.body) throw new WikiError(413, "La nota es demasiado larga (máx. " + WIKI_LIMITS.body.toLocaleString("es-ES") + " caracteres). Divídela en varias.");
  return body;
}
export function cleanAliases(list, ownSlug = "") {
  const seen = new Set(ownSlug ? [ownSlug] : []), out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const alias = safeTitle(item), key = slugOf(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= WIKI_LIMITS.aliases) break;
  }
  return out;
}
export function cleanTags(list) {
  const seen = new Set(), out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const tag = oneLine(item).replace(/^#+/, "").replace(/\s+/g, "-").slice(0, WIKI_LIMITS.tag), key = foldText(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= WIKI_LIMITS.tags) break;
  }
  return out;
}
export function cleanFolder(value) {
  return String(value ?? "").replace(/\\/g, "/").split("/").map(oneLine).filter((p) => p && p !== "." && p !== "..").join("/").slice(0, WIKI_LIMITS.folder).replace(/\/+$/, "");
}
const excerptOf = (body) => oneLine(maskCode(body).replace(/^---\n[\s\S]*?\n---\n/, "").replace(/[#>*_`]+/g, " ")).slice(0, 180);

// ------------------------------------------------------------------ links in Markdown
/**
 * `md` with fenced blocks and inline code spans turned into spaces (same length, same lines),
 * so nothing inside them is read as a link or a heading.
 */
export function maskCode(md) {
  let fence = null;
  const blank = (line) => " ".repeat(line.length);
  const text = String(md ?? "").split("\n").map((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.n && !line.slice(m[0].length).trim()) fence = null;
      return blank(line);
    }
    if (m) { fence = { ch: m[1][0], n: m[1].length }; return blank(line); }
    return line;
  }).join("\n");
  if (!text.includes("`")) return text;
  let out = "", i = 0;
  const none = new Set(); // run lengths with no closing run from here on
  while (i < text.length) {
    const tick = text.indexOf("`", i);
    if (tick < 0) { out += text.slice(i); break; }
    out += text.slice(i, tick);
    let n = 0;
    while (text[tick + n] === "`") n++;
    let close = -1;
    if (!none.has(n)) {
      let j = tick + n;
      while (j < text.length) {
        if (text[j] !== "`") { j++; continue; }
        let k = 0;
        while (text[j + k] === "`") k++;
        if (k === n) { close = j; break; }
        j += k;
      }
      if (close < 0) none.add(n);
    }
    if (close < 0) { out += text.slice(tick, tick + n); i = tick + n; continue; }
    out += text.slice(tick, close + n).replace(/[^\n]/g, " ");
    i = close + n;
  }
  return out;
}

const ATTACHMENT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|pdf|mp3|wav|m4a|ogg|mp4|mov|webm|zip|docx?|xlsx?|pptx?|csv|canvas|excalidraw)$/i;
const LINK = /(!?)\[\[([^[\]\n|]{1,240})(?:\|([^[\]\n]{0,240}))?\]\]/g;
/**
 * The pages a Markdown text links to, in order, once each: [{slug, target, text, heading?, embed?}].
 * `[[Título]]`, `[[Título|texto]]`, `[[carpeta/Título]]`, `[[Título#Apartado]]`, `![[Título]]`.
 * Not links: anything in a code block or a code span, an escaped `\[[`, a link to a heading
 * of the same page (`[[#Apartado]]`) and embedded files (`![[foto.png]]`).
 */
export function parseLinks(md, { limit = WIKI_LIMITS.linksPerSource } = {}) {
  const text = maskCode(md);
  const out = [], seen = new Set();
  if (!text.includes("[[")) return out;
  for (const m of text.matchAll(LINK)) {
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    let target = m[2].trim(), heading = null;
    const hash = target.indexOf("#");
    if (hash >= 0) { heading = target.slice(hash + 1).trim() || null; target = target.slice(0, hash).trim(); }
    if (!target || ATTACHMENT.test(target)) continue;
    const name = oneLine(target.split("/").pop().replace(/\.(md|markdown)$/i, ""));
    const slug = slugOf(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, target: name, text: oneLine(m[3]) || name, ...(heading ? { heading } : {}), ...(m[1] ? { embed: true } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}
/** How many `![[archivo.ext]]` a text embeds (they stay as text; the files are not imported). */
export function countEmbeds(md) {
  let n = 0;
  for (const m of maskCode(md).matchAll(LINK)) if (ATTACHMENT.test(m[2].split("#")[0].trim())) n++;
  return n;
}

/**
 * `body` with the text under one heading replaced (up to the next heading of the same or a
 * higher level). A heading that is not there is added at the end as `## heading`.
 */
export function applySection(body, heading, content) {
  const lines = String(body ?? "").split("\n"), masked = maskCode(body).split("\n");
  const wanted = foldText(oneLine(String(heading).replace(/^#+\s*/, "")));
  const headingOf = (line) => { const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line); return m ? { level: m[1].length, text: foldText(oneLine(m[2])) } : null; };
  const text = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  const at = masked.findIndex((line) => headingOf(line)?.text === wanted);
  if (at < 0) return (String(body ?? "").trimEnd() + "\n\n## " + oneLine(String(heading).replace(/^#+\s*/, "")) + "\n\n" + text + "\n").replace(/^\n+/, "");
  const level = headingOf(masked[at]).level;
  let end = masked.length;
  for (let i = at + 1; i < masked.length; i++) { const h = headingOf(masked[i]); if (h && h.level <= level) { end = i; break; } }
  return [...lines.slice(0, at + 1), "", text, ...(end < lines.length ? ["", ...lines.slice(end)] : [""])].join("\n");
}

// ------------------------------------------------------------------ cached views of the store
const STATE = new WeakMap();
function stateOf(store) {
  let s = STATE.get(store);
  if (!s) {
    s = { meta: null, links: null, search: null, watching: false };
    store.listeners.add((change) => {
      if (change?.type !== "record") return;
      if (change.kind === "wikiPages") { s.meta = null; s.search = null; }
      else if (change.kind === "wikiLinks") s.links = null;
    });
    STATE.set(store, s);
  }
  return s;
}
const forget = (store) => { const s = stateOf(store); s.meta = null; s.links = null; s.search = null; };
/** A transaction of the store; if it rolls back, nothing read meanwhile stays cached. */
function atomic(store, fn) {
  try { return store.tx(fn); } catch (error) { forget(store); throw error; }
}
const light = ({ body: _body, ...page }) => page;
/** Every page without its text: {byId, slugs, aliases()}. */
function metaOf(store) {
  const s = stateOf(store);
  if (!s.meta) {
    const byId = new Map(), slugs = new Map();
    for (const page of store.listWithout("wikiPages", ["body"])) { byId.set(page.id, page); slugs.set(page.slug, page); }
    s.meta = { byId, slugs, alias: null };
  }
  return s.meta;
}
function aliasesOf(store) {
  const meta = metaOf(store);
  if (!meta.alias) {
    meta.alias = new Map();
    for (const page of meta.byId.values()) for (const a of page.aliases || []) { const k = slugOf(a); if (k && !meta.alias.has(k)) meta.alias.set(k, page); }
  }
  return meta.alias;
}
/** After a write: the cached list follows it (an import writes thousands in one go). */
function noteWrite(store, page, removed = false) {
  const s = stateOf(store);
  s.links = null; s.search = null;
  if (!s.meta) return;
  const old = s.meta.byId.get(page.id);
  if (old && s.meta.slugs.get(old.slug) === old) s.meta.slugs.delete(old.slug);
  if (removed) s.meta.byId.delete(page.id);
  else { const p = light(page); s.meta.byId.set(page.id, p); s.meta.slugs.set(p.slug, p); }
  s.meta.alias = null;
}

/** The page a title, slug or alias names: {page (without its text), via: 'slug'|'alias'} or null. */
export function resolvePage(store, key) {
  const slug = slugOf(key);
  if (!slug) return null;
  const own = metaOf(store).slugs.get(slug);
  if (own) return { page: own, via: "slug" };
  const alias = aliasesOf(store).get(slug);
  return alias ? { page: alias, via: "alias" } : null;
}
export const getPage = (store, pageId) => store.get("wikiPages", pageId);
export const listPages = (store) => [...metaOf(store).byId.values()];

// ------------------------------------------------------------------ versions
const versionId = (pageId, revision) => pageId + ":" + String(revision).padStart(8, "0");
/** Versions of a page, oldest first (read by id prefix: the primary key, no scan). */
export function versionsOf(store, pageId) {
  return store.sql("SELECT id, data FROM records WHERE kind='wikiVersions' AND id >= ? AND id < ? ORDER BY id")
    .all(pageId + ":", pageId + ";").map((r) => store.decode("wikiVersions", r.id, r.data));
}
/**
 * Drops what the history does not need: versions of the last 30 days all stay; of older days,
 * the last one of each; and never more than the caps (oldest first; the two newest stay).
 */
export function thinVersions(store, pageId, { at = Date.now(), limits = WIKI_LIMITS } = {}) {
  const all = versionsOf(store, pageId);
  if (all.length <= 2) return 0;
  const cutoff = at - limits.versionDays * DAY;
  const keep = new Set(all.slice(-2).map((v) => v.id)), days = new Set();
  for (const v of [...all].reverse()) {
    if (Date.parse(v.at) >= cutoff) { keep.add(v.id); continue; }
    const day = String(v.at).slice(0, 10);
    if (!days.has(day)) { days.add(day); keep.add(v.id); }
  }
  let kept = all.filter((v) => keep.has(v.id));
  let bytes = kept.reduce((n, v) => n + String(v.body || "").length, 0);
  while (kept.length > 2 && (kept.length > limits.versionsMax || bytes > limits.versionsBytes)) { bytes -= String(kept[0].body || "").length; keep.delete(kept[0].id); kept = kept.slice(1); }
  let removed = 0;
  for (const v of all) if (!keep.has(v.id) && store.remove("wikiVersions", v.id)) removed++;
  return removed;
}

// ------------------------------------------------------------------ writes
function persist(store, page, { reason, effect = null, version = false, from = null }) {
  store.put("wikiPages", page);
  if (version)
    store.put("wikiVersions", {
      id: versionId(page.id, page.revision), pageId: page.id, revision: page.revision, title: page.title, body: page.body,
      by: page.updatedBy, at: page.updatedAt, reason, external: page.external || null, effect, size: page.body.length, ...(from ? { from } : {}),
    });
  store.put("wikiLinks", { id: "page:" + page.id, from: { type: "page", id: page.id }, targets: parseLinks(page.body).map(({ slug, target, text }) => ({ slug, target, text })), at: page.updatedAt });
  noteWrite(store, page);
  if (version && page.revision % WIKI_LIMITS.thinEvery === 0) thinVersions(store, page.id);
}

/**
 * A new page. `by` is PERSON or {kind:'bot', botId}; `external` marks text copied from outside
 * (see wiki-tools.mjs); `slug` forces one (imports: two files with the same name).
 * 409 when a page already has that slug.
 */
export function createPage(store, input, { by = PERSON, external = null, reason = "create", effect = null, slug = null } = {}) {
  const title = cleanTitle(input?.title), body = cleanBody(input?.body);
  return atomic(store, () => {
    const wanted = slug || slugOf(title);
    const taken = metaOf(store).slugs.get(wanted);
    if (taken) throw new WikiError(409, "Ya hay una nota con ese nombre: «" + taken.title + "».", { details: { slug: taken.slug, title: taken.title, archived: !!taken.archived } });
    const at = now();
    const page = {
      id: newId(), slug: wanted, title, body, aliases: cleanAliases(input?.aliases, wanted), folder: cleanFolder(input?.folder), tags: cleanTags(input?.tags),
      archived: false, revision: 1, createdAt: at, updatedAt: at, createdBy: by, updatedBy: by, external: external || null, size: body.length, excerpt: excerptOf(body),
    };
    persist(store, page, { reason, effect, version: true });
    return page;
  });
}

function conflictOf(store, page, yours) {
  return new WikiError(409, "La nota ha cambiado mientras la editabas. Compara los dos textos antes de guardar.", {
    revision: page.revision,
    details: {
      current: { revision: page.revision, title: page.title, body: page.body, updatedAt: page.updatedAt, updatedBy: byView(store, page.updatedBy) },
      yours: { ...(yours.title !== undefined ? { title: yours.title } : {}), ...(yours.body !== undefined ? { body: yours.body } : {}) },
      ...(typeof yours.body === "string" ? { diff: clipDiff(diffText(page.body, yours.body)) } : {}),
    },
  });
}
const clipDiff = ({ patch, added, removed, truncated }, max = 60000) => ({ patch: patch.length > max ? patch.slice(0, max) : patch, added, removed, truncated: truncated || patch.length > max });

/**
 * Changes a page: {title, body, aliases, folder, tags, archived}, whichever are given.
 * `revision` is the one the editor read: a different one is a 409 with both texts (`force`
 * skips the check: archiving, imports). A new title moves the slug and keeps the old one as an
 * alias. `external`: undefined keeps the page's mark, null clears it, an object sets it.
 * A save that changes nothing returns the page as it is, with no new revision.
 */
export function updatePage(store, pageId, changes = {}, { by = PERSON, revision = null, external, reason = "edit", effect = null, force = false, from = null } = {}) {
  return atomic(store, () => {
    const page = store.get("wikiPages", pageId);
    if (!page) throw missing();
    if (!force && revision !== page.revision) throw conflictOf(store, page, changes);
    const next = { ...page };
    if (changes.body !== undefined) next.body = cleanBody(changes.body);
    if (changes.folder !== undefined) next.folder = cleanFolder(changes.folder);
    if (changes.tags !== undefined) next.tags = cleanTags(changes.tags);
    if (changes.archived !== undefined) next.archived = !!changes.archived;
    if (changes.title !== undefined) {
      next.title = cleanTitle(changes.title);
      const slug = slugOf(next.title);
      // A page imported as «notas-2» keeps that slug while its title still folds to «notas».
      if (slug !== page.slug && slug !== slugOf(page.title)) {
        const taken = metaOf(store).slugs.get(slug);
        if (taken && taken.id !== page.id) throw new WikiError(409, "Ya hay una nota con ese nombre: «" + taken.title + "».", { details: { slug: taken.slug, title: taken.title, archived: !!taken.archived } });
        next.slug = slug;
      }
    }
    // The old slug stays as an alias: `[[Nombre antiguo]]` still opens this page.
    const given = changes.aliases !== undefined ? changes.aliases : page.aliases;
    next.aliases = cleanAliases(next.slug !== page.slug ? [...(given || []), page.slug] : given, next.slug);
    if (external !== undefined) next.external = external || null;
    const textChanged = next.body !== page.body || next.title !== page.title;
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!textChanged && same(next.aliases, page.aliases) && next.folder === page.folder && same(next.tags, page.tags) && next.archived === !!page.archived && same(next.external, page.external)) return page;
    next.revision = page.revision + 1;
    next.updatedAt = now();
    next.updatedBy = by;
    next.size = next.body.length;
    next.excerpt = excerptOf(next.body);
    if (changes.archived !== undefined) next.archivedAt = next.archived ? next.updatedAt : null;
    persist(store, next, { reason, effect, version: textChanged, from });
    return next;
  });
}

/** Deletes a page for good, with its history. What linked to it now points to a page «por crear». */
export function deletePage(store, pageId) {
  return atomic(store, () => {
    const page = store.get("wikiPages", pageId);
    if (!page) throw missing();
    for (const row of store.sql("SELECT id FROM records WHERE kind='wikiVersions' AND id >= ? AND id < ?").all(pageId + ":", pageId + ";")) store.remove("wikiVersions", row.id);
    store.remove("wikiLinks", "page:" + pageId);
    store.remove("wikiPages", pageId);
    noteWrite(store, page, true);
    return page;
  });
}

export function getVersion(store, pageId, versionKey) {
  const key = String(versionKey || "");
  const version = store.get("wikiVersions", key.includes(":") ? key : versionId(pageId, Number(key) || 0));
  if (!version || version.pageId !== pageId) throw new WikiError(404, "Esa versión ya no está en el historial.");
  return version;
}
/** The text of an old version becomes the page's text again (a new revision; nothing is lost). */
export function restoreVersion(store, pageId, versionKey, { by = PERSON, revision = null } = {}) {
  const version = getVersion(store, pageId, versionKey);
  return updatePage(store, pageId, { body: version.body }, { by, revision, reason: "restore", external: version.external || null, from: version.revision });
}

// ------------------------------------------------------------------ links: backlinks, «por crear», graph
function linksOf(store) {
  const s = stateOf(store);
  if (!s.links) {
    const records = store.list("wikiLinks"), byTarget = new Map();
    for (const record of records)
      for (const t of record.targets || []) {
        if (!byTarget.has(t.slug)) byTarget.set(t.slug, []);
        byTarget.get(t.slug).push({ record, target: t });
      }
    s.links = { records, byTarget };
  }
  return s.links;
}
/** Where a page's own links go: [{slug, target, text, exists, title, archived}]. */
export function outgoingLinks(store, page) {
  return parseLinks(page.body).map((l) => {
    const hit = resolvePage(store, l.slug);
    return { slug: hit?.page.slug || l.slug, target: l.target, text: l.text, exists: !!hit, title: hit?.page.title || l.target, ...(hit?.page.archived ? { archived: true } : {}), ...(l.heading ? { heading: l.heading } : {}) };
  });
}
/** What links to a page: {pages, messages, artifacts}, through its slug or any of its aliases. */
export function backlinksOf(store, page, { limit = WIKI_LIMITS.backlinks } = {}) {
  const meta = metaOf(store), { byTarget } = linksOf(store);
  const keys = [page.slug, ...(page.aliases || []).map(slugOf)].filter((k, i, all) => k && all.indexOf(k) === i && resolvePage(store, k)?.page.id === page.id);
  const pages = new Map(), messages = new Map(), artifacts = new Map();
  for (const key of keys)
    for (const { record, target } of byTarget.get(key) || []) {
      const from = record.from || {};
      if (from.type === "page") {
        const source = meta.byId.get(from.id);
        if (source && source.id !== page.id && !source.archived && !pages.has(source.id)) pages.set(source.id, { slug: source.slug, title: source.title, text: target.text, updatedAt: source.updatedAt });
      } else if (from.type === "message" && !messages.has(from.id)) messages.set(from.id, { id: from.id, missionId: from.missionId || null, missionTitle: from.missionId ? store.get("missions", from.missionId)?.title ?? null : null, botId: from.botId || null, role: from.role || null, at: record.at });
      else if (from.type === "artifact" && !artifacts.has(from.id)) artifacts.set(from.id, { id: from.id, title: from.title || null, missionId: from.missionId || null, at: record.at });
    }
  const byTitle = (a, b) => String(a.title).localeCompare(String(b.title), "es");
  const newest = (a, b) => String(b.at || "").localeCompare(String(a.at || ""));
  return { pages: [...pages.values()].sort(byTitle).slice(0, limit), messages: [...messages.values()].sort(newest).slice(0, 50), artifacts: [...artifacts.values()].sort(newest).slice(0, 50) };
}
/** «Por crear»: linked names that are not a page yet: [{slug, title, count, from[{slug,title}], mentions}]. */
export function missingPages(store, { limit = 500 } = {}) {
  const meta = metaOf(store), { byTarget } = linksOf(store), out = [];
  for (const [slug, sources] of byTarget) {
    if (resolvePage(store, slug)) continue;
    const from = new Map();
    let mentions = 0, title = null;
    for (const { record, target } of sources) {
      const source = record.from?.type === "page" ? meta.byId.get(record.from.id) : null;
      if (record.from?.type === "page") { if (!source || source.archived) continue; from.set(source.id, { slug: source.slug, title: source.title }); }
      else mentions++;
      title ||= target.target;
    }
    if (!from.size && !mentions) continue;
    out.push({ slug, title: title || slug, count: from.size + mentions, from: [...from.values()].slice(0, 10), mentions });
  }
  out.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "es"));
  return { missing: out.slice(0, limit), total: out.length };
}
/**
 * Nodes (pages that are not archived, and names «por crear» they link to) and edges between
 * them. Over the caps the best connected nodes stay and `truncated` says so. `focus` (a slug)
 * with `depth` keeps only what is that many links away from one page.
 */
export function graphOf(store, { nodes: maxNodes = WIKI_LIMITS.graphNodes, edges: maxEdges = WIKI_LIMITS.graphEdges, focus = "", depth = 1 } = {}) {
  const meta = metaOf(store), { records } = linksOf(store);
  const nodes = new Map(), edges = new Map();
  for (const page of meta.byId.values()) if (!page.archived) nodes.set(page.slug, { id: page.slug, title: page.title, exists: true, folder: page.folder || "", degree: 0 });
  for (const record of records) {
    if (record.from?.type !== "page") continue;
    const source = meta.byId.get(record.from.id);
    if (!source || source.archived) continue;
    for (const t of record.targets || []) {
      const hit = resolvePage(store, t.slug);
      if (hit?.page.archived) continue;
      const to = hit ? hit.page.slug : t.slug;
      if (to === source.slug) continue;
      if (!nodes.has(to)) nodes.set(to, { id: to, title: t.target || to, exists: false, folder: "", degree: 0 });
      edges.set(source.slug + "\u0000" + to, { from: source.slug, to });
    }
  }
  let keep = null;
  const start = focus ? resolvePage(store, focus)?.page.slug || slugOf(focus) : "";
  if (start && nodes.has(start)) {
    const near = new Map();
    for (const e of edges.values()) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) { if (!near.has(a)) near.set(a, []); near.get(a).push(b); }
    keep = new Set([start]);
    let edge = [start];
    for (let d = 0; d < Math.max(1, Math.min(4, depth)) && edge.length; d++) {
      const next = [];
      for (const id of edge) for (const n of near.get(id) || []) if (!keep.has(n)) { keep.add(n); next.push(n); }
      edge = next;
    }
  }
  let list = [...edges.values()].filter((e) => !keep || (keep.has(e.from) && keep.has(e.to)));
  for (const e of list) { nodes.get(e.from).degree++; nodes.get(e.to).degree++; }
  let shown = [...nodes.values()].filter((n) => !keep || keep.has(n.id));
  const total = { nodes: shown.length, edges: list.length };
  if (shown.length > maxNodes) {
    shown = shown.sort((a, b) => (b.id === start) - (a.id === start) || b.degree - a.degree || Number(b.exists) - Number(a.exists) || a.title.localeCompare(b.title, "es")).slice(0, maxNodes);
    const ids = new Set(shown.map((n) => n.id));
    list = list.filter((e) => ids.has(e.from) && ids.has(e.to));
  }
  if (list.length > maxEdges) list = list.slice(0, maxEdges);
  return { nodes: shown, edges: list, total, truncated: shown.length < total.nodes || list.length < total.edges };
}

// ------------------------------------------------------------------ links from messages and deliverables
/**
 * Keeps wikiLinks up to date for chat messages and deliverables that write `[[Título]]`
 * (their backlinks show in the page). Only texts that carry `[[` cost anything; incognito
 * conversations are never indexed. Idempotent per store.
 */
export function watchWikiLinks(store) {
  const s = stateOf(store);
  if (s.watching) return;
  s.watching = true;
  store.listeners.add((change) => {
    if (change?.type !== "record" || (change.kind !== "messages" && change.kind !== "artifacts")) return;
    try { indexSource(store, change); } catch (error) { console.warn("Notas: no se pudieron anotar los enlaces de " + change.kind + ": " + error.message); }
  });
}
function indexSource(store, change) {
  const type = change.kind === "messages" ? "message" : "artifact", linkId = type + ":" + change.id;
  if (change.op === "remove") return void store.remove("wikiLinks", linkId);
  const d = change.data || {};
  const text = type === "message" ? d.text : d.content;
  const linked = typeof text === "string" && text.includes("[[") && !(type === "message" && d.role === "system");
  const targets = linked && !(d.missionId && store.get("missions", d.missionId)?.incognito) ? parseLinks(text.slice(0, 400000), { limit: 100 }).map(({ slug, target, text: label }) => ({ slug, target, text: label })) : [];
  if (!targets.length) { if (change.op === "update") store.remove("wikiLinks", linkId); return; }
  if (JSON.stringify(store.get("wikiLinks", linkId)?.targets) === JSON.stringify(targets)) return;
  store.put("wikiLinks", {
    id: linkId, targets, at: d.at || d.createdAt || now(),
    from: { type, id: change.id, missionId: d.missionId || null, ...(type === "artifact" ? { title: String(d.title || "").slice(0, 200) } : { role: d.role || null, botId: d.botId || null }) },
  });
}

// ------------------------------------------------------------------ search
function searchIndex(store) {
  const s = stateOf(store);
  if (!s.search) {
    const pages = store.list("wikiPages");
    // The title counts three times; aliases, tags and folder once, with the text.
    s.search = buildIndex(pages.map((page) => ({ id: page.id, page, text: [page.title, page.title, page.title, (page.aliases || []).join(" "), (page.tags || []).join(" "), page.folder || "", page.body].join("\n") })));
  }
  return s.search;
}
function snippetOf(body, query, width = 180) {
  const plain = oneLine(body), folded = foldText(plain);
  const words = foldText(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  let at = -1;
  for (const w of words) { const i = folded.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return plain.slice(0, width) + (plain.length > width ? "…" : "");
  const start = Math.max(0, at - Math.floor(width / 3));
  return (start ? "…" : "") + plain.slice(start, start + width) + (start + width < plain.length ? "…" : "");
}
const inFolder = (page, folder) => !folder || page.folder === folder || String(page.folder || "").startsWith(folder + "/");
const hasTag = (page, tag) => !tag || (page.tags || []).some((t) => foldText(t) === tag);
/**
 * Pages about `query`, best first: [{page (with its text), score, snippet}]. BM25 over title
 * (weighted), aliases, tags and text with Spanish folding and stems (memory-rank.mjs); a
 * title or alias that is or contains the query goes up; what only matches literally (a short
 * word, a code) is added after.
 */
export function searchPages(store, query, { limit = WIKI_LIMITS.searchResults, folder = "", tag = "", archived = false } = {}) {
  const q = oneLine(query).slice(0, 400), literal = foldText(q);
  if (!literal) return [];
  const index = searchIndex(store);
  const wantedFolder = cleanFolder(folder), wantedTag = foldText(String(tag || "").replace(/^#/, ""));
  const accept = (doc) => !!doc.page.archived === !!archived && inFolder(doc.page, wantedFolder) && hasTag(doc.page, wantedTag);
  const scores = new Map();
  for (const hit of rank(index, q, { accept, floor: 0.05 })) scores.set(hit.doc.id, { page: hit.doc.page, score: hit.score });
  // The texts are only read letter by letter when the ranking left room (a short word, a code).
  const scanTexts = scores.size < limit && literal.length >= 2;
  for (const { doc } of index.entries) {
    if (!accept(doc)) continue;
    const page = doc.page, title = foldText(page.title), names = (page.aliases || []).map(foldText);
    let entry = scores.get(page.id);
    const bonus = title === literal ? 3 : names.includes(literal) ? 2.5 : title.startsWith(literal) ? 2 : title.includes(literal) || names.some((n) => n.includes(literal)) ? 1.5 : 0;
    if (!entry && !bonus && !(scanTexts && foldText(page.body).includes(literal))) continue;
    if (!entry) scores.set(page.id, (entry = { page, score: 0.05 }));
    if (bonus) entry.score = entry.score * bonus + bonus;
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || String(b.page.updatedAt).localeCompare(String(a.page.updatedAt)))
    .slice(0, limit)
    .map(({ page, score }) => ({ page, score: Math.round(score * 1000) / 1000, snippet: snippetOf(page.body, q) }));
}

// ------------------------------------------------------------------ views (docs/CONTRACT.md §16)
export function byView(store, by, names = null) {
  if (by?.kind !== "bot") return { kind: "person" };
  const name = names?.get(by.botId) ?? store.get("bots", by.botId)?.name ?? by.botId;
  names?.set(by.botId, name);
  return { kind: "bot", botId: by.botId, name };
}
/** A page for a list: no text. `external`: it carries content copied from outside. */
export function summaryOf(store, page, names = null) {
  return {
    id: page.id, slug: page.slug, title: page.title, aliases: page.aliases || [], folder: page.folder || "", tags: page.tags || [],
    archived: !!page.archived, revision: page.revision, size: page.size ?? 0, excerpt: page.excerpt || "",
    createdAt: page.createdAt, updatedAt: page.updatedAt, updatedBy: byView(store, page.updatedBy, names), external: !!page.external,
  };
}
const externalView = (store, mark) => (mark ? { at: mark.at || null, label: mark.label || "Incluye contenido copiado de fuera", by: byView(store, mark.by), missionId: mark.missionId || null, suspicious: !!mark.suspicious } : null);
/** A whole page: its text, where its links go and what links to it. */
export function pageView(store, page) {
  return {
    ...summaryOf(store, page), body: page.body, external: externalView(store, page.external),
    links: outgoingLinks(store, page), backlinks: backlinksOf(store, page),
  };
}
export function versionSummary(store, v, previous = null, names = null) {
  return {
    id: v.id, revision: v.revision, title: v.title, by: byView(store, v.by, names), at: v.at, reason: v.reason || "edit", size: v.size ?? String(v.body || "").length,
    delta: previous ? (v.size ?? 0) - (previous.size ?? 0) : null, external: !!v.external, ...(v.from ? { from: v.from } : {}),
  };
}
/** Folders and tags in use (pages that are not archived), with how many pages each has. */
export function facetsOf(store) {
  const folders = new Map(), tags = new Map();
  let pages = 0, archived = 0;
  for (const page of metaOf(store).byId.values()) {
    if (page.archived) { archived++; continue; }
    pages++;
    if (page.folder) folders.set(page.folder, (folders.get(page.folder) || 0) + 1);
    for (const t of page.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
  }
  const list = (map) => [...map].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { folders: list(folders), tags: list(tags), counts: { pages, archived } };
}
/** Pages for a list, filtered and sorted: {pages, total}. `archived`: false | true | 'all'. */
export function pageList(store, { folder = "", tag = "", archived = false, sort = "updated", offset = 0, limit = WIKI_LIMITS.pageSize } = {}) {
  const wantedFolder = cleanFolder(folder), wantedTag = foldText(String(tag || "").replace(/^#/, ""));
  const all = [...metaOf(store).byId.values()].filter((p) => (archived === "all" || !!p.archived === !!archived) && inFolder(p, wantedFolder) && hasTag(p, wantedTag));
  all.sort(sort === "title" ? (a, b) => a.title.localeCompare(b.title, "es") : sort === "created" ? (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) : (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { pages: all.slice(offset, offset + limit), total: all.length };
}
/** Tool cards (tools.mjs extraToolCard): what the room shows of a wiki call, never the page's text. */
export function wikiToolCard(name, args = {}, r = {}) {
  const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  if (name === "wiki_search") return { type: "search", query: clip(args.query, 120), count: Array.isArray(r.results) ? r.results.length : null };
  if (name === "wiki_read") return { type: "note", action: "read", title: clip(r.title || args.page, 140), slug: r.slug || null, found: r.found !== false };
  if (name === "wiki_write")
    return { type: "note", action: ["create", "replace", "append", "section"].includes(args.action) ? args.action : "replace", title: clip(r.title || args.page, 140), slug: r.slug || null, section: clip(args.section, 120), saved: r.saved === true, created: !!r.created, revision: r.revision ?? null, outside: !!r.outside };
  return null;
}
/** `[[links]]` of a chat message or a deliverable → {slug, exists, title, archived} for each name. */
export function resolveTargets(store, targets) {
  const out = {};
  for (const raw of targets) {
    const key = String(raw ?? "");
    const name = oneLine(key.split("|")[0].split("#")[0].split("/").pop());
    const hit = resolvePage(store, name);
    out[key] = hit ? { slug: hit.page.slug, exists: true, title: hit.page.title, archived: !!hit.page.archived, ...(hit.via === "alias" ? { alias: true } : {}) } : { slug: slugOf(name), exists: false, title: name, archived: false };
  }
  return out;
}
