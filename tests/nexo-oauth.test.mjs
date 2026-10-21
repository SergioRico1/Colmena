import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { ChatGPTSession } from "../server/nexo/oauth.mjs";
import {
  ISSUER,
  DISCOVERY,
  TOKEN_ENDPOINT,
  SCOPES,
} from "../server/nexo/security.mjs";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
function jwt(nonce) {
  const now = Math.floor(Date.now() / 1000),
    h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "key" })).toString(
      "base64url",
    ),
    b = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: "oaiapp-test",
        sub: "subject",
        email: "test@example.invalid",
        nonce,
        iat: now,
        exp: now + 300,
      }),
    ).toString("base64url");
  return (
    h +
    "." +
    b +
    "." +
    sign("sha256", Buffer.from(h + "." + b), keys.privateKey).toString(
      "base64url",
    )
  );
}
test("local OAuth callback validates state, issued ID, nonce and scope; persists no tokens", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nexo-test-"));
  const events = [],
    requests = [];
  let nonce;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === DISCOVERY)
      return Response.json({
        issuer: ISSUER,
        jwks_uri: ISSUER + "/keys",
        revocation_endpoint: ISSUER + "/revoke",
      });
    if (url === ISSUER + "/keys")
      return Response.json({
        keys: [
          {
            ...keys.publicKey.export({ format: "jwk" }),
            kid: "key",
            alg: "RS256",
          },
        ],
      });
    if (url === TOKEN_ENDPOINT)
      return Response.json({
        id_token: jwt(nonce),
        access_token: "ACCESS_TEST_ONLY",
        refresh_token: "REFRESH_TEST_ONLY",
        token_type: "Bearer",
        scope: SCOPES,
        expires_in: 3600,
      });
    throw Error("Unexpected URL");
  };
  const session = new ChatGPTSession({
    directory,
    fetchImpl,
    emit: (e) => events.push(e),
  });
  try {
    const start = await session.start(),
      u = new URL(start.url);
    nonce = u.searchParams.get("nonce");
    const redirect = u.searchParams.get("redirect_uri"),
      bad = await fetch(
        redirect + "?state=wrong&code=bad&client_id=oaiapp-test",
      );
    assert.equal(bad.status, 400);
    assert.equal(session.status(), null);
    const ok = await fetch(
      redirect +
        "?" +
        new URLSearchParams({
          state: u.searchParams.get("state"),
          code: "TEST-CODE",
          client_id: "oaiapp-test",
        }),
    );
    assert.equal(ok.status, 200);
    assert.equal(session.status().canInfer, true);
    assert.equal(events[0].kind, "auth-success");
    const tokenPost = requests.find((x) => x.url === TOKEN_ENDPOINT);
    assert.equal(tokenPost.options.body.get("client_id"), "oaiapp-test");
    assert.notEqual(
      tokenPost.options.body.get("client_id"),
      "dynamic_agent_client",
    );
    const saved = await readFile(
      path.join(directory, "installation.json"),
      "utf8",
    );
    assert.ok(!saved.includes("ACCESS_TEST_ONLY"));
    assert.ok(!saved.includes("REFRESH_TEST_ONLY"));
    assert.ok(saved.includes("oaiapp-test"));
    const again = new URL((await session.start()).url);
    assert.equal(again.searchParams.get("client_id"), "oaiapp-test");
    assert.equal(
      again.searchParams.get("ext_agent_host_id"),
      u.searchParams.get("ext_agent_host_id"),
    );
  } finally {
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
test("identity without plan permission cannot activate inference", () => {
  const s = new ChatGPTSession();
  assert.throws(() =>
    s.accept(
      {
        access_token: "a",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid profile",
      },
      { sub: "x" },
      "client",
    ),
  );
  assert.equal(s.status(), null);
});
test("profile-specific registrations retain shared host ID and independent client identities", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nexo-profiles-"));
  const a = new ChatGPTSession({ directory, profileId: "profile-a" }),
    b = new ChatGPTSession({ directory, profileId: "profile-b" });
  try {
    await a.init();
    a.meta.clientId = "client-a";
    a.meta.subject = "sub-a";
    await a.saveMetadata();
    await b.init();
    assert.equal(a.meta.hostId, b.meta.hostId);
    assert.equal(b.meta.clientId, undefined);
    b.meta.clientId = "client-b";
    b.meta.subject = "sub-b";
    await b.saveMetadata();
    const reload = new ChatGPTSession({ directory, profileId: "profile-a" });
    await reload.init();
    assert.equal(reload.meta.clientId, "client-a");
    assert.equal(reload.meta.subject, "sub-a");
    assert.equal(reload.meta.hostId, b.meta.hostId);
    const base = JSON.parse(
      await readFile(path.join(directory, "installation.json"), "utf8"),
    );
    assert.equal(base.clientId, undefined);
    reload.dispose();
  } finally {
    a.dispose();
    b.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
test("registration rejects unsafe profile identifiers", () => {
  for (const profileId of ["../other", "a/b", "", "<script>"])
    assert.throws(() => new ChatGPTSession({ profileId }));
});
