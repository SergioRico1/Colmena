// The hosted sign-in and company pages talk to the Worker's /auth/* (cloud/src/worker.js).
let csrf = null;

export class AuthError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function call(path, method = "GET", body) {
  const headers = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    if (csrf) headers["X-Colmena-Token"] = csrf;
  }
  let response;
  try {
    response = await fetch(path, { method, headers, credentials: "same-origin", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new AuthError("No hay conexión. Comprueba tu red y vuelve a probar.", 0);
  }
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new AuthError(data?.error || "No se pudo completar. Prueba otra vez.", response.status, data);
  return data;
}

/** Who is signed in ({user, workspaces, current, csrf}), or null. */
export async function me() {
  try {
    const data = await call("/auth/me");
    csrf = data.csrf;
    return data;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}
export const auth = {
  link: (email, next) => call("/auth/link", "POST", { email, next }),
  verify: (token) => call("/auth/verify", "POST", { token }),
  logout: () => call("/auth/logout", "POST", {}),
  rename: (name) => call("/auth/me", "PATCH", { name }),
  createWorkspace: (name) => call("/auth/workspaces", "POST", { name }),
  select: (id) => call("/auth/workspaces/select", "POST", { id }),
  workspace: () => call("/auth/workspace"),
  renameWorkspace: (name) => call("/auth/workspace", "PATCH", { name }),
  invite: (email, role) => call("/auth/workspace/invitations", "POST", { email, role }),
  revokeInvite: (id) => call("/auth/workspace/invitations/" + id, "DELETE", {}),
  setRole: (id, role) => call("/auth/workspace/members/" + id, "PATCH", { role }),
  remove: (id) => call("/auth/workspace/members/" + id, "DELETE", {}),
  leave: () => call("/auth/workspace/leave", "POST", {}),
  previewInvite: (token) => call("/auth/invitations/preview", "POST", { token }),
  acceptInvite: (token) => call("/auth/invitations/accept", "POST", { token }),
  /** Sign-in providers configured on this deployment: [{id, name}] (none when it fails). */
  providers: () => call("/auth/providers").then((r) => (Array.isArray(r?.providers) ? r.providers : []), () => []),
  myInvitations: () => call("/auth/invitations/mine"),
  acceptInviteById: (id) => call("/auth/invitations/" + id + "/accept", "POST", {}),
  deactivate: (id) => call("/auth/workspace/members/" + id + "/deactivate", "POST", {}),
  reactivate: (id) => call("/auth/workspace/members/" + id + "/reactivate", "POST", {}),
  setDomains: (domains) => call("/auth/workspace/domains", "PUT", { domains }),
  importInvitations: (people) => call("/auth/workspace/invitations/import", "POST", { people }),
  /** A direct message with someone of the company: its address in the app. */
  directMessage: async (person) => {
    const { csrf: token } = await call("/api/bootstrap");
    const r = await fetch("/api/cloud/dm", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Colmena-Token": token }, body: JSON.stringify({ person }) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new AuthError(data?.error || "No se pudo abrir la conversación.", r.status);
    return data;
  },
};

/** The token a mail link carries after «#t=» (never sent to the server in a URL). */
export function tokenFromHash() {
  const t = new URLSearchParams(location.hash.slice(1)).get("t");
  return t && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}
