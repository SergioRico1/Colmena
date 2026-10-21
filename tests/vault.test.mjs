import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { SiteVault, siteDomain, sameSite } from "../server/vault.mjs";
import { planComputerCall, executeComputerTool, computerToolDefs } from "../server/computer/tools.mjs";

// The DPAPI store, in memory: what it saves is what a real one would encrypt.
function memorySecrets() {
  const saved = new Map();
  return { saved, load: async (b) => (saved.has(b.profile) ? structuredClone(saved.get(b.profile)) : null), save: async (b, data) => { saved.set(b.profile, structuredClone(data)); } };
}

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-vault-"));
  const store = new Store(directory);
  const secrets = memorySecrets();
  const vault = new SiteVault(store, { secrets });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, vault, secrets };
}

test("site addresses become a domain; look-alikes are not the same site", () => {
  assert.equal(siteDomain("https://www.Banco.es/acceso?x=1"), "banco.es");
  assert.equal(siteDomain("app.holded.com"), "app.holded.com");
  assert.equal(siteDomain("http://192.168.1.10"), null);
  assert.equal(siteDomain("file:///C:/x"), null);
  assert.equal(sameSite("login.banco.es", "banco.es"), true);
  assert.equal(sameSite("banco.es.evil.com", "banco.es"), false);
  assert.equal(sameSite("mibanco.es", "banco.es"), false);
});

test("passwords live only in the encrypted store and no listing returns them", async (t) => {
  const { store, vault, secrets } = await setup(t);
  const e = await vault.add({ url: "https://www.holded.com/login", username: "marina@ejemplo.es", password: "s3cret-ü", label: "Holded" });
  assert.deepEqual(Object.keys(e).sort(), ["createdAt", "domain", "id", "label", "lastUsedAt", "updatedAt", "username", "uses"]);
  assert.doesNotMatch(JSON.stringify(vault.list()), /s3cret/);
  assert.doesNotMatch(JSON.stringify(store.list("vault")), /s3cret/, "SQLite never sees it");
  assert.match(JSON.stringify([...secrets.saved.values()]), /s3cret-ü/);
  assert.equal((await vault.secret(e.id)).password, "s3cret-ü");
  await vault.update(e.id, { password: "nueva" });
  assert.equal((await vault.secret(e.id)).password, "nueva");
  store.put("grants", { id: "g1", botId: "nora", tool: "browser_sign_in", scope: "vault:" + e.id });
  await vault.remove(e.id);
  assert.equal(vault.list().length, 0);
  assert.equal(store.get("grants", "g1"), null, "its «Permitir siempre» goes with it");
  assert.doesNotMatch(JSON.stringify([...secrets.saved.values()]), /nueva/);
  await assert.rejects(vault.add({ url: "localhost", username: "a", password: "b" }), /dirección de la web/);
});

test("browser_sign_in: offered with the accounts, refused off-site, approved once, and the bot never sees the password", async (t) => {
  const { vault } = await setup(t);
  const e = await vault.add({ url: "https://app.holded.com", username: "marina@ejemplo.es", password: "s3cret" });
  const calls = [];
  let page = "https://phish-holded.com/login";
  const computer = {
    available: true,
    call: async (op, args) => {
      calls.push({ op, args });
      if (op === "status") return { sessions: [{ missionId: "m", botId: "nora", url: page }] };
      if (op === "screenshot") return { url: page, title: "Acceso", jpegBase64: "" };
      if (op === "signIn") return { ok: true, url: "https://app.holded.com/home", title: "Inicio", filled: ["usuario", "contraseña"], submitted: true };
      throw Error("unexpected " + op);
    },
  };
  const bot = { id: "nora", name: "Nora", autonomy: "avisa" };
  const defs = computerToolDefs(bot, { available: true, vault: vault.list() });
  const def = defs.find((d) => d.name === "browser_sign_in");
  assert.ok(def, "offered when there are accounts");
  assert.match(def.description, new RegExp(e.id + " = app.holded.com, usuario m…@ejemplo.es"));
  assert.ok(!computerToolDefs(bot, { available: true, vault: [] }).some((d) => d.name === "browser_sign_in"), "not offered with an empty vault");
  const ctx = { missionId: "m", botId: "nora", bot, computer, vault, settings: {} };
  await assert.rejects(planComputerCall("browser_sign_in", { entry: e.id }, ctx), /es de phish-holded\.com, no de app\.holded\.com/);
  page = "https://app.holded.com/login";
  const plan = await planComputerCall("browser_sign_in", { entry: e.id }, ctx);
  assert.equal(plan.policy, "approval");
  assert.equal(plan.approval.grantScope, "vault:" + e.id);
  assert.equal(plan.approval.canAlways, true);
  assert.match(plan.approval.summary, /Nora quiere entrar en app\.holded\.com con tu cuenta «marina@ejemplo\.es»[\s\S]*nunca ve la contraseña/);
  await assert.rejects(executeComputerTool("browser_sign_in", { entry: e.id }, ctx), /aprobación/);
  const result = await executeComputerTool("browser_sign_in", { entry: e.id }, { ...ctx, approved: true, approval: { computer: plan.approval.computer } });
  assert.equal(result.signedIn, true);
  assert.doesNotMatch(JSON.stringify(result), /s3cret/, "the result for the model has no password");
  assert.doesNotMatch(JSON.stringify(plan), /s3cret/, "nor the approval card");
  const sent = calls.find((c) => c.op === "signIn");
  assert.equal(sent.args.password, "s3cret", "only the browser gets it");
  assert.equal(sent.args.domain, "app.holded.com");
  assert.equal(vault.list()[0].uses, 1);
});
