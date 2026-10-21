// A Word document from the bot's script: validated, its pictures read once, drawn as HTML and
// as .docx.
import { missionImage, paperTheme, plain } from "../office/common.mjs";
import { parseDocument } from "./spec.mjs";
import { documentHtml } from "./html.mjs";
import { documentDocx } from "./docx.mjs";

/** The pictures of the document (PNG or JPG of the mission folder), and what failed. */
async function loadImages(doc, root) {
  const images = {}, problems = [];
  for (const [i, b] of doc.blocks.entries()) {
    if (b.type !== "image" || images[b.image]) continue;
    try { images[b.image] = await missionImage(root, b.image); }
    catch (e) { problems.push(`Bloque ${i + 1}: no puedo usar la imagen «${b.image}» (${e.message}).`); }
  }
  return { images, problems };
}

/** Everything a document is made of. Throws (in Spanish) when the script is incomplete. */
export async function buildDocument(input, { root } = {}) {
  const doc = parseDocument(input);
  const wantsImages = doc.blocks.some((b) => b.type === "image");
  if (wantsImages && !root) throw Error("Las imágenes necesitan la carpeta de la misión.");
  const { images, problems } = wantsImages ? await loadImages(doc, root) : { images: {}, problems: [] };
  if (problems.length) throw Error(problems.join(" ") + " Crea la imagen con create_image y usa la ruta que devuelve.");
  const theme = paperTheme(doc);
  return {
    doc, theme, images,
    html: () => documentHtml(doc, theme, images),
    docx: () => documentDocx(doc, theme, images),
  };
}

/** The whole document as Markdown (read_deliverable, search, what the bot remembers it made). */
export function documentMarkdown(doc) {
  const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const out = [`# ${doc.title}`];
  if (doc.subtitle) out.push(doc.subtitle);
  if (doc.author || doc.date) out.push(`_${[doc.author, doc.date].filter(Boolean).join(" · ")}_`);
  for (const b of doc.blocks) {
    if (b.type === "heading") out.push("#".repeat(b.level + 1) + " " + b.text);
    else if (b.type === "paragraph") out.push(b.text);
    else if (b.type === "bullets") out.push(b.items.map((i) => "- " + i).join("\n"));
    else if (b.type === "numbered") out.push(b.items.map((i, k) => `${k + 1}. ${i}`).join("\n"));
    else if (b.type === "table") out.push([`| ${b.header.map(cell).join(" | ")} |`, `| ${b.header.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${b.header.map((_, i) => cell(r[i])).join(" | ")} |`)].join("\n") + (b.caption ? `\n\n_${b.caption}_` : ""));
    else if (b.type === "image") out.push(`![${b.caption}](${b.image})`);
    else if (b.type === "chart") out.push(`_Gráfico (${b.chart.type}): ${b.caption || ""}_\n\n` + [`| | ${b.chart.series.map((s) => cell(s.name || "Valor")).join(" | ")} |`, `| --- | ${b.chart.series.map(() => "---").join(" | ")} |`, ...b.chart.labels.map((l, i) => `| ${cell(l)} | ${b.chart.series.map((s) => s.values[i]).join(" | ")} |`)].join("\n"));
    else if (b.type === "quote") out.push("> " + b.text + (b.author ? `\n> — ${b.author}` : ""));
    else if (b.type === "callout") out.push(`> **${b.title || "Nota"}:** ${b.text}`);
    else if (b.type === "page_break") out.push("---");
  }
  return out.join("\n\n");
}

/** The outline in a few lines (the tool's answer). */
export function documentOutline(doc) {
  return doc.blocks.filter((b) => b.type === "heading").map((b) => "  ".repeat(b.level - 1) + "- " + plain(b.text)).join("\n");
}
