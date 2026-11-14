// Team messaging of a hosted workspace (server/cloud/chat.mjs over server/cloud/host.mjs):
// channels and who may read them through every way out (API, live feed, search), threads,
// mentions and unread, edits, reactions, pins, files, notifications, retention, export, the Slack
// import of the synthetic export, and paging a channel of 50,000 messages.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../server/store.mjs";
import { DoDriver } from "../server/store-driver.mjs";
import { FakeDurableStorage } from "../server/do-sql-fake.mjs";
import { hostWorkspace } from "../server/cloud/host.mjs";
import { SqlFiles } from "../server/file-store.mjs";
import { MemoryBlobs, SqlBlobs } from "../server/cloud/blobs.mjs";
import { doNotDisturb, mentionsIn, parseQuery, words, channelName } from "../server/cloud/chat.mjs";
import { fetchPreview, firstLink, previewable, privateAddress, parsePreview } from "../server/cloud/link-preview.mjs";
import { buildSyntheticExport, syntheticExpectations } from "../server/cloud/slack-synthetic.mjs";
import { bufferSource, openZip } from "../server/cloud/zip.mjs";

const ANA = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" };
const BETO = { id: "22222222-2222-4222-8222-222222222222", name: "Beto", email: "beto@example.com", role: "member" };
const GIL = { id: "33333333-3333-4333-8333-333333333333", name: "Gil", email: "gil@example.com", role: "guest" };
const DORA = { id: "44444444-4444-4444-8444-444444444444", name: "Dora", email: "dora@example.net", role: "member" };

async function company(t, people = [ANA, BETO, GIL], { blobs = null, presence = () => new Map(), vapid = null } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-chat-"));
  const key = randomBytes(32);
  const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
  const store = new Store(path.join(dir, "virtual-root"), { driver: new DoDriver(storage), keyProvider: () => key });
  const deferred = [];
  const host = hostWorkspace({ store, workspace: { id: randomBytes(16).toString("hex"), name: "Pruebas" }, files: new SqlFiles(storage.sql), blobs: blobs || new SqlBlobs(storage.sql), previews: false, presence, vapid, defer: (p) => deferred.push(p), log: () => {} });
  host.syncMembers(people, { name: "Pruebas" });
  const server = http.createServer(host.app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await host.runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  const as = (person) => async (method, route, body, headers = {}) => {
    const raw = body instanceof Uint8Array;
    const r = await fetch(base + "/api" + route, {
      method, headers: { "Content-Type": raw ? "application/octet-stream" : "application/json", ...(person ? { "X-Colmena-Person": JSON.stringify(person) } : {}), ...headers },
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    });
    const type = r.headers.get("content-type") || "";
    const data = type.includes("json") ? await r.json() : new Uint8Array(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
  /** A live feed per person: what reached their screen. */
  const feed = (person, watching = null) => {
    const got = [];
    const close = host.openFeed(person, (e) => { if (String(e.type).startsWith("chat.")) got.push(e); }, { watching: () => watching });
    t.after(close);
    return got;
  };
  return { store, host, chat: host.chat, as, feed, storage, deferred };
}

test("text helpers: words, mentions, channel names, queries", () => {
  assert.deepEqual(words("¡Presupuesto ÁRBOL! <@x> <https://example.com/a|el doc>").sort(), ["arbol", "com", "doc", "el", "example", "https", "presupuesto"]);
  assert.deepEqual(mentionsIn("hola <@a> y <@b> <!here>"), { people: ["a", "b"], channel: false, here: true });
  assert.equal(channelName("  #Ventas Q3 / España "), "ventas-q3-españa");
  const q = parseQuery('informe from:@ana in:#general has:file after:2026-01-01 before:2026-02-01');
  assert.deepEqual(q.words, ["informe"]);
  assert.deepEqual(q.from, ["@ana"]);
  assert.deepEqual(q.in, ["general"]);
  assert.ok(q.has.has("file"));
  assert.equal(q.after, Date.parse("2026-01-02T00:00:00Z"));
  assert.equal(q.before, Date.parse("2026-02-01T00:00:00Z"));
});

test("channels: public for everyone but guests, private only for members — API, live feed and search", async (t) => {
  const { as, feed, chat } = await company(t);
  const ana = as(ANA), beto = as(BETO), gil = as(GIL);
  const boot = await beto("GET", "/chat/bootstrap");
  assert.equal(boot.status, 200);
  const general = boot.data.channels.find((c) => c.name === "general");
  assert.ok(general?.isDefault, "a newcomer is in the default channel");
  assert.equal((await gil("GET", "/chat/bootstrap")).data.channels.length, 0, "guests do not join default channels");
  assert.equal((await gil("GET", "/chat/channels/" + general.id + "/messages")).status, 404, "a guest cannot read a public channel it is not in");
  assert.equal((await gil("POST", "/chat/channels", { name: "x" })).status, 403);

  const secret = await beto("POST", "/chat/channels", { name: "Dirección", kind: "private" });
  assert.equal(secret.status, 201);
  assert.equal(secret.data.name, "dirección");
  const anaFeed = feed(ANA), betoFeed = feed(BETO), gilFeed = feed(GIL, secret.data.id);
  const posted = await beto("POST", `/chat/channels/${secret.data.id}/messages`, { text: "presupuesto confidencial del trimestre" });
  assert.equal(posted.status, 201);
  assert.ok(betoFeed.some((e) => e.type === "chat.message" && e.channel === secret.data.id));
  assert.ok(!anaFeed.some((e) => e.channel === secret.data.id), "the owner of the workspace does not receive a private channel's messages");
  assert.ok(!gilFeed.some((e) => e.channel === secret.data.id), "watching a channel you may not read gives nothing");
  assert.equal((await ana("GET", `/chat/channels/${secret.data.id}/messages`)).status, 404);
  assert.equal((await ana("GET", `/chat/messages/${posted.data.message.id}/thread`)).status, 404);
  assert.equal((await ana("POST", `/chat/messages/${posted.data.message.id}/reactions`, { emoji: "👍" })).status, 404);
  assert.equal((await ana("GET", "/chat/search?q=confidencial")).data.results.length, 0, "search never shows what you may not read");
  assert.equal((await beto("GET", "/chat/search?q=confidencial")).data.results.length, 1);
  assert.equal((await ana("GET", "/chat/channels/browse")).data.channels.some((c) => c.id === secret.data.id), false, "private channels are not browsable");
  // Admins still manage it (archive) without reading it.
  const overview = await ana("GET", "/chat/admin");
  assert.ok(overview.data.channels.some((c) => c.id === secret.data.id));
  assert.equal((await ana("PATCH", `/chat/channels/${secret.data.id}`, { archived: true })).status, 200);
  assert.equal((await beto("POST", `/chat/channels/${secret.data.id}/messages`, { text: "más" })).status, 409, "archived channels take no messages");
  assert.ok(chat.auditLog(ANA).entries.some((e) => e.action === "channel.archive"));

  // Adding the guest to a channel is what lets them in.
  const pub = await beto("POST", "/chat/channels", { name: "proyecto" });
  await beto("POST", `/chat/channels/${pub.data.id}/members`, { people: [GIL.id] });
  assert.equal((await gil("GET", `/chat/channels/${pub.data.id}/messages`)).status, 200);
  assert.equal((await gil("POST", `/chat/channels/${pub.data.id}/messages`, { text: "hola" })).status, 201);
  // A member reading a public channel joins by posting; leaving works; DMs cannot be left.
  assert.equal((await ana("POST", `/chat/channels/${pub.data.id}/messages`, { text: "me uno" })).status, 201);
  assert.ok((await ana("GET", "/chat/channels")).data.channels.some((c) => c.id === pub.data.id));
  assert.equal((await ana("POST", `/chat/channels/${pub.data.id}/leave`, {})).status, 200);
  assert.equal((await beto("POST", "/chat/channels", { name: "Proyecto" })).status, 409, "names are unique");
});

test("direct messages and groups: only their people, the same conversation each time", async (t) => {
  const { as, feed } = await company(t, [ANA, BETO, GIL, DORA]);
  const ana = as(ANA), beto = as(BETO), dora = as(DORA);
  const dm = await ana("POST", "/chat/dm", { people: [BETO.id] });
  assert.equal(dm.data.kind, "dm");
  assert.equal((await beto("POST", "/chat/dm", { people: [ANA.id] })).data.id, dm.data.id);
  const doraFeed = feed(DORA);
  await ana("POST", `/chat/channels/${dm.data.id}/messages`, { text: "solo para ti, <@" + BETO.id + ">" });
  assert.equal((await dora("GET", `/chat/channels/${dm.data.id}/messages`)).status, 404);
  assert.equal(doraFeed.length, 0);
  assert.equal((await dora("GET", "/chat/search?q=solo")).data.results.length, 0);
  const group = await ana("POST", "/chat/dm", { people: [BETO.id, GIL.id] });
  assert.equal(group.data.kind, "group");
  assert.equal((await ana("POST", `/chat/channels/${dm.data.id}/leave`, {})).status, 400);
  const unread = (await beto("GET", "/chat/channels")).data.channels.find((c) => c.id === dm.data.id);
  assert.equal(unread.unread, 1);
  assert.equal(unread.mentions, 1, "every DM counts as for you");
});

test("threads, mentions, unread and «marcar como leído»", async (t) => {
  const { as, chat } = await company(t);
  const ana = as(ANA), beto = as(BETO);
  const general = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  const root = (await ana("POST", `/chat/channels/${general.id}/messages`, { text: "¿Quién revisa el informe?" })).data.message;
  const reply = await beto("POST", `/chat/channels/${general.id}/messages`, { text: "Yo, <@" + ANA.id + ">", thread: root.id });
  assert.equal(reply.status, 201);
  assert.equal(reply.data.message.threadId, root.id);
  const also = await beto("POST", `/chat/channels/${general.id}/messages`, { text: "Hecho, ya está", thread: root.id, alsoChannel: true });
  const page = (await ana("GET", `/chat/channels/${general.id}/messages`)).data;
  assert.deepEqual(page.messages.map((m) => m.id), [root.id, also.data.message.id], "replies stay in the thread unless also sent to the channel");
  assert.equal(page.messages[0].replies, 2);
  assert.deepEqual(page.messages[0].replyPeople, [BETO.id]);
  const thread = (await ana("GET", `/chat/messages/${root.id}/thread`)).data;
  assert.equal(thread.replies.length, 2);
  // Ana: the reply named her (mention), the broadcast is unread in the channel.
  const mine = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.id === general.id);
  assert.equal(mine.unread, 1);
  assert.equal(mine.mentions, 0, "opening the thread cleared its mention");
  const mentions = (await ana("GET", "/chat/mentions")).data.items;
  assert.ok(mentions.some((x) => x.kind === "mention"));
  // Beto: unread of Ana's message, then «marcar como leído», then unread again from it.
  let b = (await beto("GET", "/chat/channels")).data.channels.find((c) => c.id === general.id);
  assert.equal(b.unread, 0, "your own messages mark what is before them as read");
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "<!channel> reunión a las 10" });
  b = (await beto("GET", "/chat/channels")).data.channels.find((c) => c.id === general.id);
  assert.equal(b.unread, 1);
  assert.equal(b.mentions, 1, "@canal is for everyone in it");
  const read = await beto("POST", `/chat/channels/${general.id}/read`, {});
  assert.equal(read.data.unread, 0);
  assert.equal(read.data.mentions, 0);
  const again = await beto("POST", `/chat/channels/${general.id}/read`, { seq: root.seq - 1 });
  assert.equal(again.data.unread, 2, "unread from a message on");
  // Mentioning someone outside a private channel tells the author.
  const priv = await ana("POST", "/chat/channels", { name: "solo-ana", kind: "private" });
  const out = await ana("POST", `/chat/channels/${priv.data.id}/messages`, { text: "<@" + BETO.id + "> mira" });
  assert.deepEqual(out.data.notInChannel, [BETO.id]);
  assert.equal(chat.q("SELECT count(*) AS n FROM chat_mentions WHERE person=? AND channel=?").get(BETO.id, priv.data.id).n, 0);
  // Drafts are per person and per channel.
  await beto("PUT", `/chat/channels/${general.id}/draft`, { text: "a medias" });
  assert.equal((await beto("GET", "/chat/channels")).data.channels.find((c) => c.id === general.id).draft, "a medias");
  assert.equal((await ana("GET", "/chat/channels")).data.channels.find((c) => c.id === general.id).draft, "");
  // Unknown mentions do not survive.
  const fake = await ana("POST", `/chat/channels/${general.id}/messages`, { text: "<@nadie> <!subteam^x> <#nope|canal>" });
  assert.equal(fake.data.message.text, "@nadie  #nope");
});

test("edit, delete, reactions and pins: who may do what", async (t) => {
  const { as, chat, feed } = await company(t);
  const ana = as(ANA), beto = as(BETO);
  const general = (await beto("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  const m = (await beto("POST", `/chat/channels/${general.id}/messages`, { text: "primera versión" })).data.message;
  assert.equal((await ana("PATCH", `/chat/messages/${m.id}`, { text: "no" })).status, 403);
  const edited = await beto("PATCH", `/chat/messages/${m.id}`, { text: "segunda versión" });
  assert.ok(edited.data.editedAt);
  assert.equal((await beto("GET", "/chat/search?q=primera")).data.results.length, 0, "the index follows edits");
  assert.equal((await beto("GET", "/chat/search?q=segunda")).data.results.length, 1);
  const anaFeed = feed(ANA);
  await ana("POST", `/chat/messages/${m.id}/reactions`, { emoji: "🎉" });
  await beto("POST", `/chat/messages/${m.id}/reactions`, { emoji: "🎉" });
  const r = await beto("POST", `/chat/messages/${m.id}/reactions`, { emoji: "🎉", on: false });
  assert.deepEqual(r.data.reactions, [{ emoji: "🎉", people: [ANA.id], count: 1 }]);
  assert.equal((await beto("POST", `/chat/messages/${m.id}/reactions`, { emoji: "<script>" })).status, 400);
  assert.ok(anaFeed.some((e) => e.type === "chat.update"));
  await beto("POST", `/chat/messages/${m.id}/pin`, {});
  assert.equal((await ana("GET", `/chat/channels/${general.id}/pins`)).data.messages.length, 1);
  assert.equal((await beto("GET", "/chat/search?q=has:pin")).data.results.length, 1);
  // Deleting: Ana is the owner, so she may; it is audited.
  const other = (await beto("POST", `/chat/channels/${general.id}/messages`, { text: "borrable" })).data.message;
  assert.equal((await as(GIL)("DELETE", `/chat/messages/${other.id}`)).status, 404);
  assert.equal((await ana("DELETE", `/chat/messages/${other.id}`)).status, 200);
  assert.ok(chat.auditLog(ANA).entries.some((e) => e.action === "message.delete"));
  assert.equal((await beto("GET", "/chat/search?q=borrable")).data.results.length, 0);
  // A first message with replies stays as «eliminado».
  const root = (await beto("POST", `/chat/channels/${general.id}/messages`, { text: "raíz" })).data.message;
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "respuesta", thread: root.id });
  await beto("DELETE", `/chat/messages/${root.id}`);
  const shown = (await ana("GET", `/chat/channels/${general.id}/messages`)).data.messages.find((x) => x.id === root.id);
  assert.equal(shown.deleted, true);
  assert.equal(shown.text, "");
});

test("search: words by prefix, accents folded, from:, in:, has:file, dates, and only what you can read", async (t) => {
  let now = Date.parse("2026-03-10T10:00:00Z");
  const { as, chat } = await company(t);
  chat.now = () => now;
  const ana = as(ANA), beto = as(BETO), gil = as(GIL);
  const general = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  const ventas = (await beto("POST", "/chat/channels", { name: "ventas" })).data;
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "El presupuesto de marketing está aprobado" });
  now += 86400000;
  await beto("POST", `/chat/channels/${ventas.id}/messages`, { text: "Presupuestos de ventas para Árbol S.A." });
  const up = await beto("PUT", `/chat/files?channel=${ventas.id}&name=${encodeURIComponent("tarifas.txt")}`, new TextEncoder().encode("precios"));
  await beto("POST", `/chat/channels/${ventas.id}/messages`, { text: "adjunto", files: [up.data.id] });
  const hits = async (q, who = ana) => (await who("GET", "/chat/search?q=" + encodeURIComponent(q))).data.results.map((r) => r.message.text);
  assert.equal((await hits("presu")).length, 2, "prefix");
  assert.deepEqual(await hits("arbol"), ["Presupuestos de ventas para Árbol S.A."], "accents folded");
  assert.deepEqual(await hits("presupuesto from:@beto"), ["Presupuestos de ventas para Árbol S.A."]);
  assert.deepEqual(await hits("presupuesto in:#general"), ["El presupuesto de marketing está aprobado"]);
  assert.deepEqual(await hits("has:file"), ["adjunto"]);
  assert.deepEqual(await hits("tarifas"), ["adjunto"], "file names are searchable");
  assert.deepEqual(await hits("presupuesto on:2026-03-10"), ["El presupuesto de marketing está aprobado"]);
  assert.deepEqual(await hits("presupuesto after:2026-03-10"), ["Presupuestos de ventas para Árbol S.A."]);
  assert.deepEqual(await hits("presupuesto marketing aprobado"), ["El presupuesto de marketing está aprobado"], "every word must be there");
  assert.equal((await hits("presu", gil)).length, 0, "a guest in no channel finds nothing");
  assert.ok((await ana("GET", "/chat/search?q=in:@nadie")).data.unknown.length);
  // The index holds keyed hashes, never the words.
  const terms = chat.q("SELECT term FROM chat_terms").all().map((r) => r.term);
  assert.ok(terms.length > 5 && terms.every((x) => /^[A-Za-z0-9_-]{16}$/.test(x)));
  assert.ok(!terms.some((x) => x.includes("presu")));
});

test("files: upload, send, download for those who can read the channel; dangerous types download", async (t) => {
  const { as } = await company(t);
  const ana = as(ANA), beto = as(BETO), gil = as(GIL);
  const priv = (await beto("POST", "/chat/channels", { name: "privado", kind: "private" })).data;
  const bytes = new TextEncoder().encode("<svg onload=alert(1)>");
  const up = await beto("PUT", `/chat/files?channel=${priv.id}&name=dibujo.svg&w=10&h=10`, bytes, { "Content-Type": "image/svg+xml" });
  assert.equal(up.status, 201);
  assert.equal((await ana("GET", `/chat/files/${up.data.id}`)).status, 404, "an unsent upload is only its uploader's");
  assert.equal((await gil("POST", `/chat/channels/${priv.id}/messages`, { files: [up.data.id] })).status, 404);
  const sent = await beto("POST", `/chat/channels/${priv.id}/messages`, { files: [up.data.id] });
  assert.equal(sent.status, 201);
  assert.equal((await beto("POST", `/chat/channels/${priv.id}/messages`, { files: [up.data.id] })).status, 400, "a file goes in one message");
  const got = await beto("GET", `/chat/files/${up.data.id}`);
  assert.equal(got.status, 200);
  assert.equal(new TextDecoder().decode(got.data), "<svg onload=alert(1)>");
  assert.match(got.headers.get("content-disposition"), /^attachment/, "SVG never renders inline");
  assert.equal(got.headers.get("content-type"), "application/octet-stream");
  assert.match(got.headers.get("content-security-policy"), /sandbox/);
  assert.equal((await ana("GET", `/chat/files/${up.data.id}`)).status, 404, "not in the private channel");
  const png = await beto("PUT", `/chat/files?channel=${priv.id}&name=foto.png`, new Uint8Array([137, 80, 78, 71]), { "Content-Type": "image/png" });
  await beto("POST", `/chat/channels/${priv.id}/messages`, { files: [png.data.id] });
  assert.match((await beto("GET", `/chat/files/${png.data.id}`)).headers.get("content-disposition"), /^inline/);
});

test("notifications: preferences, mute, «no molestar», active screens, and the mail digest", async (t) => {
  const online = new Map();
  let now = Date.parse("2026-03-10T10:00:00Z");
  const { as, chat } = await company(t, [ANA, BETO, GIL], { presence: () => online });
  chat.now = () => now;
  const pushed = [];
  chat.push = async (pid, payload) => { pushed.push({ pid, payload }); };
  const ana = as(ANA), beto = as(BETO);
  const general = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "sin mencionar a nadie" });
  assert.equal(pushed.length, 0, "channels notify mentions only by default");
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "<@" + BETO.id + "> mira esto" });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].pid, BETO.id);
  assert.match(pushed[0].payload.body, /@Beto mira esto/);
  online.set(BETO.id, "active");
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "<@" + BETO.id + "> otra" });
  assert.equal(pushed.length, 1, "no push while the person is active");
  online.delete(BETO.id);
  await beto("PATCH", "/chat/me", { dnd: { until: now + 3600000 } });
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "<@" + BETO.id + "> y otra" });
  assert.equal(pushed.length, 1, "«no molestar» holds pushes");
  await beto("PATCH", "/chat/me", { dnd: { until: null, schedule: { on: false } }, keywords: ["factura"] });
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "llegó la factura nueva" });
  assert.equal(pushed.length, 2, "keywords notify");
  await beto("PUT", `/chat/channels/${general.id}/prefs`, { muted: true });
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "<!channel> todos" });
  assert.equal(pushed.length, 2, "muted: only direct mentions");
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "<@" + BETO.id + "> directo" });
  assert.equal(pushed.length, 3);
  await beto("PUT", `/chat/channels/${general.id}/prefs`, { muted: false, notify: "all" });
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "cualquier cosa" });
  assert.equal(pushed.length, 4, "«todos los mensajes»");
  // The digest: mentions unread for 30 minutes, once.
  assert.equal(chat.digestDue(now).length, 0);
  now += 31 * 60000;
  const digests = chat.digestDue(now);
  assert.equal(digests.length, 1);
  assert.equal(digests[0].email, BETO.email);
  assert.ok(digests[0].items.length >= 4);
  assert.equal(chat.digestDue(now).length, 0, "mailed once");
  // A schedule in the person's own time zone.
  const profile = { tz: "Europe/Madrid", dnd: { schedule: { on: true, from: "22:00", to: "08:00", days: [] } } };
  assert.equal(doNotDisturb(profile, Date.parse("2026-03-10T22:30:00Z")), true, "23:30 in Madrid");
  assert.equal(doNotDisturb(profile, Date.parse("2026-03-10T10:00:00Z")), false);
  // Push subscriptions only for known push services.
  assert.equal((await beto("POST", "/chat/push", { subscription: { endpoint: "https://127.0.0.1/x", keys: { p256dh: "a", auth: "b" } } })).status, 400);
});

test("retention removes old messages with their index entries and files; settings are audited", async (t) => {
  let now = Date.parse("2026-01-01T10:00:00Z");
  const { as, chat, host } = await company(t);
  chat.now = () => now;
  const ana = as(ANA);
  const general = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  const up = await ana("PUT", `/chat/files?channel=${general.id}&name=viejo.txt`, new TextEncoder().encode("x"));
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "mensaje antiguo", files: [up.data.id] });
  now += 40 * 86400000;
  await ana("POST", `/chat/channels/${general.id}/messages`, { text: "mensaje reciente" });
  assert.equal((await as(BETO)("PATCH", "/chat/admin/settings", { retentionDays: 30 })).status, 403);
  assert.equal((await ana("PATCH", "/chat/admin/settings", { retentionDays: 30 })).status, 200);
  await host.tick({ now });
  const left = (await ana("GET", `/chat/channels/${general.id}/messages`)).data.messages.map((m) => m.text);
  assert.deepEqual(left, ["mensaje reciente"]);
  assert.equal((await ana("GET", "/chat/search?q=antiguo")).data.results.length, 0);
  assert.equal(await host.blobs.head(chat.q("SELECT key FROM chat_files").get()?.key || "none"), null);
  const actions = chat.auditLog(ANA).entries.map((e) => e.action);
  assert.ok(actions.includes("settings") && actions.includes("retention.purge"));
});

test("admin: deactivated people lose access but keep their name; the audit log takes the Worker's actions; export", async (t) => {
  const { as, host, chat } = await company(t);
  const ana = as(ANA), beto = as(BETO);
  const general = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  await beto("POST", `/chat/channels/${general.id}/messages`, { text: "me voy pronto" });
  host.syncMembers([ANA, { ...BETO, deactivated: true }, GIL]);
  assert.equal((await beto("GET", "/chat/bootstrap")).status, 403);
  const people = (await ana("GET", "/chat/people")).data.people;
  assert.equal(people.find((p) => p.id === BETO.id).deactivated, true);
  assert.equal((await ana("GET", `/chat/channels/${general.id}/messages`)).data.messages[0].author, BETO.id);
  host.audit({ actor: { id: ANA.id, name: "Ana" }, action: "deactivate", target: { type: "person", id: BETO.id } });
  assert.equal(chat.auditLog(ANA).entries[0].action, "deactivate");
  assert.equal((await as(GIL)("GET", "/chat/admin/audit")).status, 403);
  const zip = await ana("GET", "/chat/admin/export.zip");
  assert.equal(zip.status, 200);
  const archive = await openZip(bufferSource(zip.data));
  const names = archive.entries.map((e) => e.name);
  assert.ok(names.includes("workspace.json") && names.includes("channels.json") && names.includes("people.json") && names.includes("audit.json"));
  const messages = JSON.parse(new TextDecoder().decode(await archive.readEntry(archive.entries.find((e) => e.name.startsWith("channels/general")))));
  assert.equal(messages[0].text, "me voy pronto");
  assert.equal((await beto("GET", "/chat/admin/export.zip")).status, 403);
});

test("Slack import of the synthetic export: people, channels, threads, reactions, files, markup; resumable in steps", async (t) => {
  const { as, host, chat } = await company(t, [ANA, BETO, GIL], { blobs: new MemoryBlobs() });
  const ana = as(ANA), beto = as(BETO);
  const zip = await buildSyntheticExport({});
  const expect = syntheticExpectations({});
  assert.equal((await beto("POST", "/chat/import", { size: zip.length })).status, 403);
  const made = await ana("POST", "/chat/import", { size: zip.length, name: "export.zip" });
  assert.equal(made.status, 201);
  for (let k = 0; k < made.data.parts; k++) {
    const part = zip.subarray(k * made.data.partSize, (k + 1) * made.data.partSize);
    assert.equal((await ana("PUT", `/chat/import/${made.data.id}/parts/${k}`, part)).status, 200);
  }
  assert.equal((await ana("POST", `/chat/import/${made.data.id}/start`, {})).status, 200);
  const invited = [];
  let steps = 0;
  // Small steps: the import must resume where each one stopped.
  while (host.importer.active() && steps < 100) { await host.importer.step({ maxMessages: 4, invite: async (people) => { invited.push(...people); return { created: people.length, existing: 0 }; } }); steps++; }
  const status = (await ana("GET", "/chat/import")).data.import;
  assert.equal(status.status, "done", status.error);
  assert.ok(steps > 3);
  const c = status.counts;
  assert.equal(c.users, expect.users);
  assert.equal(c.matched, expect.matchedByEmail);
  assert.equal(invited.length, expect.outsiders, "people not in the workspace become pending invitations");
  assert.deepEqual(c.channels, { public: expect.conversations.public, private: expect.conversations.private, dm: expect.conversations.dm, group: expect.conversations.group });
  assert.equal(c.messages, expect.messages);
  assert.equal(c.skipped, expect.skipped);
  assert.equal(c.replies, expect.replies);
  assert.equal(c.threads, expect.threads);
  assert.equal(c.files.held, expect.files.held);
  assert.equal(c.files.linked, expect.files.linked);
  // What people see: authors, threads, converted markup, reactions, the held file.
  const channels = (await ana("GET", "/chat/channels")).data.channels;
  const general = channels.find((x) => x.name === "general");
  assert.equal(general.unread, 0, "imported history is not unread");
  const page = (await ana("GET", `/chat/channels/${general.id}/messages?limit=200`)).data;
  const all = page.messages.map((m) => m.text).join("\n");
  assert.doesNotMatch(all, /<@U0SYN/, "Slack user ids never show");
  assert.match(all, new RegExp("<@" + BETO.id + ">"), "mentions of matched people point at them");
  assert.ok(page.messages.some((m) => m.replies === 3), "the thread kept its replies");
  assert.ok(page.messages.some((m) => m.broadcast), "a reply also sent to the channel shows in it");
  assert.ok(page.messages.some((m) => m.reactions.length));
  assert.ok(page.messages.some((m) => m.files.some((f) => f.id)), "a file the export held was copied");
  assert.ok(page.messages.some((m) => m.files.some((f) => !f.id && f.external)), "a file it did not hold stays a link");
  const outsider = Object.values(page.ghosts).find((g) => !g.person && !g.bot);
  assert.ok(outsider, "people who have not joined show by their original name");
  // The private channel kept its members only.
  const priv = (await beto("GET", "/chat/channels")).data.channels.find((x) => x.kind === "private");
  assert.ok(priv);
  assert.equal((await as(GIL)("GET", `/chat/channels/${priv.id}/messages`)).status, 404);
  // When an imported person joins, their channels and authorship follow.
  const dora = { id: "55555555-5555-4555-8555-555555555555", name: "Dora", email: "dora@example.net", role: "member" };
  host.syncMembers([ANA, BETO, GIL, dora]);
  const ghost = chat.q("SELECT id, person FROM chat_ghosts WHERE email=?").get("dora@example.net");
  assert.equal(ghost.person, dora.id);
  assert.ok((await as(dora)("GET", "/chat/channels")).data.channels.length >= 1);
  assert.ok((await ana("GET", "/chat/search?q=from:@dora")).data.results.length >= 1, "from: finds what they wrote before joining");
  // A second import is refused while one runs; the audit log has both ends.
  const actions = chat.auditLog(ANA).entries.map((e) => e.action);
  assert.ok(actions.includes("import.start") && actions.includes("import.done"));
});

test("link previews: SSRF protection (private addresses, redirects, ports, credentials, size)", async () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "224.0.0.1"]) assert.equal(privateAddress(a), true, a);
  for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(privateAddress(a), false, a);
  for (const u of ["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "https://user:pw@example.com/", "https://example.com:8443/", "ftp://example.com/", "http://intranet/", "http://x.internal/"]) assert.equal(previewable(u), null, u);
  assert.ok(previewable("https://example.com/a"));
  assert.equal(firstLink("mira <https://example.com/doc|el doc>"), "https://example.com/doc");
  const html = (title) => new Response(`<html><head><title>x</title><meta property="og:title" content="${title}"><meta name="description" content="Desc &amp; más"></head></html>`, { headers: { "Content-Type": "text/html" } });
  const ok = await fetchPreview("https://example.com/a", { resolve: async () => ["93.184.216.34"], fetchImpl: async () => html("Título") });
  assert.deepEqual(ok, { url: "https://example.com/a", title: "Título", description: "Desc & más", site: "example.com" });
  assert.equal(await fetchPreview("https://evil.example/", { resolve: async () => ["10.0.0.5"], fetchImpl: async () => html("x") }), null, "a name resolving to a private address");
  const redirect = async (url) => (url.includes("evil") ? new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest" } }) : html("x"));
  assert.equal(await fetchPreview("https://evil.example/", { resolve: async () => ["93.184.216.34"], fetchImpl: redirect }), null, "a redirect to a private address");
  assert.equal(await fetchPreview("https://example.com/", { resolve: async () => ["93.184.216.34"], fetchImpl: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }) }), null, "HTML only");
  const slow = await fetchPreview("https://example.com/", { timeoutMs: 50, resolve: async () => ["93.184.216.34"], fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Error("aborted")))) });
  assert.equal(slow, null, "time limit");
  assert.equal(parsePreview("<p>nada</p>", "https://example.com/"), null);
});

test("performance: a channel of 50,000 messages opens by pages", async (t) => {
  const { as, chat } = await company(t);
  const ana = as(ANA);
  const general = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  const started = performance.now();
  const insert = chat.q("INSERT INTO chat_messages(id, channel, thread, top, author, at, data) VALUES(?,?,NULL,1,?,?,?) RETURNING seq");
  let last = 0;
  for (let b = 0; b < 50; b++) chat.tx(() => {
    for (let i = 0; i < 1000; i++) {
      const id = randomBytes(16).toString("hex");
      const text = `mensaje ${b * 1000 + i} sobre el proyecto ${i % 37}`;
      last = insert.get(id, general.id, i % 2 ? ANA.id : BETO.id, Date.now(), chat.seal({ text, files: [], reactions: {} }, "message\u0000" + id)).seq;
      chat.index(last, text);
    }
  });
  chat.q("UPDATE chat_channels SET last_seq=? WHERE id=?").run(last, general.id);
  const seeded = performance.now() - started;
  const timings = [];
  let page = null;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    page = (await ana("GET", `/chat/channels/${general.id}/messages`)).data;
    timings.push(performance.now() - t0);
  }
  const t1 = performance.now();
  const older = (await ana("GET", `/chat/channels/${general.id}/messages?before=${page.messages[0].seq}`)).data;
  const olderMs = performance.now() - t1;
  const t2 = performance.now();
  const around = (await ana("GET", `/chat/channels/${general.id}/messages?around=${last - 25000}`)).data;
  const aroundMs = performance.now() - t2;
  const t3 = performance.now();
  const found = (await ana("GET", "/chat/search?q=" + encodeURIComponent("mensaje 4242"))).data;
  const searchMs = performance.now() - t3;
  const t4 = performance.now();
  const sidebar = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.id === general.id);
  const sidebarMs = performance.now() - t4;
  assert.equal(page.messages.length, 50);
  assert.equal(older.messages.length, 50);
  assert.equal(around.messages.length, 50);
  assert.ok(found.results.some((r) => r.message.text.startsWith("mensaje 4242 ")));
  assert.equal(sidebar.unread, 100, "unread counts stop at 100 (shown as 99+)");
  const median = timings.sort((a, b) => a - b)[2];
  t.diagnostic(`seeded 50k in ${seeded.toFixed(0)} ms; first page median ${median.toFixed(1)} ms, older ${olderMs.toFixed(1)} ms, around ${aroundMs.toFixed(1)} ms, search ${searchMs.toFixed(1)} ms, sidebar ${sidebarMs.toFixed(1)} ms`);
  assert.ok(median < 250, "the first page stays fast: " + median);
  assert.ok(aroundMs < 250);
});
