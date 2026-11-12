// `npm run eval -- [--area x] [--case id] [--model slug] [--runs n] [--judge-model slug]
//                  [--max-cases n] [--min 0.9] [--yes] [--data-dir carpeta] [--dry] [--list]`
// Behaviour evals of the engine: a real model decides, every outward effect is a fake, a
// report says what passed. Run by hand before a release — never by `npm test`, `npm run
// verify` or CI (it refuses to start when CI is set). See eval/README.md.
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { AREAS, DEFAULTS, ROOT, estimate, loadCases, runAll, selectCases } from "./lib/runner.mjs";
import { buildReport, consoleSummary, writeReport } from "./lib/report.mjs";
import { AUTH_HELP, authFromDataDir, authFromEnv, pickModels, providerHosts, realProvider } from "./lib/provider.mjs";
import { guardNetwork } from "./lib/fakes.mjs";
import { realDataDir } from "./lib/harness.mjs";
import { Store } from "../server/store.mjs";

export const REPORT_DIR = path.join(ROOT, "eval", "report");
const USAGE = "Uso: npm run eval -- [--area " + AREAS.join("|") + "] [--case id] [--model slug] [--runs n] [--judge-model slug] [--max-cases n] [--min 0.9] [--yes] [--data-dir carpeta] [--dry] [--list]";

/** CI is set (and not switched off): the evals never run there. */
export const inCI = (env = process.env) => !!env.CI && !/^(0|false|no)$/i.test(String(env.CI));

export function parseArgs(argv) {
  const out = { areas: [], ids: [], model: null, judgeModel: null, runs: null, maxCases: 0, min: DEFAULTS.min, dry: false, yes: false, list: false, dataDir: null, reportDir: REPORT_DIR, help: false };
  const list = (v) => String(v).split(",").map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw Error("Falta el valor de " + arg + ".\n" + USAGE); return v; };
    if (arg === "--dry") out.dry = true;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg === "--list") out.list = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--area") out.areas.push(...list(value()));
    else if (arg === "--case") out.ids.push(...list(value()));
    else if (arg === "--model") out.model = value();
    else if (arg === "--judge-model") out.judgeModel = value();
    else if (arg === "--data-dir") out.dataDir = value();
    else if (arg === "--report-dir") out.reportDir = path.resolve(value());
    else if (arg === "--runs") out.runs = Number(value());
    else if (arg === "--max-cases") out.maxCases = Number(value());
    else if (arg === "--min") out.min = Number(value());
    else throw Error("Opción desconocida: " + arg + ".\n" + USAGE);
  }
  if (out.runs !== null && !(Number.isInteger(out.runs) && out.runs >= 1 && out.runs <= 10)) throw Error("--runs: un número entre 1 y 10.");
  if (!(Number.isInteger(out.maxCases) && out.maxCases >= 0)) throw Error("--max-cases: un número entero.");
  if (!(out.min >= 0 && out.min <= 1)) throw Error("--min: entre 0 y 1 (p. ej. 0.9).");
  const unknown = out.areas.filter((a) => !AREAS.includes(a));
  if (unknown.length) throw Error("Área desconocida: " + unknown.join(", ") + ". Áreas: " + AREAS.join(", ") + ".");
  return out;
}

const num = (n) => Number(n || 0).toLocaleString("es-ES");

/**
 * The whole run. `io` is where it writes and asks (tests pass their own). Returns the exit
 * code: 0 it passes, 1 it is below the minimum, 2 it did not run (CI, bad arguments, no
 * account, the person said no).
 */
export async function main(argv = process.argv.slice(2), { env = process.env, out = (line) => console.log(line), ask = null, casesDir = undefined } = {}) {
  if (inCI(env)) {
    out("Las evaluaciones de comportamiento no se ejecutan en CI (la variable CI está puesta). Se lanzan a mano antes de una versión: npm run eval");
    return 2;
  }
  let options;
  try { options = parseArgs(argv); } catch (error) { out(error.message); return 2; }
  if (options.help) { out(USAGE); return 0; }
  let cases;
  try { cases = selectCases(await loadCases(casesDir), options); } catch (error) { out(error.message); return 2; }
  if (options.list) {
    for (const c of cases) out(c.area + "/" + c.id + " — " + c.title);
    out(cases.length + " casos.");
    return 0;
  }
  if (!cases.length) { out("Ningún caso encaja con esos filtros."); return 2; }

  // Whatever happens, the network guard of a real run comes off when it ends.
  const real = { network: null };
  try {
    return await execute(cases, options, { env, out, ask }, real);
  } finally { real.network?.restore(); }
}

/** Who thinks in a real run ({makeProvider, models}), after saying what it will cost and asking; null when it does not go ahead. */
async function prepareReal(cases, options, { env, out, ask }, real) {
  // Only what the owner passed. Nothing is read from the real data folder unless it was named.
  let auth = null;
  try { auth = options.dataDir ? authFromDataDir(options.dataDir) : authFromEnv(env); } catch (error) { out(error.message); return null; }
  if (!auth) { out(AUTH_HELP); return null; }
  if (options.dataDir && path.resolve(options.dataDir).toLowerCase() === realDataDir(env).toLowerCase())
    out("Aviso: --data-dir apunta a tu carpeta de datos real. Solo se lee de ella la cuenta de IA; la evaluación trabaja en carpetas temporales.");
  // From here on this process only reaches the model provider.
  const network = (real.network = guardNetwork({ allow: providerHosts(auth.config), loopback: !!auth.config.local }));
  const makeProvider = (store) => realProvider({ store, auth, fetchImpl: network.fetch, model: options.model });
  let models;
  try {
    // The models are picked on a throwaway store, exactly as a case would see them.
    const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-eval-models-"));
    const store = new Store(dir);
    try { models = pickModels(makeProvider(store), options); } finally { store.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  } catch (error) { out(error.message); return null; }
  out("Cuenta de IA: " + auth.from + ". Motor: " + models.engine + " · modelo: " + models.model + " · juez: " + models.judgeModel + ".");
  out("Red: solo se permite " + (providerHosts(auth.config).join(", ") || "el Claude Code de este ordenador") + ". Apps, web, archivos y avisos son dobles de prueba: no se envía nada real.");
  const rough = await estimate(cases, options);
  out("Va a ejecutar " + cases.length + " casos (" + num(rough.calls) + " llamadas al modelo, unos " + num(rough.tokens) + " tokens: estimación gruesa). Gasta uso de tu plan o de tu clave.");
  if (!options.yes) {
    const question = "¿Seguir? (s/N) ";
    let answer = "";
    if (ask) answer = await ask(question);
    else if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { answer = await rl.question(question); } finally { rl.close(); }
    } else { out("Sin terminal para preguntar: añade --yes para confirmar el gasto."); return null; }
    if (!/^(s|si|sí|y|yes)$/i.test(String(answer).trim())) { out("Cancelado: no se ha gastado nada."); return null; }
  }
  return { makeProvider, models };
}

async function execute(cases, options, io, real) {
  const { out } = io;
  let makeProvider = null, models = { model: "eval-dry", judgeModel: "eval-dry", engine: null };
  if (!options.dry) {
    const ready = await prepareReal(cases, options, io, real);
    if (!ready) return 2;
    ({ makeProvider, models } = ready);
  }
  const startedAt = new Date();
  // Colmena logs each injection it spots; the cases plant them on purpose.
  const warn = console.warn;
  console.warn = (...args) => { if (!String(args[0]).startsWith("[security]")) warn(...args); };
  let results;
  try {
    results = await runAll(cases, {
      makeProvider, model: models.model, judgeModel: models.judgeModel, runs: options.runs, dry: options.dry,
      onCase: (r) => out((r.pass ? "  ✓ " : "  ✗ ") + r.area + "/" + r.id + "  " + r.passed + "/" + r.runs + (options.dry ? "" : "  " + num(r.usage.total) + " tokens")),
    });
  } finally { console.warn = warn; }
  const report = buildReport(results, { dry: options.dry, model: models.model, judgeModel: models.judgeModel, engine: models.engine, min: options.min, startedAt, filters: { areas: options.areas, ids: options.ids, maxCases: options.maxCases, runs: options.runs } });
  const written = await writeReport(report, options.reportDir, { now: startedAt });
  out(consoleSummary(report, written.comparison));
  out("Informe: " + written.md);
  const blocked = real.network?.blocked || [];
  if (blocked.length) out("Aviso: se bloquearon " + blocked.length + " conexiones de red que no iban al proveedor del modelo (" + [...new Set(blocked.map((x) => x.host))].join(", ") + ").");
  return report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((code) => process.exit(code), (error) => { console.error(error?.stack || error); process.exit(2); });
}
