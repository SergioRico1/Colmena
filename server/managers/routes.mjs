// HTTP routes for password managers, per-bot sign-in permissions and named browser sessions
// (Ajustes › Memoria y privacidad › Contraseñas de webs, Ajustes › Navegador y dictado, the
// bot's page). None of them returns, accepts or logs a password or a master password.
//
//   GET    /api/password-managers                    → {managers:[status], logins:[login]}
//   GET    /api/password-managers/:manager/items     → {items:[{itemId, title, domain, user, chosenId}]}
//   POST   /api/password-managers/:manager/logins    {itemId} → login (Colmena may use it)
//   DELETE /api/logins/:id                           → stop using it (its bot permissions go too)
//   POST   /api/password-managers/bitwarden/unlock   → opens bw's own prompt in a window → status
//   POST   /api/password-managers/bitwarden/lock     → forgets the session key
//   GET    /api/sign-in-grants                       → {grants: {"vault:<id>"|"login:<id>": [botId]}}
//   PUT    /api/sign-in-grants                       {scope, botIds} → the bots that may use one account
//   PUT    /api/bots/:id/sign-ins                    {scopes} → the accounts one bot may use
//   GET    /api/browser-sessions                     → {available, sessions:[{id, name, principal, bots}]}
//   POST   /api/browser-sessions                     {name}
//   PATCH  /api/browser-sessions/:id                 {name}
//   DELETE /api/browser-sessions/:id                 (bots and missions fall back to Principal)
//   GET    /api/browser-sessions/:id/sites           → {available, domains}
//   POST   /api/browser-sessions/:id/clear           → wipes its cookies and storage
//   POST   /api/browser-sessions/:id/open            {url?} → «Iniciar sesión a mano»
//   PUT    /api/bots/:id/browser-session             {session}
//   PUT    /api/missions/:id/browser-session         {session|null}
import { id as newId, now } from "../store.mjs";
import { MANAGERS } from "./index.mjs";

const TOOL = "browser_sign_in";
const SCOPE = /^(vault|login):[A-Za-z0-9_-]{1,80}$/;

/** {scope: [botId]} for every account permission given (in Ajustes or with «Permitir siempre»). */
export function signInGrants(store) {
  const out = {};
  for (const g of store.list("grants"))
    if (g.tool === TOOL && g.active !== false && SCOPE.test(String(g.scope || "")) && (!g.expiresAt || Date.parse(g.expiresAt) > Date.now())) (out[g.scope] ||= []).push(g.botId);
  return out;
}

function scopeExists(store, scope) {
  const [kind, id] = scope.split(":");
  return !!store.get(kind === "vault" ? "vault" : "logins", id);
}
function setGrant(store, botId, scope, on) {
  const mine = store.list("grants").filter((g) => g.tool === TOOL && g.botId === botId && g.scope === scope);
  if (on && !mine.some((g) => g.active !== false)) store.put("grants", { id: newId(), botId, tool: TOOL, kind: "permission", scope, active: true, origin: "ajustes", createdAt: now(), expiresAt: null });
  if (!on) for (const g of mine) store.remove("grants", g.id);
}

export function registerManagerRoutes(app, { store, managers, sessions, z }) {
  const managerId = (raw) => {
    if (!MANAGERS[raw]) throw Object.assign(Error("Gestor de contraseñas desconocido."), { status: 404 });
    return raw;
  };
  const bots = () => new Set(store.list("bots").map((b) => b.id));

  app.get("/api/password-managers", async (req, res) => {
    res.json({ managers: await managers.statuses(), logins: managers.list() });
  });
  app.get("/api/password-managers/:manager/items", async (req, res) => {
    res.json({ items: await managers.items(managerId(req.params.manager)) });
  });
  app.post("/api/password-managers/:manager/logins", async (req, res) => {
    const { itemId } = z.object({ itemId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) }).strict().parse(req.body ?? {});
    res.status(201).json(await managers.choose(managerId(req.params.manager), itemId));
  });
  app.delete("/api/logins/:id", (req, res) => res.json(managers.remove(req.params.id)));
  app.post("/api/password-managers/bitwarden/unlock", async (req, res) => res.json(await managers.unlockBitwarden()));
  app.post("/api/password-managers/bitwarden/lock", (req, res) => res.json(managers.lockBitwarden()));

  app.get("/api/sign-in-grants", (req, res) => res.json({ grants: signInGrants(store) }));
  app.put("/api/sign-in-grants", (req, res) => {
    const { scope, botIds } = z.object({ scope: z.string().regex(SCOPE), botIds: z.array(z.string().max(100)).max(200) }).strict().parse(req.body ?? {});
    if (!scopeExists(store, scope)) throw Object.assign(Error("Esa cuenta ya no está en Colmena."), { status: 404 });
    const known = bots();
    const wanted = new Set(botIds.filter((b) => known.has(b)));
    for (const b of known) setGrant(store, b, scope, wanted.has(b));
    res.json({ scope, botIds: signInGrants(store)[scope] || [] });
  });
  app.put("/api/bots/:id/sign-ins", (req, res) => {
    const { scopes } = z.object({ scopes: z.array(z.string().regex(SCOPE)).max(500) }).strict().parse(req.body ?? {});
    if (!bots().has(req.params.id)) throw Object.assign(Error("Ese bot no existe."), { status: 404 });
    const wanted = new Set(scopes.filter((s) => scopeExists(store, s)));
    const every = new Set([...store.list("vault").map((v) => "vault:" + v.id), ...store.list("logins").map((l) => "login:" + l.id)]);
    for (const scope of every) setGrant(store, req.params.id, scope, wanted.has(scope));
    res.json({ botId: req.params.id, scopes: Object.entries(signInGrants(store)).filter(([, ids]) => ids.includes(req.params.id)).map(([s]) => s) });
  });

  const name = z.object({ name: z.string().max(80) }).strict();
  app.get("/api/browser-sessions", (req, res) => res.json({ available: !!sessions.computer?.available, sessions: sessions.list() }));
  app.post("/api/browser-sessions", (req, res) => res.status(201).json(sessions.create(name.parse(req.body ?? {}).name)));
  app.patch("/api/browser-sessions/:id", (req, res) => res.json(sessions.rename(req.params.id, name.parse(req.body ?? {}).name)));
  app.delete("/api/browser-sessions/:id", async (req, res) => res.json(await sessions.remove(req.params.id)));
  app.get("/api/browser-sessions/:id/sites", async (req, res) => res.json(await sessions.sites(req.params.id)));
  app.post("/api/browser-sessions/:id/clear", async (req, res) => res.json(await sessions.clear(req.params.id)));
  app.post("/api/browser-sessions/:id/open", async (req, res) => {
    const { url = "" } = z.object({ url: z.string().max(2000).optional() }).strict().parse(req.body ?? {});
    res.json(await sessions.openManual(req.params.id, url));
  });
  const pick = z.object({ session: z.string().max(40).nullable() }).strict();
  app.put("/api/bots/:id/browser-session", (req, res) => res.json(sessions.assignBot(req.params.id, pick.parse(req.body ?? {}).session)));
  app.put("/api/missions/:id/browser-session", (req, res) => res.json(sessions.assignMission(req.params.id, pick.parse(req.body ?? {}).session)));
}
