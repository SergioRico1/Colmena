import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { webFetch, isBlockedAddress, htmlToText, validateWebUrl } from "../server/web.mjs";
import { ensureWorkspace, readSoul, writeSoul, composeInstructions, lineDiff, proposedSoul, personalityHints } from "../server/soul.mjs";
import { Store } from "../server/store.mjs";

test("web_fetch blocks loopback, private, link-local and mapped addresses", async () => {
  for (const url of [
    "http://127.0.0.1:4318/api/state",
    "http://10.1.2.3/",
    "http://192.168.1.10/",
    "http://172.20.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[fe80::1]/",
    "http://0.0.0.0/",
    "http://localhost:4318/",
    "http://printer.local/",
  ])
    await assert.rejects(webFetch(url), /no permitida/, url);
  await assert.rejects(webFetch("file:///C:/Windows/win.ini"), /http o https/);
  await assert.rejects(webFetch("https://user:pass@example.com/"), /credenciales/);
  await assert.rejects(webFetch("not a url"), /no válida/);
});

test("web_fetch re-validates DNS: public names resolving to private IPs are refused, also at connect time", async () => {
  await assert.rejects(webFetch("http://intranet.example.com/", { resolve: async () => [{ address: "10.0.0.5", family: 4 }] }), /no permitida/);
  let calls = 0;
  const rebinding = async () => (calls++ === 0 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(webFetch("http://rebind.example.com/", { resolve: rebinding }), /no permitida/);
  assert.ok(calls >= 2);
});

test("address classification and html to text", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "100.64.1.1", "::1", "fd00::1", "::ffff:192.168.0.1", "64:ff9b::7f00:1"]) assert.ok(isBlockedAddress(ip), ip);
  for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) assert.ok(!isBlockedAddress(ip), ip);
  assert.equal(validateWebUrl("https://example.com/a#b").href, "https://example.com/a");
  const { title, text } = htmlToText("<html><head><title>Hola &amp; adi&oacute;s</title><style>x{}</style></head><body><script>alert(1)</script><h1>Título</h1><p>Uno<br>Dos</p><ul><li>A</li><li>B</li></ul>&#8364;</body></html>");
  assert.equal(title, "Hola & adiós");
  assert.doesNotMatch(text, /alert|x\{\}/);
  assert.match(text, /Título\nUno\nDos/);
  assert.match(text, /• A\n• B/);
  assert.match(text, /€/);
});

test("SOUL workspace: template per bot, editable, proposals as diff", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-soul-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = store.get("bots", "iris");
  const folder = ensureWorkspace(bot, { store, directory });
  for (const f of ["SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"]) assert.ok(existsSync(path.join(folder, f)), f);
  const soul = readSoul("iris", { directory });
  assert.match(soul, /Iris, diseño en el equipo de Colmena/);
  assert.doesNotMatch(soul, /\{\{/);
  assert.match(readFileSync(path.join(folder, "IDENTITY.md"), "utf8"), /rombo/);
  writeSoul("iris", "# SOUL.md\n\nSoy Iris y me encantan los colores vivos.", { directory });
  assert.match(composeInstructions(store, bot, { directory }), /colores vivos/);
  assert.throws(() => writeSoul("iris", "x", { directory }), /entre 20/);
  assert.throws(() => writeSoul("../evil", "x".repeat(30), { directory }), /no válido/);
  const next = proposedSoul(readSoul("iris", { directory }), "Uso siempre ejemplos visuales.");
  assert.match(next, /## Lo que he aprendido de mí\n\n- Uso siempre ejemplos visuales\./);
  const diff = lineDiff("a\nb\nc", "a\nB\nc\nd");
  assert.deepEqual(diff.filter((d) => d.op !== " ").map((d) => d.op + d.line), ["-b", "+B", "+d"]);
  assert.deepEqual(personalityHints({ tono: 0, detalle: 100, riesgo: 50 }).map((h) => h.split(":")[0]), ["Tono formal", "Detallado", "Equilibrio entre prudencia e iniciativa."]);
  const original = readFileSync(new URL("../prompts/SOUL.md", import.meta.url), "utf8");
  assert.match(original, /# SOUL\.md - Who You Are/);
});
