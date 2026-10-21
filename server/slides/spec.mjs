// A presentation as the bot writes it: a short structured script, never free-form slide code
// (OpenAI's and Anthropic's slide skills: one validated source, rendered twice — HTML for the
// viewer and the PDF, native PowerPoint for the editable file).
import { z } from "zod";

export const LAYOUTS = ["cover", "section", "bullets", "two_columns", "stats", "quote", "image", "chart", "table", "closing"];
export const THEMES = ["colmena", "noche", "sobrio", "calido"];
export const CHART_TYPES = ["bar", "column", "line", "pie", "doughnut"];

const line = z.string().trim().max(400);
const short = z.string().trim().max(160);
const column = z.object({ heading: short.default(""), bullets: z.array(line).max(6).default([]) });

export const slideSchema = z.object({
  layout: z.enum(LAYOUTS),
  title: short.default(""),
  subtitle: z.string().trim().max(300).default(""),
  bullets: z.array(line).max(7).default([]),
  left: column.nullish(),
  right: column.nullish(),
  stats: z.array(z.object({ value: z.string().trim().min(1).max(24), label: short })).max(4).default([]),
  quote: z.string().trim().max(400).default(""),
  author: short.default(""),
  // A PNG or JPG of the mission folder (create_image saves them in «imagenes/»).
  image: z.string().trim().max(400).default(""),
  caption: short.default(""),
  chart: z.object({
    type: z.enum(CHART_TYPES).default("column"),
    labels: z.array(z.string().trim().max(40)).min(1).max(12),
    series: z.array(z.object({ name: z.string().trim().max(60).default(""), values: z.array(z.number().finite()).min(1).max(12) })).min(1).max(4),
    unit: z.string().trim().max(12).default(""),
  }).nullish(),
  table: z.object({
    header: z.array(z.string().trim().max(60)).min(1).max(6),
    rows: z.array(z.array(z.string().trim().max(120)).max(6)).min(1).max(10),
  }).nullish(),
  notes: z.string().trim().max(2000).default(""),
});

export const deckSchema = z.object({
  title: z.string().trim().min(1).max(120),
  theme: z.enum(THEMES).default("colmena"),
  accent: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).or(z.literal("")).default(""),
  slides: z.array(slideSchema).min(1).max(30),
});

/** What each layout needs, said in one sentence when it is missing. */
export function slideProblems(slide, n) {
  const at = `Diapositiva ${n} (${slide.layout})`;
  const need = {
    cover: () => !slide.title && "necesita title",
    section: () => !slide.title && "necesita title",
    bullets: () => (!slide.title && "necesita title") || (!slide.bullets.length && "necesita bullets"),
    two_columns: () => (!slide.left?.bullets?.length || !slide.right?.bullets?.length) && "necesita left y right con bullets",
    stats: () => !slide.stats.length && "necesita stats (de 1 a 4 cifras)",
    quote: () => !slide.quote && "necesita quote",
    image: () => !slide.image && "necesita image (ruta de un PNG o JPG de la misión)",
    chart: () => !slide.chart && "necesita chart",
    table: () => !slide.table && "necesita table",
    closing: () => !slide.title && "necesita title",
  }[slide.layout]?.();
  const out = need ? [`${at}: ${need}.`] : [];
  if (slide.chart) for (const s of slide.chart.series) if (s.values.length !== slide.chart.labels.length) out.push(`${at}: la serie «${s.name || "sin nombre"}» tiene ${s.values.length} valores y hay ${slide.chart.labels.length} etiquetas.`);
  return out;
}

/** The deck validated, or an Error that tells the bot exactly what to fix. */
export function parseDeck(input) {
  const deck = deckSchema.parse(input);
  const problems = deck.slides.flatMap((s, i) => slideProblems(s, i + 1));
  if (problems.length) throw Error("La presentación no está completa: " + problems.join(" "));
  return deck;
}
