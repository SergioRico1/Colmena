// create_spreadsheet end to end: the .xlsx, its charts as pictures (next to it, in a folder
// with the same name) and what the preview and the bot need to know about it.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createUniqueFile, safePath } from "../files.mjs";
import { buildWorkbook } from "./index.mjs";
import { workbookCharts, workbookMarkdown } from "./preview.mjs";
import { workbookXlsx } from "./xlsx.mjs";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * {root, input} → {book, xlsx: {path, bytes}, folder, charts: [path], warnings, notes, markdown, summary}
 * `book` is the script with every CSV row in it (what is stored to draw the preview again).
 */
export async function makeSpreadsheet({ root, input } = {}) {
  const built = await buildWorkbook(input, { root });
  const pictures = workbookCharts(built);
  const xlsx = await createUniqueFile(root, "hojas", built.book.title, "xlsx", await workbookXlsx(built, pictures));
  const folder = xlsx.path.replace(/\.xlsx$/, "");
  const charts = [];
  for (const [i, p] of pictures.entries()) {
    const relative = `${folder}/grafico-${i + 1}.png`;
    const target = await safePath(root, relative, { parent: true });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, p.bytes);
    charts.push(relative);
  }
  const summary = built.grids.map((g) => `«${g.sheet.name}»: ${g.sheet.rows.length} filas × ${g.sheet.columns.length} columnas` +
    (g.sheet.columns.some((c) => c.total !== "none") ? ", con totales" : "") + (g.sheet.charts.length ? `, ${g.sheet.charts.length} gráfico(s)` : "")).join("; ");
  return { built, book: built.book, xlsx, folder, charts, warnings: built.warnings, notes: built.notes, markdown: workbookMarkdown(built), summary };
}
