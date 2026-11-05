import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { Store } from "../server/store.mjs";
import { createOfficeConverter, documentFonts, findSoffice, missingFrom } from "../server/officepdf.mjs";
import { registerWorkFileRoutes, NO_CONVERTER_NOTE } from "../server/workfiles.mjs";
import { registerDragRoutes, fileOfUrl, dragRoots } from "../server/dragout.mjs";
import { makeDocx, makePdf, makeZip } from "./fixtures/core-files.mjs";

async function tmp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-officepdf-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

/** An injected engine: counts its conversions; `gate` holds them until released. */
function fakeEngine({ name = "fake", formats = null, missingFonts = [], hold = false } = {}) {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  return {
    name, label: "Conversor de prueba", calls, release,
    available: async () => true,
    supports: async (ext) => !formats || formats.includes(ext),
    async convert({ ext, bytes, signal }) {
      calls.push({ ext, text: bytes.toString("latin1").slice(0, 40), signal });
      if (hold) await Promise.race([gate, new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(Error("parado"), { code: "ABORTED" })), { once: true }))]);
      return { pdf: await makePdf({ pages: ["Convertido " + ext, "Segunda"] }), missingFonts };
    },
  };
}

test("conversions are cached by content, shared while running, and a newer version cancels the older", async (t) => {
  const dir = await tmp(t);
  const engine = fakeEngine({ hold: true });
  const office = createOfficeConverter({ cacheDir: path.join(dir, "cache"), engines: [engine], fonts: false });
  const v1 = makeDocx(["Primera versión"]);
  // Two previews of the same file at once: one conversion.
  const a = office.convert(v1, "docx", { source: "m1/informe.docx" });
  const b = office.convert(v1, "docx", { source: "m1/informe.docx" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(engine.calls.length, 1, "deduped");
  engine.release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(ra.cached, false);
  assert.ok(ra.pdf.equals(rb.pdf));
  assert.equal(ra.engine, "Conversor de prueba");
  // Opened again: from the cache, no conversion.
  const again = await office.convert(v1, "docx", { source: "m1/informe.docx" });
  assert.equal(again.cached, true);
  assert.equal(engine.calls.length, 1);
  assert.equal((await readdir(path.join(dir, "cache"))).filter((n) => n.endsWith(".pdf")).length, 1);

  // The file changes while its conversion runs: the old one stops, the new one is done.
  const slow = fakeEngine({ name: "slow", hold: true });
  const office2 = createOfficeConverter({ cacheDir: path.join(dir, "cache2"), engines: [slow], fonts: false });
  const old = office2.convert(makeDocx(["v1"]), "docx", { source: "m1/a.docx" });
  await new Promise((r) => setTimeout(r, 30));
  const fresh = office2.convert(makeDocx(["v2 más larga"]), "docx", { source: "m1/a.docx" });
  await assert.rejects(old, (e) => e.code === "ABORTED");
  assert.equal(slow.calls[0].signal.aborted, true, "the engine was told to stop");
  slow.release();
  assert.equal((await fresh).cached, false);
  assert.equal(office2.pending(), 0);
});

test("a caller that leaves cancels a conversion nobody else waits for; a deadline stops a stuck one", async (t) => {
  const dir = await tmp(t);
  const engine = fakeEngine({ hold: true });
  const office = createOfficeConverter({ cacheDir: path.join(dir, "c"), engines: [engine], fonts: false });
  const leave = new AbortController();
  const p = office.convert(makeDocx(["x"]), "docx", { signal: leave.signal });
  await new Promise((r) => setTimeout(r, 20));
  leave.abort();
  await assert.rejects(p, (e) => e.code === "ABORTED");
  assert.equal(engine.calls[0].signal.aborted, true);

  // An engine that never answers (and ignores the signal).
  const stuck = { name: "stuck", available: async () => true, convert: () => new Promise(() => {}) };
  const timed = createOfficeConverter({ cacheDir: path.join(dir, "d"), engines: [stuck], fonts: false, limits: { timeoutMs: 80 } });
  await assert.rejects(timed.convert(makeDocx(["y"]), "docx"), (e) => e.code === "TIMEOUT");
  // The queue goes on after it.
  const ok = createOfficeConverter({ cacheDir: path.join(dir, "e"), engines: [fakeEngine()], fonts: false });
  assert.equal((await ok.convert(makeDocx(["z"]), "docx")).cached, false);
});

test("without Office or LibreOffice there is no converter; an engine only takes its formats", async (t) => {
  const dir = await tmp(t);
  const none = createOfficeConverter({ cacheDir: path.join(dir, "a"), engines: [{ name: "x", available: async () => false, convert: async () => { throw Error("no"); } }], fonts: false });
  assert.equal(await none.engine("docx"), null);
  await assert.rejects(none.convert(makeDocx(["a"]), "docx"), (e) => e.code === "NO_CONVERTER");
  await assert.rejects(none.convert(Buffer.from("a"), "txt"), (e) => e.code === "UNSUPPORTED");
  const wordOnly = fakeEngine({ name: "word", formats: ["docx", "doc"] });
  const excel = fakeEngine({ name: "excel", formats: ["xlsx"] });
  const both = createOfficeConverter({ cacheDir: path.join(dir, "b"), engines: [wordOnly, excel], fonts: false });
  assert.equal((await both.engine("xlsx")).name, "excel");
  assert.equal(await both.engine("pptx"), null);
  const big = createOfficeConverter({ cacheDir: path.join(dir, "c"), engines: [fakeEngine()], fonts: false, limits: { inputBytes: 10 } });
  await assert.rejects(big.convert(makeDocx(["grande"]), "docx"), (e) => e.code === "TOO_BIG");
});

test("fonts the document asks for and this computer lacks are reported", async (t) => {
  const dir = await tmp(t);
  const fontTable = '<w:fonts xmlns:w="w"><w:font w:name="Calibri"/><w:font w:name="Fuente Rara Pro"/></w:fonts>';
  const doc = '<w:document xmlns:w="w"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond Antigua"/></w:rPr><w:t>Hola</w:t></w:r></w:p></w:body></w:document>';
  const theme = '<a:theme xmlns:a="a"><a:latin typeface="+mj-lt"/><a:latin typeface="Aptos"/></a:theme>';
  const docx = makeZip([["word/document.xml", doc], ["word/fontTable.xml", fontTable], ["word/theme/theme1.xml", theme]]);
  assert.deepEqual(documentFonts(docx, "docx"), ["Aptos", "Calibri", "Fuente Rara Pro", "Garamond Antigua"]);
  const installed = new Set(["calibri", "aptos", "garamond antigua"]);
  assert.deepEqual(missingFrom(documentFonts(docx, "docx"), installed), ["Fuente Rara Pro"]);
  assert.deepEqual(missingFrom(["Calibri Bold"], new Set(["calibri"])), [], "a style of an installed family is there");
  assert.deepEqual(missingFrom(["X"], null), [], "unknown installed list: nothing reported");
  const office = createOfficeConverter({ cacheDir: path.join(dir, "c"), engines: [fakeEngine({ missingFonts: ["De Motor"] })], fonts: async () => installed });
  const out = await office.convert(docx, "docx");
  assert.deepEqual(out.missingFonts.sort(), ["De Motor", "Fuente Rara Pro"]);
  assert.deepEqual((await office.convert(docx, "docx")).missingFonts.sort(), ["De Motor", "Fuente Rara Pro"], "kept with the cached PDF");
});

test("LibreOffice is found in PATH or where it installs", async (t) => {
  const dir = await tmp(t);
  const bin = path.join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const exe = process.platform === "win32" ? "soffice.exe" : "soffice";
  await writeFile(path.join(bin, exe), "");
  assert.equal(findSoffice({ PATH: bin }, process.platform), path.join(bin, exe));
  assert.equal(findSoffice({ COLMENA_SOFFICE: path.join(bin, exe), PATH: "" }, process.platform), path.join(bin, exe));
  const programs = path.join(dir, "Programas");
  await mkdir(path.join(programs, "LibreOffice", "program"), { recursive: true });
  await writeFile(path.join(programs, "LibreOffice", "program", "soffice.exe"), "");
  assert.equal(findSoffice({ PATH: "", ProgramFiles: programs }, "win32"), path.join(programs, "LibreOffice", "program", "soffice.exe"));
  assert.equal(findSoffice({ PATH: path.join(dir, "nada") }, "linux") === null || findSoffice({ PATH: path.join(dir, "nada") }, "linux").startsWith("/"), true);
});

// ------------------------------------------------------------------ the preview routes

async function serve(t, office) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-officepdf-"));
  const store = new Store(path.join(directory, "data"));
  const rootOf = (id) => path.join(store.directory, "workspaces", id);
  const app = express();
  const check = (schema, value) => schema.parse(value);
  const mustGet = (kind, id) => store.get(kind, id) || (() => { throw Object.assign(Error("No existe."), { status: 404 }); })();
  if (typeof office === "function") office = office(path.join(directory, "cache"));
  registerWorkFileRoutes(app, { store, rootOf, check, z, mustGet, office });
  registerDragRoutes(app, { store, rootOf, check, z });
  app.use((err, _req, res, _next) => res.status(Number.isInteger(err?.status) ? err.status : err?.name === "ZodError" ? 400 : 422).json({ error: err.message }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // Closed before the folder goes (the database keeps its file open).
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  store.put("missions", { id: "m1", title: "Informe" });
  await mkdir(rootOf("m1"), { recursive: true });
  const base = "http://127.0.0.1:" + server.address().port;
  const get = async (route) => { const r = await fetch(base + "/api" + route); return { status: r.status, type: r.headers.get("content-type"), body: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
  return { store, root: rootOf("m1"), get, directory };
}

test("a PDF of the folder is drawn page by page; an Office file once converted; without a converter its text and a note", async (t) => {
  const engine = fakeEngine();
  const { root, get } = await serve(t, (cacheDir) => createOfficeConverter({ cacheDir, engines: [engine], fonts: false }));
  await writeFile(path.join(root, "factura.pdf"), await makePdf());
  await writeFile(path.join(root, "informe.docx"), makeDocx(["Ventas del trimestre"]));
  const pdf = await get("/missions/m1/workfiles/file?path=factura.pdf");
  assert.equal(pdf.body.visual, "pdf");
  assert.match(pdf.body.preview, /Factura 2026-17/, "the text stays for search and as a fallback");
  const pv = await get("/missions/m1/workfiles/visual?path=factura.pdf");
  assert.deepEqual([pv.body.available, pv.body.pages], [true, 2]);
  assert.match(pv.body.version, /^[0-9a-f]{16}$/);
  const page = await get("/missions/m1/workfiles/page/1?path=factura.pdf&width=400");
  if (page.status === 200) assert.deepEqual([...page.body.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  else assert.equal(page.status, 501, "without a canvas the page degrades");

  const doc = await get("/missions/m1/workfiles/file?path=informe.docx");
  assert.equal(doc.body.visual, "office");
  assert.match(doc.body.preview, /Ventas del trimestre/);
  const dv = await get("/missions/m1/workfiles/visual?path=informe.docx");
  assert.equal(dv.body.available, true);
  assert.equal(dv.body.pages, 2);
  assert.equal(dv.body.engine, "Conversor de prueba");
  assert.equal(engine.calls.length, 1);
  await get("/missions/m1/workfiles/page/2?path=informe.docx&width=320");
  assert.equal(engine.calls.length, 1, "pages come from the cached PDF");
  // The file changes: a new version, converted again.
  await writeFile(path.join(root, "informe.docx"), makeDocx(["Ventas del trimestre, revisadas"]));
  const dv2 = await get("/missions/m1/workfiles/visual?path=informe.docx");
  assert.notEqual(dv2.body.version, dv.body.version);
  assert.equal(engine.calls.length, 2);
  assert.equal((await get("/missions/m1/workfiles/visual?path=../fuera.docx")).status, 404);
  assert.equal((await get("/missions/m1/workfiles/page/0?path=factura.pdf")).status, 400);
});

test("no Office and no LibreOffice: the text preview with a Spanish note", async (t) => {
  const none = (cacheDir) => createOfficeConverter({ cacheDir, engines: [{ name: "x", available: async () => false, convert: async () => null }], fonts: false });
  const { root, get } = await serve(t, none);
  await writeFile(path.join(root, "informe.docx"), makeDocx(["Solo texto"]));
  const file = await get("/missions/m1/workfiles/file?path=informe.docx");
  assert.match(file.body.preview, /Solo texto/);
  const v = await get("/missions/m1/workfiles/visual?path=informe.docx");
  assert.deepEqual([v.body.available, v.body.reason, v.body.note], [false, "NO_CONVERTER", NO_CONVERTER_NOTE]);
  assert.equal((await get("/missions/m1/workfiles/page/1?path=informe.docx")).status, 501);
});

test("dragging out: only files of the working folders resolve to a path on disk", async (t) => {
  const { store, root, get } = await serve(t, null);
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "carta.docx"), makeDocx(["Hola"]));
  store.put("artifacts", { id: "a1", missionId: "m1", title: "Carta", format: "docx", file: "docs/carta.docx" });
  store.put("artifacts", { id: "a2", missionId: "m1", title: "Fuera", format: "png", file: "../../colmena.sqlite" });
  assert.deepEqual(fileOfUrl(store, "/api/missions/m1/workfiles/raw?path=docs%2Fcarta.docx&download=1"), { missionId: "m1", rel: "docs/carta.docx" });
  assert.deepEqual(fileOfUrl(store, "http://127.0.0.1:5000/api/artifacts/a1/file"), { missionId: "m1", rel: "docs/carta.docx" });
  assert.equal(fileOfUrl(store, "https://evil.example/api/artifacts/a1/file"), null);
  assert.equal(fileOfUrl(store, "/api/state"), null);
  const ok = await get("/files/locate?url=" + encodeURIComponent("/api/missions/m1/workfiles/raw?path=docs%2Fcarta.docx"));
  assert.equal(ok.status, 200);
  assert.equal(path.basename(ok.body.path), "carta.docx");
  assert.ok(ok.body.roots.some((r) => ok.body.path.startsWith(r)));
  assert.deepEqual(dragRoots(store), [path.join(store.directory, "workspaces")]);
  assert.equal((await get("/files/locate?url=" + encodeURIComponent("/api/artifacts/a1/file"))).body.name, "carta.docx");
  assert.equal((await get("/files/locate?url=" + encodeURIComponent("/api/artifacts/a2/file"))).status, 404);
  assert.equal((await get("/files/locate?url=" + encodeURIComponent("/api/missions/m1/workfiles/raw?path=..%2F..%2Fcolmena.sqlite"))).status, 404);
  assert.equal((await get("/files/locate?url=" + encodeURIComponent("/api/missions/m1/workfiles/raw?path=no-existe.txt"))).status, 404);
});
