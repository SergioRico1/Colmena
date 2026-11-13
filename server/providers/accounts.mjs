// AI accounts connected with one API key over OpenAI-compatible Chat Completions: Gemini,
// OpenRouter, DeepSeek, Kimi and «Servidor propio» (any OpenAI-compatible server the person
// runs or trusts). One descriptor per provider says where it lives, where the key comes from
// and how a pasted key is checked; one CompletionsProvider (completions.mjs) speaks for all.
//
// Keys live in the DPAPI vault (one profile per provider, like Claude and OpenCode Go); SQLite
// (`providers/main.accounts[engine]`) keeps the last four characters, the address of a
// «Servidor propio» and the model chosen for OpenRouter or the server. Each adapter only ever
// loads its own key and only calls its own base URL.
import { CompletionsProvider, chatError } from "./completions.mjs";
import { cleanSecret } from "./secret-input.mjs";
import { validateBaseUrl } from "./endpoint.mjs";
import {
  CATALOG, DEEPSEEK_API, ENGINE_LABEL, GEMINI_API, KEY_ENGINES, MOONSHOT_API, OPENROUTER_API, OPENROUTER_AUTO, setDynamicModels,
} from "./catalog.mjs";

/** OpenRouter asks apps to name themselves (openrouter.ai/docs: HTTP-Referer, X-OpenRouter-Title). */
export const OPENROUTER_HEADERS = Object.freeze({ "HTTP-Referer": "https://github.com/SergioRico1/Colmena", "X-OpenRouter-Title": "Colmena", "X-Title": "Colmena" });

export const COMPATIBLE = Object.freeze({
  gemini: { base: GEMINI_API, keyUrl: "https://aistudio.google.com/apikey", keySite: "aistudio.google.com", placeholder: "AIza…", checkModel: "gemini-3.5-flash-lite", checkParams: { reasoning_effort: "minimal" } },
  openrouter: { base: OPENROUTER_API, keyUrl: "https://openrouter.ai/settings/keys", keySite: "openrouter.ai", placeholder: "sk-or-v1-…", checkModel: OPENROUTER_AUTO, headers: OPENROUTER_HEADERS, dynamic: true },
  deepseek: { base: DEEPSEEK_API, keyUrl: "https://platform.deepseek.com/api_keys", keySite: "platform.deepseek.com", placeholder: "sk-…", checkModel: "deepseek-flash", checkParams: { thinking: { type: "disabled" } } },
  moonshot: { base: MOONSHOT_API, keyUrl: "https://platform.kimi.ai/console/api-keys", keySite: "platform.kimi.ai", placeholder: "sk-…", checkModel: "kimi-k3.1-pro-highspeed", checkParams: { reasoning_effort: "low" }, maxField: "max_completion_tokens" },
  custom: { base: null, placeholder: "Opcional", keyOptional: true, dynamic: true },
});

const binding = (engine) => ({ profile: engine + "-apikey", hostId: "colmena-provider-v1", clientId: engine + "-apikey", subject: "apikey" });
const names = (engine) => {
  const name = ENGINE_LABEL[engine];
  return {
    name,
    limit: `Has llegado al límite de uso de ${name}.`,
    auth: engine === "custom" ? "Tu servidor no acepta la clave guardada. Revísala en Ajustes › Cuentas de IA." : `${name} no acepta la clave guardada. Revísala en Ajustes › Cuentas de IA.`,
    credit: engine === "custom" ? "Tu servidor dice que no queda saldo en esa cuenta." : `Tu cuenta de ${name} no tiene saldo. Recárgala en ${COMPATIBLE[engine].keySite} y vuelve a intentarlo.`,
  };
};

/**
 * {key} or {error}: the pasted key without invisible characters or edge spaces, with the
 * provider's own shape checked (a Gemini key pasted into DeepSeek is said plainly).
 */
export function checkKey(engine, raw) {
  const key = cleanSecret(raw);
  const name = ENGINE_LABEL[engine];
  if (!key) return COMPATIBLE[engine]?.keyOptional ? { key: "" } : { error: `Pega tu clave de ${name}.` };
  if (/\s/.test(key)) return { error: "La clave tiene un espacio o un salto de línea en medio. Cópiala de nuevo, en una sola línea." };
  if (/[^\x21-\x7e]/.test(key)) return { error: "La clave tiene un carácter que no es válido. Cópiala de nuevo desde la web." };
  if (key.length < (engine === "custom" ? 1 : 16)) return { error: `La clave es demasiado corta (${key.length} caracteres). Cópiala entera.` };
  if (key.length > 500) return { error: "La clave es demasiado larga. Copia solo la clave." };
  if (engine === "gemini" && /^sk-/.test(key)) return { error: "Esa clave no es de Google: las de Gemini empiezan por «AIza». Créala en aistudio.google.com." };
  if (engine === "openrouter" && !/^sk-or-/.test(key)) return { error: "Las claves de OpenRouter empiezan por «sk-or-». Créala en openrouter.ai." };
  if ((engine === "deepseek" || engine === "moonshot") && /^(AIza|sk-or-|sk-ant-)/.test(key)) return { error: `Esa clave es de otro proveedor. Crea una de ${name} en ${COMPATIBLE[engine].keySite}.` };
  return { key };
}

/** Does this model probably look at images? For servers that do not say (Ollama, vLLM, LM Studio). */
export const looksVisual = (id) => /(vision|[-_.]vl\b|[-_]vl[-_:]|llava|pixtral|gemma-?3|gemma-?4|minicpm-v|qwen[\d.]*-?vl|qwen3\.5|internvl|moondream|bakllava|-omni|glm-4\.\dv)/i.test(String(id || ""));

const perMillion = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1e6 * 1000) / 1000 : null);

/** OpenRouter's /models entry → the shape the catalogue keeps (only models that call tools). */
export function openrouterModel(m) {
  if (!m || typeof m.id !== "string") return null;
  const modalities = Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities : [];
  const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
  return {
    id: m.id, label: String(m.name || m.id).slice(0, 120), vision: modalities.includes("image"), pdf: modalities.includes("file"),
    context: Number(m.context_length) || null, maxTokens: Number(m.top_provider?.max_completion_tokens) || null,
    reasoning: params.includes("reasoning") || params.includes("include_reasoning"), tools: params.includes("tools"),
    cost: [perMillion(m.pricing?.prompt), perMillion(m.pricing?.completion)],
  };
}

const AUTO_ENTRY = { id: OPENROUTER_AUTO, label: "Automático", vision: true, pdf: true, reasoning: true, tools: true, context: 2_000_000, cost: null };

export class ApiAccounts {
  constructor(hub) {
    this.hub = hub;
    this.secrets = new Map();
    this.adapters = new Map();
    this.lists = new Map(); // engine → {at, list} (remote /models, 10 minutes)
    for (const engine of ["openrouter", "custom"]) this.syncModels(engine);
  }
  get fetch() { return this.hub.fetch; }
  account(engine) { return this.hub.config().accounts?.[engine] || null; }
  connected(engine) {
    const a = this.account(engine);
    if (!a) return false;
    if (engine === "custom") return !!(a.baseUrl && a.model);
    if (engine === "openrouter") return !!(a.hint && a.model);
    return !!a.hint;
  }
  async secret(engine) {
    if (this.secrets.has(engine)) return this.secrets.get(engine);
    const stored = this.hub.vault ? await this.hub.vault.load(binding(engine)) : null;
    const value = typeof stored?.key === "string" ? stored.key : null;
    this.secrets.set(engine, value);
    return value;
  }
  baseOf(engine) { return engine === "custom" ? this.account("custom")?.baseUrl || null : COMPATIBLE[engine].base; }
  provider(engine) {
    if (!this.adapters.has(engine)) {
      const d = COMPATIBLE[engine];
      this.adapters.set(engine, new CompletionsProvider({
        engine, fetchImpl: this.fetch, names: names(engine), keyOptional: !!d.keyOptional,
        loadKey: () => this.secret(engine), baseUrl: () => this.baseOf(engine), headers: d.headers ? () => d.headers : null,
      }));
    }
    return this.adapters.get(engine);
  }
  /** The chosen model of OpenRouter or the server, published to the catalogue (all families). */
  syncModels(engine) {
    const a = this.account(engine);
    const m = a?.model ? { ...(a.meta || {}), id: a.model, label: a.meta?.label || (a.model === OPENROUTER_AUTO ? "Automático" : a.model) } : null;
    setDynamicModels(engine, m ? [{ ...m, families: ["luna", "sol", "astra"], utility: true, rank: 1 }] : []);
  }
  /** What Ajustes shows: «Clave ····1234 · Gemini 3.8 Flash», the server address, the model. */
  view(engine) {
    const a = this.account(engine);
    if (!a) return { detail: null, model: null };
    const model = a.model ? (a.meta?.label || (a.model === OPENROUTER_AUTO ? "Automático" : a.model)) : null;
    const where = engine === "custom" ? safeHost(a.baseUrl) : null;
    const key = a.hint ? "Clave ····" + a.hint : engine === "custom" ? "Sin clave" : null;
    return { detail: [where, key, engine === "custom" || engine === "openrouter" ? model : null].filter(Boolean).join(" · ") || null, model: a.model || null, modelLabel: model, baseUrl: engine === "custom" ? a.baseUrl : null, vision: a.meta ? !!a.meta.vision : null };
  }

  /** The base URL, key and model of a connect or a test: what was typed, else what is saved. */
  async target(engine, { key: rawKey, baseUrl, model } = {}) {
    if (!KEY_ENGINES.includes(engine)) throw Error("Proveedor desconocido.");
    const saved = this.account(engine);
    let key;
    if (rawKey !== undefined && rawKey !== null && String(rawKey) !== "") {
      const checked = checkKey(engine, rawKey);
      if (checked.error) throw Error(checked.error);
      key = checked.key;
    } else key = (await this.secret(engine)) || (COMPATIBLE[engine].keyOptional ? "" : null);
    if (key === null) throw Error(`Pega tu clave de ${ENGINE_LABEL[engine]}.`);
    const base = engine === "custom" ? validateBaseUrl(baseUrl ?? saved?.baseUrl ?? "") : COMPATIBLE[engine].base;
    const chosen = String(model ?? (engine === "custom" || engine === "openrouter" ? saved?.model || "" : "") ?? "").trim();
    if (chosen && !/^[\w.:/@+\-~]{1,200}$/.test(chosen)) throw Error("Ese nombre de modelo no es válido.");
    return { key, base, model: chosen };
  }

  /** The models an account offers: Gemini, DeepSeek and Kimi from the catalogue; the rest from /models. */
  async listModels(engine, params = {}) {
    if (CATALOG[engine]) return CATALOG[engine].map((m) => ({ id: m.id, ref: m.ref, label: m.label, vision: m.input.includes("image"), pdf: !!m.pdf, context: m.context, cost: m.cost || null, families: m.families, utility: !!m.utility }));
    const { key, base } = await this.target(engine, params);
    const cacheKey = engine + "|" + base + "|" + (key ? key.slice(-4) : "");
    const cached = this.lists.get(cacheKey);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.list;
    let response;
    try {
      response = await this.fetch(base + "/models", { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json", ...(key ? { Authorization: "Bearer " + key } : {}), ...(COMPATIBLE[engine].headers || {}) } });
    } catch (error) {
      throw Error(engine === "custom" ? "No se pudo contactar con tu servidor en " + base + ". ¿Está encendido?" : `No se pudo contactar con ${ENGINE_LABEL[engine]}.`, { cause: error });
    }
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.text()).slice(0, 2000); } catch {}
      if (engine === "custom" && response.status === 404) throw Error("Tu servidor no da la lista de modelos: escribe el nombre del modelo.");
      throw chatError({ status: response.status, detail, names: names(engine), model: "" });
    }
    let data;
    try { data = await response.json(); } catch { throw Error("La lista de modelos no es válida."); }
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    let list;
    if (engine === "openrouter") list = [AUTO_ENTRY, ...raw.map(openrouterModel).filter((m) => m && m.tools && m.id !== OPENROUTER_AUTO)];
    else list = raw.map((m) => ({ id: String(m?.id || m?.name || m?.model || ""), context: Number(m?.context_length || m?.max_model_len || m?.meta?.n_ctx_train) || null }))
      .filter((m) => m.id && m.id.length <= 200 && !/embed|rerank|whisper|tts|transcri/i.test(m.id))
      .map((m) => ({ ...m, label: m.id, vision: looksVisual(m.id), pdf: false, tools: true, reasoning: false }));
    list = list.slice(0, 1000);
    this.lists.set(cacheKey, { at: Date.now(), list });
    return list;
  }

  /**
   * «Probar»: one tiny, non-streamed answer from the account's cheapest model (or the chosen
   * one). {ok, ms, model} or an Error with the plain sentence (bad key, no credit, no model…).
   */
  async test(engine, params = {}) {
    const { key, base, model } = await this.target(engine, params);
    const d = COMPATIBLE[engine];
    const id = model || d.checkModel;
    if (!id) throw Error("Elige un modelo para probar.");
    const started = Date.now();
    let response;
    try {
      response = await this.fetch(base + "/chat/completions", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(engine === "custom" ? 60000 : 30000),
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}), ...(d.headers || {}) },
        body: JSON.stringify({ model: id, messages: [{ role: "user", content: "Responde solo: ok" }], [d.maxField || "max_tokens"]: 16, stream: false, ...(d.checkParams || {}) }),
      });
    } catch (error) {
      if (error?.name === "TimeoutError") throw Error(`${ENGINE_LABEL[engine]} no contestó a tiempo.`);
      throw Error(engine === "custom" ? "No se pudo contactar con tu servidor en " + base + ". ¿Está encendido?" : `No se pudo contactar con ${ENGINE_LABEL[engine]}. Revisa tu conexión.`, { cause: error });
    }
    let detail = "";
    try { detail = (await response.text()).slice(0, 4000); } catch {}
    const label = engine === "openrouter" && id === OPENROUTER_AUTO ? "Automático" : CATALOG[engine]?.find((m) => m.id === id)?.label || id;
    if (!response.ok) throw chatError({ status: response.status, detail, names: { ...names(engine), auth: engine === "custom" ? "Tu servidor no acepta esa clave." : `${ENGINE_LABEL[engine]} no acepta esa clave. Cópiala de nuevo de ${d.keySite}.` }, model: label });
    // OpenRouter can answer 200 with an error body instead of choices.
    let body = null;
    try { body = JSON.parse(detail); } catch {}
    if (body?.error && !body?.choices) throw chatError({ status: Number(body.error.code) || 502, detail, names: names(engine), model: label });
    if (!Array.isArray(body?.choices)) throw Error(engine === "custom" ? "Esa dirección contesta, pero no como un servidor compatible con OpenAI (falta /chat/completions)." : `${ENGINE_LABEL[engine]} dio una respuesta que no se entiende.`);
    return { ok: true, ms: Date.now() - started, model: id, label };
  }

  /** Connect (or replace) an account: test it, keep the key in the vault, the rest in SQLite. */
  async connect(engine, params = {}) {
    if (!this.hub.vault && !(engine === "custom" && !params.key)) throw Error("El almacén cifrado de Windows no está disponible.");
    const target = await this.target(engine, params);
    let meta = null;
    if (engine === "openrouter" || engine === "custom") {
      if (!target.model && engine === "openrouter") target.model = OPENROUTER_AUTO;
      if (!target.model) throw Error("Elige el modelo de tu servidor o escribe su nombre.");
      let list = [];
      try { list = await this.listModels(engine, { ...params, key: params.key ?? undefined }); } catch {}
      const found = list.find((m) => m.id === target.model);
      meta = found ? { label: found.label, vision: !!found.vision, pdf: !!found.pdf, context: found.context || null, maxTokens: found.maxTokens || null, reasoning: !!found.reasoning, cost: found.cost || null }
        : { label: target.model, vision: engine === "custom" ? looksVisual(target.model) : false, pdf: false, reasoning: false };
      if (engine === "custom" && typeof params.vision === "boolean") meta.vision = params.vision;
    }
    await this.test(engine, { ...params, model: target.model || undefined });
    if (target.key) await this.hub.vault.save(binding(engine), { key: target.key });
    else if (this.hub.vault && engine === "custom") await this.hub.vault.remove(binding(engine).profile);
    this.secrets.set(engine, target.key || null);
    const accounts = { ...(this.hub.config().accounts || {}) };
    accounts[engine] = { hint: target.key ? target.key.slice(-4) : null, savedAt: new Date().toISOString(), ...(engine === "custom" ? { baseUrl: target.base } : {}), ...(meta ? { model: target.model, meta } : {}) };
    this.hub.saveConfig({ accounts, primary: this.hub.config().primary || engine });
    this.syncModels(engine);
    this.hub.cooldown.delete(engine);
    return this.hub.engines();
  }

  /**
   * The model of an account: Gemini, DeepSeek and Kimi pin it to every family (null =
   * «Automático», the catalogue's choice per family); OpenRouter and the server keep it.
   */
  async setModel(engine, ref) {
    if (!this.connected(engine)) throw Error("Conecta esa cuenta antes de elegir su modelo.");
    if (CATALOG[engine]) {
      const families = ref ? { luna: ref, sol: ref, astra: ref } : {};
      if (ref && !CATALOG[engine].some((m) => m.ref === ref)) throw Error("Ese modelo no está en la lista.");
      return this.hub.setEngines({ pins: { [engine]: families } });
    }
    const id = String(ref || (engine === "openrouter" ? OPENROUTER_AUTO : "")).replace(new RegExp("^" + engine + "/"), "");
    if (!id) throw Error("Elige un modelo.");
    const list = await this.listModels(engine).catch(() => []);
    const found = list.find((m) => m.id === id);
    if (!found && engine === "openrouter") throw Error("OpenRouter no tiene ese modelo con herramientas.");
    const a = this.account(engine);
    const meta = found ? { label: found.label, vision: !!found.vision, pdf: !!found.pdf, context: found.context || null, maxTokens: found.maxTokens || null, reasoning: !!found.reasoning, cost: found.cost || null } : { label: id, vision: looksVisual(id), pdf: false, reasoning: false };
    this.hub.saveConfig({ accounts: { ...(this.hub.config().accounts || {}), [engine]: { ...a, model: id, meta } } });
    this.syncModels(engine);
    return this.hub.engines();
  }

  async disconnect(engine) {
    if (this.hub.vault) await this.hub.vault.remove(binding(engine).profile);
    this.secrets.delete(engine);
    this.adapters.delete(engine);
    for (const k of [...this.lists.keys()]) if (k.startsWith(engine + "|")) this.lists.delete(k);
    const c = this.hub.config();
    const { [engine]: _gone, ...accounts } = c.accounts || {};
    const pins = { ...(c.pins || {}) };
    delete pins[engine];
    this.hub.saveConfig({ accounts, pins, primary: c.primary === engine ? null : c.primary ?? null, ...(c.fallback === engine ? { fallback: "none" } : {}) });
    this.syncModels(engine);
  }
}

function safeHost(url) {
  try { const u = new URL(url); return u.host; } catch { return null; }
}
