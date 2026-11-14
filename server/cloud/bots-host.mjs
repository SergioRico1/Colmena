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
import { machineMcp } from "../mcp/local.mjs";
import { SiteVault } from "../vault.mjs";
import { SecretStore, secretsExtraTools } from "../secrets.mjs";
import { AppTools } from "../apptools.mjs";
import { Webhooks } from "../webhooks.mjs";
import { now } from "../store.mjs";
import { SYSTEM_PERSON, asPerson, currentPerson, isPerson } from "../identity.mjs";
import { personalProviders, aiPolicy, setAiPolicy, SUBSCRIPTION_CONSENT, SUBSCRIPTION_WARNING } from "./ai.mjs";
import { fakeApps } from "./fake-model.mjs";
import { cloudWebFetch, dohLookup } from "./web-cloud.mjs";
import { computerExtraTools } from "../computer/wire.mjs";
import { BROWSER_TOOLS } from "../computer/policy.mjs";
import { cleanTimeZone } from "../timezone.mjs";
import { randomUUID } from "node:crypto";

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
export function cloudBots({ store, workspace, rooms = () => null, vault = () => null, memberOf, members, push = null, publicUrl = "", testing = false, fetchImpl = undefined, log = () => {}, computer = null, machine = null, google = null, googleEndpoints = null, tcp = null }) {
  // The marketplace: `google` Colmena's web OAuth client ({clientId, clientSecret, project}, from
  // the Worker's secrets) or null; `tcp` the Worker's TCP sockets for mail (cloud/src/tcp.js).
  // Phase 4: `computer`, the cloud browser (browser-cloud.mjs); `machine`, the company's container
  // (server/machine/seam.mjs) where run_command runs.
  const fakeOn = () => !!testing && store.get("cloud", TEST_FLAGS_ID)?.fakeModel === true;
  const provider = personalProviders({ store, vaultFor: vault, fake: fakeOn, ...(fetchImpl ? { fetchImpl } : {}) });

  // ---- apps (Composio) for the company: its key in the vault; the test app under the flag.
  const composio = new ComposioHub({ vault: vault("connections") });
  const testApps = fakeApps();
  // Phase 4: apps per person. Someone who turns on «mis apps» gets a Composio profile of their own
  // (the company's key, their own Composio user): the accounts they connect are theirs, and their
  // bots' turns and routines use them. Everyone else keeps using the company's apps.
  const personalApps = (id) => !!id && store.get("cloud", "apps-mine:" + id)?.on === true;
  const appProfile = () => {
    const p = currentPerson();
    return isPerson(p) && personalApps(p.id) ? personProfile(p.id) : "default";
  };
  const connections = new Connections(store, { dispatch: (profile, ...rest) => (fakeOn() ? testApps : composio).dispatch(profile === "default" ? appProfile() : profile, ...rest) });

  const web = cloudWebFetch(fetchImpl ? { fetchImpl } : {});
  const runtime = new Runtime(store, provider, connections, {
    web, seed: true, suggest: false, review: false, autoTitle: false, narrate: false, recaps: false, speech: false, checkpoints: false, routing: false,
  });
  runtime.vault = new SiteVault(store, { secrets: vault("vault") });
  runtime.secrets = new SecretStore(store, { values: vault("secrets") });
  // The marketplace (docs/CONNECTIONS.md): Colmena's own Google client (Worker secrets, «Disponible
  // pronto» without it), official local servers in the company's machine, mail over the Worker's
  // TCP sockets, and personal connections for whoever keeps their apps to themselves.
  runtime.mcp = new McpHub(store, {
    secrets: vault("mcp"), redirect: publicUrl ? publicUrl.replace(/\/$/, "") + "/api/mcp/oauth/callback" : null,
    google: google ? { web: google, ...(googleEndpoints ? { endpoints: googleEndpoints } : {}), ...(fetchImpl ? { fetchImpl } : {}) } : null,
    local: machine ? machineMcp(machine) : null,
    localCommand: (e) => ({ command: "/opt/mcp/bin/" + e.local.command, args: [] }),
    tcp, personal: (id) => personalApps(id),
  });
  runtime.appTools = new AppTools(connections);
  // Composio with a person's own account (the marketplace): their key, in the vault under their
  // profile, checked live; it wins over the company's for them («Mis propias apps» on). Nobody
  // else's turns ever use it. Removing it puts them back on the company's key, if there is one.
  runtime.composioKey = {
    async status() {
      const me = currentPerson();
      const v = vault("connections");
      const mine = isPerson(me) && store.get("cloud", "apps-mine:" + me.id)?.ownKey === true;
      const company = !!(await v?.load({ profile: "default" }).catch(() => null))?.apiKey;
      return { configured: mine || company, mine, company, canRemove: mine };
    },
    async setKey(key) {
      const me = currentPerson();
      if (!isPerson(me) || me.role === "guest") throw Object.assign(Error("Los invitados no conectan apps."), { status: 403 });
      if (fakeOn()) { store.put("cloud", { id: "apps-mine:" + me.id, on: true, ownKey: true, at: now() }, { silent: true }); return; }
      await composio.dispatch(personProfile(me.id), "configure", { key });
      store.put("cloud", { id: "apps-mine:" + me.id, on: true, ownKey: true, at: now() }, { silent: true });
      for (const fn of store.listeners) try { fn({ type: "changed-local", kinds: ["account"] }); } catch {}
    },
    async removeKey() {
      const me = currentPerson();
      if (!isPerson(me)) return;
      await vault("connections")?.remove(personProfile(me.id));
      store.put("cloud", { id: "apps-mine:" + me.id, on: false, ownKey: false, at: now() }, { silent: true });
      for (const fn of store.listeners) try { fn({ type: "changed-local", kinds: ["account"] }); } catch {}
    },
  };
  const mcpTools = mcpExtraTools(runtime, runtime.mcp);
  const secretTools = secretsExtraTools(runtime, runtime.secrets);
  // The browser and run_command (Phase 4). Opening files and apps of a computer stays on the
  // desktop; without a machine there is no run_command either.
  runtime.machine = machine || null;
  runtime.resolveHost = dohLookup(fetchImpl || fetch);
  const CLOUD_COMPUTER = new Set([...(computer ? BROWSER_TOOLS : []), ...(machine ? ["run_command"] : [])]);
  const computerTools = computer || machine ? computerExtraTools(runtime, { computer: computer || { available: false, call: async () => { throw Error("Sin navegador."); }, onFrame: () => () => {}, onEvent: () => () => {}, lastFrame: () => null } }) : () => [];
  const cloudComputer = (bot, mission) => computerTools(bot, mission).filter((t) => CLOUD_COMPUTER.has(t.name));
  runtime.extraTools = (bot, mission) => [...mcpTools(bot, mission), ...secretTools(bot, mission), ...runtime.appTools.list(bot, mission, runtime), ...cloudComputer(bot, mission)];

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
      try { res.json(await fn(req, res)); } catch (error) { res.status(error.status || 400).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.consent ? { consent: error.consent } : {}) }); }
    };
    app.get("/api/cloud/ai", wrap(() => {
      const me = currentPerson();
      return { policy: aiPolicy(store), warnings: SUBSCRIPTION_WARNING, engines: provider.engines?.() || [], connected: provider.connectedFor(me.id), fake: fakeOn(), chatgpt: provider.hub(me.id).config().chatgpt || null, consent: provider.hub(me.id).config().consent || {}, consentLines: SUBSCRIPTION_CONSENT };
    }));
    app.put("/api/cloud/ai/policy", wrap((req) => {
      const me = admin(req);
      const body = req.body || {};
      return { policy: setAiPolicy(store, { chatgptLogin: body.chatgptLogin, claudeToken: body.claudeToken }, me.id), warnings: SUBSCRIPTION_WARNING };
    }));
    // «Entendido, conectar»: this person read the line for this provider (kept per person).
    app.post("/api/cloud/ai/consent", wrap((req) => {
      const me = currentPerson();
      if (me.role === "guest") throw Object.assign(Error("Los invitados no conectan cuentas de IA."), { status: 403 });
      return { consent: provider.hub(me.id).consent(String(req.body?.provider || "")) };
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
      await asPerson(SYSTEM_PERSON, () => connections.manage("configure", { key }));
      // People with apps of their own keep their Composio user; only the key changes.
      // (Someone with a Composio account of their own keeps it.)
      for (const r of store.list("cloud").filter((x) => String(x.id).startsWith("apps-mine:") && x.on && !x.ownKey)) await linkPersonalApps(r.id.slice(10)).catch((e) => log("apps: " + (e?.message || e)));
      return { ok: true };
    }));
    // GitHub for «Código» (Phase 4): a token of the company (admins) or of a person, in the vault.
    app.get("/api/cloud/github", wrap(async () => {
      const me = currentPerson();
      const v = vault("github");
      return { mine: !!(await v?.load({ profile: personProfile(me.id) }).catch(() => null))?.token, company: !!(await v?.load({ profile: "company" }).catch(() => null))?.token };
    }));
    app.put("/api/cloud/github", wrap(async (req) => {
      const me = currentPerson();
      const scope = req.body?.scope === "company" ? "company" : "mine";
      if (scope === "company") admin(req);
      if (me.role === "guest") throw Object.assign(Error("Los invitados no conectan GitHub."), { status: 403 });
      const token = String(req.body?.token || "").trim();
      const v = vault("github");
      if (!v) throw Object.assign(Error("GitHub necesita el almacén cifrado de la empresa."), { status: 503 });
      const binding = { profile: scope === "company" ? "company" : personProfile(me.id) };
      if (!token) { await v.remove(binding.profile); return { ok: true, removed: true }; }
      if (!/^(gh[pousr]_[A-Za-z0-9]{20,251}|github_pat_[A-Za-z0-9_]{20,240})$/.test(token)) throw Object.assign(Error("Eso no parece un token de GitHub (ghp_…, github_pat_… o el de una GitHub App)."), { status: 400 });
      await v.save(binding, { token, at: now(), by: me.id });
      return { ok: true, scope };
    }));
    // «Mis apps» (Phase 4): this person's own connected accounts instead of the company's.
    app.get("/api/cloud/apps/mine", wrap(() => ({ on: personalApps(currentPerson().id) })));
    app.put("/api/cloud/apps/mine", wrap(async (req) => {
      const me = currentPerson();
      if (me.role === "guest") throw Object.assign(Error("Los invitados no conectan apps."), { status: 403 });
      const on = req.body?.on === true;
      const ownKey = store.get("cloud", "apps-mine:" + me.id)?.ownKey === true;
      // A Composio account of their own is never replaced by the company's key.
      if (on && !ownKey) await linkPersonalApps(me.id);
      store.put("cloud", { id: "apps-mine:" + me.id, on, ownKey, at: now() }, { silent: true });
      for (const fn of store.listeners) try { fn({ type: "changed-local", kinds: ["account"] }); } catch {}
      return { on };
    }));
    // The company's time zone (routines, «no molestar» of people with none of their own).
    app.get("/api/cloud/timezone", wrap(() => ({ timezone: timeZone() })));
    app.put("/api/cloud/timezone", wrap((req) => {
      admin(req);
      const tz = cleanTimeZone(String(req.body?.timezone || ""));
      if (!tz) throw Object.assign(Error("Esa zona horaria no existe."), { status: 400 });
      return { timezone: setTimeZone(tz) };
    }));
    // The browser back from an MCP server's sign-in (a public redirect instead of a loopback one).
    app.get("/api/mcp/oauth/callback", async (req, res) => {
      const q = req.query || {};
      let ok = false;
      try { ok = await runtime.mcp.publicCallback({ state: String(q.state || ""), code: q.code ? String(q.code) : null, error: q.error ? String(q.error) : null }); } catch (e) { log("mcp: " + (e?.message || e)); }
      res.redirect(302, "/ajustes/apps?mcp=" + (ok ? "ok" : "error"));
    });
  }

  // ---------------------------------------------------------------- apps per person
  function personProfile(id) { return "p-" + String(id).replace(/[^A-Za-z0-9]/g, "").slice(0, 40); }
  /** The person's Composio profile: the company's key, a Composio user of their own (kept on key changes). */
  async function linkPersonalApps(id) {
    const v = vault("connections");
    if (!v) throw Object.assign(Error("Las apps necesitan el almacén cifrado de la empresa."), { status: 503 });
    const company = await v.load({ profile: "default" });
    if (!company?.apiKey) throw Object.assign(Error("Primero, quien administra la empresa conecta las apps (Empresa › IA y apps)."), { status: 409 });
    const binding = { profile: personProfile(id) };
    const mine = (await v.load(binding)) || {};
    await v.save(binding, { ...mine, apiKey: company.apiKey, userId: mine.userId || "colmena_p_" + randomUUID().replaceAll("-", ""), sessionId: mine.apiKey === company.apiKey ? mine.sessionId || null : null });
  }

  /** The GitHub token «Código» uses for this person: theirs, else the company's, else null. */
  async function githubToken(personId) {
    const v = vault("github");
    if (!v) return null;
    return (await v.load({ profile: personProfile(personId) }))?.token || (await v.load({ profile: "company" }))?.token || null;
  }

  // ---------------------------------------------------------------- «Código» engines
  /**
   * The API keys a person's «Código» engines run with in the machine: Anthropic, OpenAI and
   * OpenCode keys only. A subscription (Claude setup-token, ChatGPT sign-in) never goes there:
   * the providers' terms forbid using them in a hosted service (docs/CLOUD.md › Phase 3).
   */
  async function engineKeys(personId) {
    const hub = provider.hub(personId);
    const c = hub.config();
    return {
      anthropic: c.anthropic?.method === "api_key" ? await hub.secret("anthropic-apikey").catch(() => null) : null,
      openai: c.apikey ? await hub.loadKey().catch(() => null) : null,
      opencode: c.opencode ? await hub.secret("opencode-apikey").catch(() => null) : null,
    };
  }

  // ---------------------------------------------------------------- time zone
  const timeZone = () => store.get("settings", "main")?.timezone || null;
  /** Sets the company's zone and moves every timed routine's next run to it. */
  function setTimeZone(tz) {
    const settings = store.get("settings", "main") || { id: "main" };
    if (settings.timezone === tz) return tz;
    store.put("settings", { ...settings, id: "main", timezone: tz });
    const at = new Date();
    for (const rule of store.list("automations")) {
      if (rule.enabled === false || !rule.trigger || !["dia", "semana", "vez"].includes(rule.trigger.type)) continue;
      store.patch("automations", rule.id, { nextRun: scheduler.next({ ...rule }, at) });
    }
    return tz;
  }
  /** The first owner's browser names the zone until an admin chooses one (X-Colmena-Time-Zone). */
  function adoptTimeZone(value, person) {
    if (timeZone() || !MANAGERS.has(person?.role)) return null;
    const tz = cleanTimeZone(String(value || "").trim());
    return tz ? setTimeZone(tz) : null;
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
    runtime, provider, connections, scheduler, webhooks, testApps, fakeOn, guard, filterState, routes, tick, nextAlarm, resume, mayDecide, approversOf, timeZone, setTimeZone, adoptTimeZone, engineKeys, githubToken, appProfile, linkPersonalApps,
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
