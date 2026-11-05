import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { Store } from "../server/store.mjs";
import { Checkpoints, cpIdOf, gitAvailable } from "../server/checkpoints.mjs";
import { createOfficeConverter } from "../server/officepdf.mjs";
import { registerTurnChangeRoutes, changeKind } from "../server/turn-changes.mjs";
import { diffText, splitLines } from "../server/linediff.mjs";
import { parsePatch, sideBySide } from "../src/components/v2/code/model.js";
import { deltaLabel, fileOfLink, withFileLinks } from "../src/lib/turnFiles.js";
import { makeDocx, makePdf, makePng } from "./fixtures/core-files.mjs";

const HAS_GIT = await gitAvailable();
const BACKENDS = [["copia", false], ...(HAS_GIT ? [["git", true]] : [])];

test("the line diff is a unified patch Código's parser reads", () => {
  const a = Array.from({ length: 30 }, (_, i) => "línea " + (i + 1)).join("\n") + "\n";
  const b = a.replace("línea 3\n", "línea tres\n").replace("línea 20\n", "").replace("línea 28\n", "línea 28\nnueva\n");
  const d = diffText(a, b);
  assert.deepEqual([d.added, d.removed, d.same], [2, 2, false]);
  assert.equal((d.patch.match(/^@@ /gm) || []).length, 3, "far changes get their own hunks");
  assert.match(d.patch, /^@@ -1,6 \+1,6 @@\n línea 1\n línea 2\n-línea 3\n\+línea tres\n/);
  const rows = parsePatch(d.patch);
  assert.deepEqual(rows.filter((r) => r.type === "add").map((r) => [r.b, r.text]), [[3, "línea tres"], [28, "nueva"]]);
  assert.deepEqual(rows.filter((r) => r.type === "del").map((r) => [r.a, r.text]), [[3, "línea 3"], [20, "línea 20"]]);
  assert.ok(sideBySide(rows).some((p) => p.left?.text === "línea 3" && p.right?.text === "línea tres"));
  assert.deepEqual(diffText("", "hola\nmundo\n"), { patch: "@@ -0,0 +1,2 @@\n+hola\n+mundo\n", added: 2, removed: 0, same: false, truncated: false });
  assert.equal(diffText("a\r\nb\r\n", "a\nb\n").same, true, "line endings alone are no change");
  assert.deepEqual(splitLines("x\ny"), ["x", "y"]);
  // Too different: still correct, everything replaced.
  const big = diffText(Array.from({ length: 3000 }, (_, i) => "a" + i).join("\n"), Array.from({ length: 3000 }, (_, i) => "b" + i).join("\n"), { maxEdits: 50 });
  assert.deepEqual([big.added, big.removed], [3000, 3000]);
  assert.equal(changeKind("x/informe.docx"), "document");
  assert.equal(changeKind("foto.PNG"), "image");
  assert.equal(changeKind("viejo.xls"), "office");
  assert.equal(changeKind("notas.md"), "text");
  assert.equal(changeKind("datos.bin"), "binary");
});

test("file names in the bot's closing text become links; code, links and longer words stay", () => {
  const files = [{ path: "informe.docx", name: "informe.docx" }, { path: "datos/regiones.csv", name: "regiones.csv" }, { path: "a/notas.md", name: "notas.md" }, { path: "b/notas.md", name: "notas.md" }];
  const md = "He puesto al día informe.docx y datos/regiones.csv (también regiones.csv). Mira `informe.docx`, [el informe](https://x.es/informe.docx) y viejo-informe.docx o informe.docx.bak; notas.md es ambiguo.";
  const out = withFileLinks(md, files);
  assert.match(out, /al día \[informe\.docx\]\(#file:informe\.docx\) y \[datos\/regiones\.csv\]\(#file:datos%2Fregiones\.csv\)/);
  assert.match(out, /\(también \[regiones\.csv\]\(#file:datos%2Fregiones\.csv\)\)/);
  assert.match(out, /Mira `informe\.docx`, \[el informe\]\(https:\/\/x\.es\/informe\.docx\) y viejo-informe\.docx o informe\.docx\.bak; notas\.md es ambiguo\./);
  assert.equal(withFileLinks("Sin archivos.", []), "Sin archivos.");
  assert.equal(fileOfLink(files, "#file:datos%2Fregiones.csv").path, "datos/regiones.csv");
  assert.equal(fileOfLink(files, "informe.docx").path, "informe.docx");
  assert.equal(fileOfLink(files, "notas.md"), null, "two files share that name");
  assert.deepEqual(deltaLabel({ change: "edited", added: 3, removed: 1 }).text, "+3 −1");
  assert.equal(deltaLabel({ change: "edited", added: null, removed: null, before: 2048, after: 3072 }).text, "2 KB → 3 KB");
  assert.equal(deltaLabel({ change: "created", added: null, before: null, after: 10 }).text, "10 B");
});

async function setup(t, git) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-turnchanges-"));
  const store = new Store(path.join(dir, "data"));
  const points = new Checkpoints(store, { git });
  const root = path.join(dir, "data", "workspaces", "m1");
  await mkdir(root, { recursive: true });
  store.put("missions", { id: "m1", title: "Informe" });
  const engine = { name: "fake", label: "Conversor de prueba", calls: 0, available: async () => true, convert: async ({ bytes }) => { engine.calls++; return { pdf: await makePdf({ pages: ["Página de " + bytes.length + " bytes"] }) }; } };
  const app = express();
  const check = (schema, value) => schema.parse(value);
  const mustGet = (kind, id) => store.get(kind, id) || (() => { throw Object.assign(Error("No existe."), { status: 404 }); })();
  registerTurnChangeRoutes(app, { store, runtime: { checkpoints: points }, check, z, mustGet, office: createOfficeConverter({ cacheDir: path.join(dir, "cache"), engines: [engine], fonts: false }) });
  app.use((err, _req, res, _next) => res.status(Number.isInteger(err?.status) ? err.status : err?.name === "ZodError" ? 400 : 422).json({ error: err.message }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5 }); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/missions/m1/checkpoints/";
  const get = async (route) => { const r = await fetch(base + route); return { status: r.status, type: r.headers.get("content-type"), body: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
  let n = 0;
  const turn = async (change) => {
    const step = { id: "s" + ++n, botId: "bruno" };
    await points.before({ mission: { id: "m1" }, step, botId: "bruno", tool: "write_file", args: {} });
    await change();
    await points.finish("m1");
    return cpIdOf(step.id);
  };
  const put = (rel, content) => mkdir(path.dirname(path.join(root, rel)), { recursive: true }).then(() => writeFile(path.join(root, rel), content));
  return { root, get, turn, put, engine };
}

for (const [name, git] of BACKENDS) {
  test(`${name}: a turn's changed files with their deltas, and each one's before/after`, async (t) => {
    const { root, get, turn, put, engine } = await setup(t, git);
    await put("notas.md", "# Notas\nuno\ndos\ntres\n");
    await put("informe.docx", makeDocx(["Ventas: 10", "Gastos: 5"]));
    await put("logo.png", makePng(2, 2));
    await put("viejo.txt", "adiós\n");
    await put("igual.txt", "no se toca\n");
    const cp = await turn(async () => {
      await put("notas.md", "# Notas\nuno\nDOS\ntres\ncuatro\n");
      await put("informe.docx", makeDocx(["Ventas: 12", "Gastos: 5", "Beneficio: 7"]));
      await put("logo.png", makePng(4, 4));
      await put("nuevo/plan.txt", "a\nb\n");
      await rm(path.join(root, "viejo.txt"));
    });
    // Later changes do not move what this turn did.
    await writeFile(path.join(root, "notas.md"), "otra cosa\n");

    const { status, body } = await get(cp + "/changes");
    assert.equal(status, 200);
    const by = Object.fromEntries(body.files.map((f) => [f.path, f]));
    assert.deepEqual(Object.keys(by).sort(), ["informe.docx", "logo.png", "notas.md", "nuevo/plan.txt", "viejo.txt"]);
    assert.deepEqual([by["notas.md"].change, by["notas.md"].added, by["notas.md"].removed, by["notas.md"].openable], ["edited", 2, 1, true]);
    assert.deepEqual([by["nuevo/plan.txt"].change, by["nuevo/plan.txt"].added, by["nuevo/plan.txt"].removed, by["nuevo/plan.txt"].name], ["created", 2, 0, "plan.txt"]);
    assert.deepEqual([by["viejo.txt"].change, by["viejo.txt"].removed, by["viejo.txt"].after, by["viejo.txt"].openable], ["deleted", 1, null, false]);
    assert.deepEqual([by["informe.docx"].kind, by["informe.docx"].added, by["informe.docx"].removed], ["document", 2, 1], "Word compares by its text");
    assert.equal(by["logo.png"].added, null, "an image only has sizes");
    assert.ok(by["logo.png"].after > by["logo.png"].before);
    assert.equal(body.botId, "bruno");

    // Text: the patch of what the turn did (not of the file as it is now).
    const text = await get(cp + "/diff?path=notas.md&scope=" + encodeURIComponent(by["notas.md"].scope));
    assert.equal(text.body.mode, "text");
    assert.match(text.body.patch, /-dos\n\+DOS\n tres\n\+cuatro\n/);
    assert.doesNotMatch(text.body.patch, /otra cosa/);
    const doc = await get(cp + "/diff?path=informe.docx");
    assert.equal(doc.body.mode, "document");
    assert.match(doc.body.patch, /-Ventas: 10\n\+Ventas: 12\n/);
    assert.equal(doc.body.visual, true);
    const created = await get(cp + "/diff?path=nuevo%2Fplan.txt");
    assert.deepEqual([created.body.before, created.body.after.size], [null, 4]);
    const gone = await get(cp + "/diff?path=viejo.txt");
    assert.match(gone.body.patch, /^@@ -1,1 \+0,0 @@\n-adiós\n$/);

    // An image: both sides, side by side.
    const img = await get(cp + "/diff?path=logo.png");
    assert.equal(img.body.mode, "visual");
    const before = await get(cp + "/blob?path=logo.png&side=before");
    const after = await get(cp + "/blob?path=logo.png&side=after");
    assert.equal(before.type, "image/png");
    assert.ok(before.body.equals(makePng(2, 2)));
    assert.ok(after.body.equals(makePng(4, 4)));
    assert.equal((await get(cp + "/blob?path=notas.md&side=before")).status, 400);
    assert.equal((await get(cp + "/blob?path=nuevo%2Fplan.txt&side=before")).status, 400);

    // The pages of a Word file before and after (through the converter).
    const vb = await get(cp + "/visual?path=informe.docx&side=before");
    const va = await get(cp + "/visual?path=informe.docx&side=after");
    assert.deepEqual([vb.body.available, vb.body.pages], [true, 1]);
    assert.notEqual(vb.body.version, va.body.version);
    assert.equal(engine.calls, 2);
    const page = await get(cp + "/page/1?path=informe.docx&side=after&width=300");
    assert.ok(page.status === 200 || page.status === 501);
    assert.equal((await get(cp + "/visual?path=nuevo%2Fplan.txt&side=before")).status, 404, "nothing before it was created");

    // Not part of the turn, or not a turn at all.
    assert.equal((await get(cp + "/diff?path=igual.txt")).status, 404);
    assert.equal((await get("cp-nada/changes")).status, 404);
    assert.equal((await get(cp + "/diff")).status, 400);
  });
}
