// The workbook as a native .xlsx: typed cells with their number formats, real formulas (with
// the value computed here as their cached result; Excel recalculates on open), totals, filters,
// frozen header, conditional formatting and the charts as pictures beside the table.
import ExcelJS from "exceljs";
import { colLetter, excelDate, isErr, UNKNOWN } from "./formula.mjs";
import { columnOf, numFmtOf } from "./index.mjs";
import { RULE_STYLES, SCALE_TO } from "./preview.mjs";

const argb = (hex) => "FF" + hex;
const OPERATOR = { greater: "greaterThan", less: "lessThan", equal: "equal", between: "between", negative: "lessThan", positive: "greaterThan" };

function width(g, c) {
  const col = g.sheet.columns[c];
  if (col.width) return col.width;
  let w = col.header.length + 4;
  for (const row of g.grid.slice(1, 300)) {
    const v = row[c]?.value;
    const len = v == null ? 0 : typeof v === "number" ? (col.type === "date" ? 10 : String(Math.round(v)).length + 6) : String(v).length;
    w = Math.max(w, len + 2);
  }
  return Math.min(60, Math.max(9, w));
}

/** exceljs value of a resolved cell. */
function valueOf(cell, col) {
  const asDate = (v) => (col.type === "date" && typeof v === "number" ? excelDate(v) : v);
  if (cell.formula) {
    const v = cell.value;
    if (v === UNKNOWN || v == null) return { formula: cell.formula };
    if (isErr(v)) return { formula: cell.formula, result: { error: v.code } };
    return { formula: cell.formula, result: asDate(v) };
  }
  return asDate(cell.value ?? null);
}

/** The .xlsx bytes. `charts`: [{sheet, index, bytes, width, height}] from workbookCharts(). */
export async function workbookXlsx(built, charts = []) {
  const { theme } = built;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Colmena";
  wb.lastModifiedBy = "Colmena";
  wb.title = built.book.title;
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const styles = RULE_STYLES(theme), scale = SCALE_TO(theme);
  for (const g of built.grids) {
    const cols = g.sheet.columns;
    const ws = wb.addWorksheet(g.sheet.name, {
      views: [{ state: "frozen", ySplit: 1, xSplit: 0, showGridLines: true }],
      properties: { defaultRowHeight: 18 },
      pageSetup: { paperSize: 9, orientation: cols.length > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" },
    });
    ws.columns = cols.map((col, c) => ({ width: width(g, c) }));
    g.grid.forEach((row, r) => {
      const xr = ws.getRow(r + 1);
      row.forEach((cell, c) => {
        const col = cols[c];
        const x = xr.getCell(c + 1);
        x.value = valueOf(cell, col);
        const fmt = numFmtOf(col);
        if (r > 0 && fmt) x.numFmt = fmt;
        if (r === 0) {
          x.font = { name: "Segoe UI Semibold", size: 10, bold: true, color: { argb: argb(theme.onDark) } };
          x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(theme.dark) } };
          x.alignment = { vertical: "middle", horizontal: ["text", "boolean"].includes(col.type) ? "left" : "right", wrapText: true };
        } else {
          x.font = { name: "Segoe UI", size: 10, bold: !!cell.total, color: { argb: argb(theme.ink) } };
          x.alignment = { vertical: "middle", ...(col.type === "boolean" ? { horizontal: "center" } : {}) };
          if (cell.total) {
            x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(theme.surface) } };
            x.border = { top: { style: "medium", color: { argb: argb(theme.ink) } } };
          }
        }
      });
      if (r === 0) xr.height = 24;
    });
    if (g.sheet.rows.length > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    // Conditional formatting over the data rows (never the header or the totals).
    const last = g.sheet.rows.length + 1;
    if (g.sheet.rows.length) {
      for (const rule of g.sheet.conditional) {
        const L = colLetter(columnOf(g.sheet, rule.column)), ref = `${L}2:${L}${last}`;
        const look = styles[rule.style];
        const style = { fill: { type: "pattern", pattern: "solid", bgColor: { argb: argb(look.fill) } }, font: { color: { argb: argb(look.ink) } } };
        let x;
        if (rule.rule === "data_bar") x = { type: "dataBar", minLength: 10, maxLength: 100, gradient: false, border: false, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: argb(scale[rule.style]) } };
        else if (rule.rule === "color_scale") x = { type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: "FFFFFFFF" }, { argb: argb(scale[rule.style]) }] };
        else if (rule.rule === "contains") x = { type: "containsText", operator: "containsText", text: String(rule.value), style };
        else x = { type: "cellIs", operator: OPERATOR[rule.rule], formulae: rule.rule === "between" ? [rule.value, rule.value2] : [rule.rule === "negative" || rule.rule === "positive" ? 0 : rule.value], style };
        ws.addConditionalFormatting({ ref, rules: [{ priority: 1, ...x }] });
      }
    }
    // Charts: pictures stacked to the right of the table.
    let top = 1;
    for (const chart of charts.filter((c) => c.sheet === g.sheet.name)) {
      const id = wb.addImage({ buffer: chart.bytes, extension: "png" });
      const w = 640, h = Math.round((w * chart.height) / chart.width);
      ws.addImage(id, { tl: { col: cols.length + 1, row: top }, ext: { width: w, height: h }, editAs: "oneCell" });
      top += Math.ceil(h / 24) + 2;
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
