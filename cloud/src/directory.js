// The `Directory` Durable Object: one per deployment (idFromName("directory"), EU), the account
// directory of cloud/src/directory-core.js on its SQLite. The Worker reaches it only by RPC
// (`call`), never by HTTP, so nothing outside the Worker can talk to it.
import { DurableObject } from "cloudflare:workers";
import { DirectoryCore, DirectoryError } from "./directory-core.js";

const METHODS = new Set([
  "requestLink", "verifyLink", "session", "logout", "revokeSessions", "selectWorkspace",
  "user", "rename", "roleOf", "workspace", "workspacesOf", "createWorkspace", "renameWorkspace",
  "members", "setRole", "removeMember", "invite", "invitations", "revokeInvitation",
  "previewInvitation", "acceptInvitation", "keepDevMail", "devMail",
  "signInWith", "startOAuth", "finishOAuth", "deactivateMember", "reactivateMember", "setDomains",
  "importInvitations", "invitationsForEmail", "acceptInvitationById",
]);
const HOUR = 3600 * 1000;

export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new DirectoryCore(ctx.storage);
    // Upkeep once an hour (expired links and sessions, rate windows, dev mail).
    ctx.blockConcurrencyWhile(async () => {
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + HOUR);
    });
  }
  /** One directory operation: {ok, value} or {ok: false, status, code, error} (RPC keeps no error fields). */
  call(method, ...args) {
    if (!METHODS.has(method)) return { ok: false, status: 400, code: "method", error: "Operación no válida." };
    try {
      return { ok: true, value: this.core[method](...args) ?? null };
    } catch (error) {
      if (error instanceof DirectoryError) return { ok: false, status: error.status, code: error.code, error: error.message };
      console.error("directory." + method + ": " + (error?.stack || error));
      return { ok: false, status: 500, code: "internal", error: "No se pudo completar. Prueba otra vez." };
    }
  }
  async alarm() {
    try { this.core.sweep(); } catch (error) { console.error("directory sweep: " + error.message); }
    await this.ctx.storage.setAlarm(Date.now() + HOUR);
  }
}
