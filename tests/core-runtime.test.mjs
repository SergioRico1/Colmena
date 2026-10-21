import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime, seedSkills } from "../server/runtime.mjs";
import { toolCalls } from "../server/state.mjs";
import { imageUnsupported } from "../server/images.mjs";
import { answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { makePdf, makePng } from "./fixtures/core-files.mjs";

async function setup(t, provider, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-core-rt-"));
  const store = new Store(directory);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const runtime = new Runtime(store, provider, null, { retryDelays: [1, 1, 1], ...options });
  t.after(async () => { await runtime.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, runtime, directory };
}
const cards = (store, step) => toolCalls(step, { bots: new Map(store.list("bots").map((b) => [b.id, b])), receipt: (id) => store.get("receipts", step.id + ":" + id) });
const sha = (b) => createHash("sha256").update(b).digest("hex");

test("hosted web search: asked for web bots outside plan/critique; searches saved for the tool card", async (t) => {
  const seen = [];
  const output = [
    { type: "web_search_call", id: "ws_9", status: "completed", action: { type: "search", query: "horario biblioteca Valencia", sources: [{ type: "url", url: "https://bibliotecas.valencia.es/horario" }] } },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Abre a las 9.", annotations: [{ type: "url_citation", url: "https://bibliotecas.valencia.es/horario", title: "Horario de bibliotecas" }] }] },
  ];
  const { store, runtime } = await setup(t, {
    respond: async (params) => { seen.push({ webSearch: params.webSearch, instructions: params.instructions }); return { text: "Abre a las 9.", output }; },
  });
  const m = runtime.create({ prompt: "¿A qué hora abre?" });
  await runtime.launch(m.id);
  assert.equal(seen[0].webSearch, true);
  assert.match(seen[0].instructions, /Búsqueda web[\s\S]*no fiables/);
  const step = runtime.steps(m.id)[0];
  const entry = step.activity.find((a) => a.tool === "web_search");
  assert.equal(entry.query, "horario biblioteca Valencia");
  assert.deepEqual(entry.sources, [{ url: "https://bibliotecas.valencia.es/horario", title: "Horario de bibliotecas", domain: "bibliotecas.valencia.es" }]);
  assert.equal(step.reads, 1);
  const [card] = cards(store, step);
  assert.deepEqual([card.name, card.status, card.card.type, card.card.count], ["web_search", "done", "websearch", 1]);
  store.patch("bots", "nora", { capabilities: { web: false } });
  const m2 = runtime.create({ prompt: "otra" });
  await runtime.launch(m2.id);
  assert.equal(seen.at(-1).webSearch, false);
  assert.equal(runtime.searchFor(store.get("bots", "atlas"), { kind: "plan" }), false);
  assert.equal(runtime.searchFor(store.get("bots", "tomas"), { kind: "critique" }), false);
});

test("retries 429/5xx with growing waits, tells the room and keeps the work; exhausted → paused", async (t) => {
  let n = 0;
  const waits = [];
  const { store, runtime } = await setup(t, {
    respond: async () => {
      n++;
      if (n <= 2) throw Object.assign(Error("OpenAI rechazo la peticion (503)."), { status: 503 });
      return answer("Listo");
    },
  }, { retryDelays: [2000, 6000, 15000], sleep: async (ms) => { waits.push(ms); } });
  const events = [];
  store.listeners.add((e) => e.type === "activity" && e.detail && events.push(e.detail));
  const m = runtime.create({ prompt: "Hazlo" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.deepEqual(waits, [2000, 6000]);
  assert.ok(events.includes("Reintentando (1/3)…") && events.includes("Reintentando (2/3)…"));
  const step = runtime.steps(m.id)[0];
  assert.deepEqual(step.recovery.map((r) => r.status), ["waiting", "recovered"]);
  const retry = cards(store, step).find((c) => c.name === "retry");
  assert.equal(retry.status, "done");
  assert.equal(retry.card.retries, 2);

  const down = await setup(t, { respond: async () => { throw Object.assign(Error("x"), { status: 502 }); } });
  const m2 = down.runtime.create({ prompt: "Hazlo" });
  await down.runtime.launch(m2.id);
  const paused = down.store.get("missions", m2.id);
  assert.equal(paused.status, "paused");
  assert.match(paused.error, /no responde \(error del servidor 502\) tras 3 reintentos[\s\S]*lo hecho se conserva/);

  let bad = 0;
  const strict = await setup(t, { respond: async () => { bad++; throw Object.assign(Error("rechazo"), { status: 400 }); } });
  const m3 = strict.runtime.create({ prompt: "x" });
  await strict.runtime.launch(m3.id);
  assert.equal(bad, 1, "a 400 is not retried");
  assert.equal(strict.store.get("missions", m3.id).status, "blocked");
});

test("after the retries the local model answers when Ajustes › fallback is local", async (t) => {
  const localCalls = [];
  const provider = {
    respond: async () => { throw Object.assign(Error("limite"), { status: 429 }); },
    fallbackProvider: () => ({ respond: async (p) => { localCalls.push(p); return answer("Desde el modelo local"); } }),
  };
  const { store, runtime } = await setup(t, provider);
  const m = runtime.create({ prompt: "Hazlo" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).result, "Desde el modelo local");
  assert.equal(localCalls[0].reasoning, null);
  assert.equal("webSearch" in localCalls[0], false);
  assert.equal(runtime.steps(m.id)[0].recovery.at(-1).status, "fallback");
});

test("Ajustes › Si falla, usar: after the retries the substitute engine answers with the same family", async (t) => {
  const used = [];
  const provider = {
    respond: async () => { throw Object.assign(Error("limite"), { status: 429, engine: "anthropic" }); },
    fallbackFor: (model) => ({ engine: "opencode-go", label: "OpenCode Go", model: "opencode-go/kimi-k3", provider: { respond: async (p) => { used.push(p); return answer("Desde OpenCode Go"); } }, from: model }),
  };
  const { store, runtime } = await setup(t, provider);
  const m = runtime.create({ prompt: "Hazlo" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).result, "Desde OpenCode Go");
  assert.equal(used[0].model, "opencode-go/kimi-k3");
  const last = runtime.steps(m.id)[0].recovery.at(-1);
  assert.equal(last.status, "fallback");
  // An account that refuses (401) goes to the substitute at once, without waiting retries.
  let tries = 0;
  const auth = await setup(t, {
    respond: async () => { tries++; throw Object.assign(Error("sin acceso"), { status: 401 }); },
    fallbackFor: () => ({ engine: "openai", label: "ChatGPT", model: "gpt-6-sol", provider: { respond: async () => answer("Desde ChatGPT") } }),
  });
  const m2 = auth.runtime.create({ prompt: "Hazlo" });
  await auth.runtime.launch(m2.id);
  assert.equal(auth.store.get("missions", m2.id).result, "Desde ChatGPT");
  assert.equal(tries, 1);
});

test("tools already executed in a round are never repeated by a retry", async (t) => {
  let n = 0, writes = 0;
  const { store, runtime } = await setup(t, {
    respond: async ({ input }) => {
      n++;
      if (!outputs(input).length) return call("create_deliverable", { title: "Informe", kind: "document", format: "md", content: "# Hola" });
      if (n === 2) throw Object.assign(Error("x"), { status: 500 });
      return answer("Hecho");
    },
  });
  const m = runtime.create({ prompt: "Informe" });
  await runtime.launch(m.id);
  writes = store.list("artifacts").filter((a) => a.title === "Informe" && !a.id.endsWith(":result")).length;
  assert.equal(writes, 1);
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("create_image: any bot unless switched off; PNG saved in the mission folder as a design deliverable; approval with 'sugiere'", async (t) => {
  const png = makePng(8, 6);
  const asked = [];
  const provider = {
    respond: async ({ input, tools }) => {
      asked.push(tools.map((x) => x.name));
      return outputs(input).length ? answer("Aquí tienes el cartel") : call("create_image", { prompt: "Cartel de una feria de libros, colores vivos", size: "1024x1536", title: "Cartel feria" });
    },
    generateImage: async ({ prompt, size }) => ({ base64: png.toString("base64"), revisedPrompt: prompt + " (" + size + ")", usage: { input_tokens: 10, output_tokens: 5 } }),
  };
  const { store, runtime } = await setup(t, provider);
  // Any bot may create images; only switching it off per bot removes the tool.
  store.patch("bots", "nora", { capabilities: { imagenes: false } });
  const nora = runtime.create({ prompt: "x", botIds: ["nora"] });
  await runtime.launch(nora.id);
  assert.ok(!asked[0].includes("create_image"));
  store.patch("bots", "iris", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Haz un cartel", botIds: ["iris"] });
  await runtime.launch(m.id);
  assert.ok(asked.at(-1).includes("create_image"));
  const approval = store.list("approvals").find((a) => a.missionId === m.id);
  assert.equal(approval.kind, "write");
  assert.match(approval.summary, /crear una imagen \(1024x1536\)/);
  runtime.approve(approval.id, "approved");
  await settle(runtime);
  const artifact = store.list("artifacts").find((a) => a.missionId === m.id && a.kind === "design");
  assert.deepEqual([artifact.format, artifact.width, artifact.height, artifact.file], ["png", 8, 6, "imagenes/cartel-feria.png"]);
  assert.ok(!/[\x00-\x08]/.test(artifact.content), "the PNG is on disk, not in SQLite");
  assert.equal(sha(await readFile(path.join(runtime.root(m.id), artifact.file))), sha(png));
  assert.ok(store.list("messages").some((x) => x.kind === "deliverable" && x.artifactId === artifact.id));
  assert.equal(store.get("missions", m.id).status, "completed");
  const card = cards(store, runtime.steps(m.id)[0]).find((c) => c.name === "create_image");
  assert.deepEqual([card.card.type, card.card.artifactId], ["image", artifact.id]);
});

test("create_image explains when the plan does not allow images", async (t) => {
  let result;
  const { runtime } = await setup(t, {
    respond: async ({ input }) => {
      const out = outputs(input);
      if (out.length) { result = out[0]; return answer("No he podido"); }
      return call("create_image", { prompt: "un logo", size: "1024x1024", title: "Logo" });
    },
    generateImage: async () => { throw imageUnsupported(); },
  });
  const m = runtime.create({ prompt: "logo", botIds: ["iris"] });
  await runtime.launch(m.id);
  assert.equal(result.error, "Tu plan no permite crear imágenes desde Colmena.");
});

test("pdf_fields and fill_pdf: a filled COPY as a pdf deliverable, the original untouched, approval lists the fields", async (t) => {
  const results = [];
  let plan = [];
  const { store, runtime } = await setup(t, {
    respond: async ({ input }) => {
      const out = outputs(input);
      results.push(...out.slice(results.length));
      const next = plan[out.length];
      return next ? call(next[0], next[1], "c" + out.length) : answer("Formulario listo para revisar");
    },
  });
  store.patch("bots", "vera", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Rellena la solicitud", botIds: ["vera"] });
  const root = runtime.root(m.id);
  await mkdir(root, { recursive: true });
  const original = await makePdf({ form: true });
  await writeFile(path.join(root, "solicitud.pdf"), original);
  plan = [
    ["pdf_fields", { path: "solicitud.pdf", folderId: "" }],
    ["fill_pdf", { path: "solicitud.pdf", folderId: "", values: { nombre: "Ana Ruiz", inexistente: "x" }, title: "Solicitud rellena" }],
    ["fill_pdf", { path: "solicitud.pdf", folderId: "", values: { nombre: "Ana Ruiz", dni: "12345678Z", acepto: "sí", provincia: "Valencia" }, title: "Solicitud rellena" }],
  ];
  await runtime.launch(m.id);
  assert.deepEqual(results[0].fields.map((f) => [f.name, f.type]), [["nombre", "text"], ["dni", "text"], ["acepto", "checkbox"], ["provincia", "dropdown"]]);
  assert.match(results[1].error, /no tiene un campo «inexistente»/);
  const approval = store.list("approvals").find((a) => a.missionId === m.id && a.tool === "fill_pdf");
  assert.equal(approval.kind, "write");
  assert.match(approval.summary, /copia rellena de «solicitud\.pdf» \(el original no cambia\) con 4 campos: nombre = «Ana Ruiz»; dni = «12345678Z»; acepto = «sí»/);
  assert.equal(approval.fields.length, 4);
  runtime.approve(approval.id, "approved");
  await settle(runtime);
  const artifact = store.list("artifacts").find((a) => a.missionId === m.id && a.format === "pdf");
  assert.deepEqual([artifact.kind, artifact.file, artifact.pages], ["document", "formularios/solicitud-rellena.pdf", 2]);
  assert.match(artifact.content, /\| nombre \| Ana Ruiz \|/);
  assert.equal(sha(await readFile(path.join(root, "solicitud.pdf"))), sha(original), "original unchanged");
  const { inspectPdf } = await import("../server/pdfforms.mjs");
  const filled = await inspectPdf(await readFile(path.join(root, artifact.file)));
  assert.deepEqual(filled.fields.map((f) => f.value), ["Ana Ruiz", "12345678Z", "sí", "Valencia"]);
  assert.equal(store.get("missions", m.id).status, "completed");
  const types = cards(store, runtime.steps(m.id)[0]).map((c) => c.card.type);
  assert.deepEqual(types, ["pdf_fields", "fill_pdf", "fill_pdf"]);
});

test("initial skills: twelve active imported skills, for their bots or for everyone, seeded once", async (t) => {
  const { store } = await setup(t, { respond: async () => answer("x") });
  const created = seedSkills(store);
  assert.equal(created.length, 12);
  const skills = store.list("skills");
  assert.ok(skills.every((s) => s.status === "active" && s.origin === "imported"));
  const by = (bot) => skills.filter((s) => s.botId === bot).map((s) => s.name).sort();
  assert.deepEqual(by("nora"), ["Resumir enlaces y documentos", "Seguir las noticias de una web"]);
  assert.deepEqual(by("tomas"), ["Analizar gastos desde el CSV del banco", "Visualizar datos en tabla o gráfico"]);
  assert.deepEqual(by("iris"), ["Diagramas en SVG"]);
  assert.deepEqual(by("bruno").length, 2);
  assert.deepEqual(by("vera"), ["Firmar en nombre de la persona sin hacerse pasar por ella"]);
  assert.deepEqual(by("atlas"), ["Guía de calidad para crear habilidades"]);
  // Presentations, Word documents and Excel workbooks are for every bot (work tools of all of them).
  assert.deepEqual(skills.filter((s) => !s.botId).map((s) => s.name).sort(), ["Crear documentos de Word que se leen de un tirón", "Crear hojas de cálculo de Excel que siguen funcionando", "Crear presentaciones que se entienden solas"]);
  assert.ok(skills.every((s) => /^Úsala cuando/.test(s.description)));
  assert.equal(store.get("settings", "main").seededSkills.length, 12);
  store.remove("skills", skills[0].id);
  assert.equal(seedSkills(store).length, 0, "never re-added after removal");
  const fresh = await setup(t, { respond: async () => answer("x") }, { seed: true });
  assert.equal(fresh.store.list("skills").length, 12);
  assert.ok(existsSync(path.join(process.cwd(), "prompts", "skills", "crear-habilidades.md")));
});
