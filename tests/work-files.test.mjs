import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { workFileName } from "../server/files.mjs";
import { isolatedPage } from "../src/lib/isolatePage.js";

test("a code deliverable becomes a real file of the mission, replaced by each new version", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const done = outputs(input);
    if (done.length === 0) return call("create_deliverable", { title: "facturacion_mensual.py", kind: "code", format: "py", content: "print('v1')" }, "d1");
    if (done.length === 1) { round++; return call("create_deliverable", { title: "facturacion_mensual.py", kind: "code", format: "py", content: "print('v2')" }, "d2"); }
    return answer("Listo.");
  });
  const m = runtime.create({ prompt: "Hazme el script", mode: "solo", botIds: ["bruno"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  const arts = store.list("artifacts").filter((a) => a.missionId === m.id);
  assert.deepEqual(arts.map((a) => a.workFile), ["facturacion_mensual.py", "facturacion_mensual.py"]);
  assert.equal(await readFile(path.join(runtime.root(m.id), "facturacion_mensual.py"), "utf8"), "print('v2')");
  assert.equal(round, 1);
});

test("work file names come from the title", () => {
  assert.equal(workFileName("Script Python — facturación mensual desde CSV", "py"), "facturacion-mensual-csv.py");
  assert.equal(workFileName("Página de contacto — HTML único", "html"), "contacto.html");
  assert.equal(workFileName("facturacion_mensual.py — exportación a Excel", "py"), "facturacion_mensual.py");
});

test("a page in «Vista previa» runs with no network and no access to Colmena", () => {
  const out = isolatedPage("<!DOCTYPE html><html><head><title>x</title></head><body><script>fetch('/api/state')</script></body></html>");
  assert.match(out, /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  assert.match(isolatedPage("<p>hola</p>"), /^<meta http-equiv="Content-Security-Policy"/);
});
