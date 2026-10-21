import test from "node:test";
import assert from "node:assert/strict";
import { workSummary, workSteps } from "../src/lib/worklog.js";

const tool = (type, card = {}, extra = {}) => ({ id: Math.random().toString(36).slice(2), name: extra.name || type, status: "done", card: { type, ...card }, ...extra });

test("consecutive tools read as one plain sentence", () => {
  const tools = [
    tool("app", { app: "Gmail", action: "leer correos", count: 5 }, { name: "gmail_fetch_emails" }),
    tool("web", { domain: "boe.es" }), tool("web", { domain: "aeat.es" }),
    tool("websearch", { query: "factura electrónica" }),
    tool("project", { step: "edit", path: "app/main.js" }), tool("project", { step: "edit", path: "app/main.js" }), tool("project", { step: "edit", path: "app/util.js" }),
  ];
  assert.equal(workSummary(tools).text, "Ha leído 5 correos y 2 páginas web, buscado en la web y editado 2 archivos");
  assert.equal(workSummary(tools).steps, 7);
});

test("one of each says it in the singular; documents read page by page count once", () => {
  const tools = [tool("file", { name: "oferta.pdf", page: 1 }), tool("file", { name: "oferta.pdf", page: 2 }), tool("command", { program: "python" }), tool("bot", { botName: "Vera" })];
  assert.equal(workSummary(tools).text, "Ha leído un documento, ejecutado python y consultado a Vera");
});

test("plumbing, questions and unfinished calls stay out; failures are told apart", () => {
  const tools = [
    tool("app", { app: "Gmail", action: "ver cuentas" }, { name: "apps_accounts" }),
    tool("question", {}, { name: "ask_user" }),
    tool("web", {}, { status: "running" }),
    tool("deliverable", { title: "Informe Q3" }),
    tool("command", { program: "node" }, { status: "error" }),
  ];
  const s = workSummary(tools);
  assert.equal(s.text, "Ha guardado «Informe Q3» · un paso no salió");
  assert.equal(s.failed, 1);
  assert.equal(workSteps(tools).length, 3);
  assert.equal(workSummary([tool("question", {}, { name: "ask_user" })]), null);
});

test("an app read with nothing in it says so, and other app actions keep their app", () => {
  assert.equal(workSummary([tool("app", { app: "Gmail", action: "leer correos", count: 0 })]).text, "Ha leído correos, pero no había ninguno");
  assert.equal(workSummary([tool("app", { app: "Gmail", action: "enviar correo" }), tool("app", { app: "Holded", action: "mover dinero" })]).text, "Ha enviado un correo y usado Holded");
});
