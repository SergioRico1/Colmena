import express from "express";
import path from "node:path";
import { z } from "zod";
import { HttpError, check } from "./shared.mjs";
import { diffText } from "../linediff.mjs";
import {
  WIKI_LIMITS, PERSON, slugOf, resolvePage, getPage, createPage, updatePage, deletePage, restoreVersion, getVersion, versionsOf,
  pageView, summaryOf, versionSummary, byView, facetsOf, pageList, searchPages, graphOf, missingPages, resolveTargets, watchWikiLinks,
} from "../wiki.mjs";
import { IMPORT_LIMITS, planImport, applyImport, exportZip, pageMarkdown, fileNameOf } from "../wiki-import.mjs";

// «Notas»: the wiki the person and the bots share (server/wiki.mjs; docs/CONTRACT.md §16).
// Everything here is the person's own doing (PERSON); the bots write through wiki-tools.mjs.

/** JSON parser up to 40 MB only for the import (a zip of a vault in base64). Mounted before the app's own parser. */
export const wikiImportParser = (() => {
  const parse = express.json({ limit: "40mb" });
  return (req, res, next) => (req.method === "POST" && /^\/api\/wiki\/import\/?$/.test(req.path) ? parse(req, res, next) : next());
})();

const asciiName = (name) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
const disposition = (name) => `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;

const title = z.string().trim().min(1).max(WIKI_LIMITS.title);
const body = z.string().max(WIKI_LIMITS.body);
const aliases = z.array(z.string().trim().min(1).max(WIKI_LIMITS.title)).max(WIKI_LIMITS.aliases);
const tags = z.array(z.string().trim().min(1).max(WIKI_LIMITS.tag)).max(WIKI_LIMITS.tags);
const folder = z.string().trim().max(WIKI_LIMITS.folder);
const revision = z.number({ required_error: "Falta la revisión de la nota que has leído.", invalid_type_error: "La revisión no es válida." }).int().min(1);
const count = (max, fallback) => z.coerce.number().int().min(0).max(max).default(fallback);

export function registerWikiRoutes(app, { store, validateFolder }) {
  watchWikiLinks(store);
  const scratch = path.join(store.directory, "cache", "wiki-import");
  /** The page a route names (slug, title or alias), with its text. 404 says which slug it would be. */
  const pageOf = (key) => {
    const hit = resolvePage(store, key);
    if (!hit) throw Object.assign(new HttpError(404, "Nota no encontrada."), { details: { slug: slugOf(key), exists: false } });
    return { page: getPage(store, hit.page.id), via: hit.via };
  };
  const full = (page) => ({ ...pageView(store, page), versions: versionsOf(store, page.id).length });

  // ------------------------------------------------------------ list, search, facets
  app.get("/api/wiki/pages", (req, res) => {
    const q = check(z.object({
      q: z.string().trim().max(300).default(""), folder: folder.default(""), tag: z.string().trim().max(WIKI_LIMITS.tag).default(""),
      archived: z.enum(["0", "1", "all"]).default("0"), sort: z.enum(["updated", "title", "created"]).default("updated"),
      offset: count(1e6, 0), limit: count(WIKI_LIMITS.pageMax, WIKI_LIMITS.pageSize),
    }).strict(), { ...req.query });
    const archived = q.archived === "all" ? "all" : q.archived === "1";
    const names = new Map();
    let pages, total;
    if (q.q) {
      // With words: ranked (searchPages), best first; `archived=all` is not a search filter.
      const hits = searchPages(store, q.q, { limit: 1000, folder: q.folder, tag: q.tag, archived: archived === true });
      total = hits.length;
      pages = hits.slice(q.offset, q.offset + (q.limit || WIKI_LIMITS.pageSize)).map((h) => ({ ...summaryOf(store, h.page, names), snippet: h.snippet, score: h.score }));
    } else {
      const list = pageList(store, { folder: q.folder, tag: q.tag, archived, sort: q.sort, offset: q.offset, limit: q.limit || WIKI_LIMITS.pageSize });
      total = list.total;
      pages = list.pages.map((p) => summaryOf(store, p, names));
    }
    res.json({ pages, total, offset: q.offset, limit: q.limit || WIKI_LIMITS.pageSize, ...facetsOf(store) });
  });
  app.get("/api/wiki/search", (req, res) => {
    const q = check(z.object({ q: z.string().trim().min(1).max(300), limit: count(50, WIKI_LIMITS.searchResults), folder: folder.default(""), tag: z.string().trim().max(WIKI_LIMITS.tag).default("") }).strict(), { ...req.query });
    const names = new Map();
    res.json({ results: searchPages(store, q.q, { limit: q.limit || WIKI_LIMITS.searchResults, folder: q.folder, tag: q.tag }).map((h) => ({ ...summaryOf(store, h.page, names), snippet: h.snippet, score: h.score })) });
  });

  // ------------------------------------------------------------ links: resolver, «por crear», graph
  // `[[links]]` in chat messages and deliverables: the names as written → {slug, exists, title}.
  app.post("/api/wiki/resolve", (req, res) => {
    const { targets } = check(z.object({ targets: z.array(z.string().max(300)).max(300) }).strict(), req.body);
    res.json({ results: resolveTargets(store, targets) });
  });
  app.get("/api/wiki/missing", (_req, res) => res.json(missingPages(store)));
  app.get("/api/wiki/graph", (req, res) => {
    const q = check(z.object({ nodes: count(WIKI_LIMITS.graphNodesMax, WIKI_LIMITS.graphNodes), focus: z.string().trim().max(WIKI_LIMITS.title).default(""), depth: count(4, 1) }).strict(), { ...req.query });
    res.json(graphOf(store, { nodes: q.nodes || WIKI_LIMITS.graphNodes, focus: q.focus, depth: q.depth || 1 }));
  });

  // ------------------------------------------------------------ import and export
  // Two calls: without `apply` it only says what it would do (and gives `planId`); with `apply`
  // and that `planId` it does exactly that, or 409 if what is there changed in between.
  app.post("/api/wiki/import", async (req, res) => {
    const data = check(z.object({
      source: z.discriminatedUnion("type", [
        z.object({ type: z.literal("folder"), path: z.string().trim().min(1).max(1000) }).strict(),
        z.object({ type: z.literal("zip"), data: z.string().min(1).max(Math.ceil(IMPORT_LIMITS.zipBytes * 1.4)), name: z.string().trim().max(200).optional() }).strict(),
        z.object({ type: z.literal("files"), files: z.array(z.object({ path: z.string().min(1).max(600), content: z.string().max(IMPORT_LIMITS.fileBytes) }).strict()).min(1).max(IMPORT_LIMITS.entries) }).strict(),
      ]),
      apply: z.boolean().default(false), planId: z.string().trim().max(64).optional(),
    }).strict(), req.body);
    let source = data.source;
    if (source.type === "folder") source = { type: "folder", path: await validateFolder(source.path, store.directory) };
    if (source.type === "zip") {
      const bytes = Buffer.from(source.data.replace(/^data:[^,]*,/, ""), "base64");
      if (!bytes.length) throw new HttpError(400, "Ese archivo no es un zip que se pueda abrir.");
      if (bytes.length > IMPORT_LIMITS.zipBytes) throw new HttpError(413, "El zip es demasiado grande (máx. " + Math.round(IMPORT_LIMITS.zipBytes / 1024 / 1024) + " MB).");
      source = { type: "zip", data: bytes };
    }
    const plan = await planImport(store, source, { scratch });
    if (!data.apply) return res.json({ applied: false, ...plan.view });
    if (!data.planId) throw new HttpError(400, "Revisa primero lo que se va a traer.");
    if (data.planId !== plan.planId) throw Object.assign(new HttpError(409, "Lo que hay en el origen o en tus notas ha cambiado desde que lo revisaste. Revísalo de nuevo."), { details: { applied: false, ...plan.view } });
    const done = applyImport(store, plan, { by: PERSON });
    res.json({ applied: true, ...plan.view, created: done.created, updated: done.updated });
  });
  app.get("/api/wiki/export", async (req, res) => {
    const q = check(z.object({ archived: z.enum(["0", "1"]).default("0") }).strict(), { ...req.query });
    const { buffer } = await exportZip(store, { archived: q.archived === "1" });
    res.set({ "Content-Type": "application/zip", "Content-Disposition": disposition("Notas de Colmena " + new Date().toISOString().slice(0, 10) + ".zip") });
    res.send(buffer);
  });

  // ------------------------------------------------------------ one page
  app.post("/api/wiki/pages", (req, res) => {
    const data = check(z.object({ title, body: body.default(""), aliases: aliases.default([]), folder: folder.default(""), tags: tags.default([]) }).strict(), req.body);
    res.status(201).json(full(createPage(store, data, { by: PERSON })));
  });
  app.get("/api/wiki/pages/:slug", (req, res) => {
    const { page, via } = pageOf(req.params.slug);
    res.json({ ...full(page), ...(via === "alias" ? { redirectedFrom: slugOf(req.params.slug) } : {}) });
  });
  // Text, aliases, folder and tags. `revision` is the one you read: if the page changed since
  // (a bot, another window) nothing is saved and the answer is 409 with both versions.
  app.patch("/api/wiki/pages/:slug", (req, res) => {
    const { revision: read, ...changes } = check(z.object({ revision, body: body.optional(), aliases: aliases.optional(), folder: folder.optional(), tags: tags.optional() }).strict(), req.body);
    res.json(full(updatePage(store, pageOf(req.params.slug).page.id, changes, { by: PERSON, revision: read })));
  });
  // A new title: the slug follows it and the old one stays as an alias (links keep working).
  app.post("/api/wiki/pages/:slug/rename", (req, res) => {
    const data = check(z.object({ title, revision }).strict(), req.body);
    res.json(full(updatePage(store, pageOf(req.params.slug).page.id, { title: data.title }, { by: PERSON, revision: data.revision, reason: "rename" })));
  });
  for (const [route, archived] of [["archive", true], ["restore", false]])
    app.post("/api/wiki/pages/:slug/" + route, (req, res) => {
      check(z.object({}).strict(), req.body);
      res.json(full(updatePage(store, pageOf(req.params.slug).page.id, { archived }, { by: PERSON, force: true, reason: route })));
    });
  // «Lo he revisado»: the page stops being marked as outside content.
  app.post("/api/wiki/pages/:slug/trust", (req, res) => {
    const data = check(z.object({ revision }).strict(), req.body);
    res.json(full(updatePage(store, pageOf(req.params.slug).page.id, {}, { by: PERSON, revision: data.revision, external: null, reason: "trust" })));
  });
  app.delete("/api/wiki/pages/:slug", (req, res) => {
    const { page } = pageOf(req.params.slug);
    if (!page.archived) throw new HttpError(409, "Archiva la nota antes de borrarla para siempre.");
    deletePage(store, page.id);
    res.json({ ok: true });
  });
  app.get("/api/wiki/pages/:slug/export", (req, res) => {
    const { page } = pageOf(req.params.slug);
    res.set({ "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": disposition(fileNameOf(page.title) + ".md") });
    res.send(pageMarkdown(page));
  });

  // ------------------------------------------------------------ versions
  app.get("/api/wiki/pages/:slug/versions", (req, res) => {
    const { page } = pageOf(req.params.slug);
    const all = versionsOf(store, page.id), names = new Map();
    res.json({ revision: page.revision, versions: all.map((v, i) => versionSummary(store, v, all[i - 1] || null, names)).reverse() });
  });
  app.get("/api/wiki/pages/:slug/versions/:version", (req, res) => {
    const { page } = pageOf(req.params.slug);
    const v = getVersion(store, page.id, req.params.version);
    // What restoring it would change in the page as it is now.
    const { patch, added, removed, truncated } = diffText(page.body, v.body);
    res.json({ ...versionSummary(store, v), body: v.body, by: byView(store, v.by), current: v.revision === page.revision && v.body === page.body, diff: { patch: patch.slice(0, 200000), added, removed, truncated: truncated || patch.length > 200000 } });
  });
  app.post("/api/wiki/pages/:slug/versions/:version/restore", (req, res) => {
    const data = check(z.object({ revision }).strict(), req.body);
    const { page } = pageOf(req.params.slug);
    res.json(full(restoreVersion(store, page.id, req.params.version, { by: PERSON, revision: data.revision })));
  });
}
