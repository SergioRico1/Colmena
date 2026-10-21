// «Archivos» side panel of a room or chat (OpenClaw sessions.files.*): the files of its
// working folder, which ones the bots changed or read and which you attached; a preview of
// each (text, Markdown, CSV, images, PDF/Word/Excel as text) and conflict-safe editing:
// a save only lands if the file still has the hash you opened (SHA-256 of its bytes),
// otherwise you choose «Recargar» or «Sobrescribir». Limits as OpenClaw: 256 KiB text,
// no symlinks or hardlinks, UTF-8 only, no NUL bytes; saves are serialized.
import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { safePath } from "./files.mjs";
import { readDocument, isDocumentFormat } from "./documents.mjs";

export const WORKFILE_LIMITS = Object.freeze({ textBytes: 256 * 1024, entries: 500, depth: 6, rawBytes: 25 * 1024 * 1024 });
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|html?|css|js|jsx|ts|tsx|py|sql|sh|ps1|ini|log|svg|env\.example)$/i;
const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml" };
const MIME = { ...IMAGE, pdf: "application/pdf", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8", txt: "text/plain; charset=utf-8", json: "application/json", html: "text/plain; charset=utf-8", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const WRITE_TOOLS = new Set(["write_file", "create_deliverable", "fill_pdf", "create_image"]);
const READ_TOOLS = new Set(["read_file", "read_folder_file", "pdf_fields"]);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const typeOf = (p) => {
  const ext = extOf(p);
  if (IMAGE[ext] && ext !== "svg") return "image";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "pdf") return "pdf";
  if (isDocumentFormat(p)) return "document";
  if (TEXT_EXT.test(p)) return "text";
  return "binary";
};

/** Every file of the folder (depth ≤ 6, ≤ 500), never following links. */
async function walk(root) {
  const out = [];
  let truncated = false;
  const visit = async (dir, depth) => {
    if (depth > WORKFILE_LIMITS.depth) return;
    let entries = [];
    try { entries = await readdir(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, "es"));
    for (const e of entries) {
      if (out.length >= WORKFILE_LIMITS.entries) { truncated = true; return; }
      if (e.isSymbolicLink() || e.name.startsWith(".")) continue;
      // A project's dependencies (thousands of files) are not the person's work.
      if (e.isDirectory() && e.name === "node_modules") continue;
      const rel = dir ? dir + "/" + e.name : e.name;
      if (e.isDirectory()) await visit(rel, depth + 1);
      else if (e.isFile()) {
        const info = await lstat(path.join(root, rel)).catch(() => null);
        if (info && info.nlink <= 1) out.push({ path: rel, name: e.name, dir, size: info.size, modifiedAt: info.mtime.toISOString() });
      }
    }
  };
  await visit("", 0);
  return { files: out, truncated };
}

/** What happened to each path in this mission: changed (by whom), read, or attached by you. */
function provenance(store, missionId) {
  const marks = new Map();
  const mark = (p, kind, botId, at) => {
    const key = String(p || "").replace(/^\.?\/+/, "");
    if (!key) return;
    const prev = marks.get(key);
    // «Cambiado» wins over «Leído»; the latest bot that changed it is kept.
    if (!prev || prev.kind === "read" || (kind === "changed" && String(at || "") >= String(prev.at || ""))) marks.set(key, { kind, botId, at });
  };
  for (const s of store.where("steps", "missionId", missionId)) {
    for (const a of s.activity || []) {
      if (!a?.tool || a.status === "error") continue;
      if (WRITE_TOOLS.has(a.tool) && a.path) mark(a.path, "changed", s.botId, a.at);
      else if (WRITE_TOOLS.has(a.tool) && a.detail && /\.[a-z0-9]{1,6}$/i.test(a.detail)) mark(a.detail, "changed", s.botId, a.at);
      else if (READ_TOOLS.has(a.tool) && (a.path || a.detail)) mark(String(a.path || a.detail).split(" · ")[0], "read", s.botId, a.at);
    }
  }
  for (const m of store.where("messages", "missionId", missionId))
    if (m.role === "user") for (const f of m.attachments || []) if (!marks.has(f.name)) marks.set(f.name, { kind: "attachment", botId: null, at: m.at });
  for (const a of store.where("artifacts", "missionId", missionId)) if (a.file) mark(a.file, "changed", a.botId, a.createdAt);
  return marks;
}

function lineEnding(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  if (crlf && lf) return "mixed";
  return crlf ? "crlf" : "lf";
}

/** Strict UTF-8: the text, or null when the bytes are not valid UTF-8. */
function utf8(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return null; }
}

// Saves are serialized (OpenClaw enqueueWorkspaceFileUpdate): the check and the write happen
// with nothing else writing in between.
let queue = Promise.resolve();
const serialized = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

export function registerWorkFileRoutes(app, { store, rootOf, check, z, mustGet, HttpError }) {
  const fail = (status, message, extra = {}) => Object.assign(HttpError ? new HttpError(status, message) : Object.assign(Error(message), { status }), extra);
  const fileOf = async (missionId, rel) => {
    let target;
    try { target = await safePath(rootOf(missionId), rel); } catch { throw fail(404, "Archivo no disponible."); }
    const info = await lstat(target).catch(() => null);
    if (!info || !info.isFile()) throw fail(404, "Ese archivo ya no existe.");
    if (info.nlink > 1) throw fail(403, "No se abren archivos enlazados.");
    return { target, info };
  };
  const pathQuery = z.string().trim().min(1).max(240);

  app.get("/api/missions/:id/workfiles", async (req, res) => {
    mustGet("missions", req.params.id, "Misión");
    const { files, truncated } = await walk(rootOf(req.params.id));
    const marks = provenance(store, req.params.id);
    const bots = new Map(store.list("bots").map((b) => [b.id, b.name]));
    res.json({
      truncated,
      files: files.map((f) => {
        const m = marks.get(f.path) || marks.get(f.name);
        return { ...f, type: typeOf(f.path), kind: m?.kind || "other", by: m?.botId ? bots.get(m.botId) || m.botId : null };
      }),
    });
  });

  app.get("/api/missions/:id/workfiles/file", async (req, res) => {
    mustGet("missions", req.params.id, "Misión");
    const rel = check(pathQuery, String(req.query.path ?? ""));
    const { target, info } = await fileOf(req.params.id, rel);
    const type = typeOf(rel);
    const base = { path: rel, name: path.basename(rel), size: info.size, modifiedAt: info.mtime.toISOString(), type, mime: MIME[extOf(rel)] || "application/octet-stream" };
    if (["text", "markdown", "csv"].includes(type) || extOf(rel) === "svg") {
      if (info.size > WORKFILE_LIMITS.textBytes) return res.json({ ...base, editable: false, reason: "Demasiado grande para verlo aquí (más de 256 KB). Descárgalo." });
      const buf = await readFile(target);
      const text = buf.includes(0) ? null : utf8(buf);
      if (text === null) return res.json({ ...base, editable: false, reason: "No es texto que se pueda mostrar." });
      const eol = lineEnding(text);
      // Editing needs uniform line endings: otherwise saving would change them all.
      return res.json({ ...base, text, hash: sha256(buf), lineEnding: eol, editable: eol !== "mixed" });
    }
    if (type === "document" || type === "pdf") {
      try {
        const doc = await readDocument(await readFile(target), rel, { page: 1, cacheKey: target + ":" + info.size + ":" + info.mtimeMs });
        return res.json({ ...base, editable: false, preview: String(doc.content || "").slice(0, 60000), pages: doc.pages || null });
      } catch (error) {
        return res.json({ ...base, editable: false, reason: "No pude leer su contenido: " + String(error.message || error).slice(0, 160) });
      }
    }
    res.json({ ...base, editable: false });
  });

  app.get("/api/missions/:id/workfiles/raw", async (req, res) => {
    mustGet("missions", req.params.id, "Misión");
    const rel = check(pathQuery, String(req.query.path ?? ""));
    const { target, info } = await fileOf(req.params.id, rel);
    if (info.size > WORKFILE_LIMITS.rawBytes) throw fail(413, "Archivo demasiado grande.");
    const name = path.basename(rel);
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
    // Inline only for images and PDF; SVG and HTML are never rendered from here.
    const inline = req.query.download !== "1" && (typeOf(rel) === "image" || extOf(rel) === "pdf");
    res.set({
      "Content-Type": inline ? MIME[extOf(rel)] : "application/octet-stream",
      "Content-Length": String(info.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(target));
  });

  app.put("/api/missions/:id/workfiles/file", async (req, res) => {
    mustGet("missions", req.params.id, "Misión");
    const data = check(z.object({ path: pathQuery, content: z.string().max(WORKFILE_LIMITS.textBytes), expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), req.body);
    if (data.content.includes("\u0000")) throw fail(400, "El texto tiene caracteres que no se pueden guardar.");
    const bytes = Buffer.from(data.content, "utf8");
    if (bytes.length > WORKFILE_LIMITS.textBytes) throw fail(413, "Ocupa más de 256 KB: no se puede guardar desde aquí.");
    const result = await serialized(async () => {
      const { target } = await fileOf(req.params.id, data.path);
      const current = await readFile(target);
      if (utf8(current) === null) throw fail(400, "Ese archivo no es texto editable.");
      const currentHash = sha256(current);
      if (currentHash !== data.expectedHash) throw fail(409, "El archivo ha cambiado desde que lo abriste.", { details: { type: "conflict", currentHash } });
      // Write next to it, then rename: never a half-written file.
      const tmp = target + ".colmena-" + process.pid + "-" + Date.now() + ".tmp";
      await writeFile(tmp, bytes, { flag: "wx" });
      await rename(tmp, target);
      return { hash: sha256(bytes), size: bytes.length };
    });
    store.event(req.params.id, "file_edited", { path: data.path, text: "Has editado " + data.path });
    res.json({ ok: true, ...result });
  });
}
