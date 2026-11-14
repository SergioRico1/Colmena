// The company directory for the «Empresa» admin screen: the Worker's /auth/workspace… routes
// (cloud/src/worker.js, rules in cloud/src/directory-core.js). They live under /auth, not /api,
// so they carry the session's CSRF token from GET /auth/me (src/cloud/api.js keeps it once me()
// has run). A changed session (403 «Tu sesión ha cambiado») fetches the token again and retries once.
import { auth, me } from "../cloud/api.js";

let ready = null;
const token = (fresh = false) => {
  if (!ready || fresh) ready = me().catch((error) => { ready = null; throw error; });
  return ready;
};

async function call(fn) {
  await token();
  try {
    return await fn();
  } catch (error) {
    if (error?.status !== 403) throw error;
    await token(true);
    return fn();
  }
}

export const directory = {
  /** { workspace: {id, name, domains}, role, me, members, invitations } */
  load: () => call(() => auth.workspace()),
  rename: (name) => call(() => auth.renameWorkspace(name)),
  /** → { invitation, link, delivery: "email" | "dev" } */
  invite: (email, role) => call(() => auth.invite(email, role)),
  revoke: (id) => call(() => auth.revokeInvite(id)),
  setRole: (id, role) => call(() => auth.setRole(id, role)),
  remove: (id) => call(() => auth.remove(id)),
  deactivate: (id) => call(() => auth.deactivate(id)),
  reactivate: (id) => call(() => auth.reactivate(id)),
  setDomains: (domains) => call(() => auth.setDomains(domains)),
};
