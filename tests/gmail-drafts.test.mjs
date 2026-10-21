import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { Connections, classify } from "../server/connections.mjs";
import { appWorkNote, draftFields, draftText } from "../server/gmaildrafts.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-gmail-drafts-")), store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  store.put("bots", { id: "vera", name: "Vera", tools: { correo: "escribe" } });
  store.put("missions", { id: "mi", status: "running" });
  return { store };
}

// The draft Vera left in the Finora thread (shape of Composio's GMAIL_GET_DRAFT).
const DRAFT = {
  id: "r828", message: {
    messageId: "m-draft", threadId: "t-finora", to: "hugo@finora.com", subject: "Re: Reunión Seguimiento Finora",
    messageText: "Hola Hugo,<br/><br/>De acuerdo.<br/><br/>Un saludo\n\n<div class=\"gmail_quote\">On Mon, Hugo wrote: antiguo</div>",
  },
};

// A fake connections service that knows the gmail read list, like the real one.
function hub({ updatedThread = "t-finora" } = {}) {
  const calls = [];
  return {
    calls,
    async dispatch(_profile, op, args) {
      calls.push({ op, args });
      if (op === "prepare") {
        const parsed = JSON.parse(args.arguments_json || "{}");
        const read = ["GMAIL_GET_DRAFT", "GMAIL_LIST_DRAFTS", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID"].includes(args.tool);
        return { proposal: "p" + calls.length, name: args.tool, tool: args.tool, toolkit: "gmail", account: "Gmail trabajo · ca_1", account_alias: "Gmail trabajo", read_scope: read ? "gmail-read-v1" : null, arguments: parsed };
      }
      if (op === "commit") {
        const prepared = calls.findLast((c) => c.op === "prepare");
        const tool = prepared.args.tool;
        if (tool === "GMAIL_GET_DRAFT") return { ok: true, data: DRAFT };
        if (tool === "GMAIL_FETCH_MESSAGE_BY_THREAD_ID") return { ok: true, data: { messages: [{ threadId: "t-finora", subject: "Reunión Seguimiento Finora", to: "oriol@nubaria.es" }] } };
        if (tool === "GMAIL_GET_PROFILE") return { ok: true, data: { emailAddress: "marina@nubaria.es" } };
        return { ok: true, data: { id: "r828", message: { id: "m2", threadId: updatedThread } } };
      }
      return {};
    },
  };
}
const signal = new AbortController().signal;
const ask = (tool, json) => ({ tool, account: "ca_1", arguments_json: JSON.stringify(json) });

test("changing a reply draft keeps it in its thread", async (t) => {
  const { store } = await fixture(t);
  const h = hub();
  const c = new Connections(store, h);
  const result = await c.request({ id: "mi" }, { id: "s1", botId: "vera" }, { call_id: "c1" }, ask("GMAIL_UPDATE_DRAFT", { user_id: "me", draft_id: "r828", body: "Hola Hugo, no." }), signal);
  assert.equal(result.ok, true);
  const update = h.calls.find((x) => x.op === "prepare" && x.args.tool === "GMAIL_UPDATE_DRAFT");
  assert.equal(JSON.parse(update.args.arguments_json).thread_id, "t-finora");
});

test("«envíalo» on a draft is a send you review with the draft's own recipients and text", async (t) => {
  const { store } = await fixture(t);
  store.put("messages", { id: "u1", missionId: "mi", role: "user", text: "Envialo", at: new Date().toISOString() });
  const c = new Connections(store, hub());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // A draft from somewhere else: «envíalo» alone does not say who it goes to.
  await c.request({ id: "mi" }, { id: "s0", botId: "vera" }, { call_id: "c0" }, ask("GMAIL_SEND_DRAFT", { user_id: "me", draft_id: "r828" }), signal);
  assert.equal(store.get("approvals", "s0:c0").autoSendAt, undefined);
  // The draft Vera prepared here: «envíalo» is the OK.
  store.put("approvals", { id: "made", missionId: "mi", tool: "apps_execute", status: "executed", review: { tool: "GMAIL_CREATE_EMAIL_DRAFT", arguments: {} }, result: { ok: true, data: { id: "r828" } } });
  const result = await c.request({ id: "mi" }, { id: "s1", botId: "vera" }, { call_id: "c1" }, ask("GMAIL_SEND_DRAFT", { user_id: "me", draft_id: "r828" }), signal);
  t.mock.timers.reset();
  assert.deepEqual(result, { waiting: true });
  const a = store.get("approvals", "s1:c1");
  assert.equal(a.kind, "send");
  assert.deepEqual(a.review.draft.to, ["hugo@finora.com"]);
  assert.equal(a.review.draft.body, "Hola Hugo,\n\nDe acuerdo.\n\nUn saludo");
  assert.ok(a.autoSendAt, "you said send about its own draft: it leaves on its own");
});

test("reading drafts is a read, so it can be repeated", () => {
  assert.equal(classify({ tool: "GMAIL_LIST_DRAFTS", toolkit: "gmail", arguments: {}, read_scope: "gmail-read-v1" }).kind, "read");
});

test("a reply goes in its thread: «Re:» as a new email is refused, a thread reply is a send", () => {
  assert.throws(() => classify({ tool: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "h@f.com", subject: "Re: Reunión", body: "No" } }), /GMAIL_REPLY_TO_THREAD/);
  assert.deepEqual(classify({ tool: "GMAIL_REPLY_TO_THREAD", arguments: { thread_id: "t1", recipient_email: "h@f.com", message_body: "No", cc: [], attachment: [], is_html: false } }), { kind: "send", redLine: true });
  assert.throws(() => classify({ tool: "GMAIL_REPLY_TO_THREAD", arguments: { recipient_email: "h@f.com", message_body: "No" } }));
  assert.deepEqual(classify({ tool: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "h@f.com", subject: "Presupuesto", body: "Hola" } }), { kind: "send", redLine: true });
});

test("a draft read back as text, also from a cut preview", () => {
  assert.equal(draftText("Hola<br/>Adiós<blockquote>viejo</blockquote>"), "Hola\nAdiós");
  const cut = draftFields({ preview: JSON.stringify(DRAFT).slice(0, 200), truncated: true });
  assert.equal(cut.threadId, "t-finora");
  assert.deepEqual(cut.to, ["hugo@finora.com"]);
});

test("the next turn knows the draft it left, so «envíalo» needs no search", () => {
  const ok = (tool, args, data, at) => ({ tool: "apps_execute", status: "executed", updatedAt: at, args: { account: "ca_1" }, review: { tool, account: "Gmail trabajo · ca_1", account_alias: "Gmail trabajo", arguments: args }, result: { ok: true, data } });
  const note = appWorkNote([
    ok("GMAIL_CREATE_EMAIL_DRAFT", { recipient_email: "hugo@finora.com", subject: "Re: Finora", thread_id: "t-finora", body: "Sí" }, { id: "r828", message: { id: "m1", threadId: "t-finora" } }, "1"),
    ok("GMAIL_UPDATE_DRAFT", { draft_id: "r828", body: "No" }, { id: "r828", message: { id: "m2", threadId: "m2" } }, "2"),
  ]);
  assert.match(note, /draft_id r828/);
  assert.match(note, /hugo@finora.com/);
  assert.match(note, /thread_id t-finora/);
  assert.match(note, /GMAIL_SEND_DRAFT/);
  const sent = appWorkNote([
    ok("GMAIL_CREATE_EMAIL_DRAFT", { recipient_email: "h@f.com", subject: "Hola" }, { id: "r1", message: { id: "m1", threadId: "m1" } }, "1"),
    { ...ok("GMAIL_SEND_DRAFT", { draft_id: "r1" }, { threadId: "m1" }, "2") },
  ]);
  assert.doesNotMatch(sent, /Borrador sin enviar/);
  assert.match(sent, /Enviado: h@f\.com/);
  assert.equal(appWorkNote([]), "");
});

test("a reply draft must name its thread", () => {
  assert.throws(() => classify({ tool: "GMAIL_CREATE_EMAIL_DRAFT", arguments: { recipient_email: "h@f.com", subject: "Re: Finora", body: "No" } }), /thread_id/);
  assert.equal(classify({ tool: "GMAIL_CREATE_EMAIL_DRAFT", arguments: { recipient_email: "h@f.com", subject: "Re: Finora", body: "No", thread_id: "t1" } }).kind, "write");
});

test("if Gmail still drops the thread on a change, the bot is told instead of «updated»", async (t) => {
  const { store } = await fixture(t);
  const c = new Connections(store, hub({ updatedThread: "m2" }));
  const result = await c.request({ id: "mi" }, { id: "s1", botId: "vera" }, { call_id: "c1" }, ask("GMAIL_UPDATE_DRAFT", { user_id: "me", draft_id: "r828", body: "No" }), signal);
  assert.match(result.aviso, /thread_id t-finora/);
});

test("a reply card shows the conversation it goes into", async (t) => {
  const { store } = await fixture(t);
  const c = new Connections(store, hub());
  await c.request({ id: "mi" }, { id: "s1", botId: "vera" }, { call_id: "c1" }, ask("GMAIL_REPLY_TO_THREAD", { user_id: "me", thread_id: "t-finora", recipient_email: "hugo@finora.com", message_body: "No, por dos motivos." }), signal);
  const a = store.get("approvals", "s1:c1");
  assert.equal(a.kind, "send");
  assert.equal(a.review.thread.subject, "Re: Reunión Seguimiento Finora");
});

test("«envíamelo» to your own address leaves without a second OK", async (t) => {
  const { store } = await fixture(t);
  store.put("messages", { id: "u1", missionId: "mi", role: "user", text: "Envíamelo al correo", at: new Date().toISOString() });
  const c = new Connections(store, hub());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await c.request({ id: "mi" }, { id: "s1", botId: "vera" }, { call_id: "c1" }, ask("GMAIL_SEND_EMAIL", { user_id: "me", recipient_email: "Marina <marina@nubaria.es>", subject: "Resumen", body: "Hola" }), signal);
  await c.request({ id: "mi" }, { id: "s2", botId: "vera" }, { call_id: "c2" }, ask("GMAIL_SEND_EMAIL", { user_id: "me", recipient_email: "otro@fuera.com", subject: "Resumen", body: "Hola" }), signal);
  t.mock.timers.reset();
  assert.ok(store.get("approvals", "s1:c1").autoSendAt);
  assert.equal(store.get("approvals", "s2:c2").autoSendAt, undefined);
});
