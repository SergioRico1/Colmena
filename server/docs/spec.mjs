// A Word document as the bot writes it: a list of blocks (headings, paragraphs, lists, tables,
// pictures, charts, quotes, notes, page breaks), validated once and drawn twice — native Word
// for the editable file, HTML for the viewer and the PDF (as the slides are).
import { z } from "zod";
import { CHART_TYPES } from "../slides/spec.mjs";
// Documents and workbooks are printed: no dark theme.
export const PAPER_THEMES = ["colmena", "sobrio", "calido"];

export const BLOCKS = ["heading", "paragraph", "bullets", "numbered", "table", "image", "chart", "quote", "callout", "page_break"];
export const COVERS = ["header", "page", "none"];
export const TONES = ["info", "success", "warning"];

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).transform((v) => (v == null ? "" : String(v)).trim().slice(0, 600));

export const blockSchema = z.object({
  type: z.enum(BLOCKS),
  // heading, paragraph, quote, callout. Paragraphs accept **negrita**, *cursiva* y [texto](https://…).
  text: z.string().trim().max(6000).default(""),
  level: z.number().int().min(1).max(3).default(1),
  // bullets, numbered.
  items: z.array(z.string().trim().max(1200)).max(40).default([]),
  // table.
  header: z.array(cell).max(8).default([]),
  rows: z.array(z.array(cell).max(8)).max(300).default([]),
  // image: a PNG or JPG of the mission folder; width full or half of the line.
  image: z.string().trim().max(400).default(""),
  width: z.enum(["full", "half"]).default("full"),
  chart: z.object({
    type: z.enum(CHART_TYPES).default("column"),
    labels: z.array(z.string().trim().max(40)).min(1).max(12),
    series: z.array(z.object({ name: z.string().trim().max(60).default(""), values: z.array(z.number().finite()).min(1).max(12) })).min(1).max(4),
    unit: z.string().trim().max(12).default(""),
  }).nullish(),
  caption: z.string().trim().max(300).default(""),
  // quote: who said it; callout: its heading.
  author: z.string().trim().max(160).default(""),
  title: z.string().trim().max(160).default(""),
  tone: z.enum(TONES).default("info"),
});

export const documentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(300).default(""),
  author: z.string().trim().max(160).default(""),
  date: z.string().trim().max(60).default(""),
  theme: z.enum(PAPER_THEMES).default("sobrio"),
  accent: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).or(z.literal("")).default(""),
  cover: z.enum(COVERS).default("header"),
  blocks: z.array(blockSchema).min(1).max(400),
});

/** What each block needs, said in one sentence when it is missing. */
export function blockProblems(b, n) {
  const at = `Bloque ${n} (${b.type})`;
  const need = {
    heading: () => !b.text && "necesita text",
    paragraph: () => !b.text && "necesita text",
    bullets: () => !b.items.length && "necesita items",
    numbered: () => !b.items.length && "necesita items",
    table: () => (!b.header.length && "necesita header") || (!b.rows.length && "necesita rows"),
    image: () => !b.image && "necesita image (ruta de un PNG o JPG de la misión)",
    chart: () => !b.chart && "necesita chart",
    quote: () => !b.text && "necesita text",
    callout: () => !b.text && "necesita text",
  }[b.type]?.();
  const out = need ? [`${at}: ${need}.`] : [];
  if (b.type === "table") b.rows.forEach((r, i) => { if (r.length > b.header.length) out.push(`${at}: la fila ${i + 1} tiene ${r.length} celdas y la cabecera ${b.header.length}.`); });
  if (b.chart) for (const s of b.chart.series) if (s.values.length !== b.chart.labels.length) out.push(`${at}: la serie «${s.name || "sin nombre"}» tiene ${s.values.length} valores y hay ${b.chart.labels.length} etiquetas.`);
  return out;
}

/** The document validated, or an Error that tells the bot exactly what to fix. */
export function parseDocument(input) {
  const doc = documentSchema.parse(input);
  const problems = doc.blocks.flatMap((b, i) => blockProblems(b, i + 1));
  if (problems.length) throw Error("El documento no está completo: " + problems.slice(0, 12).join(" "));
  // A page break at the end, or two in a row, would print a blank page.
  doc.blocks = doc.blocks.filter((b, i, all) => b.type !== "page_break" || (i < all.length - 1 && all[i + 1].type !== "page_break" && i > 0));
  return doc;
}
