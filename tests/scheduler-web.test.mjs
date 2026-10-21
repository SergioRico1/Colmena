import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Scheduler } from "../server/scheduler.mjs";
import { htmlToText } from "../server/web.mjs";
import {
  countPageDiff, describePageDiff, diffPage, findPrice, normalizeTrigger, pageLines, subtitle, webDelay, withoutRelativeTimes,
} from "../server/triggers.mjs";

test("page diff ignores relative times and groups number changes as updates", () => {
  const before = pageLines("Ofertas\nPublicado hace 2 días\nPortátil X · 499 €\nComentarios: 12\nPosted 3 hours ago\nAgotado");
  const after = pageLines("Ofertas\nPublicado hace 3 días\nPortátil X · 459 €\nComentarios: 14\nPosted 4 hours ago\nNuevo modelo Y");
  assert.equal(withoutRelativeTimes("Publicado hace 2 días"), withoutRelativeTimes("Publicado hace 5 días"));
  assert.equal(withoutRelativeTimes("visto hace un momento"), "visto <tiempo>");
  const diff = diffPage(before, after);
  assert.deepEqual(diff.added, ["Nuevo modelo Y"]);
  assert.deepEqual(diff.updated, ["Portátil X · 459 €", "Comentarios: 14"]);
  assert.deepEqual(diff.removed, ["Agotado"]);
  assert.equal(countPageDiff(diff), "4 líneas cambiadas (1 nueva, 2 actualizadas, 1 quitada)");
  assert.match(describePageDiff(diff), /^Nuevo:\n• Nuevo modelo Y\nActualizado:/);
  // Only relative times changed → no news at all.
  assert.equal(countPageDiff(diffPage(pageLines("A\nhace 2 h"), pageLines("A\nhace 3 h"))), "");
});

test("price detection and the web trigger sentence", () => {
  assert.equal(findPrice(["Envío gratis", "Precio: 1.299,00 €"]), 1299);
  assert.equal(findPrice(["Total €49.90"]), 49.9);
  assert.equal(findPrice(["Otro 10 €", "Cafetera Z 89,95 €"], "cafetera"), 89.95);
  assert.equal(findPrice(["Sin precios aquí, solo 3 opiniones"]), null);
  assert.equal(normalizeTrigger({ type: "web", config: { url: "https://www.example.com/p", condicion: "cambia" } }).sentence, "cambie la página de example.com");
  assert.equal(normalizeTrigger({ type: "web", config: { url: "tienda.es/cafetera", condicion: "precio_bajo", precio: "50" } }).sentence, "el precio en tienda.es baje de 50 €");
  assert.equal(normalizeTrigger({ type: "web", config: { url: "example.com", condicion: "contiene", texto: "Disponible" } }).sentence, "la página de example.com contenga «Disponible»");
  assert.throws(() => normalizeTrigger({ type: "web", config: { url: "http://127.0.0.1/admin" } }), /públicas/);
  assert.throws(() => normalizeTrigger({ type: "web", config: { url: "example.com", condicion: "precio_bajo" } }), /precio límite/);
  assert.equal(webDelay({ frecuencia: "15m" }, 0), 15 * 60000);
  assert.equal(webDelay({ frecuencia: "15m" }, 3), 120 * 60000);
});

async function fixture(t, fetchPage) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-web-"));
  const store = new Store(directory);
  const created = [];
  const runtime = {
    create(input) {
      created.push(input);
      return store.put("missions", { id: "m" + created.length, title: input.title, prompt: input.prompt, mode: input.mode, botIds: input.botIds, automationId: input.automationId, status: "queued", createdAt: new Date().toISOString() });
    },
    launch() {},
  };
  const scheduler = new Scheduler(store, runtime, () => true, { fetchPage });
  t.after(async () => {
    scheduler.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, scheduler, created };
}

test("web trigger against a local test server (injected reader): baseline, change, price drop, backoff and pause", async (t) => {
  // A local HTTP server is only reachable here because the test injects its own reader;
  // the production reader (webFetch) refuses loopback addresses.
  let html = "<html><head><title>Cafetera Z</title></head><body><h1>Cafetera Z</h1><p>Precio: 59,90 €</p><p>Actualizado hace 2 horas</p></body></html>";
  let fail = false;
  const server = http.createServer((_req, res) => {
    if (fail) {
      res.writeHead(503);
      return res.end("caído");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const local = "http://127.0.0.1:" + server.address().port + "/cafetera";
  const fetchPage = async () => {
    const response = await fetch(local);
    if (!response.ok) throw Error("La página respondió con el estado " + response.status + ".");
    const body = await response.text();
    return { finalUrl: local, ...htmlToText(body) };
  };
  const { store, scheduler, created } = await fixture(t, fetchPage);
  const trigger = { type: "web", config: { url: "https://tienda.es/cafetera", condicion: "precio_bajo", texto: "", precio: "50", frecuencia: "15m" }, sentence: "el precio en tienda.es baje de 50 €" };
  const changes = { type: "web", config: { ...trigger.config, condicion: "cambia" }, sentence: "cambie la página de tienda.es" };
  store.put("automations", { id: "r1", name: "Vigilar precio", botId: "nora", prompt: "Avísame con el enlace", enabled: true, trigger, notify: "resultado", state: "scheduled", queue: [], createdAt: new Date().toISOString() });
  store.put("automations", { id: "r2", name: "Vigilar cambios", botId: "nora", prompt: "Resume el cambio", enabled: true, trigger: changes, notify: "resultado", state: "scheduled", queue: [], createdAt: new Date().toISOString() });

  // First check: only records the page (fingerprint saved in the record).
  assert.equal(await scheduler.engine.checkWeb(store.get("automations", "r1")), null);
  assert.equal(await scheduler.engine.checkWeb(store.get("automations", "r2")), null);
  assert.match(store.get("automations", "r1").webHash, /^[a-f0-9]{64}$/);
  assert.equal(store.get("automations", "r1").webPrice, 59.9);
  assert.equal(store.get("automations", "r2").webTitle, "Cafetera Z");

  // Only the relative time changes → nothing happens.
  html = html.replace("hace 2 horas", "hace 3 horas");
  assert.equal(await scheduler.engine.checkWeb(store.get("automations", "r2")), null);

  // The price drops below 50 € → both rules fire, with the summary of the change in the prompt.
  html = html.replace("59,90 €", "45,00 €");
  const drop = await scheduler.engine.checkWeb(store.get("automations", "r1"));
  assert.match(drop.summary, /ha bajado a 45 €/);
  const change = await scheduler.engine.checkWeb(store.get("automations", "r2"));
  assert.match(change.summary, /1 línea cambiada \(1 actualizada\)/);
  await new Promise((r) => setImmediate(r));
  scheduler.tick();
  assert.equal(created.length, 2);
  const prompts = created.map((c) => c.prompt).join("\n");
  assert.match(prompts, /Precio: 45,00 €/);
  assert.match(prompts, /"precio":45/);
  // Still below the limit next time → no repeated alert.
  assert.equal(await scheduler.engine.checkWeb(store.get("automations", "r1")), null);

  // Failures back off exponentially and pause the rule after 5, with the reason visible.
  fail = true;
  for (let i = 1; i <= 4; i++) {
    await scheduler.engine.checkWeb(store.get("automations", "r2"));
    assert.equal(store.get("automations", "r2").webFailures, i);
    assert.equal(store.get("automations", "r2").enabled, true);
  }
  assert.equal(webDelay(changes.config, 4), 16 * 15 * 60000);
  await scheduler.engine.checkWeb(store.get("automations", "r2"));
  const paused = store.get("automations", "r2");
  assert.equal(paused.enabled, false);
  assert.equal(paused.state, "paused");
  assert.match(paused.error, /^Pausada tras 5 fallos seguidos al leer tienda\.es: La página respondió con el estado 503\./);
  assert.match(subtitle(paused), /^Cuando cambia una página · Pausada$/);
});

test("pollDue respects frequency and backoff before checking again", async (t) => {
  let reads = 0;
  const { store, scheduler } = await fixture(t, async () => {
    reads++;
    return { title: "P", text: "Hola" };
  });
  const recent = new Date(Date.now() - 5 * 60000).toISOString();
  store.put("automations", { id: "r1", name: "W", botId: "nora", prompt: "x", enabled: true, trigger: { type: "web", config: { url: "https://example.com", condicion: "cambia", texto: "", precio: "", frecuencia: "15m" } }, lastPollAt: recent, queue: [], createdAt: recent });
  scheduler.engine.pollDue();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(reads, 0, "checked 5 min ago, frequency 15 min");
  store.patch("automations", "r1", { lastPollAt: new Date(Date.now() - 20 * 60000).toISOString(), webFailures: 1 });
  scheduler.engine.pollDue();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(reads, 0, "after a failure the wait doubles (30 min)");
  store.patch("automations", "r1", { webFailures: 0 });
  scheduler.engine.pollDue();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(reads, 1);
});
