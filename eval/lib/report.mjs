// What a run leaves: a summary for the console, eval/report/<date>.json (everything, to
// compare with the next run) and eval/report/<date>.md (to read). Reports are compared with
// the previous one of the same kind (a real run with a real run, a --dry with a --dry).
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pct = (n) => (Math.round(n * 1000) / 10).toLocaleString("es-ES") + " %";
const num = (n) => Number(n || 0).toLocaleString("es-ES");
const pad = (n) => String(n).padStart(2, "0");
/** «2026-11-12-1530»: the date, and the time so two runs of one day do not overwrite each other. */
export const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

/** The report of a run, as data. */
export function buildReport(results, { dry = false, model = null, judgeModel = null, engine = null, min = 0.9, startedAt = new Date(), filters = {} } = {}) {
  const areas = {};
  for (const r of results) {
    const a = (areas[r.area] ??= { cases: 0, passed: 0, rate: 0 });
    a.cases += 1;
    if (r.pass) a.passed += 1;
  }
  for (const a of Object.values(areas)) a.rate = a.cases ? a.passed / a.cases : 0;
  const passed = results.filter((r) => r.pass).length;
  const usage = results.reduce((sum, r) => ({ calls: sum.calls + r.usage.calls, input: sum.input + r.usage.input, output: sum.output + r.usage.output, total: sum.total + r.usage.total }), { calls: 0, input: 0, output: 0, total: 0 });
  return {
    version: 1, date: startedAt.toISOString(), mode: dry ? "dry" : "real", engine, model, judgeModel, min, filters,
    total: { cases: results.length, passed, rate: results.length ? passed / results.length : 0 },
    ok: results.length > 0 && passed / results.length >= min,
    areas, usage,
    cases: results.map((r) => ({
      id: r.id, area: r.area, title: r.title, why: r.why, tags: r.tags, file: r.file, pass: r.pass, passed: r.passed, runs: r.runs, required: r.required, usage: r.usage,
      firstFailure: r.firstFailure, judgeReason: r.judgeReason,
      runsDetail: r.results.map((x) => ({
        pass: x.pass, ms: x.ms, error: x.error, usage: x.usage, failures: x.failures, judge: x.judge,
        // The transcript of a failed run stays in the JSON: it is what one opens to see why.
        ...(x.pass ? {} : { transcript: String(x.transcript || "").slice(0, 40000), answer: x.observation?.answer || "", status: x.observation?.status || null, notes: x.observation?.notes || [] }),
      })),
    })),
  };
}

/** What changed since the previous report: cases that passed and now fail, the other way round, and new ones. */
export function compareReports(current, previous) {
  if (!previous) return null;
  const before = new Map((previous.cases || []).map((c) => [c.id, c]));
  const broke = [], fixed = [], fresh = [];
  for (const c of current.cases) {
    const old = before.get(c.id);
    if (!old) fresh.push(c.id);
    else if (old.pass && !c.pass) broke.push(c.id);
    else if (!old.pass && c.pass) fixed.push(c.id);
  }
  return { previous: previous.date, previousRate: previous.total?.rate ?? null, broke, fixed, fresh };
}

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
export function comparisonLines(cmp) {
  if (!cmp) return ["Sin informe anterior con el que comparar."];
  const lines = [];
  if (cmp.broke.length) lines.push(plural(cmp.broke.length, "caso que antes pasaba ahora falla", "casos que antes pasaban ahora fallan") + ": " + cmp.broke.join(", "));
  if (cmp.fixed.length) lines.push(plural(cmp.fixed.length, "caso que antes fallaba ahora pasa", "casos que antes fallaban ahora pasan") + ": " + cmp.fixed.join(", "));
  if (cmp.fresh.length) lines.push(plural(cmp.fresh.length, "caso nuevo", "casos nuevos") + ": " + cmp.fresh.join(", "));
  if (!lines.length) lines.push("Igual que el informe anterior (" + String(cmp.previous).slice(0, 16).replace("T", " ") + ").");
  return lines;
}

const why = (c) => c.firstFailure ? c.firstFailure.name + " — " + c.firstFailure.detail : c.judgeReason ? "juez — " + c.judgeReason : "";

/** The summary printed at the end. */
export function consoleSummary(report, cmp) {
  const lines = ["", "Evaluación de comportamiento" + (report.mode === "dry" ? " (--dry: modelo de guion, no dice nada del modelo real)" : " · " + (report.model || "") + (report.judgeModel && report.judgeModel !== report.model ? " · juez " + report.judgeModel : "")), ""];
  for (const [area, a] of Object.entries(report.areas)) lines.push("  " + area.padEnd(10) + String(a.passed).padStart(3) + " / " + String(a.cases).padEnd(3) + pct(a.rate).padStart(8));
  lines.push("  " + "total".padEnd(10) + String(report.total.passed).padStart(3) + " / " + String(report.total.cases).padEnd(3) + pct(report.total.rate).padStart(8) + "   (mínimo " + pct(report.min) + ")");
  const failed = report.cases.filter((c) => !c.pass);
  if (failed.length) {
    lines.push("", "Fallan:");
    for (const c of failed) {
      lines.push("  ✗ " + c.area + "/" + c.id + " (" + c.passed + " de " + c.runs + ", hacían falta " + c.required + ") — " + c.title);
      if (c.firstFailure) lines.push("      primera comprobación que falla: " + c.firstFailure.name + " — " + c.firstFailure.detail);
      if (c.judgeReason) lines.push("      juez: " + c.judgeReason);
    }
  }
  lines.push("", ...comparisonLines(cmp).map((l) => "  " + l));
  if (report.mode !== "dry") lines.push("", "  Gastado: " + num(report.usage.total) + " tokens en " + num(report.usage.calls) + " llamadas al modelo (" + num(report.usage.input) + " de entrada, " + num(report.usage.output) + " de salida).");
  lines.push("", report.ok ? "  Resultado: pasa." : "  Resultado: NO pasa (por debajo del mínimo).", "");
  return lines.join("\n");
}

/** The readable report. */
export function markdownReport(report, cmp) {
  const out = [];
  out.push("# Evaluación de comportamiento · " + report.date.slice(0, 16).replace("T", " "), "");
  out.push(report.mode === "dry" ? "Modo `--dry`: modelo de guion. Prueba el arnés, no el comportamiento del modelo real." : "Modelo: `" + report.model + "`" + (report.engine ? " (" + report.engine + ")" : "") + " · juez: `" + report.judgeModel + "`", "");
  out.push("**" + (report.ok ? "Pasa" : "No pasa") + "**: " + report.total.passed + " de " + report.total.cases + " casos (" + pct(report.total.rate) + "; mínimo " + pct(report.min) + ").", "");
  out.push("| Área | Pasan | Casos | % |", "| --- | ---: | ---: | ---: |");
  for (const [area, a] of Object.entries(report.areas)) out.push("| " + area + " | " + a.passed + " | " + a.cases + " | " + pct(a.rate) + " |");
  out.push("", "## Respecto al informe anterior", "", ...comparisonLines(cmp).map((l) => "- " + l), "");
  const failed = report.cases.filter((c) => !c.pass);
  if (failed.length) {
    out.push("## Fallan", "");
    for (const c of failed) {
      out.push("### " + c.area + "/" + c.id + " — " + c.title, "", "- Por qué importa: " + c.why, "- Pasó " + c.passed + " de " + c.runs + " (hacían falta " + c.required + ").");
      if (c.firstFailure) out.push("- Primera comprobación que falla: **" + c.firstFailure.name + "** — " + c.firstFailure.detail);
      if (c.judgeReason) out.push("- Juez: " + c.judgeReason);
      const bad = c.runsDetail.find((r) => !r.pass);
      if (bad?.answer) out.push("- Lo que respondió el bot: " + JSON.stringify(bad.answer.slice(0, 600)));
      out.push("");
    }
  }
  out.push("## Todos los casos", "", "| | Caso | Pasó | Tokens | Si falla, por qué |", "| --- | --- | ---: | ---: | --- |");
  for (const c of report.cases) out.push("| " + (c.pass ? "✓" : "✗") + " | " + c.area + "/" + c.id + " | " + c.passed + "/" + c.runs + " | " + num(c.usage.total) + " | " + (c.pass ? "" : why(c).replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 240)) + " |");
  out.push("", "Tokens: " + num(report.usage.total) + " en " + num(report.usage.calls) + " llamadas (" + num(report.usage.input) + " de entrada, " + num(report.usage.output) + " de salida).", "");
  return out.join("\n");
}

/** The latest report of the same mode in `dir` made before `before` (an ISO date), or null. */
export async function previousReport(dir, { mode, before = null } = {}) {
  let names = [];
  try { names = (await readdir(dir)).filter((n) => n.endsWith(".json")); } catch { return null; }
  let latest = null;
  for (const name of names) {
    try {
      const data = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (data?.mode !== mode || !Array.isArray(data.cases) || typeof data.date !== "string") continue;
      if (before && data.date >= before) continue;
      if (!latest || data.date > latest.date) latest = data;
    } catch {}
  }
  return latest;
}

/** Writes <stamp>[-dry].json and .md into `dir` (never over an earlier report); returns {json, md, comparison}. */
export async function writeReport(report, dir, { now = new Date() } = {}) {
  await mkdir(dir, { recursive: true });
  const taken = new Set(await readdir(dir));
  const first = stamp(now) + (report.mode === "dry" ? "-dry" : "");
  let base = first;
  for (let n = 2; taken.has(base + ".json"); n++) base = first + "-" + n;
  const comparison = compareReports(report, await previousReport(dir, { mode: report.mode, before: report.date }));
  const json = path.join(dir, base + ".json"), md = path.join(dir, base + ".md");
  await writeFile(json, JSON.stringify({ ...report, comparison }, null, 2) + "\n", "utf8");
  await writeFile(md, markdownReport(report, comparison), "utf8");
  return { json, md, comparison };
}
