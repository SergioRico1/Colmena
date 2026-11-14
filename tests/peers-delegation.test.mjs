// «Delegar aprobaciones» (server/peers/delegation.mjs): Sergio's routine asks Marta to decide
// its red lines too. Two Colmenas over a local mailbox: the ask arrives as plain text in her
// Bandeja, her decision comes back and is applied through the card's own path, whoever decides
// first closes the other's card, and nothing from the wrong person, the wrong ref, a flagged
// step or past its time is applied.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Peers } from "../server/peers/service.mjs";
import { Delegation, askDetails } from "../server/peers/delegation.mjs";
import { decideApproval } from "../server/approval-decide.mjs";
import { waitingItems } from "../server/waiting.mjs";
import { startRelay } from "../relay/server.mjs";

const until = async (fn, what, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error("No llegó a cumplirse: " + what);
    await new Promise((r) => setTimeout(r, 30));
  }
};

async function world(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-delegation-"));
  const relay = await startRelay({ port: 0, directory: path.join(base, "relay") });
  const people = [];
  for (const name of ["Sergio Rico", "Marta Ruiz"]) {
    const store = new Store(path.join(base, name.split(" ")[0]));
    store.put("bots", { id: "vera", name: "Vera", role: "Redacción", color: "#7A5AF8", shape: "circle", enabled: true });
    const notices = [];
    const peers = await new Peers({ store, vault: null, relayUrl: relay.url, nameOf: () => name, notifier: { notify: (n) => notices.push(n) }, log: () => {} }).start();
    // The runtime's own decision, as the card would call it (approval-decide.mjs).
    const decided = [];
    const runtime = { approve: async (id, decision, options) => { decided.push({ id, decision, ...options }); store.patch("approvals", id, { status: decision, decidedAt: new Date().toISOString(), decidedBy: options.decidedBy || "tú", resolution: decision === "approved" ? "Aprobado" : "Denegado" }); } };
    const clock = { now: Date.now() };
    peers.delegation = new Delegation({ peers, store, clock: () => clock.now, settleMs: 10, decide: (a, o) => decideApproval({ store, runtime, connection: () => null }, a, o) }).start();
    people.push({ name, store, peers, notices, decided, clock });
  }
  t.after(async () => {
    for (const p of people) { p.peers.delegation.stop(); p.peers.stop(); }
    await new Promise((r) => setTimeout(r, 300));
    for (const p of people) p.store.close();
    await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  await until(() => people.every((p) => p.peers.relayStatus.status === "online"), "conectados");
  const [a, b] = people;
  const inv = await a.peers.createInvite(b.name);
  await b.peers.acceptInvite(inv.code);
  await until(() => a.peers.contact(b.peers.address)?.status === "active" && b.peers.contact(a.peers.address)?.status === "active", "contactos");
  // Sergio's routine: Marta decides its red lines too.
  a.store.put("automations", { id: "r1", name: "Informe semanal", approver: { contactId: b.peers.address } });
  a.store.put("missions", { id: "m1", title: "Informe", status: "waiting", automationId: "r1", botIds: ["vera"] });
  a.store.put("steps", { id: "m1:s", missionId: "m1", botId: "vera", kind: "solo", status: "waiting" });
  return people;
}
const redLine = (store, id = "m1:s:c1", extra = {}) => store.put("approvals", {
  id, missionId: "m1", botId: "vera", stepId: "m1:s", tool: "run_command", kind: "permission", redLine: true, status: "pending",
  title: "Ejecutar «node informe.js --enviar»", args: { program: "node", args: ["informe.js", "--enviar"], folderId: null, reason: "x" }, deferred: true, createdAt: new Date().toISOString(), ...extra,
});

test("ask → Marta decides → applied on Sergio's side with her name; her card closes", async (t) => {
  const [sergio, marta] = await world(t);
  redLine(sergio.store);
  const ask = await until(() => marta.store.list("peerApprovalAsks")[0], "le llega a Marta");
  assert.equal(ask.fromName, "Sergio Rico");
  assert.equal(ask.routine, "Informe semanal");
  assert.equal(ask.details.command, "node informe.js --enviar");
  assert.equal(ask.details.bot, "Vera");
  assert.match(marta.notices.at(-1).title, /Sergio te pide que decidas/);
  const item = waitingItems(marta.store).find((i) => i.kind === "delegated");
  assert.equal(item.title, "Sergio te pide que decidas");
  assert.equal(item.ask.details.command, "node informe.js --enviar");
  const sent = sergio.store.get("approvals", "m1:s:c1").delegation;
  assert.equal(sent.contactId, marta.peers.address);
  marta.peers.delegation.answer(ask.id, { decision: "approved" });
  await until(() => sergio.store.get("approvals", "m1:s:c1").status === "approved", "aprobado en Sergio");
  assert.deepEqual(sergio.decided[0], { id: "m1:s:c1", decision: "approved", always: false, decidedBy: "Marta Ruiz" }, "never «Siempre»");
  assert.equal(sergio.store.get("approvals", "m1:s:c1").decidedBy, "Marta Ruiz");
  assert.match(sergio.store.get("approvals", "m1:s:c1").resolution, /Lo aprobó Marta Ruiz/);
  await until(() => marta.store.get("peerApprovalAsks", ask.id).resolution, "Marta sabe cómo quedó");
  assert.equal(marta.store.get("peerApprovalAsks", ask.id).state, "decided");
  assert.equal(waitingItems(marta.store).some((i) => i.kind === "delegated"), false);
});

test("Sergio decides first: Marta's card closes as decided and her answer is refused", async (t) => {
  const [sergio, marta] = await world(t);
  redLine(sergio.store);
  const ask = await until(() => marta.store.list("peerApprovalAsks")[0], "le llega a Marta");
  sergio.store.patch("approvals", "m1:s:c1", { status: "denied", decidedBy: "tú", resolution: "Denegado" });
  await until(() => marta.store.get("peerApprovalAsks", ask.id).state === "closed", "cerrada en Marta");
  assert.equal(marta.store.get("peerApprovalAsks", ask.id).resolution, "Denegado");
  assert.throws(() => marta.peers.delegation.answer(ask.id, { decision: "approved" }), /Ya lo decidió Sergio/);
  assert.equal(sergio.decided.length, 0);
});

test("the wrong person, the wrong ref, a flagged step or a finished approval are never applied", async (t) => {
  const [sergio, marta] = await world(t);
  redLine(sergio.store);
  await until(() => sergio.store.get("approvals", "m1:s:c1").delegation, "pedido");
  const { ref } = sergio.store.get("approvals", "m1:s:c1").delegation;
  const luis = sergio.store.put("peerContacts", { id: "addr-luis", name: "Luis", status: "active" });
  assert.equal(await sergio.peers.delegation.decided(luis, ref, { decision: "approved" }), false, "someone else");
  const contact = sergio.peers.contact(marta.peers.address);
  assert.equal(await sergio.peers.delegation.decided(contact, "00000000-0000-0000-0000-000000000000", { decision: "approved" }), false, "another ref");
  assert.equal(await sergio.peers.delegation.decided(contact, ref, { decision: "always" }), false, "no «Siempre» from them");
  sergio.store.patch("steps", "m1:s", { suspicious: [{ tool: "web_fetch", found: ["ignora"], at: "x" }] });
  assert.equal(await sergio.peers.delegation.decided(contact, ref, { decision: "approved" }), false, "a flagged step");
  sergio.store.patch("steps", "m1:s", { suspicious: [] });
  assert.equal(sergio.store.get("approvals", "m1:s:c1").status, "pending");
  assert.equal(await sergio.peers.delegation.decided(contact, ref, { decision: "denied", reason: "No es el momento" }), true);
  assert.equal(sergio.store.get("approvals", "m1:s:c1").denyReason, "No es el momento");
  assert.equal(await sergio.peers.delegation.decided(contact, ref, { decision: "approved" }), false, "already decided");
  assert.equal(sergio.decided.length, 1);
  // A flagged step is never even asked about.
  sergio.store.patch("steps", "m1:s", { suspicious: [{ tool: "web_fetch", found: ["ignora"], at: "x" }] });
  redLine(sergio.store, "m1:s:c2");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sergio.store.get("approvals", "m1:s:c2").delegation, undefined);
});

test("expired: Marta's ask after 24 h cannot be answered; Sergio's past its deadline closes and is not applied", async (t) => {
  const [sergio, marta] = await world(t);
  // A send that expires 30 min after it was prepared (not left for later).
  redLine(sergio.store, "m1:s:c1", { deferred: false, tool: "apps_execute", kind: "send", review: { tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", name: "Enviar correo", arguments: { recipient_email: "cliente@fuera.com", subject: "Informe", body: "Adjunto el informe. token=no-viaja" } }, args: { tool: "GMAIL_SEND_EMAIL" } });
  const ask = await until(() => marta.store.list("peerApprovalAsks")[0], "le llega a Marta");
  assert.deepEqual(ask.details.to, ["cliente@fuera.com"]);
  assert.equal(ask.details.subject, "Informe");
  marta.clock.now += 25 * 3600e3;
  assert.throws(() => marta.peers.delegation.answer(ask.id, { decision: "approved" }), /caducó/);
  assert.equal(marta.store.get("peerApprovalAsks", ask.id).state, "expired");
  // Sergio's side: past 30 minutes it is not applied, and the sweep tells Marta.
  sergio.store.patch("approvals", "m1:s:c1", { createdAt: new Date(Date.now() - 3600e3).toISOString(), preparedAt: new Date(Date.now() - 3600e3).toISOString() });
  const contact = sergio.peers.contact(marta.peers.address);
  assert.equal(await sergio.peers.delegation.decided(contact, ask.ref, { decision: "approved" }), false);
  sergio.peers.delegation.sweep();
  assert.ok(sergio.store.get("approvals", "m1:s:c1").delegation.closedAt);
});

test("details never carry what is not needed to decide", () => {
  const store = { get: () => ({ name: "Vera" }) };
  const d = askDetails(store, { botId: "vera", tool: "apps_execute", review: { name: "Enviar", tool: "GMAIL_SEND_EMAIL", toolkit: "gmail", account: "acc-secret-id", arguments: { recipient_email: "a@b.es", cc: ["c@d.es"], subject: "S", body: "x".repeat(5000), api_key: "sk-123", user_id: "me" } } });
  assert.deepEqual(Object.keys(d).sort(), ["action", "app", "body", "bot", "cc", "subject", "to"]);
  assert.equal(d.body.length, 4000);
  assert.equal(JSON.stringify(d).includes("sk-123"), false);
  assert.equal(JSON.stringify(d).includes("acc-secret-id"), false);
});
