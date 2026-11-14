// AI accounts in a hosted workspace (docs/CLOUD.md › Phase 3): each person thinks with their
// own account. A bot's turn uses the account of the person who asked (a message, a mention, a
// routine they own); limits and errors are theirs and are shown to them.
//
// - `PersonHub`: the desktop's ProviderHub for one person. Its choices live in the store record
//   providers/person:<id> (method, last four characters, pins, limits), its secrets in the
//   workspace's envelope vault under the namespace ai-<id>. Nothing that needs this computer:
//   no local model, no Claude Code CLI, «Servidor propio» only on a public https address.
// - Consumer subscriptions (ChatGPT sign-in by device code, Claude setup-token) are off unless a
//   workspace admin turns them on, with the warning `SUBSCRIPTION_WARNING` (the providers'
//   terms; docs/CLOUD.md › Phase 3 › Terms).
// - `personalProviders(…)`: one object with ProviderHub's surface that answers as the hub of
//   `currentPerson()` (server/identity.mjs). Background work runs as the person it is for.
import { ProviderHub, OpenAIProvider } from "../provider.mjs";
import { normalizeModels } from "../nexo/security.mjs";
import { currentPerson, isPerson } from "../identity.mjs";
import { hostKind, validateBaseUrl } from "../providers/endpoint.mjs";
import { fakeHub } from "./fake-model.mjs";

export const AI_POLICY_ID = "ai-policy";
/** What a workspace admin reads before turning a subscription sign-in on (Spanish UI copy). */
export const SUBSCRIPTION_WARNING = Object.freeze({
  chatgpt: "Las condiciones de OpenAI no permiten compartir el acceso a una cuenta de ChatGPT ni prevén que un servicio alojado de terceros use el inicio de sesión de Codex en nombre de sus usuarios: su vía para apps alojadas («Sign in with ChatGPT») requiere que OpenAI la apruebe. Si lo activas, cada persona usa su propia cuenta bajo su responsabilidad y OpenAI puede bloquearla. Lo seguro es una clave de API.",
  claude: "Anthropic prohíbe expresamente que un producto de terceros use credenciales de los planes Free, Pro, Max o Ultra en nombre de sus usuarios, o que las guarde. Si lo activas, incumples sus condiciones y Anthropic puede cerrar esas cuentas sin aviso. Lo permitido es una clave de API.",
});

/** The workspace's switches: both subscription sign-ins start off. */
export function aiPolicy(store) {
  const p = store.get("cloud", AI_POLICY_ID) || {};
  return { chatgptLogin: p.chatgptLogin === true, claudeToken: p.claudeToken === true, updatedAt: p.updatedAt || null, updatedBy: p.updatedBy || null };
}
export function setAiPolicy(store, patch = {}, by = null) {
  const next = { ...aiPolicy(store) };
  for (const k of ["chatgptLogin", "claudeToken"]) if (typeof patch[k] === "boolean") next[k] = patch[k];
  store.put("cloud", { id: AI_POLICY_ID, chatgptLogin: next.chatgptLogin, claudeToken: next.claudeToken, updatedAt: new Date().toISOString(), updatedBy: by });
  return aiPolicy(store);
}

const refuse = (message, status = 403) => Object.assign(Error(message), { status });
// Workers reach the network with `fetch`; a wrapper keeps the adapters off their WebSocket path.
const plainFetch = (...args) => fetch(...args);

/** A «Servidor propio» address the cloud may call: https, a public name or address. */
export function cloudBaseUrl(raw) {
  const base = validateBaseUrl(raw);
  const url = new URL(base);
  if (url.protocol !== "https:" || hostKind(url.hostname) !== "public") throw refuse("En la nube, «Servidor propio» tiene que ser una dirección pública con https://.", 400);
  return base;
}

// ------------------------------------------------------------ ChatGPT by device code
// The Codex CLI's device-code sign-in (`codex login --device-auth`, openai/codex
// codex-rs/login/src/device_code_auth.rs). The person opens VERIFY_URL on any device and types
// the code; nothing comes back to a loopback address. Each person must turn «device code
// login» on in their ChatGPT security settings (a workspace admin, for ChatGPT Business).
export const CODEX = Object.freeze({
  issuer: "https://auth.openai.com",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  verifyUrl: "https://auth.openai.com/codex/device",
  redirectUri: "https://auth.openai.com/deviceauth/callback",
  api: "https://chatgpt.com/backend-api/codex",
  windowMs: 15 * 60_000,
});
const DEVICE_PROFILE = { profile: "chatgpt-device", hostId: "colmena-cloud", clientId: "chatgpt-device", subject: "device" };
const PENDING_PROFILE = { profile: "chatgpt-device-pending", hostId: "colmena-cloud", clientId: "chatgpt-device", subject: "pending" };

/** The claims of a JWT, unverified: it came straight from the token endpoint over TLS (OIDC Core 3.1.3.7). */
export function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8")); } catch { return {}; }
}

export class CodexDeviceSession {
  /** `vault` (envelope vault of this person), `info()` / `setInfo(v)`: what the config keeps in the clear (email, account). */
  constructor({ vault, fetchImpl = plainFetch, info = () => null, setInfo = () => {}, allowed = () => true, clock = Date.now }) {
    Object.assign(this, { vault, fetch: fetchImpl, info, setInfo, allowed, clock });
    this.credentials = undefined; // undefined: not loaded yet
    this.models = [];
    this.refreshing = null;
  }
  status() {
    const i = this.info();
    if (!i || !this.allowed()) return null;
    return { email: i.email || "", label: i.email || "Cuenta ChatGPT", canInfer: true, kind: "device" };
  }
  async post(url, body, { form = false } = {}) {
    const response = await this.fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: form ? new URLSearchParams(body) : JSON.stringify(body),
    });
    let data = null;
    try { data = await response.json(); } catch {}
    return { status: response.status, ok: response.ok, data };
  }
  /** Step 1: a code for the person to type at VERIFY_URL. */
  async start() {
    if (!this.allowed()) throw refuse("El inicio de sesión con ChatGPT está desactivado en este espacio. Usa una clave de API de OpenAI.");
    const r = await this.post(CODEX.issuer + "/api/accounts/deviceauth/usercode", { client_id: CODEX.clientId });
    if (r.status === 404) throw refuse("OpenAI no tiene activado el inicio de sesión con código. Actívalo en la configuración de seguridad de ChatGPT («device code login») y vuelve a probar.", 409);
    const code = r.data?.user_code || r.data?.usercode;
    if (!r.ok || !r.data?.device_auth_id || !code) throw refuse("OpenAI no ha dado un código para iniciar sesión (" + r.status + "). Prueba otra vez.", 502);
    const pending = { deviceAuthId: String(r.data.device_auth_id), userCode: String(code), interval: Math.max(3, Number(r.data.interval) || 5), expiresAt: this.clock() + CODEX.windowMs };
    await this.vault.save(PENDING_PROFILE, pending);
    return { userCode: pending.userCode, verificationUrl: CODEX.verifyUrl, interval: pending.interval, expiresAt: new Date(pending.expiresAt).toISOString() };
  }
  /** Step 2, called by the screen every few seconds: pending, connected or expired. */
  async poll() {
    const pending = await this.vault.load(PENDING_PROFILE);
    if (!pending) return { status: "none" };
    if (this.clock() > pending.expiresAt) { await this.vault.remove(PENDING_PROFILE.profile); return { status: "expired" }; }
    const r = await this.post(CODEX.issuer + "/api/accounts/deviceauth/token", { device_auth_id: pending.deviceAuthId, user_code: pending.userCode });
    if (r.status === 403 || r.status === 404) return { status: "pending", interval: pending.interval };
    if (!r.ok || !r.data?.authorization_code || !r.data?.code_verifier) { await this.vault.remove(PENDING_PROFILE.profile); throw refuse("OpenAI no completó el inicio de sesión (" + r.status + "). Vuelve a empezar.", 502); }
    const t = await this.post(CODEX.issuer + "/oauth/token", {
      grant_type: "authorization_code", code: r.data.authorization_code, redirect_uri: CODEX.redirectUri, client_id: CODEX.clientId, code_verifier: r.data.code_verifier,
    }, { form: true });
    await this.vault.remove(PENDING_PROFILE.profile);
    if (!t.ok || typeof t.data?.access_token !== "string") throw refuse("OpenAI no entregó las credenciales (" + t.status + ").", 502);
    await this.accept(t.data);
    return { status: "connected", email: this.info()?.email || "" };
  }
  async accept(tokens, previous = null) {
    const claims = jwtClaims(tokens.id_token || previous?.idToken);
    const auth = claims["https://api.openai.com/auth"] || {};
    const access = jwtClaims(tokens.access_token);
    const expiresAt = Number.isFinite(tokens.expires_in) ? this.clock() + tokens.expires_in * 1000 : (Number(access.exp) * 1000 || this.clock() + 3600_000);
    this.credentials = {
      access: tokens.access_token, refresh: tokens.refresh_token || previous?.refresh || null, idToken: tokens.id_token || previous?.idToken || null,
      accountId: auth.chatgpt_account_id || previous?.accountId || null, expiresAt,
    };
    await this.vault.save(DEVICE_PROFILE, this.credentials);
    this.setInfo({ email: claims.email || this.info()?.email || "", plan: auth.chatgpt_plan_type || null, savedAt: new Date().toISOString() });
  }
  async load() {
    if (this.credentials === undefined) this.credentials = (await this.vault.load(DEVICE_PROFILE)) || null;
    return this.credentials;
  }
  async accessToken() {
    if (!this.allowed()) throw refuse("El inicio de sesión con ChatGPT está desactivado en este espacio.");
    const c = await this.load();
    if (!c) throw refuse("Conecta tu cuenta de ChatGPT en Ajustes › Tu cuenta de IA.", 401);
    if (c.expiresAt > this.clock() + 60_000) return c.access;
    if (!c.refresh) throw refuse("La sesión de ChatGPT ha caducado. Vuelve a conectarla.", 401);
    this.refreshing ??= (async () => {
      const r = await this.post(CODEX.issuer + "/oauth/token", { grant_type: "refresh_token", client_id: CODEX.clientId, refresh_token: c.refresh }, { form: true });
      if (!r.ok || typeof r.data?.access_token !== "string") throw refuse(r.status === 400 || r.status === 401 ? "OpenAI ha retirado la sesión de ChatGPT. Vuelve a conectarla." : "No se pudo renovar la sesión de ChatGPT.", r.status === 400 || r.status === 401 ? 401 : 502);
      await this.accept(r.data, c);
    })().finally(() => { this.refreshing = null; });
    await this.refreshing;
    return this.credentials.access;
  }
  async headers() {
    const token = await this.accessToken();
    return { Authorization: "Bearer " + token, ...(this.credentials?.accountId ? { "chatgpt-account-id": this.credentials.accountId } : {}) };
  }
  async listModels() {
    const response = await this.fetch(CODEX.api + "/models?client_version=1.0.0", { redirect: "error", signal: AbortSignal.timeout(20000), headers: await this.headers() });
    if (!response.ok) throw refuse("ChatGPT no ha dado la lista de modelos (" + response.status + ").", 502);
    this.models = normalizeModels(await response.json());
    return this.models;
  }
  async logout() {
    this.credentials = null;
    this.models = [];
    await this.vault.remove(DEVICE_PROFILE.profile);
    await this.vault.remove(PENDING_PROFILE.profile);
    this.setInfo(null);
    return { ok: true, revoked: false, message: "Sesión retirada de Colmena. Si quieres, desconéctala también en la configuración de ChatGPT." };
  }
  closePending() {}
  dispose() { this.credentials = undefined; this.models = []; }
}

/** The ChatGPT plan through the Codex backend (what the device-code tokens are for). */
export class CodexProvider extends OpenAIProvider {
  async target() {
    return { url: CODEX.api + "/responses", headers: await this.session.headers() };
  }
}

// ------------------------------------------------------------ one person's hub
const NO_CLI = Object.freeze({ respond: async () => { throw refuse("Claude Code de este ordenador no existe en la nube.", 400); }, close() {} });

export class PersonHub extends ProviderHub {
  constructor({ store, personId, vault, fetchImpl = plainFetch, policy = () => aiPolicy(store) }) {
    let hub = null;
    const session = new CodexDeviceSession({
      vault, fetchImpl,
      info: () => hub?.config().chatgpt || null,
      setInfo: (value) => hub?.saveConfig({ chatgpt: value }),
      allowed: () => policy().chatgptLogin,
    });
    super({ session, store, vault, fetchImpl, claudeCli: NO_CLI });
    hub = this;
    this.personId = personId;
    this.policy = policy;
    this.chatgpt = new CodexProvider(session, { fetchImpl });
    // «Servidor propio» only on a public https address (the cloud has no local network).
    for (const name of ["connect", "test", "listModels"]) {
      const original = this.accounts[name].bind(this.accounts);
      this.accounts[name] = (engine, data = {}) => {
        if (engine === "custom") cloudBaseUrl(data.baseUrl ?? this.accounts.account("custom")?.baseUrl ?? "");
        return original(engine, data);
      };
    }
  }
  configId() { return "person:" + this.personId; }
  config() {
    return this.store.get("providers", this.configId()) || { id: this.configId(), kind: null, apikey: null, local: null };
  }
  saveConfig(patch) {
    return this.store.put("providers", { ...this.config(), ...patch, id: this.configId(), person: this.personId, updatedAt: new Date().toISOString() });
  }
  async connectAnthropic({ method, secret = "" }) {
    if (method === "cli") throw refuse("Claude Code de este ordenador no existe en la nube. Usa una clave de API de Anthropic.", 400);
    if (method === "token" && !this.policy().claudeToken) throw refuse("El token de suscripción de Claude está desactivado en este espacio: las condiciones de Anthropic no lo permiten en servicios de terceros. Usa una clave de API.");
    return super.connectAnthropic({ method, secret });
  }
  /** A token saved while the switch was on stops working when an admin turns it off. */
  async anthropicCredential() {
    if (this.config().anthropic?.method === "token" && !this.policy().claudeToken) return null;
    return super.anthropicCredential();
  }
  setLocal() { throw refuse("Un modelo local no existe en la nube.", 400); }
  async clear(kind) {
    if (kind === "chatgpt") {
      await this.session.logout();
      this.saveConfig({ chatgpt: null, kind: this.config().kind === "chatgpt" ? null : this.config().kind });
      return this.status();
    }
    if (kind === "local") throw refuse("Un modelo local no existe en la nube.", 400);
    return super.clear(kind);
  }
  /** Something to think with: any engine connected. */
  hasAccount() {
    return !!this.primary;
  }
}

/** Does this stored config (providers/person:<id>) hold any account? Used without opening the vault. */
function configHasAccount(c, policy) {
  return !!(c?.apikey || (c?.chatgpt && policy.chatgptLogin) || ["api_key"].includes(c?.anthropic?.method) || (c?.anthropic?.method === "token" && policy.claudeToken) || c?.opencode?.hint || Object.keys(c?.accounts || {}).length);
}

/** A person with no account (or nobody at all): says so, never thinks. */
function noAccount(personal) {
  const off = async () => { throw Object.assign(Error(personal ? "Conecta tu cuenta de IA en Ajustes › Tu cuenta de IA para que los bots trabajen para ti." : "Este trabajo no tiene a nadie con cuenta de IA."), { status: 401, code: "COLMENA_NO_ACCOUNT" }); };
  return { kind: null, primary: null, local: null, status: () => ({ kind: null, cloud: true }), engines: () => [], connected: () => false, engineFor: () => null, modelsFor: () => [], models: async () => [], respond: off, providerFor: () => ({ respond: off }), resolveModel: (m) => m, fallbackFor: () => null, limitOf: () => null, resting: () => false, close() {} };
}

/**
 * `vaultFor(namespace)`: the workspace's envelope vault (server/envelope-vault.mjs), null when the
 * Worker has no master secret. `fake()`: the test flag (server/cloud/fake-model.mjs).
 */
export class PersonalProviders {
  constructor({ store, vaultFor = () => null, fetchImpl = plainFetch, fake = () => false, members = null }) {
    Object.assign(this, { store, vaultFor, fetchImpl, fake, members });
    this.hubs = new Map();
    this.fakeOne = null;
  }
  policy() { return aiPolicy(this.store); }
  /** One person's hub (made once per wake-up of the workspace). */
  hub(personId) {
    if (!this.hubs.has(personId))
      this.hubs.set(personId, new PersonHub({ store: this.store, personId, vault: this.vaultFor("ai-" + personId), fetchImpl: this.fetchImpl, policy: () => this.policy() }));
    return this.hubs.get(personId);
  }
  current() {
    if (this.fake()) return (this.fakeOne ??= fakeHub());
    const p = currentPerson();
    if (!isPerson(p)) return noAccount(false);
    return this.hub(p.id);
  }
  /** Someone in the workspace can think (the scheduler starts routines only then). */
  anyConnected() {
    if (this.fake()) return true;
    const policy = this.policy();
    return this.store.list("providers").some((c) => String(c.id).startsWith("person:") && configHasAccount(c, policy));
  }
  /** Has this person an account? (the runtime says «connect yours» before trying). */
  connectedFor(personId) {
    if (this.fake()) return true;
    return !!personId && configHasAccount(this.store.get("providers", "person:" + personId), this.policy());
  }
  status() {
    if (!isPerson(currentPerson())) return this.anyConnected() ? { kind: "cloud", label: "La cuenta de IA de cada persona", connected: true, cloud: true } : { kind: null, cloud: true };
    return this.current().status();
  }
  get kind() { return this.status()?.kind ?? null; }
  forget(personId) { this.hubs.get(personId)?.close?.(); this.hubs.delete(personId); }
  close() { for (const h of this.hubs.values()) h.close?.(); this.hubs.clear(); }
}

/** The facade the runtime and the routes hold: ProviderHub's surface, answered by the current person's hub. */
export function personalProviders(options) {
  const facade = new PersonalProviders(options);
  return new Proxy(facade, {
    get(target, prop) {
      if (prop in target) {
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      }
      const hub = target.current();
      const v = hub?.[prop];
      return typeof v === "function" ? v.bind(hub) : v;
    },
  });
}
