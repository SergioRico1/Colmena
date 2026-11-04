import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRows, kindOfTool, logCsv, logRows, sentenceOf, since } from "../src/components/v3/dia/activityLog.js";

// Actividad's log (src/screens/Actividad.jsx): one row per kind of action in a step, a
// failure on its own row, the requests a bot made you, newest first.
const at = (h) => new Date(2026, 10, 4, h, 0).toISOString();
const web = (status, domain, error = null) => ({ name: "web_fetch", status, error, card: { type: "web", domain } });
const details = [
  {
    id: "m1", title: "Estudio de mercado", room: "estudio", conversation: false, status: "running", botIds: ["nora"],
    steps: [
      { id: "s1", botId: "nora", kind: "work", title: "Fuentes", status: "completed", startedAt: at(15), completedAt: at(16), words: 0, tools: [web("done", "a.es"), web("done", "b.es"), web("error", "ine.es", "503")] },
      { id: "s2", botId: "nora", kind: "work", title: "Resumen", status: "running", startedAt: new Date(2026, 10, 4, 16, 30).toISOString(), tools: [] },
      { id: "old", botId: "nora", kind: "work", title: "Viejo", status: "completed", startedAt: at(1), completedAt: at(2), tools: [] },
    ],
  },
  { id: "m2", title: "Secreto", conversation: true, incognito: true, botIds: ["vera"], status: "completed", steps: [{ id: "x", botId: "vera", status: "completed", completedAt: at(17), tools: [] }] },
];
const approvals = [
  { id: "a1", missionId: "m1", botId: "nora", kind: "send", status: "pending", title: "Enviar", email: { subject: "Informe" }, createdAt: at(17) },
  { id: "a2", missionId: "m1", botId: "nora", kind: "permission", status: "approved", decidedBy: "tú", title: "Pagar", createdAt: at(14) },
];

test("steps become rows: reads grouped, the failure apart, running steps, requests; incognito never shows", () => {
  const rows = logRows({ details, approvals, from: Date.parse(at(12)) });
  const texts = rows.map((r) => r.text);
  assert.deepEqual(texts, [
    "quiere enviar «Informe»",
    "está con «Resumen»",
    "leyó 2 páginas web",
    "no pudo abrir ine.es",
    "pidió permiso: Pagar (aprobado por ti)",
  ]);
  const err = rows.find((r) => r.s === "err");
  assert.equal(err.k, "error");
  assert.match(err.tool, /web_fetch ine\.es · 503/);
  assert.equal(rows[0].s, "wait");
  assert.equal(rows[0].href, "/revisar/a1");
  assert.equal(rows.find((r) => r.text.startsWith("leyó")).tool, "web_fetch ×2 a.es");
  assert.ok(rows.every((r) => r.where === "#estudio"));
});

test("filters by kind and bot", () => {
  const rows = logRows({ details, approvals, from: Date.parse(at(12)) });
  assert.equal(filterRows(rows, "error").length, 1);
  assert.equal(filterRows(rows, "enviar").length, 1);
  assert.equal(filterRows(rows, "todo", "vera").length, 0);
});

test("kinds and sentences of tool calls", () => {
  assert.equal(kindOfTool("gmail_send_email", { tool: "GMAIL_SEND_EMAIL", type: "app" }), "enviar");
  assert.equal(kindOfTool("gmail_create_email_draft", { tool: "GMAIL_CREATE_EMAIL_DRAFT", type: "app" }), "escribir");
  assert.equal(kindOfTool("read_file", { type: "file" }), "leer");
  assert.equal(kindOfTool("create_deliverable", { type: "deliverable" }), "escribir");
  assert.equal(sentenceOf("run_command", [{ status: "done", card: { type: "command", program: "python" } }]), "ejecutó python");
  assert.equal(sentenceOf("apps_execute", [{ status: "done", card: { type: "app", app: "Gmail", action: "leer correos" } }]), "usó Gmail para leer correos");
});

test("CSV export and «12 min»", () => {
  const rows = logRows({ details, approvals, from: Date.parse(at(12)) });
  const csv = logCsv(rows, [{ id: "nora", name: "Nora" }]);
  assert.match(csv, /^Fecha;Bot;Qué;Dónde;Estado;Detalle\r\n/);
  assert.match(csv, /;Nora;no pudo abrir ine\.es;#estudio;Error;/);
  assert.equal(since(new Date(Date.now() - 12 * 60e3).toISOString()), "12 min");
  assert.equal(since(new Date(Date.now() - 3 * 3600e3).toISOString()), "3 h");
});
