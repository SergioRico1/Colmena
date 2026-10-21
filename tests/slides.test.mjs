import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildDeck } from "../server/slides/index.mjs";
import { fit } from "../server/slides/layout.mjs";
import { makePresentation } from "../server/slides/make.mjs";

const deck = {
  title: "Resultados Q3",
  slides: [
    { layout: "cover", title: "Resultados del tercer trimestre", subtitle: "Comité de dirección" },
    { layout: "stats", title: "El trimestre en cifras", stats: [{ value: "15.962 €", label: "facturación" }, { value: "56", label: "pedidos" }] },
    { layout: "chart", title: "Facturación por semana", chart: { type: "column", labels: ["S1", "S2", "S3"], series: [{ name: "€", values: [4462, 4291, 1072] }] }, subtitle: "La segunda semana fue la mejor." },
    { layout: "table", title: "Por canal", table: { header: ["Canal", "Pedidos"], rows: [["Hogarmax", "21"], ["Web", "12"]] } },
    { layout: "closing", title: "Gracias" },
  ],
};

async function tmp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-slides-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("a deck becomes an editable PowerPoint and a page with one 1280×720 section per slide", async () => {
  const b = await buildDeck(deck);
  const html = b.html();
  assert.equal((html.match(/<section class="slide"/g) || []).length, 5);
  assert.match(b.html({ only: 3 }), /data-n="3"/);
  assert.doesNotMatch(b.html({ only: 3 }), /data-n="1"/);
  const bytes = await b.pptx();
  assert.equal(bytes.subarray(0, 2).toString(), "PK", "a zip (pptx)");
  assert.ok(bytes.includes(Buffer.from("ppt/slides/slide5.xml")), "five slides");
  assert.ok(bytes.includes(Buffer.from("ppt/charts/")), "a native chart");
});

test("text is escaped: a slide never runs what the bot wrote", async () => {
  const b = await buildDeck({ title: "x", slides: [{ layout: "bullets", title: "<script>alert(1)</script>", bullets: ["<img src=x onerror=alert(1)>"] }] });
  assert.doesNotMatch(b.html(), /<script>alert|<img src=x/);
});

test("an incomplete script says what to fix before anything is made", async () => {
  await assert.rejects(buildDeck({ title: "x", slides: [{ layout: "chart", title: "Ventas" }] }), /Diapositiva 1 \(chart\): necesita chart/);
  await assert.rejects(buildDeck({ title: "x", slides: [{ layout: "chart", title: "V", chart: { labels: ["a", "b"], series: [{ values: [1] }] } }] }), /1 valores y hay 2 etiquetas/);
  await assert.rejects(buildDeck({ title: "x", slides: [{ layout: "image", image: "imagenes/no-existe.png" }] }, { root: os.tmpdir() }), /no puedo usar la imagen/);
});

test("text shrinks to fit its box, and what cannot fit is reported", async () => {
  assert.equal(fit(["Corto"], { w: 1000, h: 100 }, { max: 40, min: 28 }).size, 40);
  const long = Array.from({ length: 7 }, () => "Una frase bastante larga que ocupa casi una línea entera de la diapositiva y algo más, con todavía más detalle del que cabe en una columna estrecha");
  const b = await buildDeck({ title: "x", slides: [{ layout: "two_columns", title: "Mucho", left: { heading: "A", bullets: long.slice(0, 6) }, right: { heading: "B", bullets: long.slice(0, 6) } }] });
  assert.match(b.warnings.join(" "), /Diapositiva 1: una columna no cabe/);
});

test("the files land in the mission folder: .pptx and, next to it, the page the viewer uses", async (t) => {
  const root = await tmp(t);
  const made = await makePresentation({ root, input: deck });
  assert.equal(made.pptx.path, "presentaciones/resultados-q3.pptx");
  assert.equal(made.html, "presentaciones/resultados-q3/presentacion.html");
  assert.match(await readFile(path.join(root, made.html), "utf8"), /Resultados del tercer trimestre/);
  // A second version never overwrites the first.
  const again = await makePresentation({ root, input: deck });
  assert.equal(again.pptx.path, "presentaciones/resultados-q3-2.pptx");
});

test("with the desktop app it draws every slide and its PDF, and adds what it measured", async (t) => {
  const root = await tmp(t);
  const calls = [];
  const computer = { available: true, async call(op, args) { calls.push({ op, args }); return { shots: ["diapositiva-01.png"], pdf: "resultados-q3.pdf", overflow: [{ slide: 2, what: "una cifra" }] }; } };
  const made = await makePresentation({ root, input: deck, computer });
  assert.equal(calls[0].op, "render");
  assert.equal(calls[0].args.count, 5);
  assert.ok(path.isAbsolute(calls[0].args.htmlPath));
  assert.deepEqual(made.shots, ["presentaciones/resultados-q3/diapositiva-01.png"]);
  assert.equal(made.pdf, "presentaciones/resultados-q3/resultados-q3.pdf");
  assert.match(made.warnings.join(" "), /Diapositiva 2: una cifra no cabe/);
});

test("a slide image comes from the mission folder", async (t) => {
  const root = await tmp(t);
  await mkdir(path.join(root, "imagenes"), { recursive: true });
  // 1×1 PNG.
  await writeFile(path.join(root, "imagenes", "portada.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  const b = await buildDeck({ title: "x", slides: [{ layout: "cover", title: "Con foto", image: "imagenes/portada.png" }] }, { root });
  assert.match(b.html(), /src="data:image\/png;base64,/);
  assert.ok((await b.pptx()).includes(Buffer.from("ppt/media/")));
});
