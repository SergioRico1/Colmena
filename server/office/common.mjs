// What Word documents and Excel workbooks share: the palette, the mission's pictures and the
// charts, drawn once as SVG (the same drawing as the slides) and turned into a PNG.
import { createRequire } from "node:module";

// Loaded on the first chart picture, not at start-up (~180 ms).
let canvasLib = null;
const canvasModule = () => (canvasLib ??= createRequire(import.meta.url)("@napi-rs/canvas"));
import { readMissionBytes } from "../files.mjs";
import { chartSvg } from "../slides/html.mjs";
import { themeOf } from "../slides/layout.mjs";

const MAX_IMAGE = 8 * 1024 * 1024;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The slide palette on white paper (documents and workbooks are printed, never dark). */
export function paperTheme({ theme = "colmena", accent = "" } = {}) {
  return { ...themeOf({ theme, accent }), bg: "FFFFFF", surface: "F6F5F2" };
}

function imageMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}

/** A PNG or JPG of the mission folder: its bytes, type and size in pixels. Throws in Spanish. */
export async function missionImage(root, relative) {
  const { bytes } = await readMissionBytes(root, relative);
  const type = imageMime(bytes);
  if (!type) throw Error("no es PNG ni JPG");
  if (bytes.length > MAX_IMAGE) throw Error("pesa más de 8 MB");
  const img = new (canvasModule().Image)();
  img.src = bytes;
  if (!img.width || !img.height) throw Error("no se puede leer");
  return { bytes, type, width: img.width, height: img.height, dataUri: `data:image/${type === "jpg" ? "jpeg" : "png"};base64,${Buffer.from(bytes).toString("base64")}` };
}

/** A chart as a standalone SVG of w×h (viewer, HTML twin). */
export function chartSvgDocument(chart, theme, { w = 860, h = 420 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Segoe UI">${chartSvg(chart, { w, h }, theme)}</svg>`;
}

/** The same chart as PNG bytes (Word and Excel), drawn at `scale` for a sharp picture. */
export function chartPng(chart, theme, { w = 860, h = 420, scale = 2, title = "" } = {}) {
  const top = title ? 56 : 0;
  const img = new (canvasModule().Image)();
  img.src = Buffer.from(chartSvgDocument(chart, theme, { w, h }));
  const canvas = canvasModule().createCanvas(w * scale, (h + top) * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (title) {
    ctx.fillStyle = "#" + theme.ink;
    ctx.font = `600 ${26 * scale}px "Segoe UI Semibold", "Segoe UI", sans-serif`;
    ctx.fillText(title, 8 * scale, 34 * scale, (w - 16) * scale);
  }
  ctx.drawImage(img, 0, top * scale, w * scale, h * scale);
  return { bytes: canvas.toBuffer("image/png"), width: w, height: h + top };
}

/** Inline marks the bots may use in a paragraph: **bold**, *italic* and [text](https://link). */
export function inlineRuns(text) {
  const runs = [];
  const re = /\*\*(.+?)\*\*|\*(?!\s)(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0, m;
  const src = String(text ?? "");
  while ((m = re.exec(src))) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index) });
    if (m[1] != null) runs.push({ text: m[1], bold: true });
    else if (m[2] != null) runs.push({ text: m[2], italic: true });
    else runs.push({ text: m[3], link: m[4] });
    last = re.lastIndex;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs;
}

/** The same marks as HTML (escaped). */
export function inlineHtml(text) {
  return inlineRuns(text).map((r) => {
    const t = esc(r.text).replace(/\n/g, "<br>");
    if (r.bold) return `<strong>${t}</strong>`;
    if (r.italic) return `<em>${t}</em>`;
    if (r.link) return `<a href="${esc(r.link)}">${t}</a>`;
    return t;
  }).join("");
}

/** The same marks as plain text (outline, search). */
export const plain = (text) => inlineRuns(text).map((r) => r.text).join("");
