import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { SecretStore } from "../server/secrets.mjs";
import { findSecrets, maskSecret, secretSegments, suggestKey } from "../src/lib/secretMask.js";

const kinds = (text) => findSecrets(text).map((f) => [f.kind, f.value]);
const OPENAI = "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
const GITHUB = "ghp_" + "aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

test("known formats are found anywhere in the message", () => {
  assert.deepEqual(kinds("Usa esta: " + OPENAI + " gracias"), [["openai", OPENAI]]);
  assert.deepEqual(kinds("token " + GITHUB), [["github", GITHUB]]);
  assert.deepEqual(kinds("AKIAIOSFODNN7EXAMPLE y nada más"), [["aws", "AKIAIOSFODNN7EXAMPLE"]]);
  assert.deepEqual(kinds("slack: xoxb-1234567890-abcdefghij"), [["slack", "xoxb-1234567890-abcdefghij"]]);
  assert.deepEqual(kinds("Authorization: Bearer " + JWT), [["jwt", JWT]]);
  assert.deepEqual(kinds("sk-ant-api03-" + "x".repeat(30)), [["anthropic", "sk-ant-api03-" + "x".repeat(30)]]);
  assert.deepEqual(kinds("entra en https://ana:Gr4nada!@db.ejemplo.com/x"), [["address", "Gr4nada!"]]);
  assert.equal(findSecrets("entra en https://ana:Gr4nada!@db.ejemplo.com/x")[0].host, "db.ejemplo.com");
  const block = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";
  assert.deepEqual(kinds("mira:\n" + block + "\nfin"), [["privatekey", block]]);
});

test("a value after a word that names it is a secret; ordinary words are not", () => {
  assert.deepEqual(kinds("mi contraseña es Hunter2x!"), [["password", "Hunter2x!"]]);
  assert.deepEqual(kinds("la clave del wifi es Casa1234."), [["password", "Casa1234"]]);
  assert.deepEqual(kinds("password: «qwerty99»"), [["password", "qwerty99"]]);
  assert.deepEqual(kinds("el token es 9f8e7d6c5b4a39281706f5e4d3c2b1a0"), [["token", "9f8e7d6c5b4a39281706f5e4d3c2b1a0"]]);
  assert.deepEqual(kinds("api key = Zx81Qp20Lm93Ws47Ed56Rf"), [["token", "Zx81Qp20Lm93Ws47Ed56Rf"]]);
  for (const text of [
    "la clave está en el paso 3", "la clave es 2024", "olvidé la contraseña otra vez", "el token caduca mañana",
    "el token es 1111111111111111111", "skip-this-is-a-normal-hyphenated-sentence", "AKIAX", "contraseña de ana@correo.es",
    "el secreto es la constancia", "",
  ]) assert.deepEqual(findSecrets(text), [], text);
});

test("mask keeps the first 8 (never more than half) and segments rebuild the text", () => {
  assert.equal(maskSecret(OPENAI), "sk-proj-" + "•".repeat(OPENAI.length - 8));
  assert.equal(maskSecret("Hunter2x!"), "Hunt" + "•••••");
  assert.equal(maskSecret("x".repeat(200)).length, 8 + 32, "long values never fill the bubble");
  const text = "Hola, usa " + OPENAI + " y la contraseña: Hunter2x! vale";
  const parts = secretSegments(text);
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.deepEqual(parts.filter((p) => p.secret).map((p) => p.secret.kind), ["openai", "password"]);
  assert.deepEqual(secretSegments("nada"), [{ text: "nada" }]);
  assert.deepEqual(suggestKey(findSecrets(OPENAI)[0]), { name: "OPENAI_API_KEY", hosts: ["api.openai.com"], savable: true });
  assert.equal(suggestKey({ kind: "privatekey", value: "a\nb" }).savable, false);
});

test("the matcher is linear: a long pasted text scans fast", () => {
  const filler = "palabra normal con guiones-y_cosas 12345 ".repeat(5000) + "a".repeat(50000) + "sk-" + "-".repeat(20000);
  const t0 = performance.now();
  findSecrets(filler + " contraseña " + "x".repeat(5000));
  assert.ok(performance.now() - t0 < 250, "took " + (performance.now() - t0).toFixed(1) + " ms");
});

test("POST /api/secrets keeps a pasted key in the store and leaves only its marker in the message", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-mask-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls"); } });
  let blob = null;
  runtime.secrets = new SecretStore(store, { values: { load: async () => (blob ? JSON.parse(blob) : null), save: async (_b, data) => { blob = JSON.stringify(data); } } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const post = (body) => fetch(origin + "/api/secrets", { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  store.put("missions", { id: "c", title: "Chat", status: "completed", mode: "solo", botIds: ["nora"], conversation: true, createdAt: new Date().toISOString() });
  store.put("messages", { id: "u1", missionId: "c", role: "user", text: "Mi clave es " + OPENAI + ", úsala", at: new Date().toISOString() });
  store.put("messages", { id: "a1", missionId: "c", role: "assistant", botId: "nora", text: "Vale", at: new Date().toISOString() });

  assert.equal((await post({ name: "openai_api_key", value: OPENAI, allowedHosts: ["api.openai.com"], messageId: "a1" })).status, 404, "only your own messages");
  assert.equal((await post({ name: "1BAD", value: OPENAI, allowedHosts: ["api.openai.com"] })).status, 400);
  const r = await post({ name: "openai_api_key", value: OPENAI, allowedHosts: ["api.openai.com"], messageId: "u1" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).secret.name, "OPENAI_API_KEY");
  assert.equal(store.get("messages", "u1").text, "Mi clave es {{secret:OPENAI_API_KEY}}, úsala");
  assert.equal(JSON.parse(blob).values.OPENAI_API_KEY, OPENAI);
  assert.ok(!JSON.stringify(store.list("secrets")).includes(OPENAI), "the value never reaches SQLite");
});
