// A workbook from the bot's script: values typed by column, formulas computed (to show them and
// to catch errors before anyone opens the file), totals, rules and charts — then written as
// .xlsx and summarised for the preview.
import { readMissionBytes } from "../files.mjs";
import { paperTheme } from "../office/common.mjs";
import { LIMITS, workbookSchema } from "./spec.mjs";
import { cellName, colIndex, colLetter, evaluate, isErr, normalizeFormula, parseFormula, references, serialOf, UNKNOWN, XError } from "./formula.mjs";

const DEFAULT_DECIMALS = { number: 2, currency: 2, percent: 1 };
const SYMBOL = { EUR: "€", USD: "$", GBP: "£" };

/** The Excel number format of a column. */
export function numFmtOf(col) {
  const d = col.decimals ?? DEFAULT_DECIMALS[col.type] ?? 0;
  const dec = d ? "." + "0".repeat(d) : "";
  switch (col.type) {
    case "integer": return "#,##0";
    case "number": return "#,##0" + dec;
    case "currency": return col.currency === "USD" ? `"$"#,##0${dec}` : col.currency === "GBP" ? `"£"#,##0${dec}` : `#,##0${dec} "${SYMBOL[col.currency] || col.currency}"`;
    case "percent": return "0" + dec + "%";
    case "date": return "dd/mm/yyyy";
    default: return null;
  }
}

/** A value as the person sees it in Excel with Spanish settings. */
export function display(value, col) {
  if (value === UNKNOWN) return "…";
  if (isErr(value)) return value.code;
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "VERDADERO" : "FALSO";
  if (typeof value !== "number") return String(value);
  const d = col.decimals ?? DEFAULT_DECIMALS[col.type] ?? (Number.isInteger(value) ? 0 : 2);
  const fmt = (x, digits) => x.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: "always" });
  switch (col.type) {
    case "integer": return fmt(Math.round(value), 0);
    case "currency": { const s = fmt(value, d); return col.currency === "USD" ? "$" + s : col.currency === "GBP" ? "£" + s : `${s} ${SYMBOL[col.currency] || col.currency}`; }
    case "percent": return fmt(value * 100, d) + " %";
    case "date": { const t = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000)); return `${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCMonth() + 1).padStart(2, "0")}/${t.getUTCFullYear()}`; }
    case "number": return fmt(value, d);
    default: return Number.isInteger(value) ? fmt(value, 0) : fmt(value, Math.min(4, String(value).split(".")[1]?.length || 0));
  }
}

/** «1.234,56 €», «12 %», «(300)», «1,234.5» → a number, or null. Spanish reading when ambiguous. */
export function parseNumber(raw) {
  let s = String(raw).replace(/[\s ]/g, "").replace(/[€$£]|EUR|USD/gi, "");
  const pct = s.endsWith("%");
  if (pct) s = s.slice(0, -1);
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^−/, "-");
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lastComma >= 0) s = /^[-+]?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (neg) n = -n;
  return pct ? n / 100 : n;
}

/** «2026-10-19», «19/10/2026» → Excel serial date, or null. */
export function parseDate(raw) {
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return Math.round(serialOf(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return Math.round(serialOf(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))));
  return null;
}

/** A value of the script in a column of this type: {value} or {formula}, plus a note when it does not fit. */
function typed(raw, col) {
  if (typeof raw === "string" && raw.trim().startsWith("=")) return { formula: raw.trim() };
  if (raw == null || raw === "") return { value: null };
  if (typeof raw === "string" && raw.startsWith("'")) return { value: raw.slice(1) };
  const numeric = ["number", "integer", "currency", "percent"].includes(col.type);
  if (numeric) {
    if (typeof raw === "number") return { value: raw };
    if (typeof raw === "boolean") return { value: raw ? 1 : 0 };
    const n = parseNumber(raw);
    return n == null ? { value: String(raw), mismatch: true } : { value: n };
  }
  if (col.type === "date") {
    if (typeof raw === "number") return { value: raw };
    const d = parseDate(raw);
    return d == null ? { value: String(raw), mismatch: true } : { value: d };
  }
  if (col.type === "boolean") {
    if (typeof raw === "boolean") return { value: raw };
    const s = String(raw).trim().toLowerCase();
    if (["sí", "si", "true", "verdadero", "1", "x"].includes(s)) return { value: true };
    if (["no", "false", "falso", "0"].includes(s)) return { value: false };
    return { value: String(raw), mismatch: true };
  }
  return { value: typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw) };
}

function parseCsv(text) {
  const firstLine = text.slice(0, text.indexOf("\n") + 1 || text.length);
  const sep = [";", "\t", ","].map((s) => [s, firstLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell.replace(/\r$/, "")]);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Which column a rule or chart means: its header, or its letter. */
function columnOf(sheet, ref) {
  const want = String(ref).trim().toLowerCase();
  const i = sheet.columns.findIndex((c) => c.header.toLowerCase() === want);
  if (i >= 0) return i;
  if (/^[a-z]{1,3}$/.test(want) && colIndex(want) < sheet.columns.length) return colIndex(want);
  return -1;
}

const TOTAL_FN = { sum: "SUM", average: "AVERAGE", min: "MIN", max: "MAX", count: "COUNTA" };

/**
 * The validated workbook with every cell resolved. Throws (in Spanish) when the script is
 * incomplete or a formula gives an error. `root` is the mission folder (rows_from).
 */
export async function buildWorkbook(input, { root } = {}) {
  const book = workbookSchema.parse(input);
  const problems = [];
  const names = new Set();
  for (const sheet of book.sheets) {
    const key = sheet.name.toLowerCase();
    if (names.has(key)) problems.push(`Hay dos hojas «${sheet.name}».`);
    names.add(key);
    if (sheet.rows_from) {
      if (!root) { problems.push(`Hoja «${sheet.name}»: rows_from necesita la carpeta de la misión.`); continue; }
      if (sheet.rows.length) problems.push(`Hoja «${sheet.name}»: usa rows o rows_from, no los dos.`);
      try {
        const { bytes } = await readMissionBytes(root, sheet.rows_from);
        const rows = parseCsv(Buffer.from(bytes).toString("utf8").replace(/^﻿/, "")).slice(1);
        if (rows.length > LIMITS.csvRows) problems.push(`Hoja «${sheet.name}»: el CSV tiene ${rows.length} filas y el máximo son ${LIMITS.csvRows}.`);
        sheet.rows = rows.slice(0, LIMITS.csvRows).map((r) => sheet.columns.map((_, i) => r[i] ?? null));
        sheet.rows_from = "";
      } catch (e) { problems.push(`Hoja «${sheet.name}»: no puedo leer «${sheet.rows_from}» (${e.message}).`); }
    }
    sheet.rows.forEach((r, i) => { if (r.length > sheet.columns.length) problems.push(`Hoja «${sheet.name}», fila ${i + 2}: tiene ${r.length} valores y hay ${sheet.columns.length} columnas.`); });
    for (const rule of sheet.conditional) if (columnOf(sheet, rule.column) < 0) problems.push(`Hoja «${sheet.name}»: el formato condicional usa la columna «${rule.column}», que no existe.`);
    for (const rule of sheet.conditional) if (["greater", "less", "equal", "between"].includes(rule.rule) && typeof rule.value !== "number") problems.push(`Hoja «${sheet.name}»: la regla ${rule.rule} de «${rule.column}» necesita value numérico.`);
    for (const rule of sheet.conditional) if (rule.rule === "between" && typeof rule.value2 !== "number") problems.push(`Hoja «${sheet.name}»: la regla between de «${rule.column}» necesita value2.`);
    for (const rule of sheet.conditional) if (rule.rule === "contains" && !String(rule.value ?? "").trim()) problems.push(`Hoja «${sheet.name}»: la regla contains de «${rule.column}» necesita value (el texto).`);
    for (const [k, chart] of sheet.charts.entries()) {
      for (const ref of [chart.labels, ...chart.series]) if (columnOf(sheet, ref) < 0) problems.push(`Hoja «${sheet.name}», gráfico ${k + 1}: no hay ninguna columna «${ref}».`);
      if (!sheet.rows.length) problems.push(`Hoja «${sheet.name}», gráfico ${k + 1}: la hoja no tiene filas.`);
      if (sheet.rows.length > 24) problems.push(`Hoja «${sheet.name}», gráfico ${k + 1}: un gráfico admite hasta 24 filas (hay ${sheet.rows.length}); haz una hoja resumen y grafica esa.`);
    }
  }
  const cells = book.sheets.reduce((n, s) => n + s.rows.length * s.columns.length, 0);
  if (cells > LIMITS.cells) problems.push(`El libro tiene ${cells} celdas y el máximo son ${LIMITS.cells}.`);
  if (problems.length) throw Error("La hoja de cálculo no está completa: " + problems.slice(0, 10).join(" "));

  // ---- the grid of every sheet: header row, data rows, totals row ----
  const warnings = [], notes = new Set();
  const grids = new Map();
  for (const sheet of book.sheets) {
    const grid = [sheet.columns.map((c) => ({ value: c.header, header: true }))];
    sheet.rows.forEach((r, i) => {
      grid.push(sheet.columns.map((col, c) => {
        const raw = r[c];
        const cell = (raw == null || raw === "") && col.formula ? { formula: col.formula.replace(/\{r\}/gi, String(i + 2)) } : typed(raw, col);
        if (cell.mismatch && warnings.length < 8) warnings.push(`Hoja «${sheet.name}», ${cellName(i + 1, c)}: la columna «${col.header}» es de tipo ${col.type} y tiene «${String(raw).slice(0, 40)}» (se queda como texto y no suma).`);
        return cell;
      }));
    });
    const last = sheet.rows.length + 1;
    if (sheet.rows.length && sheet.columns.some((c) => c.total !== "none")) {
      grid.push(sheet.columns.map((col, c) => {
        if (col.total !== "none") return { formula: `=${TOTAL_FN[col.total]}(${colLetter(c)}2:${colLetter(c)}${last})`, total: true };
        return { value: c === 0 ? sheet.totals_label : null, total: true };
      }));
    }
    grids.set(sheet.name.toLowerCase(), { sheet, grid });
  }

  // ---- formulas: parse, check references, compute (memoised, cycles caught) ----
  const errors = [];
  for (const { sheet, grid } of grids.values()) {
    grid.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell.formula) return;
      cell.formula = normalizeFormula(cell.formula);
      try {
        cell.ast = parseFormula(cell.formula);
        for (const ref of references(cell.ast)) {
          const target = grids.get((ref.sheet ?? sheet.name).toLowerCase());
          if (!target) continue; // evaluate() says #REF! with the name
          if (ref.r1 === r && ref.c1 === c && ref.single && !ref.sheet) cell.ast = { k: "lit", v: new XError("#REF!", "se usa a sí misma") };
        }
      } catch (e) {
        cell.ast = { k: "lit", v: e instanceof XError ? e : new XError("#VALUE!", e.message) };
      }
    }));
  }
  const computing = new Set();
  const valueAt = (g, r, c) => {
    const cell = g.grid[r]?.[c];
    if (!cell) return null;
    if (!cell.formula) return cell.value;
    if ("value" in cell) return cell.value;
    const key = g.sheet.name + "!" + r + "," + c;
    if (computing.has(key)) return new XError("#REF!", "referencia circular");
    computing.add(key);
    let v = evaluate(cell.ast, {
      sheet: g.sheet.name,
      size: (name) => { const t = grids.get(String(name).toLowerCase()); return t ? { rows: t.grid.length, cols: t.sheet.columns.length } : null; },
      cell: (name, rr, cc) => valueAt(grids.get(String(name).toLowerCase()), rr, cc),
    });
    computing.delete(key);
    if (isErr(v) && !v.cell) v = Object.assign(new XError(v.code, v.why), { cell: key });
    cell.value = v;
    return v;
  };
  for (const g of grids.values()) {
    g.grid.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell.formula) return;
      const v = valueAt(g, r, c);
      if (v === UNKNOWN) notes.add((/^([A-Z][A-Z0-9.]*)\(/.exec(cell.formula) || [])[1] || "una función");
      if (isErr(v) && v.cell === g.sheet.name + "!" + r + "," + c) errors.push(`«${g.sheet.name}»!${cellName(r, c)} =${cell.formula} → ${v.code}${v.why ? " (" + v.why + ")" : ""}`);
    }));
  }
  if (errors.length) {
    throw Error(`Hay fórmulas que dan error: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? `; y ${errors.length - 8} más` : ""}. ` +
      'Recuerda: la fila 1 es la cabecera y los datos empiezan en la fila 2; usa nombres de función en inglés (SUM, IF…) y comas entre argumentos. Si un error es esperable, envuélvelo en IFERROR(…,"").');
  }

  const theme = paperTheme(book);
  return {
    book, theme, grids: [...grids.values()], warnings,
    notes: [...notes].map((f) => `No compruebo ${f} en la vista previa: Excel la calcula al abrir el archivo.`),
  };
}

/** The rows of a sheet as plain values (charts, Markdown), without the header. */
export const dataRows = (g) => g.grid.slice(1, g.sheet.rows.length + 1);
export { columnOf };
