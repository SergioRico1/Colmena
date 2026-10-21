import test from "node:test";
import assert from "node:assert/strict";
import { linkPreview, previewFromHtml } from "../server/web.mjs";

test("link preview: og tags first, <title> as fallback, entities decoded and cut", () => {
  const html = `<html><head><title>Fallback</title>
    <meta property="og:title" content="Precios &amp; planes">
    <meta name="description" content='Todo lo que incluye cada plan.'>
    <meta property="og:site_name" content="Ejemplo"></head><body>…</body></html>`;
  const p = previewFromHtml(html, "https://www.ejemplo.com/precios");
  assert.deepEqual(p, { url: "https://www.ejemplo.com/precios", host: "ejemplo.com", title: "Precios & planes", description: "Todo lo que incluye cada plan.", site: "Ejemplo" });
  const bare = previewFromHtml("<title> Solo   título </title>", "https://a.org/");
  assert.equal(bare.title, "Solo título");
  assert.equal(bare.site, "a.org");
  assert.ok(previewFromHtml(`<title>${"x".repeat(400)}</title>`, "https://a.org/").title.length <= 160);
});

test("link preview: never reaches local or private addresses", async () => {
  await assert.rejects(linkPreview("http://127.0.0.1:9/"), /no permitid|públic/i);
  await assert.rejects(linkPreview("http://intranet.example/", { resolve: async () => [{ address: "10.0.0.5", family: 4 }] }), /no permitida/);
  await assert.rejects(linkPreview("file:///C:/Windows/win.ini"));
});
