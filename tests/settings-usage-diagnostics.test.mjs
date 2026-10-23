import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { cachePercent, usageOverview } from "../server/usage-routes.mjs";
import { _test, quickCheck, runDiagnostics, sizeText } from "../server/diagnostics.mjs";
import { SECTIONS, SETTINGS_INDEX, searchSettings } from "../src/components/v2/settings/sections.js";

async function tempStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-diag-"));
  return { dir, store: new Store(dir) };
}
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();

test("Uso: per bot, per chat and per day, with the cache share of what the model read", async () => {
  const { dir, store } = await tempStore();
  try {
    store.put("missions", { id: "m1", conversation: true, title: "Cierre de mes", botIds: ["vera"], status: "done" });
    store.put("missions", { id: "m2", conversation: false, room: "informe", botIds: ["nora", "vera"], status: "done" });
    store.put("missions", { id: "m3", conversation: true, title: "Secreto", incognito: true, botIds: ["nora"], status: "done" });
    const rows = [
      { missionId: "m1", botId: "vera", input: 10000, cached: 8000, output: 500, purpose: "step", at: day(0) },
      { missionId: "m1", botId: "vera", input: 6000, cached: 3000, output: 400, purpose: "side", at: day(1) },
      { missionId: "m2", botId: "nora", input: 4000, cached: 0, output: 300, purpose: "step", at: day(2) },
      { missionId: "m3", botId: "nora", input: 1000, cached: 500, output: 100, purpose: "step", at: day(2) },
      { missionId: "m2", botId: "nora", input: 99999, cached: 0, output: 1, purpose: "step", at: day(45) }, // outside 30 days
    ];
    rows.forEach((r, i) => store.put("usage", { id: "u" + i, tokens: r.input + r.output, reasoning: 0, month: r.at.slice(0, 7), model: "gpt-5.5", ...r }));
    const o = usageOverview(store, { days: 30 });
    assert.equal(o.total.calls, 4, "only the last 30 days");
    assert.equal(o.total.input, 21000);
    assert.equal(o.total.cached, 11500);
    assert.equal(o.total.cachePercent, Math.round((11500 / 21000) * 100));
    assert.deepEqual(o.bots.map((b) => b.botId), ["vera", "nora"], "biggest spender first");
    assert.equal(o.bots[0].cachePercent, Math.round((11000 / 16000) * 100));
    const chat = o.chats.find((c) => c.missionId === "m1");
    assert.equal(chat.title, "Cierre de mes");
    assert.equal(chat.kind, "chat");
    assert.equal(o.chats.find((c) => c.missionId === "m2").title, "#informe");
    assert.equal(o.chats.find((c) => c.missionId === "m3").title, "Chat de incógnito", "an incognito chat keeps its title to itself");
    assert.equal(o.perDay.length, 30);
    assert.equal(o.perDay.at(-1).tokens, 10500, "today is the last column");
    assert.deepEqual(o.purposes.map((p) => p.purpose).sort(), ["side", "step"]);
    assert.equal(cachePercent({ input: 0, cached: 0 }), null, "no input measured, no percentage");
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Uso: the plans carry each engine's limit and ChatGPT's windows", async () => {
  const { dir, store } = await tempStore();
  try {
    const provider = { engines: () => [{ id: "openai", label: "ChatGPT", connected: true, detail: "ana@x.es", limit: null, resting: false }, { id: "anthropic", label: "Claude", connected: true, limit: { kind: "usage", label: "límite de 5 horas", resetsAt: day(-0.1) }, resting: true }] };
    const windows = { primary: { usedPercent: 40, windowMinutes: 300, resetsAt: day(-0.05) }, secondary: null };
    const o = usageOverview(store, { provider, planLimits: windows });
    assert.equal(o.plans.openai.primary.usedPercent, 40);
    assert.equal(o.plans.engines.find((e) => e.id === "anthropic").limit.label, "límite de 5 horas");
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Diagnóstico: AI accounts say what fails and where to fix it", async () => {
  const none = await _test.aiChecks({ provider: { engines: () => [{ id: "openai", label: "ChatGPT", connected: false }], config: () => ({}) } });
  assert.equal(none[0].status, "fail");
  assert.match(none[0].text, /Ninguna cuenta de IA/);
  assert.equal(none.find((c) => c.id === "ai:openai").to, "/ajustes/inteligencia#chatgpt");
  const limited = await _test.aiChecks({ provider: { engines: () => [
    { id: "openai", label: "ChatGPT", connected: true, detail: "ana@x.es" },
    { id: "anthropic", label: "Claude", connected: true, method: "cli", limit: { label: "límite semanal", resetsAt: day(-1) } },
    { id: "opencode-go", label: "OpenCode Go", connected: true },
  ], kind: "chatgpt", session: { status: () => ({ canInfer: true }) }, config: () => ({ fallback: "none" }) }, probeClaude: async () => ({ status: "available" }) });
  assert.equal(limited.find((c) => c.id === "ai:openai").status, "ok");
  const claude = limited.find((c) => c.id === "ai:anthropic");
  assert.equal(claude.status, "warn");
  assert.match(claude.text, /límite semanal · se renueva/);
  assert.equal(limited.find((c) => c.id === "ai:fallback").status, "warn", "two AIs and no fallback: suggest one");
  const cli = await _test.aiChecks({ provider: { engines: () => [{ id: "anthropic", label: "Claude", connected: true, method: "cli" }], config: () => ({}) }, probeClaude: async () => ({ status: "missing" }) });
  assert.equal(cli[0].status, "fail");
  assert.equal(cli[0].command, "claude");
});

test("Diagnóstico: code engines, without running any of them", async () => {
  const absent = await _test.codeChecks({ directory: os.tmpdir(), find: { claude: () => null, codex: () => null, opencode: () => null } });
  assert.deepEqual(absent.map((c) => c.status), ["off", "off", "off"]);
  const old = await _test.codeChecks({ directory: os.tmpdir(), find: { claude: () => "claude.exe", codex: () => ["codex"], opencode: () => ["oc"] }, probe: { claudeVersion: async () => "2.0.1", claudeAuth: async () => ({ status: "available" }), codex: async () => ({ status: "missing" }) } });
  assert.equal(old[0].status, "warn");
  assert.equal(old[0].command, "claude update");
  assert.equal(old[1].command, "codex login");
  assert.equal(old[2].status, "ok");
});

test("Diagnóstico: the database is read on a separate read-only connection (quick_check, never VACUUM)", async () => {
  const { dir, store } = await tempStore();
  try {
    store.put("bots", { id: "x", name: "X" });
    const r = await quickCheck(path.join(dir, "colmena.sqlite"));
    assert.deepEqual(r.rows, ["ok"]);
    const data = await _test.dataChecks({ directory: dir, disk: async () => ({ bavail: 100, bsize: 1024 * 1024 }) });
    assert.equal(data.find((c) => c.id === "data:integrity").status, "ok");
    assert.equal(data.find((c) => c.id === "data:disk").status, "fail", "100 MB free is too little");
    const bad = await _test.dataChecks({ directory: dir, integrity: async () => ({ rows: ["*** in database main *** Page 7 is never used"] }), disk: async () => ({ bavail: 1e6, bsize: 1e6 }) });
    assert.equal(bad.find((c) => c.id === "data:integrity").status, "fail");
    assert.match(bad.find((c) => c.id === "data:integrity").fix, /copia/);
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Diagnóstico: stalls, apps and the whole run with a summary", async () => {
  const quiet = _test.serverChecks({ stalls: { state: { count: 0, worstMs: 0, last: null } }, version: "2.0.0" });
  assert.equal(quiet[0].status, "ok");
  const stuck = _test.serverChecks({ stalls: { state: { count: 3, worstMs: 4200, last: { at: new Date().toISOString(), ms: 4200 } } } });
  assert.equal(stuck[0].status, "warn");
  assert.match(stuck[0].text, /3 veces; el peor, 4,2 s/);
  const apps = await _test.appChecks({
    connections: { call: async (op) => (op === "status" ? { configured: true } : { items: [{ id: "a1", alias: "Gmail", status: "ACTIVE" }, { id: "a2", alias: "Slack", status: "EXPIRED" }] }) },
    mcp: { servers: () => [{ id: "jira", name: "Jira", status: "error", error: "Token caducado", toolCount: 0 }] },
  });
  assert.deepEqual(apps.map((c) => c.status), ["ok", "warn", "warn"]);
  assert.equal(apps[1].to, "/ajustes/conexiones");
  const { dir, store } = await tempStore();
  try {
    const r = await runDiagnostics({ store, runtime: null, connections: null, stalls: null, version: "2.0.0", deps: { find: { claude: () => null, codex: () => null, opencode: () => null }, disk: async () => ({ bavail: 1e6, bsize: 1e6 }) } });
    assert.ok(r.checks.length >= 6);
    assert.equal(r.summary.fail >= 1, true, "no provider layer is a failure");
    assert.equal(typeof r.ms, "number");
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(sizeText(1.5 * 1024 * 1024), "1,5 MB");
});

test("Ajustes: every setting has a unique address and the search finds it by its words", () => {
  const keys = SETTINGS_INDEX.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
  const anchors = SECTIONS.flatMap((s) => s.items.map((i) => i[0]));
  assert.equal(new Set(anchors).size, anchors.length, "an anchor is unique across sections");
  assert.equal(searchSettings("sonido")[0].href, "/ajustes/avisos#como-avisa");
  assert.equal(searchSettings("respaldo")[0].href, "/ajustes/inteligencia#respaldo");
  assert.equal(searchSettings("contrasena")[0].href, "/ajustes/privacidad#boveda", "accents do not matter");
  assert.equal(searchSettings("uso")[0].href, "/ajustes/uso", "the section wins over its settings");
  assert.equal(searchSettings("Qué usa cada bot")[0].href, "/ajustes/ia", "a setting with its own page links there");
  assert.deepEqual(searchSettings("zzzz"), []);
});
