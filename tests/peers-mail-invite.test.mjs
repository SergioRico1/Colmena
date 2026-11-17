// Invitations by mail (docs/PEOPLE.md): your Colmena asks the mailbox to mail one of your own open
// invitations (relay/server.mjs here; relay/cloudflare/worker.js with Cloudflare Email Sending);
// nobody can mail someone else's code, a code gone is refused, and there is a daily limit.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Peers } from "../server/peers/service.mjs";
import { startRelay } from "../relay/server.mjs";

const until = async (fn, what, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 40)); } throw Error("timeout: " + what); };

test("an invitation by mail: yours only, the code that opens it, a daily limit", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-mailinv-"));
  const outbox = [];
  const relay = await startRelay({ port: 0, directory: path.join(base, "relay"), mail: async (m) => { outbox.push(m); } });
  const people = [];
  for (const name of ["Sergio Rico", "Marta Ruiz"]) {
    const store = new Store(path.join(base, name.split(" ")[0]));
    const peers = await new Peers({ store, vault: null, relayUrl: relay.url, nameOf: () => name, notifier: { notify: () => {} }, log: () => {} }).start();
    people.push({ name, store, peers });
  }
  t.after(async () => {
    for (const p of people) p.peers.stop();
    await new Promise((r) => setTimeout(r, 200));
    for (const p of people) p.store.close();
    await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  await until(() => people.every((p) => p.peers.relayStatus.status === "online"), "conectados");
  const [sergio, marta] = people;

  const inv = await sergio.peers.createInvite("Luis Gómez");
  assert.deepEqual(await sergio.peers.mailInvite(inv.id, "Luis@Ejemplo.com "), { ok: true, to: "luis@ejemplo.com" });
  assert.equal(outbox.length, 1);
  assert.deepEqual([outbox[0].to, outbox[0].code, outbox[0].name, outbox[0].inviter], ["luis@ejemplo.com", inv.code, "Luis Gómez", "Sergio Rico"]);
  // The code in the mail is the one that opens the invitation.
  assert.equal((await marta.peers.previewInvite(outbox[0].code)).name, "Sergio Rico");

  // Not a bad address, not a code that is not open, not someone else's invitation.
  await assert.rejects(sergio.peers.mailInvite(inv.id, "no-es-un-correo"), /no parece válido/);
  await assert.rejects(sergio.peers.mailInvite("no-existe", "a@b.es"), /ya no está abierto/);
  const theirs = await marta.peers.createInvite("Ana");
  await assert.rejects(sergio.peers.client.mailInvite({ to: "a@b.es", code: theirs.code }), /no es tuya/);
  assert.equal(outbox.length, 1, "nothing else went out");

  // 20 a day per sender.
  for (let i = 1; i < 20; i++) await sergio.peers.mailInvite(inv.id, `p${i}@ejemplo.com`);
  await assert.rejects(sergio.peers.mailInvite(inv.id, "p21@ejemplo.com"), /muchas invitaciones hoy/);
  assert.equal(outbox.length, 20);
});
