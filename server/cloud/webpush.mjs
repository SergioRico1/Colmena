// Web Push sender with no dependencies: VAPID (RFC 8292) and aes128gcm payload encryption
// (RFC 8291 + RFC 8188), built only on WebCrypto, TextEncoder and atob/btoa so it runs
// unchanged in Node and in the Cloudflare Worker / Durable Object runtime.
//
// The server only ever POSTs to the push services listed in PUSH_HOSTS: validSubscription()
// is the SSRF guard, and sendPush() refuses anything it rejects.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

// Largest plaintext that fits one 4096-byte record together with the 86-byte header
// (salt 16 + rs 4 + idlen 1 + key 65), the padding delimiter and the 16-byte GCM tag.
export const MAX_PAYLOAD_BYTES = 3993;
const RECORD_SIZE = 4096;

const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

// ---------- bytes and base64url ----------

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return enc.encode(value);
  throw new TypeError("expected a string or bytes");
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function b64urlEncode(bytes) {
  const b = toBytes(bytes);
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Strict: only the base64url alphabet (optional trailing padding); anything else is null.
export function b64urlDecode(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null;
  const s = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (s.length % 4 === 1) return null;
  try {
    const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function keyBytes(value, length, what) {
  const bytes = typeof value === "string" ? b64urlDecode(value) : value instanceof Uint8Array ? value : null;
  if (!bytes || bytes.length !== length) throw new Error(`invalid ${what}`);
  return bytes;
}

// ---------- P-256 keys ----------

function publicJwk(raw) {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("invalid P-256 public key");
  return { kty: "EC", crv: "P-256", x: b64urlEncode(raw.subarray(1, 33)), y: b64urlEncode(raw.subarray(33, 65)), ext: true };
}

function importPrivate(d, publicRaw, algorithm, usages) {
  return subtle.importKey("jwk", { ...publicJwk(publicRaw), d: b64urlEncode(d) }, algorithm, false, usages);
}

export async function generateVapidKeys() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64urlEncode(publicKey), privateKey: jwk.d };
}

// ---------- VAPID (RFC 8292) ----------

export async function vapidAuthorization({ endpoint, subject, publicKey, privateKey, expiresIn = 12 * 3600, now = Date.now() }) {
  const aud = new URL(endpoint).origin;
  if (typeof subject !== "string" || !/^(mailto:\S+|https:\/\/\S+)$/.test(subject)) {
    throw new Error("VAPID subject must be a mailto: or https: URL");
  }
  // Push services refuse tokens that expire more than 24 hours ahead.
  const seconds = Math.min(Math.max(60, Math.floor(expiresIn)), 24 * 3600);
  const pub = keyBytes(publicKey, 65, "VAPID public key");
  const d = keyBytes(privateKey, 32, "VAPID private key");
  const header = b64urlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64urlEncode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + seconds, sub: subject }));
  const unsigned = `${header}.${claims}`;
  const key = await importPrivate(d, pub, { name: "ECDSA", namedCurve: "P-256" }, ["sign"]);
  // WebCrypto ECDSA signatures are already raw r||s, which is what JWS ES256 wants.
  const signature = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${b64urlEncode(pub)}`;
}

// ---------- payload encryption (RFC 8291 / RFC 8188 aes128gcm) ----------

async function hmac(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

// `options` is for tests only (reproducing the RFC 8291 Appendix A vector):
// { salt: Uint8Array(16) | base64url, localKeys: { publicKey, privateKey } } where the
// local keys are the raw 65-byte point and the 32-byte `d`, as bytes or base64url.
export async function encryptPayload({ p256dh, auth }, payload, options = {}) {
  const plaintext = toBytes(payload);
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error(`push payload over ${MAX_PAYLOAD_BYTES} bytes`);
  const uaPublic = keyBytes(p256dh, 65, "p256dh key");
  const authSecret = keyBytes(auth, 16, "auth secret");
  const salt = options.salt ? keyBytes(options.salt, 16, "salt") : crypto.getRandomValues(new Uint8Array(16));

  let asPrivate;
  let asPublic;
  if (options.localKeys) {
    asPublic = keyBytes(options.localKeys.publicKey, 65, "local public key");
    asPrivate = await importPrivate(keyBytes(options.localKeys.privateKey, 32, "local private key"), asPublic, { name: "ECDH", namedCurve: "P-256" }, ["deriveBits"]);
  } else {
    const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  }

  const uaKey = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, Uint8Array.of(1));
  const ikm = await hmac(prkKey, keyInfo);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode("Content-Encoding: aes128gcm\0\x01"))).subarray(0, 16);
  const nonce = (await hmac(prk, enc.encode("Content-Encoding: nonce\0\x01"))).subarray(0, 12);

  const aesKey = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(plaintext, Uint8Array.of(2)); // single, last record: delimiter 0x02
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ---------- subscriptions (SSRF guard) ----------

function knownPushHost(hostname) {
  const host = hostname.toLowerCase();
  if (PUSH_HOSTS.includes(host)) return true;
  return PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

export function validSubscription(sub) {
  if (!sub || typeof sub !== "object") return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 1024) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!knownPushHost(url.hostname)) return null;
  if (!keys || typeof keys !== "object" || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  const p256dh = b64urlDecode(keys.p256dh);
  const auth = b64urlDecode(keys.auth);
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 0x04) return null;
  if (!auth || auth.length !== 16) return null;
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// ---------- sending ----------

const URGENCIES = new Set(["very-low", "low", "normal", "high"]);

export async function sendPush({ subscription, payload, vapid, ttl = 86400, urgency = "high", topic = null, fetchImpl = fetch, timeoutMs = 10000 }) {
  const sub = validSubscription(subscription);
  if (!sub) throw new Error("invalid push subscription");
  if (!vapid || !vapid.subject || !vapid.publicKey || !vapid.privateKey) throw new Error("missing VAPID keys");
  if (!URGENCIES.has(urgency)) throw new Error("invalid push urgency");
  if (topic != null && (typeof topic !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(topic))) {
    throw new Error("push topic must be 1-32 base64url characters");
  }
  const data = payload == null ? "" : typeof payload === "string" || payload instanceof Uint8Array ? payload : JSON.stringify(payload);
  const body = await encryptPayload(sub.keys, data);
  const headers = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(Math.max(0, Math.floor(Number(ttl) || 0))),
    Urgency: urgency,
    Authorization: await vapidAuthorization({ endpoint: sub.endpoint, ...vapid }),
  };
  if (topic != null) headers.Topic = topic;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(sub.endpoint, { method: "POST", headers, body, redirect: "manual", signal: controller.signal });
    const status = res.status;
    // Drain the body so the connection can be reused; its content is not needed.
    try {
      await res.arrayBuffer?.();
    } catch {
      // ignore
    }
    return { ok: status >= 200 && status < 300, status, gone: status === 404 || status === 410 };
  } finally {
    clearTimeout(timer);
  }
}
