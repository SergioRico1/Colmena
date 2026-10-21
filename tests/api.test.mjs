import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";

async function setup(t, { session = { status: () => null, models: [] } } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-api-")),
    store = new Store(dir);
  const runtime = new Runtime(store, {
    respond: async () => {
      throw Error("No provider calls in API tests");
    },
  });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const send = (method) => (route, body = {}, extra = {}) =>
    fetch(origin + "/api" + route, {
      method,
      headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf, ...extra },
      body: JSON.stringify(body),
    });
  const get = async (route) => (await fetch(origin + "/api" + route)).json();
  return { store, runtime, origin, csrf, dir, post: send("POST"), patch: send("PATCH"), del: send("DELETE"), get };
}

test("API rejects foreign origins and missing CSRF; allows local validated mutation", async (t) => {
  const { origin, post } = await setup(t);
  const memory = { text: "fixture preference" };
  assert.equal((await post("/memories", memory, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await post("/memories", memory, { "X-Colmena-Token": "" })).status, 403);
  assert.equal((await post("/memories", memory, { "X-Colmena-Token": "x".repeat(64) })).status, 403);
  assert.equal((await post("/memories", memory)).status, 200);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http
      .get(origin + "/api/state", { headers: { Host: "evil.invalid" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on("error", reject);
  });
  assert.equal(foreignHostStatus, 403);
});

test("API rejects unknown bot, invalid mode, unknown fields and unreviewed model selection", async (t) => {
  const { post, patch } = await setup(t);
  assert.equal((await post("/missions", { prompt: "test", mode: "solo", botIds: ["unknown"] })).status, 422);
  const invalid = await post("/missions", { prompt: "test", mode: "execute-anything", botIds: ["nora"] });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /^Revisa los datos/);
  assert.equal((await post("/missions", { prompt: "test", mode: "solo", botIds: ["nora"], extra: 1 })).status, 400);
  assert.equal((await patch("/settings", { model: "made-up" })).status, 422);
  assert.equal((await post("/missions/nope/plan", { decision: "approved" })).status, 404);
});

test("API creates durable blocked mission without live account; detail has contract shape", async (t) => {
  const { post, get, store, runtime } = await setup(t);
  const response = await post("/missions", {
    prompt: "Fixture API",
    mode: "solo",
    botIds: ["nora"],
    attachments: [{ name: "brief.txt", content: "local fixture" }],
  });
  assert.equal(response.status, 201);
  const m = await response.json();
  await Promise.all([...runtime.jobs]);
  assert.equal(store.get("missions", m.id).status, "blocked");
  const loaded = await get("/missions/" + m.id);
  assert.equal(loaded.prompt, "Fixture API");
  assert.equal(loaded.steps[0].history, undefined);
  assert.equal(loaded.statusLabel, "Bloqueada");
  assert.deepEqual(loaded.progress, { done: 0, total: 1 });
  for (const key of ["messages", "thread", "proposals", "files", "artifacts"]) assert.ok(Array.isArray(loaded[key]), key);
  assert.deepEqual(loaded.files.map((f) => f.name), ["brief.txt"]);
  assert.ok("threadSummary" in loaded);
  assert.equal(loaded.messages[0].kind, "message");
});

test("state is light and computed: no artifact, skill or soul contents", async (t) => {
  const { store, get, post } = await setup(t);
  const secret = "CONTENIDO-GRANDE-QUE-NO-VIAJA";
  const m = store.put("missions", { id: "m1", title: "Informe Q3", prompt: "x", mode: "solo", botIds: ["iris"], status: "waiting", createdAt: new Date().toISOString(), result: secret });
  store.put("steps", { id: "m1:a", key: "a", missionId: m.id, botId: "iris", kind: "solo", status: "completed", text: "", history: [{ content: secret }] });
  store.put("steps", { id: "m1:b", key: "b", missionId: m.id, botId: "iris", kind: "solo", status: "waiting", text: "" });
  store.put("approvals", { id: "q1", missionId: m.id, botId: "iris", kind: "question", title: "¿Formato?", status: "pending", options: [{ id: "a", label: "A", primary: true }], createdAt: new Date(Date.now() - 12 * 60000).toISOString() });
  store.put("approvals", { id: "old", missionId: m.id, botId: "iris", kind: "write", status: "approved", createdAt: "2020-01-01T00:00:00.000Z", decidedAt: "2020-01-01T00:00:00.000Z" });
  store.put("artifacts", { id: "a1", missionId: m.id, title: "informe.md", content: secret, createdAt: new Date().toISOString() });
  store.put("skills", { id: "s1", name: "Informe", description: "d", content: secret + "\n1. paso\n2. paso", status: "active", version: 2, createdAt: new Date().toISOString() });
  assert.equal((await post("/people", { name: "Ana", email: "ana@example.com", role: "Finanzas" })).status, 201);
  const state = await get("/state");
  assert.equal(JSON.stringify(state).includes(secret), false);
  const iris = state.bots.find((b) => b.id === "iris");
  assert.equal(iris.status, "espera");
  assert.equal(iris.statusLabel, "Te espera");
  assert.equal(iris.waitingIn, 1);
  assert.equal(iris.missionCount, 1);
  assert.equal(iris.autonomy, "avisa");
  assert.deepEqual(iris.personality, { tono: 50, detalle: 50, riesgo: 30 });
  const mission = state.missions.find((x) => x.id === "m1");
  assert.equal(mission.room, "informe-q3");
  assert.equal(mission.statusLabel, "Te espera");
  assert.equal(mission.activityLine, "Te espera: 1 pregunta");
  assert.deepEqual(mission.progress, { done: 1, total: 2 });
  assert.equal(mission.questionCount, 1);
  assert.deepEqual(state.approvals.map((a) => a.id), ["q1"]);
  assert.match(state.approvals[0].context, /^Iris · #informe-q3 · hace 1\d min$/);
  assert.equal(state.skills[0].steps, 2);
  assert.equal(state.artifacts[0].format, "md");
  assert.equal(state.settings.spaceName, "Mi espacio");
  assert.deepEqual(state.settings.limits, { monthlyTokens: null, pauseAtLimit: true, warnAt80: true });
  assert.deepEqual(state.usage.limitTokens, null);
  assert.deepEqual(state.connectors.map((c) => c.id), ["correo", "calendario", "carpeta", "hojas", "chat", "video", "crm", "erp"]);
  assert.equal(state.connectors.every((c) => c.connected === false), true);
  assert.equal(state.people[0].id, "me");
  assert.equal(state.people[1].name, "Ana");
  assert.equal(state.paused, false);
  const artifact = await get("/artifacts/a1");
  assert.equal(artifact.content, secret);
});

test("artifact download sets disposition and type", async (t) => {
  const { store, origin } = await setup(t);
  store.put("artifacts", { id: "a1", title: "Datos «Q3».csv", content: "a,b\n1,2", createdAt: new Date().toISOString() });
  const r = await fetch(origin + "/api/artifacts/a1/download");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/csv/);
  assert.match(r.headers.get("content-disposition"), /^attachment; filename=".*\.csv"; filename\*=UTF-8''/);
  assert.equal(await r.text(), "a,b\n1,2");
});

test("bot preparation and private trial are tool-free, validated and not persisted", async (t) => {
  const { store, runtime, post } = await setup(t);
  store.patch("settings", "main", { model: "fixture" });
  const before = store.list("missions").length;
  runtime.provider.respond = async (request) => {
    assert.deepEqual(request.tools, []);
    assert.ok(request.signal);
    return {
      text: request.instructions.includes("exclusivamente JSON")
        ? JSON.stringify({ name: "Leo", role: "Asistente legal", instructions: "Revisa contratos con permiso explícito.", skills: [{ name: "Leer contratos", description: "x" }], permissions: { carpeta: "lee" }, questions: ["¿Qué asesoría?"] })
        : "Private answer",
      output: [],
    };
  };
  const prepared = await post("/bots/prepare", { description: "Revisa contratos de proveedores y avisa de renovaciones.", audience: "equipo" });
  assert.equal(prepared.status, 200);
  const draft = await prepared.json();
  assert.equal(draft.name, "Leo");
  assert.equal(draft.permissions.carpeta, "lee");
  assert.equal(draft.permissions.correo, "none");
  assert.equal(draft.autonomy, "sugiere");
  assert.deepEqual(draft.questions, ["¿Qué asesoría?"]);
  const trial = await post("/bots/preview", { draft: { name: draft.name, role: draft.role, instructions: draft.instructions }, prompt: "¿Qué haces?" });
  assert.equal(trial.status, 200);
  assert.equal((await trial.json()).text, "Private answer");
  assert.equal(store.list("missions").length, before);
  assert.equal(store.list("messages").length, 0);
  assert.equal((await post("/bots/prepare", { description: "short" })).status, 400);
  runtime.provider.respond = async () => ({ text: "not JSON", output: [] });
  assert.equal((await post("/bots/prepare", { description: "Review local documents with permission." })).status, 422);
});

test("bots CRUD: create with skills, duplicate, patch merges, built-ins are not deleted", async (t) => {
  const { post, patch, del, get, store } = await setup(t);
  const created = await post("/bots", { name: "Leo", role: "Asistente legal", instructions: "Revisa contratos y avisa.", color: "#0E7C86", shape: "circle", skills: [{ name: "Leer contratos", description: "Revisa cláusulas" }], tools: { carpeta: "lee" } });
  assert.equal(created.status, 201);
  const bot = await created.json();
  assert.equal(bot.builtin, false);
  assert.equal(bot.tools.carpeta, "lee");
  assert.equal(bot.tools.correo, "none");
  const detail = await get("/bots/" + bot.id);
  assert.equal(detail.skills[0].name, "Leer contratos");
  assert.equal(detail.skills[0].status, "active");
  assert.ok(Array.isArray(detail.history));
  const edited = await (await patch("/bots/" + bot.id, { personality: { tono: 80 }, tools: { correo: "pide" } })).json();
  assert.deepEqual(edited.personality, { tono: 80, detalle: 50, riesgo: 30 });
  assert.equal(edited.tools.carpeta, "lee");
  assert.equal(edited.tools.correo, "pide");
  const copy = await (await post("/bots/" + bot.id + "/duplicate", {})).json();
  assert.equal(copy.name, "Leo (copia)");
  for (const body of [{ location: "nube" }, { channels: { movil: true } }]) {
    const later = await patch("/bots/" + bot.id, body);
    assert.equal(later.status, 422);
    assert.equal((await later.json()).error, "Disponible más adelante.");
  }
  assert.equal(edited.location, "local");
  assert.equal((await del("/bots/nora")).status, 422);
  assert.equal((await patch("/bots/atlas", { enabled: false })).status, 422);
  assert.equal((await del("/bots/" + copy.id)).status, 200);
  assert.equal(store.get("bots", copy.id), null);
});

test("automations: create with trigger, nextRun, edit keeps schedule, runs and test", async (t) => {
  const { store, post, patch, get, del } = await setup(t);
  const response = await post("/automations", {
    name: "Resumen del correo",
    botId: "vera",
    prompt: "Resume el correo",
    trigger: { type: "dia", config: { hora: "08:00", dias: [1, 2, 3, 4, 5], festivo: "saltar", probado: false, buzon: "x" }, sentence: "lo que sea" },
  });
  assert.equal(response.status, 201);
  const rule = await response.json();
  assert.equal(rule.trigger.sentence, "sean las 08:00 de lunes a viernes");
  assert.deepEqual(Object.keys(rule.trigger.config).sort(), ["dias", "festivo", "hora", "zona"]);
  assert.ok(Date.parse(rule.nextRun) > Date.now());
  assert.match(rule.subtitle, /^Días laborables, 08:00 · Próxima: /);
  const nextRun = "2030-01-01T10:00:00.000Z";
  store.patch("automations", rule.id, { nextRun, enabled: false });
  const edited = await patch("/automations/" + rule.id, { prompt: "Editado", botId: "nora" });
  assert.equal(edited.status, 200);
  assert.equal(store.get("automations", rule.id).nextRun, nextRun);
  assert.equal(store.get("automations", rule.id).enabled, false);
  assert.equal(store.get("automations", rule.id).prompt, "Editado");
  assert.equal((await patch("/automations/" + rule.id, { trigger: { type: "dia", config: { dias: [] } } })).status, 422);
  assert.equal((await patch("/automations/" + rule.id, { trigger: { type: "dia", config: { inventado: 1 } } })).status, 400);
  assert.equal((await post("/automations", { name: "Pasada", botId: "vera", prompt: "x", trigger: { type: "vez", config: { vezFecha: "2001-01-01", vezHora: "10:00" } } })).status, 422);
  store.put("missions", { id: "r1", title: "Resumen", automationId: rule.id, status: "completed", createdAt: "2026-01-01T08:00:00.000Z" });
  assert.deepEqual(await get("/automations/" + rule.id + "/runs"), [{ at: "2026-01-01T08:00:00.000Z", missionId: "r1", title: "Resumen", status: "completed" }]);
  const sala = await (await post("/automations", { name: "Urgencias", botId: "atlas", prompt: "Atiende", trigger: { type: "sala", config: { sala: "facturación", salaModo: "palabras", palabras: "urgente" } } })).json();
  const tested = await post("/automations/" + sala.id + "/test", {});
  assert.equal(tested.status, 422); // no AI account and nothing observed yet
  assert.equal((await del("/automations/" + sala.id)).status, 200);
  const describe = await post("/automations/describe", { text: "Cada lunes resume las ventas" });
  assert.equal(describe.status, 422);
  assert.match((await describe.json()).error, /Conecta una cuenta de IA/);
});

test("suggestions: accepting an automation creates it; always-approve creates a grant; dismiss hides", async (t) => {
  const { store, post, get } = await setup(t);
  store.put("suggestions", { id: "s1", kind: "automation", text: "Cada lunes pides el resumen", botId: "tomas", cta: "Sí, cada lunes a las 9:00", payload: { name: "Resumen de ventas", botId: "tomas", prompt: "Resume las ventas de la semana", trigger: { type: "semana", config: { semDia: 1, semHora: "09:00", semCada: "1" } } }, createdAt: new Date().toISOString() });
  store.put("suggestions", { id: "s2", kind: "always-approve", text: "Siempre apruebas", botId: "vera", payload: { tool: "write_file", scope: "informes" }, createdAt: new Date().toISOString() });
  store.put("suggestions", { id: "s3", kind: "automation", text: "Otra", payload: {}, createdAt: new Date().toISOString() });
  const accepted = await (await post("/suggestions/s1", { decision: "accept" })).json();
  assert.equal(accepted.automation.name, "Resumen de ventas");
  assert.equal(accepted.automation.trigger.sentence, "sea lunes a las 09:00");
  assert.equal(store.list("automations").length, 1);
  assert.equal((await post("/suggestions/s1", { decision: "accept" })).status, 409);
  const grant = await (await post("/suggestions/s2", { decision: "accept" })).json();
  assert.equal(grant.grant.botId, "vera");
  assert.equal(store.list("grants")[0].tool, "write_file");
  assert.equal((await post("/suggestions/s3", { decision: "dismiss" })).status, 200);
  assert.deepEqual((await get("/state")).suggestions, []);
});

test("folders: rejects dangerous paths, accepts a normal folder, patch and delete", async (t) => {
  const { post, patch, del, dir, store } = await setup(t);
  const reject = async (p) => {
    const r = await post("/folders", { path: p });
    assert.equal(r.status, 422, p);
    return (await r.json()).error;
  };
  await reject(path.parse(process.cwd()).root);
  await reject(os.homedir());
  await reject(dir); // Colmena data directory
  await reject(path.join(dir, "workspaces"));
  await reject("relativa/carpeta");
  await reject(path.join(os.tmpdir(), "colmena-no-existe-" + Date.now()));
  await reject(process.env.SystemRoot || "/etc");
  const outside = await import("node:fs/promises").then((fs) => fs.mkdtemp(path.join(os.tmpdir(), "colmena-folder-")));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "file.txt"), "x");
  await reject(path.join(outside, "file.txt"));
  await mkdir(path.join(outside, "Contabilidad"));
  const r = await post("/folders", { path: path.join(outside, "Contabilidad") + path.sep, botIds: ["tomas"], access: "lee" });
  assert.equal(r.status, 201);
  const folder = await r.json();
  assert.equal(folder.label, "Contabilidad");
  assert.equal((await post("/folders", { path: path.join(outside, "Contabilidad") })).status, 409);
  assert.equal((await post("/folders", { path: path.join(outside, "Contabilidad"), botIds: ["nadie"] })).status, 409);
  assert.equal((await patch("/folders/" + folder.id, { access: "escribe", botIds: ["tomas", "bruno"] })).status, 200);
  assert.equal(store.get("folders", folder.id).access, "escribe");
  assert.equal((await del("/folders/" + folder.id)).status, 200);
  assert.equal(store.list("folders").length, 0);
});

test("search finds bots, missions, artifacts, files and messages (accent-insensitive)", async (t) => {
  const { store, get, dir } = await setup(t);
  store.put("missions", { id: "m1", title: "Campaña de primavera", prompt: "Diseño", mode: "solo", botIds: ["iris"], status: "completed", createdAt: new Date().toISOString() });
  store.put("messages", { id: "msg1", missionId: "m1", role: "user", text: "Necesito la campaña con colores cálidos", at: new Date().toISOString() });
  store.put("artifacts", { id: "a1", missionId: "m1", title: "Guion", content: "Texto de la campaña final", createdAt: new Date().toISOString() });
  await mkdir(path.join(dir, "workspaces", "m1"), { recursive: true });
  await writeFile(path.join(dir, "workspaces", "m1", "campana-brief.txt"), "x");
  const r = await get("/search?q=" + encodeURIComponent("CAMPANA"));
  assert.deepEqual(r.missions.map((m) => m.id), ["m1"]);
  assert.deepEqual(r.messages.map((m) => m.id), ["msg1"]);
  assert.deepEqual(r.artifacts.map((a) => a.id), ["a1"]);
  assert.deepEqual(r.files.map((f) => f.name), ["campana-brief.txt"]);
  assert.deepEqual((await get("/search?q=dise")).bots.map((b) => b.id), ["iris"]);
  assert.deepEqual(await get("/search?q="), { bots: [], missions: [], artifacts: [], files: [], messages: [] });
});

test("onboarding legal creates Leo, adjusts the team and marks onboarded", async (t) => {
  const { store, post } = await setup(t);
  const custom = await (await post("/bots", { name: "Propio", role: "Ayudante", instructions: "Ayuda con tareas propias.", color: "#123456", shape: "square" })).json();
  const r = await post("/onboarding", { role: "legal" });
  assert.equal(r.status, 200);
  const leo = store.get("bots", "leo");
  assert.equal(leo.name, "Leo");
  assert.equal(leo.role, "Asistente legal");
  assert.equal(leo.color, "#0E7C86");
  assert.equal(leo.shape, "circle");
  assert.equal(leo.enabled, true);
  assert.equal(leo.builtin, true);
  for (const b of ["atlas", "leo", "nora", "vera"]) assert.equal(store.get("bots", b).enabled, true, b);
  for (const b of ["tomas", "iris", "bruno"]) assert.equal(store.get("bots", b).enabled, false, b);
  assert.equal(store.get("bots", custom.id).enabled, true);
  assert.equal(store.get("settings", "main").onboarded, true);
  await post("/onboarding", { role: "finanzas" });
  assert.equal(store.get("bots", "leo").enabled, false);
  assert.equal(store.get("bots", "tomas").enabled, true);
  assert.equal((await post("/onboarding", { role: "astronauta" })).status, 400);
  // The onboarding chat: your name, what you use and a narrower team; Atlas always stays.
  const chat = await post("/onboarding", { role: "marketing", team: ["vera"], userName: "Marina", apps: ["correo", "hojas"] });
  assert.deepEqual((await chat.json()).team, ["atlas", "vera"]);
  for (const b of ["atlas", "vera"]) assert.equal(store.get("bots", b).enabled, true, b);
  for (const b of ["iris", "nora"]) assert.equal(store.get("bots", b).enabled, false, b);
  assert.equal(store.get("settings", "main").userName, "Marina");
  assert.deepEqual(store.get("settings", "main").dailyApps, ["correo", "hojas"]);
});

test("settings, memories, people and global pause", async (t) => {
  const { store, post, patch, del, get } = await setup(t);
  const s = await (await patch("/settings", { spaceName: "Equipo de operaciones", limits: { monthlyTokens: 500000 }, fallback: "local" })).json();
  assert.equal(s.spaceName, "Equipo de operaciones");
  assert.deepEqual(s.limits, { monthlyTokens: 500000, pauseAtLimit: true, warnAt80: true });
  assert.equal((await get("/state")).usage.limitTokens, 500000);
  const memory = await (await post("/memories", { text: "Cifras en miles", botId: "tomas" })).json();
  assert.equal(memory.scope, "bot");
  assert.match(memory.sourceLabel, /^Se lo dijiste · /);
  assert.equal((await patch("/memories/" + memory.id, { review: true })).status, 200);
  assert.equal((await del("/memories/" + memory.id)).status, 200);
  assert.equal((await del("/memories/" + memory.id)).status, 404);
  assert.equal((await post("/people", { name: "Ana", email: "no-es-correo" })).status, 400);
  assert.equal((await patch("/people/me", { name: "Yo" })).status, 422);
  assert.equal((await (await post("/control", { action: "pause-all" })).json()).paused, true);
  assert.equal(store.get("settings", "main").paused, true);
  assert.equal((await get("/state")).bots[0].status, "pausado");
  await post("/control", { action: "resume-all" });
  assert.equal(store.get("settings", "main").paused, false);
});

test("SSE coalesces store changes into {type:'changed', kinds} and forwards live events", async (t) => {
  const { origin, store, post } = await setup(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(origin + "/api/events", { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (predicate) => {
    for (;;) {
      const events = buffer.split("\n\n");
      buffer = events.pop();
      for (const chunk of events) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (predicate(event)) return event;
      }
      const { value, done } = await reader.read();
      if (done) throw Error("stream closed");
      buffer += decoder.decode(value);
    }
  };
  await post("/memories", { text: "uno" });
  await post("/people", { name: "Ana" });
  const changed = await next((e) => e.type === "changed");
  assert.deepEqual(changed.kinds.sort(), ["memories", "people"]);
  for (const fn of store.listeners) fn({ type: "delta", mission: "m", stepId: "s", botId: "iris", text: "Hola" });
  assert.deepEqual(await next((e) => e.type === "delta"), { type: "delta", mission: "m", stepId: "s", botId: "iris", text: "Hola" });
});

test("runtime-dependent endpoints answer 501 while the runtime lacks them", async (t) => {
  const { store, runtime, post } = await setup(t);
  store.put("missions", { id: "m1", title: "x", prompt: "x", mode: "equipo", botIds: [], status: "awaiting_plan", createdAt: new Date().toISOString() });
  const original = runtime.planDecision;
  runtime.planDecision = undefined;
  const r = await post("/missions/m1/plan", { decision: "approved" });
  assert.equal(r.status, 501);
  assert.equal((await r.json()).error, "Disponible en breve.");
  runtime.planDecision = original;
});

test("send edits keep/remove attachments and mark edited; skill status settles its approval", async (t) => {
  const { store, patch } = await setup(t);
  store.put("missions", { id: "m1", title: "Resumen", prompt: "x", mode: "solo", botIds: ["vera"], status: "waiting", createdAt: new Date().toISOString() });
  store.put("approvals", { id: "e1", missionId: "m1", botId: "vera", kind: "send", status: "pending", createdAt: new Date().toISOString(),
    email: { to: ["a@b.es"], cc: [], cco: [], subject: "Hola", body: "Texto", attachments: [{ name: "informe.pdf", size: 10 }, { name: "datos.csv", size: 5 }] } });
  const body = { to: ["dir@b.es"], cc: [], cco: [], subject: "Resumen semanal", body: "Nuevo" };
  const edited = await (await patch("/approvals/e1/email", { ...body, attachments: [{ name: "datos.csv", size: 5 }, { name: "nuevo.exe", size: 1 }] })).json();
  assert.equal(edited.edited, true);
  assert.equal(edited.status, "pending");
  assert.deepEqual(edited.email.attachments, [{ name: "datos.csv", size: 5 }]); // never adds files
  assert.equal(store.get("approvals", "e1").email.subject, "Resumen semanal");
  store.put("skills", { id: "s1", name: "Conciliación", description: "d", content: ["---", "name: Conciliación", "---", "1. paso"].join(String.fromCharCode(10)), status: "pending", version: 1, createdAt: new Date().toISOString() });
  store.put("approvals", { id: "k1", missionId: "m1", botId: "tomas", kind: "skill", skillId: "s1", status: "pending", createdAt: new Date().toISOString() });
  assert.equal((await patch("/skills/s1", { status: "active" })).status, 200);
  assert.equal(store.get("approvals", "k1").status, "approved");
  assert.equal(store.get("skills", "s1").status, "active");
});

test("messages and steps are pushed whole over the event stream; long rooms open with their latest messages", async (t) => {
  const { store, origin, get } = await setup(t);
  store.put("missions", { id: "big", title: "Larga", room: "larga", status: "completed", mode: "solo", botIds: ["nora"], createdAt: new Date().toISOString() });
  for (let i = 0; i < 130; i++) store.put("messages", { id: "m" + i, missionId: "big", role: i % 2 ? "assistant" : "user", botId: i % 2 ? "nora" : null, text: "mensaje " + i, at: new Date(Date.now() + i).toISOString() });
  store.put("messages", { id: "r1", missionId: "big", role: "user", text: "respuesta en hilo", replyTo: "m129", at: new Date().toISOString() });
  const recent = await get("/missions/big");
  assert.equal(recent.olderCount, 10);
  assert.equal(recent.messages.filter((m) => !m.replyTo).length, 120);
  assert.equal(recent.messages[0].id, "m10");
  assert.ok(recent.messages.some((m) => m.id === "r1"), "replies to kept messages come along");
  assert.equal((await get("/missions/big?mensajes=todos")).messages.length, 131);

  const ac = new AbortController();
  t.after(() => ac.abort());
  const res = await fetch(origin + "/api/events", { signal: ac.signal });
  const reader = res.body.getReader();
  const seen = [];
  const read = (async () => {
    let text = "";
    while (!seen.some((e) => e.type === "push")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      for (const line of text.split("\n")) if (line.startsWith("data: ")) try { seen.push(JSON.parse(line.slice(6))); } catch {}
    }
  })();
  await new Promise((r) => setTimeout(r, 50));
  store.put("messages", { id: "new", missionId: "big", role: "assistant", botId: "nora", text: "Recién llegado", at: new Date().toISOString() });
  await Promise.race([read, new Promise((r) => setTimeout(r, 2000))]);
  const push = seen.find((e) => e.type === "push");
  assert.ok(push, "a push event arrived");
  assert.equal(push.mission, "big");
  assert.equal(push.record.text, "Recién llegado");
  assert.equal(push.record.role, "assistant");
});
