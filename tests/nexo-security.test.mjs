import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  pkce,
  authorizeURL,
  verifyIDToken,
  normalizeModels,
  validateInference,
  equal,
  trustedAuthEndpoint,
  ISSUER,
} from "../server/nexo/security.mjs";
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const now = Math.floor(Date.now() / 1000),
  base = {
    iss: ISSUER,
    aud: "oaiapp-test",
    sub: "subject-1",
    nonce: "nonce-1",
    iat: now,
    exp: now + 300,
  };
function makeJWT(claims = base, alg = "RS256", keys = rsa) {
  const h = Buffer.from(JSON.stringify({ alg, kid: "test" })).toString(
      "base64url",
    ),
    b = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = sign(
    "sha256",
    Buffer.from(h + "." + b),
    alg === "ES256"
      ? { key: keys.privateKey, dsaEncoding: "ieee-p1363" }
      : keys.privateKey,
  );
  return h + "." + b + "." + sig.toString("base64url");
}
const jwks = {
    keys: [
      {
        ...rsa.publicKey.export({ format: "jwk" }),
        kid: "test",
        use: "sig",
        alg: "RS256",
      },
    ],
  },
  opts = { clientId: "oaiapp-test", nonce: "nonce-1", now };
test("PKCE uses fresh high-entropy verifiers with S256", () => {
  const a = pkce(),
    b = pkce();
  assert.notEqual(a.verifier, b.verifier);
  assert.equal(
    a.challenge,
    createHash("sha256").update(a.verifier).digest("base64url"),
  );
  assert.ok(a.verifier.length >= 43);
});
test("registration uses dynamic client, exact loopback, resource and plan scope", () => {
  const u = new URL(
    authorizeURL({
      hostId: "urn:uuid:12345678-1234-4123-8123-123456789abc",
      redirectURI: "http://127.0.0.1:1234/auth/callback",
      state: "s",
      nonce: "n",
      challenge: "c",
    }),
  );
  assert.equal(u.origin, ISSUER);
  assert.equal(u.searchParams.get("client_id"), "dynamic_agent_client");
  assert.ok(u.searchParams.get("scope").includes("chatgpt.tokens.use.direct"));
  assert.equal(
    u.searchParams.get("redirect_uri"),
    "http://127.0.0.1:1234/auth/callback",
  );
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
});
test("returning sign-in reuses issued client and omits name hint", () => {
  const u = new URL(
    authorizeURL({
      hostId: "urn:uuid:12345678-1234-4123-8123-123456789abc",
      clientId: "oaiapp-test",
      redirectURI: "http://127.0.0.1:1/auth/callback",
      state: "s",
      nonce: "n",
      challenge: "c",
    }),
  );
  assert.equal(u.searchParams.get("client_id"), "oaiapp-test");
  assert.equal(u.searchParams.has("agent_name_hint"), false);
});
test("RS256 ID token is verified with known issuer key", () =>
  assert.equal(verifyIDToken(makeJWT(), jwks, opts).sub, "subject-1"));
test("ES256 ID token is verified using JOSE raw signature encoding", () => {
  const jwksEC = {
    keys: [
      { ...ec.publicKey.export({ format: "jwk" }), kid: "test", alg: "ES256" },
    ],
  };
  assert.equal(
    verifyIDToken(makeJWT(base, "ES256", ec), jwksEC, opts).sub,
    "subject-1",
  );
});
test("nonce mismatch rejected", () =>
  assert.throws(() =>
    verifyIDToken(makeJWT(), jwks, { ...opts, nonce: "wrong" }),
  ));
test("signature tampering rejected", () => {
  const t = makeJWT().split(".");
  t[1] = Buffer.from(JSON.stringify({ ...base, sub: "attacker" })).toString(
    "base64url",
  );
  assert.throws(() => verifyIDToken(t.join("."), jwks, opts));
});
test("expired tokens rejected", () =>
  assert.throws(() =>
    verifyIDToken(makeJWT({ ...base, exp: now - 60 }), jwks, opts),
  ));
test("other client, issuer or subject rejected", () => {
  for (const claims of [
    { ...base, aud: "other" },
    { ...base, iss: "https://evil.example" },
  ])
    assert.throws(() => verifyIDToken(makeJWT(claims), jwks, opts));
  assert.throws(() =>
    verifyIDToken(makeJWT(), jwks, { ...opts, subject: "another" }),
  );
});
test("algorithm none/HS256 rejected", () => {
  for (const alg of ["none", "HS256"]) {
    const header = Buffer.from(JSON.stringify({ alg, kid: "test" })).toString(
      "base64url",
    );
    const token =
      header +
      "." +
      Buffer.from(JSON.stringify(base)).toString("base64url") +
      ".AAAA";
    assert.throws(() => verifyIDToken(token, jwks, opts));
  }
});
test("discovery cannot redirect token operations to an arbitrary issuer", () => {
  assert.equal(
    trustedAuthEndpoint(ISSUER + "/oauth/revoke"),
    ISSUER + "/oauth/revoke",
  );
  assert.throws(() => trustedAuthEndpoint("https://attacker.example/revoke"));
  assert.throws(() =>
    trustedAuthEndpoint("https://user:pw@auth.openai.com/revoke"),
  );
});
test("only visible model slugs are offered", () => {
  assert.deepEqual(
    normalizeModels({
      models: [
        { slug: "private", visibility: "hidden" },
        { slug: "public", display_name: "Public", visibility: "list" },
      ],
    }),
    [{ slug: "public", display_name: "Public", reasoning_efforts: [] }],
  );
  assert.throws(() => normalizeModels({ data: [] }));
});
test("inference rejects models outside current account catalog", () =>
  assert.throws(() =>
    validateInference({ model: "invented", prompt: "hi", context: {} }, [
      { slug: "available" },
    ]),
  ));
test("inference keeps source example flags and rejects executable images", () => {
  const base = {
    model: "m",
    prompt: "Hi",
    context: {
      sources: [{ title: "Test", text: "Content", example: true }],
      observations: [],
    },
  };
  assert.equal(
    validateInference(base, [{ slug: "m" }]).context.sources[0].example,
    true,
  );
  assert.throws(() =>
    validateInference(
      { ...base, context: { image: "data:image/svg+xml,<svg/>" } },
      [{ slug: "m" }],
    ),
  );
});
test("context hard limits prevent uncontrolled uploads", () => {
  assert.throws(() =>
    validateInference({ model: "m", prompt: "x".repeat(12001), context: {} }, [
      { slug: "m" },
    ]),
  );
  assert.throws(() =>
    validateInference(
      {
        model: "m",
        prompt: "hi",
        context: { sources: new Array(31).fill({ title: "x", text: "x" }) },
      },
      [{ slug: "m" }],
    ),
  );
});
test("constant-time compare handles mismatched lengths safely", () => {
  assert.equal(equal("a", "a"), true);
  assert.equal(equal("a", "bb"), false);
  assert.equal(equal(null, "x"), false);
});
