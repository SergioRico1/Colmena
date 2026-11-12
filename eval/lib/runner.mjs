// Cases → runs → verdicts. A case runs `runs` times (a real model is not deterministic) and
// passes when enough of them do (2 of 3 by default). One run passes when every hard assertion
// holds and — only then, because it costs — every judge check passes.
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { estimateTokens } from "../../server/context.mjs";
import { runOnce } from "./harness.mjs";
import { runChecks, kindOf } from "./checks.mjs";
import { judge } from "../judge.mjs";
import { newMeter } from "./provider.mjs";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const CASES_DIR = path.join(ROOT, "eval", "cases");
export const AREAS = ["email", "redlines", "honesty", "router", "memory", "tools", "notes", "routines"];
export const DEFAULTS = Object.freeze({ runs: 3, pass: 2, min: 0.9 });

/** What is wrong with a case file, as a list of sentences (empty: it is fine). */
export function caseProblems(kase, { area = null, root = ROOT } = {}) {
  const problems = [];
  const need = (ok, text) => { if (!ok) problems.push(text); };
  need(typeof kase?.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kase.id), "id: letras minúsculas, números y guiones");
  need(AREAS.includes(kase?.area), "area: una de " + AREAS.join(", "));
  need(!area || kase?.area === area, "area: no coincide con su carpeta (" + area + ")");
  need(typeof kase?.title === "string" && kase.title.trim().length > 8, "title: una frase que diga qué se prueba");
  // «why» is one line and names the file of the rule it is grounded in.
  const cited = String(kase?.why || "").match(/\b(?:server|prompts|desktop)\/[\w./-]+\.(?:mjs|cjs|md)\b/g) || [];
  need(typeof kase?.why === "string" && kase.why.trim() && !kase.why.includes("\n"), "why: una línea");
  need(cited.length > 0, "why: cita el archivo de la regla (server/…)");
  for (const file of cited) need(existsSync(path.join(root, file)), "why: no existe " + file);
  need(Array.isArray(kase?.turns) && kase.turns.length > 0 && kase.turns.every((t) => t && (typeof t.say === "string" || t.fire || t.returnNote || t.resume)), "turns: al menos uno, cada uno con say, fire, returnNote o resume");
  need(Array.isArray(kase?.checks) && kase.checks.length > 0 && kase.checks.every((c) => c && kindOf(c)), "checks: al menos una comprobación conocida");
  need(Array.isArray(kase?.dry?.script), "dry.script: el guion del modo --dry");
  need(Array.isArray(kase?.tags), "tags: una lista (puede estar vacía)");
  need(kase?.runs === undefined || (Number.isInteger(kase.runs) && kase.runs >= 1 && kase.runs <= 10), "runs: entre 1 y 10");
  need(kase?.pass === undefined || (Number.isInteger(kase.pass) && kase.pass >= 1 && kase.pass <= (kase.runs ?? DEFAULTS.runs)), "pass: entre 1 y runs");
  if (kase?.checks?.some((c) => c.judge !== undefined)) need(kase.checks.filter((c) => c.judge !== undefined).every((c) => typeof c.judge?.rubric === "string" && c.judge.rubric.trim().length > 20), "judge.rubric: el criterio, en español");
  return problems;
}

/** Every case under eval/cases/<area>/ (*.json, or *.mjs with a default export), sorted. Throws on a broken file. */
export async function loadCases(dir = CASES_DIR) {
  const cases = [], seen = new Map();
  for (const area of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const name of (await readdir(path.join(dir, area))).sort()) {
      const file = path.join(dir, area, name);
      let kase = null;
      if (name.endsWith(".json")) kase = JSON.parse(await readFile(file, "utf8"));
      else if (name.endsWith(".mjs")) kase = (await import(pathToFileURL(file).href)).default;
      else continue;
      const where = "eval/cases/" + area + "/" + name;
      const problems = caseProblems(kase, { area });
      if (problems.length) throw Error("Caso no válido (" + where + "): " + problems.join("; ") + ".");
      if (seen.has(kase.id)) throw Error("Hay dos casos con el id «" + kase.id + "»: " + seen.get(kase.id) + " y " + where + ".");
      seen.set(kase.id, where);
      cases.push({ ...kase, file: where });
    }
  }
  return cases;
}

/** The cases a run asked for: by area, by id, the first n. */
export function selectCases(cases, { areas = [], ids = [], maxCases = 0 } = {}) {
  let out = cases;
  if (areas.length) out = out.filter((c) => areas.includes(c.area));
  if (ids.length) out = out.filter((c) => ids.includes(c.id));
  return maxCases > 0 ? out.slice(0, maxCases) : out;
}

/** How many times a case runs and how many must pass, given the command line. */
export function runPlan(kase, { runs = null, dry = false } = {}) {
  const own = kase.runs ?? DEFAULTS.runs, need = kase.pass ?? Math.min(DEFAULTS.pass, own);
  // The scripted model always does the same: once is enough.
  const total = runs ?? (dry ? 1 : own);
  return { runs: total, required: Math.max(1, Math.min(total, Math.ceil((need / own) * total))) };
}

const scriptedJudge = (kase) => async () => ({ text: JSON.stringify(kase.dry?.judge || { pass: true, score: 1, reason: "Veredicto del guion (--dry)." }), usage: { input_tokens: 0, output_tokens: 0 } });

/** One run of a case, judged: {pass, failures, checks, judge, error, usage, ms, observation, transcript}. */
export async function runAndJudge(kase, { makeProvider = null, model = "eval-dry", judgeModel = null, timeoutMs = null } = {}) {
  const started = Date.now();
  const judgeUsage = newMeter();
  let verdicts = [];
  const afterRun = async ({ observation, transcript, respond }) => {
    const hard = runChecks(observation, kase.checks);
    if (hard.some((c) => !c.ok)) return;
    for (const check of kase.checks.filter((c) => c.judge !== undefined)) {
      const verdict = await judge({ respond: makeProvider ? respond : scriptedJudge(kase), model: judgeModel || model, kase, rubric: check.judge.rubric, transcript });
      const used = verdict.usage || {};
      judgeUsage.calls += 1;
      judgeUsage.input += Number(used.input_tokens) || 0;
      judgeUsage.output += Number(used.output_tokens) || 0;
      judgeUsage.total += (Number(used.input_tokens) || 0) + (Number(used.output_tokens) || 0);
      verdicts.push({ name: check.name || "juez", rubric: check.judge.rubric, pass: verdict.pass, score: verdict.score, reason: verdict.reason, ...(verdict.invalid ? { invalid: true } : {}) });
    }
  };
  const { observation, transcript, error } = await runOnce(kase, { makeProvider, model, timeoutMs, afterRun });
  const checks = observation ? runChecks(observation, kase.checks) : [];
  if (error) verdicts = [];
  const failures = [
    ...(error ? [{ kind: "error", name: "ejecución", detail: error }] : []),
    ...checks.filter((c) => !c.ok).map((c) => ({ kind: "check", name: c.name, detail: c.detail })),
    ...verdicts.filter((v) => !v.pass).map((v) => ({ kind: "judge", name: v.name, detail: v.reason })),
  ];
  const usage = observation?.usage || newMeter();
  return {
    pass: !failures.length, failures, checks, judge: verdicts, error: error || null, ms: Date.now() - started,
    usage: { calls: usage.calls + judgeUsage.calls, input: usage.input + judgeUsage.input, output: usage.output + judgeUsage.output, total: usage.total + judgeUsage.total, judge: judgeUsage.total },
    observation, transcript,
  };
}

/** A case, all its runs: {id, area, title, why, tags, pass, passed, runs, required, results, usage, firstFailure, judgeReason}. */
export async function runCase(kase, options = {}) {
  const { runs, required } = runPlan(kase, options);
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(await runAndJudge(kase, options));
    options.onRun?.(kase, results.at(-1), i, runs);
    // Decided either way: the rest would only spend tokens.
    const passed = results.filter((r) => r.pass).length;
    if (!options.dry && (passed >= required || results.length - passed > runs - required)) break;
  }
  const passed = results.filter((r) => r.pass).length;
  const failed = results.find((r) => !r.pass);
  const usage = results.reduce((sum, r) => ({ calls: sum.calls + r.usage.calls, input: sum.input + r.usage.input, output: sum.output + r.usage.output, total: sum.total + r.usage.total }), newMeter());
  return {
    id: kase.id, area: kase.area, title: kase.title, why: kase.why, tags: kase.tags || [], file: kase.file || null,
    pass: passed >= required, passed, runs: results.length, planned: runs, required, usage,
    firstFailure: failed?.failures.find((f) => f.kind !== "judge") || null,
    judgeReason: failed?.failures.find((f) => f.kind === "judge")?.detail || null,
    results,
  };
}

/**
 * What a real run of these cases would roughly spend: each case is played once with its
 * script (free, offline) and what every round would have sent is measured; a real model takes
 * more rounds than a script and also writes, hence the margin. An order of magnitude, said as such.
 */
export async function estimate(cases, { runs = null } = {}) {
  let tokens = 0, calls = 0;
  for (const kase of cases) {
    const sizes = [];
    const { observation } = await runOnce(kase, { measure: (params) => sizes.push(estimateTokens(params.instructions) + estimateTokens(params.input) + estimateTokens(params.tools)) });
    const input = sizes.reduce((a, b) => a + b, 0) || 12000;
    const judges = kase.checks.filter((c) => c.judge !== undefined).length;
    const times = runPlan(kase, { runs }).runs;
    tokens += times * (Math.round(input * 1.6) + sizes.length * 700 + judges * 3500);
    calls += times * (Math.ceil((observation?.usage?.calls || sizes.length || 2) * 1.5) + judges);
  }
  return { tokens, calls, cases: cases.length };
}

/** Runs the cases one after another (one data folder at a time: Colmena's soul files hang from a process-wide folder). */
export async function runAll(cases, options = {}) {
  const out = [];
  for (const kase of cases) {
    options.onCaseStart?.(kase);
    const result = await runCase(kase, options);
    out.push(result);
    options.onCase?.(result);
  }
  return out;
}
