import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Store } from "../server/store.mjs";
import { registerCoreRoutes, attachmentBodyParser } from "../server/core-routes.mjs";
import { makePdf, makePng } from "./fixtures/core-files.mjs";

async function serve(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-core-routes-"));
  const store = new Store(directory);
  const runtime = { root: (id) => path.join(directory, "workspaces", id), provider: { kind: "chatgpt", nativeSearchAvailable: () => true, generateImage: async () => ({}) } };
  const app = express();
  app.use(attachmentBodyParser);
  app.use(express.json({ limit: "1400kb" }));
  registerCoreRoutes(app, { store, runtime });
  app.use((err, _req, res, _next) => res.status(Number.isInteger(err?.status) ? err.status : err?.name === "ZodError" ? 400 : err?.type === "entity.too.large" ? 413 : 422).json({ error: err.message }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, runtime, base: "http://127.0.0.1:" + server.address().port };
}

test("artifact files are served with their type; meta, PDF page previews and downloads", async (t) => {
  const { store, runtime, base } = await serve(t);
  const png = makePng(5, 4);
  const pdf = await makePdf({ form: true });
  await mkdir(path.join(runtime.root("m1"), "imagenes"), { recursive: true });
  await mkdir(path.join(runtime.root("m1"), "formularios"), { recursive: true });
  await writeFile(path.join(runtime.root("m1"), "imagenes", "logo.png"), png);
  await writeFile(path.join(runtime.root("m1"), "formularios", "copia.pdf"), pdf);
  store.put("artifacts", { id: "a1", missionId: "m1", title: "Logo", kind: "design", format: "png", file: "imagenes/logo.png", mime: "image/png", width: 5, height: 4, prompt: "un logo", content: "Imagen" });
  store.put("artifacts", { id: "a2", missionId: "m1", title: "Solicitud rellena", kind: "document", format: "pdf", file: "formularios/copia.pdf", pages: 2, fields: [{ name: "nombre", value: "Ana" }], source: { name: "solicitud.pdf", path: "solicitud.pdf" }, content: "tabla" });
  store.put("artifacts", { id: "a3", missionId: "m1", title: "Escapa", kind: "design", format: "png", file: "../../colmena.sqlite" });

  const img = await fetch(base + "/api/artifacts/a1/file");
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.match(img.headers.get("content-security-policy"), /sandbox/);
  assert.match(img.headers.get("content-disposition"), /^inline; filename="Logo.png"/);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
  const dl = await fetch(base + "/api/artifacts/a2/file?download=1");
  assert.equal(dl.headers.get("content-type"), "application/pdf");
  assert.match(dl.headers.get("content-disposition"), /^attachment; filename="Solicitud rellena.pdf"/);
  assert.equal((await fetch(base + "/api/artifacts/a3/file")).status, 404, "paths outside the mission folder are refused");

  const meta = await (await fetch(base + "/api/artifacts/a2/meta")).json();
  assert.equal(meta.available, true);
  assert.deepEqual(meta.fields, [{ name: "nombre", value: "Ana" }]);
  assert.equal(meta.url, "/api/artifacts/a2/file");
  const page = await fetch(base + "/api/artifacts/a2/pages/1?width=400");
  if (page.status === 200) {
    assert.equal(page.headers.get("content-type"), "image/png");
    assert.equal(page.headers.get("x-pdf-pages"), "2");
    assert.deepEqual([...Buffer.from(await page.arrayBuffer()).subarray(1, 4)], [0x50, 0x4e, 0x47]);
  } else assert.equal(page.status, 501, "without a canvas the preview degrades with 501");
  assert.equal((await fetch(base + "/api/artifacts/a2/pages/9")).status, 404);
  assert.equal((await fetch(base + "/api/artifacts/a1/pages/1")).status, 400);
  const caps = await (await fetch(base + "/api/core/capabilities")).json();
  assert.deepEqual([caps.provider, caps.nativeSearch, caps.images], ["chatgpt", true, true]);
});

test("binary attachments in base64 (up to 10 MB) through the large-body parser", async (t) => {
  const { store, runtime, base } = await serve(t);
  store.put("missions", { id: "m2", title: "x", botIds: ["nora"], status: "completed" });
  const big = Buffer.alloc(3 * 1024 * 1024, 7);
  const res = await fetch(base + "/api/missions/m2/attachments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attachments: [{ name: "datos.bin", content: big.toString("base64"), encoding: "base64" }, { name: "nota.txt", content: "hola" }] }),
  });
  assert.equal(res.status, 201);
  const { files } = await res.json();
  assert.deepEqual(files.map((f) => [f.name, f.size]), [["datos.bin", big.length], ["nota.txt", 4]]);
  assert.deepEqual(await readFile(path.join(runtime.root("m2"), "datos.bin")), big);
  const bad = await fetch(base + "/api/missions/m2/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachments: [{ name: "x.pdf", content: "no*base64", encoding: "base64" }] }) });
  assert.equal(bad.status, 400);
  const other = await fetch(base + "/api/otra", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(2 * 1024 * 1024) }) });
  assert.equal(other.status, 413, "other routes keep the 1400 KB limit");
});
