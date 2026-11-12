// «Cuando avisa otra app»: webhook triggers. Colmena runs on a desk with no public address,
// so a service (GitHub, Sentry, Stripe…) posts to a secret address at the mailbox Colmena
// already uses for «Personas» (relay/cloudflare/hooks.js): https://<buzón>/h/<43 characters>.
// The mailbox seals each request to this install's box key as it arrives and keeps it until
// this Colmena is on (72 h at most). What happens here, in order, with no model call:
//   1. open the sealed request (peers/protocol.mjs openHook); an address that was rotated or
//      revoked is dropped;
//   2. dedupe (Idempotency-Key, X-GitHub-Delivery, webhook-id, else the body's hash);
//   3. check the signature over the exact bytes, when the trigger asks for one (the shared
//      secret lives in the key store, secrets.mjs — never in the trigger, the store or a log);
//   4. filters: the event-type header and JSON fields that must equal or contain a value;
//   5. hand the event to the scheduler, where the brakes of self-started work apply
//      (brakes.mjs) and the body reaches the bot wrapped as outside content.
// Every request leaves one line in the trigger's «últimos avisos», never its content.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { now } from "./store.mjs";
import { cleanHeader } from "./external-content.mjs";
import { newHookId, openHook } from "./peers/protocol.mjs";

export const WEBHOOK_LIMITS = Object.freeze({ deliveries: 30, seen: 500, body: 12_000, stripeSkewS: 300 });
// A site no request ever goes to: the key store wants one, and with this one no bot can use
// the secret in an api_request ({{secret:…}} is only filled in for a key's own sites).
const SECRET_HOST = "webhook.invalid";
const secretName = (ruleId) => "WEBHOOK_" + String(ruleId).toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 100);

/** Ready-made settings for the usual services, with what to do on their side. */
export const WEBHOOK_PRESETS = Object.freeze({
  github_pr: {
    label: "GitHub: se abre una pull request",
    config: { firma: "github", cabeceraFirma: "", cabeceraEvento: "X-GitHub-Event", eventos: "pull_request", filtros: [{ ruta: "action", op: "igual", valor: "opened" }], asuntoRuta: "repository.full_name, pull_request.number" },
    title: "pull_request.title", noun: "Pull request",
    steps: [
      "En GitHub, abre el repositorio y entra en Settings › Webhooks › Add webhook.",
      "Pega la dirección en «Payload URL» y elige «application/json» en «Content type».",
      "Inventa una contraseña larga, escríbela en «Secret» y pon la misma aquí, en «Secreto».",
      "En «Let me select individual events», marca solo «Pull requests» y guarda.",
    ],
  },
  github_check: {
    label: "GitHub: falla una comprobación",
    config: { firma: "github", cabeceraFirma: "", cabeceraEvento: "X-GitHub-Event", eventos: "check_run", filtros: [{ ruta: "action", op: "igual", valor: "completed" }, { ruta: "check_run.conclusion", op: "igual", valor: "failure" }], asuntoRuta: "repository.full_name, check_run.name, check_run.head_sha" },
    title: "check_run.name", noun: "Comprobación fallida",
    steps: [
      "En GitHub, abre el repositorio y entra en Settings › Webhooks › Add webhook.",
      "Pega la dirección en «Payload URL» y elige «application/json» en «Content type».",
      "Inventa una contraseña larga, escríbela en «Secret» y pon la misma aquí, en «Secreto».",
      "En «Let me select individual events», marca solo «Check runs» y guarda.",
    ],
  },
  sentry: {
    label: "Sentry: aparece un error nuevo",
    config: { firma: "hmac", cabeceraFirma: "Sentry-Hook-Signature", cabeceraEvento: "Sentry-Hook-Resource", eventos: "issue", filtros: [{ ruta: "action", op: "igual", valor: "created" }], asuntoRuta: "data.issue.id" },
    title: "data.issue.title", noun: "Error nuevo",
    steps: [
      "En Sentry, entra en Settings › Developer Settings › Custom Integrations y crea una «Internal Integration».",
      "Pega la dirección en «Webhook URL».",
      "En «Webhooks», marca «issue» y guarda.",
      "Copia el «Client Secret» de esa integración y pégalo aquí, en «Secreto».",
    ],
  },
  generico: {
    label: "Otra app",
    config: { firma: "ninguna", cabeceraFirma: "", cabeceraEvento: "", eventos: "", filtros: [], asuntoRuta: "" },
    title: "", noun: "Aviso de otra app",
    steps: [
      "Busca en esa app dónde se pone un «webhook» o una «URL de aviso» y pega ahí la dirección.",
      "Si la app firma sus avisos, elige aquí cómo los firma y escribe el mismo secreto en los dos sitios.",
    ],
  },
});
export const SIGNATURE_LABELS = Object.freeze({
  ninguna: "Sin firma", github: "GitHub (X-Hub-Signature-256)", stripe: "Stripe (Stripe-Signature)", hmac: "HMAC-SHA256 en una cabecera",
});

const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const clip = (s, n) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** «pull_request.head.ref», «items.0.id», «items[0].id» → the value, or undefined. */
export function jsonPath(value, path) {
  let at = value;
  for (const part of String(path || "").replace(/\[(\d+)\]/g, ".$1").split(".").map((p) => p.trim()).filter(Boolean).slice(0, 12)) {
    if (at === null || typeof at !== "object") return undefined;
    if (!Object.hasOwn(at, part)) return undefined;
    at = at[part];
  }
  return at;
}
const asText = (v) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The trigger's filters over a request: {ok: true} or {ok: false, why} (plain Spanish, no content). */
export function matchFilters(config, { headers = {}, json = null } = {}) {
  const wanted = String(config.eventos || "").split(",").map(fold).filter(Boolean);
  if (wanted.length) {
    const got = fold(headers[String(config.cabeceraEvento || "").toLowerCase()]);
    if (!wanted.includes(got)) return { ok: false, why: got ? "Era de tipo «" + clip(got, 60) + "», que no vigilas" : "No decía de qué tipo era" };
  }
  for (const f of config.filtros || []) {
    const text = fold(asText(jsonPath(json, f.ruta)));
    const want = fold(f.valor);
    if (f.op === "igual" ? text !== want : !text.includes(want)) return { ok: false, why: "«" + f.ruta + "» no " + (f.op === "igual" ? "es" : "contiene") + " «" + clip(f.valor, 60) + "»" };
  }
  return { ok: true };
}

const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);
/** A signature as a service writes it (hex or base64, with or without «sha256=») → bytes, or null. */
function macBytes(value) {
  const v = String(value || "").trim().replace(/^(?:sha256|v1)=/i, "");
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) return Buffer.from(v, "base64");
  return null;
}

/**
 * Checks a request's signature with the trigger's shared secret, over the exact bytes that
 * arrived: GitHub (X-Hub-Signature-256), Stripe (Stripe-Signature: t=…,v1=… over «t.body»,
 * within 5 minutes of when the mailbox received it) or HMAC-SHA256 in the header you named.
 * → {ok, checked} | {ok: false, why}.
 */
export function verifySignature(config, secret, { headers = {}, raw = Buffer.alloc(0), at = Date.now() } = {}) {
  const scheme = config.firma || "ninguna";
  if (scheme === "ninguna") return { ok: true, checked: false };
  if (!secret) return { ok: false, why: "Falta el secreto para comprobar la firma" };
  const mac = (data) => createHmac("sha256", secret).update(data).digest();
  const bad = { ok: false, why: "La firma no coincide con tu secreto" };
  if (scheme === "stripe") {
    const parts = String(headers["stripe-signature"] || "").split(",").map((p) => p.trim().split("="));
    const t = parts.find(([k]) => k === "t")?.[1];
    const sent = parts.filter(([k]) => k === "v1").map(([, v]) => macBytes(v)).filter(Boolean);
    if (!t || !/^\d{1,12}$/.test(t) || !sent.length) return { ok: false, why: "No traía la firma de Stripe" };
    if (Math.abs(at / 1000 - Number(t)) > WEBHOOK_LIMITS.stripeSkewS) return { ok: false, why: "La firma era de otro momento" };
    const expected = mac(Buffer.concat([Buffer.from(t + "."), raw]));
    return sent.some((s) => same(s, expected)) ? { ok: true, checked: true } : bad;
  }
  const name = scheme === "github" ? "x-hub-signature-256" : String(config.cabeceraFirma || "").toLowerCase();
  const sent = macBytes(headers[name]);
  if (!sent) return { ok: false, why: "No traía firma" };
  return same(sent, mac(raw)) ? { ok: true, checked: true } : bad;
}

/** What a request is about, for the brakes (brakes.mjs eventSubject): the trigger's fields, joined. */
export function subjectOf(config, json) {
  const paths = String(config.asuntoRuta || "").split(",").map((p) => p.trim()).filter(Boolean);
  const values = paths.map((p) => asText(jsonPath(json, p))).filter(Boolean);
  return values.length === paths.length && values.length ? clip(values.join(" · "), 200) : "";
}

/** The request's body as the bot will get it (wrapped as outside content by the scheduler): JSON when it is, clipped. */
export function bodyOf(raw, headers = {}) {
  const text = raw.toString("utf8");
  let json = null;
  if (/json/i.test(headers["content-type"] || "") || /^\s*[[{]/.test(text)) try { json = JSON.parse(text); } catch {}
  if (json === null && /x-www-form-urlencoded/i.test(headers["content-type"] || "")) {
    // GitHub's other content type: the JSON goes in a «payload» field.
    const payload = new URLSearchParams(text).get("payload");
    if (payload) try { json = JSON.parse(payload); } catch {}
  }
  const full = json !== null ? JSON.stringify(json) : text;
  return { json, cuerpo: full.length <= WEBHOOK_LIMITS.body && json !== null ? json : clip(full, WEBHOOK_LIMITS.body), cortado: full.length > WEBHOOK_LIMITS.body };
}

const STATUS_TEXT = { queued: "disparado", joined: "sumado", digest: "resumen", stopped: "frenado", chain: "frenado", off: "recibido", duplicate: "duplicado" };

export class WebhookError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

export class Webhooks {
  /** `peers`: the «Personas» service (its identity and its mailbox client); `enqueue`: Scheduler#enqueue. */
  constructor({ store, peers, secrets = null, enqueue, clock = () => Date.now(), log = (m) => console.warn("[avisos] " + m) }) {
    Object.assign(this, { store, peers, secrets, enqueue, clock, log });
    this.syncing = null;
    this.listener = (change) => this.onChange(change);
    this.onLive = (event) => { if (event?.type === "relay" && event.status === "online") void this.sync(); };
  }
  start() {
    this.peers.hookHandler = (row) => this.receive(row);
    this.peers.on("live", this.onLive);
    this.store.listeners.add(this.listener);
    void this.sync();
    return this;
  }
  stop() {
    if (this.peers.hookHandler) this.peers.hookHandler = null;
    this.peers.off("live", this.onLive);
    this.store.listeners.delete(this.listener);
    clearTimeout(this.timer);
  }
  onChange(change) {
    if (change?.type !== "record" || change.kind !== "automations") return;
    if (change.op === "remove") return void this.forget(change.id);
    // A rule became a webhook trigger, or stopped being one: its address is made, or given back.
    if ((change.data?.trigger?.type === "webhook") !== !!this.record(change.id)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.sync(), 50);
      this.timer.unref?.();
    }
  }
  record(ruleId) { return this.store.get("webhooks", ruleId) || null; }
  rules() { return this.store.list("automations").filter((r) => r.trigger?.type === "webhook"); }
  relay() { return this.peers.relayUrl?.() || null; }
  address(record) { return record?.hookId && record.relayUrl ? record.relayUrl + "/h/" + record.hookId : null; }
  /** Every webhook trigger has its address at the mailbox in use (asked again when it comes online: it is idempotent). */
  sync() {
    return (this.syncing ??= (async () => {
      try {
        for (const rule of this.rules()) await this.ensure(rule.id).catch(() => null);
        // A rule that is no longer a webhook trigger gives its address back.
        for (const rec of this.store.list("webhooks")) if (this.store.get("automations", rec.id)?.trigger?.type !== "webhook") await this.forget(rec.id);
      } finally {
        this.syncing = null;
      }
    })());
  }
  client() {
    const client = this.peers.client;
    if (!client || !this.peers.identity || !this.relay()) throw new WebhookError("Los avisos de otras apps llegan por el buzón de Colmena, y ahora está apagado. Actívalo en Ajustes › Personas.", 409);
    return client;
  }
  problem(error) {
    if (error instanceof WebhookError) return error.message;
    if (error?.status === 404) return "El buzón que usas todavía no acepta avisos de otras apps. Hay que actualizarlo.";
    if (error?.status === 429) return "Has cambiado la dirección demasiadas veces seguidas. Espera un minuto.";
    return "No he podido hablar con el buzón" + (error?.message ? ": " + clip(error.message, 120) : "") + ". Lo vuelvo a intentar cuando haya conexión.";
  }
  /** The trigger's address exists at the mailbox (a new one the first time; never after you revoked it). */
  async ensure(ruleId) {
    let rec = this.record(ruleId);
    if (rec?.revokedAt && !rec.hookId) return rec;
    const relayUrl = this.relay();
    if (!rec || !rec.hookId || rec.relayUrl !== relayUrl)
      rec = this.store.put("webhooks", { deliveries: [], seen: [], ...(rec || {}), id: ruleId, hookId: rec?.relayUrl === relayUrl && rec?.hookId ? rec.hookId : newHookId(), relayUrl, registered: false, createdAt: rec?.createdAt || now(), revokedAt: null });
    try {
      await this.client().putHook(rec.hookId, this.peers.identity.box.pub);
      return this.store.patch("webhooks", ruleId, { registered: true, error: null });
    } catch (error) {
      this.store.patch("webhooks", ruleId, { registered: false, error: this.problem(error) });
      throw error;
    }
  }
  /** A new address; the old one stops working at once. Also «Crear dirección» after a revoke. */
  async rotate(ruleId) {
    const old = this.record(ruleId);
    const client = this.client();
    const hookId = newHookId();
    try {
      await client.putHook(hookId, this.peers.identity.box.pub);
    } catch (error) {
      throw new WebhookError(this.problem(error), error?.status === 404 ? 409 : 502);
    }
    this.store.put("webhooks", { deliveries: [], seen: [], ...(old || {}), id: ruleId, hookId, relayUrl: this.relay(), registered: true, error: null, createdAt: old?.createdAt || now(), rotatedAt: now(), revokedAt: null });
    if (old?.hookId) await client.deleteHook(old.hookId).catch((e) => this.log("No se pudo retirar la dirección anterior: " + e.message));
    return this.view(ruleId);
  }
  /** The address stops existing; nothing arrives until you create a new one. */
  async revoke(ruleId) {
    const rec = this.record(ruleId);
    if (!rec?.hookId) return this.view(ruleId);
    try {
      await this.client().deleteHook(rec.hookId);
    } catch (error) {
      if (error?.status !== 404) throw new WebhookError(this.problem(error), 502);
    }
    this.store.patch("webhooks", ruleId, { hookId: null, registered: false, error: null, revokedAt: now() });
    return this.view(ruleId);
  }
  /** The rule is gone (or no longer a webhook): its address, its secret and its history go too. */
  async forget(ruleId) {
    const rec = this.record(ruleId);
    if (!rec) return;
    this.store.remove("webhooks", ruleId);
    if (rec.hookId) await Promise.resolve().then(() => this.client().deleteHook(rec.hookId)).catch(() => null);
    await this.clearSecret(ruleId).catch(() => null);
  }

  // ---------------------------------------------------------------- the shared secret
  hasSecret(ruleId) { return !!this.secrets?.meta(secretName(ruleId)); }
  async setSecret(ruleId, value) {
    if (!this.secrets?.available) throw new WebhookError("En este ordenador no puedo guardar el secreto de forma segura, así que no puedo comprobar firmas.", 409);
    const rule = this.store.get("automations", ruleId);
    await this.secrets.save(secretName(ruleId), value, { allowedHosts: [SECRET_HOST], reason: clip("Firma de los avisos de «" + (rule?.name || "una rutina") + "»", 190), by: "tú" });
    return this.view(ruleId);
  }
  async clearSecret(ruleId) {
    if (this.hasSecret(ruleId)) await this.secrets.remove(secretName(ruleId));
    return this.view(ruleId);
  }
  async secret(ruleId) {
    if (!this.hasSecret(ruleId)) return null;
    try {
      return (await this.secrets.resolve([secretName(ruleId)], SECRET_HOST))[secretName(ruleId)] || null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- what you see
  view(ruleId) {
    const rec = this.record(ruleId);
    const relayUrl = this.relay();
    return {
      url: rec?.registered ? this.address(rec) : null,
      state: !relayUrl ? "sin-buzon" : rec?.revokedAt && !rec.hookId ? "revocada" : rec?.registered ? "lista" : "pendiente",
      error: !relayUrl ? "Los avisos de otras apps llegan por el buzón de Colmena, y ahora está apagado. Actívalo en Ajustes › Personas." : rec?.error || null,
      secret: this.hasSecret(ruleId), canKeepSecret: !!this.secrets?.available,
      rotatedAt: rec?.rotatedAt || null, revokedAt: rec?.revokedAt || null,
      deliveries: [...(rec?.deliveries || [])].reverse(),
    };
  }
  /** One line per request in «Últimos avisos»: when, what happened to it and why. Never its content. */
  logDelivery(ruleId, status, { detail = null, event = null, at = this.clock(), count = null } = {}) {
    if (!this.record(ruleId)) return;
    this.store.patch("webhooks", ruleId, (r) => ({
      deliveries: [...(r.deliveries || []), { at: new Date(at).toISOString(), status, ...(event ? { event: clip(event, 60) } : {}), ...(detail ? { detail: clip(detail, 160) } : {}), ...(count ? { count } : {}) }].slice(-WEBHOOK_LIMITS.deliveries),
    }));
  }

  // ---------------------------------------------------------------- receiving
  /** One sealed request from the mailbox. true = dealt with (or useless): it can be deleted there. */
  async receive(row) {
    let request;
    try {
      request = openHook(this.peers.identity, row.env);
    } catch {
      return true; // not sealed for this Colmena: nothing to do with it
    }
    // The mailbox delivers at least once (pushed and listed before the acknowledgement lands):
    // the same sealed copy a second time is not a second request.
    const copy = String(row.env?.n || "") + "|" + String(row.env?.epk || "");
    this.handled ||= new Set();
    if (this.handled.has(copy)) return true;
    this.handled.add(copy);
    if (this.handled.size > WEBHOOK_LIMITS.seen) this.handled.delete(this.handled.values().next().value);
    const rec = this.store.list("webhooks").find((r) => r.hookId && r.hookId === request.hook);
    const rule = rec ? this.store.get("automations", rec.id) : null;
    if (!rec || rule?.trigger?.type !== "webhook") return true; // an address you rotated or revoked
    const config = rule.trigger.config;
    const headers = request.headers && typeof request.headers === "object" ? request.headers : {};
    const at = Number(request.at) || this.clock();
    const eventType = cleanHeader(headers[String(config.cabeceraEvento || "").toLowerCase()] || "", 60) || null;
    try {
      // Refused by the mailbox before this one (too many in a minute, or too many waiting).
      if (Number(request.limited) > 0) this.logDelivery(rule.id, "limitado", { at, count: Number(request.limited), detail: "Llegaron demasiado seguidos y el buzón no los guardó" });
      const key = clip(String(request.key || ""), 260) || "sha256:" + createHash("sha256").update(String(request.body || "")).digest("hex");
      if ((rec.seen || []).includes(key)) {
        this.logDelivery(rule.id, "duplicado", { at, event: eventType, detail: "Ya había llegado" });
        return true;
      }
      const raw = Buffer.from(String(request.body || ""), "base64url");
      const signed = verifySignature(config, config.firma && config.firma !== "ninguna" ? await this.secret(rule.id) : null, { headers, raw, at });
      if (!signed.ok) {
        this.logDelivery(rule.id, "rechazado", { at, event: eventType, detail: signed.why });
        return true;
      }
      this.store.patch("webhooks", rule.id, (r) => ({ seen: [...(r.seen || []), key].slice(-WEBHOOK_LIMITS.seen) }));
      const body = bodyOf(raw, headers);
      const filtered = matchFilters(config, { headers, json: body.json });
      if (!filtered.ok) {
        this.logDelivery(rule.id, "filtrado", { at, event: eventType, detail: filtered.why });
        return true;
      }
      const preset = WEBHOOK_PRESETS[config.servicio] || WEBHOOK_PRESETS.generico;
      const title = preset.title ? cleanHeader(asText(jsonPath(body.json, preset.title)), 120) : "";
      const summary = preset.noun + (title ? ": " + title : eventType ? " (" + eventType + ")" : "");
      const subject = subjectOf(config, body.json);
      const out = this.enqueue(rule.id, {
        kind: "webhook", id: "aviso:" + createHash("sha256").update(key).digest("hex").slice(0, 24), at: new Date(at).toISOString(), summary,
        data: { servicio: preset.label, ...(eventType ? { tipo: eventType } : {}), ...(subject ? { asunto: subject } : {}), firma: signed.checked ? "comprobada" : "sin comprobar", cuerpo: body.cuerpo, ...(body.cortado ? { cortado: true } : {}) },
      }) || { status: "off" };
      const detail = { joined: "Sumado a un trabajo que seguía abierto", digest: "Llegan muchos seguidos: irá en un resumen", stopped: "La regla se ha parado por repetirse", chain: "Venía de una cadena de reglas", off: "La regla está en pausa" }[out.status] || null;
      this.logDelivery(rule.id, STATUS_TEXT[out.status] || "recibido", { at, event: eventType, detail });
    } catch (error) {
      this.log("Un aviso no se pudo atender: " + error.message);
      this.logDelivery(rule.id, "recibido", { at, event: eventType, detail: "No se pudo atender" });
    }
    return true;
  }
}

/** /api/webhooks and /api/automations/:id/webhook: the address, its secret, rotate, revoke, last requests. */
export function registerWebhookRoutes(app, { getWebhooks, store, check, z, HttpError }) {
  const service = () => {
    const w = getWebhooks();
    if (!w) throw new HttpError(503, "Los avisos de otras apps se están preparando. Prueba en unos segundos.");
    return w;
  };
  const rule = (req) => {
    const r = store.get("automations", req.params.id);
    if (!r) throw new HttpError(404, "Automatización no encontrada.");
    if (r.trigger?.type !== "webhook") throw new HttpError(409, "Esta rutina no se pone en marcha con un aviso de otra app.");
    return r;
  };
  const run = (fn) => async (req, res) => {
    try {
      res.json(await fn(service(), rule(req), req));
    } catch (error) {
      if (error instanceof WebhookError) throw new HttpError(error.status, error.message);
      throw error;
    }
  };
  app.get("/api/webhooks/presets", (_req, res) => res.json({
    presets: Object.entries(WEBHOOK_PRESETS).map(([id, p]) => ({ id, label: p.label, config: p.config, steps: p.steps })),
    signatures: Object.entries(SIGNATURE_LABELS).map(([id, label]) => ({ id, label })),
  }));
  app.get("/api/automations/:id/webhook", run(async (w, r) => {
    if (!w.record(r.id)?.registered && !w.record(r.id)?.revokedAt) await w.ensure(r.id).catch(() => null);
    return w.view(r.id);
  }));
  app.post("/api/automations/:id/webhook/rotate", run((w, r, req) => { check(z.object({}).strict(), req.body || {}); return w.rotate(r.id); }));
  app.post("/api/automations/:id/webhook/revoke", run((w, r, req) => { check(z.object({}).strict(), req.body || {}); return w.revoke(r.id); }));
  app.put("/api/automations/:id/webhook/secret", run((w, r, req) => {
    const { value } = check(z.object({ value: z.string().min(1, "Escribe el secreto.").max(4096) }).strict(), req.body);
    return w.setSecret(r.id, value.trim());
  }));
  app.delete("/api/automations/:id/webhook/secret", run((w, r) => w.clearSecret(r.id)));
}
