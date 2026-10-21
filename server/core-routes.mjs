import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import express from "express";
import { z } from "zod";
import { safePath, attachmentInput, writeMissionAttachments, ATTACHMENT_LIMITS } from "./files.mjs";
import { renderPdfPage } from "./pdfforms.mjs";

// HTTP routes of the core features (files of artifacts, PDF previews, binary attachments,
// provider capabilities). The coordinator mounts them in createApp() BEFORE the final
// `/api` 404 handler:   registerCoreRoutes(app, { store, runtime })
// and, so that 10 MB attachments in base64 fit, mounts `attachmentBodyParser` BEFORE the
// global express.json({limit:'1400kb'}) (it only parses the attachment routes; the global
// parser then skips the already-read body):   app.use(attachmentBodyParser);
//
//   GET  /api/artifacts/:id/file           file of a deliverable (PNG, PDF) with its Content-Type, inline
//   GET  /api/artifacts/:id/file?download=1  same, as a download («Guardar»)
//   GET  /api/artifacts/:id/meta           {id, title, kind, format, file, mime, bytes, width, height, size, pages, fields, prompt, revisedPrompt, source}
//   GET  /api/artifacts/:id/pages/:n       PNG preview of page n of a PDF deliverable (501 if rendering is unavailable)
//   GET  /api/artifacts/:id/slides/:n      a presentation's slide n as a page; /thumbs/:n its picture (or a document's page n)
//   GET  /api/artifacts/:id/document       a Word document as its A4 page (before the desktop app prints it)
//   GET  /api/artifacts/:id/pdf            the PDF of a presentation or a document (?download=1)
//   GET  /api/artifacts/:id/sheet          a workbook's preview: {title, sheets: [{name, columns, rows, …}]}
//   GET  /api/artifacts/:id/charts/:n      the picture of chart n of a workbook
//   POST /api/missions/:id/attachments     {attachments:[{name, content, encoding?:'utf8'|'base64'}]} → {files:[{name, size, encoding}]}
//   GET  /api/core/capabilities            {provider, nativeSearch, images}

const httpError = (status, message) => Object.assign(Error(message), { status });
const MIME = { png: "image/png", pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const ATTACHMENT_PATHS = /^\/api\/missions(?:\/[^/]+\/(?:messages|attachments))?\/?$/;

/** JSON parser up to 15 MB only for mission creation, messages and attachments (base64 files of up to 10 MB). */
export const attachmentBodyParser = (() => {
  const parse = express.json({ limit: "15mb" });
  return (req, res, next) => (req.method === "POST" && ATTACHMENT_PATHS.test(req.path) ? parse(req, res, next) : next());
})();

const asciiName = (name) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
function disposition(kind, name) {
  return `${kind}; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function registerCoreRoutes(app, { store, runtime } = {}) {
  if (!store) throw Error("registerCoreRoutes necesita el almacén.");
  const rootOf = (missionId) => (typeof runtime?.root === "function" ? runtime.root(missionId) : path.join(store.directory, "workspaces", missionId));
  const artifactOf = (id) => {
    const a = store.get("artifacts", id);
    if (!a) throw httpError(404, "Entregable no encontrado.");
    return a;
  };
  /** Absolute path of the artifact's file inside its mission folder (no symlinks, no escape). */
  const fileOf = async (a) => {
    if (typeof a.file !== "string" || !a.file || !a.missionId) throw httpError(404, "Este entregable no tiene archivo.");
    const target = await safePath(rootOf(a.missionId), a.file).catch(() => { throw httpError(404, "Archivo no disponible."); });
    let info;
    try { info = await lstat(target); } catch { throw httpError(404, "El archivo ya no existe."); }
    if (!info.isFile()) throw httpError(404, "Archivo no disponible.");
    return { target, size: info.size };
  };
  const mimeOf = (a) => a.mime || MIME[String(a.format || "").toLowerCase()] || "application/octet-stream";
  const nameOf = (a) => {
    const ext = String(a.format || path.extname(a.file || "").slice(1) || "bin").toLowerCase();
    const base = String(a.title || "entregable").replace(/\.[a-z0-9]{1,6}$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").trim().slice(0, 120) || "entregable";
    return base + "." + ext;
  };

  app.get("/api/artifacts/:id/file", async (req, res) => {
    const a = artifactOf(req.params.id);
    const { target, size } = await fileOf(a);
    const mime = mimeOf(a);
    const download = req.query.download === "1";
    res.set({
      "Content-Type": mime,
      "Content-Length": String(size),
      "Content-Disposition": disposition(download ? "attachment" : "inline", nameOf(a)),
      "X-Content-Type-Options": "nosniff",
      // Images never run anything; the PDF is a copy whose actions were removed and is shown
      // only inside Colmena (same origin) — Chromium's PDF viewer does not load in sandboxed frames.
      "Content-Security-Policy": mime === "application/pdf" ? "frame-ancestors 'self'; script-src 'none'; object-src 'none'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "X-Frame-Options": "SAMEORIGIN",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    res.send(await readFile(target));
  });

  // A presentation: one slide as a page (the viewer), its picture, its PDF.
  const slideNumber = (a, raw) => {
    const n = Number(raw);
    if (!a.deck) throw httpError(400, "Este entregable no es una presentación.");
    if (!Number.isInteger(n) || n < 1 || n > (a.deck.slides?.length || 0)) throw httpError(404, "Esa diapositiva no existe.");
    return n;
  };
  const sendMissionFile = async (res, a, relative, mime, name, download) => {
    if (typeof relative !== "string" || !relative) throw httpError(404, "Aún no está listo.");
    const target = await safePath(rootOf(a.missionId), relative).catch(() => { throw httpError(404, "Archivo no disponible."); });
    let bytes;
    try { bytes = await readFile(target); } catch { throw httpError(404, "El archivo ya no existe."); }
    res.set({ "Content-Type": mime, "Content-Length": String(bytes.length), "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "private, max-age=3600",
      ...(name ? { "Content-Disposition": disposition(download ? "attachment" : "inline", name) } : {}) });
    res.send(bytes);
  };
  app.get("/api/artifacts/:id/slides/:n", async (req, res) => {
    const a = artifactOf(req.params.id);
    const n = slideNumber(a, req.params.n);
    const { buildDeck } = await import("./slides/index.mjs");
    const built = await buildDeck(a.deck, { root: rootOf(a.missionId) }).catch((e) => { throw httpError(422, e.message); });
    res.set({ "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox", "X-Frame-Options": "SAMEORIGIN", "Cross-Origin-Resource-Policy": "same-origin" });
    res.send(built.html({ only: n }));
  });
  // The picture of a slide, or of a page of a Word document.
  app.get("/api/artifacts/:id/thumbs/:n", async (req, res) => {
    const a = artifactOf(req.params.id);
    if (a.document) {
      const n = Number(req.params.n);
      if (!Number.isInteger(n) || n < 1 || n > (a.thumbs || []).length) throw httpError(404, "Esa página no existe.");
      return sendMissionFile(res, a, a.thumbs[n - 1], "image/png");
    }
    const n = slideNumber(a, req.params.n);
    await sendMissionFile(res, a, (a.thumbs || [])[n - 1], "image/png");
  });
  app.get("/api/artifacts/:id/pdf", async (req, res) => {
    const a = artifactOf(req.params.id);
    if (!a.deck && !a.document) throw httpError(400, "Este entregable no tiene PDF.");
    if (!a.pdf) throw httpError(404, "El PDF se crea en la aplicación de escritorio de Colmena.");
    await sendMissionFile(res, a, a.pdf, "application/pdf", nameOf({ ...a, format: "pdf" }), req.query.download === "1");
  });

  // A Word document: its A4 page, drawn again from the stored script (escaped, images embedded).
  app.get("/api/artifacts/:id/document", async (req, res) => {
    const a = artifactOf(req.params.id);
    if (!a.document) throw httpError(400, "Este entregable no es un documento de Word.");
    const { buildDocument } = await import("./docs/index.mjs");
    const built = await buildDocument(a.document, { root: rootOf(a.missionId) }).catch((e) => { throw httpError(422, e.message); });
    res.set({ "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox", "X-Frame-Options": "SAMEORIGIN", "Cross-Origin-Resource-Policy": "same-origin" });
    res.send(built.html());
  });
  // An Excel workbook: the preview (values as Excel shows them, formulas, rule colours) and its charts.
  const sheetPreviews = new Map();
  app.get("/api/artifacts/:id/sheet", async (req, res) => {
    const a = artifactOf(req.params.id);
    if (!a.workbook) throw httpError(400, "Este entregable no es una hoja de cálculo.");
    let preview = sheetPreviews.get(a.id);
    if (!preview) {
      const { buildWorkbook } = await import("./sheets/index.mjs");
      const { workbookPreview } = await import("./sheets/preview.mjs");
      const built = await buildWorkbook(a.workbook).catch((e) => { throw httpError(422, e.message); });
      preview = workbookPreview(built);
      sheetPreviews.set(a.id, preview);
      if (sheetPreviews.size > 20) sheetPreviews.delete(sheetPreviews.keys().next().value);
    }
    res.set({ "Cache-Control": "private, max-age=3600" });
    res.json({ ...preview, charts: (a.charts || []).length });
  });
  app.get("/api/artifacts/:id/charts/:n", async (req, res) => {
    const a = artifactOf(req.params.id);
    const n = Number(req.params.n);
    if (!a.workbook || !Number.isInteger(n) || n < 1 || n > (a.charts || []).length) throw httpError(404, "Ese gráfico no existe.");
    await sendMissionFile(res, a, a.charts[n - 1], "image/png");
  });

  app.get("/api/artifacts/:id/meta", async (req, res) => {
    const a = artifactOf(req.params.id);
    let available = false;
    if (a.file) try { await fileOf(a); available = true; } catch {}
    res.json({
      id: a.id, title: a.title, kind: a.kind, format: a.format, version: a.version || 1, botId: a.botId ?? null, missionId: a.missionId ?? null,
      file: a.file || null, available, mime: a.file ? mimeOf(a) : null, bytes: a.bytes ?? null,
      width: a.width ?? null, height: a.height ?? null, size: a.size ?? null, pages: a.pages ?? null,
      fields: Array.isArray(a.fields) ? a.fields.slice(0, 500) : null,
      prompt: a.prompt ?? null, revisedPrompt: a.revisedPrompt ?? null,
      source: a.source ? { name: a.source.name || null, path: a.source.path || null } : null,
      url: a.file ? `/api/artifacts/${encodeURIComponent(a.id)}/file` : null,
      downloadUrl: a.file ? `/api/artifacts/${encodeURIComponent(a.id)}/file?download=1` : `/api/artifacts/${encodeURIComponent(a.id)}/download`,
    });
  });

  app.get("/api/artifacts/:id/pages/:n", async (req, res) => {
    const a = artifactOf(req.params.id);
    if (String(a.format).toLowerCase() !== "pdf") throw httpError(400, "Solo los PDF tienen páginas.");
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw httpError(400, "Página no válida.");
    const width = Math.min(1600, Math.max(320, Number(req.query.width) || 900));
    const { target } = await fileOf(a);
    const { png, pages } = await renderPdfPage(await readFile(target), n, { width });
    res.set({ "Content-Type": "image/png", "X-Pdf-Pages": String(pages), "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" });
    res.send(png);
  });

  app.post("/api/missions/:id/attachments", async (req, res) => {
    const mission = store.get("missions", req.params.id);
    if (!mission) throw httpError(404, "Misión no encontrada.");
    const { attachments } = z.object({ attachments: z.array(attachmentInput).min(1).max(5) }).strict().parse(req.body ?? {});
    const files = await writeMissionAttachments(rootOf(mission.id), attachments);
    res.status(201).json({ files, limits: { binaryBytes: ATTACHMENT_LIMITS.binaryBytes, textChars: ATTACHMENT_LIMITS.textChars } });
  });

  app.get("/api/core/capabilities", (_req, res) => {
    const provider = runtime?.provider;
    const kind = provider?.kind ?? null;
    let nativeSearch = false;
    try { nativeSearch = typeof provider?.nativeSearchAvailable === "function" ? !!provider.nativeSearchAvailable() : false; } catch {}
    res.json({ provider: kind, nativeSearch, images: !!kind && kind !== "local" && typeof provider?.generateImage === "function", attachments: { binaryBytes: ATTACHMENT_LIMITS.binaryBytes, textChars: ATTACHMENT_LIMITS.textChars } });
  });
}
