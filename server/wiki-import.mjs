// «Notas»: bringing in a folder or a zip of Markdown files the way Obsidian keeps them, and
// taking the notes out again.
//
// Import: `[[links]]` stay as they are; the front matter gives title, aliases and tags; the
// folder of each file becomes the note's folder; images and other files are not imported
// (counted). Always in two calls: a plan (what would be created, updated or left out) and,
// only then, the same plan applied. Nothing is written by the plan.
// Paths: every one goes through files.mjs `safePath` (no «..», no absolute path, no drive,
// no symbolic link out of the folder), also the names inside a zip, which never touch the disk.
// What is read is text for a note, nothing else: no file here is run or followed.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { safePath } from "./files.mjs";
import {
  WIKI_LIMITS, WikiError, PERSON, slugOf, safeTitle, cleanAliases, cleanTags, cleanFolder, parseLinks, countEmbeds,
  resolvePage, getPage, createPage, updatePage, listPages,
} from "./wiki.mjs";

export const IMPORT_LIMITS = Object.freeze({
  notes: 2000, entries: 20000, fileBytes: 1024 * 1024, totalBytes: 60 * 1024 * 1024, zipBytes: 25 * 1024 * 1024,
  depth: 16, listed: 500, frontMatter: 20000,
});
const MARKDOWN = /\.(md|markdown)$/i;
const tooMany = () => new WikiError(413, "Hay demasiadas notas para traerlas de una vez (máx. " + IMPORT_LIMITS.notes + "). Tráelas por carpetas.");
const tooBig = () => new WikiError(413, "Es demasiado grande para traerlo de una vez (máx. " + Math.round(IMPORT_LIMITS.totalBytes / 1024 / 1024) + " MB). Tráelo por carpetas.");

// ------------------------------------------------------------------ front matter
const strings = (value) => (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).filter((x) => typeof x === "string" || typeof x === "number").map(String);
/** {data, body}: the YAML block at the top (if it is one) and the text after it. */
export function frontMatter(text) {
  const clean = String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(clean);
  if (!m || m[1].length > IMPORT_LIMITS.frontMatter) return { data: {}, body: clean };
  let data = null;
  try { data = parseYaml(m[1]); } catch { return { data: {}, body: clean }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { data: {}, body: clean };
  return { data, body: clean.slice(m[0].length).replace(/^\n+/, "") };
}
const fieldsOf = (data) => ({
  title: typeof data.title === "string" || typeof data.title === "number" ? String(data.title) : "",
  aliases: strings(data.aliases ?? data.alias),
  tags: strings(typeof (data.tags ?? data.tag) === "string" ? String(data.tags ?? data.tag).split(/[\s,]+/) : data.tags ?? data.tag),
});
/** A page as a Markdown file: front matter (title, aliases, tags) and its text. */
export function pageMarkdown(page) {
  const head = { title: page.title, ...(page.aliases?.length ? { aliases: page.aliases } : {}), ...(page.tags?.length ? { tags: page.tags } : {}) };
  return "---\n" + toYaml(head) + "---\n\n" + String(page.body || "").replace(/^\n+/, "") + (String(page.body || "").endsWith("\n") ? "" : "\n");
}

// ------------------------------------------------------------------ sources → items
const posix = (p) => String(p ?? "").replace(/\\/g, "/"); // separators only: a path is never «fixed», it is accepted or refused
/** True when files.mjs safePath accepts `rel` under an empty folder (a name that does not exist is fine). */
async function allowed(scratch, rel) {
  try { await safePath(scratch, rel); return true; } catch (error) { return error?.code === "ENOENT"; }
}
const hidden = (rel) => rel.split("/").some((part) => part.startsWith("."));

/** Files of a folder of this computer: [{path, size, text()}], never following a link out of it. */
async function folderItems(root, out) {
  const walk = async (rel, depth) => {
    if (depth > IMPORT_LIMITS.depth) return;
    let entries;
    try { entries = await readdir(rel ? await safePath(root, rel) : root, { withFileTypes: true }); } catch { out.rejected.push({ path: rel, reason: "No se pudo abrir esa carpeta." }); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = rel ? rel + "/" + entry.name : entry.name;
      if (entry.name.startsWith(".")) { out.ignored++; continue; }
      if (++out.seen > IMPORT_LIMITS.entries) throw tooMany();
      if (entry.isSymbolicLink()) { out.rejected.push({ path: child, reason: "Es un enlace a otra carpeta: no se sigue." }); continue; }
      if (entry.isDirectory()) { await walk(child, depth + 1); continue; }
      if (!entry.isFile()) continue;
      let target;
      try { target = await safePath(root, child); } catch { out.rejected.push({ path: child, reason: "Ruta no permitida." }); continue; }
      const size = (await lstat(target)).size;
      out.items.push({ path: child, size, text: () => readFile(target, "utf8") });
    }
  };
  await walk("", 0);
}

async function zipItems(buffer, scratch, out) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { throw new WikiError(400, "Ese archivo no es un zip que se pueda abrir."); }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > IMPORT_LIMITS.entries) throw tooMany();
  // A zip of a whole vault usually has one folder at the top: it is not part of the notes' folders.
  const names = files.map((f) => posix(f.unsafeOriginalName || f.name));
  const tops = new Set(names.map((n) => n.split("/")[0]));
  const strip = tops.size === 1 && names.every((n) => n.includes("/")) && ![...tops][0].startsWith(".") && [...tops][0] !== ".." ? [...tops][0].length + 1 : 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], rel = names[i].slice(strip);
    if (!(await allowed(scratch, rel))) { out.rejected.push({ path: names[i].slice(0, 300), reason: "Ruta no permitida." }); continue; }
    if (hidden(rel)) { out.ignored++; continue; }
    const size = Number(file._data?.uncompressedSize) || 0;
    out.items.push({ path: rel, size, text: () => file.async("string") });
  }
}

async function listItems(list, scratch, out) {
  for (const file of list) {
    const rel = posix(file.path);
    if (!(await allowed(scratch, rel))) { out.rejected.push({ path: rel.slice(0, 300), reason: "Ruta no permitida." }); continue; }
    if (hidden(rel)) { out.ignored++; continue; }
    out.items.push({ path: rel, size: Buffer.byteLength(file.content || "", "utf8"), text: async () => String(file.content || "") });
  }
}

// ------------------------------------------------------------------ the plan
const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
/**
 * Reads a source and says what bringing it in would do, without writing anything:
 * {planId, counts, create[], update[], same[], skipped[], rejected[], attachments, missing[]}.
 * `source`: {type:'folder', path} (already checked by the caller), {type:'zip', data: Buffer}
 * or {type:'files', files:[{path, content}]}. `scratch`: an empty folder for the path checks.
 * The entries keep their text in `entries` (not for the client) so the plan can be applied.
 */
export async function planImport(store, source, { scratch }) {
  const out = { items: [], rejected: [], ignored: 0, seen: 0 };
  if (source.type === "folder") await folderItems(source.path, out);
  else if (source.type === "zip") await zipItems(source.data, scratch, out);
  else await listItems(source.files, scratch, out);
  // A fixed order whatever the system's language: files nearer the top first (so of two notes
  // with the same name the one higher up keeps the plain slug), then by path.
  const depth = (p) => p.split("/").length;
  out.items.sort((a, b) => depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const skipped = [], entries = [], taken = new Map();
  let attachments = 0, bytes = 0, embeds = 0;
  for (const item of out.items) {
    if (!MARKDOWN.test(item.path)) { attachments++; continue; }
    if (entries.length >= IMPORT_LIMITS.notes) throw tooMany();
    if (item.size > IMPORT_LIMITS.fileBytes) { skipped.push({ path: item.path, reason: "Es demasiado grande (más de 1 MB)." }); continue; }
    bytes += item.size;
    if (bytes > IMPORT_LIMITS.totalBytes) throw tooBig();
    let text;
    try { text = await item.text(); } catch { skipped.push({ path: item.path, reason: "No se pudo leer." }); continue; }
    if (text.length > IMPORT_LIMITS.fileBytes) { skipped.push({ path: item.path, reason: "Es demasiado grande (más de 1 MB)." }); continue; }
    if (text.includes("\u0000")) { skipped.push({ path: item.path, reason: "No es un archivo de texto." }); continue; }
    const { data, body } = frontMatter(text);
    if (body.length > WIKI_LIMITS.body) { skipped.push({ path: item.path, reason: "Es demasiado larga para una nota." }); continue; }
    const fields = fieldsOf(data);
    const title = safeTitle(fields.title) || safeTitle(path.posix.basename(item.path).replace(MARKDOWN, ""));
    const base = slugOf(title);
    if (!title || !base) { skipped.push({ path: item.path, reason: "No tiene un nombre que sirva de título." }); continue; }
    // Two files with the same name (in different folders): the second one gets its own slug.
    let slug = base, n = 2;
    while (taken.has(slug)) slug = base + "-" + n++;
    taken.set(slug, item.path);
    const folder = cleanFolder(path.posix.dirname(item.path) === "." ? "" : path.posix.dirname(item.path));
    const existing = resolvePage(store, slug);
    const page = existing?.via === "slug" ? getPage(store, existing.page.id) : null;
    const tags = cleanTags(fields.tags);
    // What the page already answers to (old names after a rename) is kept next to the file's aliases.
    const aliases = cleanAliases([...fields.aliases, ...(page?.aliases || [])], slug);
    embeds += countEmbeds(body);
    const action = !page ? "create" : page.body === body && page.folder === folder && sameList(page.tags, tags) && sameList(page.aliases, aliases) && !page.archived && page.title === title ? "same" : "update";
    entries.push({ path: item.path, title, slug, folder, aliases, tags, body, action, pageId: page?.id || null, links: parseLinks(body).length, size: body.length, ...(slug !== base ? { renamed: true } : {}) });
  }

  // Links that would still point to a note «por crear» once everything is in.
  const known = new Set([...listPages(store).flatMap((p) => [p.slug, ...(p.aliases || []).map(slugOf)]), ...entries.flatMap((e) => [e.slug, ...e.aliases.map(slugOf)])]);
  const missing = new Map();
  for (const e of entries) for (const l of parseLinks(e.body)) if (!known.has(l.slug) && !missing.has(l.slug)) missing.set(l.slug, l.target);

  const brief = ({ path: p, title, slug, folder, links, size, renamed }) => ({ path: p, title, slug, folder, links, size, ...(renamed ? { renamed: true } : {}) });
  const of = (action) => entries.filter((e) => e.action === action);
  const planId = createHash("sha256").update(JSON.stringify([
    entries.map((e) => [e.path, e.slug, e.action, e.title, e.folder, e.aliases, e.tags, createHash("sha256").update(e.body).digest("hex")]),
    skipped, out.rejected, attachments,
  ])).digest("hex").slice(0, 32);
  const cut = (list) => list.slice(0, IMPORT_LIMITS.listed);
  return {
    planId, entries,
    view: {
      planId,
      counts: { create: of("create").length, update: of("update").length, same: of("same").length, skipped: skipped.length, rejected: out.rejected.length, attachments, embeds, ignored: out.ignored, missing: missing.size },
      create: cut(of("create")).map(brief), update: cut(of("update")).map(brief), same: cut(of("same")).map(brief),
      skipped: cut(skipped), rejected: cut(out.rejected),
      missing: [...missing].slice(0, 50).map(([slug, title]) => ({ slug, title })),
      truncated: entries.length > IMPORT_LIMITS.listed || skipped.length > IMPORT_LIMITS.listed || out.rejected.length > IMPORT_LIMITS.listed,
    },
  };
}

/** Writes a plan: every note in one transaction (all of them, or none). Returns the slugs written. */
export function applyImport(store, plan, { by = PERSON } = {}) {
  const created = [], updated = [];
  store.tx(() => {
    for (const e of plan.entries) {
      if (e.action === "create") created.push(createPage(store, { title: e.title, body: e.body, aliases: e.aliases, folder: e.folder, tags: e.tags }, { by, reason: "import", slug: e.slug }).slug);
      else if (e.action === "update") updated.push(updatePage(store, e.pageId, { title: e.title, body: e.body, aliases: e.aliases, folder: e.folder, tags: e.tags, archived: false }, { by, reason: "import", force: true }).slug);
    }
  });
  return { created, updated };
}

// ------------------------------------------------------------------ export
/** A file name that every system takes: «Acme: plan 2026?» → «Acme- plan 2026-». */
export const fileNameOf = (title) => String(title || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/, "").slice(0, 120).trim() || "nota";
/** Every page (archived ones too when asked) as a zip of Markdown files in their folders. */
export async function exportZip(store, { archived = false } = {}) {
  const zip = new JSZip(), used = new Set();
  let count = 0;
  for (const page of store.list("wikiPages")) {
    if (page.archived && !archived) continue;
    const folder = cleanFolder(page.folder).split("/").filter(Boolean).map(fileNameOf).join("/");
    const base = (folder ? folder + "/" : "") + fileNameOf(page.title);
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) name = base + " (" + n++ + ")";
    used.add(name.toLowerCase());
    zip.file(name + ".md", pageMarkdown(page), { date: new Date(page.updatedAt || Date.now()) });
    count++;
  }
  return { count, buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) };
}
