import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isLocatable, dragOutProps, workFileUrl } from "../src/lib/dragOut.js";

const require = createRequire(import.meta.url);
const { allowedFile } = require("../desktop/dragout.cjs");

test("the desktop shell only drags real files of the working folders", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-drag-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = path.join(dir, "Colmena");
  const work = path.join(data, "workspaces", "m1");
  const shared = path.join(dir, "Compartida");
  await mkdir(work, { recursive: true });
  await mkdir(shared, { recursive: true });
  await writeFile(path.join(work, "informe.docx"), "x");
  await writeFile(path.join(data, "colmena.sqlite"), "db");
  await writeFile(path.join(shared, "plan.xlsx"), "y");
  await writeFile(path.join(dir, "fuera.txt"), "z");
  assert.ok(allowedFile(path.join(work, "informe.docx"), { dataDir: data }));
  assert.equal(allowedFile(path.join(data, "colmena.sqlite"), { dataDir: data }), null, "Colmena's own data never");
  assert.equal(allowedFile(path.join(data, "colmena.sqlite"), { dataDir: data, extra: [data] }), null, "not even through a shared folder");
  assert.equal(allowedFile(path.join(shared, "plan.xlsx"), { dataDir: data }), null);
  assert.ok(allowedFile(path.join(shared, "plan.xlsx"), { dataDir: data, extra: [shared] }), "a shared folder the service lists");
  assert.equal(allowedFile(path.join(dir, "fuera.txt"), { dataDir: data, extra: [shared] }), null);
  assert.equal(allowedFile(path.join(work, "..", "..", "colmena.sqlite"), { dataDir: data }), null);
  assert.equal(allowedFile(path.join(work, "no-existe.txt"), { dataDir: data }), null);
  assert.equal(allowedFile(work, { dataDir: data }), null, "a folder is not a file");
  assert.equal(allowedFile("informe.docx", { dataDir: data }), null, "relative paths never");
  // A hard link to something outside, or a symbolic link, is not dragged.
  try {
    await link(path.join(dir, "fuera.txt"), path.join(work, "enlace.txt"));
    assert.equal(allowedFile(path.join(work, "enlace.txt"), { dataDir: data }), null);
  } catch {}
  try {
    await symlink(path.join(dir, "fuera.txt"), path.join(work, "simbolico.txt"));
    assert.equal(allowedFile(path.join(work, "simbolico.txt"), { dataDir: data }), null);
  } catch {}
});

test("the page marks only file links as draggable, and nothing outside the desktop app", () => {
  assert.equal(isLocatable("/api/missions/m1/workfiles/raw?path=a.docx"), true);
  assert.equal(isLocatable("http://127.0.0.1:4000/api/artifacts/a1/file?download=1"), true);
  assert.equal(isLocatable("/api/artifacts/a1/pdf"), true);
  assert.equal(isLocatable("/api/artifacts/a1/thumbs/1"), false);
  assert.equal(isLocatable("data:image/png;base64,AAAA"), false);
  assert.equal(workFileUrl("m 1", "docs/a b.txt"), "/api/missions/m%201/workfiles/raw?path=docs%2Fa%20b.txt");
  assert.deepEqual(dragOutProps("/api/artifacts/a1/file"), {}, "no desktop shell here");
});
