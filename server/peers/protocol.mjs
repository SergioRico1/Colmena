// Colmena ⇄ Colmena wire protocol (modelled on OpenClaw's Reef, MIT): every install has an
// Ed25519 signing key (its address) and an X25519 box key. A message is a sealed envelope
// {v, id, from, to, ts, epk, n, ct, sig}: an ephemeral X25519 key agrees a secret with the
// recipient's box key, HKDF-SHA256 turns it into an AES-256-GCM key, and the sender signs the
// whole envelope. The mailbox (relay/server.mjs) only stores and forwards envelopes: it can
// see who writes to whom, when and how much, never the content.
// Pure node:crypto, shared by the Colmena server and the mailbox.
import {
  createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign, verify, timingSafeEqual,
} from "node:crypto";

export const PROTOCOL = 1;
export const MAX_PLAINTEXT = 48 * 1024;
export const MAX_ENVELOPE = 72 * 1024;
export const MAX_AGE_S = 30 * 24 * 3600;
export const MAX_SKEW_S = 300;
const ADDRESS_RE = /^[A-Za-z0-9_-]{43}$/;
const B64_RE = /^[A-Za-z0-9+/=_-]+$/;

export const b64u = (buf) => Buffer.from(buf).toString("base64url");
export const fromB64u = (s) => Buffer.from(String(s), "base64url");
export const sha256 = (data) => createHash("sha256").update(data).digest();
export const isAddress = (s) => typeof s === "string" && ADDRESS_RE.test(s);

/** Stable JSON (sorted keys): what is signed must serialize the same on both ends. */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

// ------------------------------------------------------------------ keys
/** A new identity: { sign: {pub, priv}, box: {pub, priv} }, raw keys in base64url. */
export function newIdentity() {
  const s = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  const x = generateKeyPairSync("x25519").privateKey.export({ format: "jwk" });
  return { sign: { pub: s.x, priv: s.d }, box: { pub: x.x, priv: x.d } };
}
const signPriv = (k) => createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: k.pub, d: k.priv }, format: "jwk" });
const signPub = (x) => createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
const boxPriv = (k) => createPrivateKey({ key: { kty: "OKP", crv: "X25519", x: k.pub, d: k.priv }, format: "jwk" });
const boxPub = (x) => createPublicKey({ key: { kty: "OKP", crv: "X25519", x }, format: "jwk" });

export function validIdentity(id) {
  try {
    const probe = Buffer.from("colmena");
    if (!verify(null, probe, signPub(id.sign.pub), sign(null, probe, signPriv(id.sign)))) return false;
    diffieHellman({ privateKey: boxPriv(id.box), publicKey: boxPub(id.box.pub) });
    return isAddress(id.sign.pub) && isAddress(id.box.pub);
  } catch {
    return false;
  }
}

export const signBytes = (key, data) => b64u(sign(null, Buffer.from(data), signPriv(key)));
export function verifyBytes(address, data, sig) {
  try {
    return isAddress(address) && verify(null, Buffer.from(data), signPub(address), fromB64u(sig));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ envelopes
export class ProtocolError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

function envelopeKey(shared, epk, toBox, from, to) {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([fromB64u(epk), fromB64u(toBox)]), Buffer.from(`colmena-sobre-v1|${from}|${to}`), 32));
}

/** Seals `body` (a JSON object) from `identity` to `to` (address) with its box key `toBox`. */
export function seal(identity, { to, toBox, body, id = randomUUID(), ts = Math.floor(Date.now() / 1000) }) {
  if (!isAddress(to) || !isAddress(toBox)) throw new ProtocolError("malformed", "Destinatario no válido.");
  const plaintext = Buffer.from(JSON.stringify(body));
  if (plaintext.length > MAX_PLAINTEXT) throw new ProtocolError("too_large", "El mensaje es demasiado grande.");
  const eph = generateKeyPairSync("x25519");
  const epk = eph.publicKey.export({ format: "jwk" }).x;
  const from = identity.sign.pub;
  const key = envelopeKey(diffieHellman({ privateKey: eph.privateKey, publicKey: boxPub(toBox) }), epk, toBox, from, to);
  const n = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, n);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const unsigned = { v: PROTOCOL, id, from, to, ts, epk, n: b64u(n), ct: b64u(ct) };
  return { ...unsigned, sig: signBytes(identity.sign, canonical(unsigned)) };
}

/** Checks the shape and the signature (the sender's address is its signing key). */
export function checkEnvelope(env, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!env || typeof env !== "object") throw new ProtocolError("malformed");
  const { v, id, from, to, ts, epk, n, ct, sig } = env;
  if (v !== PROTOCOL) throw new ProtocolError("version", "Versión del protocolo no compatible.");
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(id) || !isAddress(from) || !isAddress(to) || !Number.isSafeInteger(ts) || !isAddress(epk)) throw new ProtocolError("malformed");
  if (![n, ct, sig].every((x) => typeof x === "string" && B64_RE.test(x))) throw new ProtocolError("malformed");
  if (JSON.stringify(env).length > MAX_ENVELOPE) throw new ProtocolError("too_large");
  if (ts > now + MAX_SKEW_S || ts < now - MAX_AGE_S) throw new ProtocolError("expired", "Mensaje caducado o con la hora mal.");
  const { sig: _s, ...unsigned } = env;
  if (!verifyBytes(from, canonical(unsigned), sig)) throw new ProtocolError("bad_signature", "Firma no válida.");
  return env;
}

/** Verifies and opens an envelope addressed to `identity`; returns the body. */
export function open(identity, env, opts = {}) {
  checkEnvelope(env, opts);
  if (env.to !== identity.sign.pub) throw new ProtocolError("wrong_recipient");
  try {
    const key = envelopeKey(diffieHellman({ privateKey: boxPriv(identity.box), publicKey: boxPub(env.epk) }), env.epk, identity.box.pub, env.from, env.to);
    const data = fromB64u(env.ct);
    const decipher = createDecipheriv("aes-256-gcm", key, fromB64u(env.n));
    decipher.setAuthTag(data.subarray(data.length - 16));
    const plaintext = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
    if (plaintext.length > MAX_PLAINTEXT) throw new ProtocolError("too_large");
    const body = JSON.parse(plaintext.toString("utf8"));
    if (!body || typeof body !== "object" || typeof body.type !== "string") throw new ProtocolError("malformed");
    return body;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("malformed", "No se pudo abrir el mensaje.");
  }
}

// ------------------------------------------------------------------ mailbox requests
// Every request to the mailbox is signed: «Colmena <address>.<ts>.<nonce>.<sig>» over
// method, path, time, nonce and the body hash. No accounts, no passwords.
export function authHeader(identity, method, path, body = "", ts = Math.floor(Date.now() / 1000)) {
  const nonce = b64u(randomBytes(12));
  const line = [method.toUpperCase(), path, ts, nonce, b64u(sha256(body))].join("\n");
  return `Colmena ${identity.sign.pub}.${ts}.${nonce}.${signBytes(identity.sign, line)}`;
}
/** → { address, nonce } or null. */
export function checkAuth(header, method, path, body = "", now = Math.floor(Date.now() / 1000)) {
  const m = /^Colmena ([A-Za-z0-9_-]{43})\.(\d{1,12})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{86})$/.exec(String(header || ""));
  if (!m) return null;
  const [, address, tsText, nonce, sig] = m;
  const ts = Number(tsText);
  if (Math.abs(now - ts) > MAX_SKEW_S) return null;
  const line = [method.toUpperCase(), path, ts, nonce, b64u(sha256(body))].join("\n");
  return verifyBytes(address, line, sig) ? { address, nonce, ts } : null;
}

// ------------------------------------------------------------------ safety words
// Four words both people see the same: they come from the two addresses, sorted. If they
// match when you read them to each other, nobody is in the middle.
export const WORDS = (
  "abeja acera agua aguja ala alba alga alma almendra amapola ancla anillo antena araña árbol arco arena " +
  "arroz avena azúcar bahía balsa banco barca barro bellota bisonte bosque botón brisa brújula búho caballo " +
  "cabra cacao café caja calma cama campana canela caracol carbón casa castaña cebra cereza chispa cielo " +
  "cine ciruela ciudad clavo cobre cofre cohete colina cometa concha copa coral cordero corona cuerda cueva " +
  "dado delfín diente dragón duna eco encina erizo escoba espiga estrella faro feria flauta flor foca fresa " +
  "fruta fuego fuente gacela galleta garza gato gaviota girasol globo gota grano grillo grulla guante haba " +
  "hada halcón harina helecho hielo higo hoja hormiga huerto huevo humo iglú imán isla jarra jazmín jirafa " +
  "joya junco koala lago lámpara lana lápiz laurel lechuza lente león libro lima limón lince lino llama " +
  "llave lluvia lobo loro luna madera maíz mango manta manzana mapa mar marfil margarita melón menta mesa " +
  "miel mimbre mirlo molino mono montaña mora muelle mundo nácar naranja nido niebla nieve noche nogal nube " +
  "nuez oasis ola olivo onda oro oso otoño oveja pájaro paloma pan panda papel parque pato pera perla " +
  "piano piedra pino pluma polen pomelo potro puente puerto pulpo queso rama rana rayo red regla reloj " +
  "remo río roble roca rosa rubí sal salmón sauce selva semilla seta sierra silla sol sombrero tambor " +
  "taza té tejado tela tierra tigre tomate topo torre trébol trigo trompeta tulipán uva vaca valle vela " +
  "verano vidrio viento violín volcán yate yegua yema yeso yogur zafiro zanahoria zapato zorro " +
  "ámbar ballena grifo hogar kiwi nutria plátano"
).split(" ");

export function safetyWords(a, b) {
  const digest = sha256("colmena-palabras-v1|" + [a, b].sort().join("|"));
  // Four different words: a repeated one would be easy to mishear as a match.
  const out = [];
  for (const byte of digest) {
    if (!out.includes(WORDS[byte])) out.push(WORDS[byte]);
    if (out.length === 4) break;
  }
  return out;
}

// ------------------------------------------------------------------ invitations
// A code shown as COLMENA-XXXX-XXXX-XXXX-XXXX (80 random bits, Crockford base32). The inviter
// leaves an encrypted card at the mailbox under a lookup derived from the code; only someone
// with the code finds it and can read it. It works once and expires in 24 hours.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newInviteCode() {
  const bytes = randomBytes(10);
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out; // 16 characters
}
export const formatInviteCode = (code) => "COLMENA-" + code.match(/.{4}/g).join("-");
/** «colmena-7kq4 pz2v…», with or without dashes, I/L→1, O→0 → the 16 characters, or null. */
export function parseInviteCode(text) {
  const raw = String(text || "").toUpperCase().replace(/^\s*COLMENA[\s-]*/, "").replace(/[\s-]+/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(raw) ? raw : null;
}
export const inviteLookup = (code) => b64u(sha256("colmena-invitacion-buscar|" + code)).slice(0, 32);
const inviteKey = (code) => Buffer.from(hkdfSync("sha256", Buffer.from(code), Buffer.alloc(0), Buffer.from("colmena-invitacion-clave-v1"), 32));
export function sealInvite(code, card) {
  const n = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", inviteKey(code), n);
  const ct = Buffer.concat([cipher.update(JSON.stringify(card)), cipher.final(), cipher.getAuthTag()]);
  return b64u(n) + "." + b64u(ct);
}
export function openInvite(code, blob) {
  try {
    const [n, ct] = String(blob).split(".");
    const data = fromB64u(ct);
    const decipher = createDecipheriv("aes-256-gcm", inviteKey(code), fromB64u(n));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}
/** Proof that whoever says hello holds the code (bound to both addresses). */
export const inviteProof = (code, from, to) => b64u(createHmac("sha256", inviteKey(code)).update(`colmena-hola|${from}|${to}`).digest());
export function sameProof(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
