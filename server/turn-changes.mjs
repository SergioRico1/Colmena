// «Archivos cambiados» (the card that closes a bot's turn in chats and rooms) and its
// before/after comparison. Both read the turn's own restore points (checkpoints.mjs): what
// the files were when the turn started and when it ended, whatever happened to them since.
//
//   GET /api/missions/:id/checkpoints/:cp/changes          the files, each with its line or size delta
//   GET /api/missions/:id/checkpoints/:cp/diff?path&scope  one file: a unified patch of its text
//                                                          (Word/Excel/PowerPoint: of their text) or
//                                                          «visual» (images, PDF, old Office: side by side)
//   GET /api/missions/:id/checkpoints/:cp/blob?path&scope&side=before|after   an image of one side
//   GET /api/missions/:id/checkpoints/:cp/visual?path&scope&side              pages of one side (PDF/Office)
//   GET /api/missions/:id/checkpoints/:cp/page/:n?path&scope&side&width       one page of one side, PNG
import path from "node:path";
import { lstat } from "node:fs/promises";
import { diffText, lineDelta } from "./linediff.mjs";
import { readDocument } from "./documents.mjs";
import { renderPdfPage } from "./pdfforms.mjs";
import { isOfficeFile } from "./officepdf.mjs";
import { pdfPages, visualNote, visualPdf } from "./workfiles.mjs";

export const CHANGE_LIMITS = Object.freeze({ textBytes: 1024 * 1024, docBytes: 10 * 1024 * 1024, files: 100 });
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|html?|css|scss|less|m?js|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|cs|c|h|cpp|hpp|php|sql|sh|bat|ps1|ini|cfg|conf|log|svg|env|gitignore|vue|svelte)$/i;
const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" };
const extOf = (p) => path.extname(p).slice(1).toLowerCase();

/** How a changed file is compared: text | document (Office XML: its text) | image | pdf | office | binary. */
export function changeKind(rel) {
  const ext = extOf(rel);
  if (IMAGE[ext]) return "image";
  if (ext === "pdf") return "pdf";
  if (["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"].includes(ext)) return "document";
  if (isOfficeFile(rel)) return "office";
  if (TEXT_EXT.test(rel) || !ext) return "text";
  return "binary";
}

/** Strict UTF-8 without NUL bytes, or null. */
export function asText(buf) {
  if (!buf || buf.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); } catch { return null; }
}

/** The whole text of a Word, Excel or PowerPoint file (up to 20 pages of ~20 000 characters). */
export async function documentText(buf, name) {
  if (!buf) return "";
  const first = await readDocument(buf, name, { page: 1 });
  const parts = [first.content];
  for (let page = 2; page <= Math.min(first.pages, 20); page++) parts.push((await readDocument(buf, name, { page })).content);
  // One line per paragraph or row: the blank lines between paragraphs are no change of their own.
  return parts.join("\n").replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");
}

const readable = (kind) => ({ path: rel, size }) => {
  const k = kind || changeKind(rel);
  return k === "text" ? size <= CHANGE_LIMITS.textBytes : k === "document" ? size <= CHANGE_LIMITS.docBytes : false;
};

/** Line delta of one file of a turn (text, and Office XML by its text); null when only sizes count. */
async function deltaOf(f) {
  const kind = changeKind(f.path);
  if (kind === "text") {
    const a = f.before ? asText(f.before.bytes) : "", b = f.after ? asText(f.after.bytes) : "";
    if ((f.before && a == null) || (f.after && b == null)) return null;
    return lineDelta(a, b);
  }
  if (kind === "document") {
    try { return lineDelta(f.before?.bytes ? await documentText(f.before.bytes, f.path) : "", f.after?.bytes ? await documentText(f.after.bytes, f.path) : ""); } catch { return null; }
  }
  return null;
}

export function registerTurnChangeRoutes(app, { store, runtime, check, z, mustGet, HttpError, office = null }) {
  const fail = (status, message) => (HttpError ? new HttpError(status, message) : Object.assign(Error(message), { status }));
  const points = () => {
    if (!runtime?.checkpoints) throw fail(404, "Los puntos de restauración no están disponibles.");
    return runtime.checkpoints;
  };
  const summaries = new Map(); // cpId → files with deltas (a finished turn never changes)
  const fileQuery = z.object({ path: z.string().trim().min(1).max(1000), scope: z.string().trim().max(80).optional(), side: z.enum(["before", "after"]).optional(), width: z.string().optional() }).passthrough();
  const oneFile = async (req, read = () => true) => {
    const m = mustGet("missions", req.params.id, "Misión");
    const q = check(fileQuery, req.query);
    const cp = points();
    await cp.idle(m.id);
    const { record, files } = await cp.turnFiles(m.id, req.params.cp, { paths: [{ path: q.path, scope: q.scope || undefined }], max: 1, read });
    if (!files.length) throw fail(404, "Ese archivo no cambió en esta respuesta.");
    return { m, q, record, file: files[0] };
  };

  app.get("/api/missions/:id/checkpoints/:cp/changes", async (req, res) => {
    const m = mustGet("missions", req.params.id, "Misión");
    const cp = points();
    await cp.idle(m.id);
    let summary = summaries.get(req.params.cp);
    if (!summary || summary.missionId !== m.id) {
      const { record, files, more } = await cp.turnFiles(m.id, req.params.cp, { max: CHANGE_LIMITS.files, read: readable() });
      const list = [];
      for (const f of files) {
        const delta = await deltaOf(f);
        list.push({
          path: f.path, name: path.posix.basename(f.path), scope: f.scope, folder: f.folder, change: f.change, kind: changeKind(f.path),
          before: f.before?.size ?? null, after: f.after?.size ?? null, added: delta?.added ?? null, removed: delta?.removed ?? null,
        });
      }
      summary = { missionId: m.id, botId: record.botId, at: record.at, stepId: record.stepId, files: list, more, roots: Object.fromEntries(record.scopes.map((s) => [s.key, { root: s.root, kind: s.kind }])) };
      summaries.set(req.params.cp, summary);
      while (summaries.size > 50) summaries.delete(summaries.keys().next().value);
    }
    // Whether each one is still there to open (that changes; the rest does not).
    const files = [];
    for (const f of summary.files) {
      const scope = summary.roots[f.scope];
      let openable = false;
      if (scope?.kind === "mission" && f.change !== "deleted") openable = !!(await lstat(path.join(scope.root, f.path)).catch(() => null))?.isFile();
      files.push({ ...f, openable });
    }
    res.json({ botId: summary.botId, at: summary.at, stepId: summary.stepId, files, more: summary.more });
  });

  app.get("/api/missions/:id/checkpoints/:cp/diff", async (req, res) => {
    const { file } = await oneFile(req, readable());
    const kind = changeKind(file.path);
    const base = { path: file.path, scope: file.scope, folder: file.folder, change: file.change, kind, before: file.before ? { size: file.before.size } : null, after: file.after ? { size: file.after.size } : null };
    const tooBig = (side) => side && side.bytes === undefined;
    if (kind === "text" || kind === "document") {
      if (tooBig(file.before) || tooBig(file.after)) return res.json({ ...base, mode: "binary", note: "Es demasiado grande para compararlo línea a línea." });
      let a, b;
      if (kind === "text") {
        a = file.before ? asText(file.before.bytes) : "";
        b = file.after ? asText(file.after.bytes) : "";
        if (a == null || b == null) return res.json({ ...base, mode: "binary", note: "No es texto que se pueda comparar línea a línea." });
      } else {
        try { [a, b] = [file.before ? await documentText(file.before.bytes, file.path) : "", file.after ? await documentText(file.after.bytes, file.path) : ""]; }
        catch (error) { return res.json({ ...base, mode: "binary", note: "No pude leer su texto: " + String(error.message || error).slice(0, 160) }); }
      }
      const d = diffText(a, b);
      return res.json({ ...base, mode: kind, patch: d.patch, added: d.added, removed: d.removed, same: d.same, truncated: d.truncated, visual: kind === "document" && !!office });
    }
    if (kind === "image" || kind === "pdf" || kind === "office") return res.json({ ...base, mode: "visual", visual: true });
    res.json({ ...base, mode: "binary", note: "Este tipo de archivo no se puede comparar aquí: mira su tamaño, o ábrelo." });
  });

  const sideOf = (file, q) => {
    const side = file[q.side || "after"];
    if (!side?.bytes) throw fail(404, q.side === "before" ? "Antes de esta respuesta no existía." : "Después de esta respuesta ya no existía.");
    return side.bytes;
  };
  app.get("/api/missions/:id/checkpoints/:cp/blob", async (req, res) => {
    const { q, file } = await oneFile(req);
    const mime = IMAGE[extOf(file.path)];
    if (!mime) throw fail(400, "Solo las imágenes se muestran así.");
    const bytes = sideOf(file, q);
    res.set({ "Content-Type": mime, "Content-Length": String(bytes.length), "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "private, max-age=3600" });
    res.end(bytes);
  });
  const visualOf = async (req, res) => {
    const { m, q, file } = await oneFile(req);
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    return visualPdf(office, sideOf(file, q), file.path, { source: m.id + "\u0000cp:" + req.params.cp + "\u0000" + file.path + "\u0000" + (q.side || "after"), signal: controller.signal });
  };
  app.get("/api/missions/:id/checkpoints/:cp/visual", async (req, res) => {
    try {
      const v = await visualOf(req, res);
      const pages = await pdfPages(v.pdf).catch(() => 0);
      if (!pages) return res.json({ available: false, reason: "FAILED", note: "No pude abrir sus páginas." });
      res.json({ available: true, pages, version: v.version, missingFonts: v.missingFonts, engine: v.engine });
    } catch (error) {
      if (error?.status) throw error;
      if (error?.code === "ABORTED") return res.end();
      res.json({ available: false, reason: error?.code || "FAILED", note: visualNote(error).replace(/ Ves su texto\.$/, "") });
    }
  });
  app.get("/api/missions/:id/checkpoints/:cp/page/:n", async (req, res) => {
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 1 || n > 2000) throw fail(400, "Página no válida.");
    const width = Math.min(1600, Math.max(240, Math.round(Number(req.query.width) || 700)));
    let v;
    try { v = await visualOf(req, res); } catch (error) {
      if (error?.status) throw error;
      if (error?.code === "ABORTED") return res.end();
      throw fail(error?.code === "NO_CONVERTER" ? 501 : 422, visualNote(error));
    }
    const { png } = await renderPdfPage(v.pdf, n, { width });
    res.set({ "Content-Type": "image/png", "Content-Length": String(png.length), "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "private, max-age=3600" });
    res.end(png);
  });
}
