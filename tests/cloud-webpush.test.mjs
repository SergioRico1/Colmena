import test from "node:test";
import assert from "node:assert/strict";
import {
  generateVapidKeys,
  vapidAuthorization,
  encryptPayload,
  validSubscription,
  sendPush,
  b64urlEncode,
  b64urlDecode,
  MAX_PAYLOAD_BYTES,
} from "../server/cloud/webpush.mjs";

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

// A browser-like receiver: its own ECDH P-256 pair and a 16-byte auth secret.
async function makeReceiver() {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, keys: { p256dh: b64urlEncode(publicRaw), auth: b64urlEncode(auth) } };
}

async function importReceiverPrivate(dB64, publicB64) {
  const pub = b64urlDecode(publicB64);
  const jwk = { kty: "EC", crv: "P-256", d: dB64, x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33, 65)) };
  return subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

// The user agent side of RFC 8291, written independently of the sender.
async function decrypt(body, receiverPrivate, keys) {
  const salt = body.subarray(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16, false);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  const asKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, receiverPrivate, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info"), Uint8Array.of(0), uaPublic, asPublic, Uint8Array.of(1)));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm"), Uint8Array.of(0, 1)))).subarray(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce"), Uint8Array.of(0, 1)))).subarray(0, 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  assert.equal(padded[end], 2, "last record ends with delimiter 0x02");
  return { rs, idlen, asPublic, plaintext: padded.subarray(0, end) };
}

test("generateVapidKeys returns a 65-byte public point and a 32-byte private scalar", async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  const pub = b64urlDecode(publicKey);
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 0x04);
  assert.equal(b64urlDecode(privateKey).length, 32);
  assert.match(publicKey, /^[A-Za-z0-9_-]+$/);
});

test("encryptPayload round-trips through an independent RFC 8291 receiver", async () => {
  const receiver = await makeReceiver();
  const message = JSON.stringify({ title: "Hola", body: "ñ — ok" });
  const body = await encryptPayload(receiver.keys, message);
  const out = await decrypt(body, receiver.privateKey, receiver.keys);
  assert.equal(out.rs, 4096);
  assert.equal(out.idlen, 65);
  assert.equal(dec.decode(out.plaintext), message);
  assert.equal(body.length, 86 + enc.encode(message).length + 1 + 16);

  const bytes = await encryptPayload(receiver.keys, Uint8Array.of(1, 2, 3));
  assert.deepEqual([...(await decrypt(bytes, receiver.privateKey, receiver.keys)).plaintext], [1, 2, 3]);

  // A fresh salt and ephemeral key every time.
  const again = await encryptPayload(receiver.keys, message);
  assert.notDeepEqual(again.subarray(0, 86), body.subarray(0, 86));
});

test("encryptPayload enforces the size limit", async () => {
  const receiver = await makeReceiver();
  const max = await encryptPayload(receiver.keys, "x".repeat(MAX_PAYLOAD_BYTES));
  assert.equal(max.length, 4096);
  await assert.rejects(encryptPayload(receiver.keys, "x".repeat(MAX_PAYLOAD_BYTES + 1)), /over 3993/);
  await assert.rejects(encryptPayload({ p256dh: "AAAA", auth: receiver.keys.auth }, "x"), /p256dh/);
});

test("encryptPayload reproduces the RFC 8291 Appendix A vector", async () => {
  const vector = {
    plaintext: "When I grow up, I want to be a watermelon",
    asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    result:
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };
  const keys = { p256dh: vector.uaPublic, auth: vector.auth };
  const body = await encryptPayload(keys, vector.plaintext, {
    salt: vector.salt,
    localKeys: { publicKey: vector.asPublic, privateKey: vector.asPrivate },
  });
  assert.equal(b64urlEncode(body), vector.result);
  const receiverPrivate = await importReceiverPrivate(vector.uaPrivate, vector.uaPublic);
  const out = await decrypt(b64urlDecode(vector.result), receiverPrivate, keys);
  assert.equal(dec.decode(out.plaintext), vector.plaintext);
});

test("vapidAuthorization signs an ES256 JWT with aud, exp and sub", async () => {
  const keys = await generateVapidKeys();
  const now = Date.UTC(2026, 10, 14, 12, 0, 0);
  const header = await vapidAuthorization({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc:def",
    subject: "mailto:ops@example.com",
    ...keys,
    now,
  });
  const match = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(header);
  assert.ok(match, header);
  assert.equal(match[2], keys.publicKey);
  const [h, c, s] = match[1].split(".");
  assert.deepEqual(JSON.parse(dec.decode(b64urlDecode(h))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(dec.decode(b64urlDecode(c)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.exp, now / 1000 + 12 * 3600);
  assert.equal(claims.sub, "mailto:ops@example.com");

  const pub = await subtle.importKey("raw", b64urlDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signature = b64urlDecode(s);
  assert.equal(signature.length, 64);
  assert.equal(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, signature, enc.encode(`${h}.${c}`)), true);
  const tampered = enc.encode(`${h}.${c}x`);
  assert.equal(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, signature, tampered), false);

  await assert.rejects(vapidAuthorization({ endpoint: "https://fcm.googleapis.com/x", subject: "ops", ...keys }), /subject/);
});

test("validSubscription accepts only known push services over https", async () => {
  const { keys } = await makeReceiver();
  const ok = [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://other.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://web.push.apple.com/QGH",
    "https://api.push.apple.com/3/device/abc",
    "https://FCM.googleapis.com/fcm/send/abc",
  ];
  for (const endpoint of ok) {
    const sub = validSubscription({ endpoint, keys });
    assert.ok(sub, endpoint);
    assert.deepEqual(sub.keys, keys);
  }
  const bad = [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://evil.example/",
    "https://fcm.googleapis.com.evil.example/",
    "https://evilnotify.windows.com/",
    "https://push.services.mozilla.com/",
    "https://.push.apple.com/",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://fcm.googleapis.com/" + "a".repeat(1024),
    "not a url",
    "",
  ];
  for (const endpoint of bad) assert.equal(validSubscription({ endpoint, keys }), null, endpoint);

  const endpoint = ok[0];
  assert.equal(validSubscription(null), null);
  assert.equal(validSubscription({ endpoint }), null);
  assert.equal(validSubscription({ endpoint, keys: { p256dh: keys.p256dh } }), null);
  assert.equal(validSubscription({ endpoint, keys: { ...keys, auth: b64urlEncode(new Uint8Array(15)) } }), null);
  assert.equal(validSubscription({ endpoint, keys: { ...keys, p256dh: b64urlEncode(new Uint8Array(64)) } }), null);
  const notUncompressed = b64urlDecode(keys.p256dh);
  notUncompressed[0] = 0x02;
  assert.equal(validSubscription({ endpoint, keys: { ...keys, p256dh: b64urlEncode(notUncompressed) } }), null);
  assert.equal(validSubscription({ endpoint, keys: { ...keys, auth: "!!not base64!!" } }), null);
});

test("sendPush posts an encrypted, VAPID-signed request and maps statuses", async () => {
  const receiver = await makeReceiver();
  const vapid = { subject: "https://example.com/contact", ...(await generateVapidKeys()) };
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: receiver.keys };
  const calls = [];
  let status = 201;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status });
  };

  const sent = await sendPush({ subscription, payload: { title: "Hi", n: 1 }, vapid, topic: "chat-1", fetchImpl });
  assert.deepEqual(sent, { ok: true, status: 201, gone: false });
  const { url, init } = calls[0];
  assert.equal(url, subscription.endpoint);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(init.headers["Content-Type"], "application/octet-stream");
  assert.equal(init.headers.TTL, "86400");
  assert.equal(init.headers.Urgency, "high");
  assert.equal(init.headers.Topic, "chat-1");
  assert.match(init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  const json = JSON.stringify({ title: "Hi", n: 1 });
  assert.equal(init.body.length, 86 + json.length + 1 + 16);
  assert.equal(dec.decode((await decrypt(init.body, receiver.privateKey, receiver.keys)).plaintext), json);

  status = 410;
  assert.deepEqual(await sendPush({ subscription, payload: "x", vapid, ttl: 60, urgency: "low", fetchImpl }), { ok: false, status: 410, gone: true });
  assert.equal(calls[1].init.headers.TTL, "60");
  assert.equal(calls[1].init.headers.Urgency, "low");
  assert.equal("Topic" in calls[1].init.headers, false);
  status = 404;
  assert.equal((await sendPush({ subscription, payload: "x", vapid, fetchImpl })).gone, true);
  status = 429;
  assert.deepEqual(await sendPush({ subscription, payload: "x", vapid, fetchImpl }), { ok: false, status: 429, gone: false });

  const count = calls.length;
  await assert.rejects(sendPush({ subscription: { ...subscription, endpoint: "https://evil.example/" }, payload: "x", vapid, fetchImpl }), /invalid push subscription/);
  await assert.rejects(sendPush({ subscription, payload: "x", vapid, topic: "has space", fetchImpl }), /topic/);
  await assert.rejects(sendPush({ subscription, payload: "x", vapid, topic: "a".repeat(33), fetchImpl }), /topic/);
  assert.equal(calls.length, count, "nothing is sent for refused input");
});

test("sendPush aborts after timeoutMs", async () => {
  const receiver = await makeReceiver();
  const vapid = { subject: "mailto:ops@example.com", ...(await generateVapidKeys()) };
  const subscription = { endpoint: "https://web.push.apple.com/QGH", keys: receiver.keys };
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await assert.rejects(sendPush({ subscription, payload: "x", vapid, fetchImpl, timeoutMs: 20 }), /aborted/);
});
