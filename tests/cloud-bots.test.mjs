// Bots in a hosted workspace (docs/CLOUD.md › Phase 3): per-person AI accounts and the terms
// switch, bots named in channels, plans with two bots, routines fired by the alarm with nobody
// connected, approvals for the owner and their delegate, pre-approvals, work cut by an eviction
// resumed on the next wake-up, MCP sign-in on a public redirect, webhooks at a public address.
// Every model call is the fake model (server/cloud/fake-model.mjs); no real provider is reached.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHmac } from "node:crypto";
import { Store } from "../server/store.mjs";
import { DoDriver } from "../server/store-driver.mjs";
import { FakeDurableStorage } from "../server/do-sql-fake.mjs";
import { hostWorkspace } from "../server/cloud/host.mjs";
import { SqlFiles } from "../server/file-store.mjs";
import { asPerson, SYSTEM_PERSON } from "../server/identity.mjs";
import { aiPolicy, CODEX, cloudBaseUrl, jwtClaims } from "../server/cloud/ai.mjs";
import { fakeRespond, lastUserText } from "../server/cloud/fake-model.mjs";
import { McpHub } from "../server/mcp/hub.mjs";
import { cloudWebFetch } from "../server/cloud/web-cloud.mjs";
import { entryFrom } from "../server/preapprovals.mjs";

const ANA = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" };
const BETO = { id: "22222222-2222-4222-8222-222222222222", name: "Beto", email: "beto@example.com", role: "member" };
const GIL = { id: "33333333-3333-4333-8333-333333333333", name: "Gil", email: "gil@example.com", role: "guest" };
const DORA = { id: "55555555-5555-4555-8555-555555555555", name: "Dora", email: "dora@example.com", role: "member" };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 8000, step = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw Error("timed out");
    await wait(step);
  }
}

/** One company on the DO-shaped store; `again()` opens the same storage as a fresh wake-up. */
async function company(t, { testing = true, fake = true, fetchImpl = undefined } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-bots-"));
  const key = randomBytes(32);
  const masters = [{ kid: "m1", secret: randomBytes(32).toString("hex") }];
  const workspace = { id: randomBytes(16).toString("hex"), name: "Pruebas" };
  const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
  const servers = [];
  const open = async () => {
    const store = new Store(path.join(dir, "virtual-root"), { driver: new DoDriver(storage), keyProvider: () => key });
    const host = hostWorkspace({ store, workspace, masters, files: new SqlFiles(storage.sql), log: () => {}, publicUrl: "https://app.example.com", testing, fetchImpl, previews: false });
    host.syncMembers([ANA, BETO, GIL, DORA], { name: "Pruebas" });
    if (fake) host.setTestFlags({ fakeModel: true });
    const server = http.createServer(host.app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    servers.push({ server, host, store });
    const base = "http://127.0.0.1:" + server.address().port;
    const as = (person) => async (method, route, body) => {
      const r = await fetch(base + "/api" + route, {
        method, headers: { "Content-Type": "application/json", ...(person ? { "X-Colmena-Person": JSON.stringify(person) } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let data = null;
      try { data = await r.json(); } catch {}
      return { status: r.status, data };
    };
    return { store, host, as, base };
  };
  const close = async (one) => {
    one.host.bots.close();
    await one.host.runtime.shutdown();
    one.server.closeAllConnections();
    await new Promise((r) => one.server.close(r));
  };
  t.after(async () => {
    for (const one of servers.splice(0)) await close(one).catch(() => {});
    try { storage.close?.(); } catch {}
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  const first = await open();
  return { ...first, again: async () => { const old = servers.at(-1); old.host.bots.close(); old.server.closeAllConnections(); await new Promise((r) => old.server.close(r)); return open(); } };
}
const generalOf = async (as) => (await as("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
const settled = (host) => until(() => host.runtime.jobs.size === 0 && host.runtime.active.size === 0);

test("fake model: plans, app actions, slow answers, plain answers", async () => {
  const plan = await fakeRespond({ input: [{ role: "user", content: "Haced el informe [[plan:nora,vera]]" }], tools: [{ name: "propose_plan" }] });
  assert.equal(plan.output[0].name, "propose_plan");
  assert.deepEqual(JSON.parse(plan.output[0].arguments).assignments.map((a) => a.botId), ["nora", "vera"]);
  const app = await fakeRespond({ input: [{ role: "user", content: "[[app:GMAIL_SEND_EMAIL]]" }], tools: [{ name: "apps_execute" }] });
  assert.equal(JSON.parse(app.output[0].arguments).tool, "GMAIL_SEND_EMAIL");
  const plain = await fakeRespond({ instructions: "Eres Nora, investigadora.", input: [{ role: "user", content: "<@bot:nora> ¿qué tal?" }] });
  assert.equal(plain.text, "Nora (modelo de prueba): ¿qué tal?");
  const controller = new AbortController();
  const slow = fakeRespond({ input: [{ role: "user", content: "[[slow:5000]]" }], signal: controller.signal });
  controller.abort(Error("parado"));
  await assert.rejects(slow, /parado/);
  assert.equal(lastUserText([{ role: "user", content: [{ type: "input_text", text: "hola" }] }, { type: "function_call_output", output: "{}" }]), "hola");
});

test("the fake model needs the Worker's permission and the workspace's flag", async (t) => {
  const { host, as } = await company(t, { testing: false, fake: false });
  assert.throws(() => host.setTestFlags({ fakeModel: true }), /no están permitidas/);
  const state = (await as(ANA)("GET", "/state")).data;
  assert.equal(state.ai.fake, false);
  assert.equal(state.ai.mine, false);
});

test("AI accounts are per person: keys, config and vault apart; the terms switch starts off and only admins move it", async (t) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization || init.headers?.authorization || null, body: init.body ? String(init.body) : null });
    if (String(url).endsWith("/v1/models")) return Response.json({ data: [{ id: "gpt-5" }] });
    if (String(url).includes("/deviceauth/usercode")) return Response.json({ device_auth_id: "dev-1", user_code: "ABCD-1234", interval: "5" });
    if (String(url).includes("/deviceauth/token")) return new Response("{}", { status: 403 });
    return new Response("{}", { status: 404 });
  };
  const { host, as, store } = await company(t, { fake: false, fetchImpl });
  const ana = as(ANA), beto = as(BETO);
  assert.equal((await ana("POST", "/auth/apikey", { key: "sk-ana-" + "a".repeat(40) })).status, 200);
  const provider = host.bots.provider;
  assert.equal(asPerson(ANA, () => provider.config().apikey.hint), "aaaa");
  assert.equal(asPerson(BETO, () => provider.config().apikey), null, "Beto has nothing yet");
  assert.equal(provider.connectedFor(ANA.id), true);
  assert.equal(provider.connectedFor(BETO.id), false);
  assert.equal(asPerson(SYSTEM_PERSON, () => provider.status().kind), "cloud", "background work knows someone can think");
  assert.ok(store.get("sealedSecrets", "ai-" + ANA.id + ":openai-apikey"), "Ana's key sealed in her own namespace");
  assert.equal(store.get("sealedSecrets", "ai-" + BETO.id + ":openai-apikey"), null);
  assert.ok(!JSON.stringify(store.get("providers", "person:" + ANA.id)).includes("aaaaaaaaaa"), "the config keeps the last four characters only");
  // Each person's key is the one their calls use.
  assert.equal(await asPerson(ANA, () => provider.hub(ANA.id).loadKey()), "sk-ana-" + "a".repeat(40));
  assert.equal(await asPerson(BETO, () => provider.hub(BETO.id).loadKey()), null);
  // Desktop-only sign-ins are refused; the screen's state says whose account is connected.
  assert.equal((await ana("POST", "/auth/start", {})).status, 404);
  assert.equal((await ana("POST", "/auth/local", { baseUrl: "http://127.0.0.1:1234", model: "x" })).status, 404);
  assert.equal((await ana("GET", "/state")).data.ai.mine, true);
  assert.equal((await beto("GET", "/state")).data.ai.mine, false);
  // Subscriptions: off by default; a member cannot turn them on; with them off nothing is asked of OpenAI.
  assert.deepEqual([aiPolicy(store).chatgptLogin, aiPolicy(store).claudeToken], [false, false]);
  const before = calls.length;
  assert.equal((await beto("POST", "/cloud/ai/chatgpt/device", {})).status, 403);
  assert.equal(calls.length, before, "no request to OpenAI while the switch is off");
  assert.match((await beto("POST", "/auth/anthropic", { method: "token", secret: "sk-ant-oat01-" + "x".repeat(80) })).data.error, /desactivado/);
  assert.equal((await beto("PUT", "/cloud/ai/policy", { chatgptLogin: true })).status, 403);
  const info = (await beto("GET", "/cloud/ai")).data;
  assert.match(info.warnings.claude, /prohíbe/);
  assert.match(info.warnings.chatgpt, /Sign in with ChatGPT/);
  assert.equal((await ana("PUT", "/cloud/ai/policy", { chatgptLogin: true })).data.policy.chatgptLogin, true);
  const code = (await beto("POST", "/cloud/ai/chatgpt/device", {})).data;
  assert.deepEqual([code.userCode, code.verificationUrl], ["ABCD-1234", CODEX.verifyUrl]);
  assert.equal(JSON.parse(calls.find((c) => c.url.includes("usercode")).body).client_id, CODEX.clientId);
  assert.equal((await beto("POST", "/cloud/ai/chatgpt/device/poll", {})).data.status, "pending");
  // «Servidor propio» only on a public https address.
  assert.throws(() => cloudBaseUrl("http://192.168.1.20:8000/v1"), /pública con https/);
  assert.throws(() => cloudBaseUrl("https://modelos.local/v1"), /pública con https/);
  assert.equal(cloudBaseUrl("https://llm.example.com/v1/chat/completions"), "https://llm.example.com/v1");
});

test("ChatGPT device code: the code is exchanged at the Codex callback and the tokens stay in the vault", async (t) => {
  const idToken = ["e30", Buffer.from(JSON.stringify({ email: "beto@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "acc-9", chatgpt_plan_type: "plus" } })).toString("base64url"), "sig"].join(".");
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url: String(url), body: init.body ? String(init.body) : "", headers: init.headers || {} });
    if (String(url).includes("/deviceauth/usercode")) return Response.json({ device_auth_id: "dev-1", user_code: "WXYZ-9876", interval: "3" });
    if (String(url).includes("/deviceauth/token")) return Response.json({ authorization_code: "code-1", code_verifier: "ver-1", code_challenge: "ch" });
    if (String(url).endsWith("/oauth/token")) return Response.json({ access_token: "acc-token", refresh_token: "ref-token", id_token: idToken, expires_in: 3600 });
    if (String(url).includes("/backend-api/codex/models")) return Response.json({ models: [{ slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" }] });
    return new Response("{}", { status: 404 });
  };
  const { host, as, store } = await company(t, { fake: false, fetchImpl });
  await as(ANA)("PUT", "/cloud/ai/policy", { chatgptLogin: true });
  await as(BETO)("POST", "/cloud/ai/chatgpt/device", {});
  assert.equal((await as(BETO)("POST", "/cloud/ai/chatgpt/device/poll", {})).data.status, "connected");
  const exchange = seen.find((s) => s.url.endsWith("/oauth/token"));
  const form = new URLSearchParams(exchange.body);
  assert.deepEqual([form.get("grant_type"), form.get("code"), form.get("code_verifier"), form.get("redirect_uri"), form.get("client_id")], ["authorization_code", "code-1", "ver-1", CODEX.redirectUri, CODEX.clientId]);
  const hub = host.bots.provider.hub(BETO.id);
  assert.equal(hub.config().chatgpt.email, "beto@example.com");
  assert.ok(!JSON.stringify(hub.config()).includes("acc-token"), "tokens never in the config");
  assert.equal(asPerson(BETO, () => host.bots.provider.status().kind), "chatgpt");
  assert.deepEqual(await hub.session.headers(), { Authorization: "Bearer acc-token", "chatgpt-account-id": "acc-9" });
  assert.equal((await hub.session.listModels())[0].slug, "gpt-5.5");
  assert.equal(jwtClaims(idToken).email, "beto@example.com");
  // The admin turns the switch off: the account stops thinking at once.
  await as(ANA)("PUT", "/cloud/ai/policy", { chatgptLogin: false });
  assert.equal(asPerson(BETO, () => host.bots.provider.status().kind), null);
  await assert.rejects(hub.session.accessToken(), /desactivado/);
  assert.equal(store.list("providers").length >= 1, true);
});

test("a bot named in a channel answers in the thread, as the person who named it; guests cannot start bots", async (t) => {
  const { host, as, store } = await company(t);
  const general = await generalOf(as(BETO));
  const sent = (await as(BETO)("POST", "/chat/channels/" + general.id + "/messages", { text: "<@bot:nora> resume la semana" })).data.message;
  await settled(host);
  const thread = (await as(BETO)("GET", "/chat/messages/" + sent.id + "/thread")).data;
  const replies = thread.replies || thread.messages || [];
  const answer = replies.find((m) => m.author === "bot:nora");
  assert.ok(answer, "Nora answered in the thread");
  assert.match(answer.text, /Nora \(modelo de prueba\): resume la semana/);
  assert.equal(answer.botName, "Nora");
  const mission = store.list("missions").find((m) => m.channelThread?.root === sent.id);
  assert.equal(mission.askedBy, BETO.id, "Beto's account");
  // A reply in the same thread goes on with the same conversation, no name needed.
  await as(ANA)("POST", "/chat/channels/" + general.id + "/messages", { text: "y añade los gastos", thread: sent.id });
  await settled(host);
  assert.equal(store.list("missions").filter((m) => m.channelThread?.root === sent.id).length, 1);
  assert.equal(store.get("missions", mission.id).askedBy, ANA.id, "now Ana asked");
  const after = (await as(ANA)("GET", "/chat/messages/" + sent.id + "/thread")).data;
  assert.equal((after.replies || after.messages).filter((m) => m.author === "bot:nora").length, 2);
  // The bots one may name come with the channel's bootstrap (not for guests).
  assert.ok((await as(BETO)("GET", "/chat/bootstrap")).data.bots.some((b) => b.id === "nora"));
  assert.deepEqual((await as(GIL)("GET", "/chat/bootstrap")).data.bots, []);
});

test("a plan with two bots completes; messaging stays responsive while they work", async (t) => {
  const { host, as, store } = await company(t);
  const general = await generalOf(as(ANA));
  const sent = (await as(ANA)("POST", "/chat/channels/" + general.id + "/messages", { text: "<@bot:nora> <@bot:tomas> preparad el informe [[plan:nora,tomas]] [[slow:300]]" })).data.message;
  // While they work, people keep talking: each post answers quickly.
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    assert.equal((await as(BETO)("POST", "/chat/channels/" + general.id + "/messages", { text: "mensaje " + i })).status, 201);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[Math.floor(times.length / 2)] < 250, "p50 under 250 ms while bots work: " + times.join(","));
  await settled(host);
  const mission = store.list("missions").find((m) => m.channelThread?.root === sent.id);
  assert.equal(mission.status, "completed");
  assert.deepEqual(mission.steps, ["plan", "work-nora", "work-tomas", "synthesis"]);
  const replies = (await as(ANA)("GET", "/chat/messages/" + sent.id + "/thread")).data;
  const authors = new Set((replies.replies || replies.messages).map((m) => m.author));
  assert.ok(authors.has("bot:nora") && authors.has("bot:tomas"), "both bots spoke in the thread");
});

test("work cut by an eviction goes on after the next wake-up, as the person who asked", async (t) => {
  const first = await company(t);
  const general = await generalOf(first.as(ANA));
  const sent = (await first.as(ANA)("POST", "/chat/channels/" + general.id + "/messages", { text: "<@bot:vera> escribe la nota [[slow:3000]]" })).data.message;
  await until(() => first.host.runtime.active.size === 1);
  assert.ok(first.host.nextAlarm(Date.now()) <= Date.now() + 20_000, "the alarm comes back while bots work");
  // The object is evicted: its memory is gone; the next wake-up opens the same storage.
  const second = await first.again();
  const mission = second.store.list("missions").find((m) => m.channelThread?.root === sent.id);
  assert.equal(second.store.get("missions", mission.id).status, "paused");
  assert.ok(second.store.get("missions", mission.id).interrupted, "marked as cut");
  assert.deepEqual(second.host.resume(), [mission.id]);
  await settled(second.host);
  assert.equal(second.store.get("missions", mission.id).status, "completed");
  const thread = (await second.as(ANA)("GET", "/chat/messages/" + sent.id + "/thread")).data;
  assert.ok((thread.replies || thread.messages).some((m) => m.author === "bot:vera"), "Vera's answer reached the thread after the wake-up");
});

test("a routine fires on the alarm with nobody connected; approvals go to the owner and the delegate only; a pre-approval applies", async (t) => {
  const { host, as, store } = await company(t);
  const routine = (await as(ANA)("POST", "/automations", { name: "Limpiar agenda", prompt: "Borra el evento de prueba [[app:GOOGLECALENDAR_DELETE_EVENT]]", botId: "nora", trigger: { type: "cada", config: { cadaN: 1, cadaUnidad: "horas" } } }));
  assert.ok([200, 201].includes(routine.status), JSON.stringify(routine.data));
  const rule = store.list("automations").find((r) => r.name === "Limpiar agenda");
  assert.equal(rule.ownerId, ANA.id, "the routine is Ana's");
  assert.equal((await as(ANA)("PUT", "/automations/" + rule.id + "/approver", { contactId: BETO.id })).data.approver.contactId, BETO.id);
  assert.equal((await as(ANA)("PUT", "/automations/" + rule.id + "/approver", { contactId: "nadie" })).status, 400);
  store.patch("automations", rule.id, { nextRun: new Date(Date.now() - 1000).toISOString() });
  assert.ok(host.nextAlarm(Date.now()) <= Date.now() + 1000, "the alarm wants to run it now");
  // The alarm, as nobody: the run starts and asks for its red line.
  await host.tick({ now: Date.now() });
  const approval = await until(() => store.list("approvals").find((a) => a.tool === "apps_execute" && a.status === "pending"));
  const run = store.get("missions", approval.missionId);
  assert.equal(run.automationId, rule.id);
  assert.deepEqual(store.get("approvals", approval.id).for.sort(), [ANA.id, BETO.id].sort());
  await until(() => store.get("notifications", "approval:" + approval.id));
  assert.deepEqual(store.get("notifications", "approval:" + approval.id).for.sort(), [ANA.id, BETO.id].sort());
  // Dora sees nothing of it and may not decide it.
  assert.equal((await as(DORA)("GET", "/state")).data.approvals.some((a) => a.id === approval.id), false);
  assert.equal((await as(DORA)("GET", "/state")).data.notifications.some((n) => n.id === "approval:" + approval.id), false);
  assert.ok((await as(BETO)("GET", "/state")).data.approvals.some((a) => a.id === approval.id), "the delegate sees it");
  const view = (await as(BETO)("GET", "/connections/review/" + encodeURIComponent(approval.id))).data;
  assert.ok(view.revision, JSON.stringify(view));
  assert.equal((await as(DORA)("POST", "/connections/review/" + encodeURIComponent(approval.id), { decision: "approved", revision: view.revision })).status, 403);
  // The delegate approves: the action runs, the run finishes.
  const decided = await as(BETO)("POST", "/connections/review/" + encodeURIComponent(approval.id), { decision: "approved", revision: view.revision });
  assert.equal(decided.status, 200, JSON.stringify(decided.data));
  await settled(host);
  assert.equal(host.bots.testApps.effects.length, 1);
  assert.equal(store.get("missions", run.id).status, "completed");
  // «Siempre» for this routine: the next run does it with nobody there and no question.
  store.patch("automations", rule.id, (old) => ({ preapprovals: [entryFrom(store.get("approvals", approval.id), { uses: "always" })], nextRun: new Date(Date.now() - 1000).toISOString(), lastMissionId: old.lastMissionId }));
  await host.tick({ now: Date.now() });
  await until(() => host.bots.testApps.effects.length === 2);
  await settled(host);
  const second = store.list("approvals").filter((a) => a.tool === "apps_execute").find((a) => a.id !== approval.id);
  assert.equal(second.decidedBy, "rutina");
  assert.match(second.resolution, /Aprobado por adelantado en la rutina «Limpiar agenda»/);
});

test("bots by role: guests cannot change bots; members edit the bots they made; admins any", async (t) => {
  const { as, store } = await company(t);
  assert.equal((await as(GIL)("PATCH", "/bots/nora", { name: "Norita" })).status, 403);
  assert.equal((await as(DORA)("PATCH", "/bots/nora", { name: "Norita" })).status, 403, "a member does not edit a seeded bot");
  store.put("bots", { ...store.get("bots", "nora"), id: "dora-bot", name: "Ayudante", createdBy: DORA.id });
  assert.notEqual((await as(DORA)("PATCH", "/bots/dora-bot", { name: "Ayudante 2" })).status, 403);
  assert.notEqual((await as(ANA)("PATCH", "/bots/nora", { name: "Nora" })).status, 403);
});

test("webhooks arrive at the workspace's public address and start their routine", async (t) => {
  const { host, as, store } = await company(t);
  const created = await as(ANA)("POST", "/automations", { name: "Aviso de la tienda", prompt: "Mira el pedido", botId: "nora", trigger: { type: "webhook", config: { servicio: "generico" } } });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
  const rule = store.list("automations").find((r) => r.name === "Aviso de la tienda");
  const view = (await as(ANA)("GET", "/automations/" + rule.id + "/webhook")).data;
  assert.match(view.url || view.address || "", /^https:\/\/app\.example\.com\/hooks\/[0-9a-f]+\/h\//);
  const hookId = store.get("webhooks", rule.id).hookId;
  await host.hook(hookId, { headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ pedido: 42 })) });
  await until(() => store.list("missions").some((m) => m.automationId === rule.id));
  await settled(host);
  assert.equal(await host.hook("desconocido", { body: Buffer.from("{}") }), true, "an unknown address is ignored");
});

test("MCP sign-in on a public redirect survives a restart between the redirect and the callback", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-mcp-public-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  const saved = new Map();
  const secrets = { load: async (b) => saved.get(b.profile) || null, save: async (b, v) => { saved.set(b.profile, structuredClone(v)); }, remove: async (p) => { saved.delete(p); } };
  const redirect = "https://app.example.com/api/mcp/oauth/callback";
  let finished = null;
  const transports = (_url, provider) => ({
    async start() {
      if (finished) throw Error("sin servidor de prueba");
      const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
      await provider.saveCodeVerifier("verificador-1");
      provider.redirectToAuthorization(new URL("https://mcp.example.com/authorize?redirect_uri=" + encodeURIComponent(provider.redirectUrl) + "&state=" + provider.state()));
      throw new UnauthorizedError("needs auth");
    },
    async finishAuth(code) { finished = { code, verifier: provider.codeVerifier() }; },
    async close() {}, async send() {}, set onmessage(_) {}, set onclose(_) {}, set onerror(_) {},
  });
  const hub = new McpHub(store, { secrets, redirect, transports });
  const out = await hub.connect({ url: "https://mcp.example.com/mcp", name: "Prueba" });
  const authorize = new URL(out.authorizeUrl);
  assert.equal(authorize.searchParams.get("redirect_uri"), redirect, "the public redirect, never a loopback one");
  const state = authorize.searchParams.get("state");
  // The server restarts: a new hub over the same records and vault finds the sign-in by its state.
  const again = new McpHub(store, { secrets, redirect, transports });
  assert.equal(store.list("mcpServers")[0].status, "needs_auth", "a public sign-in is not dropped on restart");
  await again.publicCallback({ state, code: "codigo-1" }).catch(() => false);
  assert.deepEqual(finished, { code: "codigo-1", verifier: "verificador-1" });
  assert.equal(await again.publicCallback({ state: "0".repeat(32), code: "x" }), false, "an unknown state does nothing");
});

test("web_fetch in the cloud refuses private addresses and follows checked redirects", async () => {
  const pages = {
    "https://pagina.example.com/": { status: 302, headers: { location: "https://otra.example.com/fin" } },
    "https://otra.example.com/fin": { status: 200, headers: { "content-type": "text/html" }, body: "<html><title>Fin</title><body><p>Hola mundo</p></body></html>" },
    "https://trampa.example.com/": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } },
  };
  const dns = { "pagina.example.com": "93.184.216.34", "otra.example.com": "93.184.216.35", "trampa.example.com": "93.184.216.36", "interna.example.com": "10.0.0.5" };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.startsWith("https://cloudflare-dns.com/")) {
      const q = new URL(u);
      const ip = dns[q.searchParams.get("name")];
      return Response.json({ Answer: ip && q.searchParams.get("type") === "A" ? [{ type: 1, data: ip }] : [] });
    }
    const p = pages[u];
    if (!p) return new Response("no", { status: 404 });
    return new Response(p.body || null, { status: p.status, headers: p.headers });
  };
  const web = cloudWebFetch({ fetchImpl });
  const page = await web("https://pagina.example.com/");
  assert.equal(page.finalUrl, "https://otra.example.com/fin");
  assert.match(page.text, /Hola mundo/);
  await assert.rejects(web("https://interna.example.com/"), /solo páginas públicas/);
  await assert.rejects(web("https://trampa.example.com/"), /solo páginas públicas/);
  await assert.rejects(web("http://127.0.0.1/"), /solo páginas públicas/);
  assert.equal(createHmac("sha256", "x").update("y").digest("hex").length, 64);
});
