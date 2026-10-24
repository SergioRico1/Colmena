// Files and deliverables shared in a conversation with people (design/V2Personas.dc.html,
// paso archivo; docs/PEOPLE.md). An envelope holds 48 KB, so a file travels apart:
// - It is sealed here with AES-256-GCM and a new random key, cut into 1 MiB parts and left at
//   the mailbox (/v1/blobs), which keeps bytes it cannot read for 7 days.
// - The message carries the key, a read token and the file's SHA-256: only the people in the
//   conversation can open it; the mailbox only sees sizes and who uploaded.
// - Each Colmena downloads it once, checks the hash and keeps it; then it is shown here with
//   a viewer that never runs anything from the file (images, PDF pages drawn here, the text of
//   a Word document, the values of a workbook, the slides' text or a deliverable's PDF).
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { now } from "../store.mjs";
import { PeerError } from "./service.mjs";

export const FILE_LIMITS = Object.freeze({ bytes: 25 * 1024 * 1024, part: 1024 * 1024, keepDays: 7, perMessage: 1, previewRows: 200, previewCols: 30, textChars: 200000 });
export const FILE_KINDS = Object.freeze({
  png: ["image", "image/png"], jpg: ["image", "image/jpeg"], jpeg: ["image", "image/jpeg"], webp: ["image", "image/webp"], gif: ["image", "image/gif"],
  pdf: ["pdf", "application/pdf"],
  docx: ["doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["sheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["deck", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  txt: ["text", "text/plain"], md: ["text", "text/markdown"], csv: ["text", "text/csv"],
});
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sha = (buf) => createHash("sha256").update(buf).digest("base64url");
const extOf = (name) => String(path.extname(String(name || ""))).slice(1).toLowerCase();
/** A file name that is only a name: no folders, no control characters, at most 120 characters. */
export const cleanName = (name) => {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]+/g, "-").replace(/^\.+/, "").trim().slice(-120);
  return base || "archivo";
};

function seal(bytes, key) {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, nonce);
  return Buffer.concat([nonce, c.update(bytes), c.final(), c.getAuthTag()]);
}
function unseal(sealed, key) {
  const nonce = sealed.subarray(0, 12), tag = sealed.subarray(sealed.length - 16);
  const d = createDecipheriv("aes-256-gcm", key, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(sealed.subarray(12, sealed.length - 16)), d.final()]);
}
const partsOf = (buf, size) => { const out = []; for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size)); return out; };

export class PeerFiles {
  constructor({ peers, store, directory = store.directory, artifactFile = null }) {
    this.peers = peers;
    this.store = store;
    this.dir = path.join(directory, "peer-files");
    this.artifactFile = artifactFile; // (artifactId) → {path, name, pdf?} of a deliverable
    this.queue = Promise.resolve();
  }
  start() {
    this.onPosted = ({ share, message, mine }) => { if (!mine && message?.card?.kind === "file") this.arrived(share, message); };
    this.peers.on("posted", this.onPosted);
    // What was waiting when Colmena closed is fetched again.
    for (const f of this.store.list("peerFiles").filter((x) => x.status === "pending")) this.fetchLater(f.id);
    return this;
  }
  stop() { this.peers.off("posted", this.onPosted); }
  live(file) { this.peers.emit("live", { type: "file", shareId: file.shareId, file: this.view(file) }); }

  async blobsOk() {
    const h = await this.peers.client?.health().catch(() => null);
    if (!h?.blobs) throw new PeerError("El buzón que usáis aún no guarda archivos: hay que actualizarlo (docs/PEOPLE.md › Buzón en Cloudflare).", 409);
    return h.blobs;
  }
  /** Seals `bytes` and leaves it at the mailbox: → {id, parts, size, sha256}. */
  async upload(bytes, key, token) {
    const id = b64u(randomBytes(24));
    const sealed = seal(bytes, key);
    const parts = partsOf(sealed, FILE_LIMITS.part);
    for (let n = 0; n < parts.length; n++) await this.peers.client.putBlob(id, n, parts[n], n === 0 ? { parts: parts.length, read: sha(Buffer.from(token)) } : {});
    return { id, parts: parts.length, size: bytes.length, sha256: sha(bytes) };
  }

  /** Shares a file in a conversation: `bytes` with its name, and a PDF to show it if there is one. */
  async send(shareId, { name, bytes, caption = "", view = null }) {
    this.peers.requireRelay();
    const s = this.peers.share(shareId);
    if (s.leftAt || s.removedAt) throw new PeerError("Ya no estás en esta conversación.", 409);
    const clean = cleanName(name);
    const kind = FILE_KINDS[extOf(clean)];
    if (!kind) throw new PeerError("Ese tipo de archivo no se puede compartir. Sí: imágenes, PDF, Word, Excel, PowerPoint y texto.");
    if (!bytes?.length) throw new PeerError("El archivo está vacío.");
    if (bytes.length > FILE_LIMITS.bytes) throw new PeerError("Como mucho 25 MB por archivo.");
    await this.blobsOk();
    const key = randomBytes(32), token = b64u(randomBytes(32));
    const main = await this.upload(bytes, key, token);
    const preview = view?.length && view.length <= FILE_LIMITS.bytes ? await this.upload(view, key, token) : null;
    const until = new Date(Date.parse(now()) + FILE_LIMITS.keepDays * 864e5).toISOString();
    const card = { kind: "file", file: { id: main.id, name: clean, mime: kind[1], size: main.size, sha256: main.sha256, parts: main.parts, key: b64u(key), token, until, ...(preview ? { view: { id: preview.id, parts: preview.parts, size: preview.size, sha256: preview.sha256 } } : {}) } };
    const folder = path.join(this.dir, main.id);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "file"), bytes);
    if (preview) await writeFile(path.join(folder, "view.pdf"), view);
    // The record first: the message shows the file as soon as it is posted.
    this.store.put("peerFiles", { id: main.id, shareId, messageId: null, from: this.peers.address, name: clean, mime: kind[1], size: main.size, sha256: main.sha256, view: !!preview, until, status: "ready", at: now() });
    const message = this.peers.post(shareId, String(caption || "").trim() || clean, { card });
    const record = this.store.patch("peerFiles", main.id, { messageId: message.id });
    this.live(record);
    return { message, file: this.view(record) };
  }
  /** A deliverable of yours (Archivo): its file, and its PDF so they can see it as it is. */
  async sendArtifact(shareId, artifactId, caption = "") {
    const a = await this.artifactFile?.(artifactId);
    if (!a) throw new PeerError("No existe ese entregable.", 404);
    const view = a.pdf && extOf(a.name) !== "pdf" ? await readFile(a.pdf).catch(() => null) : null;
    return this.send(shareId, { name: a.name, bytes: await readFile(a.path), caption, view });
  }

  // ------------------------------------------------------------------ arriving
  arrived(share, message) {
    const f = message.card.file || {};
    const clean = cleanName(f.name);
    const kind = FILE_KINDS[extOf(clean)];
    const okId = (x) => typeof x === "string" && /^[A-Za-z0-9_-]{22,43}$/.test(x);
    const okNum = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;
    if (!kind || !okId(f.id) || !okNum(f.size, FILE_LIMITS.bytes) || !okNum(f.parts, 26) || typeof f.key !== "string" || typeof f.token !== "string" || typeof f.sha256 !== "string") return;
    if (this.store.get("peerFiles", f.id)) return;
    const view = f.view && okId(f.view.id) && okNum(f.view.size, FILE_LIMITS.bytes) && okNum(f.view.parts, 26) && typeof f.view.sha256 === "string" ? { id: f.view.id, parts: f.view.parts, size: f.view.size, sha256: f.view.sha256 } : null;
    this.store.put("peerFiles", {
      id: f.id, shareId: share.id, messageId: message.id, from: message.from, name: clean, mime: kind[1], size: f.size, sha256: f.sha256, parts: f.parts,
      key: f.key, token: f.token, remoteView: view, view: false, until: String(f.until || "").slice(0, 40), status: "pending", at: now(),
    });
    this.fetchLater(f.id);
  }
  fetchLater(id) {
    this.queue = this.queue.then(() => this.download(id)).catch(() => {});
    return this.queue;
  }
  async fetchParts(id, parts, token, key, size, hash) {
    const chunks = [];
    for (let n = 0; n < parts; n++) chunks.push(await this.peers.client.getBlob(id, n, token));
    const bytes = unseal(Buffer.concat(chunks), key);
    if (bytes.length !== size || sha(bytes) !== hash) throw new PeerError("El archivo no llegó entero.");
    return bytes;
  }
  async download(id) {
    const f = this.store.get("peerFiles", id);
    if (!f || f.status === "ready" || this.peers.stopped || !this.peers.client) return;
    try {
      const key = Buffer.from(f.key, "base64url");
      const bytes = await this.fetchParts(f.id, f.parts, f.token, key, f.size, f.sha256);
      const folder = path.join(this.dir, f.id);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "file"), bytes);
      let view = false;
      if (f.remoteView) {
        const pdf = await this.fetchParts(f.remoteView.id, f.remoteView.parts, f.token, key, f.remoteView.size, f.remoteView.sha256).catch(() => null);
        if (pdf) { await writeFile(path.join(folder, "view.pdf"), pdf); view = true; }
      }
      // The key is not needed any more: the file is here.
      this.store.patch("peerFiles", f.id, { status: "ready", view, key: null, token: null, error: null });
    } catch (error) {
      if (this.peers.stopped) return;
      const gone = error.status === 404;
      this.store.patch("peerFiles", f.id, { status: gone ? "expired" : "failed", error: gone ? "Ya no está en el buzón: pídeselo otra vez." : error.message });
    }
    this.live(this.store.get("peerFiles", f.id));
  }
  /** «Reintentar» a download that failed. */
  retry(id) {
    const f = this.mustFile(id);
    if (f.status === "failed") { this.store.patch("peerFiles", id, { status: "pending", error: null }); void this.fetchLater(id); }
    return this.view(this.store.get("peerFiles", id));
  }

  // ------------------------------------------------------------------ showing
  mustFile(id) {
    const f = this.store.get("peerFiles", String(id));
    if (!f) throw new PeerError("No existe ese archivo.", 404);
    return f;
  }
  view(f) {
    const kind = FILE_KINDS[extOf(f.name)]?.[0] || "other";
    return { id: f.id, shareId: f.shareId, messageId: f.messageId, name: f.name, mime: f.mime, size: f.size, kind, status: f.status, error: f.error || null, mine: f.from === this.peers.address, until: f.until || null, hasView: !!f.view };
  }
  viewOf(id) { const f = id && this.store.get("peerFiles", String(id)); return f ? this.view(f) : null; }
  /** The message with this file was deleted for everyone: nothing of it stays. */
  async forget(id) {
    if (!id || !this.store.get("peerFiles", String(id))) return;
    await this.remove(id).catch(() => {});
  }
  ofShare(shareId) { return this.store.where("peerFiles", "shareId", shareId).map((f) => this.view(f)); }
  pathOf(id, { view = false } = {}) {
    const f = this.mustFile(id);
    if (f.status !== "ready") throw new PeerError(f.status === "pending" ? "Aún está llegando." : f.error || "No está disponible.", 409);
    const p = path.join(this.dir, f.id, view ? "view.pdf" : "file");
    if (!existsSync(p)) throw new PeerError("El archivo ya no está en este ordenador.", 404);
    return { file: f, path: p };
  }
  /** What the viewer shows, read here and returned as plain data (never the file's own HTML). */
  async preview(id) {
    const { file, path: p } = this.pathOf(id);
    const kind = FILE_KINDS[extOf(file.name)]?.[0];
    const base = { ...this.view(file) };
    if (file.view) return { ...base, show: "pdf", pages: await pdfPages(await readFile(path.join(this.dir, file.id, "view.pdf"))) };
    if (kind === "image") return { ...base, show: "image" };
    if (kind === "pdf") return { ...base, show: "pdf", pages: await pdfPages(await readFile(p)) };
    if (kind === "text") return { ...base, show: "text", text: (await readFile(p, "utf8")).slice(0, FILE_LIMITS.textChars) };
    if (kind === "doc") return { ...base, show: "doc", blocks: await docBlocks(p) };
    if (kind === "sheet") return { ...base, show: "sheet", sheets: await sheetValues(p) };
    if (kind === "deck") return { ...base, show: "deck", slides: await deckText(p) };
    return { ...base, show: "none" };
  }
  async page(id, n, width) {
    const f = this.mustFile(id);
    const { path: p } = this.pathOf(id, { view: !!f.view });
    const { renderPdfPage } = await import("../pdfforms.mjs");
    return renderPdfPage(await readFile(p), n, { width });
  }
  async remove(id) {
    const f = this.mustFile(id);
    if (f.from === this.peers.address) await this.peers.client?.deleteBlob(f.id);
    await rm(path.join(this.dir, f.id), { recursive: true, force: true });
    this.store.remove("peerFiles", f.id);
    return { ok: true };
  }
}

async function pdfPages(bytes) {
  try {
    const { PDFDocument } = await import("pdf-lib");
    return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    return 0;
  }
}
/** A Word document as headings, paragraphs, list items and tables of plain text. */
async function docBlocks(file) {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml({ path: file });
  const { parseHTML } = await import("linkedom");
  const { document } = parseHTML("<!doctype html><html><body>" + value + "</body></html>");
  const blocks = [];
  for (const el of document.body.children) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) blocks.push({ t: "h", level: Number(tag[1]), text: el.textContent.trim() });
    else if (tag === "ul" || tag === "ol") for (const li of el.querySelectorAll("li")) blocks.push({ t: "li", text: li.textContent.trim() });
    else if (tag === "table") blocks.push({ t: "table", rows: [...el.querySelectorAll("tr")].slice(0, 100).map((tr) => [...tr.querySelectorAll("td,th")].slice(0, 20).map((c) => c.textContent.trim().slice(0, 300))) });
    else if (el.textContent.trim()) blocks.push({ t: "p", text: el.textContent.trim() });
    if (blocks.length >= 2000) break;
  }
  return blocks;
}
/** A workbook's values as Excel shows them (first rows and columns of each sheet). */
async function sheetValues(file) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.slice(0, 12).map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (rows.length >= FILE_LIMITS.previewRows) return;
      const cells = [];
      for (let c = 1; c <= Math.min(ws.columnCount, FILE_LIMITS.previewCols); c++) cells.push(String(row.getCell(c).text ?? "").slice(0, 200));
      rows.push({ n, cells });
    });
    return { name: ws.name, rows, more: ws.rowCount > FILE_LIMITS.previewRows };
  });
}
/** A presentation's slides as their text, in order (the design is in the file). */
async function deckText(file) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile(file));
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  const slides = [];
  for (const n of names.slice(0, 200)) {
    const xml = await zip.file(n).async("string");
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("")).map(decodeXml).map((t) => t.trim()).filter(Boolean);
    slides.push({ title: paras[0] || "", lines: paras.slice(1, 30) });
  }
  return slides;
}
const decodeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * The deliverables of this Colmena (Archivo) as files to share: the file and, for a
 * presentation or a Word document, the PDF Colmena made of it.
 */
export function artifactSource({ store, rootOf }) {
  return async (artifactId) => {
    const a = store.get("artifacts", String(artifactId));
    if (!a?.file || !a.missionId) return null;
    const { safePath } = await import("../files.mjs");
    const root = rootOf(a.missionId);
    const file = await safePath(root, a.file).catch(() => null);
    if (!file || !existsSync(file)) return null;
    const ext = String(a.format || path.extname(a.file).slice(1) || "").toLowerCase();
    const base = String(a.title || "entregable").replace(/\.[a-z0-9]{1,6}$/i, "").trim().slice(0, 100) || "entregable";
    const pdf = a.pdf ? await safePath(root, a.pdf).catch(() => null) : null;
    return { path: file, name: cleanName(base + "." + ext), pdf: pdf && existsSync(pdf) ? pdf : null };
  };
}
