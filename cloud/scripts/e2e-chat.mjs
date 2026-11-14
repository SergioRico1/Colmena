// End-to-end check of hosted Colmena's team messaging (docs/CLOUD.md › Phase 2), against
// `npm run dev` or the deployed Worker, with three test people on example.com only:
//   node scripts/e2e-chat.mjs [--url https://…] [--env ../.local/cloud.env] [--big 50000] [--sockets 50]
// The dev mail fallback is read with ADMIN_BOOTSTRAP_TOKEN (environment or --env file).
// Checks: default channels, public/private isolation over the API, the socket and search, DMs,
// threads, mentions and unread, files, link previews, typing and presence, push subscriptions,
// the Slack import of the synthetic export, admin settings, export, audit and deactivation;
// measures opening a channel of `--big` messages and the fan-out to `--sockets` sockets.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { buildSyntheticExport, syntheticExpectations } from "../../server/cloud/slack-synthetic.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const envFile = arg("env", new URL("../../.local/cloud.env", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ADMIN = process.env.ADMIN_BOOTSTRAP_TOKEN || (existsSync(envFile) ? /^ADMIN_BOOTSTRAP_TOKEN=(\S+)$/m.exec(readFileSync(envFile, "utf8"))?.[1] : null);
if (!ADMIN) throw Error("ADMIN_BOOTSTRAP_TOKEN is needed to read the dev mail.");
const BIG = Number(arg("big", "50000"));
const SOCKETS = Number(arg("sockets", "50"));
const run = randomBytes(3).toString("hex");
const results = [];
const numbers = {};
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 300) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

class Person {
  constructor(label, email) { this.label = label; this.email = email; this.cookies = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.cookies].map(([k, v]) => k + "=" + v).join("; "); }
  keep(response) {
    for (const line of response.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at), value = pair.slice(at + 1);
      if (/Max-Age=0/i.test(line) || !value) this.cookies.delete(name); else this.cookies.set(name, value);
    }
  }
  async req(path, { method = "GET", body, raw = null, type = "application/json", headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (method !== "GET") { h["Content-Type"] = type; h.Origin = BASE; if (this.csrf) h["X-Colmena-Token"] = this.csrf; }
    const response = await fetch(BASE + path, { method, headers: h, redirect: "manual", ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    this.keep(response);
    let data = null;
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("json")) { try { data = await response.json(); } catch {} } else data = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, data, response };
  }
  api(path, opts) { return this.req("/api/chat" + path, opts); }
  async signIn() {
    const r = await this.req("/auth/link", { method: "POST", body: { email: this.email } });
    if (r.status !== 202) throw Error(this.label + " link: " + r.status + " " + JSON.stringify(r.data));
    const token = await mailToken(this.email, "signin");
    const v = await this.req("/auth/verify", { method: "POST", body: { token } });
    if (v.status !== 200) throw Error(this.label + " verify: " + v.status + " " + JSON.stringify(v.data));
    await this.refresh();
  }
  async refresh() { const m = await this.req("/auth/me"); this.csrf = m.data?.csrf || null; return m; }
}
async function mailToken(email, kind) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } });
    const list = await r.json();
    const mail = (Array.isArray(list) ? list : []).find((m) => m.kind === kind);
    if (mail) return new URL(mail.url).hash.slice(3);
    await sleep(500);
  }
  throw Error("no " + kind + " mail for " + email);
}
function live(person) {
  const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/api/live", { headers: { Cookie: person.cookieHeader(), Origin: BASE } });
  const frames = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const at = performance.now();
    let f; try { f = JSON.parse(e.data); } catch { return; }
    f.__at = at;
    frames.push(f);
    for (const w of [...waiters]) if (w.test(f)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(f); }
  };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error("socket error")); });
  return {
    ws, frames, opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    next: (test, ms = 10000) => new Promise((resolve, reject) => {
      const found = frames.find(test);
      if (found) return resolve(found);
      const w = { test, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(Error("timeout")); } }, ms);
    }),
    close: () => { try { ws.close(1000); } catch {} },
  };
}

const A = new Person("Ana", `ana.${run}@example.com`);
const B = new Person("Beto", `beto.${run}@example.com`);
const G = new Person("Gil", `gil.${run}@example.com`);

console.log("Colmena team messaging e2e against " + BASE + " (run " + run + ")");
// ---- three people, one company
await A.signIn(); await B.signIn(); await G.signIn();
const made = await A.req("/auth/workspaces", { method: "POST", body: { name: "Pruebas fase 2 " + run } });
check("a company", made.status === 201, JSON.stringify(made.data));
for (const [P, role] of [[B, "member"], [G, "guest"]]) {
  const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: P.email, role } });
  const acc = await P.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(inv.data.link).hash.slice(3) } });
  check(`${P.label} joins as ${role}`, acc.status === 200, JSON.stringify(acc.data));
  await P.refresh();
}
const boot = {};
for (const P of [A, B, G]) boot[P.label] = (await P.api("/bootstrap")).data;
const ids = { A: boot.Ana.me.id, B: boot.Beto.me.id, G: boot.Gil.me.id };
const general = boot.Ana.channels.find((c) => c.name === "general");
check("everyone but guests is in #general", general && boot.Beto.channels.some((c) => c.id === general.id) && !boot.Gil.channels.some((c) => c.id === general.id));
check("a guest cannot read a public channel it is not in", (await G.api(`/channels/${general.id}/messages`)).status === 404);

// ---- sockets
const la = live(A), lb = live(B);
await Promise.all([la.opened, lb.opened]);
const lg = live(G);
await lg.opened;
check("presence: Beto sees Gil come online", await lb.next((f) => f.type === "chat.presence" && f.person === ids.G && f.presence === "active", 8000).then(() => true, () => false));

// ---- private channel isolation
const priv = (await B.api("/channels", { method: "POST", body: { name: "direccion-" + run, kind: "private" } })).data;
const secret = await B.api(`/channels/${priv.id}/messages`, { method: "POST", body: { text: "presupuesto confidencial " + run } });
check("Beto writes in his private channel", secret.status === 201);
await sleep(1500);
check("the owner's socket never receives a private channel's message", !la.frames.some((f) => f.channel === priv.id));
check("the guest's socket never receives it", !lg.frames.some((f) => f.channel === priv.id));
lg.send({ type: "watch", channel: priv.id });
await B.api(`/channels/${priv.id}/messages`, { method: "POST", body: { text: "otro secreto" } });
await sleep(1200);
check("watching a private channel you are not in gives nothing", !lg.frames.some((f) => f.channel === priv.id));
check("the owner cannot read it over the API", (await A.api(`/channels/${priv.id}/messages`)).status === 404);
check("nor its thread", (await A.api(`/messages/${secret.data.message.id}/thread`)).status === 404);
check("search finds it for its member", (await B.api("/search?q=" + encodeURIComponent("confidencial " + run))).data.results.length === 1);
check("search never shows it to others", (await A.api("/search?q=" + encodeURIComponent("confidencial " + run))).data.results.length === 0 && (await G.api("/search?q=confidencial")).data.results.length === 0);

// ---- DMs
const dm = (await A.api("/dm", { method: "POST", body: { people: [ids.B] } })).data;
await A.api(`/channels/${dm.id}/messages`, { method: "POST", body: { text: "solo entre nosotros " + run } });
check("a DM: the third person cannot read it", (await G.api(`/channels/${dm.id}/messages`)).status === 404 && (await G.api("/search?q=nosotros")).data.results.length === 0);
check("a DM reaches the other person's socket", await lb.next((f) => f.type === "chat.message" && f.channel === dm.id).then(() => true, () => false));

// ---- threads, mentions, unread
const root = (await A.api(`/channels/${general.id}/messages`, { method: "POST", body: { text: "¿Quién revisa el informe " + run + "?" } })).data.message;
await B.api(`/channels/${general.id}/messages`, { method: "POST", body: { text: "Yo, <@" + ids.A + ">", thread: root.id } });
await B.api(`/channels/${general.id}/messages`, { method: "POST", body: { text: "Hecho", thread: root.id, alsoChannel: true } });
const thread = (await A.api(`/messages/${root.id}/thread`)).data;
check("a thread with two replies, one also in the channel", thread.replies.length === 2 && (await A.api(`/channels/${general.id}/messages`)).data.messages.some((m) => m.broadcast));
await A.api(`/channels/${general.id}/messages`, { method: "POST", body: { text: "<@" + ids.B + "> mira esto" } });
let bch = (await B.api("/channels")).data.channels.find((c) => c.id === general.id);
check("unread and mentions per person", bch.unread >= 1 && bch.mentions >= 1, JSON.stringify(bch));
await B.api(`/channels/${general.id}/read`, { method: "POST", body: {} });
bch = (await B.api("/channels")).data.channels.find((c) => c.id === general.id);
check("«marcar como leído»", bch.unread === 0 && bch.mentions === 0);
check("«Para ti» lists the mention", (await B.api("/mentions")).data.items.some((i) => i.kind === "mention"));

// ---- typing
lb.send({ type: "watch", channel: general.id });
la.send({ type: "typing", channel: general.id });
check("typing reaches the channel's people", await lb.next((f) => f.type === "chat.typing" && f.person === ids.A).then(() => true, () => false));

// ---- files and previews
const up = await B.req(`/api/chat/files?channel=${priv.id}&name=informe.txt`, { method: "PUT", raw: new TextEncoder().encode("contenido " + run), type: "text/plain" });
check("upload a file to R2", up.status === 201, JSON.stringify(up.data));
await B.api(`/channels/${priv.id}/messages`, { method: "POST", body: { text: "adjunto", files: [up.data.id] } });
const dl = await B.req(`/api/chat/files/${up.data.id}`);
check("download it", dl.status === 200 && new TextDecoder().decode(dl.data) === "contenido " + run);
check("others cannot download it", (await A.req(`/api/chat/files/${up.data.id}`)).status === 404);
const linkMsg = (await A.api(`/channels/${general.id}/messages`, { method: "POST", body: { text: "Mira <https://example.com/|esto>" } })).data.message;
const preview = await la.next((f) => f.type === "chat.update" && f.message?.id === linkMsg.id && f.message.preview, 15000).catch(() => null);
check("a link preview fetched by the server", !!preview?.message.preview?.title, JSON.stringify(preview?.message?.preview));

// ---- push subscriptions (a browser is needed to really subscribe; the server side is checked)
const fakeKey = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
check("push: only known push services", (await B.api("/push", { method: "POST", body: { subscription: { endpoint: "https://127.0.0.1/x", keys: { p256dh: fakeKey, auth: randomBytes(16).toString("base64url") } } } })).status === 400);
check("push: a subscription is kept", (await B.api("/push", { method: "POST", body: { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/e2e-" + run, keys: { p256dh: fakeKey, auth: randomBytes(16).toString("base64url") } } } })).status === 200);
check("push: the server has a VAPID key", !!boot.Beto.push?.publicKey);
const pt = await B.api("/push/test", { method: "POST", body: {} });
check("push: sending reaches the push service (a fake endpoint is refused there)", pt.status === 200 && pt.data?.sent === 0, JSON.stringify(pt.data));

// ---- fan-out to N sockets
const extra = [];
for (let i = 0; i < SOCKETS; i++) extra.push(live(i % 2 ? A : B));
await Promise.all(extra.map((s) => s.opened));
const fan = [];
for (let round = 0; round < 5; round++) {
  const marker = "fan " + run + " " + round;
  const t0 = performance.now();
  const waits = extra.map((s) => s.next((f) => f.type === "chat.message" && f.message?.text === marker, 15000));
  await A.api(`/channels/${general.id}/messages`, { method: "POST", body: { text: marker } });
  const got = await Promise.all(waits).catch(() => null);
  if (got) fan.push({ all: Math.max(...got.map((f) => f.__at)) - t0, first: Math.min(...got.map((f) => f.__at)) - t0 });
  await sleep(300);
}
for (const s of extra) s.close();
// What the network alone costs from here: a round trip to the same workspace object.
const rtt = [];
for (let i = 0; i < 10; i++) { const t = performance.now(); await A.api("/presence"); rtt.push(performance.now() - t); }
numbers.fanout = {
  sockets: SOCKETS, rounds: fan.length, postToLastSocketMs: fan.map((f) => Math.round(f.all)),
  p50: Math.round(pct(fan.map((f) => f.all), 50)), max: Math.round(Math.max(...fan.map((f) => f.all))),
  firstToLastSocketP50: Math.round(pct(fan.map((f) => f.all - f.first), 50)), roundTripP50: Math.round(pct(rtt, 50)),
};
check(`fan-out to ${SOCKETS} sockets (post → every socket)`, fan.length === 5, JSON.stringify(numbers.fanout));

// ---- Slack import (synthetic export, with a big channel)
const people = [{ name: "Ana", email: A.email }, { name: "Beto", email: B.email }, { name: "Gil", email: G.email }];
const zip = await buildSyntheticExport({ people, bigChannelMessages: BIG });
const expect = syntheticExpectations({ people, bigChannelMessages: BIG });
check("only admins import", (await B.api("/import", { method: "POST", body: { size: zip.length } })).status === 403);
const imp = (await A.api("/import", { method: "POST", body: { size: zip.length, name: "slack-sintetico.zip" } })).data;
const t0 = performance.now();
for (let k = 0; k < imp.parts; k++) {
  const r = await A.req(`/api/chat/import/${imp.id}/parts/${k}`, { method: "PUT", raw: zip.subarray(k * imp.partSize, (k + 1) * imp.partSize), type: "application/zip" });
  if (r.status !== 200) check("upload part " + k, false, JSON.stringify(r.data));
}
await A.api(`/import/${imp.id}/start`, { method: "POST", body: {} });
let status = null;
for (let i = 0; i < 600; i++) {
  status = (await A.api("/import")).data.import;
  if (!["queued", "running"].includes(status.status)) break;
  await sleep(2000);
}
numbers.import = { zipBytes: zip.length, messages: status?.counts?.messages, seconds: Math.round((performance.now() - t0) / 1000) };
check("the import finishes", status?.status === "done", JSON.stringify(status));
const c = status?.counts || {};
check("import: people matched by email", c.matched === expect.matchedByEmail, JSON.stringify(c));
check("import: outsiders become pending invitations", c.invited === expect.outsiders);
check("import: channels per kind", c.channels?.public === expect.conversations.public && c.channels?.private === expect.conversations.private && c.channels?.dm === expect.conversations.dm && c.channels?.group === expect.conversations.group);
check("import: every message, thread and reply", c.messages === expect.messages && c.replies === expect.replies && c.threads === expect.threads);
check("import: files held and linked", c.files?.held === expect.files.held && c.files?.linked === expect.files.linked);
const after = (await A.api("/channels")).data.channels;
const historico = after.find((x) => x.name === "historico") || (await A.api("/channels/browse")).data.channels.find((x) => x.name === "historico");
check("the big channel is there", !!historico);
if (historico) {
  const times = [];
  let page;
  for (let i = 0; i < 10; i++) { const t = performance.now(); page = await A.api(`/channels/${historico.id}/messages?limit=50`); times.push(performance.now() - t); }
  const t1 = performance.now();
  const older = await A.api(`/channels/${historico.id}/messages?limit=50&before=${page.data.messages[0].seq}`);
  const olderMs = performance.now() - t1;
  const t2 = performance.now();
  const mid = await A.api(`/channels/${historico.id}/messages?limit=50&around=${page.data.messages[0].seq - Math.floor(BIG / 2)}`);
  const midMs = performance.now() - t2;
  const t3 = performance.now();
  const found = await A.api("/search?q=" + encodeURIComponent("in:#historico mensaje"));
  const searchMs = performance.now() - t3;
  numbers.bigChannel = { messages: BIG, firstPageP50: Math.round(pct(times, 50)), firstPageMax: Math.round(Math.max(...times)), olderMs: Math.round(olderMs), aroundMiddleMs: Math.round(midMs), searchMs: Math.round(searchMs) };
  check(`open a channel of ${BIG} messages by pages`, page.data.messages.length === 50 && older.data.messages.length === 50 && mid.data.messages.length === 50, JSON.stringify(numbers.bigChannel));
  check("search inside it", found.status === 200 && found.data.results.length > 0);
}
const imported = (await B.api("/channels")).data.channels.find((x) => x.kind === "private" && x.name?.startsWith("direccion") && x.id !== priv.id);
check("an imported private channel keeps its members (Beto in, Gil out)", !!imported && (await G.api(`/channels/${imported.id}/messages`)).status === 404);

// ---- admin
check("retention and digest settings (admin only)", (await B.api("/admin/settings", { method: "PATCH", body: { retentionDays: 365 } })).status === 403 && (await A.api("/admin/settings", { method: "PATCH", body: { retentionDays: 3650, digestMinutes: 30 } })).status === 200);
const exp = await A.req("/api/chat/admin/export.zip?files=0");
check("a workspace export (ZIP)", exp.status === 200 && exp.data[0] === 0x50 && exp.data[1] === 0x4b, String(exp.status));
const deact = await A.req(`/auth/workspace/members/${ids.G}/deactivate`, { method: "POST", body: {} });
check("deactivate the guest", deact.status === 200, JSON.stringify(deact.data));
check("their session ends", [401, 409].includes((await G.api("/bootstrap")).status));
await sleep(1000);
check("their socket is closed", lg.ws.readyState >= 2);
const people2 = (await A.api("/people")).data.people;
check("their name stays, marked deactivated", people2.some((p) => p.id === ids.G && p.deactivated));
const audit = (await A.api("/admin/audit")).data.entries.map((e) => e.action);
check("the audit log has the admin actions", ["deactivate", "invite", "settings", "export", "import.done"].every((a) => audit.includes(a)), audit.join(","));

for (const s of [la, lb, lg]) s.close();
const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
console.log("numbers " + JSON.stringify(numbers));
process.exit(failed.length ? 1 : 0);
