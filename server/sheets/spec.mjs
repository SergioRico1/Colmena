// An Excel workbook as the bot writes it: sheets with typed columns, rows of values and real
// formulas («=B2*C2», or one per column with {r} for the row), totals, simple conditional
// formatting and charts (pictures next to the table). Row 1 of every sheet is the header; the
// data starts in row 2, so the bot always knows which cell is which.
import { z } from "zod";
import { CHART_TYPES } from "../slides/spec.mjs";
import { PAPER_THEMES } from "../docs/spec.mjs";

export const COLUMN_TYPES = ["text", "number", "integer", "currency", "percent", "date", "boolean"];
export const TOTALS = ["none", "sum", "average", "min", "max", "count"];
export const RULES = ["greater", "less", "between", "equal", "negative", "positive", "contains", "data_bar", "color_scale"];
export const STYLES = ["good", "bad", "warn", "accent"];
export const LIMITS = Object.freeze({ sheets: 12, columns: 30, rows: 2000, cells: 40000, csvRows: 3000 });

const value = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

export const columnSchema = z.object({
  header: z.string().trim().min(1).max(80),
  type: z.enum(COLUMN_TYPES).default("text"),
  // currency: ISO code (EUR by default); decimals for number, currency and percent.
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("EUR"),
  decimals: z.number().int().min(0).max(6).nullish(),
  width: z.number().min(4).max(100).nullish(),
  // The same formula on every data row, {r} being the row: «=C{r}*D{r}».
  formula: z.string().trim().max(1000).default(""),
  total: z.enum(TOTALS).default("none"),
});

export const sheetSchema = z.object({
  name: z.string().trim().min(1).max(31).refine((n) => !/[\\/?*[\]:]/.test(n), "sin \\ / ? * [ ] :"),
  columns: z.array(columnSchema).min(1).max(LIMITS.columns),
  rows: z.array(z.array(value).max(LIMITS.columns)).max(LIMITS.rows).default([]),
  // Rows from a CSV of the mission folder instead of «rows» (its first line is the header and is skipped).
  rows_from: z.string().trim().max(400).default(""),
  totals_label: z.string().trim().max(60).default("Total"),
  conditional: z.array(z.object({
    column: z.string().trim().min(1).max(80),
    rule: z.enum(RULES),
    value: z.union([z.number(), z.string().max(200)]).nullish(),
    value2: z.number().nullish(),
    style: z.enum(STYLES).default("accent"),
  })).max(12).default([]),
  charts: z.array(z.object({
    type: z.enum(CHART_TYPES).default("column"),
    title: z.string().trim().max(120).default(""),
    labels: z.string().trim().min(1).max(80),
    series: z.array(z.string().trim().min(1).max(80)).min(1).max(4),
  })).max(4).default([]),
});

export const workbookSchema = z.object({
  title: z.string().trim().min(1).max(120),
  theme: z.enum(PAPER_THEMES).default("sobrio"),
  accent: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).or(z.literal("")).default(""),
  sheets: z.array(sheetSchema).min(1).max(LIMITS.sheets),
});
