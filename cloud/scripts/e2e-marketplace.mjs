// End-to-end check of the connections marketplace (docs/CONNECTIONS.md › Marketplace) against the
// deployed Worker, with test people on example.com only and no real credentials:
//   node scripts/e2e-marketplace.mjs [--url https://…] [--env ../.local/cloud-phase1.env,../.local/cloud-phase3.env]
// Needs ADMIN_BOOTSTRAP_TOKEN (dev mail) and FAKE_MODEL_TOKEN (the test flag keeps Composio offline).
// Checks: the catalogue per person; Google «Disponible pronto» without Colmena's client; mail errors
// in plain Spanish through the Worker's TCP sockets (an unreachable host, Microsoft refused); a member
// cannot connect for the whole company; your own Composio key is yours alone; nobody sees others'.
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
const run = randomBytes(3).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 400) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Person {
  constructor(label, email) { this.label = label; this.email = email; this.cookies = new Map(); this.csrf = null; }
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
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => k + "=" + v).join("; ");
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
    const token = await mailToken(this.email);
    const v = await this.req("/auth/verify", { method: "POST", body: { token } });
    if (v.status !== 200) throw Error(this.label + " verify: " + v.status);
    await this.refresh();
  }
  async refresh() { const m = await this.req("/auth/me"); this.csrf = m.data?.csrf || null; return m; }
}
async function mailToken(email) {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } });
    const list = await r.json().catch(() => []);
    const mail = (Array.isArray(list) ? list : []).find((m) => m.kind === "signin");
    if (mail) return new URL(mail.url).hash.slice(3);
    await sleep(500);
  }
  throw Error("no sign-in mail for " + email);
}

const A = new Person("Ana", `ana.market.${run}@example.com`);
const B = new Person("Beto", `beto.market.${run}@example.com`);
console.log("Colmena marketplace e2e against " + BASE + " (run " + run + ")");
await A.signIn(); await B.signIn();
const made = await A.req("/auth/workspaces", { method: "POST", body: { name: "Pruebas marketplace " + run } });
check("a company", made.status === 201, JSON.stringify(made.data));
const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: B.email, role: "member" } });
const acc = await B.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(inv.data.link).hash.slice(3) } });
check("Beto joins", acc.status === 200, JSON.stringify(acc.data));
await B.refresh();
const WS = (await A.req("/api/chat/bootstrap")).data.workspace.id;
const flag = await fetch(BASE + "/auth/dev/test/fake-model", { method: "POST", headers: { Authorization: "Bearer " + FAKE, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ workspace: WS, on: true }) });
check("the test flag on (Composio stays offline)", flag.status === 200);

const t0 = performance.now();
const cat = await B.req("/api/mcp/catalog");
const catMs = Math.round(performance.now() - t0);
const byId = Object.fromEntries((cat.data?.items || []).map((i) => [i.id, i]));
check("the catalogue answers (" + catMs + " ms)", cat.status === 200 && cat.data.items.length >= 30, cat.status);
check("Beto is a member there", cat.data?.person?.role === "member");
check("Google entries say «Disponible pronto» without Colmena's client", cat.data?.google === false && byId["google-analytics"]?.availability === "soon" && byId.bigquery?.availability === "soon");
check("Google Ads and Workspace MCP are blocked with a reason", !!byId["google-ads"]?.blocked && !!byId["google-calendar-mcp"]?.blocked);
check("unverifiable entries are not listed", !byId.vercel && !byId.figma && !byId.canva);
check("every entry says when it was verified and where", cat.data.items.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.verifiedAt) && i.sources.length));
const ga = await B.req("/api/mcp/connect", { method: "POST", body: { catalogId: "google-analytics" } });
check("connecting Google Analytics is refused for now", ga.status === 409 && /Disponible pronto/.test(ga.data?.error), JSON.stringify(ga.data));
const ms = await B.req("/api/mcp/connect", { method: "POST", body: { catalogId: "mail", mail: { email: "beto@outlook.com", password: "abcd efgh ijkl mnop" } } });
check("Outlook with a password: plain refusal (Microsoft needs OAuth)", ms.status === 400 && /OAuth/.test(ms.data?.error), JSON.stringify(ms.data));
const t1 = performance.now();
const bad = await B.req("/api/mcp/connect", { method: "POST", body: { catalogId: "mail", mail: { email: "beto@empresa.example", password: "abcd efgh ijkl mnop", imap: { host: "imap.colmena-no-existe.example", port: 993 }, smtp: { host: "smtp.colmena-no-existe.example", port: 465 } } } });
check("an unreachable mailbox: a plain error through the Worker's sockets (" + Math.round(performance.now() - t1) + " ms)", bad.status === 422 && /No se pudo conectar|no responde|servidor/.test(bad.data?.error || ""), JSON.stringify(bad.data));
const p25 = await B.req("/api/mcp/connect", { method: "POST", body: { catalogId: "mail", mail: { email: "beto@empresa.example", password: "abcd efgh ijkl mnop", imap: { host: "mail.empresa.example", port: 993 }, smtp: { host: "mail.empresa.example", port: 25 } } } });
check("port 25 refused with its reason", p25.status === 400 && /puerto 25/.test(p25.data?.error || ""), JSON.stringify(p25.data));
check("nothing kept after the failures", ((await B.req("/api/mcp/servers")).data?.servers || []).length === 0);
check("a member cannot connect an app for the whole company", (await B.req("/api/mcp/connect", { method: "POST", body: { catalogId: "notion", scope: "company" } })).status === 403);
check("a key that is not Composio's is refused", (await B.req("/api/mcp/composio", { method: "PUT", body: { key: "no-es-una-clave-valida" } })).status === 400);
const own = await B.req("/api/mcp/composio", { method: "PUT", body: { key: "ak_clave_de_prueba_" + run } });
check("Beto keeps his own Composio key", own.status === 200 && own.data?.mine === true, JSON.stringify(own.data));
check("Ana does not get it", (await A.req("/api/mcp/composio")).data?.mine === false);
check("Beto removes it", (await B.req("/api/mcp/composio", { method: "DELETE" })).data?.mine === false);
const page = await fetch(BASE + "/ajustes/apps?app=mail", { headers: { Cookie: [...B.cookies].map(([k, v]) => k + "=" + v).join("; ") } });
check("the marketplace page is served", page.status === 200);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
