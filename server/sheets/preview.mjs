// What Colmena shows of a workbook: each sheet as a grid of the values Excel will show (with
// the formula behind each computed cell and the colours of its rules), its charts, and the
// same content as Markdown for the bots.
import { chartPng } from "../office/common.mjs";
import { tint } from "../docs/html.mjs";
import { colLetter, isErr } from "./formula.mjs";
import { columnOf, dataRows, display } from "./index.mjs";

export const RULE_STYLES = (theme) => ({
  good: { fill: "C6EFCE", ink: "006100" },
  bad: { fill: "FFC7CE", ink: "9C0006" },
  warn: { fill: "FFEB9C", ink: "9C5700" },
  accent: { fill: tint(theme.accent, 0.16), ink: theme.accent },
});
// Bars and scales in light tones, so the figure on top stays readable.
export const SCALE_TO = (theme) => ({ good: "63BE7B", bad: "F8696B", warn: "FFD966", accent: tint(theme.accent, 0.45) });
const NUMERIC = new Set(["number", "integer", "currency", "percent", "date"]);

const lerp = (a, b, t) => {
  const pa = parseInt(a, 16), pb = parseInt(b, 16);
  return [16, 8, 0].map((s) => Math.round((pa >> s & 255) + ((pb >> s & 255) - (pa >> s & 255)) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
};

/** For each rule, what it does to each data cell of its column: {fill, ink} or {bar} or {fill}. */
function ruleMarks(g, theme) {
  const marks = new Map(); // "r,c" → {...}
  const styles = RULE_STYLES(theme), scale = SCALE_TO(theme);
  const rows = dataRows(g);
  for (const rule of g.sheet.conditional) {
    const c = columnOf(g.sheet, rule.column);
    const values = rows.map((row) => row[c]?.value);
    const nums = values.filter((v) => typeof v === "number");
    const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
    values.forEach((v, i) => {
      const key = i + 1 + "," + c;
      const prev = marks.get(key) || {};
      if (rule.rule === "data_bar") { if (typeof v === "number") marks.set(key, { ...prev, bar: 0.1 + 0.9 * (v - min) / span, barColor: scale[rule.style] }); return; }
      if (rule.rule === "color_scale") { if (typeof v === "number") marks.set(key, { ...prev, fill: lerp("FFFFFF", scale[rule.style], (v - min) / span) }); return; }
      const hit = rule.rule === "contains"
        ? v != null && String(v).toLowerCase().includes(String(rule.value).toLowerCase())
        : typeof v === "number" && {
          greater: v > rule.value, less: v < rule.value, equal: v === rule.value, between: v >= Math.min(rule.value, rule.value2) && v <= Math.max(rule.value, rule.value2),
          negative: v < 0, positive: v > 0,
        }[rule.rule];
      // As in Excel, the first rule that matches wins.
      if (hit && !prev.fill) marks.set(key, { ...prev, ...styles[rule.style] });
    });
  }
  return marks;
}

/** The data of one chart of a sheet, as the slides draw it. */
export function chartData(g, chart) {
  const rows = dataRows(g);
  const li = columnOf(g.sheet, chart.labels);
  const cols = chart.series.map((s) => columnOf(g.sheet, s));
  const first = g.sheet.columns[cols[0]];
  const pct = first.type === "percent";
  return {
    type: chart.type,
    labels: rows.map((row) => display(row[li]?.value, g.sheet.columns[li]).slice(0, 40) || "—"),
    series: cols.map((c) => ({ name: g.sheet.columns[c].header, values: rows.map((row) => (typeof row[c]?.value === "number" ? row[c].value * (pct ? 100 : 1) : 0)) })),
    unit: pct ? "%" : first.type === "currency" ? ({ EUR: "€", USD: "$", GBP: "£" }[first.currency] || first.currency) : "",
  };
}

/** Every chart of the workbook as PNG: [{sheet, index, title, bytes, width, height}]. */
export function workbookCharts(built) {
  return built.grids.flatMap((g) => g.sheet.charts.map((chart, k) => ({
    sheet: g.sheet.name, index: k, title: chart.title,
    ...chartPng(chartData(g, chart), built.theme, { title: chart.title }),
  })));
}

/** The preview: the first `maxRows` rows of each sheet, ready to draw. */
export function workbookPreview(built, { maxRows = 500 } = {}) {
  return {
    title: built.book.title,
    accent: built.theme.accent, dark: built.theme.dark,
    sheets: built.grids.map((g) => {
      const marks = ruleMarks(g, built.theme);
      const columns = g.sheet.columns.map((col, c) => ({ header: col.header, letter: colLetter(c), type: col.type, align: NUMERIC.has(col.type) ? "right" : col.type === "boolean" ? "center" : "left" }));
      const body = g.grid.slice(1);
      return {
        name: g.sheet.name,
        columns,
        rowCount: g.sheet.rows.length,
        rows: body.slice(0, maxRows).map((row, i) => ({
          n: i + 2,
          total: !!row[0]?.total,
          cells: row.map((cell, c) => {
            const out = { v: display(cell.value, g.sheet.columns[c]) };
            if (cell.formula) out.f = "=" + cell.formula;
            if (isErr(cell.value)) out.err = true;
            const mark = marks.get(i + 1 + "," + c);
            if (mark) Object.assign(out, mark);
            if (columns[c].align !== "left" && typeof cell.value === "string") out.align = "left";
            return out;
          }),
        })),
        truncated: body.length > maxRows,
        charts: g.sheet.charts.map((ch) => ch.title || ch.series.join(", ")),
      };
    }),
  };
}

/** The workbook as Markdown tables (read_deliverable, search): values, with the formulas noted. */
export function workbookMarkdown(built, { maxRows = 60 } = {}) {
  const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const out = [`# ${built.book.title}`];
  for (const g of built.grids) {
    const cols = g.sheet.columns;
    const body = g.grid.slice(1);
    out.push(`## Hoja «${g.sheet.name}» (${g.sheet.rows.length} filas)`);
    out.push([`| | ${cols.map((c, i) => `${colLetter(i)} · ${cell(c.header)}`).join(" | ")} |`, `| --- | ${cols.map(() => "---").join(" | ")} |`,
      ...body.slice(0, maxRows).map((row, i) => `| ${i + 2} | ${row.map((x, c) => cell(display(x.value, cols[c]))).join(" | ")} |`)].join("\n") + (body.length > maxRows ? `\n\n_… y ${body.length - maxRows} filas más._` : ""));
    const formulas = cols.map((c, i) => [c, i]).filter(([c]) => c.formula).map(([c, i]) => `${colLetter(i)} (${c.header}): ${c.formula}`);
    const totals = cols.map((c, i) => [c, i]).filter(([c]) => c.total !== "none").map(([c, i]) => `${colLetter(i)}: ${c.total}`);
    if (formulas.length) out.push("Fórmulas por fila: " + formulas.join("; "));
    if (totals.length) out.push("Totales: " + totals.join("; "));
  }
  return out.join("\n\n");
}
