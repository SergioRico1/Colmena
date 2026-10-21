import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { Runtime } from "../server/runtime.mjs";

test("ask_user creates a question approval; answer resumes with the chosen option", async (t) => {
  let received;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const out = outputs(input);
    if (!out.length) return call("ask_user", { question: "¿Formato del informe?", options: ["PDF", "Presentación"], blocks: 2 });
    received = out[0];
    return answer("Hecho en " + out[0].answer);
  });
  const m = runtime.create({ prompt: "Informe" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "waiting");
  const q = store.list("approvals")[0];
  assert.equal(q.kind, "question");
  assert.equal(q.blocks, 2);
  assert.deepEqual(q.options.map((o) => o.label), ["PDF", "Presentación"]);
  assert.equal(store.list("messages").find((x) => x.kind === "question").approvalId, q.id);
  assert.throws(() => runtime.answer(q.id, { optionId: "o9" }), /no valida/);
  runtime.answer(q.id, { optionId: "o2" });
  assert.throws(() => runtime.answer(q.id, { optionId: "o1" }), /respondida/);
  await settle(runtime);
  assert.equal(received.answer, "Presentación");
  assert.equal(store.get("approvals", q.id).status, "answered");
  assert.equal(store.get("missions", m.id).result, "Hecho en Presentación");
});

test("ask_bot consults the other bot with read-only mission tools, logs the thread and respects helpers", async (t) => {
  const nested = [];
  const { store, runtime } = await fixture(t, async ({ input, tools, instructions }) => {
    if (/Consulta de un compañero/.test(instructions)) {
      assert.deepEqual(tools.map((t) => t.name).sort(), ["list_files", "mission_brief", "read_deliverable", "read_file", "search_history"]);
      nested.push(instructions);
      return answer("El margen es del 12 %");
    }
    const out = outputs(input);
    if (!out.length) return call("ask_bot", { botId: "tomas", question: "¿Cuál es el margen?" });
    if (out.length === 1) return call("ask_bot", { botId: "iris", question: "¿Color?" }, "call-2");
    return answer("Margen: " + out[0].answer + " / " + out[1].error);
  });
  store.patch("bots", "nora", { helpers: ["tomas"] });
  const events = [];
  store.listeners.add((e) => e.type === "activity" && events.push(e));
  const m = runtime.create({ prompt: "Analiza" });
  await runtime.launch(m.id);
  assert.equal(nested.length, 1);
  assert.match(nested[0], /Eres Tomás/);
  const thread = runtime.thread(m.id);
  assert.deepEqual(thread.map((x) => [x.from, x.to]), [["nora", "tomas"], ["tomas", "nora"]]);
  assert.match(store.get("missions", m.id).result, /12 %.*Solo puedes consultar a: Tomás/);
  assert.match(store.get("missions", m.id).threadSummary, /Nora consultó a Tomás/);
  assert.ok(events.some((e) => e.verb === "hablando con otro bot" && e.detail === "Tomás"));
  assert.ok(events.some((e) => e.verb === "pensando"));
  assert.equal(runtime.activity.size, 0);
});

test("create_deliverable: direct with 'avisa', versioned; approval with 'sugiere'", async (t) => {
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const n = outputs(input).length;
    if (n < 2) return call("create_deliverable", { title: "Resumen", kind: "code", format: "py", content: "print(" + n + ")" }, "d" + n);
    return answer("Listo");
  });
  const verbs = [];
  store.listeners.add((e) => e.type === "activity" && verbs.push(e.verb));
  const m = runtime.create({ prompt: "Script" });
  await runtime.launch(m.id);
  const arts = store.list("artifacts").filter((a) => a.title === "Resumen");
  assert.deepEqual(arts.map((a) => a.version), [1, 2]);
  assert.equal(arts[1].previousId, arts[0].id);
  assert.equal(arts[0].room, store.get("missions", m.id).room);
  assert.equal(store.list("messages").filter((x) => x.kind === "deliverable").length, 2);
  assert.ok(verbs.includes("programando"));
  assert.equal(store.list("approvals").length, 0);

  store.patch("bots", "nora", { autonomy: "sugiere" });
  const s = runtime.create({ prompt: "Otro script" });
  await runtime.launch(s.id);
  assert.equal(store.get("missions", s.id).status, "waiting");
  const a = store.list("approvals").find((x) => x.missionId === s.id);
  assert.equal(a.kind, "write");
  assert.equal(a.canAlways, true);
  assert.equal(store.list("artifacts").filter((x) => x.missionId === s.id && x.title === "Resumen").length, 0);
  runtime.approve(a.id, "approved", { always: true });
  await settle(runtime);
  // Second deliverable of the same kind is approved by the new rule.
  const second = store.list("approvals").filter((x) => x.missionId === s.id);
  assert.equal(second.length, 2);
  assert.equal(second[1].decidedBy, "regla");
  assert.equal(store.list("grants").length, 1);
  assert.equal(store.get("missions", s.id).status, "completed");
});

test("remember saves directly as 'dedujo' for review, refuses secrets", async (t) => {
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const out = outputs(input);
    if (!out.length) return call("remember", { text: "Prefiere informes breves", scope: "equipo" });
    if (out.length === 1) return call("remember", { text: "Su IBAN es ES9121000418450200051332", scope: "bot" }, "call-2");
    return answer("ok " + out[1].error);
  });
  const m = runtime.create({ prompt: "Recuerda" });
  await runtime.launch(m.id);
  const mems = store.list("memories");
  assert.equal(mems.length, 1);
  assert.equal(mems[0].source, "dedujo");
  assert.equal(mems[0].review, true);
  assert.match(store.get("missions", m.id).result, /sensibles/);
});

test("red line: apps_execute always waits for review, even with autonomy 'solo' and grants", async (t) => {
  const requests = [];
  const connections = {
    request: async (mission, step, c, args) => {
      requests.push(args);
      const idv = step.id + ":" + c.call_id;
      if (!t.store.get("approvals", idv))
        t.store.put("approvals", { id: idv, missionId: mission.id, botId: step.botId, tool: "apps_execute", args, kind: "send", status: "pending", review: { name: "Enviar correo", toolkit: "gmail" } });
      return { waiting: true };
    },
    call: async () => ({}),
  };
  const { store, runtime: base } = await fixture(t, async () => answer("x"));
  t.store = store;
  const runtime = new Runtime(store, {
    respond: async ({ input }) => outputs(input).length ? answer("Enviado") : call("apps_execute", {
      tool: "GMAIL_SEND_EMAIL", account: "acc",
      arguments_json: JSON.stringify({ recipient_email: "ana@example.com, luis@example.com", subject: "Resumen", body: "Hola", cc: ["jefa@example.com"] }),
    }),
  }, connections);
  t.after(() => runtime.shutdown());
  store.patch("bots", "vera", { autonomy: "solo" });
  store.put("grants", { id: "g", botId: "vera", tool: "apps_execute", scope: null, active: true });
  const m = runtime.create({ prompt: "Envía el resumen", botIds: ["vera"] });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "waiting");
  const a = store.list("approvals")[0];
  assert.equal(a.status, "pending");
  assert.equal(a.redLine, true);
  assert.equal(a.canAlways, false);
  assert.deepEqual(a.email.to, ["ana@example.com", "luis@example.com"]);
  assert.deepEqual(a.email.cc, ["jefa@example.com"]);
  assert.equal(a.email.subject, "Resumen");
  assert.match(a.title, /Enviar/);
  assert.throws(() => runtime.approve(a.id, "approved", { always: true }), /conexiones/);
  assert.equal(requests.length, 1);
  void base;
});

test("web_fetch goes through the injected reader; private addresses are refused", async (t) => {
  const { webFetch } = await import("../server/web.mjs");
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const out = outputs(input);
    if (!out.length) return call("web_fetch", { url: "http://127.0.0.1:4318/api/state" });
    return answer("Resultado: " + out[0].error);
  }, { web: webFetch });
  const m = runtime.create({ prompt: "Lee" });
  await runtime.launch(m.id);
  assert.match(store.get("missions", m.id).result, /no permitida/);
  assert.equal(runtime.steps(m.id)[0].reads, 0);
});

test("folders: only listed bots, no escape outside or through symlinks", async (t) => {
  const { store, runtime, directory } = await fixture(t, async () => answer("x"));
  const shared = path.join(directory, "shared"), secret = path.join(directory, "secret");
  await mkdir(path.join(shared, "sub"), { recursive: true });
  await mkdir(secret);
  await writeFile(path.join(shared, "sub", "nota.txt"), "contenido " + "x".repeat(25000));
  await writeFile(path.join(secret, "clave.txt"), "no");
  await symlink(secret, path.join(shared, "enlace"), "junction");
  store.put("folders", { id: "f1", path: shared, label: "Compartida", botIds: ["nora"], access: "lee" });
  const m = runtime.create({ prompt: "x" });
  const step = runtime.steps(m.id)[0];
  const mission = store.get("missions", m.id);
  const run = (name, args, botId = "nora") =>
    runtime.tool(mission, { ...step, botId }, { name, arguments: JSON.stringify(args), call_id: "c" }, new AbortController().signal, "fixture");
  assert.deepEqual((await run("list_folder", { folderId: "", path: "" })).folders.map((f) => f.id), ["f1"]);
  const listing = await run("list_folder", { folderId: "f1", path: "" });
  assert.deepEqual(listing.entries.map((e) => e.name).sort(), ["sub"]);
  const page = await run("read_folder_file", { folderId: "f1", path: "sub/nota.txt", page: 2 });
  assert.equal(page.page, 2);
  assert.equal(page.pages, 2);
  assert.match((await run("read_folder_file", { folderId: "f1", path: "../secret/clave.txt", page: 1 })).error, /no permitida/);
  assert.match((await run("read_folder_file", { folderId: "f1", path: "enlace/clave.txt", page: 1 })).error, /simbolicos/);
  assert.match((await run("read_folder_file", { folderId: "f1", path: "C:/Windows/win.ini", page: 1 })).error, /no permitida/);
  assert.match((await run("list_folder", { folderId: "f1", path: "" }, "vera")).error, /acceso/);
});

test("search_history finds past missions with date and room", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("Las ventas de octubre subieron un 8 %"));
  const old = runtime.create({ prompt: "Resumen de ventas de octubre", title: "Ventas octubre" });
  await runtime.launch(old.id);
  const m = runtime.create({ prompt: "Otra cosa" });
  const step = runtime.steps(m.id)[0];
  const res = await runtime.tool(store.get("missions", m.id), step, { name: "search_history", arguments: JSON.stringify({ query: "ventas octubre" }), call_id: "c" }, new AbortController().signal, "fixture");
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].room, "ventas-octubre");
  assert.match(res.results[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(res.results.every((r) => r.missionId === old.id));
});

test("monthly limit pauses the mission with a clear message; usage is recorded", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok", { input_tokens: 600, output_tokens: 500 }));
  const { monthTokens } = await import("../server/usage.mjs");
  store.patch("settings", "main", { limits: { monthlyTokens: 1000, pauseAtLimit: true, warnAt80: true } });
  const first = runtime.create({ prompt: "uno" });
  await runtime.launch(first.id);
  assert.equal(store.get("missions", first.id).status, "completed");
  assert.equal(monthTokens(store), 1100);
  assert.ok(store.events(first.id).some((e) => e.type === "usage_warning"));
  const second = runtime.create({ prompt: "dos" });
  await runtime.launch(second.id);
  assert.equal(store.get("missions", second.id).status, "paused");
  assert.match(store.get("missions", second.id).error, /límite mensual del espacio/);
});

test("thinking maps to reasoning effort; instructions use the bot SOUL and personality", async (t) => {
  let request;
  const { store, runtime } = await fixture(t, async (r) => { request = r; return answer("ok"); });
  store.patch("bots", "nora", { thinking: "profundo", personality: { tono: 90, detalle: 10, riesgo: 50 } });
  store.put("memories", { id: "m1", text: "Prefiere tablas", scope: "equipo", source: "dijiste", active: true });
  const m = runtime.create({ prompt: "Hola" });
  await runtime.launch(m.id);
  assert.deepEqual(request.reasoning, { effort: "high" });
  assert.match(request.instructions, /Nora, investigación en el equipo de Colmena/i);
  assert.match(request.instructions, /Actúa y te avisa/);
  assert.match(request.instructions, /Tono cercano/);
  assert.match(request.instructions, /Breve/);
  assert.match(request.instructions, /Prefiere tablas/);
});

test("debate: choosing two proposals makes Atlas combine them", async (t) => {
  const { store, runtime } = await fixture(t, async ({ input }) =>
    answer(/Combina/.test(input.at(-1).content) ? "Fusion final" : "Propuesta"));
  const m = runtime.create({ prompt: "Logo", mode: "debate", botIds: ["iris", "vera"] });
  await runtime.launch(m.id);
  runtime.choose(m.id, ["iris", "vera"]);
  await settle(runtime);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.result, "Fusion final");
  assert.deepEqual(mission.chosenBotIds, ["iris", "vera"]);
  assert.equal(runtime.steps(m.id).at(-1).key, "combine");
});

test("pauseAll/resumeAll, thread hints and chat members", async (t) => {
  let gate;
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input, signal }) => {
    seen.push(JSON.stringify(input));
    if (!gate) return new Promise((_, reject) => { gate = true; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    return answer("ok");
  });
  const m = runtime.create({ prompt: "Largo", conversation: true });
  const job = runtime.launch(m.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runtime.pauseAll(), 1);
  await job;
  assert.equal(store.get("missions", m.id).status, "paused");
  assert.equal(store.get("settings", "main").paused, true);
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "paused");
  runtime.threadHint(m.id, "Céntrate en Madrid");
  assert.equal(runtime.resumeAll(), 1);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.match(seen.at(-1), /Céntrate en Madrid/);
  runtime.addMember(m.id, "tomas");
  assert.deepEqual(store.get("missions", m.id).botIds, ["nora", "tomas"]);
  runtime.addMessage(m.id, "@Tomás ¿y las cifras?");
  await settle(runtime);
  assert.equal(runtime.steps(m.id).at(-1).botId, "tomas");
  // Chat turns carry the conversation history.
  assert.match(seen.at(-1), /Largo/);
  assert.equal(store.list("artifacts").length, 0);
});
