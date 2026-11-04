import test from "node:test";
import assert from "node:assert/strict";
import { citationMap, citedUrls, collectSources, normUrl } from "../src/lib/citations.js";

const tools = [
  { status: "done", card: { type: "websearch", sources: [{ url: "https://www.boe.es/verifactu?utm_source=openai", title: "Verifactu en el BOE", snippet: "El sistema obliga a…" }, { url: "https://otra.es/x", title: "Otra" }] } },
  { status: "done", card: { type: "web", url: "https://sede.agenciatributaria.gob.es/faq", title: "Preguntas frecuentes", excerpt: "<<<CONTENIDO EXTERNO>>>\nDesde 2026 …\n<<<FIN>>>" } },
  { status: "done", card: { type: "file", name: "oferta.pdf", path: "contratos/oferta.pdf", pages: 14, page: 1 } },
  { status: "done", card: { type: "file", name: "oferta.pdf", path: "contratos/oferta.pdf", pages: 14, page: 2 } },
  { status: "error", card: { type: "web", url: "https://falló.es" } },
];

test("web sources are the pages the answer links to and the bot really read or searched", () => {
  const text = "Según [el BOE](https://www.boe.es/verifactu) y [la AEAT](https://sede.agenciatributaria.gob.es/faq), y [un blog](https://nunca-leido.es).";
  assert.deepEqual(citedUrls(text).length, 3);
  const s = collectSources({ text, tools });
  assert.deepEqual(s.map((x) => x.kind + ":" + x.title), ["web:Verifactu en el BOE", "web:Preguntas frecuentes", "file:oferta.pdf"]);
  assert.equal(s[1].excerpt, "Desde 2026 …", "the excerpt without the external-content frame");
  assert.equal(s[2].meta, "14 páginas · contratos/oferta.pdf", "a document once, however many pages it read");
  const map = citationMap(s);
  assert.equal(map.get(normUrl("https://www.boe.es/verifactu?utm_source=openai")).site, "boe.es", "tracking parameters do not matter");
  assert.equal(map.has(normUrl("https://nunca-leido.es")), false, "a link it never read is not a source");
});

test("a mail notice's sources are its mails", () => {
  const s = collectSources({ text: "Oriol pide el presupuesto.", mails: [{ id: "m1", hilo: "t1", fuente: "Correo", de: "Oriol", asunto: "Presupuesto feria", fecha: "2026-11-03T09:00:00Z", cuenta: "trabajo", url: "https://mail.google.com/mail/#all/t1" }, { id: "m2", hilo: "t1", asunto: "Re: Presupuesto feria" }] });
  assert.equal(s.length, 1, "one chip per thread");
  assert.deepEqual([s[0].kind, s[0].title, s[0].meta], ["mail", "Presupuesto feria", "Oriol · 2026-11-03 · trabajo"]);
});
