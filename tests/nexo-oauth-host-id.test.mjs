import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatGPTSession } from "../server/nexo/oauth.mjs";
import { authorizeURL } from "../server/nexo/security.mjs";

const uuid = "12345678-1234-4123-8123-123456789abc",
  hostId = "urn:uuid:" + uuid;
const params = {
  redirectURI: "http://127.0.0.1:1234/auth/callback",
  state: "s",
  nonce: "n",
  challenge: "c",
};

test("authorization sends a UUID URI for both legacy and current installation IDs", () => {
  for (const savedId of [uuid, hostId]) {
    const url = new URL(authorizeURL({ ...params, hostId: savedId }));
    assert.equal(url.searchParams.get("ext_agent_host_id"), hostId);
  }
});

test("authorization rejects malformed host identities locally", () => {
  for (const savedId of [
    undefined,
    "host",
    "-".repeat(36),
    "urn:uuid:not-a-uuid",
    uuid + "?extra",
  ])
    assert.throws(() => authorizeURL({ ...params, hostId: savedId }));
});

test("a new installation persists one UUIDv4 URI across sign-ins and restarts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nexo-host-new-"));
  const session = new ChatGPTSession({ directory }),
    reload = new ChatGPTSession({ directory });
  try {
    const first = new URL((await session.start()).url),
      second = new URL((await session.start()).url);
    const saved = JSON.parse(
      await readFile(path.join(directory, "installation.json"), "utf8"),
    );
    assert.match(
      saved.hostId,
      /^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    assert.equal(first.searchParams.get("ext_agent_host_id"), saved.hostId);
    assert.equal(second.searchParams.get("ext_agent_host_id"), saved.hostId);
    assert.notEqual(
      first.searchParams.get("state"),
      second.searchParams.get("state"),
    );
    assert.notEqual(
      first.searchParams.get("nonce"),
      second.searchParams.get("nonce"),
    );
    await reload.init();
    assert.equal(reload.meta.hostId, saved.hostId);
  } finally {
    session.dispose();
    reload.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy migration retains the UUID and account registrations and is idempotent", async () => {
  for (const profileId of [null, "profile-a"]) {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "nexo-host-legacy-"),
    );
    const session = new ChatGPTSession({ directory, profileId }),
      reload = new ChatGPTSession({ directory, profileId });
    try {
      const baseFile = path.join(directory, "installation.json");
      const base = {
        hostId: uuid,
        clientId: "client-legacy",
        subject: "subject-legacy",
        extra: "preserved",
      };
      await writeFile(baseFile, JSON.stringify(base));
      const profile = {
        hostId: uuid,
        clientId: "client-profile",
        subject: "subject-profile",
      };
      const profileFile = path.join(directory, "profiles", "profile-a.json");
      if (profileId) {
        await mkdir(path.dirname(profileFile));
        await writeFile(profileFile, JSON.stringify(profile));
      }
      await session.init();
      const migrated = await readFile(baseFile, "utf8");
      assert.deepEqual(JSON.parse(migrated), { ...base, hostId });
      assert.equal(session.meta.hostId, hostId);
      assert.equal(
        session.meta.clientId,
        profileId ? profile.clientId : base.clientId,
      );
      assert.equal(
        session.meta.subject,
        profileId ? profile.subject : base.subject,
      );
      if (profileId)
        assert.equal(
          await readFile(profileFile, "utf8"),
          JSON.stringify(profile),
        );
      await reload.init();
      assert.equal(await readFile(baseFile, "utf8"), migrated);
      const url = new URL((await reload.start()).url);
      assert.equal(url.searchParams.get("ext_agent_host_id"), hostId);
      assert.equal(url.searchParams.get("client_id"), session.meta.clientId);
    } finally {
      session.dispose();
      reload.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("an unreadable identity is preserved rather than replaced with a new installation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nexo-host-invalid-"));
  const session = new ChatGPTSession({ directory });
  try {
    const file = path.join(directory, "installation.json");
    for (const contents of [
      "{broken",
      JSON.stringify({ hostId: "-".repeat(36), clientId: "existing" }),
    ]) {
      await writeFile(file, contents);
      await assert.rejects(session.init(), /registro local de identidad/);
      assert.equal(await readFile(file, "utf8"), contents);
    }
  } finally {
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
