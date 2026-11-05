import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { classify } from "../server/connections.mjs";
import { explicitlyAsked, namesFor } from "../server/appactions.mjs";
import { toolCard } from "../server/state.mjs";
import { verbFor } from "../server/tools.mjs";

// The exact call the direct Gmail tool made when Marina asked to write to Pablo.
const PABLO = {
  cc: [], bcc: [], body: "Hola, Pablo:\n\n¿Me puedes pasar el documento?", is_html: false, subject: "Documento de presupuesto 2026", user_id: "me",
  attachment: [], from_email: "", recipient_email: "pferran@nubaria.es", extra_recipients: [], include_signature: false,
};

test("a send with the direct tool's empty optional fields is a send you can review", () => {
  assert.deepEqual(classify({ tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", arguments: PABLO }), { kind: "send", redLine: true });
  assert.deepEqual(classify({ tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", arguments: { ...PABLO, extra_recipients: ["nuria@nubaria.es"], include_signature: true } }), { kind: "send", redLine: true });
  assert.throws(() => classify({ tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", arguments: { ...PABLO, attachment: [{ name: "x.pdf" }] } }), /adjunto/);
  assert.throws(() => classify({ tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", arguments: { ...PABLO, from_email: "otro@fuera.com" } }), /from_email/);
});

async function storeWith(t, text, history = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-send-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  store.put("messages", { id: "u1", missionId: "m", role: "user", kind: "message", text, at: new Date().toISOString() });
  store.put("steps", { id: "m:s", missionId: "m", history });
  return store;
}

test("«Pídele a Pablo…» is asking for the email, and Pablo is the name the address goes by", async (t) => {
  const history = [{ type: "function_call_output", call_id: "c", output: JSON.stringify({ data: { messages: [{ sender: "Pablo Ferrán <pferran@nubaria.es>", subject: "Presupuesto" }] } }) }];
  const store = await storeWith(t, "Pidele a Pablo el documento que hizo de presupuesto para 2026 con Nuria", history);
  const names = namesFor(store, "m:s", ["pferran@nubaria.es"]);
  assert.deepEqual(names, { "pferran@nubaria.es": ["Pablo Ferrán"] });
  assert.equal(explicitlyAsked(store, "m", ["pferran@nubaria.es"], { names }), true);
  // Without knowing who that address is, it still waits for your OK.
  assert.equal(explicitlyAsked(store, "m", ["pferran@nubaria.es"]), false);
  // Someone you did not name never leaves on its own.
  assert.equal(explicitlyAsked(store, "m", ["pferran@nubaria.es", "otro@fuera.com"], { names }), false);
});

test("connected-app tools read in plain Spanish, never by their tool name", () => {
  const card = toolCard("gmail_fetch_emails", { query: "from:pablo", account: "ca_gmail_test01" }, { ok: true }, new Map());
  assert.equal(card.type, "app");
  assert.equal(card.app, "Gmail");
  assert.equal(card.action, "leer correos");
  assert.equal(card.account, null);
  assert.equal(toolCard("gmail_create_email_draft", {}, {}, new Map()).action, "preparar borrador de correo");
  assert.equal(verbFor("gmail_fetch_emails"), "leyendo");
  assert.equal(verbFor("gmail_send_email"), "usando una app");
});

test("a send asked for and pinned down in the answer to the bot's question is one request", async (t) => {
  const history = [{ type: "function_call_output", call_id: "c", output: JSON.stringify({ data: { messages: [{ sender: "Raúl Corregidor <rcorregidor@ejemplo.es>", subject: "Informe" }] } }) }];
  const store = await storeWith(t, "Resume el informe de ayer", history);
  const at = (s) => new Date(Date.parse("2026-11-05T10:00:00Z") + s * 1000).toISOString();
  store.patch("messages", "u1", { at: at(0) });
  store.put("messages", { id: "a1", missionId: "m", role: "assistant", kind: "message", text: "El informe dice…", at: at(10) });
  store.put("messages", { id: "u2", missionId: "m", role: "user", kind: "message", text: "Sí, pídele que lo mire", at: at(20) });
  store.put("messages", { id: "a2", missionId: "m", role: "assistant", kind: "question", text: "¿A quién se lo pido?", at: at(30) });
  store.put("messages", { id: "u3", missionId: "m", role: "user", kind: "message", text: "Raúl Corregidor: el pico del 4/11", at: at(40) });
  const names = namesFor(store, "m:s", ["rcorregidor@ejemplo.es"]);
  assert.equal(explicitlyAsked(store, "m", ["rcorregidor@ejemplo.es"], { names }), true);
  // Once the bot has answered, an older «pídele» no longer counts.
  store.put("messages", { id: "a3", missionId: "m", role: "assistant", kind: "message", text: "Hecho.", at: at(50) });
  store.put("messages", { id: "u4", missionId: "m", role: "user", kind: "message", text: "Gracias, Raúl lo verá", at: at(60) });
  assert.equal(explicitlyAsked(store, "m", ["rcorregidor@ejemplo.es"], { names }), false);
  // «No lo envíes» in the turn keeps it waiting.
  store.put("messages", { id: "u5", missionId: "m", role: "user", kind: "message", text: "Escríbele a Raúl pero no lo envíes todavía", at: at(70) });
  assert.equal(explicitlyAsked(store, "m", ["rcorregidor@ejemplo.es"], { names }), false);
});
