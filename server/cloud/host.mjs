// One hosted workspace (docs/CLOUD.md › Phase 1): the desktop's own Express app (server/app.mjs)
// over that workspace's store, answering as the person behind each request. Runs inside the
// workspace's Durable Object (cloud/src/workspace.js) and, unchanged, in Node tests.
//
// What a request brings: the Worker has already signed the person in, checked CSRF and the
// origin, and checked they belong to this workspace; it sends who they are in
// `X-Colmena-Person` (JSON {id, name, email, role}), a header no browser can set (the Worker
// drops it from every incoming request). Here: that person for everything the request does
// (server/identity.mjs), what a guest may do, the private conversations only their people see,
// and the desktop-only places answered «not in the cloud».
import { createApp } from "../app.mjs";
import { roomSlug } from "../runtime/helpers.mjs";
import { now } from "../store.mjs";
import { ROLES, SYSTEM_PERSON, asPerson, currentPerson, isPerson, personAddress, personalFields } from "../identity.mjs";
import { WorkspaceKeyring, envelopeVault } from "../envelope-vault.mjs";
import { mountFiles } from "../file-store.mjs";
import { randomUUID } from "node:crypto";
import { TeamChat } from "./chat.mjs";
import { chatRoutes } from "./chat-routes.mjs";
import { SlackImport } from "./slack-import.mjs";
import { MemoryBlobs } from "./blobs.mjs";
import { sendPush } from "./webpush.mjs";
import { fetchPreview } from "./link-preview.mjs";
import { cloudBots } from "./bots-host.mjs";
import { ChannelBots } from "./channel-bots.mjs";
import { cloudBrowser } from "./browser-cloud.mjs";
import { dohLookup } from "./web-cloud.mjs";
import { assertPublicUrl } from "../computer/tools.mjs";
import { randomBytes } from "node:crypto";
import { AgentHub } from "../agent-link/hub.mjs";
import { agentExtraTools, agentFolders } from "../agent-link/cloud-tools.mjs";
import { importBatch } from "../agent-link/migrate.mjs";
import { CAPABILITY_LABELS } from "../agent-link/protocol.mjs";

/** Places of the desktop that need the person's computer (phases 4–5): the screens hide them. */
export const CLOUD_HIDDEN = Object.freeze(["codigo", "ordenador", "dictado", "voz", "gestores", "copias", "cifrado", "carpetas", "personas-buzon"]);
/** API areas that need the person's computer or the desktop's mailbox: «not in the cloud». */
const DESKTOP_ONLY = /^\/api\/(peers|teams|code|computer|projects|voice|voice-live|dictation|backup|backups|encryption|password-managers|browser-sessions|vault|logins|sign-in-grants|folders|diagnostics|drag)(\/|$)/;
/** With a machine and a browser (Phase 4) «Código» and the bots' browser work here; apps of a computer never do. */
const DESKTOP_ONLY_P4 = /^\/api\/(peers|teams|computer\/apps|projects|voice|voice-live|dictation|backup|backups|encryption|password-managers|browser-sessions|vault|logins|sign-in-grants|folders|diagnostics|drag)(\/|$)/;
/** «Código» requests that may carry the person's engine keys to the machine (they can start a turn). */
const ENGINE_CALLS = /^\/api\/code\/tasks(\/[^/]+\/(messages|goal|review|compact|plans\/[^/]+|asks\/[^/]+|edit-from|catch-up))?$|^\/api\/code\/compare\//;
const PREVIEW_TTL_MS = 12 * 3600 * 1000;
/** What a guest may change: talking in the conversations they can see, and their own read marks. */
const GUEST_WRITES = [/^\/api\/cloud\/onboarding$/,/^\/api\/chat\//, /^\/api\/missions\/[^/]+\/messages$/, /^\/api\/rooms\/[^/]+\/(messages|seen)$/, /^\/api\/notifications(\/|$)/, /^\/api\/messages\/[^/]+\/reactions$/];
/** The guided start's steps (src/cloud/Setup.jsx), in order. */
export const ONBOARDING_STEPS = Object.freeze(["ia", "bots", "equipo", "escritorio", "llegada"]);
const MISSION_PATH = /^\/api\/(missions|rooms)\/([^/]+)/;
const MEMBER_FIELDS = (m) => ({ id: m.id, name: m.name || m.email || "Alguien", email: m.email || null, role: ROLES.includes(m.role) ? m.role : "member", deactivated: !!m.deactivated });
/** Uploads that are bytes, not JSON (the Durable Object streams them itself; Node gets them here). */
const BINARY_WRITES = [/^\/api\/chat\/files$/, /^\/api\/chat\/import\/[^/]+\/parts\/\d+$/];

const noSession = () => ({ status: () => null, models: [], start: async () => { throw Error("No disponible en la nube."); }, closePending() {}, logout: async () => ({ ok: true }), listModels: async () => [] });

/**
 * `store`: the workspace's store; `workspace` {id, name}; `masters`: [{kid, secret}] for the
 * envelope vault (none: secrets unavailable); `files`: where mission files live (SqlFiles or
 * R2Files, server/file-store.mjs); `log`.
 */
export function hostWorkspace({ store, workspace, masters = [], files = null, blobs = null, vapid = null, previews = undefined, defer = (p) => p?.catch?.(() => {}), presence = () => new Map(), log = (m) => console.warn("[nube] " + m), publicUrl = "", testing = false, fetchImpl = undefined, machine = null, browserDriver = null, machineInfo = null, agentSockets = () => [], google = null, googleEndpoints = null, tcp = null }) {
  // The marketplace: `google` Colmena's web Google client (null = «Disponible pronto»), `tcp` the
  // Worker's TCP sockets for mail (cloud/src/tcp.js). Both reach cloudBots.
  // Phase 4: `machine` (server/machine/seam.mjs › machineClient, the company's container: «Código»,
  // run_command, Office previews) and `browserDriver` (Browser Rendering pages: browser-cloud.mjs).
  // Phase 5 (the local agent): `agentSockets(tag)` lists the open agent sockets of a device
  // (server/agent-link/hub.mjs); none in tests that do not need them.
  // Phase 3 (bots): `publicUrl` (webhook addresses, MCP sign-in callbacks), `testing` (the Worker
  // allows the fake model; each workspace still needs its test flag), `fetchImpl` (tests).
  // Team messaging (Phase 2): `blobs` (server/cloud/blobs.mjs: uploads, import parts), `vapid`
  // {publicKey, privateKey, subject} for Web Push (none: no pushes), `previews` (url → a link
  // preview; default: fetched with SSRF protection; false: none), `defer(promise)`: work that
  // outlives a response, `presence()` → Map(person → "active"|"away") of the open screens.
  if (!workspace?.id) throw Error("Espacio no válido.");
  store.personal = personalFields();
  // No disk: mission files (attachments, deliverables) go to `files` (server/file-store.mjs).
  if (files && store.directory) mountFiles(store.directory, files);
  // --- secrets: the envelope vault (one namespace per desktop vault)
  let vault = () => null;
  if (masters.length) {
    const keyring = new WorkspaceKeyring({
      workspace: workspace.id, masters,
      load: () => store.get("cloud", "vault-key"),
      save: (record) => store.put("cloud", { ...record, id: "vault-key" }, { silent: true }),
    });
    const records = {
      get: (id) => store.get("sealedSecrets", id),
      put: (record) => store.put("sealedSecrets", record, { silent: true }),
      remove: (id) => store.remove("sealedSecrets", id),
    };
    vault = (namespace) => envelopeVault({ keyring, records, namespace });
  }

  // --- the people of this workspace (synced from the directory: cloud/src/directory.js)
  // Everyone the directory lists, deactivated people included (their names stay on what they wrote).
  const everyone = () => store.list("members").filter((m) => !m.removedAt).map(MEMBER_FIELDS);
  const members = () => everyone().filter((m) => !m.deactivated);
  const memberOf = (id) => { const m = store.get("members", id); return m && !m.removedAt && !m.deactivated ? MEMBER_FIELDS(m) : null; };
  /**
   * Where this person is in the guided start: {started, step, finished}. No record: not started
   * (people who joined before it existed are never sent back to it).
   */
  const onboardingOf = (id) => { const r = store.get("cloud", "onboarding:" + id); return { started: !!r, step: ONBOARDING_STEPS.includes(r?.step) ? r.step : ONBOARDING_STEPS[0], finished: !!r?.finished }; };
  /** Who may see a conversation: everyone in the workspace, or only its `audience` (a direct message). */
  const canSee = (mission, person = currentPerson()) => !mission?.audience || (isPerson(person) && mission.audience.includes(person.id));
  const missionOf = (id) => store.get("missions", id) || (store.get("rooms", id)?.missionId ? store.get("missions", store.get("rooms", id).missionId) : null);

  const rooms = {
    me: () => {
      const p = currentPerson();
      return isPerson(p) ? { address: personAddress(p.id), name: p.name || "Tú" } : { address: null, name: "Colmena" };
    },
    /** Who is in a room: its audience, or everyone in the workspace. */
    people: (room, mission) => {
      const me = currentPerson();
      const ids = mission?.audience || members().map((m) => m.id);
      return ids.map((id) => memberOf(id)).filter(Boolean).map((m) => ({
        address: personAddress(m.id), name: m.id === me.id ? m.name : m.name, role: m.role === "guest" ? "guest" : m.role === "owner" || m.role === "admin" ? "owner" : "member",
        presence: "offline", status: { mode: "available", until: null }, you: m.id === me.id,
      }));
    },
    /** What a new sala carries here: a conversation of people (no bot turn unless one is named). */
    mission: () => ({ people: true, createdBy: currentPerson().id || null }),
  };

  // Bots (Phase 3): runtime, scheduler, connections and per-person AI accounts (bots-host.mjs).
  let appRef = null, pushRef = null;
  // The bots' browser (Phase 4): Browser Rendering pages, cookie jars sealed in the vault.
  const browser = browserDriver ? cloudBrowser({
    driver: browserDriver, vault: (ns) => (masters.length ? vault(ns) : null), log,
    checkUrl: async (u) => { await assertPublicUrl(u, { resolve: dohLookup(fetchImpl || fetch) }); },
  }) : null;
  const bots = cloudBots({
    computer: browser, machine, google, googleEndpoints, tcp,
    store, workspace, vault: (ns) => (masters.length ? vault(ns) : null), memberOf, members, publicUrl, testing, fetchImpl, log,
    push: (personId, payload) => pushRef?.(personId, payload), rooms: () => appRef?.locals?.rooms,
  });
  const runtime = bots.runtime;

  // Phase 5: each person's computers lend what only they have (server/agent-link): folders read
  // through the agent, browser, apps and commands, saved logins and Claude Code of that computer.
  const agents = new AgentHub({
    store, workspace, memberOf, sockets: agentSockets, log,
    bots: () => store.list("bots").filter((b) => b.enabled !== false).map((b) => ({ id: b.id, name: b.name })),
    importer: (member, batch) => importBatch(store, member, batch),
  });
  runtime.agentFolders = agentFolders(runtime, agents, { memberOf });
  const cloudExtra = runtime.extraTools;
  const agentTools = agentExtraTools(runtime, agents, { memberOf });
  runtime.extraTools = (bot, mission) => [...cloudExtra(bot, mission), ...agentTools(bot, mission)];

  const guard = (req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Cache-Control": "no-store" });
    let person = null;
    try { person = JSON.parse(String(req.headers["x-colmena-person"] || "")); } catch {}
    if (!person || typeof person.id !== "string" || !ROLES.includes(person.role)) return res.status(401).json({ error: "Inicia sesión para entrar en este espacio." });
    // The directory's word is the request's; the workspace's own list is what others see of them.
    const known = store.get("members", person.id);
    if (!known || known.removedAt || known.deactivated) return res.status(403).json({ error: "Ya no perteneces a este espacio." });
    const write = !["GET", "HEAD"].includes(req.method);
    if (req.path.startsWith("/api/") && write && req.is("application/json") === false && !(req.method === "PUT" && BINARY_WRITES.some((re) => re.test(req.path)))) return res.status(415).json({ error: "Se requiere JSON." });
    if ((machine || browser ? DESKTOP_ONLY_P4 : DESKTOP_ONLY).test(req.path) || (!machine && /^\/api\/code(\/|$)/.test(req.path)) || (!browser && /^\/api\/computer(\/|$)/.test(req.path))) return res.status(404).json({ error: "Esto solo está en la aplicación de escritorio por ahora.", desktopOnly: true });
    if (person.role === "guest" && write && !GUEST_WRITES.some((re) => re.test(req.path))) return res.status(403).json({ error: "Como invitado puedes leer y escribir en las conversaciones, no cambiar el espacio." });
    const target = MISSION_PATH.exec(req.path);
    if (target && !["", "new"].includes(target[2])) {
      const mission = missionOf(decodeURIComponent(target[2]));
      if (mission && !canSee(mission, person)) return res.status(404).json({ error: "No existe esa conversación." });
    }
    // The company's zone defaults to the first owner's browser (bots-host.mjs › adoptTimeZone).
    if (req.headers["x-colmena-time-zone"]) { try { bots.adoptTimeZone(req.headers["x-colmena-time-zone"], person); } catch {} }
    asPerson({ id: person.id, name: person.name || known.name || null, email: person.email || known.email || null, role: person.role }, next);
  };
  /** After the body is read: what this person may do with bots and approvals (bots-host.mjs). */
  const afterBody = (req, res, next) => {
    const person = currentPerson();
    if (!isPerson(person)) return next();
    const refused = bots.guard(req, person);
    if (refused) return res.status(refused.status).json({ error: refused.error });
    next();
  };

  /** /api/state as each person sees it: their name, the conversations they may see. */
  const state = (s) => {
    const me = currentPerson();
    const hidden = new Set((s.missions || []).filter((m) => m.audience && !m.audience.includes(me.id)).map((m) => m.id));
    for (const m of store.list("missions")) if (!canSee(m, me)) hidden.add(m.id);
    return bots.filterState({
      ...s,
      // The desktop welcome (AI account, this computer) does not apply: hosted people start in the app.
      settings: { ...(s.settings || {}), userName: me.name || me.email || "", onboarded: true },
      missions: (s.missions || []).filter((m) => !hidden.has(m.id)),
      rooms: (s.rooms || []).filter((r) => !hidden.has(r.missionId || r.id)),
      notifications: (s.notifications || []).filter((n) => !n.missionId || !hidden.has(n.missionId)),
      // The company is the one team the sidebar names (rooms carry no teamId: they show in it).
      teams: [{ id: workspace.id, name: store.get("cloud", "workspace")?.title || workspace.name || "Empresa", people: members().length, bots: store.list("bots").filter((b) => b.enabled !== false).length, admin: ["owner", "admin"].includes(me.role), current: true }],
      teamsPending: [],
      cloud: { workspace: { id: workspace.id, name: store.get("cloud", "workspace")?.title || workspace.name || "" }, timezone: bots.timeZone(), me: { id: me.id, name: me.name, email: me.email, role: me.role }, members: members(), hidden: machine ? CLOUD_HIDDEN.filter((h) => h !== "codigo") : CLOUD_HIDDEN, machine: !!machine, browser: !!browser, apiKeysOnly: true, onboarding: onboardingOf(me.id),
        // A desktop app of this person paired with the company (approved or online): the web stops recommending it.
        hasDesktop: (() => { try { return agents.list(me).some((d) => d.status === "approved" || d.online); } catch { return false; } })() },
    }, me);
  };

  // ---- team messaging (server/cloud/chat.mjs): its live frames go to the open feeds they are for
  const chatFeeds = new Set(); // {person, write, watching()}
  const chatEmit = (event, { people = [], channel = null } = {}) => {
    const to = people === "all" ? null : new Set(people);
    for (const feed of chatFeeds) {
      const pid = feed.person.id;
      let ok = to ? to.has(pid) : true;
      if (!ok && channel && feed.watching?.() === channel) ok = chat.canRead(feed.person, chat.row(channel));
      if (ok && chat.member(pid)) { try { feed.write(event); } catch {} }
    }
  };
  const blobStore = blobs || new MemoryBlobs({ max: 32 * 1024 * 1024 });
  const chat = new TeamChat({
    store, people: { list: everyone, get: (id) => { const m = store.get("members", id); return m && !m.removedAt ? MEMBER_FIELDS(m) : null; } },
    emit: chatEmit, presence, blobs: blobStore, defer, log, zone: () => bots.timeZone(),
    bots: () => channelBots.list(), onPost: (person, view, row) => channelBots.onPost(person, view, row),
    previews: previews === false ? null : previews || ((url) => fetchPreview(url)),
  });
  const pushSend = vapid?.publicKey && vapid?.privateKey ? async (personId, payload) => {
    let sent = 0;
    for (const target of chat.pushTargets(personId)) {
      try {
        const r = await sendPush({ subscription: target, payload, vapid: { subject: vapid.subject || "mailto:avisos@colmena.invalid", publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
        if (r.gone) chat.dropPush(target.id); else if (r.ok) sent++;
      } catch (error) { log("push: " + (error?.message || error)); }
    }
    return { sent };
  } : null;
  chat.push = pushSend;
  pushRef = pushSend;
  // Bots named in channels answer in the thread (channel-bots.mjs), as the person who named them.
  const channelBots = new ChannelBots({ store, runtime, chat, canThink: (person) => bots.provider.connectedFor(person.id), log });
  const importer = new SlackImport({ chat, blobs: blobStore, log });

  // ---- the workspace's own routes (people, direct messages); after the guard like the rest
  const routes = (app) => {
  chatRoutes(app, { chat, importer, blobs: blobStore, workspace: { id: workspace.id, name: store.get("cloud", "workspace")?.title || workspace.name || "" }, presence, push: pushSend ? { publicKey: vapid.publicKey, send: pushSend } : null });
  app.get("/api/cloud/members", (_req, res) => res.json(members()));
  app.post("/api/cloud/dm", (req, res) => {
    const me = currentPerson();
    const other = memberOf(String(req.body?.person || ""));
    if (!other) return res.status(404).json({ error: "Esa persona no está en este espacio." });
    if (other.id === me.id) return res.status(400).json({ error: "Elige a otra persona." });
    const audience = [me.id, other.id].sort();
    const key = audience.join("|");
    const found = store.list("missions").find((m) => m.dm === key);
    if (found) return res.json({ missionId: found.id, href: "/sala/" + found.id });
    const title = [me.name || me.email, other.name].filter(Boolean).join(" · ").slice(0, 80) || "Mensaje directo";
    const taken = new Set(store.list("missions").map((m) => m.room).filter(Boolean));
    const mission = {
      id: randomUUID(), title, room: roomSlug(title, taken), prompt: "", mode: "equipo", kind: "sala", kindBy: "created", botIds: [], conversation: false, conversationOf: null,
      safety: "preguntar", status: "completed", createdAt: now(), completedAt: null, error: null, steps: [], automationId: null, learningStatus: "skipped",
      priorMessages: [], chosenBotIds: [], plan: null, people: true, audience, dm: key, createdBy: me.id,
    };
    store.put("missions", mission);
    res.status(201).json({ missionId: mission.id, href: "/sala/" + mission.id });
  });
  // The guided start (src/cloud/Setup.jsx): the step each person reached, so leaving and coming
  // back resumes there. One record per person; `finished` once they reach the end or close it.
  app.get("/api/cloud/onboarding", (_req, res) => res.json({ onboarding: onboardingOf(currentPerson().id) }));
  app.put("/api/cloud/onboarding", (req, res) => {
    const me = currentPerson();
    const step = String(req.body?.step || "");
    if (!ONBOARDING_STEPS.includes(step)) return res.status(400).json({ error: "Ese paso no existe." });
    const before = onboardingOf(me.id);
    const record = { id: "onboarding:" + me.id, step, finished: req.body?.finished === true || before.finished, at: new Date().toISOString() };
    store.put("cloud", record, { silent: true });
    res.json({ onboarding: onboardingOf(me.id) });
  });
  app.get("/api/cloud/me", (_req, res) => res.json({ person: currentPerson(), workspace: state({}).cloud.workspace }));
  // The machine's state for Empresa › Hora y máquina (the Machine DO: running, minutes, cold starts).
  app.get("/api/cloud/machine", async (_req, res) => { try { res.json(machineInfo ? await machineInfo() : { configured: false }); } catch (error) { res.status(502).json({ error: "La máquina no responde ahora." }); log("machine status: " + (error?.message || error)); } });
  // «Tomar el control» from the web (Phase 4): the person's clicks, typing and keys on the live
  // frame reach the bots' cloud browser while they have the control (browser-cloud.mjs › input).
  if (browser) app.post("/api/computer/input", async (req, res) => {
    const b = req.body || {};
    const missionId = String(b.missionId || "").slice(0, 200);
    const mission = store.get("missions", missionId);
    if (!mission || !canSee(mission)) return res.status(404).json({ error: "No existe esa conversación." });
    if (!["click", "type", "key", "scroll", "open"].includes(b.kind)) return res.status(400).json({ error: "Acción no válida." });
    try {
      res.json(await browser.call("input", { missionId, kind: b.kind, x: Number(b.x) || 0, y: Number(b.y) || 0, text: typeof b.text === "string" ? b.text.slice(0, 2000) : "", key: typeof b.key === "string" ? b.key.slice(0, 20) : "", up: !!b.up, url: typeof b.url === "string" ? b.url.slice(0, 2000) : "" }));
    } catch (error) { res.status(409).json({ error: error.message }); }
  });
  // «Tus dispositivos»: your computers, which are online and what each lends; approve, rename, revoke.
  const agentRoute = (fn) => async (req, res) => {
    try { res.status(req.method === "POST" && !req.params.id ? 201 : 200).json(await fn(req, currentPerson())); } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  };
  app.get("/api/agent/devices", agentRoute((_req, me) => ({ devices: agents.list(me), labels: CAPABILITY_LABELS, workspace: { id: workspace.id } })));
  app.post("/api/agent/devices", agentRoute(async (req, me) => ({ device: await agents.register(me, req.body || {}), workspace: { id: workspace.id } })));
  app.post("/api/agent/devices/:id/approve", agentRoute((req, me) => ({ device: agents.approve(me, req.params.id) })));
  app.patch("/api/agent/devices/:id", agentRoute((req, me) => ({ device: agents.rename(me, req.params.id, req.body?.name) })));
  app.delete("/api/agent/devices/:id", agentRoute((req, me) => ({ device: agents.revoke(me, req.params.id) })));
  bots.routes(app);
  };
  const app = createApp({ store, runtime, session: noSession(), scheduler: bots.scheduler, connections: bots.connections, getOrigin: () => "https://colmena.invalid", computer: browser, ...(machine ? { office: machine.office() } : {}), hosted: { guard, afterBody, state, rooms, routes, approvers: bots.approvers } });
  appRef = app;
  // Takeovers of the cloud browser reach the open screens over the live socket (app.mjs › openFeed).
  browser?.onEvent((e) => { for (const fn of [...store.listeners]) { try { fn({ type: "computer_" + e.event, mission: e.missionId, botId: e.botId }); } catch {} } });
  app.locals.webhooks = bots.webhooks;

  // ---- «Código» and previews through the company's machine (Phase 4)
  const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  /**
   * A request of the app under /api/code, as `person` (the Worker's word): members and admins
   * only. A call that can start a turn carries the person's API keys to the machine; a
   * preview link is made here (POST /api/code/tasks/:id/preview-link {port}).
   */
  async function machineProxy({ method = "GET", path, search = "", headers = {}, body = null, person }) {
    if (!machine) return jsonResponse({ error: "Esto solo está en la aplicación de escritorio por ahora.", desktopOnly: true }, 404);
    const who = person?.id ? memberOf(person.id) : null;
    if (!who) return jsonResponse({ error: "Ya no perteneces a este espacio." }, 403);
    if (who.role === "guest") return jsonResponse({ error: "Como invitado no puedes usar «Código»." }, 403);
    const link = /^\/api\/code\/tasks\/([^/]+)\/preview-link$/.exec(path);
    if (link && method === "POST") {
      let port = 0;
      try { port = Number(JSON.parse(Buffer.from(body || []).toString("utf8") || "{}").port); } catch {}
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8080) return jsonResponse({ error: "Puerto no válido." }, 400);
      const check = await machine.request("/api/code/tasks/" + encodeURIComponent(link[1]), { headers: { "X-Colmena-Person": JSON.stringify(who) } });
      if (!check.ok) return jsonResponse({ error: "No existe esa tarea." }, 404);
      const token = randomBytes(24).toString("base64url");
      const at = Date.now();
      for (const old of store.list("previewLinks")) if (Date.parse(old.expiresAt) < at) store.remove("previewLinks", old.id);
      store.put("previewLinks", { id: token, taskId: link[1], port, personId: who.id, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + PREVIEW_TTL_MS).toISOString() }, { silent: true });
      return jsonResponse({ url: "/vista/" + workspace.id + "/" + token + "/", expiresAt: new Date(at + PREVIEW_TTL_MS).toISOString() });
    }
    const out = { "X-Colmena-Person": JSON.stringify({ id: who.id, name: who.name, email: who.email, role: who.role }) };
    // Tests: the fake Claude Code, only under the workspace's test flag (and the Worker's test secret).
    if (bots.fakeOn()) out["X-Colmena-Fake-Engine"] = "1";
    if (method !== "GET" && ENGINE_CALLS.test(path)) out["X-Colmena-Engine-Keys"] = b64url(await bots.engineKeys(who.id));
    for (const h of ["content-type", "accept", "last-event-id"]) if (headers[h]) out[h] = headers[h];
    // GitHub: the person's own token, else the company's (Empresa › IA y apps), else none.
    out["X-Colmena-GitHub-Token"] = (await bots.githubToken(who.id).catch(() => null)) || "";
    return machine.request(path + (search || ""), { method, headers: out, body: ["GET", "HEAD"].includes(method) ? null : body });
  }
  /**
   * /vista/<workspace>/<token>/… → a task's dev server. The token is the capability (unguessable,
   * one task and port, 12 h); the page runs sandboxed (an opaque origin): it can never read or act
   * on the app with the session of whoever opens it.
   */
  async function preview(token, rest = "/", { method = "GET", headers = {}, body = null, search = "" } = {}) {
    const link = /^[A-Za-z0-9_-]{32}$/.test(token || "") ? store.get("previewLinks", token) : null;
    if (!machine || !link || Date.parse(link.expiresAt) < Date.now() || !memberOf(link.personId)) return new Response("Esta vista previa ha caducado. Ábrela otra vez desde «Código».", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const out = {};
    for (const h of ["accept", "content-type", "accept-language", "if-none-match", "if-modified-since"]) if (headers[h]) out[h] = headers[h];
    const r = await machine.request("/machine/port/" + link.port + (rest.startsWith("/") ? rest : "/" + rest) + (search || ""), { method, headers: out, body: ["GET", "HEAD"].includes(method) ? null : body });
    const h = new Headers(r.headers);
    for (const k of ["set-cookie", "content-security-policy", "x-frame-options", "strict-transport-security"]) h.delete(k);
    h.set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors 'self'");
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Cache-Control", "no-store");
    h.set("Referrer-Policy", "no-referrer");
    return new Response(r.body, { status: r.status, headers: h });
  }

  return {
    app, store, runtime, bots, channelBots, agents, browser, machine, machineProxy, preview,
    /** Replaces the workspace's list of people (the directory's, after any change). */
    syncMembers(list, { name = null } = {}) {
      const at = now();
      const keep = new Set(list.map((m) => m.id));
      store.tx(() => {
        for (const m of list) store.put("members", { ...MEMBER_FIELDS(m), deactivatedAt: m.deactivated ? m.deactivatedAt || at : null, joinedAt: store.get("members", m.id)?.joinedAt || at, removedAt: null }, { silent: true });
        for (const m of store.list("members")) if (!keep.has(m.id) && !m.removedAt) store.put("members", { ...m, removedAt: at }, { silent: true });
        if (name) store.put("cloud", { ...(store.get("cloud", "workspace") || { id: "workspace" }), title: String(name).slice(0, 80) }, { silent: true });
      });
      for (const fn of store.listeners) try { fn({ type: "changed-local", kinds: ["members", "settings"] }); } catch {}
      chat.syncPeople(everyone());
      chatEmit({ type: "chat.people", people: chat.directory() }, { people: "all" });
      return members();
    },
    members,
    canSee: (missionId, person) => { const m = missionOf(missionId); return !m || canSee(m, person); },
    /** A live feed for one screen, as its person: frames they may not see never reach them. */
    /** `watching()`: the channel this screen has open (its live frames reach it even before joining). */
    openFeed(person, write, { watching = null } = {}) {
      const allowed = (event) => {
        const mission = event?.mission || event?.missionId || null;
        if (!mission) return true;
        const m = store.get("missions", mission);
        return !m || canSee(m, person);
      };
      const feed = { person, write, watching };
      chatFeeds.add(feed);
      const close = asPerson(person, () => app.locals.openFeed((event) => { if (allowed(event)) write(event); }, { as: (fn) => asPerson(person, fn) }));
      return () => { chatFeeds.delete(feed); close(); };
    },
    chat, importer, blobs: blobStore, chatEmit,
    push: pushSend,
    /** An admin action the Worker handled (the directory's), in the audit log. */
    audit(entry) { chat.audit(entry?.actor || null, String(entry?.action || "admin"), entry?.target || null, entry?.details || null); },
    /**
     * Background upkeep (Workspace#alarm): a step of a running import, the mail digest, retention,
     * unsent uploads. `invite(startedBy, people)` and `mail(digest)` reach the directory and the
     * mail provider. Returns when it wants to run next (ms).
     */
    async tick({ invite = null, mail = null, now: at = Date.now() } = {}) {
      // Bots first (routines due, question waits, renewed limits): short, and nobody waits on an import.
      await bots.tick(at);
      const running = importer.active();
      if (running) {
        await importer.step({ invite: invite ? (people) => invite(running.startedBy, people) : null });
        if (importer.active()) return at + 250;
      }
      if (mail) for (const d of chat.digestDue(at)) { try { await mail(d); } catch (error) { log("digest: " + (error?.message || error)); } }
      const last = chat.kvGet("upkeep-at")?.at || 0;
      if (at - last > 3600000) {
        for (let i = 0; i < 20; i++) {
          const r = chat.retention(at);
          for (const k of r.keys) await blobStore.remove(k).catch(() => {});
          if (!r.more) break;
        }
        for (const k of chat.sweepFiles(at)) await blobStore.remove(k).catch(() => {});
        chat.kvSet("upkeep-at", { at });
      }
      return this.nextAlarm(at);
    },
    nextAlarm(at = Date.now()) {
      if (importer.active()) return at + 250;
      const digest = chat.nextDigestAt();
      const upkeep = (chat.kvGet("upkeep-at")?.at || 0) + 3600000;
      return Math.max(at + 500, Math.min(digest ?? Infinity, upkeep, bots.nextAlarm(at) ?? Infinity));
    },
    /** After a wake-up (Workspace#boot): what an eviction cut goes on by itself. */
    resume: () => bots.resume(),
    /** A request to a routine's public address (/hooks/<workspace>/h/<id>). */
    hook: (hookId, request) => bots.hook(hookId, request),
    /** The test flags (only when the Worker allows tests): {fakeModel}. */
    setTestFlags: (flags) => bots.setTestFlags(flags),
    /** Bots at work right now (missions running in this object). */
    working: () => runtime.active.size,
    /** Background work (an alarm) as nobody in particular. */
    background: (fn) => asPerson(SYSTEM_PERSON, fn),
    log,
  };
}
