// Hosted Colmena's small pieces: the session cookie, same-origin and CSRF checks
// (cloud/src/http.js), the mail fallback (cloud/src/mail.js) and envelope encryption
// (server/envelope-vault.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { csrfOk, parseCookies, sameOrigin, sessionCookie, sessionToken } from "../cloud/src/http.js";
import { composeMail, isTestAddress, sendMail } from "../cloud/src/mail.js";
import { WorkspaceKeyring, envelopeVault, open, seal } from "../server/envelope-vault.mjs";

const req = (url, headers = {}) => new Request(url, { headers });

test("the session cookie: host-only, HttpOnly, Secure and SameSite=Lax; cleared on logout", () => {
  const url = new URL("https://colmena.example/entrar");
  const set = sessionCookie(url, "tok", 3600 * 1000);
  assert.match(set, /^__Host-colmena=tok; Max-Age=3600; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  assert.match(sessionCookie(url, null), /^__Host-colmena=; Max-Age=0/);
  assert.equal(sessionToken(req("https://colmena.example/", { Cookie: "a=1; __Host-colmena=tok" })), "tok");
  // Local plain HTTP cannot keep a __Host- cookie: its own name, no Secure.
  assert.doesNotMatch(sessionCookie(new URL("http://127.0.0.1:8790/"), "t", 1000), /Secure/);
  assert.deepEqual(parseCookies("a=1; b=x%20y; a=2"), { a: "1", b: "x y" });
});

test("same origin and CSRF: other sites and missing tokens are refused", () => {
  const u = "https://colmena.example/auth/link";
  assert.equal(sameOrigin(req(u, { Origin: "https://colmena.example" }), { write: true }), true);
  assert.equal(sameOrigin(req(u, { Origin: "https://evil.example" }), { write: true }), false);
  assert.equal(sameOrigin(req(u, { "Sec-Fetch-Site": "cross-site" })), false);
  assert.equal(sameOrigin(req(u), { write: true }), false, "a write must say where it comes from");
  assert.equal(sameOrigin(req(u, { "Sec-Fetch-Site": "same-origin" }), { write: true }), true);
  assert.equal(sameOrigin(req(u)), true, "a plain read");
  assert.equal(csrfOk(req(u, { "X-Colmena-Token": "abc" }), "abc"), true);
  assert.equal(csrfOk(req(u, { "X-Colmena-Token": "abd" }), "abc"), false);
  assert.equal(csrfOk(req(u), "abc"), false);
});

test("mail: without a provider the link never leaves in a response, only to the dev outbox", async () => {
  const kept = [];
  const out = await sendMail({}, { to: "ana@example.com", kind: "signin", url: "https://colmena.example/entrar/verificar#t=x" }, { keep: async (m) => kept.push(m), fetchImpl: () => { throw Error("no network"); } });
  assert.deepEqual(out, { sent: false, dev: true });
  assert.equal(kept[0].url, "https://colmena.example/entrar/verificar#t=x");
  let sent = null;
  const real = await sendMail({ RESEND_API_KEY: "test-key" }, { to: "ana@empresa-norte.es", kind: "invite", url: "https://colmena.example/invitacion#t=y", workspace: "Norte", inviter: "Beto" },
    { fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return new Response("{}", { status: 200 }); } });
  assert.deepEqual(real, { sent: true });
  assert.equal(sent.auth, "Bearer test-key");
  assert.deepEqual(sent.body.to, ["ana@empresa-norte.es"]);
  assert.match(sent.body.subject, /Beto te invita a Norte/);
  assert.match(composeMail("invite", { url: "https://x/<y>", workspace: "<b>", inviter: "A" }).html, /&lt;b&gt;/);
});

test("mail: reserved test domains stay in the dev outbox even with a real provider", async () => {
  const kept = [], sent = [];
  const env = { SEND_EMAIL: { send: async (m) => sent.push(m) }, MAIL_FROM_ADDRESS: "acceso@colmena.team" };
  for (const to of ["ana@example.com", "beto@sub.example.org", "c@equipo.test", "d@x.invalid"])
    assert.deepEqual(await sendMail(env, { to, kind: "signin", url: "https://x/v#t" }, { keep: async (m) => kept.push(m) }), { sent: false, dev: true });
  assert.equal(kept.length, 4);
  assert.equal(sent.length, 0);
  assert.deepEqual(await sendMail(env, { to: "ana@empresa-norte.es", kind: "signin", url: "https://x/v#t" }), { sent: true });
  assert.equal(sent[0].from.email, "acceso@colmena.team");
  assert.equal(isTestAddress("f@example.community"), false);
});

test("envelope encryption: master → workspace key → data key, bound to where each secret lives", async () => {
  const key = randomBytes(32);
  const sealed = seal(key, "hola", "aad-1");
  assert.equal(open(key, sealed, "aad-1").toString(), "hola");
  assert.throws(() => open(key, sealed, "aad-2"), /No se pudo abrir/);
  assert.throws(() => open(randomBytes(32), sealed, "aad-1"));
  let stored = null;
  const masters = [{ kid: "m1", secret: randomBytes(32).toString("hex") }];
  const keyring = new WorkspaceKeyring({ workspace: "w1", masters, load: () => stored, save: (r) => { stored = r; } });
  const rows = new Map();
  const records = { get: (id) => rows.get(id) || null, put: (r) => rows.set(r.id, r), remove: (id) => rows.delete(id) };
  const vault = envelopeVault({ keyring, records, namespace: "secrets" });
  await vault.save({ profile: "default" }, { token: "s3cr3t" });
  assert.ok(!JSON.stringify([...rows.values()]).includes("s3cr3t"));
  assert.deepEqual(await vault.load({ profile: "default" }), { token: "s3cr3t" });
  // Another workspace's keyring (or namespace) cannot open it.
  const other = new WorkspaceKeyring({ workspace: "w2", masters, load: () => stored, save: () => {} });
  await assert.rejects(envelopeVault({ keyring: other, records, namespace: "secrets" }).load({ profile: "default" }));
  rows.set("vault:default", { ...rows.get("secrets:default"), id: "vault:default" });
  await assert.rejects(envelopeVault({ keyring, records, namespace: "vault" }).load({ profile: "default" }));
  // Master rotation: the workspace key is rewrapped, the secrets stay as they are.
  const before = stored.wrapped;
  const rotated = new WorkspaceKeyring({ workspace: "w1", masters: [{ kid: "m2", secret: randomBytes(32).toString("hex") }, masters[0]], load: () => stored, save: (r) => { stored = r; } });
  assert.deepEqual(await envelopeVault({ keyring: rotated, records, namespace: "secrets" }).load({ profile: "default" }), { token: "s3cr3t" });
  assert.equal(stored.kid, "m2");
  assert.notEqual(stored.wrapped, before);
  assert.throws(() => new WorkspaceKeyring({ workspace: "w1", masters: [{ kid: "m3", secret: randomBytes(32).toString("hex") }], load: () => stored, save: () => {} }).key(), /ya no está configurada/);
  await vault.remove("default");
  assert.equal(await vault.load({ profile: "default" }), null);
});
