// The connections marketplace (docs/CONNECTIONS.md › Marketplace): the catalogue's shape, Colmena's
// own Google client with a fake Google (PKCE, state, per-person tokens, refresh), official local
// servers through the process seam (desktop child and the machine's /machine/mcp), the IMAP/SMTP
// mail connector against a fake mailbox, red lines of MCP tools, secrets sealed in the vault, and
// isolation between companies and people. No real Google, Composio or mail provider is reached.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn as nodeSpawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { fakeMail } from "./fixtures/fake-mail.mjs";
import { Store } from "../server/store.mjs";
import { asPerson } from "../server/identity.mjs";
import { McpHub } from "../server/mcp/hub.mjs";
import { mcpExtraTools, mcpPolicy, emailOf, applyEmail } from "../server/mcp/tools.mjs";
import { CATALOG, CATEGORIES, entryView } from "../server/mcp/catalog.mjs";
import { RESTRICTED_SCOPES, checkScopes, googleClient } from "../server/mcp/google.mjs";
import { LocalMcpHost, machineMcp, machineMcpRoute } from "../server/mcp/local.mjs";
import { composeMessage, decodeWords, mailSettings, parseMime } from "../server/mcp/mail.mjs";
import { envelopeVault, WorkspaceKeyring } from "../server/envelope-vault.mjs";
import { registerMcpRoutes } from "../server/mcp/routes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = path.join(here, "fixtures", "fake-stdio-mcp.mjs");
const ANA = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" };
const BETO = { id: "22222222-2222-4222-8222-222222222222", name: "Beto", email: "beto@example.com", role: "member" };

function memorySecrets() {
  const saved = new Map();
  return { saved, load: async (b) => structuredClone(saved.get(b.profile) || null), save: async (b, d) => { saved.set(b.profile, structuredClone(d)); }, remove: async (p) => saved.delete(p) };
}
async function tempStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-market-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return store;
}

// ------------------------------------------------------------------ a fake Google

/** Google's authorize and token endpoints, enough for PKCE, codes, refresh and revoke. */
function fakeGoogle() {
  const challenges = new Map(); // code → challenge
  const calls = [];
  let issued = 0;
  const endpoints = { authorize: "https://accounts.google.example/o/oauth2/v2/auth", token: "https://oauth2.google.example/token", revoke: "https://oauth2.google.example/revoke" };
  const fetchImpl = async (url, init) => {
    const body = Object.fromEntries(new URLSearchParams(String(init?.body || "")));
    calls.push({ url: String(url), body });
    if (String(url) === endpoints.revoke) return new Response("{}", { status: 200 });
    if (body.client_id !== "colmena-test.apps.example" || body.client_secret !== "secreto-de-prueba") return Response.json({ error: "invalid_client" }, { status: 401 });
    if (body.grant_type === "authorization_code") {
      const challenge = challenges.get(body.code);
      const ok = challenge && createHash("sha256").update(body.code_verifier || "").digest("base64url") === challenge;
      if (!ok) return Response.json({ error: "invalid_grant", error_description: "PKCE" }, { status: 400 });
      const who = body.code.split("-")[1];
      return Response.json({ access_token: "at-" + who + "-" + ++issued, refresh_token: "rt-" + who, expires_in: 3600, scope: "x" });
    }
    if (body.grant_type === "refresh_token") return Response.json({ access_token: "at-" + body.refresh_token.slice(3) + "-r" + ++issued, expires_in: 3600 });
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  };
  /** The person consents: Google remembers the challenge and hands back a code. */
  const consent = (authorizeUrl, who) => {
    const u = new URL(authorizeUrl);
    const code = "code-" + who + "-" + randomBytes(3).toString("hex");
    challenges.set(code, u.searchParams.get("code_challenge"));
    return { code, state: u.searchParams.get("state"), params: u.searchParams };
  };
  return { endpoints, fetchImpl, consent, calls };
}
const CLIENT = { clientId: "colmena-test.apps.example", clientSecret: "secreto-de-prueba", project: "colmena-pruebas" };

/** A remote MCP server in memory that records the Authorization header of each connection. */
function bigQueryFake(seen) {
  return (url, provider, kind, headers) => {
    seen.push(headers?.Authorization || null);
    const server = new McpServer({ name: "bq", version: "1.0.0" });
    server.registerTool("execute_sql_readonly", { description: "SQL de solo lectura", inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } }, async ({ query }) => ({ content: [{ type: "text", text: "filas para " + query }] }));
    server.registerTool("execute_sql", { description: "SQL", inputSchema: { query: z.string() } }, async () => ({ content: [{ type: "text", text: "hecho" }] }));
    const [client, srv] = InMemoryTransport.createLinkedPair();
    server.connect(srv);
    return client;
  };
}

// ------------------------------------------------------------------ the catalogue

test("catalogue: every listed entry is complete, verified, and never asks Google for a restricted scope", () => {
  const ids = new Set();
  for (const e of CATALOG) {
    assert.ok(!ids.has(e.id), "unique id " + e.id);
    ids.add(e.id);
    assert.ok(e.name && e.vendor && e.description, e.id + ": name, vendor, description");
    assert.ok(CATEGORIES[e.category], e.id + ": category");
    assert.ok(["oauth", "token", "google", "mail", "composio"].includes(e.auth), e.id + ": auth");
    assert.ok(["remote", "local", "builtin", "composio"].includes(e.run), e.id + ": run");
    assert.ok(["stable", "beta", "preview"].includes(e.status), e.id + ": status");
    assert.match(e.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, e.id + ": verified on a date");
    assert.ok(e.sources.length && e.sources.every((s) => s.startsWith("https://")), e.id + ": sources");
    assert.ok(e.can?.read && e.can?.write, e.id + ": what bots can do");
    if (e.run === "remote") assert.match(e.endpoint, /^https:\/\//, e.id + ": https endpoint");
    if (e.auth === "token") assert.ok(e.token?.header && e.token?.label && e.token?.where, e.id + ": where the token goes and where to find it");
    if (e.auth === "composio" && e.id !== "composio") assert.ok(e.toolkit, e.id + ": Composio toolkit");
    if (e.auth === "composio") assert.ok(e.thirdParty, e.id + ": says the data passes through a third party");
    if (e.auth === "google" && !e.blocked) assert.doesNotThrow(() => checkScopes(e.scopes), e.id + ": only sensitive or non-sensitive scopes");
    if (e.blocked) assert.match(e.blocked, /./, e.id + ": says why it is not available yet");
    if (e.run === "local") assert.ok(e.local?.package && e.local?.version && e.local?.command, e.id + ": pinned package");
  }
  assert.ok(RESTRICTED_SCOPES.has("https://www.googleapis.com/auth/gmail.readonly"));
  assert.throws(() => checkScopes(["https://www.googleapis.com/auth/adwords"]), /restringido/);
  // Without Colmena's Google client, Google entries read «Disponible pronto»; blocked ones always do.
  const ga = CATALOG.find((e) => e.id === "google-analytics");
  assert.equal(entryView(ga, { google: false }).availability, "soon");
  assert.equal(entryView(ga, { google: true }).availability, "ready");
  assert.equal(entryView(CATALOG.find((e) => e.id === "google-ads"), { google: true }).availability, "soon", "the Ads scope is restricted");
  assert.equal(entryView(CATALOG.find((e) => e.id === "google-calendar-mcp"), { google: true }).availability, "soon", "Workspace MCP in preview");
  assert.equal(googleClient({}), null);
  assert.deepEqual(googleClient({ COLMENA_GOOGLE_CLIENT_ID: CLIENT.clientId, COLMENA_GOOGLE_CLIENT_SECRET: "x", COLMENA_GOOGLE_PROJECT: "p" }), { clientId: CLIENT.clientId, clientSecret: "x", project: "p", kind: "web" });
});

// ------------------------------------------------------------------ red lines

test("red lines of MCP tools: annotations and names; hints never take a red line away", () => {
  const cases = [
    [{ name: "search_threads" }, "gmail", "free"],
    [{ name: "execute_sql_readonly" }, "bigquery", "free"],
    [{ name: "execute_sql" }, "bigquery", "redline"],
    [{ name: "create_draft", annotations: { readOnlyHint: false, destructiveHint: false } }, "mail", "approval"],
    [{ name: "send_message", annotations: { readOnlyHint: false, openWorldHint: true } }, "mail", "redline"],
    [{ name: "post_message", annotations: { readOnlyHint: true } }, "slack", "redline"],
    [{ name: "delete_event" }, "google-calendar-mcp", "redline"],
    [{ name: "update_record", annotations: { destructiveHint: true } }, "airtable", "redline"],
    [{ name: "create_customer" }, "stripe", "redline"],
    [{ name: "list_customers" }, "stripe", "free"],
    [{ name: "create_campaign", annotations: { openWorldHint: true } }, "brevo", "redline"],
    [{ name: "create_issue" }, "linear", "approval"],
    [{ name: "book_event" }, "calendly", "redline"],
    [{ name: "run_report", annotations: { readOnlyHint: true } }, "google-analytics", "free"],
    [{ name: "merge_pull_request" }, "github", "redline"],
    [{ name: "notion-create-pages" }, "notion", "approval"],
  ];
  for (const [tool, server, want] of cases) assert.equal(mcpPolicy(tool, server), want, server + " " + tool.name);
  const mail = emailOf({ to: ["luis@example.com"], subject: "Hola", body: "Texto" });
  assert.deepEqual(mail.email, { to: ["luis@example.com"], cc: [], cco: [], subject: "Hola", body: "Texto" });
  assert.deepEqual(applyEmail({ recipient_email: "a@example.com", subject: "x", body: "y" }, { to: ["b@example.com", "c@example.com"], cc: [], cco: [], subject: "Nuevo", body: "Otro" }, { to: "recipient_email", subject: "subject", body: "body" }),
    { recipient_email: "b@example.com, c@example.com", subject: "Nuevo", body: "Otro" });
  assert.equal(emailOf({ query: "x" }), null);
});

// ------------------------------------------------------------------ Colmena's Google client

test("Google with Colmena's own client: PKCE and state, one person's tokens, refresh, nobody else sees them", async (t) => {
  const store = await tempStore(t);
  const g = fakeGoogle();
  const headers = [];
  const redirect = "https://app.example.com/api/mcp/oauth/callback";
  const options = { secrets: memorySecrets(), redirect, google: { web: CLIENT, endpoints: g.endpoints, fetchImpl: g.fetchImpl }, transports: bigQueryFake(headers), local: null };
  const hub = new McpHub(store, options);
  t.after(() => hub.shutdown());

  // Without the client: «Disponible pronto».
  const bare = new McpHub(store, { ...options, google: null });
  await asPerson(ANA, () => assert.rejects(bare.connect({ catalogId: "bigquery" }), /Disponible pronto/));

  const out = await asPerson(ANA, () => hub.connect({ catalogId: "bigquery" }));
  const { code, state, params } = g.consent(out.authorizeUrl, "ana");
  assert.equal(params.get("client_id"), CLIENT.clientId);
  assert.equal(params.get("redirect_uri"), redirect);
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("access_type"), "offline");
  assert.match(params.get("scope"), /auth\/bigquery/);
  assert.match(state, /^[0-9a-f]{32}$/);
  assert.equal(out.server.status, "needs_auth");

  // A wrong state does nothing; a restart in between still finishes (verifier kept with the state).
  assert.equal(await hub.publicCallback({ state: "f".repeat(32), code }), false);
  const again = new McpHub(store, options);
  t.after(() => again.shutdown());
  assert.equal(await again.publicCallback({ state, code }), true);
  const s = store.list("mcpServers").find((x) => x.catalogId === "bigquery");
  assert.equal(s.status, "connected");
  assert.equal(s.owner, ANA.id, "always the person's own");
  assert.deepEqual(s.tools.map((x) => x.name).sort(), ["execute_sql", "execute_sql_readonly"]);
  assert.equal(headers.at(-1), "Bearer at-ana-1");
  const exchange = g.calls.find((c) => c.body.grant_type === "authorization_code");
  assert.ok(exchange.body.code_verifier, "the verifier went with the code");

  // Stale token: refreshed once, the refresh token kept, the new one used.
  const secret = await options.secrets.load({ profile: "mcp-" + s.id });
  await options.secrets.save({ profile: "mcp-" + s.id }, { ...secret, google: { ...secret.google, expires_at: Date.now() - 1000 } });
  again.cache.delete(s.id);
  again.close(s.id);
  const result = await asPerson(ANA, () => again.callTool(s.id, "execute_sql_readonly", { query: "select 1" }));
  assert.match(result.content[0].text, /filas para select 1/);
  assert.match(headers.at(-1), /^Bearer at-ana-r\d+$/);
  assert.equal((await options.secrets.load({ profile: "mcp-" + s.id })).google.refresh_token, "rt-ana");

  // Beto (same company) neither sees nor uses Ana's Google connection.
  await asPerson(BETO, async () => {
    assert.equal(again.servers().length, 0);
    assert.throws(() => again.server(s.id), /ya no existe/);
    await assert.rejects(again.callTool(s.id, "execute_sql_readonly", { query: "x" }), /ya no existe/);
    await assert.rejects(again.remove(s.id), /ya no existe/);
  });
  // Ana disconnects: Google is told to forget the grant.
  await asPerson(ANA, () => again.remove(s.id));
  assert.ok(g.calls.some((c) => c.url === g.endpoints.revoke && c.body.token === "rt-ana"));
});

// ------------------------------------------------------------------ local servers through the seam

test("official local servers run through the process seam with the person's credential, on the desktop and in the machine", async (t) => {
  const store = await tempStore(t);
  const g = fakeGoogle();
  const runDir = await mkdtemp(path.join(os.tmpdir(), "colmena-mcp-run-"));
  t.after(() => rm(runDir, { recursive: true, force: true }).catch(() => {}));
  // The seam's spawn: «analytics-mcp» is the fake stdio server here (a real child process).
  const spawned = [];
  const spawn = (command, args, opts) => { spawned.push(command); return nodeSpawn(process.execPath, [FAKE_SERVER], opts); };
  const local = new LocalMcpHost({ spawn, dir: runDir });
  const hub = new McpHub(store, { secrets: memorySecrets(), google: { desktop: CLIENT, endpoints: g.endpoints, fetchImpl: g.fetchImpl }, local, localCommand: (e) => ({ command: e.local.command, args: [] }) });
  t.after(() => hub.shutdown());

  // Desktop: the sign-in comes back to a loopback listener of this connection only.
  const out = await hub.connect({ catalogId: "google-analytics" });
  const { code, state, params } = g.consent(out.authorizeUrl, "ana");
  const back = new URL(params.get("redirect_uri"));
  assert.equal(back.hostname, "127.0.0.1");
  const page = await fetch(back.href + "?state=" + state + "&code=" + code).then((r) => r.text());
  assert.match(page, /Conectado/);
  const s = store.list("mcpServers").find((x) => x.catalogId === "google-analytics");
  assert.equal(s.status, "connected");
  assert.deepEqual(s.tools.map((x) => x.name), ["get_account_summaries"]);
  assert.deepEqual(spawned, ["analytics-mcp"]);
  const r = await hub.callTool(s.id, "get_account_summaries", {});
  const data = JSON.parse(r.content[0].text);
  assert.equal(data.credential, "authorized_user");
  assert.equal(data.refresh, "rt-ana");
  assert.equal(data.project, "colmena-pruebas");
  assert.ok(data.file.startsWith(runDir), "the credential file lives only in the run folder");
  await local.close(s.id);
  assert.equal(existsSync(data.file), false, "and is gone when the server stops");

  // The machine: the same host behind /machine/mcp, reached through the seam's request.
  const app = express();
  app.use(express.json());
  const machineHost = new LocalMcpHost({ spawn, dir: runDir });
  app.post("/machine/mcp", machineMcpRoute(machineHost));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await machineHost.shutdown(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const remote = machineMcp({ request: (p, init) => fetch(base + p, init) });
  const spec = { command: "/opt/mcp/bin/analytics-mcp", args: [], env: { GOOGLE_APPLICATION_CREDENTIALS: "${file:adc.json}" }, files: { "adc.json": { type: "authorized_user", refresh_token: "rt-beto" } } };
  assert.deepEqual((await remote.listTools("bq-beto", spec)).map((x) => x.name), ["get_account_summaries"]);
  assert.equal(JSON.parse((await remote.callTool("bq-beto", spec, "get_account_summaries", {})).content[0].text).refresh, "rt-beto");
  await assert.rejects(remote.listTools("x", { ...spec, command: "/bin/sh" }), /no válido/, "only the image's MCP servers run");
});

// ------------------------------------------------------------------ mail

test("mail parsing: encoded words, quoted-printable and a composed message", () => {
  assert.equal(decodeWords("=?UTF-8?Q?Reuni=C3=B3n_del_jueves?="), "Reunión del jueves");
  const m = parseMime(Buffer.from("Subject: x\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=C2=BFQuedamos?"));
  assert.equal(m.text, "¿Quedamos?");
  const raw = composeMessage({ from: "ana@example.com", to: ["luis@example.com"], subject: "Café mañana", body: "Hola" });
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.doesNotMatch(raw, /^Bcc:/m);
  assert.equal(parseMime(Buffer.from(raw)).text, "Hola");
  assert.throws(() => mailSettings({ email: "ana@outlook.com", password: "x".repeat(16) }), /OAuth/, "Microsoft says why");
  assert.equal(mailSettings({ email: "ana@gmail.com", password: "abcd efgh ijkl mnop" }).imap.host, "imap.gmail.com");
  assert.throws(() => mailSettings({ email: "a@empresa.example", password: "x".repeat(16), imap: { host: "mail.empresa.example", port: 993 }, smtp: { host: "mail.empresa.example", port: 25 } }), /puerto 25/);
});

test("mail with an app password: bots read at once, drafts wait for an OK, a send is a red line reviewed as an email", async (t) => {
  const fm = await fakeMail();
  t.after(() => fm.close());
  let round = 0;
  let seen = [], raw = [];
  const { store, runtime } = await fixture(t, async ({ input }) => {
    round += 1;
    if (round === 1) return call("mcp_call", { server: "correo-ana", tool: "search_messages", arguments_json: JSON.stringify({ query: "presupuesto" }) }, "m1");
    if (round === 2) {
      const found = JSON.parse(outputs(input).at(-1).result.split("\n").find((l) => l.startsWith("{")));
      return call("mcp_call", { server: "correo-ana", tool: "read_message", arguments_json: JSON.stringify({ id: found.messages[0].id }) }, "m2");
    }
    if (round === 3) return call("mcp_call", { server: "correo-ana", tool: "create_draft", arguments_json: JSON.stringify({ to: ["luis@example.com"], subject: "Re: Presupuesto de marzo", body: "Gracias, lo miro." }) }, "m3");
    if (round === 4) return call("mcp_call", { server: "correo-ana", tool: "send_message", arguments_json: JSON.stringify({ to: ["luis@example.com"], subject: "Presupuesto", body: "Te confirmo el presupuesto." }) }, "m4");
    seen = outputs(input);
    raw = input.filter((x) => x.type === "function_call_output").map((x) => x.output);
    return answer("Hecho.");
  });
  const hub = new McpHub(store, { secrets: memorySecrets(), allowPlain: true, local: null });
  t.after(() => hub.shutdown());
  await assert.rejects(hub.connect({ catalogId: "mail", mail: { ...fm.settings, password: "mala-clave-123" } }), /no son correctos/);
  assert.equal(store.list("mcpServers").length, 0, "a wrong password keeps nothing");
  const out = await hub.connect({ catalogId: "mail", mail: fm.settings });
  assert.equal(out.server.status, "connected");
  assert.equal(out.server.id, "correo-ana");
  assert.equal(out.server.url, null, "the mailbox address is not an MCP url");
  assert.equal(out.server.toolCount, 8);
  runtime.extraTools = mcpExtraTools(runtime, hub);

  const m = runtime.create({ prompt: "Responde a Luis por el presupuesto", mode: "solo", botIds: ["bruno"] });
  await runtime.launch(m.id);
  await settle(runtime);
  // Reading ran at once; the draft waits for the OK (it stays in the account: not a red line).
  const draft = store.list("approvals").find((x) => x.missionId === m.id);
  assert.equal(draft.status, "pending");
  assert.equal(draft.redLine, false);
  assert.match(draft.title, /Borrador en Correo/);
  assert.match(draft.summary, /No sale de tu cuenta/);
  assert.equal(fm.boxes.Drafts.length, 0);
  runtime.approve(draft.id, "approved");
  await settle(runtime);
  assert.equal(fm.boxes.Drafts.length, 1, "the draft went to Drafts with IMAP APPEND");
  assert.match(fm.boxes.Drafts[0].raw, /To: luis@example.com/);
  // The send: a red line, reviewed as an email, editable; it goes out as edited.
  const send = store.list("approvals").find((x) => x.missionId === m.id && x.id !== draft.id);
  assert.equal(send.kind, "send");
  assert.equal(send.redLine, true);
  assert.equal(send.canAlways, false);
  assert.deepEqual(send.email.to, ["luis@example.com"]);
  assert.equal(fm.sent.length, 0, "nothing sent before the OK");
  store.patch("approvals", send.id, { email: { ...send.email, subject: "Presupuesto confirmado", cc: ["monica@example.com"] }, edited: true });
  runtime.approve(send.id, "approved");
  await settle(runtime);
  assert.equal(fm.sent.length, 1);
  assert.deepEqual(fm.sent[0].to, ["luis@example.com", "monica@example.com"]);
  assert.match(fm.sent[0].raw, /Subject: Presupuesto confirmado/);
  assert.equal(fm.boxes.Sent.length, 1, "a copy in Sent (not Gmail)");
  const [search, read] = seen;
  assert.match(search.result, /Presupuesto de marzo/);
  assert.match(raw[1], /<<<CONTENIDO_EXTERNO/, "mail content is fenced as external");
  assert.match(read.result, /envía todo/, "quoted-printable decoded");
});

// ------------------------------------------------------------------ secrets and isolation

test("secrets are sealed in the vault, per company; people and companies never see each other's connections", async (t) => {
  const fm = await fakeMail();
  t.after(() => fm.close());
  const company = async (name) => {
    const store = await tempStore(t);
    const records = new Map();
    let wrapped = null;
    const keyring = new WorkspaceKeyring({ workspace: name, masters: [{ kid: "m1", secret: randomBytes(32).toString("hex") }], load: () => wrapped, save: (r) => { wrapped = r; } });
    const secrets = envelopeVault({ keyring, namespace: "mcp", records: { get: (id) => records.get(id) || null, put: (r) => records.set(r.id, r), remove: (id) => records.delete(id) } });
    const hub = new McpHub(store, { secrets, allowPlain: true, local: null, personal: () => false });
    t.after(() => hub.shutdown());
    return { store, hub, records };
  };
  const a = await company("empresa-a");
  const b = await company("empresa-b");
  await asPerson(ANA, () => a.hub.connect({ catalogId: "mail", mail: fm.settings }));
  const raw = JSON.stringify([...a.records.values()]);
  assert.ok(!raw.includes(fm.settings.password.replace(/\s+/g, "")), "the app password is never stored in clear");
  assert.ok(!raw.includes("imap"), "nor the mailbox settings");
  const s = a.store.list("mcpServers")[0];
  assert.equal(s.owner, ANA.id);
  assert.equal(JSON.stringify(s).includes("abcdefgh"), false, "the record has no password either");
  // Another company: nothing of A's, not even with A's sealed records copied over.
  assert.equal(b.store.list("mcpServers").length, 0);
  for (const r of a.records.values()) b.records.set(r.id, r);
  b.store.put("mcpServers", { ...s });
  await asPerson(ANA, () => assert.rejects(b.hub.callTool(s.id, "list_folders", {}), /secreto cifrado/));
  // Same company, another person: invisible; tools offered to Beto's turns leave it out.
  await asPerson(BETO, async () => {
    assert.deepEqual(a.hub.servers(), []);
    assert.deepEqual(mcpExtraTools({ store: a.store }, a.hub)(), []);
    await assert.rejects(a.hub.connect({ catalogId: "notion", scope: "company" }), /Solo quien administra/);
  });
  await asPerson(ANA, async () => {
    assert.equal(a.hub.servers().length, 1);
    assert.equal(mcpExtraTools({ store: a.store }, a.hub)().length, 2);
  });
});

test("marketplace routes: the catalogue per person, «Disponible pronto», Composio keys and plain errors", async (t) => {
  const store = await tempStore(t);
  const hub = new McpHub(store, { secrets: memorySecrets(), local: null });
  t.after(() => hub.shutdown());
  const keys = new Map();
  const composio = {
    status: async () => ({ configured: keys.has("me"), mine: keys.has("me"), company: false, canRemove: keys.has("me") }),
    setKey: async (key) => { if (key !== "ak_valida_de_prueba") throw Error("401 Unauthorized"); keys.set("me", key); },
    removeKey: async () => keys.delete("me"),
  };
  const app = express();
  app.use(express.json());
  registerMcpRoutes(app, { hub, z, composio });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/mcp";
  const req = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json().catch(() => null) }; };
  const cat = await req("GET", "/catalog");
  assert.equal(cat.status, 200);
  assert.equal(cat.data.google, false);
  const byId = Object.fromEntries(cat.data.items.map((i) => [i.id, i]));
  assert.equal(byId["google-analytics"].availability, "soon");
  assert.equal(byId.notion.availability, "ready");
  assert.ok(!byId.vercel, "unverifiable entries are not listed");
  assert.equal((await req("POST", "/connect", { catalogId: "google-analytics" })).status, 409);
  assert.match((await req("POST", "/connect", { catalogId: "gmail" })).data.error, /Composio/);
  assert.equal((await req("POST", "/connect", { catalogId: "github", token: "corto" })).status, 400);
  assert.match((await req("PUT", "/composio", { key: "no-es-una-clave" })).data.error, /ak_/);
  assert.match((await req("PUT", "/composio", { key: "ak_mala_de_prueba" })).data.error, /no aceptó esa clave/);
  assert.equal((await req("PUT", "/composio", { key: "ak_valida_de_prueba" })).data.mine, true);
  assert.equal((await req("DELETE", "/composio")).data.mine, false);
});

// ------------------------------------------------------------------ a hosted workspace

test("hosted: the marketplace per person, mail through the TCP seam, your own Composio key, Google «Disponible pronto»", async (t) => {
  const { DoDriver } = await import("../server/store-driver.mjs");
  const { FakeDurableStorage } = await import("../server/do-sql-fake.mjs");
  const { hostWorkspace } = await import("../server/cloud/host.mjs");
  const { SqlFiles } = await import("../server/file-store.mjs");
  const { nodeTcp } = await import("../server/mcp/mail.mjs");
  const fm = await fakeMail();
  t.after(() => fm.close());
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-market-cloud-"));
  const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
  const key = randomBytes(32);
  const store = new Store(path.join(dir, "root"), { driver: new DoDriver(storage), keyProvider: () => key });
  const host = hostWorkspace({ store, workspace: { id: randomBytes(16).toString("hex"), name: "Pruebas" }, masters: [{ kid: "m1", secret: randomBytes(32).toString("hex") }], files: new SqlFiles(storage.sql), log: () => {}, publicUrl: "https://app.example.com", testing: true, previews: false, tcp: nodeTcp({ allowPlain: true }) });
  host.syncMembers([ANA, BETO], { name: "Pruebas" });
  host.setTestFlags({ fakeModel: true });
  host.runtime.mcp.allowPlain = true;
  const server = http.createServer(host.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { host.bots.close(); await host.runtime.shutdown(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); try { storage.close?.(); } catch {} await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const as = (p) => async (method, route, body) => {
    const r = await fetch(base + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Person": JSON.stringify(p) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const ana = as(ANA), beto = as(BETO);
  const cat = (await beto("GET", "/mcp/catalog")).data;
  assert.equal(cat.google, false);
  assert.deepEqual(cat.person, { role: "member" });
  assert.equal(cat.items.find((i) => i.id === "bigquery").availability, "soon");
  // Beto connects his mailbox: his alone.
  const out = await beto("POST", "/mcp/connect", { catalogId: "mail", mail: fm.settings });
  assert.equal(out.status, 200, JSON.stringify(out.data));
  assert.equal(out.data.server.scope, "mine");
  assert.equal((await ana("GET", "/mcp/servers")).data.servers.length, 0, "Ana never sees Beto's mailbox");
  assert.equal((await ana("DELETE", "/mcp/servers/" + out.data.server.id)).status, 404);
  assert.equal((await beto("POST", "/mcp/servers/" + out.data.server.id + "/test")).data.ok, true);
  // A member never connects for the whole company.
  assert.equal((await beto("POST", "/mcp/connect", { catalogId: "notion", scope: "company" })).status, 403);
  // His own Composio key: his, not Ana's (the test flag keeps Composio offline).
  assert.equal((await beto("PUT", "/mcp/composio", { key: "ak_clave_de_prueba_beto" })).data.mine, true);
  assert.equal((await ana("GET", "/mcp/composio")).data.mine, false);
  assert.equal(store.get("cloud", "apps-mine:" + BETO.id).ownKey, true);
  assert.equal((await beto("DELETE", "/mcp/composio")).data.mine, false);
});
