import path from "node:path";
import {
  mkdir,
  lstat,
  realpath,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { z } from "zod";
import { readDocument, isDocumentFormat, DOC_LIMITS, DOCUMENT_NOTICE } from "./documents.mjs";

export async function safePath(root, relative, { parent = false } = {}) {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative.length > 240 ||
    relative.includes("\\") ||
    relative.includes(":") ||
    relative
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[<>"|?*\x00-\x1f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
      )
  )
    throw Error("Ruta no permitida.");
  await mkdir(root, { recursive: true });
  const base = await realpath(root);
  let target = base;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i]);
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink())
        throw Error("No se permiten enlaces simbolicos.");
      if (i < parts.length - 1 && !stat.isDirectory())
        throw Error("No es una carpeta.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (i < parts.length - 1) {
        if (!parent) throw e;
        await mkdir(target);
      }
    }
  }
  return target;
}
export async function readMissionFile(root, relative) {
  const target = await safePath(root, relative);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size > 250000)
    throw Error("Solo archivos de texto de hasta 250 KB.");
  return readFile(target, "utf8");
}

/** Bytes of a mission file (documents, images, PDFs), at most `max` bytes. */
export async function readMissionBytes(root, relative, { max = DOC_LIMITS.maxBytes } = {}) {
  const target = await safePath(root, relative);
  let info;
  try { info = await lstat(target); } catch { throw Error("No existe: " + relative); }
  if (!info.isFile()) throw Error("No es un archivo.");
  if (info.size > max) throw Error("El archivo supera el máximo de " + Math.round(max / 1048576) + " MB.");
  return { target, bytes: await readFile(target), size: info.size, mtimeMs: info.mtimeMs };
}

/**
 * read_file: text files as before ({content, notice}); PDF, Word, Excel, PowerPoint and CSV
 * through documents.mjs, by pages ({name, format, page, pages, content, pdf?, table?…}).
 */
export async function readMissionDocument(root, relative, page = 1) {
  if (!isDocumentFormat(relative)) {
    const target = await safePath(root, relative);
    let info;
    try { info = await lstat(target); } catch { throw Error("No existe: " + relative); }
    if (!info.isFile()) throw Error("No es un archivo.");
    if (info.size <= 250000) {
      const buffer = await readFile(target);
      if (!buffer.subarray(0, 8192).includes(0)) {
        const content = buffer.toString("utf8");
        if (content.length <= DOC_LIMITS.pageChars && page <= 1) return { content, notice: DOCUMENT_NOTICE };
      }
    }
  }
  const { target, bytes, size, mtimeMs } = await readMissionBytes(root, relative);
  return readDocument(bytes, relative, { page, cacheKey: target + ":" + size + ":" + mtimeMs });
}

export async function createMissionFile(root, relative, content) {
  const binary = Buffer.isBuffer(content);
  if (binary ? content.length > ATTACHMENT_LIMITS.binaryBytes : typeof content !== "string" || Buffer.byteLength(content) > 250000)
    throw Error("Archivo demasiado grande.");
  const target = await safePath(root, relative, { parent: true });
  try {
    await writeFile(target, content, { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const existing = await readFile(target);
    if (!existing.equals(binary ? content : Buffer.from(content)))
      throw Error(
        "Ya existe otro contenido en esta ruta. Elige un nombre nuevo.",
      );
  }
  return { path: relative, bytes: binary ? content.length : Buffer.byteLength(content) };
}

/**
 * The working copy of a code deliverable («facturacion_mensual.py», «contacto.html»): a real
 * file in the mission folder, so it can be run or previewed. Each new version replaces it
 * (every version stays in the Archivo).
 */
export async function saveWorkFile(root, relative, content) {
  if (typeof content !== "string" || Buffer.byteLength(content) > 250000) throw Error("Archivo demasiado grande.");
  const target = await safePath(root, relative, { parent: true });
  await writeFile(target, content);
  return { path: relative, bytes: Buffer.byteLength(content) };
}

const GENERIC_WORDS = new Set("script scripts python py javascript js html htm css sql codigo programa pagina web archivo fichero version unico unica nuevo nueva simple sencillo sencilla de del la el los las con y en para por desde a al un una".split(" "));
/** «facturacion_mensual.py» from a title that names it, else a short slug of the title. */
export function workFileName(title, format) {
  const ext = String(format || "txt").toLowerCase();
  const named = new RegExp("([A-Za-z0-9_-]{1,60})\\." + ext + "\\b").exec(String(title || ""));
  if (named) return named[1] + "." + ext;
  // The words that say what it is about («facturacion-mensual-csv»), not «script python».
  const words = String(title || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !GENERIC_WORDS.has(w));
  return (words.slice(0, 4).join("-") || "archivo") + "." + ext;
}

/** Writes bytes under a free name: «carpeta/nombre.png», «carpeta/nombre-2.png»… Never overwrites. */
export async function createUniqueFile(root, folder, base, ext, bytes) {
  const clean = String(base || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "archivo";
  for (let n = 1; n < 200; n++) {
    const relative = (folder ? folder + "/" : "") + clean + (n > 1 ? "-" + n : "") + "." + ext;
    const target = await safePath(root, relative, { parent: true });
    try {
      await writeFile(target, bytes, { flag: "wx" });
      return { path: relative, target, bytes: bytes.length };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  throw Error("No hay un nombre libre para el archivo.");
}

export async function listMissionFiles(root) {
  await mkdir(root, { recursive: true });
  return (await readdir(root, { withFileTypes: true }))
    .filter((x) => !x.isSymbolicLink())
    .map((x) => ({ name: x.name, directory: x.isDirectory() }));
}

// ------------------------------------------------------------ mission attachments
/**
 * Contract (frontend → server) for `attachments` of POST /api/missions and
 * POST /api/missions/:id/messages:
 *   { name, content, size?, encoding?: 'utf8'|'base64' }
 * - text (default): content is the text, up to 200 000 characters;
 * - encoding 'base64': content is the file in base64 (PDF, DOCX, XLSX, PNG…), up to 10 MB decoded.
 */
export const ATTACHMENT_LIMITS = Object.freeze({ textChars: 200000, binaryBytes: 10 * 1024 * 1024, base64Chars: Math.ceil((10 * 1024 * 1024) / 3) * 4 });
export const attachmentInput = z.object({
  name: z.string().trim().min(1).max(100),
  content: z.string().max(ATTACHMENT_LIMITS.base64Chars),
  size: z.number().int().min(0).optional(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
}).strict().superRefine((a, ctx) => {
  if (a.encoding === "utf8" && a.content.length > ATTACHMENT_LIMITS.textChars)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "Los adjuntos de texto admiten hasta 200 000 caracteres." });
  if (a.encoding === "base64" && !/^[A-Za-z0-9+/]*={0,2}$/.test(a.content.replace(/\s+/g, "")))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "El adjunto no está en base64 válido." });
});

/** Bytes (or text) of one validated attachment. Throws if the decoded file exceeds 10 MB. */
export function attachmentBody(file) {
  if (file.encoding !== "base64") return file.content;
  const clean = file.content.replace(/\s+/g, "");
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length > ATTACHMENT_LIMITS.binaryBytes) throw Error("«" + file.name + "» supera el máximo de 10 MB.");
  if (Buffer.from(bytes).toString("base64").replace(/=+$/, "") !== clean.replace(/=+$/, "")) throw Error("«" + file.name + "» no está en base64 válido.");
  return bytes;
}

/** Writes attachments into the mission folder; returns [{name, size, encoding}] for the message. */
export async function writeMissionAttachments(root, files = []) {
  const out = [];
  for (const file of files) {
    const body = attachmentBody(file);
    await createMissionFile(root, file.name, body);
    out.push({ name: file.name, size: Buffer.isBuffer(body) ? body.length : file.size ?? Buffer.byteLength(body), encoding: file.encoding || "utf8" });
  }
  return out;
}
