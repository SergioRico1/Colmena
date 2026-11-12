// Who thinks in an eval run.
//  - dry:  a scripted model that follows each case's `dry` script (no network, no account).
//  - real: Colmena's own provider layer (ProviderHub), authenticated ONLY from what the owner
//    passes explicitly: COLMENA_EVAL_* environment variables, or --data-dir pointing at a
//    Colmena data folder whose provider settings are read (never written). There is no
//    default: without one of them the run refuses and says what is needed.
import path from "node:path";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ProviderHub } from "../../server/provider.mjs";
import { ROUTER_INSTRUCTIONS } from "../../server/router.mjs";
import { tokensOf } from "../../server/usage.mjs";
import { chooseModel } from "../../server/models.mjs";
import { windowsVault } from "../../server/nexo/credential-vault.mjs";
import { EVAL_FAKE } from "./fakes.mjs";

const answer = (text) => ({ text, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 0, output_tokens: 0 } });
const DRY_MODELS = [{ slug: "eval-dry", label: "Guion (sin modelo)" }, { slug: "eval-dry-mini", label: "Guion mini", utility: true }];

/** Adds one model call to a meter ({calls, input, output, total}). */
function count(meter, usage) {
  if (!meter) return;
  const t = tokensOf(usage);
  meter.calls += 1;
  meter.input += t.input;
  meter.output += t.output;
  meter.total += t.total;
}
export const newMeter = () => ({ calls: 0, input: 0, output: 0, total: 0 });

/**
 * The scripted model. Each case run hands it its script (`play(script)`): a list of steps
 * consumed one per model round, in order —
 *   { "call": "gmail_reply_to_thread", "args": {...} }     one tool call
 *   { "calls": [{ "call": ..., "args": ... }, ...] }       several in one round
 *   { "say": "Enviado." }                                   the final text of a turn
 * with `"text"` next to a call for a progress line. The router's question is answered from
 * `route` ({ "para": "tomas" }), in order when it is a list. A script that runs out is an
 * error of the case (state.exhausted), never a silent pass.
 */
export class DryProvider {
  constructor() {
    this[EVAL_FAKE] = true;
    this.session = { models: DRY_MODELS };
    this.state = null;
    this.meter = null;
    this.offered = [];
    this.hook = null; // called before each round of a bot (the harness can stop it there)
    this.measure = null; // called with what each round would send (the cost estimate)
  }
  play({ script = [], route = null } = {}) {
    this.state = { script: [...script], routes: Array.isArray(route) ? [...route] : route ? [route] : [], exhausted: 0, used: 0, n: 0 };
    this.offered = [];
    return this.state;
  }
  async respond(params) {
    count(this.meter, null);
    if (params.instructions === ROUTER_INSTRUCTIONS) {
      const pick = this.state?.routes.length > 1 ? this.state.routes.shift() : this.state?.routes[0];
      return answer(JSON.stringify(pick || { para: "atlas", motivo: "Guion sin enrutador" }));
    }
    this.hook?.(params);
    this.measure?.(params);
    this.offered.push((params.tools || []).map((t) => t.name));
    const step = this.state?.script.shift();
    if (!step) {
      if (this.state) this.state.exhausted += 1;
      return answer("(El guion de la prueba no tiene más pasos.)");
    }
    this.state.used += 1;
    if (typeof step.say === "string") return answer(step.say);
    // «{{draft:0}}» in an argument is the id of the first Gmail draft there is by then (ids are made at run time).
    const args = (c) => { const text = JSON.stringify(c.args || {}); return this.resolve ? this.resolve(text) : text; };
    const calls = (step.calls || [step]).map((c) => ({ type: "function_call", name: c.call, arguments: args(c), call_id: "dry-" + ++this.state.n }));
    return { text: step.text || "", output: calls, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

// ------------------------------------------------------------------ the real provider layer
const ENV = {
  anthropicKey: "COLMENA_EVAL_ANTHROPIC_KEY",
  anthropicToken: "COLMENA_EVAL_ANTHROPIC_TOKEN",
  claudeCli: "COLMENA_EVAL_CLAUDE_CLI",
  openaiKey: "COLMENA_EVAL_OPENAI_KEY",
  opencodeKey: "COLMENA_EVAL_OPENCODE_KEY",
  localUrl: "COLMENA_EVAL_LOCAL_URL",
  localModel: "COLMENA_EVAL_LOCAL_MODEL",
};

export const AUTH_HELP = [
  "La evaluación real necesita saber con qué cuenta de IA piensa. No usa nunca tus datos de Colmena por defecto. Elige una:",
  "  · " + ENV.claudeCli + "=1            Claude Code de este ordenador (su propio inicio de sesión; gasta tu plan de Claude)",
  "  · " + ENV.anthropicKey + "=sk-ant-…   clave de API de Anthropic",
  "  · " + ENV.anthropicToken + "=…        token de suscripción de Claude (claude setup-token)",
  "  · " + ENV.openaiKey + "=sk-…         clave de API de OpenAI (añade --model, p. ej. --model gpt-5.2)",
  "  · " + ENV.opencodeKey + "=…          clave de OpenCode Go",
  "  · " + ENV.localUrl + "=http://127.0.0.1:11434/v1 y " + ENV.localModel + "=…   un modelo local",
  "  · --data-dir <carpeta>               lee (sin escribir) la configuración de IA de esa carpeta de datos de Colmena:",
  "                                       claves de API, token de Claude o Claude Code. La sesión de ChatGPT no se usa desde ahí",
  "                                       (renovarla cambiaría tus datos reales): para ChatGPT usa una clave de API.",
  "Para probar el arnés sin ninguna cuenta: npm run eval -- --dry",
].join("\n");

const hint = (secret) => String(secret).slice(-4);

/** Provider settings and secrets from COLMENA_EVAL_* (and nothing else). The variables are removed from the environment once read. */
export function authFromEnv(env = process.env) {
  const take = (name) => { const v = String(env[name] || "").trim(); delete env[name]; return v; };
  const secrets = {}, config = {};
  const anthropicKey = take(ENV.anthropicKey), anthropicToken = take(ENV.anthropicToken), cli = take(ENV.claudeCli);
  const openaiKey = take(ENV.openaiKey), opencodeKey = take(ENV.opencodeKey), localUrl = take(ENV.localUrl), localModel = take(ENV.localModel);
  if (anthropicKey) { secrets["anthropic-apikey"] = { key: anthropicKey }; config.anthropic = { method: "api_key", hint: hint(anthropicKey) }; }
  else if (anthropicToken) { secrets["anthropic-token"] = { token: anthropicToken }; config.anthropic = { method: "token", hint: hint(anthropicToken) }; }
  else if (/^(1|true|si|sí|yes)$/i.test(cli)) config.anthropic = { method: "cli" };
  if (openaiKey) { secrets["openai-apikey"] = { key: openaiKey }; config.apikey = { hint: hint(openaiKey) }; config.kind = "apikey"; }
  if (opencodeKey) { secrets["opencode-apikey"] = { key: opencodeKey }; config.opencode = { hint: hint(opencodeKey) }; }
  if (localUrl && localModel) { config.local = { baseUrl: localUrl, model: localModel }; config.kind ??= "local"; }
  if (!config.anthropic && !config.kind && !config.opencode) return null;
  return { config, vault: memoryVault(secrets), from: "variables de entorno COLMENA_EVAL_*" };
}

/** A vault that only knows what it was given, and refuses to be written. */
function memoryVault(secrets) {
  return {
    [EVAL_FAKE]: true,
    load: async (binding) => secrets[binding.profile] || null,
    save: async () => { throw Error("La evaluación no guarda credenciales."); },
    remove: async () => {},
  };
}

/**
 * Provider settings of a Colmena data folder the owner pointed at, read only: the
 * `providers/main` record (through a read-only SQLite handle) and, for the secrets, that
 * folder's vault with every write refused. The ChatGPT session is never used from here.
 */
export function authFromDataDir(dataDir) {
  const directory = path.resolve(String(dataDir || ""));
  const file = path.join(directory, "colmena.sqlite");
  if (!existsSync(file)) throw Error("--data-dir: no hay ninguna base de datos de Colmena en " + directory + ".");
  let record = null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const marked = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='colmena_meta'").get() && db.prepare("SELECT value FROM colmena_meta WHERE key='encryption'").get()?.value;
    if (marked) throw Error("--data-dir: esa base de datos está cifrada y la evaluación no abre su clave. Pasa la cuenta de IA con las variables COLMENA_EVAL_*.");
    const row = db.prepare("SELECT data FROM records WHERE kind='providers' AND id='main'").get();
    record = row ? JSON.parse(row.data) : null;
  } finally { db.close(); }
  if (!record) throw Error("--data-dir: esa carpeta no tiene ninguna cuenta de IA configurada.");
  const config = {};
  if (["api_key", "token", "cli"].includes(record.anthropic?.method)) config.anthropic = { method: record.anthropic.method, hint: record.anthropic.hint || "" };
  if (record.apikey) { config.apikey = { hint: record.apikey.hint || "" }; config.kind = "apikey"; }
  if (record.opencode?.hint) config.opencode = { hint: record.opencode.hint };
  if (record.local?.baseUrl && record.local?.model) { config.local = { baseUrl: record.local.baseUrl, model: record.local.model }; if (record.kind === "local" || !config.kind) config.kind = "local"; }
  if (record.primary) config.primary = record.primary;
  if (record.pins) config.pins = record.pins;
  if (!config.anthropic && !config.kind && !config.opencode)
    throw Error("--data-dir: esa carpeta solo tiene la sesión de ChatGPT, que la evaluación no usa (renovarla cambiaría tus datos). Usa una clave de API con COLMENA_EVAL_OPENAI_KEY, o Claude.");
  const real = windowsVault(path.join(directory, "provider"));
  const vault = real ? { load: (binding) => real.load(binding), save: async () => { throw Error("La evaluación no guarda credenciales."); }, remove: async () => {} } : null;
  return { config, vault, from: "la carpeta de datos " + directory + " (solo lectura)" };
}

/** Host names the model provider needs, for the network allowlist. */
export function providerHosts(config) {
  const hosts = new Set();
  if (config.anthropic && config.anthropic.method !== "cli") hosts.add("api.anthropic.com");
  if (config.apikey) hosts.add("api.openai.com");
  if (config.opencode) hosts.add("opencode.ai");
  if (config.local?.baseUrl) try { hosts.add(new URL(config.local.baseUrl).hostname.toLowerCase()); } catch {}
  return [...hosts];
}

/**
 * The provider a real run uses: Colmena's ProviderHub on the eval's own (temporary) store,
 * with the owner's settings and secrets, no ChatGPT session and the guarded fetch. Returned
 * behind a thin proxy that counts tokens, forces `--model` on the bots' own calls (side jobs
 * keep their cheap model), and switches the provider's hosted web search off — the web of a
 * case is its canned pages.
 */
export function realProvider({ store, auth, fetchImpl, model = null }) {
  store.put("providers", { id: "main", kind: null, apikey: null, local: null, ...auth.config, updatedAt: new Date().toISOString() });
  const hub = new ProviderHub({ session: null, store, vault: auth.vault, fetchImpl });
  const state = { meter: null, offered: [], hook: null };
  const respond = async (params) => {
    const forced = model && !params.side ? model : params.model;
    if (!params.side) {
      state.hook?.(params);
      state.offered.push((params.tools || []).map((t) => t.name));
    }
    const result = await hub.respond({ ...params, model: forced, webSearch: false });
    count(state.meter, result?.usage);
    return result;
  };
  const provider = new Proxy(hub, {
    get(target, prop) {
      if (prop === "respond") return respond;
      if (prop === "nativeSearchAvailable") return () => false;
      if (typeof prop === "string" && prop in state) return state[prop];
      if (prop === "hub") return target;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if (typeof prop === "string" && prop in state) { state[prop] = value; return true; }
      return Reflect.set(target, prop, value, target);
    },
  });
  return provider;
}

/** The model the bots think with in a real run, and the one that judges. */
export function pickModels(provider, { model = null, judgeModel = null } = {}) {
  const hub = provider.hub;
  const engine = hub.primary;
  if (!engine) throw Error("La cuenta de IA indicada no está completa: no hay ningún motor conectado.");
  const list = hub.modelsFor(engine);
  const local = engine === "openai" && hub.kind === "local" ? hub.config().local?.model : null;
  const main = model || local || chooseModel({ modelFamily: "sol" }, list, list[0]?.slug || "").slug;
  if (!main) throw Error("Indica el modelo con --model (con una clave de API de OpenAI no hay lista de modelos, p. ej. --model gpt-5.2).");
  const judge = judgeModel || (list.length ? chooseModel({ modelFamily: "astra" }, list, main).slug : main) || main;
  return { engine, model: main, judgeModel: judge, forced: !!model };
}
