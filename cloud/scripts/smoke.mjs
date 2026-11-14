// Smoke test of the cloud workspace (cloud/src/worker.js, docs/CLOUD.md), against a running
// `wrangler dev --local` (default http://127.0.0.1:8790) or another URL:
//   node scripts/smoke.mjs [--url http://127.0.0.1:8790] [--n 1000] [--fanout 50]
// The shared token comes from COLMENA_CLOUD_TOKEN or the CLOUD_TOKEN line of ../.local/cloud.env.
// Checks: auth, put/get/list, encryption, workspace isolation, two WebSocket clients seeing each
// other's writes; measures 1,000 sequential puts/gets, an in-object bench and a 50-client fan-out.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const N = Number(arg("n", 1000));
const FANOUT = Number(arg("fanout", 50));
function readToken() {
  if (process.env.COLMENA_CLOUD_TOKEN) return process.env.COLMENA_CLOUD_TOKEN;
  const file = path.join(here, "..", "..", ".local", "cloud.env");
  if (existsSync(file)) return /^CLOUD_TOKEN=(\S+)$/m.exec(readFileSync(file, "utf8"))?.[1];
  return null;
}
const TOKEN = readToken();
if (!TOKEN) throw Error("No token: set COLMENA_CLOUD_TOKEN or write CLOUD_TOKEN=… in .local/cloud.env.");

const workspace = "smoke-" + randomBytes(5).toString("hex");
const other = workspace + "-b";
const results = { base: BASE, workspace, checks: [], timings: {} };
const check = (name, ok, detail = "") => {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};
const call = async (method, route, body, { token = TOKEN, ws = workspace } = {}) => {
  const res = await fetch(`${BASE}/w/${ws}${route}`, {
    method,
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
const stats = (list) => {
  const s = [...list].sort((a, b) => a - b), at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, totalMs: +s.reduce((a, b) => a + b, 0).toFixed(1), meanMs: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p50Ms: +at(0.5).toFixed(2), p95Ms: +at(0.95).toFixed(2), maxMs: +s.at(-1).toFixed(2) };
};
const wsUrl = BASE.replace(/^http/, "ws") + `/w/${workspace}/ws`;
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, ["colmena.v1", "token." + TOKEN]);
    ws.inbox = [];
    ws.waiters = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      ws.inbox.push(msg);
      for (const w of [...ws.waiters]) if (w.test(msg)) { ws.waiters.splice(ws.waiters.indexOf(w), 1); w.resolve(msg); }
    });
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (e) => reject(Error("WebSocket error: " + (e.message || "connection failed"))), { once: true });
  });
}
const waitFor = (ws, test, ms = 10000) => {
  const seen = ws.inbox.find(test);
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve, reject) => {
    const w = { test, resolve };
    ws.waiters.push(w);
    setTimeout(() => reject(Error("timeout waiting for a message")), ms).unref();
  });
};
const isChange = (kind, id) => (m) => m.type === "change" && m.change?.kind === kind && m.change?.id === id;

// 1. Auth and basics.
check("health", (await fetch(BASE + "/health").then((r) => r.json())).ok === true);
check("no token is refused", (await call("GET", "/info", null, { token: null })).status === 401);
check("a wrong token is refused", (await call("GET", "/info", null, { token: "x".repeat(TOKEN.length) })).status === 401);
const info = await call("GET", "/info");
check("info", info.status === 200 && info.data.driver === "do", JSON.stringify(info.data));
check("the workspace is encrypted", info.data.encrypted === true);
check("seeded like a desktop store", (info.data.kinds?.bots || 0) >= 6, `bots=${info.data.kinds?.bots}`);
const put = await call("PUT", "/records/notes/n1", { text: "hola", at: new Date().toISOString() });
check("put", put.status === 200 && put.data.id === "n1");
const got = await call("GET", "/records/notes/n1");
check("get", got.status === 200 && got.data.text === "hola");
check("list", (await call("GET", "/records/notes")).data.length === 1);
check("missing → 404", (await call("GET", "/records/notes/none")).status === 404);
check("another workspace does not see it", (await call("GET", "/records/notes/n1", null, { ws: other })).status === 404);

// 2. Two WebSocket clients see each other's writes.
const a = await connect(), b = await connect();
a.send(JSON.stringify({ op: "put", kind: "notes", data: { id: "from-a", text: "A" }, req: 1 }));
const seenByB = await waitFor(b, isChange("notes", "from-a")).catch(() => null);
check("B sees A's write (over the socket)", seenByB?.change?.data?.text === "A");
await call("PUT", "/records/notes/from-b", { text: "B" });
const seenByA = await waitFor(a, isChange("notes", "from-b")).catch(() => null);
check("A sees B's write (over HTTP)", seenByA?.change?.data?.text === "B");
a.close();
b.close();

// 3. Latency: an empty round trip, N sequential puts and gets over HTTP, and N in the object.
const rtt = [];
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  await fetch(BASE + "/health");
  rtt.push(performance.now() - t);
}
results.timings.healthRtt = stats(rtt);
const puts = [], gets = [];
for (let i = 0; i < N; i++) {
  const t = performance.now();
  const r = await call("PUT", `/records/load/r${i}`, { i, text: "x".repeat(200) });
  puts.push(performance.now() - t);
  if (r.status !== 200) { check(`put #${i}`, false, JSON.stringify(r.data)); break; }
}
for (let i = 0; i < N; i++) {
  const t = performance.now();
  const r = await call("GET", `/records/load/r${i}`);
  gets.push(performance.now() - t);
  if (r.status !== 200 || r.data.i !== i) { check(`get #${i}`, false); break; }
}
results.timings.httpPut = stats(puts);
results.timings.httpGet = stats(gets);
check(`${N} sequential puts and gets`, puts.length === N && gets.length === N);
const t0 = performance.now();
const bench = await call("POST", `/bench?n=${N}`);
const benchMs = performance.now() - t0;
results.timings.inObject = { n: N, requestMs: +benchMs.toFixed(1), perOpUs: +(((benchMs - results.timings.healthRtt.p50Ms) / (2 * N)) * 1000).toFixed(1), reported: bench.data };
check(`in-object bench of ${N} puts + ${N} gets`, bench.status === 200 && bench.data.listed === N);

// 4. Fan-out: FANOUT clients, one write, time until every one of them has it.
const clients = await Promise.all(Array.from({ length: FANOUT }, connect));
const rounds = [];
for (let round = 0; round < 5; round++) {
  const id = "fan" + round;
  const waits = clients.map((c) => waitFor(c, isChange("fan", id)).then(() => performance.now()));
  const t = performance.now();
  await call("PUT", `/records/fan/${id}`, { round });
  const done = await Promise.all(waits);
  rounds.push({ allMs: Math.max(...done) - t, firstMs: Math.min(...done) - t });
}
for (const c of clients) c.close();
results.timings.fanout = { clients: FANOUT, rounds: rounds.map((r) => ({ allMs: +r.allMs.toFixed(1), firstMs: +r.firstMs.toFixed(1) })), allP50Ms: +stats(rounds.map((r) => r.allMs)).p50Ms.toFixed(1) };
check(`fan-out to ${FANOUT} clients`, rounds.length === 5);

console.log(JSON.stringify(results.timings, null, 2));
const failed = results.checks.filter((c) => !c.ok);
console.log(failed.length ? `${failed.length} check(s) failed` : `all ${results.checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
