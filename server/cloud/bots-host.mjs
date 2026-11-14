// Bots in a hosted workspace (docs/CLOUD.md › Phase 3): the desktop's runtime, scheduler and
// connections inside the workspace's Durable Object, made for the cloud:
//
// - AI accounts per person (ai.mjs): a turn runs as the person who asked; routines as their owner.
// - Durable work: nothing waits on a timer of the object. Everything that must happen later is
//   in the store (missions, steps, approvals with their waits, routines with their next run,
//   limits with their renewal) and the object's alarm comes back for it (`tick`, `nextAlarm`).
//   Work cut by an eviction is resumed when the object wakes up (`resume`): the runtime marks
//   it interrupted when it is made, and each step that was half-way is told to check first.
// - Approvals reach the right person: the one who asked, or a routine's owner and the person
//   they delegated to (`approver: {personId}`), inside the company: in their Bandeja and by
//   Web Push. Nobody else sees them or may decide them.
// - Who may use bots, by role: owners, admins and members; guests read what bots say. Owners and
//   admins edit and remove any bot; members create bots and edit the ones they made.
// - Webhooks arrive at a public address of the workspace (/hooks/<workspace>/h/<id>), MCP
//   sign-ins come back to /api/mcp/oauth/callback, pages are read with SSRF checks
//   (web-cloud.mjs), deliverables are written to R2 (file-store.mjs).
// - The fake model (fake-model.mjs) only when the Worker allows tests and the workspace's test
//   flag is on.
import { Runtime } from "../runtime.mjs";
import { Scheduler } from "../scheduler.mjs";
import { Connections } from "../connections.mjs";
import { ComposioHub } from "../nexo/composio.mjs";
import { McpHub } from "../mcp/hub.mjs";
import { mcpExtraTools } from "../mcp/tools.mjs";
import { SiteVault } from "../vault.mjs";
import { SecretStore, secretsExtraTools } from "../secrets.mjs";
import { AppTools } from "../apptools.mjs";
import { Webhooks } from "../webhooks.mjs";
import { now } from "../store.mjs";
import { SYSTEM_PERSON, asPerson, currentPerson, isPerson } from "../identity.mjs";
import { personalProviders, aiPolicy, setAiPolicy, SUBSCRIPTION_WARNING } from "./ai.mjs";
import { fakeApps } from "./fake-model.mjs";
import { cloudWebFetch } from "./web-cloud.mjs";

export const TEST_FLAGS_ID = "test-flags";
const ACTIVE = new Set(["queued", "planning", "running"]);
/** While bots work the alarm comes back this often: the object stays awake and checks on them. */
export const HEARTBEAT_MS = 20_000;
const EVENT_POLL_MS = 60_000;
const MANAGERS = new Set(["owner", "admin"]);
const BOT_WRITE = /^\/api\/bots(?:\/([^/]+))?(?:\/.*)?$/;
const APPROVAL_PATH = /^\/api\/(?:approvals|connections\/review)\/([^/]+)/;

const refuse = (status, error) => ({ status, error });

/**
 * `vault(namespace)` (envelope vault or null), `memberOf(id)` → a member or null, `members()`,
 * `push(personId, payload)` or null, `publicUrl`, `testing` (the Worker allows the fake model).
 */
export function cloudBots({ store, workspace, rooms = () => null, vault = () => null, memberOf, members, push = null, publicUrl = "", testing = false, fetchImpl = undefined, log = () => {} }) {
  const fakeOn = () => !!testing && store.get("cloud", TEST_FLAGS_ID)?.fakeModel === true;
  const provider = personalProviders({ store, vaultFor: vault, fake: fakeOn, ...(fetchImpl ? { fetchImpl } : {}) });

  // ---- apps (Composio) for the company: its key in the vault; the test app under the flag.
  const composio = new ComposioHub({ vault: vault("connections") });
  const testApps = fakeApps();
  const connections = new Connections(store, { dispatch: (...args) => (fakeOn() ? testApps : composio).dispatch(...args) });

  const web = cloudWebFetch(fetchImpl ? { fetchImpl } : {});
  const runtime = new Runtime(store, provider, connections, {
    web, seed: true, suggest: false, review: false, autoTitle: false, narrate: false, recaps: false, speech: false, checkpoints: false, routing: false,
  });
  runtime.vault = new SiteVault(store, { secrets: vault("vault") });
  runtime.secrets = new SecretStore(store, { values: vault("secrets") });
  runtime.mcp = new McpHub(store, { secrets: vault("mcp"), redirect: publicUrl ? publicUrl.replace(/\/$/, "") + "/api/mcp/oauth/callback" : null });
  runtime.appTools = new AppTools(connections);
  const mcpTools = mcpExtraTools(runtime, runtime.mcp);
  const secretTools = secretsExtraTools(runtime, runtime.secrets);
  runtime.extraTools = (bot, mission) => [...mcpTools(bot, mission), ...secretTools(bot, mission), ...runtime.appTools.list(bot, mission, runtime)];

  // ---- whose account: the person who asked (a message, a mention), or the routine's owner
  const ownerOf = (mission) => {
    if (!mission) return null;
    const rule = mission.automationId ? store.get("automations", mission.automationId) : null;
    return mission.askedBy || rule?.ownerId || mission.createdBy || null;
  };
  const asker = () => { const p = currentPerson(); return isPerson(p) && memberOf(p.id) ? p : null; };
  const create = runtime.create.bind(runtime);
  runtime.create = (args) => {
    const mission = create(args);
    const p = asker();
    return p ? store.patch("missions", mission.id, { askedBy: p.id, createdBy: mission.createdBy || p.id }) : mission;
  };
  const addMessage = runtime.addMessage.bind(runtime);
  runtime.addMessage = (missionId, ...rest) => {
    const p = asker();
    if (p && store.get("missions", missionId) && store.get("missions", missionId).askedBy !== p.id) store.patch("missions", missionId, { askedBy: p.id });
    return addMessage(missionId, ...rest);
  };
  const launch = runtime.launch.bind(runtime);
  runtime.launch = (missionId) => {
    const mission = store.get("missions", missionId);
    const owner = memberOf(ownerOf(mission));
    if (owner?.role === "guest") {
      store.patch("missions", missionId, { status: "paused", error: "Los invitados pueden leer lo que dicen los bots, no ponerlos a trabajar." });
      return Promise.resolve();
    }
    if (!owner) return asPerson(SYSTEM_PERSON, () => launch(missionId));
    return asPerson({ id: owner.id, name: owner.name, email: owner.email, role: owner.role }, () => launch(missionId));
  };

  // ---- routines: their owner is who made them; their approver a person of the company
  const stamp = (change) => {
    if (change?.type !== "record" || change.op !== "insert") return;
    const p = asker();
    if (!p) return;
    if (change.kind === "automations" && !change.data?.ownerId) store.patch("automations", change.id, { ownerId: p.id });
    if (change.kind === "bots" && !change.data?.createdBy) store.patch("bots", change.id, { createdBy: p.id });
  };
  store.listeners.add(stamp);

  // ---- approvals: for whom, their Bandeja and a push
  const approversOf = (a) => {
    const mission = a?.missionId ? store.get("missions", a.missionId) : null;
    if (!mission) return null;
    const rule = mission.automationId ? store.get("automations", mission.automationId) : null;
    const ids = rule ? [rule.ownerId, rule.approver?.personId] : [mission.askedBy || mission.createdBy];
    const list = [...new Set(ids.filter((id) => id && memberOf(id)))];
    return list.length ? list : null;
  };
  const mayDecide = (a, person) => {
    const who = a?.for || approversOf(a);
    return !who || who.includes(person.id);
  };
  const announced = new Set();
  const announce = (id) => {
    const a = store.get("approvals", id);
    if (!a || a.status !== "pending" || a.deferred && !a.for || announced.has(id)) return;
    announced.add(id);
    const who = a.for || approversOf(a);
    if (!who) return;
    const mission = store.get("missions", a.missionId);
    const bot = store.get("bots", a.botId);
    const title = (bot?.name || "Un bot") + " necesita tu OK";
    const text = String(a.title || a.review?.name || a.summary || "Una acción que espera tu decisión").slice(0, 160);
    store.put("notifications", { id: "approval:" + id, kind: "approval", missionId: a.missionId, botId: a.botId || null, title, text, url: "/bandeja", read: false, createdAt: now(), for: who, approvalId: id });
    if (push) for (const pid of who) Promise.resolve(push(pid, { title, body: text + (mission?.title ? " · " + mission.title : ""), url: "/bandeja", tag: "approval-" + id })).catch((e) => log("push: " + (e?.message || e)));
  };
  const onApproval = (change) => {
    if (change?.type !== "record" || change.kind !== "approvals" || !change.data) return;
    const a = change.data;
    if (a.status !== "pending" || a.kind === "plan" && a.decidedBy) return;
    if (!a.for) {
      const who = approversOf(a);
      if (who) store.patch("approvals", a.id, { for: who });
    }
    // A moment later: an action the rules approve at once never bothers anyone.
    setTimeout(() => { try { announce(a.id); } catch (e) { log("approval: " + (e?.message || e)); } }, 1500);
  };
  store.listeners.add(onApproval);

  // ---- the scheduler: ticked by the object's alarm, never by its own timers
  const scheduler = new Scheduler(store, runtime, () => provider.anyConnected(), { connections, fetchPage: web });

  // ---- webhooks: a public address of this workspace instead of the mailbox
  const hookBase = publicUrl ? publicUrl.replace(/\/$/, "") + "/hooks/" + workspace.id : null;
  const hookPeers = {
    relayUrl: () => hookBase, identity: { box: { pub: "" } },
    client: { putHook: async () => ({ ok: true }), deleteHook: async () => ({ ok: true }) },
    on() {}, off() {},
  };
  const webhooks = new Webhooks({ store, peers: hookPeers, secrets: runtime.secrets, enqueue: (ruleId, event) => scheduler.enqueue(ruleId, event), log });

  // ---------------------------------------------------------------- the guard's part
  /** Refusal {status, error} for what this person may not do with bots and approvals, or null. */
  function guard(req, person) {
    const write = !["GET", "HEAD"].includes(req.method);
    const bot = write ? BOT_WRITE.exec(req.path) : null;
    if (bot) {
      if (person.role === "guest") return refuse(403, "Como invitado no puedes crear ni cambiar bots.");
      const id = bot[1] ? decodeURIComponent(bot[1]) : null;
      const record = id ? store.get("bots", id) : null;
      if (record && !MANAGERS.has(person.role) && record.createdBy !== person.id) return refuse(403, "Solo quien administra la empresa, o quien creó este bot, puede cambiarlo.");
    }
    if (write) {
      const ids = APPROVAL_PATH.exec(req.path)?.[1] === "batch" ? (req.body?.items || []).map((x) => x?.id) : APPROVAL_PATH.exec(req.path) ? [decodeURIComponent(APPROVAL_PATH.exec(req.path)[1])] : [];
      for (const id of ids) {
        const a = typeof id === "string" ? store.get("approvals", id) : null;
        if (a && !mayDecide(a, person)) return refuse(403, "Esto lo decide quien lo pidió (o la persona en quien delegó).");
      }
    }
    if (/^\/api\/(auth\/(start|cancel|logout|models|local|anthropic\/cli))(\/|$)/.test(req.path)) return refuse(404, "Esto solo está en la aplicación de escritorio.");
    return null;
  }
  /** /api/state for one person: approvals and notices meant for others are not theirs. */
  function filterState(s, me) {
    const mine = (x) => !x?.for || x.for.includes(me.id);
    const approvals = (s.approvals || []).filter((a) => mine(store.get("approvals", a.id) || a));
    return { ...s, approvals, notifications: (s.notifications || []).filter((n) => mine(store.get("notifications", n.id) || n)), ai: { policy: aiPolicy(store), mine: provider.connectedFor(me.id), fake: fakeOn() } };
  }

  // ---------------------------------------------------------------- routes
  function routes(app) {
    const admin = (req) => { const me = currentPerson(); if (!MANAGERS.has(me.role)) throw Object.assign(Error("Solo quien administra la empresa puede cambiar esto."), { status: 403 }); return me; };
    const wrap = (fn) => async (req, res) => {
      try { res.json(await fn(req, res)); } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
    };
    app.get("/api/cloud/ai", wrap(() => {
      const me = currentPerson();
      return { policy: aiPolicy(store), warnings: SUBSCRIPTION_WARNING, engines: provider.engines?.() || [], connected: provider.connectedFor(me.id), fake: fakeOn(), chatgpt: provider.hub(me.id).config().chatgpt || null };
    }));
    app.put("/api/cloud/ai/policy", wrap((req) => {
      const me = admin(req);
      const body = req.body || {};
      return { policy: setAiPolicy(store, { chatgptLogin: body.chatgptLogin, claudeToken: body.claudeToken }, me.id), warnings: SUBSCRIPTION_WARNING };
    }));
    app.post("/api/cloud/ai/chatgpt/device", wrap(() => provider.hub(currentPerson().id).session.start()));
    app.post("/api/cloud/ai/chatgpt/device/poll", wrap(async () => {
      const out = await provider.hub(currentPerson().id).session.poll();
      if (out.status === "connected") for (const fn of store.listeners) try { fn({ type: "changed-local", kinds: ["account"] }); } catch {}
      return out;
    }));
    // The company's apps (Composio): its key, set by an admin, kept in the vault.
    app.put("/api/cloud/apps/key", wrap(async (req) => {
      admin(req);
      const key = String(req.body?.key || "").trim();
      if (!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw Object.assign(Error("Esa clave no tiene el formato de una clave de Composio."), { status: 400 });
      await connections.manage("configure", { key });
      return { ok: true };
    }));
    // The browser back from an MCP server's sign-in (a public redirect instead of a loopback one).
    app.get("/api/mcp/oauth/callback", async (req, res) => {
      const q = req.query || {};
      let ok = false;
      try { ok = await runtime.mcp.publicCallback({ state: String(q.state || ""), code: q.code ? String(q.code) : null, error: q.error ? String(q.error) : null }); } catch (e) { log("mcp: " + (e?.message || e)); }
      res.redirect(302, "/ajustes/conexiones?mcp=" + (ok ? "ok" : "error"));
    });
  }

  // ---------------------------------------------------------------- alarms
  /** Everything due now: routines, question waits, renewed limits, snoozed rooms, polled triggers. */
  async function tick(at = Date.now()) {
    await asPerson(SYSTEM_PERSON, async () => {
      try { scheduler.tick(at); } catch (e) { log("scheduler: " + (e?.message || e)); }
      try { runtime.sweepQuestions(); } catch (e) { log("questions: " + (e?.message || e)); }
      try { rooms()?.work?.tick?.(); } catch (e) { log("rooms: " + (e?.message || e)); }
      if (store.list("automations").some((r) => r.enabled !== false && r.trigger && !["dia", "semana", "vez", "cada", "webhook", "sala"].includes(r.trigger.type)))
        try { await scheduler.engine.pollDue(at); } catch (e) { log("triggers: " + (e?.message || e)); }
    });
  }
  /** When the alarm must come back for bots (null: nothing to wait for). */
  function nextAlarm(at = Date.now()) {
    const times = [];
    if (runtime.active.size || store.list("missions").some((m) => ACTIVE.has(m.status))) times.push(at + HEARTBEAT_MS);
    for (const r of store.list("automations")) {
      if (r.enabled === false) continue;
      const next = Date.parse(r.nextRun || "");
      if (Number.isFinite(next)) times.push(next);
      if ((r.queue || []).length) times.push(at + 1000);
      if (r.trigger && !["dia", "semana", "vez", "cada", "webhook", "sala"].includes(r.trigger.type)) times.push(at + EVENT_POLL_MS);
    }
    for (const a of store.list("approvals")) if (a.kind === "question" && a.status === "pending" && !a.timedOut && a.waitUntil) times.push(Date.parse(a.waitUntil) + 50);
    for (const m of store.list("missions")) if (m.status === "paused" && m.limited?.resumeAt) times.push(Date.parse(m.limited.resumeAt));
    const valid = times.filter(Number.isFinite);
    return valid.length ? Math.max(at + 500, Math.min(...valid)) : null;
  }
  /** After a wake-up: the work an eviction cut goes on by itself, as the person it is for. */
  function resume() {
    if (!provider.anyConnected()) return [];
    return asPerson(SYSTEM_PERSON, () => runtime.resumeInterrupted());
  }

  return {
    runtime, provider, connections, scheduler, webhooks, testApps, fakeOn, guard, filterState, routes, tick, nextAlarm, resume, mayDecide, approversOf,
    approvers: () => members().filter((m) => m.role !== "guest" && m.id !== currentPerson().id).map((m) => ({ id: m.id, name: m.name })),
    setTestFlags(flags = {}) {
      if (!testing) throw Error("Las pruebas no están permitidas en este despliegue.");
      store.put("cloud", { id: TEST_FLAGS_ID, fakeModel: flags.fakeModel === true, at: now() });
      return { fakeModel: fakeOn() };
    },
    /** A request to a routine's public address: {hookId, headers, body: Buffer}. */
    async hook(hookId, { headers = {}, body = Buffer.alloc(0) } = {}) {
      return asPerson(SYSTEM_PERSON, () => webhooks.handle({ hook: hookId, headers, body: Buffer.from(body).toString("base64url"), at: Date.now() }));
    },
    close() { store.listeners.delete(stamp); store.listeners.delete(onApproval); scheduler.stop(); provider.close(); },
  };
}
