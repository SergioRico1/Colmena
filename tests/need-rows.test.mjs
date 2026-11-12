import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROWS_SHOWN, foldRows, needEntries, needRow } from "../src/components/v3/dia/needRows.js";
import { needsOf } from "../src/components/v2/needs.js";

// Inicio does one thing: «Te necesitan» first, as compact rows (who, what, the primary action).

const NOW = Date.parse("2026-11-12T10:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const read = (file) => readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8");

function state() {
  const g = { key: "k-files", label: "crear archivos" };
  return {
    missions: [
      { id: "m1", title: "Informe", room: "informe", botIds: ["atlas", "vera"], conversation: false, status: "waiting" },
      { id: "m2", title: "Portada", room: "portada", botIds: ["iris"], conversation: false, status: "awaiting_choice", updatedAt: ago(300) },
      { id: "m3", title: "Campaña", room: "campaña", botIds: ["atlas"], conversation: false, status: "awaiting_plan", updatedAt: ago(5) },
    ],
    approvals: [
      { id: "a-send", missionId: "m1", botId: "vera", kind: "send", status: "pending", title: "Enviar", email: { to: ["ana@x.com", "luis@x.com"], subject: "Resumen", body: "Hola." }, createdAt: ago(60) },
      { id: "a-perm", missionId: "m1", botId: "bruno", kind: "permission", status: "pending", title: "Instalar una librería", summary: "Para leer hojas de cálculo.", canAlways: true, createdAt: ago(50) },
      { id: "a-q", missionId: "m1", botId: "tomas", kind: "question", status: "pending", title: "¿Cómo trato las devoluciones?", options: [{ id: "o1", label: "Estímalas" }], createdAt: ago(40) },
      { id: "a-plan", missionId: "m1", botId: "atlas", kind: "plan", status: "pending", title: "Plan para el informe", createdAt: ago(30) },
      { id: "a-f1", missionId: "m1", botId: "nora", kind: "write", status: "pending", title: "Crear «a.md»", group: g, createdAt: ago(20) },
      { id: "a-f2", missionId: "m1", botId: "nora", kind: "write", status: "pending", title: "Crear «b.md»", group: g, createdAt: ago(19) },
      { id: "a-pay", missionId: "m1", botId: "tomas", kind: "permission", status: "pending", redLine: true, title: "Pagar la factura", impact: { tone: "money", headline: "Pagar 120,00 € a Acme" }, createdAt: ago(10) },
    ],
    watchNotes: [{ id: "n1", missionId: "mw", botId: "nora", question: "¿Preparo la factura de Acme?", text: "Vence el día 20.", createdAt: ago(8) }],
    waiting: [
      { kind: "mission", id: "m2", missionId: "m2", roomId: "m2", botId: null, what: "awaiting_choice", at: ago(300) },
      { kind: "approval", id: "a-send", missionId: "m1", botId: "vera", at: ago(60) }, { kind: "approval", id: "a-perm", missionId: "m1", botId: "bruno", at: ago(50) },
      { kind: "approval", id: "a-q", missionId: "m1", botId: "tomas", at: ago(40) }, { kind: "approval", id: "a-plan", missionId: "m1", botId: "atlas", at: ago(30) },
      { kind: "approval", id: "a-f1", missionId: "m1", botId: "nora", at: ago(20) }, { kind: "approval", id: "a-f2", missionId: "m1", botId: "nora", at: ago(19) },
      { kind: "approval", id: "a-pay", missionId: "m1", botId: "tomas", at: ago(10) },
      { kind: "note", id: "n1", missionId: "mw", botId: "nora", at: ago(8) },
      { kind: "errand", id: "e1", missionId: null, roomId: "dm-lucia", botId: "vera", at: ago(6), title: "Lucía pide a Vera: Resume el acta" },
      { kind: "mission", id: "m3", missionId: "m3", roomId: "m3", botId: null, what: "awaiting_plan", at: ago(5) },
      { kind: "note", id: "n-more", missionId: "mw", botId: "nora", at: ago(1) }, // the state lists no record for it
    ],
  };
}

test("the rows are the list of what waits: one per thing, the oldest first, requests of a kind together", () => {
  const needs = needsOf(state(), NOW);
  const entries = needEntries(needs);
  assert.deepEqual(entries.map((e) => [e.type, e.key, e.count]), [
    ["choice", "m2", 1], ["approval", "a-send", 1], ["approval", "a-perm", 1], ["approval", "a-q", 1], ["approval", "a-plan", 1],
    ["group", "grupo:a-f1", 2], ["approval", "a-pay", 1], ["note", "n1", 1], ["errand", "e1", 1], ["choice", "m3", 1], ["item", "n-more", 1],
  ]);
  assert.equal(entries.reduce((n, e) => n + e.count, 0), needs.items.length, "the rows add up to the one count");
});

test("each row says who, what and the action that moves it on", () => {
  const rows = Object.fromEntries(needEntries(needsOf(state(), NOW)).map((e) => [e.key, needRow(e, { botName: "Vera" })]));
  // Ordinary request: approved from the row (with its 10 s to undo).
  assert.deepEqual(rows["a-perm"], { who: "Vera", what: "Instalar una librería", sub: "Para leer hojas de cálculo.", action: { kind: "approve", label: "Aprobar" } });
  // A red line is never approved from a row: its card opens, where it is held and says who it goes to.
  assert.deepEqual(rows["a-send"], { who: "Vera", what: "Enviar «Resumen»", sub: "Para ana@x.com, luis@x.com", action: { kind: "expand", label: "Ver y enviar" } });
  assert.deepEqual(rows["a-pay"].action, { kind: "expand", label: "Ver y pagar" });
  assert.equal(rows["a-pay"].sub, "Pagar 120,00 € a Acme");
  assert.deepEqual(rows["a-q"].action, { kind: "expand", label: "Responder" });
  assert.deepEqual(rows["a-plan"].action, { kind: "link", label: "Revisar el plan", href: "/sala/m1#plan" });
  assert.deepEqual(rows["grupo:a-f1"], { who: "Vera", what: "2 peticiones de Vera: crear archivos", sub: "", action: { kind: "expand", label: "Ver y aprobar" } });
  assert.deepEqual(rows.n1, { who: "Vera", what: "¿Preparo la factura de Acme?", sub: "Vence el día 20.", action: { kind: "expand", label: "Responder" } });
  assert.deepEqual(rows.m2.action, { kind: "link", label: "Ver y elegir", href: "/debate/m2" });
  assert.equal(rows.m3.what, "El plan de «Campaña» espera tu OK");
  assert.deepEqual(rows.e1, { who: "Vera", what: "Lucía pide a Vera: Resume el acta", sub: "", action: { kind: "link", label: "Ver y decidir", href: "/con/dm-lucia" } });
  assert.deepEqual(rows["n-more"].action, { kind: "link", label: "Abrir", href: "/chat/nora?c=mw" });
  assert.equal(needRow({ type: "choice", mission: { id: "x", title: "T", status: "awaiting_plan" } }).who, "Un bot");
});

test("three rows show; «Ver las N» counts every thing that waits; an open row stays", () => {
  const entries = needEntries(needsOf(state(), NOW));
  const folded = foldRows(entries);
  assert.equal(ROWS_SHOWN, 3);
  assert.equal(folded.shown.length, 3);
  assert.equal(folded.label, "Ver las 12");
  assert.deepEqual(foldRows(entries, { open: ["n1"] }).shown.map((e) => e.key), ["m2", "a-send", "a-perm", "n1"]);
  assert.deepEqual([foldRows(entries, { all: true }).shown.length, foldRows(entries, { all: true }).label], [11, "Ver menos"]);
  assert.deepEqual(foldRows(entries.slice(0, 3)), { shown: entries.slice(0, 3), hidden: 0, label: null });
});

test("Inicio: what waits, then the box to ask, then what is under way; the panel and the week moved, not deleted", () => {
  const inicio = read("src/screens/Hoy.jsx");
  const order = ['aria-labelledby="need-t"', 'id="pedir"', 'aria-labelledby="run-t"'].map((s) => inicio.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "order of the blocks");
  assert.equal(/<Panel\b|WeekDigest/.test(inicio), false);
  assert.ok(inicio.includes('href="/panel"'));
  assert.ok(read("src/routes.jsx").includes('{ path: "/panel", screen: "PanelInicio" }'));
  assert.ok(read("src/screens/PanelInicio.jsx").includes("<Panel page />"));
  assert.ok(read("src/screens/Actividad.jsx").includes("<WeekDigest "));
});

test("honey is not a button fill: the primary action is the dark button", () => {
  const fills = (file) => (read(file).match(/<(?:button|a|HoldButton)\b[^>]*background: "#FFC93C"[^>]*>/g) || []);
  for (const file of ["src/components/v2/NeedCard.jsx", "src/components/v3/dia/Needs.jsx", "src/components/v3/dia/NeedRows.jsx", "src/components/room/InlineApprovals.jsx", "src/screens/Hoy.jsx", "src/screens/AjustesSeccion.jsx"]) assert.deepEqual(fills(file), [], file);
  assert.equal(/background: "#FFC93C"[^}]*\}\}>\{"Aprobar plan"\}/.test(read("src/components/room/RoomParts.jsx")), false);
  // The no-account notice and a bot's limit line are system states: neutral.
  assert.equal(/#FFF6DC|#FFC93C/i.test(read("src/components/v3/States.jsx").split("export function StuckBotCard")[0]), false);
  assert.equal(/LimitLine[\s\S]{0,900}#8A5A00/.test(read("src/components/v2/LimitNotice.jsx")), false);
});
