import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatGPTSession } from "../server/nexo/oauth.mjs";
import { SCOPES, TOKEN_ENDPOINT } from "../server/nexo/security.mjs";
function vaultFixture() {
  const rows = new Map();
  return {
    rows,
    async save(b, c) {
      rows.set(b.profile, structuredClone({ b, c }));
    },
    async load(b) {
      const r = rows.get(b.profile);
      if (!r) return null;
      assert.deepEqual(r.b, b);
      return structuredClone(r.c);
    },
    async remove(profile) {
      rows.delete(profile || "default");
    },
  };
}
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nexo-session-")),
    vault = vaultFixture();
  const session = new ChatGPTSession({ directory, profileId: "p-a", vault });
  try {
    await session.init();
    session.meta.clientId = "client-a";
    session.meta.subject = "account-a";
    await session.saveMetadata();
    session.accept(
      {
        access_token: "TEST-ACCESS",
        refresh_token: "TEST-REFRESH",
        token_type: "Bearer",
        scope: SCOPES,
        expires_in: 3600,
      },
      { sub: "account-a" },
      "client-a",
    );
    await session.saveCredentials();
    await run({ directory, vault, session });
  } finally {
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
test("saved connection restores after dispose without OAuth registration", () =>
  fixture(async ({ directory, vault, session }) => {
    session.dispose();
    const restored = new ChatGPTSession({
      directory,
      profileId: "p-a",
      vault,
      fetchImpl: () => {
        throw Error("OAuth must not run");
      },
    });
    const status = await restored.restore();
    assert.equal(status.canInfer, true);
    assert.equal(status.persistent, true);
    assert.equal(await restored.accessToken(), "TEST-ACCESS");
    assert.ok(!JSON.stringify(status).includes("TEST-ACCESS"));
    assert.ok(!JSON.stringify(status).includes("TEST-REFRESH"));
  }));
test("profile switch does not restore another profile credentials", () =>
  fixture(async ({ directory, vault }) => {
    const other = new ChatGPTSession({ directory, profileId: "p-b", vault });
    assert.equal(await other.restore(), null);
    assert.equal(other.credentials, null);
  }));
test("concurrent refresh is serialized and latest rotating token is saved", () =>
  fixture(async ({ directory, vault, session }) => {
    session.credentials.expiresAt = 0;
    let requests = 0;
    session.fetch = async (url, options) => {
      assert.equal(url, TOKEN_ENDPOINT);
      assert.equal(options.body.get("client_id"), "client-a");
      assert.equal(options.body.get("refresh_token"), "TEST-REFRESH");
      requests++;
      await new Promise((r) => setTimeout(r, 10));
      return Response.json({
        access_token: "ACCESS-ROTATED",
        refresh_token: "REFRESH-ROTATED",
        token_type: "Bearer",
        expires_in: 3600,
      });
    };
    assert.deepEqual(
      await Promise.all([session.accessToken(), session.accessToken()]),
      ["ACCESS-ROTATED", "ACCESS-ROTATED"],
    );
    assert.equal(requests, 1);
    const restored = new ChatGPTSession({ directory, profileId: "p-a", vault });
    await restored.restore();
    assert.equal(restored.credentials.refresh, "REFRESH-ROTATED");
  }));
test("temporary renewal failure preserves saved session; revoked renewal removes it", () =>
  fixture(async ({ vault, session }) => {
    session.credentials.expiresAt = 0;
    session.fetch = async () => new Response("", { status: 503 });
    await assert.rejects(() => session.accessToken(), /conserva/);
    assert.ok(vault.rows.has("p-a"));
    assert.ok(session.credentials);
    session.fetch = async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 });
    await assert.rejects(() => session.accessToken(), /revocada/);
    assert.equal(vault.rows.has("p-a"), false);
    assert.equal(session.credentials, null);
  }));
test("invalid_request renewal cannot silently erase a valid saved registration", () =>
  fixture(async ({ vault, session }) => {
    session.credentials.expiresAt = 0;
    session.fetch = async () =>
      Response.json(
        { error: "invalid_request", error_description: "Not exposed to UI" },
        { status: 400 },
      );
    await assert.rejects(() => session.accessToken(), /conserva/);
    assert.ok(vault.rows.has("p-a"));
    assert.ok(session.credentials);
    assert.equal(session.persistent, true);
  }));
test("returning authorization retains registration and hints but refreshes PKCE and state", () =>
  fixture(async ({ session }) => {
    session.credentials.idToken = "RETAINED-ID-TOKEN";
    session.credentials.email = "fixture@example.invalid";
    const first = new URL((await session.start()).url),
      second = new URL((await session.start()).url);
    assert.equal(first.searchParams.get("client_id"), "client-a");
    assert.equal(first.searchParams.get("id_token_hint"), "RETAINED-ID-TOKEN");
    assert.equal(
      first.searchParams.get("login_hint"),
      "fixture@example.invalid",
    );
    assert.equal(first.searchParams.has("agent_name_hint"), false);
    assert.equal(
      first.searchParams.get("ext_agent_host_id"),
      second.searchParams.get("ext_agent_host_id"),
    );
    for (const key of ["state", "nonce", "code_challenge"])
      assert.notEqual(
        first.searchParams.get(key),
        second.searchParams.get(key),
      );
  }));
test("logout clears saved tokens and preserves registration identity", () =>
  fixture(async ({ directory, vault, session }) => {
    session.getDiscovery = async () => ({
      revocation_endpoint: "https://auth.openai.com/revoke",
    });
    session.fetch = async () => new Response("", { status: 200 });
    assert.equal((await session.logout()).revoked, true);
    assert.equal(vault.rows.has("p-a"), false);
    const restored = new ChatGPTSession({ directory, profileId: "p-a", vault });
    assert.equal(await restored.restore(), null);
    assert.equal(restored.meta.clientId, "client-a");
  }));
