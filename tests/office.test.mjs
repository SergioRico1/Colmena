import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { buildDocument, documentMarkdown } from "../server/docs/index.mjs";
import { makeDocument } from "../server/docs/make.mjs";
import { buildWorkbook, parseNumber } from "../server/sheets/index.mjs";
import { evaluate, normalizeFormula, parseFormula } from "../server/sheets/formula.mjs";
import { makeSpreadsheet } from "../server/sheets/make.mjs";
import { workbookPreview } from "../server/sheets/preview.mjs";
import { artifactSummary } from "../server/state.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function tmp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-office-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const report = {
  title: "Informe Q3", subtitle: "Para dirección", author: "Atlas", date: "19/10/2026",
  blocks: [
    { type: "heading", text: "Resumen" },
    { type: "paragraph", text: "Crecimos un **12 %**, sobre todo en *marketplaces*. Fuente: [INE](https://www.ine.es)." },
    { type: "bullets", items: ["Uno", "Dos"] },
    { type: "numbered", items: ["Primero", "Segundo"] },
    { type: "table", header: ["Canal", "Pedidos"], rows: [["Web", "12"], ["Tienda", "9"]], caption: "Pedidos por canal" },
    { type: "chart", chart: { type: "column", labels: ["Jul", "Ago"], series: [{ name: "€", values: [10, 20] }] }, caption: "Ventas" },
    { type: "quote", text: "Buen trimestre.", author: "Dirección" },
    { type: "callout", tone: "warning", title: "Ojo", text: "Un pedido no se repite." },
    { type: "page_break" },
  ],
};

const unzipHas = (bytes, name) => bytes.includes(Buffer.from(name));

// ---------- Word ----------

test("a document becomes a .docx with real heading styles, a native chart and page numbers, and its A4 page", async () => {
  const b = await buildDocument(report);
  const bytes = await b.docx();
  assert.equal(bytes.subarray(0, 2).toString(), "PK", "a zip (docx)");
  assert.ok(unzipHas(bytes, "word/document.xml"));
  assert.ok(unzipHas(bytes, "word/charts/chart1.xml"), "an editable Word chart");
  const html = b.html();
  assert.match(html, /@page\{size:A4/);
  assert.match(html, /<h2 class="h1">Resumen<\/h2>/);
  assert.match(html, /<strong>12 %<\/strong>/);
  assert.match(html, /<a href="https:\/\/www.ine.es">INE<\/a>/);
  assert.match(html, /<td class="num">12<\/td>/, "figures aligned right");
  // A page break at the end would print a blank page.
  assert.ok(!b.doc.blocks.some((x) => x.type === "page_break"));
  assert.match(documentMarkdown(b.doc), /\| Canal \| Pedidos \|/);
});

test("document text is escaped and only http(s) links are kept", async () => {
  const b = await buildDocument({ title: "<b>x</b>", blocks: [{ type: "paragraph", text: "<script>alert(1)</script> [a](javascript:alert(1))" }] });
  const html = b.html();
  assert.doesNotMatch(html, /<script>alert|href="javascript/);
});

test("an incomplete document says what to fix before anything is made", async () => {
  await assert.rejects(buildDocument({ title: "x", blocks: [{ type: "table", header: ["a"] }] }), /Bloque 1 \(table\): necesita rows/);
  await assert.rejects(buildDocument({ title: "x", blocks: [{ type: "table", header: ["a"], rows: [["1", "2"]] }] }), /la fila 1 tiene 2 celdas/);
  await assert.rejects(buildDocument({ title: "x", blocks: [{ type: "image", image: "imagenes/no.png" }] }, { root: os.tmpdir() }), /no puedo usar la imagen/);
});

test("a document's files land in the mission folder; with the desktop app it is printed and each page drawn", async (t) => {
  const root = await tmp(t);
  await mkdir(path.join(root, "imagenes"));
  await writeFile(path.join(root, "imagenes", "foto.png"), PNG);
  const input = { ...report, blocks: [...report.blocks, { type: "image", image: "imagenes/foto.png", width: "half", caption: "Foto" }] };
  const made = await makeDocument({ root, input });
  assert.equal(made.docx.path, "documentos/informe-q3.docx");
  assert.equal(made.html, "documentos/informe-q3/documento.html");
  assert.match(await readFile(path.join(root, made.html), "utf8"), /src="data:image\/png;base64,/);
  assert.ok(unzipHas(await readFile(path.join(root, made.docx.path)), "word/media/"), "the picture is inside the .docx");
  assert.equal((await makeDocument({ root, input })).docx.path, "documentos/informe-q3-2.docx", "a new version never overwrites");

  const calls = [];
  const computer = { available: true, async call(op, args) { calls.push({ op, args }); return { shots: [], pdf: null, overflow: [] }; } };
  const printed = await makeDocument({ root, input, computer });
  assert.equal(calls[0].op, "render");
  assert.equal(calls[0].args.pdf, true);
  assert.match(calls[0].args.page.footer, /pageNumber/);
  assert.equal(printed.pdf, null);
});

// ---------- formulas ----------

test("the formula engine computes what Excel would and names the errors", () => {
  const grid = { A: [[1], [2], [3], [null]] };
  const ctx = { sheet: "A", size: (s) => (s === "A" ? { rows: 4, cols: 1 } : null), cell: (_s, r, c) => grid.A[r]?.[c] ?? null };
  const run = (f) => evaluate(parseFormula(normalizeFormula(f)), ctx);
  assert.equal(run("=SUM(A1:A3)*2"), 12);
  assert.equal(run("=AVERAGE(A1:A4)"), 2);
  assert.equal(run('=IF(A1>0,"sí","no")'), "sí");
  assert.equal(run("=ROUND(10/3,2)"), 3.33);
  assert.equal(run('=COUNTIF(A1:A3,">1")'), 2);
  assert.equal(run("=10%"), 0.1);
  assert.equal(run("=A1/A4").code, "#DIV/0!");
  assert.equal(run("=IFERROR(A1/A4,0)"), 0);
  assert.equal(run("=Otra!A1").code, "#REF!");
  assert.equal(run("=FOO").code, "#NAME?");
  // Spanish Excel habits: names, semicolons and decimal commas.
  assert.equal(normalizeFormula("=SUMA(A1:A3;2,5)"), "SUM(A1:A3,2.5)");
  assert.equal(normalizeFormula("=B2*1,21"), "B2*1.21");
  assert.equal(normalizeFormula("=SI(A1>0;1;0)"), "IF(A1>0,1,0)");
  assert.equal(parseNumber("1.234,56 €"), 1234.56);
  assert.equal(parseNumber("12 %"), 0.12);
  assert.equal(parseNumber("(300)"), -300);
  assert.equal(parseNumber("n/d"), null);
});

// ---------- Excel ----------

const budget = {
  title: "Presupuesto",
  sheets: [
    {
      name: "Ventas",
      columns: [
        { header: "Producto" }, { header: "Unidades", type: "integer", total: "sum" }, { header: "Precio", type: "currency" },
        { header: "Importe", type: "currency", formula: "=B{r}*C{r}", total: "sum" }, { header: "Alta", type: "date" },
      ],
      rows: [["Sillas", 12, 45.5, null, "2026-01-15"], ["Mesas", 4, "180,00 €", null, "15/02/2026"]],
      conditional: [{ column: "Importe", rule: "data_bar" }, { column: "B", rule: "greater", value: 10, style: "good" }],
      charts: [{ type: "column", title: "Importe", labels: "Producto", series: ["Importe"] }],
    },
    { name: "Resumen", columns: [{ header: "Concepto" }, { header: "Valor", type: "currency" }], rows: [["Total", "=Ventas!D4"], ["Con IVA", "=SUMA(Ventas!D2:D3)*1,21"]] },
  ],
};

test("a workbook resolves types, row formulas, totals and cross-sheet formulas", async () => {
  const built = await buildWorkbook(budget);
  const preview = workbookPreview(built);
  const ventas = preview.sheets[0];
  assert.deepEqual(ventas.rows[0].cells.map((c) => c.v), ["Sillas", "12", "45,50 €", "546,00 €", "15/01/2026"]);
  assert.equal(ventas.rows[0].cells[3].f, "=B2*C2");
  assert.equal(ventas.rows[1].cells[2].v, "180,00 €", "a text figure becomes a number");
  assert.deepEqual(ventas.rows[2].cells.map((c) => c.v), ["Total", "16", "", "1.266,00 €", ""]);
  assert.ok(ventas.rows[2].total);
  assert.equal(ventas.rows[0].cells[1].fill, "C6EFCE", "12 > 10 is green");
  assert.ok(ventas.rows[1].cells[3].bar > 0.9, "the biggest bar is the longest");
  assert.deepEqual(preview.sheets[1].rows.map((r) => r.cells[1].v), ["1.266,00 €", "1.531,86 €"]);
});

test("formulas that give an error stop the workbook before any file exists, with the cell and why", async () => {
  const bad = (rows, extra = {}) => buildWorkbook({ title: "x", sheets: [{ name: "A", columns: [{ header: "a", type: "number" }, { header: "b", type: "number", ...extra }], rows }] });
  await assert.rejects(bad([[1, "=A2/0"]]), /«A»!B2 =A2\/0 → #DIV\/0!/);
  await assert.rejects(bad([[1, "=Hoja9!A1"]]), /#REF! \(no hay ninguna hoja «Hoja9»\)/);
  await assert.rejects(bad([[1, "=B3"], [2, "=B2"]]), /referencia circular/);
  await assert.rejects(bad([[1, "=SUM(A2:A3"]]), /falta «\)»/);
  await assert.rejects(buildWorkbook({ title: "x", sheets: [{ name: "A", columns: [{ header: "a" }], charts: [{ labels: "a", series: ["zz"] }], rows: [["1"]] }] }), /no hay ninguna columna «zz»/);
  // A function this engine does not know is left for Excel, not reported as an error.
  const ok = await bad([[1, "=XLOOKUP(1,A2:A2,A2:A2)"]]);
  assert.match(ok.notes.join(" "), /XLOOKUP/);
});

test("the .xlsx has real formulas with cached values, number formats, rules, the chart and frozen header", async (t) => {
  const root = await tmp(t);
  const made = await makeSpreadsheet({ root, input: budget });
  assert.equal(made.xlsx.path, "hojas/presupuesto.xlsx");
  assert.deepEqual(made.charts, ["hojas/presupuesto/grafico-1.png"]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(path.join(root, made.xlsx.path)));
  const ws = wb.getWorksheet("Ventas");
  assert.deepEqual(ws.getCell("D2").value, { formula: "B2*C2", result: 546 });
  assert.deepEqual(ws.getCell("D4").value, { formula: "SUM(D2:D3)", result: 1266 });
  assert.equal(ws.getCell("D2").numFmt, '#,##0.00 "€"');
  assert.equal(ws.getCell("E2").numFmt, "dd/mm/yyyy");
  assert.ok(ws.getCell("E2").value instanceof Date);
  assert.equal(ws.views[0].state, "frozen");
  assert.equal(ws.conditionalFormattings.length, 2);
  assert.equal(ws.getImages().length, 1);
  assert.deepEqual(wb.getWorksheet("Resumen").getCell("B3").value, { formula: "SUM(Ventas!D2:D3)*1.21", result: 1531.86 });
  assert.match(made.markdown, /\| 4 \| Total \| 16 \|/);
});

test("rows can come from a CSV of the mission (Spanish separators and figures)", async (t) => {
  const root = await tmp(t);
  await mkdir(path.join(root, "datos"));
  await writeFile(path.join(root, "datos", "gastos.csv"), "﻿Fecha;Concepto;Importe\n01/10/2026;Mercadona;-54,30\n02/10/2026;Nómina;2.150,00\n");
  const built = await buildWorkbook({ title: "G", sheets: [{ name: "Octubre", rows_from: "datos/gastos.csv", columns: [{ header: "Fecha", type: "date" }, { header: "Concepto" }, { header: "Importe", type: "currency", total: "sum" }] }] }, { root });
  assert.equal(built.book.sheets[0].rows.length, 2, "the CSV rows are now part of the script (stored for the preview)");
  assert.equal(built.book.sheets[0].rows_from, "");
  assert.equal(workbookPreview(built).sheets[0].rows[2].cells[2].v, "2.095,70 €");
});

test("the summary tells the views what each file is", () => {
  const doc = artifactSummary({ id: "a", title: "Informe", format: "docx", kind: "document", document: { title: "Informe" }, pages: 3, thumbs: ["p1", "p2", "p3"], pdf: "x.pdf" });
  assert.equal(doc.paged, true);
  assert.equal(doc.pages, 3);
  assert.equal(doc.pdf, true);
  const sheet = artifactSummary({ id: "b", title: "Libro", format: "xlsx", kind: "sheet", workbook: { sheets: [{ name: "A" }, { name: "B" }] }, rows: 9, charts: ["c.png"] });
  assert.deepEqual(sheet.sheets, ["A", "B"]);
  assert.equal(sheet.rows, 9);
  assert.equal(sheet.kind, "sheet");
});
