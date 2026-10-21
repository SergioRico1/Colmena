import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { leavesWorkUndone } from "../server/runtime.mjs";
import { AppTools, slimAppResult, tabulate } from "../server/apptools.mjs";

test("an answer that only says what is left to do is recognised", () => {
  for (const text of [
    "Para calcular la facturación completa sin duplicar pedidos, tengo que revisar los mensajes restantes y sumar el total de cada pedido único.",
    "No puedo calcular todavía el total de los pedidos restantes.",
    "Faltaría revisar los otros 78 correos.",
    "Si quieres, reviso el resto y te digo el total.",
    "He mirado dos. Voy a revisar los demás.",
  ]) assert.ok(leavesWorkUndone(text), text);
  for (const text of [
    "En los últimos 30 días se facturaron 3.245,10 € en 41 pedidos únicos.",
    "¿Quieres que envíe el correo a Oriol?",
    "Hecho: he creado el evento el martes a las 10:00.",
  ]) assert.ok(!leavesWorkUndone(text), text);
});

test("a bot that stops at «tengo que revisar…» is told to do it and the answer you get is the finished one", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input, reasoning }) => {
    seen.push(reasoning?.effort || null);
    const nudged = input.some((x) => x.role === "user" && /No termines diciendo lo que falta/.test(String(x.content)));
    return nudged ? answer("Total: 3.245,10 € en 41 pedidos.") : answer("He visto dos pedidos. Para calcular el total tengo que revisar los mensajes restantes.");
  });
  const m = runtime.create({ prompt: "¿Cuánto se facturó?", mode: "solo", botIds: ["vera"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  const said = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant").map((x) => x.text);
  assert.deepEqual(said, ["Total: 3.245,10 € en 41 pedidos."]);
  const step = runtime.steps(m.id)[0];
  assert.equal(step.finishNudges, 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[1], "medium");
});

test("only once: a real blocker said again reaches you", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("No puedo calcular todavía el total: tengo que revisar los correos y la app no responde."));
  const m = runtime.create({ prompt: "¿Cuánto se facturó?", mode: "solo", botIds: ["vera"], conversation: true });
  await runtime.launch(m.id);
  await settle(runtime);
  const said = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant");
  assert.equal(said.length, 1);
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("tabulate: one row per order, what each copy knows is kept, sums are exact", () => {
  const rows = [
    { pedido: "#1001", total: "45,90 €", estado: "pagado" },
    { pedido: "1001", total: null, estado: "enviado" },
    { pedido: "#1002", total: "1.033,73" },
    { pedido: "#1003", total: null },
  ];
  const { unique, duplicates, totals } = tabulate(rows, { fields: [{ name: "pedido" }, { name: "total", type: "number" }], key: "pedido", sum: ["total"] });
  assert.equal(unique.length, 3);
  assert.equal(duplicates, 1);
  assert.deepEqual(totals.total, { total: 1079.63, con_valor: 2, sin_valor: 1 });
});

test("apps_table pages through Gmail, reads each message and adds up in code", async () => {
  const ids = Array.from({ length: 30 }, (_, i) => "m" + i);
  const reads = [];
  const connections = {
    async call(op, args) {
      if (op === "status") return { configured: true };
      if (op === "accounts") return { items: [{ id: "ca_w", toolkit: "gmail", alias: "Gmail trabajo", status: "ACTIVE" }] };
      if (op === "describe") return args.tool === "GMAIL_FETCH_EMAILS" ? { tool: "GMAIL_FETCH_EMAILS", toolkit: "gmail", input_schema: { type: "object", properties: {} } } : null;
      return {};
    },
    async readNow(mission, step, { tool, arguments_json }) {
      const a = JSON.parse(arguments_json);
      reads.push({ tool, a });
      if (tool === "GMAIL_FETCH_EMAILS") {
        const page = a.page_token ? 1 : 0;
        const slice = ids.slice(page * 20, page * 20 + 20);
        return { ok: true, data: { messages: slice.map((id) => ({ messageId: id })), nextPageToken: page ? null : "p2" } };
      }
      const n = Number(a.message_id.slice(1));
      // Every order sends two emails (confirmation and shipping): 15 orders of 10 €.
      return { ok: true, data: { messageId: a.message_id, subject: "Pedido #" + (100 + Math.floor(n / 2)), messageText: "Gracias por tu compra. Total: 10,00 €" } };
    },
  };
  const tools = new AppTools(connections);
  await tools.refresh();
  const runtime = {
    availableModels: () => [{ slug: "gpt-6-luna" }],
    setActivity() {},
    async infer({ input }) {
      const text = input[0].content;
      const filas = [...text.matchAll(/### Elemento (\d+)\n(.*)/g)].map(([, i, body]) => ({ i: Number(i), cuenta: true, pedido: /Pedido #(\d+)/.exec(body)?.[1], total: "10,00" }));
      return { text: JSON.stringify({ filas }) };
    },
  };
  const table = tools.list({}, {}, runtime).find((x) => x.name === "apps_table");
  assert.ok(table, "apps_table is offered with a connected app");
  const out = await table.run(
    { tool: "gmail_fetch_emails", arguments: { query: "from:hola@lumbrehome.com" }, fields: [{ name: "pedido" }, { name: "total", type: "number" }], key: "pedido", sum: ["total"] },
    { mission: { id: "m" }, step: { id: "s", botId: "vera" }, call: { call_id: "c" }, signal: null, runtime },
  );
  assert.equal(out.leidos, 30);
  assert.equal(out.unicos, 15);
  assert.equal(out.duplicados_quitados, 15);
  assert.equal(out.totales.total.total, 150);
  assert.equal(reads.filter((r) => r.tool === "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID").length, 30);
  assert.ok(reads.filter((r) => r.tool === "GMAIL_FETCH_EMAILS").every((r) => r.a.max_results <= 25 && r.a.include_payload === false));
});

test("a long email keeps its totals when the text is cut", () => {
  const body = "Hola Marina, gracias por tu pedido. " + "Texto legal y de marketing. ".repeat(400) + "\nPedido nº 40017\nTotal: 45,90 €\n" + "Pie de página. ".repeat(200);
  const slim = slimAppResult({ ok: true, data: { messages: Array.from({ length: 80 }, (_, i) => ({ messageId: "m" + i, messageText: body })) } });
  const text = JSON.stringify(slim);
  assert.ok(text.length <= 18500, String(text.length));
  assert.match(text, /Total: 45,90 €/);
  assert.doesNotMatch(text, /"preview"/);
});

test("apps_table takes short facts, not whole bodies, and adds up amounts on its own", async () => {
  const connections = {
    async call(op, args) {
      if (op === "status") return { configured: true };
      if (op === "accounts") return { items: [{ id: "ca_w", toolkit: "gmail", alias: "Gmail trabajo", status: "ACTIVE" }] };
      if (op === "describe") return args.tool === "GMAIL_FETCH_EMAILS" ? { tool: "GMAIL_FETCH_EMAILS", toolkit: "gmail", input_schema: { type: "object", properties: {} } } : null;
      return {};
    },
    async readNow() {
      return { ok: true, data: { messages: [1, 2, 3].map((n) => ({ messageId: "m" + n, subject: "Pedido #" + n, messageText: "Nuevo pedido. Total: 10,50 €" })) } };
    },
  };
  const tools = new AppTools(connections);
  await tools.refresh();
  const runtime = {
    availableModels: () => [{ slug: "gpt-6-luna" }], setActivity() {},
    async infer({ input }) {
      const filas = [...input[0].content.matchAll(/### Elemento (\d+)/g)].map(([, i]) => ({ i: Number(i), cuenta: true, pedido: "#" + i, total: "10,50" }));
      return { text: JSON.stringify({ filas }) };
    },
  };
  const table = tools.list({}, {}, runtime).find((x) => x.name === "apps_table");
  const out = await table.run({ tool: "gmail_fetch_emails", fields: [{ name: "body" }, { name: "pedido" }, { name: "total" }], key: "pedido" }, { mission: { id: "m" }, step: { id: "s", botId: "vera" }, call: { call_id: "c" }, runtime });
  assert.deepEqual(out.campos_omitidos, ["body"]);
  assert.equal(out.totales.total.total, 31.5);
  const none = await table.run({ tool: "gmail_fetch_emails", fields: [{ name: "body" }] }, { mission: { id: "m" }, step: { id: "s", botId: "vera" }, call: { call_id: "c" }, runtime });
  assert.match(none.error, /datos concretos/);
});

test("a total from a table that said INCOMPLETO is not passed off as the whole period", async () => {
  const { partialTableUnsaid } = await import("../server/runtime.mjs");
  const history = [
    { type: "function_call", name: "apps_table", call_id: "t1", arguments: "{}" },
    { type: "function_call_output", call_id: "t1", output: JSON.stringify({ aviso: "INCOMPLETO: la búsqueda tiene más de 300 elementos y solo he leído los 300 más recientes (solo del 2026-10-16 al 2026-10-18)." }) },
  ];
  assert.equal(partialTableUnsaid(history, "En los últimos 30 días se facturaron 3.472,34 € en 8 pedidos."), true);
  assert.equal(partialTableUnsaid(history, "Solo he podido leer del 16 al 18 de octubre: 3.472,34 €, un total parcial."), false);
  assert.equal(partialTableUnsaid([], "Total: 10 €"), false);
});

test("what it asks to add up or group by is extracted even if it only named it in «sum» or «key»", async () => {
  const connections = {
    async call(op, args) {
      if (op === "status") return { configured: true };
      if (op === "accounts") return { items: [{ id: "ca_w", toolkit: "gmail", alias: "Gmail trabajo", status: "ACTIVE" }] };
      if (op === "describe") return args.tool === "GMAIL_FETCH_EMAILS" ? { tool: "GMAIL_FETCH_EMAILS", toolkit: "gmail", input_schema: { type: "object", properties: {} } } : null;
      return {};
    },
    async readNow() { return { ok: true, data: { messages: [1, 2, 2].map((n) => ({ messageId: "m" + Math.random(), subject: "[APP] Pedido #" + n, messageText: "Total: 20 €" })) } }; },
  };
  const tools = new AppTools(connections);
  await tools.refresh();
  let asked = "";
  const runtime = {
    availableModels: () => [{ slug: "gpt-6-luna" }], setActivity() {},
    async infer({ input, instructions }) {
      asked = instructions;
      const filas = [...input[0].content.matchAll(/### Elemento (\d+)\n.*Pedido #(\d)/g)].map(([, i, n]) => ({ i: Number(i), cuenta: true, asunto: "x", importe: "20", "número de pedido": n }));
      return { text: JSON.stringify({ filas }) };
    },
  };
  const table = tools.list({}, {}, runtime).find((x) => x.name === "apps_table");
  const out = await table.run({ tool: "gmail_fetch_emails", fields: [{ name: "asunto" }, { name: "cuerpo", description: "importe y número de pedido" }], sum: ["importe"], key: "número de pedido" }, { mission: { id: "m" }, step: { id: "s", botId: "vera" }, call: { call_id: "c" }, runtime });
  assert.match(asked, /importe/);
  assert.equal(out.unicos, 2, JSON.stringify(out));
  assert.equal(out.totales.importe.total, 40);
});

test("a page the service cut down to a preview is asked again smaller, not taken as empty", async () => {
  const sizes = [];
  const connections = {
    async call(op, args) {
      if (op === "status") return { configured: true };
      if (op === "accounts") return { items: [{ id: "ca_w", toolkit: "gmail", alias: "Gmail trabajo", status: "ACTIVE" }] };
      if (op === "describe") return args.tool === "GMAIL_FETCH_EMAILS" ? { tool: "GMAIL_FETCH_EMAILS", toolkit: "gmail", input_schema: { type: "object", properties: {} } } : null;
      return {};
    },
    async readNow(m, s, { arguments_json }) {
      const a = JSON.parse(arguments_json);
      sizes.push(a.max_results);
      if (a.max_results > 6) return { ok: true, data: { preview: "{\"messages\":[…", truncated: true } };
      return { ok: true, data: { messages: [{ messageId: "m1", subject: "Pedido #1", messageText: "Total: 5 €" }] } };
    },
  };
  const tools = new AppTools(connections);
  await tools.refresh();
  const runtime = { availableModels: () => [{ slug: "gpt-6-luna" }], setActivity() {}, async infer() { return { text: JSON.stringify({ filas: [{ i: 0, cuenta: true, pedido: "1", total: "5" }] }) }; } };
  const table = tools.list({}, {}, runtime).find((x) => x.name === "apps_table");
  const out = await table.run({ tool: "gmail_fetch_emails", fields: [{ name: "pedido" }, { name: "total", type: "number" }] }, { mission: { id: "m" }, step: { id: "s", botId: "vera" }, call: { call_id: "c" }, runtime });
  assert.deepEqual(sizes, [25, 12, 6]);
  assert.equal(out.leidos, 1);
});
