// Files in conversations: what kind each one is (for its card and its preview), what is known of
// the ones on screen, and their bytes read once for every preview of them (FileCard.jsx,
// FileViewer.jsx). The previews draw everything here, in the page: no file is ever run or framed.
import { fileUrl } from "./api.js";

const EXT = {
  pdf: "pdf", docx: "docx", xlsx: "xlsx", xlsm: "xlsx", pptx: "pptx", csv: "csv", tsv: "csv",
  md: "md", markdown: "md", txt: "text", log: "text", json: "text", xml: "text", yaml: "text", yml: "text", html: "text", css: "text",
  js: "text", jsx: "text", ts: "text", tsx: "text", py: "text", sql: "text", sh: "text", java: "text", go: "text", rb: "text", php: "text", c: "text", cpp: "text", rs: "text",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image",
};
/** pdf | docx | xlsx | pptx | csv | md | text | image | null (no preview: it downloads). */
export function kindOf(f) {
  const ext = String(f?.name || "").toLowerCase().split(".").pop();
  if (EXT[ext]) return EXT[ext];
  const t = String(f?.type || "");
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(t)) return "image";
  if (t === "application/pdf") return "pdf";
  if (/^text\//.test(t)) return "text";
  return null;
}
/** The words for a kind, under the file's name. */
export const KIND_LABEL = { pdf: "PDF", docx: "Documento de Word", xlsx: "Hoja de cálculo", pptx: "Presentación", csv: "Tabla CSV", md: "Texto", text: "Texto", image: "Imagen" };
/** Up to this size a preview is drawn here (bigger ones still download). Thumbnails, smaller. */
export const PREVIEW_MAX = 25 * 1048576;
export const THUMB_MAX = 4 * 1048576;

// What is known of the files on screen (their message carries it), for the side panel.
const known = new Map();
export function remember(f) { if (f?.id && !known.has(f.id)) known.set(f.id, { id: f.id, name: f.name, type: f.type, size: f.size }); }

/** A file's name, type and size: from a message on screen, else asked to the server (a link opened anew). */
export async function fileMeta(id) {
  if (known.has(id)) return known.get(id);
  const r = await fetch(fileUrl(id, { download: true }), { method: "HEAD", credentials: "same-origin" });
  if (!r.ok) throw new Error(r.status === 404 ? "No existe ese archivo o no puedes verlo." : "No se pudo abrir el archivo.");
  const cd = r.headers.get("Content-Disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="([^"]+)"/i.exec(cd);
  const meta = { id, name: star ? decodeURIComponent(star[1]) : plain ? plain[1] : "archivo", type: null, size: Number(r.headers.get("Content-Length")) || null };
  known.set(id, meta);
  return meta;
}

// The bytes of each file, read once (a few at a time are kept).
const bytes = new Map();
/** `src`: where to read it (a desktop room's file: /api/peers/files/:id); a channel's file by default. */
export function readBytes(id, src = null) {
  if (!bytes.has(id)) {
    const p = fetch(src || fileUrl(id, { download: true }), { credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error("No se pudo leer el archivo.");
      return r.arrayBuffer();
    });
    p.catch(() => bytes.delete(id));
    bytes.set(id, p);
    if (bytes.size > 12) bytes.delete(bytes.keys().next().value);
  }
  return bytes.get(id);
}
