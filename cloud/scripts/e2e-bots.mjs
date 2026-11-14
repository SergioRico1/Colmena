// End-to-end check of bots in hosted Colmena (docs/CLOUD.md › Phase 3), against the deployed
// Worker (or `npm run dev`), with the deterministic fake model only:
//   node scripts/e2e-bots.mjs [--url https://…] [--env ../.local/cloud-phase1.env,../.local/cloud-phase3.env] [--concurrency 6]
// Needs ADMIN_BOOTSTRAP_TOKEN (dev mail of test addresses) and FAKE_MODEL_TOKEN (the test flag),
// from the environment or the --env files. Test people use example.com only.
// Checks: a mention in a channel answers; a plan with two bots completes; a routine fires on its
// alarm with nobody connected; its red line goes to the owner and the delegate only and the
// delegate's decision applies; a pre-approval applies on the next run; the object evicted
// mid-mission resumes; messaging stays responsive while bots work (numbers); a webhook starts
// its routine at the workspace's public address.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const envFiles = arg("env", here("../../.local/cloud-phase1.env") + "," + here("../../.local/cloud-phase3.env")).split(",");
const fromEnv = (name) => process.env[name] || envFiles.map((f) => (existsSync(f) ? new RegExp("^" + name + "=(\\S+)$", "m").exec(readFileSync(f, "utf8"))?.[1] : null)).find(Boolean) || null;
const ADMIN = fromEnv("ADMIN_BOOTSTRAP_TOKEN");
const FAKE = fromEnv("FAKE_MODEL_TOKEN");
if (!ADMIN || !FAKE) throw Error("ADMIN_BOOTSTRAP_TOKEN and FAKE_MODEL_TOKEN are needed.");
const CONCURRENCY = Number(arg("concurrency", "6"));
const run = randomBytes(3).toString("hex");
const results = [];
const numbers = {};
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 400) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };
async function until(fn, { timeout = 60000, step = 750 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await sleep(step);
  }
}

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
  async req(path, { method = "GET", body } = {}) {
    const h = {};
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (method !== "GET") { h["Content-Type"] = "application/json"; h.Origin = BASE; if (this.csrf) h["X-Colmena-Token"] = this.csrf; }
    const response = await fetch(BASE + path, { method, headers: h, redirect: "manual", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    this.keep(response);
    let data = null;
    try { data = await response.json(); } catch {}
    return { status: response.status, data };
  }
  async signIn() {
    const r = await this.req("/auth/link", { method: "POST", body: { email: this.email } });
    if (r.status !== 202) throw Error(this.label + " link: " + r.status + " " + JSON.stringify(r.data));
    const token = await mailToken(this.email, "signin");
    const v = await this.req("/auth/verify", { method: "POST", body: { token } });
    if (v.status !== 200) throw Error(this.label + " verify: " + v.status + " " + JSON.stringify(v.data));
    await this.refresh();
  }
  async refresh() { const m = await this.req("/auth/me"); this.csrf = m.data?.csrf || null; return m; }
  async post(channel, text, thread = null) {
    const t0 = performance.now();
    const r = await this.req(`/api/chat/channels/${channel}/messages`, { method: "POST", body: { text, ...(thread ? { thread } : {}) } });
    return { ...r, ms: performance.now() - t0 };
  }
  thread(id) { return this.req(`/api/chat/messages/${id}/thread`).then((r) => (r.data?.replies || r.data?.messages || [])); }
}
async function mailToken(email, kind) {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } });
    const list = await r.json().catch(() => []);
    const mail = (Array.isArray(list) ? list : []).find((m) => m.kind === kind);
    if (mail) return new URL(mail.url).hash.slice(3);
    await sleep(500);
  }
  throw Error("no " + kind + " mail for " + email);
}
const dev = async (what, { method = "POST", body = null, query = "" } = {}) => {
  const r = await fetch(BASE + "/auth/dev/test/" + what + query, { method, headers: { Authorization: "Bearer " + FAKE, ...(body ? { "Content-Type": "application/json", Origin: BASE } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
/** The bot answers (and the time from `since`) in a thread. */
async function botReplies(P, root, { authors = [], since = performance.now(), timeout = 60000 } = {}) {
  const found = await until(async () => {
    const replies = await P.thread(root);
    const bots = replies.filter((m) => String(m.author).startsWith("bot:"));
    return authors.every((a) => bots.some((m) => m.author === a)) && bots.length ? bots : null;
  }, { timeout, step: 400 });
  return { replies: found || [], ms: found ? performance.now() - since : null };
}

const A = new Person("Ana", `ana.bots.${run}@example.com`);
const B = new Person("Beto", `beto.bots.${run}@example.com`);
const D = new Person("Dora", `dora.bots.${run}@example.com`);

console.log("Colmena bots e2e against " + BASE + " (run " + run + ")");
await A.signIn(); await B.signIn(); await D.signIn();
const made = await A.req("/auth/workspaces", { method: "POST", body: { name: "Pruebas fase 3 " + run } });
check("a company", made.status === 201, JSON.stringify(made.data));
for (const P of [B, D]) {
  const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: P.email, role: "member" } });
  const acc = await P.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(inv.data.link).hash.slice(3) } });
  check(`${P.label} joins`, acc.status === 200, JSON.stringify(acc.data));
  await P.refresh();
}
const boot = (await A.req("/api/chat/bootstrap")).data;
const WS = boot.workspace.id;
const ids = { A: boot.me.id, B: (await B.req("/api/chat/bootstrap")).data.me.id, D: (await D.req("/api/chat/bootstrap")).data.me.id };
const general = boot.channels.find((c) => c.name === "general");
check("the seeded bots can be named", ["atlas", "nora", "tomas", "iris", "vera", "bruno"].every((b) => boot.bots.some((x) => x.id === b)), JSON.stringify(boot.bots));
check("without the test secret the fake model cannot be turned on", (await fetch(BASE + "/auth/dev/test/fake-model", { method: "POST", headers: { Authorization: "Bearer nope", "Content-Type": "application/json" }, body: JSON.stringify({ workspace: WS, on: true }) })).status === 404);
const before = (await A.req("/api/state")).data;
check("a new workspace has no fake model and no AI account", before.ai?.fake === false && before.ai?.mine === false, JSON.stringify(before.ai));
check("the subscription sign-ins start off", before.ai?.policy?.chatgptLogin === false && before.ai?.policy?.claudeToken === false);
check("a member cannot turn them on", (await B.req("/api/cloud/ai/policy", { method: "PUT", body: { chatgptLogin: true } })).status === 403);
check("ChatGPT by code is refused while off", (await B.req("/api/cloud/ai/chatgpt/device", { method: "POST", body: {} })).status === 403);
check("the test flag on", (await dev("fake-model", { body: { workspace: WS, on: true } })).data?.fakeModel === true);

// ---- 1. a mention in a channel answers
{
  const sent = await A.post(general.id, "<@bot:nora> resume lo de esta semana");
  const t0 = performance.now();
  const { replies, ms } = await botReplies(A, sent.data.message.id, { authors: ["bot:nora"], since: t0 });
  check("a mention in a channel answers in its thread", replies.some((m) => /Nora \(modelo de prueba\): resume lo de esta semana/.test(m.text)), JSON.stringify(replies));
  numbers.mentionAnswerMs = ms && Math.round(ms);
  const again = await B.post(general.id, "y añade los gastos", sent.data.message.id);
  const second = await botReplies(B, sent.data.message.id, { timeout: 30000 });
  check("a reply in the thread goes on with the same bot", again.status === 201 && (await until(async () => (await B.thread(sent.data.message.id)).filter((m) => m.author === "bot:nora").length >= 2, { timeout: 30000 })), JSON.stringify(second.replies));
}

// ---- 2. a plan with two bots completes
{
  const t0 = performance.now();
  const sent = await A.post(general.id, "<@bot:nora> <@bot:tomas> preparad el informe trimestral [[plan:nora,tomas]]");
  const { replies, ms } = await botReplies(A, sent.data.message.id, { authors: ["bot:nora", "bot:tomas", "bot:atlas"], since: t0, timeout: 90000 });
  numbers.planMs = ms && Math.round(ms);
  check("a plan with two bots: Nora, Tomás and Atlas speak in the thread", replies.length >= 3, JSON.stringify(replies.map((m) => m.author)));
  const missions = (await A.req("/api/state")).data.missions || [];
  const done = await until(async () => ((await A.req("/api/state")).data.missions || []).find((m) => m.mode === "equipo" && m.status === "completed"), { timeout: 30000 });
  check("the plan's mission completes", !!done, JSON.stringify(missions.map((m) => [m.mode, m.status])));
}

// ---- 3. concurrency: messaging while several people's bots work
{
  const idle = [];
  for (let i = 0; i < 15; i++) idle.push((await B.post(general.id, "idle " + i)).ms);
  const people = [A, B, D];
  const roots = [];
  for (let i = 0; i < CONCURRENCY; i++) roots.push((await people[i % 3].post(general.id, `<@bot:${["nora", "vera", "iris"][i % 3]}> trabajo largo ${i} [[slow:20000]]`)).data.message.id);
  const busy = [];
  let probe = null;
  for (let i = 0; i < 25; i++) {
    busy.push((await D.post(general.id, "mientras trabajan " + i)).ms);
    if (i === 12) probe = await dev("probe", { method: "GET", query: "?workspace=" + WS });
  }
  numbers.idlePostMs = { p50: pct(idle, 50), p95: pct(idle, 95) };
  numbers.busyPostMs = { p50: pct(busy, 50), p95: pct(busy, 95), botsWorking: probe.data?.working ?? null };
  check("the bots were working while messages were measured", (probe?.data?.working || 0) >= 1, JSON.stringify(probe?.data));
  check(`messaging stays responsive with ${CONCURRENCY} bots working (p50 ${numbers.busyPostMs.p50} ms vs ${numbers.idlePostMs.p50} ms idle)`, numbers.busyPostMs.p50 < numbers.idlePostMs.p50 * 2 + 150, JSON.stringify(numbers));
  const t0 = performance.now();
  const all = await Promise.all(roots.map((r) => botReplies(A, r, { timeout: 90000 })));
  numbers.concurrentAllAnsweredMs = Math.round(performance.now() - t0);
  check(`all ${CONCURRENCY} concurrent turns answer`, all.every((x) => x.replies.length), JSON.stringify(all.map((x) => x.replies.length)));
}

// ---- 4. the object evicted mid-mission resumes
{
  const t0 = performance.now();
  const sent = await A.post(general.id, "<@bot:vera> escribe la nota de prensa [[slow:12000]]");
  await sleep(2500);
  const pre = await dev("probe", { method: "GET", query: "?workspace=" + WS });
  check("the bot is working before the eviction", pre.data?.working >= 1, JSON.stringify(pre.data));
  const ev = await dev("evict", { body: { workspace: WS } });
  check("the object is evicted (DurableObjectState#abort)", ev.status === 200, JSON.stringify(ev.data));
  // Nobody asks anything: the alarm wakes the object, which resumes the cut work by itself.
  const { replies, ms } = await botReplies(A, sent.data.message.id, { authors: ["bot:vera"], since: t0, timeout: 120000 });
  const post = await dev("probe", { method: "GET", query: "?workspace=" + WS });
  check("a fresh object took over", post.data?.bootedAt > pre.data?.bootedAt, JSON.stringify([pre.data, post.data]));
  check("the evicted mission resumes and answers", replies.length > 0, JSON.stringify(replies));
  numbers.evictedAnswerMs = ms && Math.round(ms);
}

// ---- 5. a routine fires on its alarm with nobody connected; its red line goes to the owner and the delegate
let ruleId = null, approvalId = null;
{
  const at = new Date(Date.now() + 150_000);
  const pad = (n) => String(n).padStart(2, "0");
  const fecha = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`, hora = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
  const made = await A.req("/api/automations", { method: "POST", body: { name: "Limpiar agenda " + run, prompt: "Borra el evento de prueba [[app:GOOGLECALENDAR_DELETE_EVENT]]", botId: "nora", trigger: { type: "vez", config: { vezFecha: fecha, vezHora: hora, vezAviso: false } } } });
  check("Ana makes a routine", made.status === 201, JSON.stringify(made.data));
  ruleId = made.data?.id;
  const deleg = await A.req(`/api/automations/${ruleId}/approver`, { method: "PUT", body: { contactId: ids.B } });
  check("Beto decides its red lines too", deleg.data?.approver?.contactId === ids.B, JSON.stringify(deleg.data));
  console.log("  …   waiting for the routine's alarm at " + hora + " UTC with nobody connected");
  const due = at.getTime() - (at.getTime() % 60000);
  await sleep(Math.max(0, due - Date.now() + 20_000));
  const approval = await until(async () => ((await A.req("/api/state")).data.approvals || []).find((a) => a.status === "pending" && /GOOGLECALENDAR|calendar|evento/i.test(JSON.stringify(a))), { timeout: 90000, step: 3000 });
  approvalId = approval?.id;
  check("the routine ran by itself and its red line waits for Ana", !!approval, "no approval");
  numbers.routineLateMs = approval ? Math.round(Date.parse(approval.createdAt || new Date().toISOString()) - due) : null;
  check("the delegate sees it", ((await B.req("/api/state")).data.approvals || []).some((a) => a.id === approvalId));
  check("someone else does not", !((await D.req("/api/state")).data.approvals || []).some((a) => a.id === approvalId));
  check("it is in Beto's Bandeja", ((await B.req("/api/state")).data.notifications || []).some((n) => n.approvalId === approvalId || n.id === "approval:" + approvalId));
  const review = await B.req("/api/connections/review/" + encodeURIComponent(approvalId));
  check("someone else may not decide it", (await D.req("/api/connections/review/" + encodeURIComponent(approvalId), { method: "POST", body: { decision: "approved", revision: review.data?.revision || "x" } })).status === 403);
  const decided = await B.req("/api/connections/review/" + encodeURIComponent(approvalId), { method: "POST", body: { decision: "approved", revision: review.data?.revision } });
  check("the delegate approves and the action runs", decided.status === 200 && (decided.data?.ok !== false), JSON.stringify(decided.data));
  const finished = await until(async () => ((await A.req("/api/automations/" + ruleId + "/runs")).data || []).find((r) => r.status === "completed"), { timeout: 60000 });
  check("the routine's run completes", !!finished);
}

// ---- 6. a pre-approval applies on the next run
{
  const kept = await A.req(`/api/automations/${ruleId}/preapprovals`, { method: "POST", body: { approvalId, uses: "always" } });
  check("Ana keeps it approved for this routine", kept.status === 201, JSON.stringify(kept.data));
  const again = await A.req(`/api/automations/${ruleId}/test`, { method: "POST", body: {} });
  const ran = await until(async () => {
    const list = (await A.req("/api/state")).data.approvals || [];
    return list.find((a) => a.id !== approvalId && a.missionId === again.data?.missionId && a.status !== "pending") || null;
  }, { timeout: 60000 });
  check("the next run does it without asking", !!ran && /adelantado/i.test(JSON.stringify(ran)), JSON.stringify(ran));
}

// ---- 7. a webhook starts its routine at the workspace's public address
{
  const made = await A.req("/api/automations", { method: "POST", body: { name: "Aviso " + run, prompt: "Mira el pedido", botId: "nora", trigger: { type: "webhook", config: { servicio: "generico" } } } });
  const view = (await A.req(`/api/automations/${made.data?.id}/webhook`)).data;
  const address = view?.url || view?.address;
  check("a webhook routine has a public address", /\/hooks\/[0-9a-f-]{36}\/h\//.test(address || ""), JSON.stringify(view));
  if (address) {
    const r = await fetch(address, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pedido: 42 }) });
    const ran = await until(async () => ((await A.req(`/api/automations/${made.data.id}/runs`)).data || []).length > 0, { timeout: 60000 });
    check("posting to it starts the routine", r.status === 202 && !!ran);
  }
}

await dev("fake-model", { body: { workspace: WS, on: false } });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(JSON.stringify({ numbers }, null, 1));
process.exit(failed.length ? 1 : 0);
