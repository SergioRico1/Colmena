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
  // Who is already in, by first name only, while the invitation is open (the Worker strips the id).
  assert.equal(preview.count, 1);
  assert.equal(preview.people.length, 1);
  assert.ok(!preview.people[0].includes("@"), "a first name, never an address");
  assert.equal(preview.workspaceId, ws.id);
  const beto = signIn(core, "beto@example.com");
  fails(() => core.acceptInvitation(second.token, beto.user.id), 403, "email");
  assert.equal(core.acceptInvitation(second.token, cora.user.id).role, "member");
  assert.equal(core.acceptInvitation(second.token, cora.user.id).workspaceId, ws.id, "accepting twice is harmless");
  const used = core.previewInvitation(second.token);
  assert.deepEqual([used.accepted, used.people, used.count, used.workspaceId], [true, [], 0, null], "a used invitation shows nobody");
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

test("another provider finds the same person by verified address; an unverified one is refused", () => {
  const { core } = directory();
  const ana = signIn(core, "ana@example.com");
  fails(() => core.signInWith({ provider: "google", subject: "1234", email: "ana@example.com" }), 403, "unverified");
  fails(() => core.signInWith({ provider: "google", subject: "1234", email: "ana@example.com", emailVerified: "yes" }), 403, "unverified");
  const viaGoogle = core.signInWith({ provider: "google", subject: "1234", email: "ana@example.com", emailVerified: true });
  assert.equal(viaGoogle.user.id, ana.user.id);
  assert.equal(viaGoogle.isNew, false);
  assert.deepEqual(viaGoogle.joined, []);
  assert.equal(core.signInWith({ provider: "google", subject: "1234", email: "ana@example.com", emailVerified: true }).user.id, ana.user.id);
  const fresh = core.signInWith({ provider: "github", subject: "77", email: "Nuevo@Example.com", emailVerified: true, name: "Nuevo Nombre" });
  assert.equal(fresh.isNew, true);
  assert.deepEqual([fresh.user.email, fresh.user.name], ["nuevo@example.com", "Nuevo Nombre"]);
  assert.ok(core.session(fresh.session.token));
  fails(() => core.signInWith({ provider: "email", subject: "x", email: "x@example.com", emailVerified: true }), 400);
});

test("deactivate and reactivate: sessions end, the company closes for them, the list keeps them", () => {
  const { core } = directory();
  const ana = signIn(core, "ana@example.com");
  const ws = core.createWorkspace(ana.user.id, "Norte");
  const join = (email, role) => { const p = signIn(core, email); core.acceptInvitation(core.invite(ws.id, ana.user.id, { email, role }).token, p.user.id); return p; };
  const beto = join("beto@example.com", "admin");
  const cora = join("cora@example.com", "member");
  const dani = join("dani@example.com", "member");
  core.selectWorkspace(cora.session.token, ws.id);
  // Nobody deactivates themselves; admins do not touch owners or admins; members manage nothing.
  fails(() => core.deactivateMember(ws.id, ana.user.id, ana.user.id), 400, "self");
  fails(() => core.deactivateMember(ws.id, beto.user.id, ana.user.id), 403, "role");
  fails(() => core.deactivateMember(ws.id, cora.user.id, dani.user.id), 403, "role");
  const out = core.deactivateMember(ws.id, beto.user.id, cora.user.id);
  assert.deepEqual([out.deactivated, out.revokedSessions], [true, 1]);
  assert.equal(core.session(cora.session.token), null, "every session ends");
  assert.equal(core.roleOf(ws.id, cora.user.id), null);
  assert.deepEqual(core.workspacesOf(cora.user.id), []);
  const again = signIn(core, "cora@example.com");
  assert.equal(again.session.workspaceId, null);
  assert.equal(core.session(again.session.token).session.workspaceId, null);
  fails(() => core.selectWorkspace(again.session.token, ws.id), 403, "member");
  const listed = core.members(ws.id).find((m) => m.id === cora.user.id);
  assert.equal(listed.deactivated, true);
  assert.equal(core.members(ws.id).find((m) => m.id === dani.user.id).deactivated, false);
  // No invitation brings them back: they are reactivated.
  fails(() => core.invite(ws.id, ana.user.id, { email: "cora@example.com" }), 409, "deactivated");
  assert.equal(core.deactivateMember(ws.id, ana.user.id, cora.user.id).revokedSessions, 0, "twice is harmless");
  fails(() => core.setRole(ws.id, ana.user.id, cora.user.id, "guest"), 404);
  assert.deepEqual(core.reactivateMember(ws.id, beto.user.id, cora.user.id), { id: cora.user.id, deactivated: false, role: "member" });
  assert.equal(core.roleOf(ws.id, cora.user.id), "member");
  assert.deepEqual(core.workspacesOf(cora.user.id).map((w) => w.id), [ws.id]);
  // The last active owner stays: another owner may be deactivated, not the last one.
  core.setRole(ws.id, ana.user.id, beto.user.id, "owner");
  core.deactivateMember(ws.id, ana.user.id, beto.user.id);
  assert.equal(core.owners(ws.id), 1);
  fails(() => core.setRole(ws.id, ana.user.id, ana.user.id, "member"), 409, "last-owner");
  core.reactivateMember(ws.id, ana.user.id, beto.user.id);
  core.deactivateMember(ws.id, beto.user.id, ana.user.id);
  fails(() => core.deactivateMember(ws.id, ana.user.id, beto.user.id), 403, "member");
  // A deactivated person can still be taken out for good.
  assert.equal(core.removeMember(ws.id, beto.user.id, ana.user.id).removed, ana.user.id);
  assert.equal(core.members(ws.id).some((m) => m.id === ana.user.id), false);
});

test("domains: validated, no public providers; auto-join on sign-in, never after removal or deactivation", () => {
  const { core } = directory();
  const ana = signIn(core, "ana@norte.example");
  const ws = core.createWorkspace(ana.user.id, "Norte");
  const other = core.createWorkspace(ana.user.id, "Sur");
  fails(() => core.setDomains(ws.id, ana.user.id, ["gmail.com"]), 400, "public-domain");
  fails(() => core.setDomains(ws.id, ana.user.id, ["Outlook.ES"]), 400, "public-domain");
  fails(() => core.setDomains(ws.id, ana.user.id, ["not a domain"]), 400, "domain");
  fails(() => core.setDomains(ws.id, ana.user.id, ["localhost"]), 400, "domain");
  fails(() => core.setDomains(ws.id, ana.user.id, "norte.example"), 400, "domain");
  fails(() => core.setDomains(ws.id, ana.user.id, Array.from({ length: 21 }, (_, i) => `d${i}.example`)), 400, "domain");
  const set = core.setDomains(ws.id, ana.user.id, [" @Norte.Example ", "norte.example", "norte-labs.example"]);
  assert.deepEqual(set.domains, ["norte.example", "norte-labs.example"]);
  assert.deepEqual(core.workspace(ws.id).domains, ["norte.example", "norte-labs.example"]);
  assert.deepEqual(core.workspace(other.id).domains, []);
  // A member cannot set them.
  const viaLink = signIn(core, "beto@norte.example");
  assert.deepEqual(viaLink.joined, [ws.id], "joined by the domain, with a mail link");
  assert.equal(core.roleOf(ws.id, viaLink.user.id), "member");
  assert.equal(viaLink.session.workspaceId, ws.id);
  fails(() => core.setDomains(ws.id, viaLink.user.id, []), 403, "role");
  assert.deepEqual(signIn(core, "beto@norte.example").joined, [], "only once");
  const viaGoogle = core.signInWith({ provider: "google", subject: "g-cora", email: "cora@norte-labs.example", emailVerified: true });
  assert.deepEqual(viaGoogle.joined, [ws.id], "and with a provider");
  assert.deepEqual(signIn(core, "dani@sur.example").joined, []);
  assert.deepEqual(signIn(core, "eva@sub.norte.example").joined, [], "exact domain only");
  // Taken out, or deactivated: the domain does not bring them back.
  core.removeMember(ws.id, ana.user.id, viaLink.user.id);
  assert.deepEqual(signIn(core, "beto@norte.example").joined, []);
  assert.equal(core.roleOf(ws.id, viaLink.user.id), null);
  core.deactivateMember(ws.id, ana.user.id, viaGoogle.user.id);
  assert.deepEqual(core.signInWith({ provider: "google", subject: "g-cora", email: "cora@norte-labs.example", emailVerified: true }).joined, []);
  assert.equal(core.roleOf(ws.id, viaGoogle.user.id), null);
  // A new invitation does bring someone removed back.
  core.acceptInvitation(core.invite(ws.id, ana.user.id, { email: "beto@norte.example" }).token, viaLink.user.id);
  assert.equal(core.roleOf(ws.id, viaLink.user.id), "member");
  // Turned off.
  assert.deepEqual(core.setDomains(ws.id, ana.user.id, []).domains, []);
  assert.deepEqual(signIn(core, "fede@norte.example").joined, []);
});

test("imported invitations: no mail, no link, one per address, no daily limit; found by the person", () => {
  const { core } = directory();
  const ana = signIn(core, "ana@example.com");
  const ws = core.createWorkspace(ana.user.id, "Norte");
  const beto = signIn(core, "beto@example.com");
  core.acceptInvitation(core.invite(ws.id, ana.user.id, { email: "beto@example.com" }).token, beto.user.id);
  const gone = signIn(core, "gone@example.com");
  core.acceptInvitation(core.invite(ws.id, ana.user.id, { email: "gone@example.com" }).token, gone.user.id);
  core.deactivateMember(ws.id, ana.user.id, gone.user.id);
  const people = [
    { email: "beto@example.com", name: "Beto" }, // already in
    { email: "gone@example.com" }, // deactivated
    { email: "not-an-email" },
    { email: "Cora@Example.com", name: "Cora Ruiz", role: "guest" },
    { email: "cora@example.com" }, // twice in the list
    ...Array.from({ length: 60 }, (_, i) => ({ email: `p${i}@example.com`, name: `Persona ${i}` })),
  ];
  const r = core.importInvitations(ws.id, ana.user.id, people);
  assert.deepEqual([r.created, r.existing, r.skipped], [61, 2, 2], "more than the daily invite limit");
  assert.deepEqual(r.problems.map((p) => p.reason).sort(), ["deactivated", "invalid"]);
  assert.equal(JSON.stringify(r).includes("token"), false, "no token comes back");
  assert.deepEqual(core.importInvitations(ws.id, ana.user.id, [{ email: "cora@example.com" }]), { created: 0, existing: 1, skipped: 0, problems: [] }, "one open invitation per address");
  assert.ok(core.invitations(ws.id, ana.user.id).find((i) => i.email === "cora@example.com").imported);
  fails(() => core.importInvitations(ws.id, beto.user.id, people), 403, "role");
  fails(() => core.importInvitations(ws.id, ana.user.id, Array.from({ length: LIMITS.importPerCall + 1 }, () => ({ email: "x@example.com" }))), 413, "too-many");
  // Cora signs in: her name comes from the import, the invitation is waiting for her.
  const cora = signIn(core, "cora@example.com");
  assert.equal(cora.user.name, "Cora Ruiz");
  const mine = core.invitationsForEmail(cora.user.id);
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].workspaceId, mine[0].workspace, mine[0].inviter, mine[0].role], [ws.id, "Norte", ana.user.name, "guest"]);
  // Only the address it is for can take it.
  fails(() => core.acceptInvitationById(mine[0].id, beto.user.id), 403, "email");
  fails(() => core.acceptInvitationById("00000000-0000-0000-0000-000000000000", cora.user.id), 404, "invite");
  assert.deepEqual(core.acceptInvitationById(mine[0].id, cora.user.id), { workspaceId: ws.id, role: "guest" });
  assert.deepEqual(core.invitationsForEmail(cora.user.id), []);
  core.selectWorkspace(cora.session.token, ws.id);
  // A mailed invitation shows up too; not for companies the person is already in.
  const other = core.createWorkspace(ana.user.id, "Sur");
  core.invite(other.id, ana.user.id, { email: "cora@example.com", role: "member" });
  assert.deepEqual(core.invitationsForEmail(cora.user.id).map((i) => i.workspace), ["Sur"]);
  assert.deepEqual(core.invitationsForEmail(beto.user.id), []);
});

test("a directory from before deactivation, domains and imports gains the new columns", () => {
  const storage = new FakeDurableStorage();
  storage.sql.exec("CREATE TABLE memberships (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id)); CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)");
  storage.sql.exec("INSERT INTO workspaces VALUES ('w1', 'Vieja', 'u1', 1)");
  storage.sql.exec("INSERT INTO memberships VALUES ('w1', 'u1', 'owner', 1)");
  const core = new DirectoryCore(storage);
  assert.equal(core.roleOf("w1", "u1"), "owner");
  assert.deepEqual(core.workspace("w1").domains, []);
  assert.ok(new DirectoryCore(storage), "twice is fine");
});

test("upkeep forgets what expired; the dev mail keeps 30 minutes", () => {
  const { core, advance } = directory();
  core.keepDevMail({ email: "ana@example.com", kind: "signin", url: "https://colmena.invalid/entrar/verificar#t=x" });
  assert.equal(core.devMail("ana@example.com").length, 1);
  advance(31 * 60 * 1000);
  core.sweep();
  assert.equal(core.devMail("ana@example.com").length, 0);
});
