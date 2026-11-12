import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { Scheduler } from "../server/scheduler.mjs";
import { createApp } from "../server/app.mjs";
import { splitTools } from "../server/tool-search.mjs";
import { toolCard } from "../server/state.mjs";
import { makeOrigin } from "../server/origin.mjs";
import { fixture, answer, call, settle, outputs } from "./fixtures/runtime-fixture.mjs";
import {
  BLOCK_LIMITS, BLOCK_TOOLS, STALE_MS, attachBlockTools, blockByKey, blockExtraTools, blockView, blocksPromoted, deltaOf, deleteBlock, isStale, moveBlock,
  nextHistory, notPlain, orderBlocks, parseSpec, pinBlock, pinnedBlocksState, safeUrl, sparkOf, staleAfter, usualInterval, watchBlocks,
} from "../server/blocks.mjs";

const HOUR = 3600_000, DAY = 24 * HOUR;
const kpi = (value, extra = {}) => ({ type: "kpi", label: "Ventas", value, unit: "€", ...extra });
const post = (args, id = "b1") => call("block_post", { where: "chat", ...args }, id);

/** A runtime with the block tools and a scripted model: each call takes the next reply of `queue`. */
async function withBlocks(t, options) {
  const queue = [], seen = [];
  const f = await fixture(t, async ({ input }) => {
    seen.push(outputs(input));
    return queue.shift() ?? answer("Hecho.");
  }, options);
  attachBlockTools(f.runtime);
  const run = async (mission, ...replies) => {
    queue.push(...replies);
    await f.runtime.launch(mission.id);
    await settle(f.runtime);
    return seen.at(-1);
  };
  const say = async (mission, text, ...replies) => {
    queue.push(...replies);
    await f.runtime.addMessage(mission.id, text);
    await settle(f.runtime);
    return seen.at(-1);
  };
  return { ...f, queue, seen, run, say };
}
const chatOf = (store, missionId) => store.where("messages", "missionId", missionId);

// ---------------------------------------------------------------- the spec
test("spec: the five types pass and come back normalised", () => {
  assert.deepEqual(parseSpec({ type: "kpi", label: " Ventas de ayer ", value: 1234.5, unit: "€", upIsGood: true, asOf: "2026-11-11", sparkline: [1, 2, 3], url: "https://tienda.test/ventas" }),
    { type: "kpi", label: "Ventas de ayer", value: 1234.5, unit: "€", upIsGood: true, asOf: "2026-11-11T00:00:00.000Z", sparkline: [1, 2, 3], url: "https://tienda.test/ventas" });
  assert.deepEqual(parseSpec({ type: "list", rows: [{ label: "Web", value: "Arriba", status: "OK" }, { label: "Pagos", value: 3, status: "Atención" }] }).rows.map((r) => r.status), ["ok", "atencion"]);
  assert.equal(parseSpec({ type: "table", columns: ["Cliente", "Total"], rows: [["Acme", 10], ["Beta", null]] }).rows.length, 2);
  assert.deepEqual(parseSpec({ type: "progress", label: "Facturas", value: 7, max: 12 }), { type: "progress", label: "Facturas", value: 7, max: 12 });
  assert.deepEqual(parseSpec({ type: "status", label: "Despliegue", state: "fallo", note: "Falló el paso 3" }), { type: "status", label: "Despliegue", state: "fallo", note: "Falló el paso 3" });
  // Comparisons are not HTML.
  assert.equal(parseSpec({ type: "status", label: "Latencia < 200 ms y > 99 %", state: "ok" }).label, "Latencia < 200 ms y > 99 %");
});

test("spec: HTML, scripts and Markdown links are refused; text stays plain", () => {
  const bad = (spec, re) => assert.throws(() => parseSpec(spec), re);
  bad(kpi(1, { label: "<b>Ventas</b>" }), /sin HTML/);
  bad(kpi(1, { label: "Ventas<script>alert(1)</script>" }), /sin HTML/);
  bad({ type: "status", label: "Web", state: "ok", note: "<img src=x onerror=alert(1)>" }, /sin HTML/);
  bad({ type: "list", rows: [{ label: "Ver", value: "[pulsa](https://malo.test)" }] }, /Markdown/);
  bad({ type: "list", rows: [{ label: "javascript:alert(1)" }] }, /solo texto/);
  bad({ type: "table", columns: ["A"], rows: [["&#x3c;script&#x3e;"]] }, /sin HTML/);
  bad({ type: "status", label: "Con\u0007campana", state: "ok" }, /caracteres de control/);
  assert.equal(notPlain("Ventas de ayer: 1.234 € (+3 %)"), null);
});

test("spec: unknown types and fields, sizes and shapes are refused with what to fix", () => {
  const bad = (spec, re) => assert.throws(() => parseSpec(spec), re);
  bad({ type: "chart", series: [] }, /Tipo de bloque desconocido.*kpi, list, table, progress, status/);
  bad({ type: "constructor" }, /desconocido/);
  bad(null, /objeto/);
  bad(kpi(1, { onClick: "borrar" }), /no admite «onClick»/);
  bad(kpi(1, { action: { tool: "send_email" } }), /no admite «action»/);
  bad({ type: "list", rows: [{ label: "A", button: "Pagar" }] }, /no admite «button»/);
  bad(kpi("1.234 €"), /«value»/);
  bad(kpi(Infinity), /«value»/);
  bad(kpi(1, { label: "x".repeat(BLOCK_LIMITS.label + 1) }), /demasiado largo/);
  bad(kpi(1, { sparkline: Array.from({ length: 31 }, (_, i) => i) }), /«sparkline»/);
  bad({ type: "list", rows: Array.from({ length: 11 }, (_, i) => ({ label: "Fila " + i })) }, /«rows»/);
  bad({ type: "list", rows: [] }, /«rows»/);
  bad({ type: "table", columns: ["1", "2", "3", "4", "5", "6", "7"], rows: [] }, /«columns»/);
  bad({ type: "table", columns: ["A"], rows: Array.from({ length: 21 }, () => ["x"]) }, /«rows»/);
  bad({ type: "table", columns: ["A", "B"], rows: [["solo una"]] }, /tantas celdas como columnas/);
  bad({ type: "progress", label: "x", value: 1, max: 0 }, /«max»/);
  bad({ type: "status", label: "x", state: "verde" }, /ok, atencion o fallo/);
  bad(kpi(1, { asOf: "ayer" }), /fecha ISO/);
  // Many long cells: each fits, the whole does not.
  bad({ type: "table", columns: ["A", "B", "C", "D", "E", "F"], rows: Array.from({ length: 20 }, () => Array(6).fill("x".repeat(110))) }, /demasiado grande/);
});

test("spec: links are http or https, without credentials", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///C:/Windows/win.ini", "ftp://sitio.test/a", "//sitio.test", "https://ana:clave@sitio.test/", "notaurl", "https://sitio.test/a b", "colmena://abrir"]) {
    assert.equal(safeUrl(url), null, url);
    assert.throws(() => parseSpec(kpi(1, { url })), /http o https|sin HTML|solo texto/, url);
    assert.throws(() => parseSpec({ type: "list", rows: [{ label: "A", url }] }), /http o https|sin HTML|solo texto/, url);
  }
  assert.equal(safeUrl("https://sitio.test/informe?mes=10"), "https://sitio.test/informe?mes=10");
  assert.equal(parseSpec({ type: "list", rows: [{ label: "A", url: "http://sitio.test" }] }).rows[0].url, "http://sitio.test/");
});

// ---------------------------------------------------------------- history, delta, stale
test("history keeps one entry per run, capped; the delta and the sparkline come from it", () => {
  let h = nextHistory([], 10, { at: "2026-11-10T08:00:00.000Z", run: "a" });
  h = nextHistory(h, 12, { at: "2026-11-10T08:01:00.000Z", run: "a" }); // the same run again replaces its entry
  assert.deepEqual(h.map((x) => x.value), [12]);
  h = nextHistory(h, 9, { at: "2026-11-11T08:00:00.000Z", run: "b" });
  assert.deepEqual(h.map((x) => x.value), [12, 9]);
  for (let i = 0; i < 40; i++) h = nextHistory(h, i, { run: "r" + i });
  assert.equal(h.length, BLOCK_LIMITS.history);
  assert.equal(h.at(-1).value, 39);
  assert.deepEqual(nextHistory(h, null), [], "a block without a tracked number keeps no history");

  const two = [{ value: 200 }, { value: 150 }];
  assert.deepEqual(deltaOf(kpi(150), two), { previous: 200, change: -50, percent: -25, direction: "down", good: false });
  assert.deepEqual(deltaOf(kpi(150, { upIsGood: false }), two), { previous: 200, change: -50, percent: -25, direction: "down", good: true });
  assert.equal(deltaOf(kpi(150), [{ value: 150 }]), null, "nothing to compare with");
  assert.deepEqual(deltaOf(kpi(150, { previous: 100 }), two), { previous: 100, change: 50, percent: 50, direction: "up", good: true }, "the spec's own previous wins");
  assert.deepEqual(deltaOf(kpi(5, { previous: 5 }), []), { previous: 5, change: 0, percent: 0, direction: "flat", good: null });
  assert.equal(deltaOf(kpi(5, { previous: 0 }), []).percent, null);
  assert.equal(deltaOf({ type: "progress", label: "x", value: 1, max: 2 }, two), null);
  assert.deepEqual(sparkOf(kpi(3), [{ value: 1 }, { value: 2 }, { value: 3 }]), [1, 2, 3]);
  assert.deepEqual(sparkOf(kpi(3, { sparkline: [7, 8] }), [{ value: 1 }, { value: 2 }]), [7, 8]);
  assert.equal(sparkOf(kpi(3), [{ value: 3 }]), null);
});

test("stale: twice the routine's usual interval, else 48 h", () => {
  const from = new Date(2026, 10, 12, 7, 0).getTime(); // Thursday 12 Nov 2026, 07:00
  const daily = { trigger: { type: "dia", config: { hora: "08:00", dias: [0, 1, 2, 3, 4, 5, 6], festivo: "igual" } } };
  const weekdays = { trigger: { type: "dia", config: { hora: "08:00", dias: [1, 2, 3, 4, 5], festivo: "igual" } } };
  const every = { trigger: { type: "cada", config: { cadaN: 2, cadaUnidad: "horas" } } };
  assert.equal(usualInterval(daily, { from }), DAY);
  assert.equal(usualInterval(weekdays, { from }), 3 * DAY, "the longest gap (Friday to Monday), so Monday morning is not stale");
  assert.equal(usualInterval(every, { from }), 2 * HOUR);
  assert.equal(usualInterval({ trigger: { type: "correo", config: {} } }, { from }), null, "an event rule has no schedule");
  assert.equal(usualInterval({ trigger: { type: "vez", config: { vezFecha: "2027-01-01", vezHora: "09:00" } } }, { from }), null);
  assert.equal(usualInterval(null), null);
  assert.equal(staleAfter(DAY), 2 * DAY);
  assert.equal(staleAfter(null), STALE_MS);
  assert.equal(STALE_MS, 48 * HOUR);
  const at = new Date(from).toISOString();
  assert.equal(isStale(at, 2 * DAY, from + 2 * DAY - 1000), false);
  assert.equal(isStale(at, 2 * DAY, from + 2 * DAY + 1000), true);
  assert.equal(isStale(at, 0, from + STALE_MS + 1000), true, "no figure: 48 h");
});

// ---------------------------------------------------------------- the bots' tools
test("block_post creates a card where it is posted; the same key updates it in place, with one quiet line per run", async (t) => {
  const { store, runtime, run, say } = await withBlocks(t);
  const m = runtime.create({ prompt: "Déjame las ventas de ayer", mode: "solo", botIds: ["nora"], conversation: true });
  const [first] = await run(m, post({ key: "Ventas Ayer", title: "Ventas de ayer", spec: kpi(1200) }));
  assert.deepEqual([first.saved, first.created, first.key, first.pinned], [true, true, "ventas-ayer", false]);
  const block = blockByKey(store, "ventas-ayer");
  assert.deepEqual([block.botId, block.missionId, block.automationId, block.title], ["nora", m.id, null, "Ventas de ayer"]);
  const card = store.get("messages", "block:" + block.id);
  assert.deepEqual([card.missionId, card.kind, card.role, card.botId], [m.id, "block", "system", "nora"]);
  assert.equal(chatOf(store, m.id).filter((x) => x.kind === "block").length, 1);

  // A later turn: the same card, one «Actualizado» line, no second card.
  const before = chatOf(store, m.id).length;
  const [second] = await say(m, "Actualízalo", post({ key: "ventas-ayer", title: "Ventas de ayer", spec: kpi(1500) }, "b2"), post({ key: "ventas-ayer", title: "Ventas de ayer", spec: kpi(1550) }, "b3"));
  assert.deepEqual([second.saved, second.created, second.previous, second.id], [true, false, 1200, block.id]);
  assert.match(second.notice, /no se ha publicado otra/);
  const after = store.get("blocks", block.id);
  assert.equal(after.spec.value, 1550);
  assert.deepEqual(after.history.map((h) => h.value), [1200, 1550], "two updates in one run are one history entry");
  assert.equal(store.list("blocks").length, 1);
  const chat = chatOf(store, m.id);
  assert.equal(chat.filter((x) => x.kind === "block").length, 1, "still one card");
  const notes = chat.filter((x) => x.kind === "activity" && /^Actualizado/.test(x.text));
  assert.deepEqual(notes.map((x) => x.text), ["Actualizado «Ventas de ayer»"], "one line for the run, although it updated twice");
  // The person's message, the bot's answer and the quiet line: nothing else was added.
  assert.equal(chat.length - before, 3);
  const view = blockView(store, after);
  assert.deepEqual([view.delta.change, view.delta.direction, view.delta.good, view.sparkline], [350, "up", true, [1200, 1550]]);
  assert.deepEqual([view.source.botName, view.source.gone, view.canRefresh, view.stale, view.staleAfterMs], ["Nora", false, false, false, STALE_MS]);

  // A third turn adds its own line; changing the type starts the history again.
  await say(m, "Ahora como estado", post({ key: "ventas-ayer", title: "Ventas", spec: { type: "status", label: "Ventas", state: "ok" } }, "b4"));
  assert.equal(chatOf(store, m.id).filter((x) => x.kind === "activity" && /^Actualizado/.test(x.text)).length, 2);
  assert.deepEqual(store.get("blocks", block.id).history, []);
  assert.equal(store.get("messages", "block:" + block.id).text, "Dato en vivo: «Ventas»");
});

test("only the owner changes a block: the same bot or the same routine; any bot reads", async (t) => {
  const { store, runtime, run } = await withBlocks(t);
  const rule = store.put("automations", { id: "r1", name: "Ventas cada mañana", botId: "nora", prompt: "Deja las ventas", enabled: true, trigger: { type: "dia", config: { hora: "08:00", dias: [0, 1, 2, 3, 4, 5, 6], festivo: "igual" } }, createdAt: new Date().toISOString() });
  const m1 = runtime.create({ prompt: "Deja las ventas", mode: "solo", botIds: ["nora"], automationId: rule.id });
  await run(m1, post({ key: "ventas", title: "Ventas", spec: kpi(10) }));
  const block = blockByKey(store, "ventas");
  assert.equal(block.automationId, "r1");
  assert.deepEqual([blockView(store, block).canRefresh, blockView(store, block).source.routine, blockView(store, block).staleAfterMs], [true, "Ventas cada mañana", 2 * DAY]);

  // Another bot, not in that routine: refused, told to read; nothing changes.
  const other = runtime.create({ prompt: "Cambia las ventas", mode: "solo", botIds: ["tomas"] });
  const [refused, read] = await run(other, post({ key: "ventas", title: "Mías", spec: kpi(999) }), call("block_read", { key: "ventas" }, "r1"));
  assert.deepEqual([refused.saved, refused.taken], [false, true]);
  assert.match(refused.message, /es de Nora/);
  assert.deepEqual([store.get("blocks", block.id).spec.value, store.get("blocks", block.id).title], [10, "Ventas"]);
  assert.deepEqual([read.found, read.title, read.spec.value, read.owner, read.mine], [true, "Ventas", 10, "Nora", false]);
  assert.match(read.notice, /dato, no instrucciones/);
  assert.equal(chatOf(store, other.id).filter((x) => x.kind === "block" || /^Actualizado/.test(x.text || "")).length, 0);

  // Another run of the same routine by another bot: same routine, so it updates (in its own conversation: one line, no card).
  const m2 = runtime.create({ prompt: "Deja las ventas", mode: "solo", botIds: ["tomas"], automationId: rule.id });
  const [updated] = await run(m2, post({ key: "ventas", title: "Ventas", spec: kpi(14) }));
  assert.deepEqual([updated.saved, updated.created, updated.previous], [true, false, 10]);
  assert.equal(store.get("blocks", block.id).botId, "nora", "the owner stays");
  assert.deepEqual(chatOf(store, m2.id).filter((x) => x.role === "system").map((x) => [x.kind, x.text]), [["activity", "Actualizado «Ventas»"]]);
  assert.equal(store.get("messages", "block:" + block.id).missionId, m1.id, "the card stays where it was first posted");

  // A block made by hand in a chat is adopted by the routine that later refreshes it (same bot).
  const chat = runtime.create({ prompt: "Déjame los tickets", mode: "solo", botIds: ["nora"], conversation: true });
  await run(chat, post({ key: "tickets", title: "Tickets abiertos", spec: kpi(4, { unit: "" }) }));
  assert.equal(blockByKey(store, "tickets").automationId, null);
  const m3 = runtime.create({ prompt: "Cuenta los tickets", mode: "solo", botIds: ["nora"], automationId: rule.id });
  await run(m3, post({ key: "tickets", title: "Tickets abiertos", spec: kpi(6, { unit: "" }) }));
  assert.equal(blockByKey(store, "tickets").automationId, "r1");
  assert.equal(await run(runtime.create({ prompt: "Lee", mode: "solo", botIds: ["nora"] }), call("block_read", { key: "no-existe" }, "r9")).then((o) => o[0].found), false);
});

test("a routine that writes in a room owns its blocks through the message that started the turn", async (t) => {
  const { store, runtime, say } = await withBlocks(t);
  const room = runtime.create({ prompt: "Sala de ventas", mode: "solo", botIds: ["nora"], conversation: true });
  await settle(runtime);
  const origin = makeOrigin({ type: "automation", id: "r7", instruction: "Deja las ventas" });
  store.put("automations", { id: "r7", name: "Ventas", botId: "nora", prompt: "Deja las ventas", enabled: true, trigger: { type: "cada", config: { cadaN: 1, cadaUnidad: "horas" } }, createdAt: new Date().toISOString() });
  // What Scheduler#fire does for «misma»/«sala»: the routine's message, stamped with where it comes from.
  const original = runtime.addMessage.bind(runtime);
  runtime.addMessage = (id, text, files, options) => { const message = original(id, text, files, options); if (message?.id) store.patch("messages", message.id, { automationId: "r7", origin }); return message; };
  await say(room, "Rutina «Ventas»: Deja las ventas", post({ key: "ventas-sala", title: "Ventas", spec: kpi(3) }));
  const block = blockByKey(store, "ventas-sala");
  assert.deepEqual([block.automationId, block.missionId], ["r7", room.id]);
  assert.equal(blockView(store, block).staleAfterMs, 2 * HOUR);
});

test("incognito conversations cannot post blocks; another person's errand gets neither tool", async (t) => {
  const { store, runtime, run } = await withBlocks(t);
  const m = runtime.create({ prompt: "Déjame un dato en el panel", mode: "solo", botIds: ["nora"], conversation: true, incognito: true });
  assert.equal(store.get("missions", m.id).incognito, true);
  const [out] = await run(m, post({ key: "secreto", title: "Secreto", spec: kpi(1) }));
  assert.equal(out.error, "Herramienta no disponible.");
  assert.equal(store.list("blocks").length, 0);
  assert.equal(chatOf(store, m.id).filter((x) => x.kind === "block").length, 0);
  const tools = blockExtraTools(runtime);
  assert.deepEqual(tools(runtime.bot("nora"), { id: "x", incognito: true }).map((x) => x.name), ["block_read"]);
  assert.deepEqual(tools(runtime.bot("nora"), { id: "x", peerErrand: { from: "otra" } }), []);
  assert.deepEqual(tools(runtime.bot("nora"), { id: "x" }).map((x) => x.name), [...BLOCK_TOOLS]);
  // Even called directly, the post refuses.
  const direct = tools(runtime.bot("nora"), { id: "x" }).find((x) => x.name === "block_post");
  const ctx = { mission: store.get("missions", m.id), step: runtime.steps(m.id)[0], bot: runtime.bot("nora"), call: { call_id: "z" } };
  await assert.rejects(direct.run({ key: "secreto", title: "Secreto", spec: kpi(1), where: "chat" }, ctx), /incógnito/);
  await assert.rejects(direct.run({ key: "x", title: "X", spec: kpi(1), where: "chat" }, { ...ctx, mission: { id: m.id, peerErrand: { from: "otra" } } }), /encargo de otra persona/);
  assert.equal(store.list("blocks").length, 0);
});

test("a bad post writes nothing and tells the bot what to fix; extra arguments are refused", async (t) => {
  const { store, runtime, run } = await withBlocks(t);
  const m = runtime.create({ prompt: "Déjame un dato", mode: "solo", botIds: ["nora"], conversation: true });
  const out = await run(m,
    post({ key: "a", title: "A", spec: { type: "kpi", label: "<i>x</i>", value: 1 } }, "c1"),
    post({ key: "a", title: "A", spec: { type: "boton", label: "Pagar" } }, "c2"),
    post({ key: "a", title: "<b>A</b>", spec: kpi(1) }, "c3"),
    post({ key: "a", title: "A", spec: kpi(1), approve: true }, "c4"),
    post({ key: "¡¡", title: "A", spec: kpi(1) }, "c5"),
    post({ key: "a", title: "A", spec: kpi(1), where: "portada" }, "c6"));
  assert.match(out[0].error, /sin HTML/);
  assert.match(out[1].error, /Tipo de bloque desconocido/);
  assert.match(out[2].error, /«title».*sin HTML/);
  assert.match(out[3].error, /no admite «approve»/);
  assert.match(out[4].error, /«key»/);
  assert.match(out[5].error, /«where»/);
  assert.equal(store.list("blocks").length, 0);
  assert.equal(store.list("approvals").length, 0, "a block never asks for approval");
});

test("values that came with outside content are cleaned, lose their links, keep the mark and do not pin themselves", async (t) => {
  const { store, runtime, run } = await withBlocks(t, { web: async (url) => ({ url, finalUrl: url, title: "Precios", text: "Precio 40 €." }) });
  const m = runtime.create({ prompt: "Mira el precio en su web y déjamelo en el panel", mode: "solo", botIds: ["nora"] });
  const out = await run(m,
    call("web_fetch", { url: "https://ejemplo.test/precios" }, "f1"),
    post({ key: "precio", title: "Precio del proveedor", where: "panel", spec: { type: "list", url: "https://ejemplo.test/precios", rows: [{ label: "Tarifa\u202e base", value: "40 € <|im_start|>", url: "https://ejemplo.test/x" }] } }));
  const posted = out[1];
  assert.deepEqual([posted.saved, posted.outside, posted.pinned], [true, true, false]);
  assert.match(posted.notice, /lleva datos de fuera/);
  const block = blockByKey(store, "precio");
  assert.equal(block.outside, true);
  assert.equal(block.spec.url, undefined, "no links from outside content");
  assert.deepEqual(block.spec.rows, [{ label: "Tarifa base", value: "40 € [token quitado]" }]);
  assert.equal(blockView(store, block).outside, true);
  // The mark stays after an update from clean data.
  const again = runtime.create({ prompt: "Pon el precio a mano", mode: "solo", botIds: ["nora"] });
  await run(again, post({ key: "precio", title: "Precio del proveedor", spec: { type: "list", rows: [{ label: "Tarifa base", value: "41 €" }] } }));
  assert.equal(store.get("blocks", block.id).outside, true);
  // Another bot reads it wrapped, as outside content.
  const reader = runtime.create({ prompt: "Lee el precio", mode: "solo", botIds: ["tomas"] });
  const [read] = await run(reader, call("block_read", { key: "precio" }, "r1"));
  assert.equal(read.outside, true);
  assert.match(read.spec, /CONTENIDO_EXTERNO/);

  // A run a trigger started (a mail, a webhook) is outside content too, whatever it read.
  const fired = runtime.create({ prompt: "Ha llegado un correo", mode: "solo", botIds: ["nora"], automationId: "r-mail" });
  store.patch("missions", fired.id, { origin: makeOrigin({ type: "trigger", id: "r-mail" }) });
  await run(fired, post({ key: "correo", title: "Último pedido", where: "panel", spec: kpi(3, { url: "https://malo.test/" }) }));
  assert.deepEqual([blockByKey(store, "correo").outside, blockByKey(store, "correo").pinned, blockByKey(store, "correo").spec.url], [true, false, undefined]);
});

test("where: panel pins the bot's own clean block; what the person unpinned is not put back", async (t) => {
  const { store, runtime, run, say } = await withBlocks(t);
  const m = runtime.create({ prompt: "Déjame el saldo en el panel", mode: "solo", botIds: ["nora"], conversation: true });
  const [out] = await run(m, post({ key: "saldo", title: "Saldo", where: "panel", spec: kpi(5000) }));
  assert.equal(out.pinned, true);
  const block = blockByKey(store, "saldo");
  assert.deepEqual(pinnedBlocksState(store).map((b) => [b.id, b.title, b.type]), [[block.id, "Saldo", "kpi"]]);
  assert.equal(Object.keys(pinnedBlocksState(store)[0]).includes("spec"), false, "the state carries no values");
  pinBlock(store, block.id, false);
  await say(m, "Otra vez", post({ key: "saldo", title: "Saldo", where: "panel", spec: kpi(5100) }, "b2"));
  assert.equal(store.get("blocks", block.id).pinned, false);
  pinBlock(store, block.id, true);
  assert.equal(store.get("blocks", block.id).pinned, true);
});

test("the tool cards say what was posted, updated or read, never the values", () => {
  assert.deepEqual(toolCard("block_post", { key: "ventas", title: "Ventas", spec: kpi(5), where: "chat" }, { saved: true, created: true, id: "b1", key: "ventas", pinned: false }),
    { type: "block", action: "post", key: "ventas", title: "Ventas", kind: "kpi", blockId: "b1", saved: true, pinned: false, outside: false });
  assert.deepEqual(toolCard("block_post", { key: "ventas", title: "Ventas", spec: kpi(6), where: "panel" }, { saved: true, created: false, id: "b1", key: "ventas", pinned: true, outside: true }),
    { type: "block", action: "update", key: "ventas", title: "Ventas", kind: "kpi", blockId: "b1", saved: true, pinned: true, outside: true });
  assert.deepEqual(toolCard("block_post", { key: "ventas", title: "Ventas", spec: { type: "nope" } }, { saved: false, taken: true }).saved, false);
  assert.deepEqual(toolCard("block_read", { key: "ventas" }, { found: true, id: "b1", key: "ventas", title: "Ventas", type: "kpi", spec: kpi(6) }),
    { type: "block", action: "read", key: "ventas", title: "Ventas", kind: "kpi", blockId: "b1", found: true });
  assert.equal(toolCard("block_read", { key: "nada" }, { found: false, key: "nada" }).found, false);
  assert.equal(JSON.stringify(toolCard("block_post", { key: "v", title: "V", spec: kpi(424242) }, { saved: true, created: true, id: "b" })).includes("424242"), false);
});

test("the block tools wait behind find_tools unless the conversation is about a panel or its routine keeps a block", async (t) => {
  const { store, runtime } = await withBlocks(t);
  const many = Array.from({ length: 40 }, (_, i) => ({ type: "function", name: "extra_" + i, description: "Herramienta " + i, parameters: { type: "object", properties: {} } }));
  const quiet = runtime.create({ prompt: "Resume este informe", mode: "solo", botIds: ["nora"] });
  const about = runtime.create({ prompt: "Déjame las ventas de ayer en el panel", mode: "solo", botIds: ["nora"] });
  const routine = runtime.create({ prompt: "Cuenta las ventas", mode: "solo", botIds: ["nora"], automationId: "r1" });
  assert.deepEqual(blocksPromoted(store, quiet.id), []);
  assert.deepEqual(blocksPromoted(store, about.id), [...BLOCK_TOOLS]);
  assert.deepEqual(blocksPromoted(store, routine.id), []);
  const offered = (m) => [...runtime.toolsForStep(store.get("missions", m.id), runtime.steps(m.id)[0], runtime.bot("nora")), ...many];
  assert.ok(BLOCK_TOOLS.every((name) => offered(quiet).some((x) => x.name === name)), "always among the bot's tools");
  const hidden = splitTools(offered(quiet), { promoted: runtime.toolsUsedBefore(runtime.steps(quiet.id)[0]) });
  assert.equal(hidden.active, true);
  assert.ok(BLOCK_TOOLS.every((name) => hidden.deferred.some((x) => x.name === name)), "deferred when a panel is not the subject");
  const shown = splitTools(offered(about), { promoted: runtime.toolsUsedBefore(runtime.steps(about.id)[0]) });
  assert.ok(BLOCK_TOOLS.every((name) => shown.listed.some((x) => x.name === name)), "listed while the person talks about the panel");
  // A routine that already keeps a block gets them listed in its next run.
  store.put("blocks", { id: "bx", key: "ventas", title: "Ventas", spec: kpi(1), botId: "nora", automationId: "r1", missionId: routine.id, createdAt: "2026-11-01T08:00:00.000Z", refreshedAt: "2026-11-01T08:00:00.000Z", history: [] });
  const next = runtime.create({ prompt: "Cuenta las ventas", mode: "solo", botIds: ["nora"], automationId: "r1" });
  assert.deepEqual(blocksPromoted(store, next.id), [...BLOCK_TOOLS]);
  // The definitions take nothing extra; the post lists its four arguments.
  const defs = blockExtraTools(runtime)(runtime.bot("nora"), store.get("missions", about.id));
  for (const tool of defs) assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual(defs.find((x) => x.name === "block_post").parameters.required, ["key", "title", "spec", "where"]);
  assert.equal(defs.find((x) => x.name === "block_post").parameters.properties.spec.additionalProperties, false);
  assert.equal(defs.find((x) => x.name === "block_read").strict, true);
});

// ---------------------------------------------------------------- deletion, pinning, order
async function plain(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-blocks-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return store;
}
const seedBlock = (store, id, extra = {}) => store.put("blocks", { id, key: id, title: "Bloque " + id, spec: kpi(1), botId: "nora", automationId: null, missionId: "m1", createdAt: "2026-11-10T08:00:00.000Z", refreshedAt: "2026-11-10T08:00:00.000Z", history: [], pinned: false, order: null, ...extra });

test("deleting a conversation removes its unpinned blocks; pinned ones stay with their source marked as gone", async (t) => {
  const store = await plain(t);
  watchBlocks(store);
  watchBlocks(store); // once per store
  store.put("missions", { id: "m1", title: "Ventas", status: "completed", createdAt: "2026-11-10T08:00:00.000Z" });
  store.put("missions", { id: "m2", title: "Otra", status: "completed", createdAt: "2026-11-10T08:00:00.000Z" });
  seedBlock(store, "suelto");
  seedBlock(store, "fijado", { pinned: true, order: 0 });
  seedBlock(store, "ajeno", { missionId: "m2" });
  assert.equal(blockView(store, store.get("blocks", "fijado")).source.gone, false);
  store.remove("missions", "m1");
  assert.deepEqual(store.list("blocks").map((b) => b.id).sort(), ["ajeno", "fijado"]);
  const kept = blockView(store, store.get("blocks", "fijado"));
  assert.deepEqual([kept.source.gone, kept.source.missionTitle, kept.pinned], [true, null, true]);
  // Unpinning a block whose conversation is gone removes it: nothing shows it any more.
  assert.equal(pinBlock(store, "fijado", false), null);
  assert.equal(store.get("blocks", "fijado"), null);
  // The person removes a block: its card goes with it.
  store.put("messages", { id: "block:ajeno", missionId: "m2", role: "system", kind: "block", text: "x", at: "2026-11-10T08:00:00.000Z" });
  assert.equal(deleteBlock(store, "ajeno"), true);
  assert.equal(store.get("messages", "block:ajeno"), null);
  assert.equal(deleteBlock(store, "ajeno"), false);
});

test("pin, unpin and reorder: a cap on the panel, order by hand, one place up or down", async (t) => {
  const store = await plain(t);
  store.put("missions", { id: "m1", title: "Ventas", status: "completed", createdAt: "2026-11-10T08:00:00.000Z" });
  for (const id of ["a", "b", "c", "d"]) { seedBlock(store, id); pinBlock(store, id, true); }
  const ids = () => pinnedBlocksState(store).map((b) => b.id);
  assert.deepEqual(ids(), ["a", "b", "c", "d"]);
  moveBlock(store, "c", "up");
  assert.deepEqual(ids(), ["a", "c", "b", "d"]);
  moveBlock(store, "a", "up"); // already first
  moveBlock(store, "d", "down"); // already last
  assert.deepEqual(ids(), ["a", "c", "b", "d"]);
  moveBlock(store, "a", "down");
  assert.deepEqual(ids(), ["c", "a", "b", "d"]);
  orderBlocks(store, ["d", "zzz", "c", "d"]); // unknown and repeated ids are ignored; the rest keep their order
  assert.deepEqual(ids(), ["d", "c", "a", "b"]);
  pinBlock(store, "c", false);
  assert.deepEqual(ids(), ["d", "a", "b"]);
  assert.equal(store.get("blocks", "c").unpinnedByPerson, true);
  assert.throws(() => moveBlock(store, "c", "up"), /no está en el panel/);
  pinBlock(store, "c", true);
  assert.deepEqual(ids(), ["d", "a", "b", "c"], "pinned again goes last");
  for (let i = 0; i < BLOCK_LIMITS.pinned - 4; i++) { seedBlock(store, "x" + i); pinBlock(store, "x" + i, true); }
  seedBlock(store, "uno-mas");
  assert.throws(() => pinBlock(store, "uno-mas", true), /El panel ya tiene 24 bloques/);
  assert.throws(() => pinBlock(store, "no-existe", true), /ya no existe/);
});

// ---------------------------------------------------------------- API
async function api(t, { paused = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-blocks-api-")), store = new Store(directory);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const launched = [];
  const runtime = new Runtime(store, { respond: async () => answer("Hecho.") });
  const launch = runtime.launch.bind(runtime);
  runtime.launch = (id) => { launched.push(id); return paused ? null : launch(id); };
  const scheduler = new Scheduler(store, runtime, () => true, { interval: 3600_000 });
  let origin;
  const server = http.createServer(createApp({ store, runtime, scheduler, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => {
    scheduler.stop();
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const send = (method) => async (route, body = {}) => {
    const r = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const get = async (route) => { const r = await fetch(origin + "/api" + route); return { status: r.status, body: await r.json() }; };
  return { store, runtime, scheduler, launched, post: send("POST"), del: send("DELETE"), get };
}

test("API: list, one block, pin and unpin, reorder, move, delete; /api/state carries only the light pinned list", async (t) => {
  const { store, post: send, del, get } = await api(t);
  store.put("missions", { id: "m1", title: "Ventas", status: "completed", conversation: true, botIds: ["nora"], createdAt: "2026-11-10T08:00:00.000Z" });
  for (const id of ["a", "b", "c"]) seedBlock(store, id, { spec: kpi(id.charCodeAt(0)) });
  store.put("messages", { id: "block:a", missionId: "m1", role: "system", kind: "block", text: "Dato en vivo: «Bloque a»", at: "2026-11-10T08:00:00.000Z" });

  const all = await get("/blocks");
  assert.equal(all.status, 200);
  assert.equal(all.body.blocks.length, 3);
  assert.equal(all.body.limits.pinned, 24);
  assert.deepEqual((await get("/blocks?pinned=1")).body.blocks, []);
  assert.equal((await get("/blocks?missionId=m1")).body.blocks.length, 3);
  assert.equal((await get("/blocks?missionId=nada")).body.blocks.length, 0);
  assert.equal((await get("/blocks?raro=1")).status, 400);
  const one = await get("/blocks/a");
  assert.deepEqual([one.body.key, one.body.type, one.body.spec.value, one.body.source.botName, one.body.canRefresh, one.body.stale], ["a", "kpi", 97, "Nora", false, true]);
  assert.equal((await get("/blocks/nada")).status, 404);

  for (const id of ["a", "b", "c"]) assert.equal((await send("/blocks/" + id + "/pin", { pinned: true })).status, 200);
  const order = async () => (await get("/blocks?pinned=1")).body.blocks.map((b) => b.id);
  assert.deepEqual(await order(), ["a", "b", "c"]);
  assert.deepEqual((await send("/blocks/c/move", { direction: "up" })).body.blocks.map((b) => b.id), ["a", "c", "b"]);
  assert.equal((await send("/blocks/c/move", { direction: "left" })).status, 400);
  assert.deepEqual((await send("/blocks/order", { ids: ["b", "a", "c"] })).body.blocks.map((b) => b.id), ["b", "a", "c"]);
  assert.equal((await send("/blocks/order", { ids: "b" })).status, 400);
  assert.equal((await send("/blocks/a/pin", { pinned: "sí" })).status, 400);
  assert.equal((await send("/blocks/a/pin", { pinned: true, spec: kpi(1) })).status, 400, "the person never changes a block's data here");

  const state = (await get("/state")).body;
  assert.deepEqual(state.blocks.map((b) => b.id), ["b", "a", "c"]);
  assert.deepEqual(Object.keys(state.blocks[0]).sort(), ["id", "title", "type", "updatedAt"]);

  const unpinned = await send("/blocks/a/pin", { pinned: false });
  assert.deepEqual([unpinned.body.block.pinned, unpinned.body.blocks.map((b) => b.id)], [false, ["b", "c"]]);
  assert.equal((await send("/blocks/a/refresh")).status, 409, "no routine, no refresh");
  const gone = await del("/blocks/a");
  assert.deepEqual([gone.status, gone.body.ok], [200, true]);
  assert.equal(store.get("blocks", "a"), null);
  assert.equal(store.get("messages", "block:a"), null, "its card goes too");
  assert.equal((await del("/blocks/a")).status, 404);
  assert.equal((await send("/blocks/a/pin", { pinned: true })).status, 404);
});

test("API: «Actualizar» runs the block's routine now as a real run, and respects the pause and the brakes", async (t) => {
  const { store, runtime, post: send, launched } = await api(t, { paused: true });
  const rule = store.put("automations", { id: "r1", name: "Ventas cada mañana", botId: "nora", prompt: "Deja las ventas de ayer", enabled: true, state: "scheduled", queue: [], trigger: { type: "dia", config: { hora: "08:00", dias: [0, 1, 2, 3, 4, 5, 6], festivo: "igual" } }, createdAt: new Date().toISOString() });
  store.put("missions", { id: "m1", title: "Ventas", status: "completed", createdAt: "2026-11-10T08:00:00.000Z" });
  seedBlock(store, "ventas", { automationId: rule.id });

  const ok = await send("/blocks/ventas/refresh");
  assert.equal(ok.status, 202);
  const run = store.get("missions", ok.body.missionId);
  assert.deepEqual([run.automationId, run.origin.type, run.origin.id, run.title], ["r1", "automation", "r1", "Ventas cada mañana"], "a real run of the routine, marked as self-started (not a «Prueba»)");
  assert.deepEqual(launched, [run.id]);
  assert.equal(store.get("automations", "r1").lastMissionId, run.id);
  // The run is under way: a second press does not start another.
  const busy = await send("/blocks/ventas/refresh");
  assert.equal(busy.status, 409);
  assert.match(busy.body.error, /Ya se está actualizando/);
  assert.equal(launched.length, 1);

  // The whole team is paused: nothing starts.
  store.patch("missions", run.id, { status: "completed" });
  store.patch("settings", "main", { paused: true });
  const paused = await send("/blocks/ventas/refresh");
  assert.equal(paused.status, 409);
  assert.match(paused.body.error, /equipo está en pausa/);
  store.patch("settings", "main", { paused: false });
  // A rule a brake stopped stays stopped.
  store.patch("automations", "r1", { stoppedBy: "loop", enabled: false, error: "Esta regla se ha disparado 3 veces por lo mismo hoy." });
  const stopped = await send("/blocks/ventas/refresh");
  assert.equal(stopped.status, 409);
  assert.match(stopped.body.error, /3 veces/);
  // The routine was deleted: the block has no refresh any more.
  store.remove("automations", "r1");
  assert.equal((await send("/blocks/ventas/refresh")).status, 409);
  assert.deepEqual([blockView(store, store.get("blocks", "ventas")).canRefresh, blockView(store, store.get("blocks", "ventas")).source.routineGone], [false, true]);
  assert.equal(launched.length, 1);
  assert.ok(runtime);
});

test("refreshNow on an event rule goes through the brakes of self-started work", async (t) => {
  const store = await plain(t);
  const created = [];
  const runtime = {
    create(input) { const m = store.put("missions", { id: "m" + (created.length + 1), title: input.title, prompt: input.prompt, automationId: input.automationId, status: "queued", createdAt: new Date().toISOString() }); store.put("messages", { id: "u" + m.id, missionId: m.id, role: "user", text: input.prompt, at: m.createdAt }); created.push(m.id); return m; },
    launch() {},
  };
  const scheduler = new Scheduler(store, runtime, () => true, { interval: 3600_000 });
  t.after(() => scheduler.stop());
  const event = { id: "e1", kind: "webhook", summary: "Despliegue", data: { asunto: "deploy web" } };
  store.put("automations", { id: "r2", name: "Estado del despliegue", botId: "nora", prompt: "Mira el despliegue", enabled: true, state: "scheduled", queue: [], trigger: { type: "webhook", config: {} }, createdAt: new Date().toISOString() });
  assert.throws(() => scheduler.refreshNow("r2"), /Todavía no ha llegado nada/);
  store.patch("automations", "r2", { lastEvent: event });
  const first = scheduler.refreshNow("r2");
  assert.deepEqual([first.origin.type, first.origin.id], ["trigger", "r2"]);
  // The same thing is still open: the open run, not a second one.
  store.patch("missions", first.id, { status: "waiting" });
  assert.throws(() => scheduler.refreshNow("r2"), /esperando tu respuesta/);
  store.patch("missions", first.id, { status: "completed" });
  scheduler.refreshNow("r2");
  store.patch("missions", "m2", { status: "completed" });
  scheduler.refreshNow("r2");
  store.patch("missions", "m3", { status: "completed" });
  // The fourth time for the same thing in a day: the loop limit says no (and does not switch the rule off).
  assert.throws(() => scheduler.refreshNow("r2"), /3 veces hoy por lo mismo/);
  assert.equal(created.length, 3);
  assert.equal(store.get("automations", "r2").enabled, true);
  assert.throws(() => scheduler.refreshNow("nada"), /ya no existe/);
});
