// Webhooks through the mailbox: a service that cannot reach a Colmena on someone's desk (GitHub,
// Sentry, Stripe…) POSTs to a secret address here; the body is sealed to that Colmena's box
// key the moment it arrives and waits in its mailbox, like any other envelope, until it is
// delivered (or HOOK_LIMITS.keepHours pass). Shared by the Cloudflare Worker (worker.js) and
// the Node mailbox (relay/server.mjs): only WebCrypto, no imports.
//
//   PUT    /v1/hooks/:id {box}   signed by the owner: «what arrives at /h/:id is for me»
//   DELETE /v1/hooks/:id         signed by the owner: the address stops existing
//   POST   /h/:id                anyone who has the address (256 KB at most)
//
// What the mailbox sees: the request in transit (it terminates TLS), never afterwards — it
// keeps only the sealed copy, and it never has the shared secret a service signs with: the
// signature is checked in Colmena, over the exact bytes that arrived.
export const HOOK_LIMITS = Object.freeze({
  body: 256 * 1024, // bytes of one request
  perMinute: 60, // requests per address and minute
  queue: 100, // sealed requests of one address waiting for its Colmena
  keepHours: 72, // undelivered ones are dropped after this
  headers: 40, headerChars: 1024,
  registrationsPerMinute: 30,
});
/** 32 random bytes in base64url: the unguessable part of the address (256 bits). */
export const HOOK_ID = /^[A-Za-z0-9_-]{43}$/;
const BOX = /^[A-Za-z0-9_-]{43}$/;
const enc = new TextEncoder();

const b64u = (bytes) => {
  const a = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export const validBox = (box) => typeof box === "string" && BOX.test(box);

// Headers a filter or a signature check may need. Nothing about who called or how it was
// routed (addresses, cookies, credentials, proxy headers) is kept.
const DROP = /^(?:cookie|set-cookie|authorization|proxy-|cf-|x-forwarded-|x-real-ip|forwarded|via|host|connection|content-length|accept-encoding|transfer-encoding|true-client-ip|cdn-loop|x-amzn-|x-request-start)/;
/** [[name, value]…] → {name: value} in lower case, a few and short. */
export function pickHeaders(entries) {
  const out = {};
  let n = 0;
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName).toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(name) || DROP.test(name)) continue;
    if (n++ >= HOOK_LIMITS.headers) break;
    out[name] = String(rawValue).slice(0, HOOK_LIMITS.headerChars);
  }
  return out;
}

/**
 * What makes two requests «the same delivery»: the id the service gives it (Idempotency-Key,
 * X-GitHub-Delivery, webhook-id), else the hash of the body.
 */
export async function dedupeKey(headers, bytes) {
  for (const name of ["idempotency-key", "x-github-delivery", "webhook-id"]) {
    const value = String(headers[name] || "").trim();
    if (value) return name + ":" + value.slice(0, 200);
  }
  return "sha256:" + hex(await sha256(bytes));
}

/** The mailbox row of a delivery: the same delivery twice is one row while it waits. */
export async function rowId(hook, key) {
  return "h-" + b64u(await sha256(hook + "|" + key)).slice(0, 40);
}

/**
 * Seals `payload` (JSON) to the box key of the hook's owner: an ephemeral X25519 key agrees a
 * secret, HKDF-SHA256 turns it into an AES-256-GCM key bound to the hook and its owner. Only
 * that Colmena opens it (server/peers/protocol.mjs openHook). → {v, hook, epk, n, ct}.
 */
export async function sealHook({ hook, owner, box }, payload) {
  const eph = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const boxBytes = fromB64u(box);
  const to = await crypto.subtle.importKey("raw", boxBytes, { name: "X25519" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: to }, eph.privateKey, 256);
  const salt = new Uint8Array(epk.length + boxBytes.length);
  salt.set(epk, 0);
  salt.set(boxBytes, epk.length);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const keyBits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`colmena-aviso-v1|${hook}|${owner}`) }, material, 256);
  const key = await crypto.subtle.importKey("raw", keyBits, { name: "AES-GCM" }, false, ["encrypt"]);
  const n = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: n }, key, enc.encode(JSON.stringify(payload)));
  return { v: 1, hook, epk: b64u(epk), n: b64u(n), ct: b64u(ct) };
}

/**
 * One incoming request, ready for the mailbox: {id, key, sealed}. `hook` is {id, owner, box};
 * `limited` is how many requests were refused (429) since the last one that got through, so
 * Colmena can show them in the trigger's deliveries.
 */
export async function sealRequest(hook, { method, headers, bytes, at = Date.now(), limited = 0 }) {
  const picked = pickHeaders(headers);
  const key = await dedupeKey(picked, bytes);
  const sealed = await sealHook({ hook: hook.id, owner: hook.owner, box: hook.box }, {
    v: 1, hook: hook.id, at, key, method: String(method || "POST").toUpperCase(), headers: picked, body: b64u(bytes), ...(limited ? { limited } : {}),
  });
  return { id: await rowId(hook.id, key), key, sealed };
}
