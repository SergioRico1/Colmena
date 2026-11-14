// End-to-end check of hosted Colmena (docs/CLOUD.md › Phase 1), against `npm run dev` or the
// deployed Worker, with test addresses only (example.com / example.org):
//   node scripts/e2e.mjs [--url https://…] [--env ../.local/cloud.env]
// The dev mail fallback is read with ADMIN_BOOTSTRAP_TOKEN (from the environment or --env file).
// Checks: sign-in by link (single use), sessions and CSRF, a company, an invitation accepted by
// its address only, a shared room in real time over the WebSocket, who wrote each message, a
// direct message only its two people see, a guest's limits, isolation between two companies,
// removal ending the removed person's sessions, and logout.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const envFile = arg("env", new URL("../../.local/cloud.env", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ADMIN = process.env.ADMIN_BOOTSTRAP_TOKEN || (existsSync(envFile) ? /^ADMIN_BOOTSTRAP_TOKEN=(\S+)$/m.exec(readFileSync(envFile, "utf8"))?.[1] : null);
if (!ADMIN) throw Error("ADMIN_BOOTSTRAP_TOKEN is needed to read the dev mail.");
const run = randomBytes(3).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + detail : "")); };

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
  async req(path, { method = "GET", body, csrf = true, origin = BASE, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (method !== "GET") { h["Content-Type"] = "application/json"; if (origin) h.Origin = origin; if (csrf && this.csrf) h["X-Colmena-Token"] = this.csrf; }
    const response = await fetch(BASE + path, { method, headers: h, redirect: "manual", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    this.keep(response);
    let data = null;
    try { data = await response.clone().json(); } catch {}
    return { status: response.status, data, response };
  }
  async signIn() {
    const r = await this.req("/auth/link", { method: "POST", body: { email: this.email } });
    if (r.status !== 202) throw Error(this.label + " link: " + r.status + " " + JSON.stringify(r.data));
    const token = await latestMail(this.email, "signin");
    const v = await this.req("/auth/verify", { method: "POST", body: { token } });
    if (v.status !== 200) throw Error(this.label + " verify: " + v.status + " " + JSON.stringify(v.data));
    await this.refresh();
    return token;
  }
  async refresh() { const m = await this.req("/auth/me"); this.csrf = m.data?.csrf || null; return m; }
}
async function latestMail(email, kind) {
  const r = await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } });
  const list = await r.json();
  const mail = (Array.isArray(list) ? list : []).find((m) => m.kind === kind);
  if (!mail) throw Error("no " + kind + " mail for " + email + " (" + r.status + ")");
  return new URL(mail.url).hash.slice(3);
}
function live(person) {
  const url = BASE.replace(/^http/, "ws") + "/api/live";
  const ws = new WebSocket(url, { headers: { Cookie: person.cookieHeader(), Origin: BASE } });
  const frames = [];
  const waiters = [];
  ws.onmessage = (e) => {
    let f; try { f = JSON.parse(e.data); } catch { return; }
    frames.push(f);
    for (const w of [...waiters]) if (w.test(f)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(f); }
  };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error("socket error")); });
  return {
    ws, frames, opened,
    next: (test, ms = 8000) => new Promise((resolve, reject) => {
      const found = frames.find(test);
      if (found) return resolve(found);
      const w = { test, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(Error("timeout")); } }, ms);
    }),
  };
}

const A = new Person("Ana", `ana.${run}@example.com`);
const B = new Person("Beto", `beto.${run}@example.com`);
const C = new Person("Cora", `cora.${run}@example.org`);
const G = new Person("Gil", `gil.${run}@example.com`);

console.log("Colmena hosted e2e against " + BASE);
// ---- sign-in
check("health", (await (await fetch(BASE + "/health")).json()).phase === 1);
check("app needs a session (redirect to /entrar)", (await A.req("/")).response.headers.get("location")?.startsWith("/entrar"));
check("api needs a session", (await A.req("/api/state")).status === 401);
check("a cross-site link request is refused", (await A.req("/auth/link", { method: "POST", body: { email: A.email }, origin: "https://evil.example" })).status === 403);
const usedToken = await A.signIn();
check("sign-in by link sets a session", (await A.refresh()).data?.user?.email === A.email);
check("a link works once", (await new Person("x", "x@example.com").req("/auth/verify", { method: "POST", body: { token: usedToken } })).status === 410);
check("the dev mail needs the admin token", (await fetch(BASE + "/auth/dev/mail?email=" + A.email)).status === 404);

// ---- a company
const made = await A.req("/auth/workspaces", { method: "POST", body: { name: "Prueba " + run } });
check("create a company", made.status === 201, JSON.stringify(made.data));
check("a write without CSRF is refused", (await A.req("/auth/workspaces", { method: "POST", body: { name: "x" }, csrf: false })).status === 403);
const stateA = await A.req("/api/state");
check("the company's server answers /api/state", stateA.status === 200 && stateA.data?.cloud?.me?.id, stateA.status + " " + JSON.stringify(stateA.data)?.slice(0, 300));
check("its owner is the owner", stateA.data?.cloud?.me?.role === "owner");
check("desktop-only places are hidden", stateA.data?.cloud?.hidden?.includes("codigo") && (await A.req("/api/code/tasks")).status === 404);
check("the app page is served marked as hosted", (await (await A.req("/")).response.text()).includes('name="colmena-host"'));

// ---- invitation
const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: B.email, role: "member" } });
check("invite by email", inv.status === 201 && inv.data?.link, JSON.stringify(inv.data));
const invToken = new URL(inv.data.link).hash.slice(3);
await C.signIn();
check("an invitation is only for its address", (await C.req("/auth/invitations/accept", { method: "POST", body: { token: invToken } })).status === 403);
await B.signIn();
check("the invitation previews its company", (await B.req("/auth/invitations/preview", { method: "POST", body: { token: invToken } })).data?.workspace === "Prueba " + run);
const acc = await B.req("/auth/invitations/accept", { method: "POST", body: { token: invToken } });
check("accept the invitation", acc.status === 200, JSON.stringify(acc.data));
await B.refresh();
const dir = await B.req("/auth/workspace");
check("the directory lists both", dir.data?.members?.length === 2);

// ---- a shared room in real time
const room = await A.req("/api/rooms", { method: "POST", body: { title: "General " + run } });
check("create a room", room.status === 201, room.status + " " + JSON.stringify(room.data)?.slice(0, 300));
const missionId = room.data?.missionId;
const stateB = await B.req("/api/state");
check("the other person sees the room", stateB.data?.missions?.some((m) => m.id === missionId));
const sockB = live(B);
await sockB.opened;
check("live socket opens", sockB.ws.readyState === 1);
const t0 = Date.now();
const sent = await A.req(`/api/missions/${missionId}/messages`, { method: "POST", body: { text: "Hola equipo " + run } });
check("send a message", sent.status === 200, sent.status + " " + JSON.stringify(sent.data)?.slice(0, 300));
const pushed = await sockB.next((f) => f.type === "push" && f.kind === "messages" && f.record?.text === "Hola equipo " + run).catch(() => null);
check("the other person gets it live", !!pushed, "frames: " + JSON.stringify(sockB.frames.slice(-3)).slice(0, 300));
if (pushed) console.log(`       (live in ${Date.now() - t0} ms)`);
check("it says who wrote it", pushed?.record?.author?.name === "ana." + run && pushed?.record?.author?.you === false, JSON.stringify(pushed?.record?.author));
const detailA = await A.req(`/api/missions/${missionId}`);
const mine = (detailA.data?.messages || []).find((m) => m.text === "Hola equipo " + run);
check("to its writer it is «Tú»", mine?.author?.you === true, JSON.stringify(mine?.author));
check("no bot took a turn", !(detailA.data?.steps || []).length);
const attached = await A.req(`/api/missions/${missionId}/messages`, { method: "POST", body: { text: "El acta", attachments: [{ name: "acta.txt", content: "Acta " + run }] } });
check("send a file", attached.status === 200, attached.status + " " + JSON.stringify(attached.data)?.slice(0, 200));
const raw = await B.req(`/api/missions/${missionId}/workfiles/raw?path=acta.txt&download=1`);
check("the other person downloads it (R2 or the object's SQLite)", raw.status === 200 && (await raw.response.text()) === "Acta " + run, String(raw.status));

// ---- a direct message only its two people see; a guest's limits
const ginv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: G.email, role: "guest" } });
await G.signIn();
await G.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(ginv.data.link).hash.slice(3) } });
await G.refresh();
const dm = await A.req("/api/cloud/dm", { method: "POST", body: { person: B.data?.id || (await B.req("/auth/me")).data.user.id } });
check("open a direct message", dm.status === 201 && dm.data?.missionId, JSON.stringify(dm.data));
await A.req(`/api/missions/${dm.data.missionId}/messages`, { method: "POST", body: { text: "Solo para ti " + run } });
check("the other one of the two sees it", (await B.req("/api/state")).data?.missions?.some((m) => m.id === dm.data.missionId));
const gState = await G.req("/api/state");
check("a third person does not see it", gState.status === 200 && !gState.data?.missions?.some((m) => m.id === dm.data.missionId));
check("nor can open it", (await G.req(`/api/missions/${dm.data.missionId}`)).status === 404);
check("a guest can talk in a room", (await G.req(`/api/missions/${missionId}/messages`, { method: "POST", body: { text: "Hola, soy invitado" } })).status === 200);
check("a guest cannot change the company", (await G.req("/api/settings", { method: "PATCH", body: { language: "es" } })).status === 403);
const gInvite = await G.req("/auth/workspace/invitations", { method: "POST", body: { email: "z." + run + "@example.com" } });
check("a guest cannot invite", gInvite.status === 403, gInvite.status + " " + JSON.stringify(gInvite.data));

// ---- isolation between two companies
const other = await C.req("/auth/workspaces", { method: "POST", body: { name: "Otra " + run } });
check("a second company", other.status === 201);
const stateC = await C.req("/api/state");
check("its people see none of the first one's rooms", stateC.status === 200 && !stateC.data?.missions?.some((m) => m.id === missionId) && stateC.data?.cloud?.workspace?.id === other.data.workspace.id);
check("nor can open them", (await C.req(`/api/missions/${missionId}`)).status === 404);
check("nor switch into it", (await C.req("/auth/workspaces/select", { method: "POST", body: { id: made.data.workspace.id } })).status === 403);
check("a forged person header changes nothing", (await C.req("/api/state", { headers: { "X-Colmena-Person": JSON.stringify({ id: "x", role: "owner" }), "X-Colmena-Workspace": made.data.workspace.id } })).data?.cloud?.workspace?.id === other.data.workspace.id);

// ---- removal ends the sessions; logout
const sockG = live(G);
await sockG.opened.catch(() => {});
const gId = (await G.req("/auth/me")).data.user.id;
const removed = await A.req(`/auth/workspace/members/${gId}`, { method: "DELETE", body: {} });
check("remove a member", removed.status === 200 && removed.data?.revokedSessions >= 1, JSON.stringify(removed.data));
check("their session ended", (await G.req("/api/state")).status === 401);
await new Promise((r) => setTimeout(r, 500));
check("their live socket closed", sockG.ws.readyState >= 2);
sockB.ws.close();
const out = await B.req("/auth/logout", { method: "POST", body: {} });
check("logout", out.status === 200 && (await B.req("/api/state")).status === 401);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
