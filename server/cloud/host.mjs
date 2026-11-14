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

/** Places of the desktop that need the person's computer (phases 4–5): the screens hide them. */
export const CLOUD_HIDDEN = Object.freeze(["codigo", "ordenador", "dictado", "voz", "gestores", "copias", "cifrado", "carpetas", "personas-buzon"]);
/** API areas that need the person's computer or the desktop's mailbox: «not in the cloud». */
const DESKTOP_ONLY = /^\/api\/(peers|teams|code|computer|projects|voice|voice-live|dictation|backup|backups|encryption|password-managers|browser-sessions|vault|logins|sign-in-grants|folders|diagnostics|drag)(\/|$)/;
/** What a guest may change: talking in the conversations they can see, and their own read marks. */
const GUEST_WRITES = [/^\/api\/chat\//, /^\/api\/missions\/[^/]+\/messages$/, /^\/api\/rooms\/[^/]+\/(messages|seen)$/, /^\/api\/notifications(\/|$)/, /^\/api\/messages\/[^/]+\/reactions$/];
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
export function hostWorkspace({ store, workspace, masters = [], files = null, blobs = null, vapid = null, previews = undefined, defer = (p) => p?.catch?.(() => {}), presence = () => new Map(), log = (m) => console.warn("[nube] " + m), publicUrl = "", testing = false, fetchImpl = undefined }) {
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
  const bots = cloudBots({
    store, workspace, vault: (ns) => (masters.length ? vault(ns) : null), memberOf, members, publicUrl, testing, fetchImpl, log,
    push: (personId, payload) => pushRef?.(personId, payload), rooms: () => appRef?.locals?.rooms,
  });
  const runtime = bots.runtime;

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
    if (DESKTOP_ONLY.test(req.path)) return res.status(404).json({ error: "Esto solo está en la aplicación de escritorio por ahora.", desktopOnly: true });
    if (person.role === "guest" && write && !GUEST_WRITES.some((re) => re.test(req.path))) return res.status(403).json({ error: "Como invitado puedes leer y escribir en las conversaciones, no cambiar el espacio." });
    const target = MISSION_PATH.exec(req.path);
    if (target && !["", "new"].includes(target[2])) {
      const mission = missionOf(decodeURIComponent(target[2]));
      if (mission && !canSee(mission, person)) return res.status(404).json({ error: "No existe esa conversación." });
    }
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
      cloud: { workspace: { id: workspace.id, name: store.get("cloud", "workspace")?.title || workspace.name || "" }, me: { id: me.id, name: me.name, email: me.email, role: me.role }, members: members(), hidden: CLOUD_HIDDEN },
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
    emit: chatEmit, presence, blobs: blobStore, defer, log,
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
  app.get("/api/cloud/me", (_req, res) => res.json({ person: currentPerson(), workspace: state({}).cloud.workspace }));
  bots.routes(app);
  };
  const app = createApp({ store, runtime, session: noSession(), scheduler: bots.scheduler, connections: bots.connections, getOrigin: () => "https://colmena.invalid", computer: null, hosted: { guard, afterBody, state, rooms, routes, approvers: bots.approvers } });
  appRef = app;
  app.locals.webhooks = bots.webhooks;

  return {
    app, store, runtime, bots, channelBots,
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
