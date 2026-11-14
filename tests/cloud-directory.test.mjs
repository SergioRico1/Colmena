// The hosted account directory (cloud/src/directory-core.js) on the in-Node fake of DO SQL:
// sign-in links, sessions (rotation, logout, revocation), companies, roles and invitations.
import test from "node:test";
import assert from "node:assert/strict";
import { FakeDurableStorage } from "../server/do-sql-fake.mjs";
import { DirectoryCore, DirectoryError, LIMITS, cleanEmail, safeNext } from "../cloud/src/directory-core.js";

function directory() {
  let now = Date.parse("2026-11-14T10:00:00Z");
  const core = new DirectoryCore(new FakeDurableStorage(), { clock: () => now });
  return { core, advance: (ms) => { now += ms; } };
}
const fails = (fn, status, code) => assert.throws(fn, (e) => e instanceof DirectoryError && e.status === status && (!code || e.code === code));
function signIn(core, email) {
  const { token } = core.requestLink({ email, ip: "203.0.113.1" });
  return core.verifyLink({ token });
}

test("a sign-in link works once, for 15 minutes, and makes the person", () => {
  const { core, advance } = directory();
  const link = core.requestLink({ email: "  Ana@Example.COM ", next: "/sala/x" });
  assert.equal(link.email, "ana@example.com");
  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
  const done = core.verifyLink({ token: link.token });
  assert.equal(done.user.email, "ana@example.com");
  assert.equal(done.isNew, true);
  assert.equal(done.next, "/sala/x");
  fails(() => core.verifyLink({ token: link.token }), 410, "used");
  const late = core.requestLink({ email: "ana@example.com" });
  advance(LIMITS.linkMs + 1);
  fails(() => core.verifyLink({ token: late.token }), 410, "expired");
  fails(() => core.verifyLink({ token: "x".repeat(43) }), 400, "link");
  // The same person signs in again: not new.
  assert.equal(signIn(core, "ana@example.com").isNew, false);
});

test("sign-in links are limited per address and per IP; the next page stays on this site", () => {
  const { core, advance } = directory();
  for (let i = 0; i < LIMITS.linksPerEmail; i++) core.requestLink({ email: "b@example.com", ip: "198.51.100.7" });
  fails(() => core.requestLink({ email: "b@example.com", ip: "198.51.100.8" }), 429, "rate");
  for (let i = 0; i < LIMITS.linksPerIp - LIMITS.linksPerEmail; i++) core.requestLink({ email: `c${i}@example.com`, ip: "198.51.100.7" });
  fails(() => core.requestLink({ email: "d@example.com", ip: "198.51.100.7" }), 429, "rate");
  advance(LIMITS.rateWindowMs);
  assert.ok(core.requestLink({ email: "b@example.com", ip: "198.51.100.7" }).token);
  fails(() => core.requestLink({ email: "not-an-email" }), 400, "email");
  assert.equal(safeNext("//evil.example/x"), "/");
  assert.equal(safeNext("https://evil.example"), "/");
  assert.equal(safeNext("/empresa"), "/empresa");
  assert.equal(cleanEmail("E@Example.org"), "e@example.org");
});

test("sessions rotate their token, keep a short grace, and end on logout", () => {
  const { core, advance } = directory();
  const { session, user } = signIn(core, "ana@example.com");
  const first = core.session(session.token);
  assert.equal(first.user.id, user.id);
  assert.equal(first.session.csrf, session.csrf);
  assert.equal(first.rotated, undefined);
  advance(LIMITS.rotateMs + 1);
  const rotated = core.session(session.token);
  assert.ok(rotated.rotated?.token, "a new token after rotateMs");
  assert.notEqual(rotated.rotated.token, session.token);
  // The old token works for the grace period (requests in flight), then not.
  assert.equal(core.session(session.token)?.user.id, user.id);
  advance(LIMITS.graceMs + 1);
  assert.equal(core.session(session.token), null);
  assert.equal(core.session(rotated.rotated.token)?.user.id, user.id);
  core.logout(rotated.rotated.token);
  assert.equal(core.session(rotated.rotated.token), null);
  assert.equal(core.session("not a token"), null);
});

test("sessions end when idle too long and at their absolute expiry", () => {
  const { core, advance } = directory();
  const a = signIn(core, "ana@example.com").session;
  advance(LIMITS.idleMs + 1);
  assert.equal(core.session(a.token), null);
  const b = signIn(core, "ana@example.com").session;
  for (let t = 0; t < LIMITS.sessionMs; t += LIMITS.idleMs / 2) {
    advance(LIMITS.idleMs / 2);
    const s = core.session(b.token);
    if (s?.rotated) b.token = s.rotated.token;
  }
  advance(1);
  assert.equal(core.session(b.token), null);
});

test("companies: the creator owns it; roles; the last owner stays; removal ends sessions", () => {
  const { core } = directory();
  const ana = signIn(core, "ana@example.com");
  const beto = signIn(core, "beto@example.com");
  const ws = core.createWorkspace(ana.user.id, "  Estudio   Norte ");
  assert.equal(ws.name, "Estudio Norte");
  assert.equal(core.roleOf(ws.id, ana.user.id), "owner");
  fails(() => core.selectWorkspace(beto.session.token, ws.id), 403, "member");
  const { token } = core.invite(ws.id, ana.user.id, { email: "beto@example.com", role: "member" });
  core.acceptInvitation(token, beto.user.id);
  assert.deepEqual(core.members(ws.id).map((m) => [m.email, m.role]), [["ana@example.com", "owner"], ["beto@example.com", "member"]]);
  // A member manages nothing; an admin cannot touch owners or name admins.
  fails(() => core.invite(ws.id, beto.user.id, { email: "c@example.com" }), 403, "role");
  fails(() => core.setRole(ws.id, beto.user.id, ana.user.id, "guest"), 403, "role");
  core.setRole(ws.id, ana.user.id, beto.user.id, "admin");
  fails(() => core.setRole(ws.id, beto.user.id, ana.user.id, "member"), 403, "role");
  fails(() => core.invite(ws.id, beto.user.id, { email: "c@example.com", role: "admin" }), 403, "role");
  fails(() => core.setRole(ws.id, ana.user.id, ana.user.id, "member"), 409, "last-owner");
  fails(() => core.removeMember(ws.id, ana.user.id, ana.user.id), 409, "last-owner");
  // Taken out: the membership and every session go.
  core.selectWorkspace(beto.session.token, ws.id);
  const out = core.removeMember(ws.id, ana.user.id, beto.user.id);
  assert.equal(out.revokedSessions, 1);
  assert.equal(core.session(beto.session.token), null);
  assert.equal(core.roleOf(ws.id, beto.user.id), null);
});

test("invitations: only for their address, once, for 7 days; a new one replaces the open one", () => {
  const { core, advance } = directory();
  const ana = signIn(core, "ana@example.com");
  const cora = signIn(core, "cora@example.org");
  const ws = core.createWorkspace(ana.user.id, "Norte");
  const first = core.invite(ws.id, ana.user.id, { email: "cora@example.org", role: "guest" });
  const second = core.invite(ws.id, ana.user.id, { email: "cora@example.org", role: "member" });
  fails(() => core.acceptInvitation(first.token, cora.user.id), 404, "invite");
  const preview = core.previewInvitation(second.token);
  assert.deepEqual([preview.workspace, preview.email, preview.role, preview.expired], ["Norte", "cora@example.org", "member", false]);
  const beto = signIn(core, "beto@example.com");
  fails(() => core.acceptInvitation(second.token, beto.user.id), 403, "email");
  assert.equal(core.acceptInvitation(second.token, cora.user.id).role, "member");
  assert.equal(core.acceptInvitation(second.token, cora.user.id).workspaceId, ws.id, "accepting twice is harmless");
  fails(() => core.invite(ws.id, ana.user.id, { email: "cora@example.org" }), 409, "member");
  const late = core.invite(ws.id, ana.user.id, { email: "late@example.com" });
  advance(LIMITS.inviteMs + 1);
  const lateUser = signIn(core, "late@example.com");
  fails(() => core.acceptInvitation(late.token, lateUser.user.id), 410, "expired");
  const revoked = core.invite(ws.id, ana.user.id, { email: "gone@example.com" });
  core.revokeInvitation(ws.id, ana.user.id, revoked.invitation.id);
  fails(() => core.previewInvitation(revoked.token), 404, "invite");
});

test("two companies are apart: membership decides, and a session opens only its own", () => {
  const { core } = directory();
  const ana = signIn(core, "ana@example.com");
  const cora = signIn(core, "cora@example.org");
  const one = core.createWorkspace(ana.user.id, "Uno");
  const two = core.createWorkspace(cora.user.id, "Dos");
  assert.deepEqual(core.workspacesOf(ana.user.id).map((w) => w.id), [one.id]);
  assert.deepEqual(core.workspacesOf(cora.user.id).map((w) => w.id), [two.id]);
  core.selectWorkspace(ana.session.token, one.id);
  assert.equal(core.session(ana.session.token).session.workspaceId, one.id);
  fails(() => core.selectWorkspace(ana.session.token, two.id), 403, "member");
  assert.equal(core.session(cora.session.token).session.workspaceId, null);
  fails(() => core.invitations(two.id, ana.user.id), 403, "member");
});

test("another provider later finds the same person by address", () => {
  const { core } = directory();
  const ana = signIn(core, "ana@example.com");
  const viaGoogle = core.signInWith({ provider: "google", subject: "1234", email: "ana@example.com" });
  assert.equal(viaGoogle.user.id, ana.user.id);
  assert.equal(core.signInWith({ provider: "google", subject: "1234", email: "ana@example.com" }).user.id, ana.user.id);
  fails(() => core.signInWith({ provider: "email", subject: "x", email: "x@example.com" }), 400);
});

test("upkeep forgets what expired; the dev mail keeps 30 minutes", () => {
  const { core, advance } = directory();
  core.keepDevMail({ email: "ana@example.com", kind: "signin", url: "https://colmena.invalid/entrar/verificar#t=x" });
  assert.equal(core.devMail("ana@example.com").length, 1);
  advance(31 * 60 * 1000);
  core.sweep();
  assert.equal(core.devMail("ana@example.com").length, 0);
});
