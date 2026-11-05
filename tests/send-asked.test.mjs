import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { classify } from "../server/connections.mjs";
import { answersThread, decidesReply, explicitlyAsked, namesFor } from "../server/appactions.mjs";
import { threadParty } from "../server/gmaildrafts.mjs";
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

// The thread as Composio's GMAIL_FETCH_MESSAGE_BY_THREAD_ID returns it (trimmed): Raúl wrote
// to Xavier, of another company, and to the person.
const SLIM4 = {
  data: {
    messages: [{
      messageId: "1a1ac2d778c8085e", threadId: "1a1ac0b5e3f2d901", subject: "Slim4: datos de venta perdida",
      sender: "Raúl Corregidor <rcorregidor@k-global.es>", to: "x.franquesa@slimstock.com, sergior@k-global.es",
      messageText: "Os propongo el martes 10, el jueves 12 o el viernes 13 a partir de las 12:00. Escribid a ventas@otra.com si no.",
      payload: { headers: [{ name: "From", value: "Raúl Corregidor <rcorregidor@k-global.es>" }, { name: "Cc", value: "Irene <irene@k-global.es>" }] },
    }],
  },
};

test("who is in a thread: From, To and Cc and its ids, never an address written in a body", () => {
  const party = threadParty(SLIM4.data);
  assert.deepEqual(party.addresses.sort(), ["irene@k-global.es", "rcorregidor@k-global.es", "sergior@k-global.es", "x.franquesa@slimstock.com"]);
  assert.deepEqual(party.ids.sort(), ["1a1ac0b5e3f2d901", "1a1ac2d778c8085e"]);
  // A read cut to a preview still says who is there.
  const cut = threadParty({ preview: JSON.stringify(SLIM4.data).slice(0, 260) });
  assert.ok(cut.ids.includes("1a1ac2d778c8085e"));
  assert.ok(cut.addresses.includes("rcorregidor@k-global.es"));
});

test("«Sí, martes 10 a las 12:00» to the bot's notice about an email is the reply, to the people in its thread", async (t) => {
  const store = await storeWith(t, "Qué hay de nuevo");
  const at = (s) => new Date(Date.parse("2026-11-05T14:49:00Z") + s * 1000).toISOString();
  store.patch("messages", "u1", { at: at(0) });
  store.put("messages", { id: "a1", missionId: "m", role: "assistant", kind: "message", at: at(10),
    text: "Raúl Corregidor propone una reunión con Xavier. Ofrece el martes 10, el jueves 12 o el viernes 13 de noviembre a partir de las 12:00.\n\n[Correo de Raul](https://mail.google.com/mail/u/?authuser=sergior%40k-global.es#all/1a1ac2d778c8085e)" });
  store.put("messages", { id: "u2", missionId: "m", role: "user", kind: "message", text: "Sí, martes 10 a las 12:00", at: at(20) });
  const party = threadParty(SLIM4.data);
  assert.equal(decidesReply(store, "m"), true);
  // To Raúl, with Xavier (outside the company) in copy: both are in the thread.
  assert.equal(answersThread(store, "m", party, ["rcorregidor@k-global.es", "x.franquesa@slimstock.com"]), true);
  // Someone who is only written inside an email, or nobody's thread: your OK as always.
  assert.equal(answersThread(store, "m", party, ["rcorregidor@k-global.es", "ventas@otra.com"]), false);
  assert.equal(answersThread(store, "m", { ...party, ids: ["ffffffffffff0000"] }, ["rcorregidor@k-global.es"]), false);
  // What you keep for yourself, or a question, is not a reply.
  for (const text of ["Déjalo sin responder", "No hace falta, lo hablo yo con Toni", "¿Qué día me viene mejor?", "No", "Déjalo, lo miro yo"]) {
    store.put("messages", { id: "u2", missionId: "m", role: "user", kind: "message", text, at: at(20) });
    assert.equal(decidesReply(store, "m"), false, text);
  }
  for (const text of ["Vale", "Acepta el jueves 12", "Dile que el martes me va bien", "ok, el viernes"]) {
    store.put("messages", { id: "u2", missionId: "m", role: "user", kind: "message", text, at: at(20) });
    assert.equal(decidesReply(store, "m"), true, text);
  }
  // Once the bot answered something else, the old notice is not what you are answering.
  store.put("messages", { id: "a2", missionId: "m", role: "assistant", kind: "message", text: "Sesame te recuerda la encuesta.", at: at(30) });
  store.put("messages", { id: "u3", missionId: "m", role: "user", kind: "message", text: "Sí", at: at(40) });
  assert.equal(answersThread(store, "m", party, ["rcorregidor@k-global.es"]), false);
});
