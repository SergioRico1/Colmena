import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { importNexoComposio } from "../server/nexo/import.mjs";

// DPAPI stand-in: data is only readable with the exact binding it was saved with.
function fakeVaults() {
  const files = new Map();
  const key = (dir, b) => dir + "|" + JSON.stringify(b);
  return {
    files,
    vaultFor: (dir) => ({ load: async (b) => files.get(key(dir, b)) ?? null, save: async (b, data) => { files.set(key(dir, b), structuredClone(data)); } }),
    put: (dir, b, data) => files.set(key(dir, b), data),
  };
}

test("the Composio account of NEXO is imported once, re-encrypted under Colmena's binding", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "colmena-import-"));
  const colmena = path.join(root, "colmena"), nexo = path.join(root, "nexo");
  await mkdir(path.join(nexo, "connections", "credentials"), { recursive: true });
  await writeFile(path.join(nexo, "connections", "credentials", "abc123.dpapi"), "x");
  const store = new Store(colmena);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const v = fakeVaults();
  v.put(path.join(nexo, "connections"), { profile: "abc123", hostId: "nexo-composio-v1", clientId: "composio", subject: "profile:abc123" }, { apiKey: "ak_test", userId: "colmena_u1", sessionId: "old", aliases: { a: "Trabajo" } });
  const r = await importNexoComposio({ store, directory: colmena, nexoBase: nexo, vaultFor: v.vaultFor });
  assert.deepEqual(r, { imported: true });
  const mine = await v.vaultFor(path.join(colmena, "connections")).load({ profile: "default", hostId: "colmena-composio-v1", clientId: "composio", subject: "profile:default" });
  assert.equal(mine.apiKey, "ak_test");
  assert.equal(mine.userId, "colmena_u1", "same Composio identity: NEXO's apps show up");
  assert.equal(mine.sessionId, null);
  assert.ok(store.get("settings", "main").nexoComposioImport);
  assert.equal((await importNexoComposio({ store, directory: colmena, nexoBase: nexo, vaultFor: v.vaultFor })).reason, "ya importado");
});

test("nothing happens when Colmena already has Composio or NEXO is not there", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "colmena-import-"));
  const store = new Store(path.join(root, "c"));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const v = fakeVaults();
  assert.equal((await importNexoComposio({ store, directory: path.join(root, "c"), nexoBase: path.join(root, "none"), vaultFor: v.vaultFor })).reason, "sin NEXO");
  v.put(path.join(root, "c", "connections"), { profile: "default", hostId: "colmena-composio-v1", clientId: "composio", subject: "profile:default" }, { apiKey: "ak_mine" });
  assert.equal((await importNexoComposio({ store, directory: path.join(root, "c"), nexoBase: path.join(root, "none"), vaultFor: v.vaultFor })).reason, "ya configurado");
});
