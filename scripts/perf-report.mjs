// `node scripts/perf-report.mjs [days] [db]`: how fast Colmena answers, read-only.
// Per model call (usage records): duration, time to first word, transport and cache; per
// step: total time, rounds and the share spent in tools. Compares the last `days` (default
// 1) with everything before, so a change can be judged on real use.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const days = Number(process.argv[2] || 1);
const file = process.argv[3] || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Colmena", "colmena.sqlite");
const db = new DatabaseSync(file, { readOnly: true });
const rows = (kind) => db.prepare("SELECT data FROM records WHERE kind = ?").all(kind).map((r) => JSON.parse(r.data));
const cut = Date.now() - days * 864e5;
const q = (list, p) => {
  const a = list.filter((x) => typeof x === "number").sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null;
};
const fmt = (v, unit = "ms") => (v == null ? "—" : unit === "s" ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms");

function calls(list, title) {
  const steps = list.filter((u) => (u.purpose || (u.stepId ? "step" : "side")) === "step" && u.ms);
  const cached = steps.reduce((n, u) => n + (u.cached || 0), 0), input = steps.reduce((n, u) => n + (u.input || 0), 0);
  const continued = steps.filter((u) => u.transport === "ws-continued").length;
  console.log(`\n${title}: ${steps.length} llamadas de bots`);
  console.log(`  duración       p50 ${fmt(q(steps.map((u) => u.ms), 0.5))} · p90 ${fmt(q(steps.map((u) => u.ms), 0.9))}`);
  console.log(`  primera palabra p50 ${fmt(q(steps.map((u) => u.firstTokenMs), 0.5))} · p90 ${fmt(q(steps.map((u) => u.firstTokenMs), 0.9))}`);
  console.log(`  contexto medio ${steps.length ? Math.round(input / steps.length) : 0} tokens · caché ${input ? Math.round((cached / input) * 100) : 0} % · continúa el WebSocket ${steps.length ? Math.round((continued / steps.length) * 100) : 0} %`);
  const by = {};
  for (const u of steps) (by[(u.model || "?") + " · " + (u.effort || "sin razonar")] ??= []).push(u.ms);
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${k.padEnd(28)} ${String(v.length).padStart(4)} · p50 ${fmt(q(v, 0.5))} · p90 ${fmt(q(v, 0.9))}`);
}
function stepsReport(list, title) {
  const done = list.filter((s) => s.startedAt && s.completedAt);
  const total = (s) => Date.parse(s.completedAt) - Date.parse(s.startedAt);
  const tools = (s) => (s.activity || []).reduce((n, a) => n + (a.startedAt && a.endedAt && a.tool !== "ask_user" ? Date.parse(a.endedAt) - Date.parse(a.startedAt) : 0), 0);
  console.log(`\n${title}: ${done.length} pasos`);
  const by = {};
  for (const s of done) (by[s.kind || "?"] ??= []).push(s);
  for (const [k, v] of Object.entries(by)) {
    const t = v.reduce((n, s) => n + total(s), 0), tt = v.reduce((n, s) => n + tools(s), 0);
    console.log(`  ${k.padEnd(10)} ${String(v.length).padStart(3)} · p50 ${fmt(q(v.map(total), 0.5), "s")} · p90 ${fmt(q(v.map(total), 0.9), "s")} · rondas ${(v.reduce((n, s) => n + (s.rounds || 0), 0) / v.length).toFixed(1)} · herramientas ${t ? Math.round((tt / t) * 100) : 0} %`);
  }
}

const usage = rows("usage"), steps = rows("steps");
const recent = (x) => Date.parse(x.at || x.completedAt || x.startedAt || 0) >= cut;
calls(usage.filter((u) => !recent(u)), "ANTES");
calls(usage.filter(recent), `ÚLTIMOS ${days} DÍA(S)`);
stepsReport(steps.filter((s) => !recent(s)), "ANTES");
stepsReport(steps.filter(recent), `ÚLTIMOS ${days} DÍA(S)`);
