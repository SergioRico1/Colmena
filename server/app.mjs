
import { createLiveCoalescer } from "./live-coalescer.mjs";
import { createLiveSnapshot } from "./live-snapshot.mjs";
import { commandOutput } from "./command-output.mjs";
import { watchQueues } from "./queue.mjs";
import { SiteVault, registerVaultRoutes } from "./vault.mjs";
import { McpHub } from "./mcp/hub.mjs";
import { registerMcpRoutes } from "./mcp/routes.mjs";
import { registerWorkFileRoutes } from "./workfiles.mjs";
import { createOfficeConverter } from "./officepdf.mjs";
import { registerTurnChangeRoutes } from "./turn-changes.mjs";
import { registerDragRoutes } from "./dragout.mjs";
import { SecretStore, registerSecretRoutes } from "./secrets.mjs";
import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createMissionFile } from "./files.mjs";
import { registerCoreRoutes, attachmentBodyParser } from "./core-routes.mjs";
import { buildState, automationView, ConnectorCache, approvalRevision } from "./state.mjs";
import { registerUsageRoutes } from "./usage-routes.mjs";
import { registerDiagnosticsRoutes } from "./diagnostics.mjs";

import { Scheduler } from "./scheduler.mjs";
import { registerLearningRoutes } from "./learning-routes.mjs";
import { registerComputerRoutes } from "./computer/routes.mjs";
import { registerProjectRoutes } from "./projects/routes.mjs";
import { registerCodeRoutes, codeUploadParser } from "./code/routes.mjs";
import { registerInteractionRoutes, extendState } from "./interject.mjs";
import { Watcher, registerWatchRoutes } from "./watch.mjs";
import { registerVoiceLiveRoutes } from "./voice-live.mjs";
import { registerPeerRoutes, peerFileParser } from "./peers/routes.mjs";
import { registerWebhookRoutes } from "./webhooks.mjs";
import { registerBtwRoutes } from "./btw.mjs";
import { Backups, registerBackupRoutes } from "./backup-service.mjs";
import { Encryption, registerEncryptionRoutes } from "./encryption.mjs";
import { windowsVault } from "./nexo/credential-vault.mjs";
import { olderChats } from "./threads.mjs";
import { registerGoalRoutes } from "./goals.mjs";
import { HttpError, zodMessage, notFound, SOON, short, check, safe, fold, inside } from "./routes/shared.mjs";
import { registerConnectionRoutes } from "./routes/connections.mjs";
import { registerSettingsRoutes } from "./routes/settings.mjs";
import { registerMissionRoutes } from "./routes/missions.mjs";
import { registerApprovalRoutes } from "./routes/approvals.mjs";
import { registerBotRoutes } from "./routes/bots.mjs";
import { registerSkillRoutes } from "./routes/skills.mjs";
import { registerArtifactRoutes } from "./routes/artifacts.mjs";
import { registerAutomationRoutes } from "./routes/automations.mjs";
import { registerSuggestionRoutes } from "./routes/suggestions.mjs";
import { registerFolderRoutes } from "./routes/folders.mjs";
import { registerNotificationRoutes } from "./routes/notifications.mjs";
import { registerTeamRoutes } from "./routes/teams.mjs";
import { registerRoomRoutes } from "./routes/rooms.mjs";
import { Rooms } from "./room.mjs";
import { teamsList, teamsPending } from "./peers/teams.mjs";
import { registerWikiRoutes, wikiImportParser } from "./routes/wiki.mjs";
import { attachWikiTools } from "./wiki-tools.mjs";
import { registerBlockRoutes } from "./routes/blocks.mjs";
import { attachBlockTools, pinnedBlocksState } from "./blocks.mjs";
export { HttpError, zodMessage, critiqueAbout } from "./routes/shared.mjs";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version;
const optionalModules = new Map();
function optional(name) {
  if (!optionalModules.has(name))
    optionalModules.set(
      name,
      import(new URL(name, import.meta.url).href).catch((error) => {
        if (error.code !== "ERR_MODULE_NOT_FOUND") console.warn("Colmena: no se pudo cargar " + name + ": " + error.message);
        optionalModules.delete(name); // retried on the next request
        return null;
      }),
    );
  return optionalModules.get(name);
}
/** Throws when a folder must never be shared with bots. Returns the canonical path. */
export async function validateFolder(input, dataDir) {
  if (!path.isAbsolute(input)) throw Error("Escribe la ruta completa de la carpeta (por ejemplo C:\\Users\\tu-nombre\\Documentos\\Contabilidad).");
  let real;
  try {
    real = await realpath(path.resolve(input));
  } catch {
    throw Error("Esa carpeta no existe.");
  }
  if (!(await stat(real)).isDirectory()) throw Error("Esa ruta no es una carpeta.");
  const canonical = async (p) => fold(await realpath(p).catch(() => p));
  const target = fold(real);
  const home = await canonical(os.homedir());
  const env = process.env;
  const system = [
    env.SystemRoot || env.windir || "C:\\Windows", env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432, env.ProgramData,
    env.APPDATA, env.LOCALAPPDATA, path.join(home, "AppData"), path.join(home, ".ssh"), path.join(home, ".config"),
    path.join(home, ".local"), path.join(home, ".gnupg"), path.join(home, "Library"),
    "/etc", "/usr", "/bin", "/sbin", "/lib", "/var", "/boot", "/dev", "/proc", "/sys", "/root", "/opt", "/System", "/Library", "/private", "/Applications",
  ].filter(Boolean).map(fold);
  const tmp = await canonical(os.tmpdir());
  const protectedDirs = [await canonical(dataDir), await canonical(APP_ROOT)];
  const refuse = "Por seguridad, Colmena no puede abrir esa carpeta. Elige una carpeta de trabajo concreta (por ejemplo, dentro de Documentos).";
  if (fold(path.parse(real).root) === target) throw Error(refuse);
  if (protectedDirs.some((d) => inside(target, d) || inside(d, target)))
    throw Error("Esa carpeta contiene los datos o el programa de Colmena. Elige otra.");
  if (inside(home, target)) throw Error(refuse); // the home folder itself or one of its parents
  const scratch = inside(target, tmp) && target !== tmp;
  if (!scratch && system.some((d) => inside(target, d) || inside(d, target))) throw Error(refuse);
  return real;
}

export function createApp({ store, runtime, session, scheduler, connections, getOrigin, computer = null, backups = null, dbKeys = null, office = null }) {
  const app = express(),
    csrf = randomBytes(32).toString("hex");
  app.disable("x-powered-by");
  let authError = null;
  session.emit = (event) => {
    if (event.kind === "auth-error") authError = event.message;
    if (event.kind === "auth-success") authError = null;
    for (const fn of store.listeners) fn({ type: "auth", kind: event.kind });
  };
  const emit = (kinds) => {
    for (const fn of store.listeners) safe(() => fn({ type: "changed-local", kinds }));
  };
  const connectorCache = new ConnectorCache(connections, () => emit(["connectors"]));
  const providerStatus = () => safe(() => runtime?.provider?.status?.());
  const aiConnected = () => {
    const status = providerStatus();
    if (status && "kind" in status) return !!status.kind;
    return !!safe(() => session.status?.()) && !!store.get("settings", "main")?.model;
  };
  scheduler ??= new Scheduler(store, runtime, aiConnected, { connections });
  // «Te avisa de lo importante» (watch.mjs): index.mjs starts it; tests drive tick() themselves.
  const watcher = new Watcher({
    store, connections, aiConnected, notifier: scheduler?.notifier || null,
    infer: (params, ctx) => runtime.infer(params, ctx),
    models: () => safe(() => runtime?.availableModels?.()) || [],
    modelFor: (bot) => runtime?.modelFor?.(bot, store.get("settings", "main")?.model) || store.get("settings", "main")?.model || "",
    addMessage: (missionId, text) => runtime.addMessage(missionId, text),
  });
  app.locals.watcher = watcher;
  // One room object over salas and conversations with people (server/room.mjs): made here so
  // every sala and every group has its room before the first request.
  const rooms = new Rooms({ store, runtime, getPeers: () => app.locals.peers }).start();
  app.locals.rooms = rooms;
  // Encrypted backups (backup-service.mjs): index.mjs starts their schedule; tests pass their own.
  app.locals.backups = backups || new Backups({ store, vault: (dir) => windowsVault(dir), keys: dbKeys, appVersion: VERSION });
  // «Cifrar este ordenador» (encryption.mjs): prepared here, applied at the next start.
  app.locals.encryption = new Encryption({ store, keys: dbKeys, backups: app.locals.backups });
  const need = (name) => {
    if (typeof runtime?.[name] !== "function") throw new HttpError(501, SOON);
    return (...args) => runtime[name](...args);
  };
  // Queued messages go by themselves when their bot finishes (server/queue.mjs).
  const sendQueued = (missionId, text) => need("addMessage")(missionId, text, [], {});
  if (typeof runtime?.addMessage === "function") app.locals.queues = watchQueues(store, runtime, sendQueued);
  const provider = (name) => {
    const p = runtime?.provider;
    if (typeof p?.[name] !== "function") throw new HttpError(501, SOON);
    return (...args) => p[name](...args);
  };
  const rootOf = (missionId) => safe(() => runtime.root(missionId)) || path.join(store.directory, "workspaces", missionId);
  const mustGet = (kind, key, what) => {
    const record = store.get(kind, key);
    if (!record) throw notFound(what);
    return record;
  };

  app.use((req, res, next) => {
    // Loopback only: 127.0.0.1 and localhost on the same port are the same server.
    const origin = getOrigin(),
      port = new URL(origin).port,
      hosts = ["127.0.0.1:" + port, "localhost:" + port];
    if (!hosts.includes(req.headers.host)) return res.status(403).json({ error: "Host no permitido." });
    if (req.headers.origin && !hosts.some((h) => req.headers.origin === "http://" + h))
      return res.status(403).json({ error: "Origen no permitido." });
    if (req.headers["sec-fetch-site"] === "cross-site") return res.status(403).json({ error: "Petición externa no permitida." });
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Cache-Control": "no-store" });
    if (req.path.startsWith("/api/") && !["GET", "HEAD"].includes(req.method)) {
      const token = String(req.headers["x-colmena-token"] || "");
      if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(csrf)))
        return res.status(403).json({ error: "Sesión local no válida. Recarga Colmena." });
      if (!req.is("application/json")) return res.status(415).json({ error: "Se requiere JSON." });
    }
    next();
  });
  app.use(attachmentBodyParser);
  app.use(codeUploadParser); // «Código» attachments (up to 20 MB)
  app.use(peerFileParser); // a file shared with people (up to 25 MB)
  app.use(wikiImportParser); // «Notas»: a zip of Markdown files to bring in (up to 25 MB)
  app.use(express.json({ limit: "1400kb" }));
  app.get("/api/health", (_req, res) => res.json({ application: "Colmena", version: VERSION, pid: process.pid, ...(app.locals.stalls ? { stalls: app.locals.stalls.state } : {}) }));
  app.get("/api/bootstrap", (_req, res) => res.json({ csrf }));
  const { connection, emailEdit } = registerConnectionRoutes(app, { connections, runtime, connectorCache, store });

  // ------------------------------------------------------------ state
  const listModels = async () => {
    const seen = new Map();
    const add = (m) => {
      const slug = typeof m === "string" ? m : m?.slug || m?.id;
      if (slug && !seen.has(slug)) seen.set(slug, { slug, label: m?.label || m?.display_name || m?.name || slug });
    };
    (session.models || []).forEach(add);
    (await providerModels()).forEach(add);
    return [...seen.values()];
  };
  // Provider model lists may need the network (API key): cached per provider kind.
  let modelCache = { key: null, at: 0, list: [] }, modelFailure = { key: null, n: 0, until: 0 };
  const providerModels = async () => {
    const p = runtime?.provider;
    if (typeof p?.models !== "function") return [];
    const key = JSON.stringify([providerStatus()?.kind ?? null, safe(() => p.engines?.().filter((e) => e.connected).map((e) => e.id)) || []]);
    if (modelCache.key === key && Date.now() - modelCache.at < 300000) return modelCache.list;
    // After a failure the last good list answers at once until the backoff ends: a slow or
    // failing catalog no longer makes every /api/state wait 4 s (failures are never cached).
    const stale = modelCache.key === key ? modelCache.list : [];
    if (modelFailure.key === key && Date.now() < modelFailure.until) return stale;
    const failed = () => {
      const n = modelFailure.key === key ? modelFailure.n + 1 : 1;
      modelFailure = { key, n, until: Date.now() + Math.min(300000, 5000 * 3 ** (n - 1)) };
      return stale;
    };
    try {
      const list = await Promise.race([Promise.resolve(p.models()), new Promise((r) => setTimeout(() => r(null), 4000).unref?.())]);
      if (!Array.isArray(list)) return failed();
      modelCache = { key, at: Date.now(), list };
      modelFailure = { key: null, n: 0, until: 0 };
      return list;
    } catch {
      return failed();
    }
  };
  const usageOf = async () => {
    const mod = await optional("./usage.mjs");
    const limit = store.get("settings", "main")?.limits?.monthlyTokens ?? null;
    if (typeof mod?.usageSummary === "function") return safe(() => mod.usageSummary(store)) || { monthTokens: 0, limitTokens: limit, percent: null };
    const used = typeof mod?.monthTokens === "function" ? safe(() => mod.monthTokens(store), 0) : 0;
    return { monthTokens: used, limitTokens: limit, percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : null };
  };
  app.get("/api/state", async (_req, res) => {
    // Server-Timing shows where the time goes (DevTools › Network › Timing).
    const t0 = performance.now();
    const timed = async (fn) => { const s = performance.now(); const v = await fn(); return [v, performance.now() - s]; };
    const [[models, tModels], [usage, tUsage]] = await Promise.all([timed(listModels), timed(usageOf)]);
    const t1 = performance.now();
    const state = extendState(store, runtime, buildState(store, runtime, { session, authError, models, usage, accounts: connectorCache.get(), computer }));
    state.peers = safe(() => app.locals.peers?.identity ? app.locals.peers.stateView() : null); // «Personas» (server/peers/)
    // Teams, light (server/peers/teams.mjs): id, name, counts and which one the sidebar shows; alone, one «solo» entry.
    state.teams = safe(() => teamsList(store, app.locals.peers), []);
    state.teamsPending = safe(() => teamsPending(app.locals.peers), []);
    // Rooms, light (server/room.mjs): id, title, team, links, unread and last activity; the sidebar follows it live.
    state.rooms = safe(() => rooms.state(), []);
    state.blocks = safe(() => pinnedBlocksState(store), []); // the panel of Inicio: pinned blocks, light (server/blocks.mjs)
    const t2 = performance.now();
    res.set("Server-Timing", `models;dur=${tModels.toFixed(1)}, usage;dur=${tUsage.toFixed(1)}, build;dur=${(t2 - t1).toFixed(1)}, total;dur=${(t2 - t0).toFixed(1)}`);
    res.json(state);
  });

  // SSE: coalesced {type:'changed', kinds} + runtime live events passed through.
  const LIVE = new Set(["delta", "activity", "step_done", "notify"]);
  // Each live step's text so far (server/live-snapshot.mjs): a stream that reconnects starts with it.
  const liveText = createLiveSnapshot();
  app.locals.liveText = liveText;
  store.listeners.add((event) => {
    if (LIVE.has(event?.type) || (event?.type === "completed" && event.seq !== undefined)) liveText.apply(event);
  });
  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    const kinds = new Set();
    let timer = null;
    const write = (event) => res.write("data: " + JSON.stringify(event) + "\n\n");
    // First frame: the text of every step still writing, which replaces the browser's copy;
    // the pieces after it (this same tick on, through `send`) append to it.
    write({ type: "live_snapshot", steps: liveText.snapshot() });
    // Streamed text and activity go out in ~50 ms windows (server/live-coalescer.mjs).
    const live = createLiveCoalescer(write);
    // Messages and steps travel whole (OpenClaw-style push): the open room applies them at
    // once instead of fetching itself again. The latest version of each wins within a flush.
    const pushes = new Map();
    const flush = () => {
      timer = null;
      if (pushes.size) {
        const bots = new Map(store.list("bots").map((b) => [b.id, b]));
        for (const { kind, op, id, data } of pushes.values()) {
          if (op === "remove") write({ type: "push", kind, op, id });
          else if (data?.missionId) write({ type: "push", kind, op, id, mission: data.missionId, record: kind === "messages" ? messageView(data) : stepView(data, bots) });
        }
        pushes.clear();
      }
      if (kinds.size) write({ type: "changed", kinds: [...kinds] });
      kinds.clear();
    };
    const send = (event) => {
      if (!event || typeof event !== "object") return;
      if (LIVE.has(event.type)) return live.push(event);
      // A part of an answer was just said: it reaches the room before the live text drops it.
      if (event.type === "flush-now") {
        if (timer) clearTimeout(timer);
        live.flush();
        flush();
        return;
      }
      if (event.type === "record") {
        if (event.kind === "webSnapshots" || event.kind === "receipts") return;
        // «Código» streams its own records (/api/code/events): a long turn never refreshes other screens.
        if (String(event.kind).startsWith("code")) return;
        // «Personas» messages travel on /api/peers/events; their conversation row refreshes the state.
        if (["peerMessages", "peerSeen", "peerOutbox"].includes(event.kind)) return;
        if (event.kind === "messages" || event.kind === "steps") pushes.set(event.kind + ":" + event.id, event);
        kinds.add(event.kind);
      }
      else if (event.type === "changed-local" || event.type === "changed") (event.kinds || []).forEach((k) => kinds.add(k));
      else if (event.type === "auth") kinds.add("account");
      else if (event.seq !== undefined) {
        kinds.add("events");
        if (event.type === "completed") { live.flush(); write({ type: "completed", mission: event.mission }); }
      } else return;
      timer ??= setTimeout(flush, 100);
    };
    store.listeners.add(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      clearTimeout(timer);
      live.close();
      store.listeners.delete(send);
    });
  });

  // The live output of one command, only while its row is unfolded in the chat
  // (server/command-output.mjs): the tail so far, new text every ~100 ms, then «done».
  app.get("/api/commands/output", (req, res) => {
    const { step, call } = check(z.object({ step: z.string().trim().min(1).max(300), call: z.string().trim().min(1).max(200) }), { ...req.query });
    const owner = store.get("steps", step);
    if (!owner) throw notFound("Paso");
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive", "Cache-Control": "no-store" });
    res.flushHeaders();
    let stop = () => {};
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    const end = () => { clearInterval(ping); stop(); };
    stop = commandOutput.subscribe(step + ":" + call, (frame) => {
      res.write("data: " + JSON.stringify(frame) + "\n\n");
      if (frame.type === "done") { end(); res.end(); }
    });
    req.on("close", end);
  });

  // ------------------------------------------------------------- auth
  app.post("/api/auth/start", async (_req, res) => {
    authError = null;
    res.json(await session.start());
  });
  app.post("/api/auth/cancel", (_req, res) => {
    session.closePending();
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", async (_req, res) => {
    await runtime.shutdown?.();
    res.json(await session.logout());
  });
  app.post("/api/auth/models", async (_req, res) => {
    const models = await session.listModels();
    const settings = store.get("settings", "main");
    if (!models.some((m) => m.slug === settings.model)) store.patch("settings", "main", { model: models[0]?.slug || "" });
    res.json(models);
  });
  app.post("/api/auth/apikey", async (req, res) => {
    const { key } = check(z.object({ key: z.string().trim().min(20, "La clave es demásiado corta.").max(400).regex(/^\S+$/, "La clave no puede tener espacios.") }).strict(), req.body);
    await provider("setApiKey")(key);
    modelCache = { key: null, at: 0, list: [] };
    emit(["account"]);
    res.json({ ok: true, provider: providerStatus() });
  });
  app.post("/api/auth/local", async (req, res) => {
    const data = check(z.object({ baseUrl: z.string().trim().url("Dirección no válida.").max(300), model: short }).strict(), req.body);
    const url = new URL(data.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw Error("El modelo local debe estar en este ordenador (localhost o 127.0.0.1).");
    await provider("setLocal")({ baseUrl: url.href.replace(/\/$/, ""), model: data.model });
    modelCache = { key: null, at: 0, list: [] };
    emit(["account"]);
    res.json({ ok: true, provider: providerStatus() });
  });
  // Claude, as OpenClaw connects it: API key, subscription setup-token or this computer's Claude Code.
  app.post("/api/auth/anthropic", async (req, res) => {
    const data = check(z.object({ method: z.enum(["api_key", "token", "cli"]), secret: z.string().max(2000).default("") }).strict(), req.body);
    await provider("connectAnthropic")(data);
    modelCache = { key: null, at: 0, list: [] };
    emit(["account"]);
    res.json({ ok: true, provider: providerStatus() });
  });
  app.get("/api/auth/anthropic/cli", async (_req, res) => {
    const { probeClaudeCli } = await import("./providers/claude-cli.mjs");
    res.json(await probeClaudeCli());
  });
  app.post("/api/auth/opencode", async (req, res) => {
    // Cleaned and checked in ProviderHub#connectOpenCode, which names the exact problem.
    const data = check(z.object({ key: z.string().max(2000) }).strict(), req.body);
    await provider("connectOpenCode")(data);
    modelCache = { key: null, at: 0, list: [] };
    emit(["account"]);
    res.json({ ok: true, provider: providerStatus() });
  });
  // Which engine the team thinks with, what to use when it fails, models pinned per family.
  app.patch("/api/ai/engines", async (req, res) => {
    const ref = z.string().max(120);
    const data = check(z.object({
      primary: z.enum(["openai", "anthropic", "opencode-go"]).nullable(),
      fallback: z.enum(["openai", "anthropic", "opencode-go", "local", "none"]),
      pins: z.record(z.enum(["anthropic", "opencode-go"]), z.object({ luna: ref, sol: ref, astra: ref }).partial().strict()),
    }).partial().strict(), req.body);
    const engines = provider("setEngines")(data);
    emit(["account"]);
    res.json({ ok: true, engines, provider: providerStatus() });
  });
  app.delete("/api/auth/provider", async (req, res) => {
    const { kind } = check(z.object({ kind: z.enum(["chatgpt", "apikey", "local", "anthropic", "opencode-go"]) }).strict(), { kind: req.body?.kind ?? req.query.kind });
    if (kind === "chatgpt" && typeof runtime?.provider?.clear !== "function") await session.logout();
    else await provider("clear")(kind);
    modelCache = { key: null, at: 0, list: [] };
    emit(["account"]);
    res.json({ ok: true, provider: providerStatus() });
  });
  registerSettingsRoutes(app, { listModels, store, runtime });
  const { messageView, stepView, enabledBot, sendMessage, messageFields } = registerMissionRoutes(app, { rootOf, store, mustGet, need, runtime, connection, connections, sendQueued });
  registerApprovalRoutes(app, { store, runtime, mustGet, connection, need, emailEdit });
  const { ask, parseJson } = registerBotRoutes(app, { store, runtime, optional, mustGet });
  registerSkillRoutes(app, { store, mustGet, runtime, optional });
  registerArtifactRoutes(app, { mustGet, store });
  const { createAutomation } = registerAutomationRoutes(app, { enabledBot, store, scheduler, ask, parseJson, mustGet });
  registerSuggestionRoutes(app, { mustGet, store, need, runtime, createAutomation });
  registerFolderRoutes(app, { mustGet, validateFolder, store });
  registerNotificationRoutes(app, { store, scheduler, rootOf, mustGet, runtime });
  // «Notas»: the wiki the person and the bots share (server/wiki.mjs); the bots get wiki_search, wiki_read and wiki_write.
  registerWikiRoutes(app, { store, validateFolder });
  attachWikiTools(runtime);
  // «Bloques vivos» (server/blocks.mjs): data a bot posts and a routine refreshes in place; block_post and block_read.
  registerBlockRoutes(app, { store, scheduler });
  attachBlockTools(runtime);

  registerLearningRoutes(app, { store, runtime, computerAvailable: () => !!computer?.available });
  // Password vault: the runtime's (the bots sign in with it), or one of its own in tests.
  if (runtime && !runtime.vault) runtime.vault = new SiteVault(store);
  registerVaultRoutes(app, { vault: runtime?.vault || new SiteVault(store), z });
  // API keys (request_secret / api_request): the runtime's store, or one of its own in tests.
  if (runtime && !runtime.secrets) runtime.secrets = new SecretStore(store);
  registerSecretRoutes(app, { store, runtime, secrets: runtime?.secrets || new SecretStore(store) });
  // MCP connections (MCP first, Composio for the rest): the runtime's hub, or one of its own in tests.
  if (runtime && !runtime.mcp) runtime.mcp = new McpHub(store);
  registerMcpRoutes(app, { hub: runtime?.mcp || new McpHub(store), z });
  app.locals.interaction = registerInteractionRoutes(app, { store, runtime, scheduler, connections, aiConnected, providerStatus, check, mustGet, HttpError, createAutomation, automationView });
  if (computer) registerComputerRoutes(app, { store, runtime, computer });
  if (runtime?.projects) registerProjectRoutes(app, { store, projects: runtime.projects });
  if (runtime?.code) registerCodeRoutes(app, { code: runtime.code });
  registerWatchRoutes(app, { store, watcher, check, z, HttpError });
  registerVoiceLiveRoutes(app, { store, runtime, connections, check, z, HttpError }); // «Hablar»: live voice through Codex
  registerBtwRoutes(app, { store, runtime, check, z }); // «/btw»: side questions, never stored
  registerBackupRoutes(app, { backups: app.locals.backups, check, z }); // Ajustes › Privacidad y datos
  registerEncryptionRoutes(app, { encryption: app.locals.encryption, backups: app.locals.backups });
  registerPeerRoutes(app, { getPeers: () => app.locals.peers, check, z, HttpError }); // «Personas»: other people's Colmenas
  registerTeamRoutes(app, { store, getPeers: () => app.locals.peers }); // «Equipos»: shared rosters of people
  registerRoomRoutes(app, { store, rooms, messageView, stepView, sendMessage, messageFields }); // «Salas»: one room over a sala and a conversation with people
  registerWebhookRoutes(app, { getWebhooks: () => app.locals.webhooks, store, check, z, HttpError }); // «Cuando avisa otra app»: webhook triggers through the mailbox
  registerGoalRoutes(app, { store, runtime });
  registerCoreRoutes(app, { store, runtime });
  registerUsageRoutes(app, { store, runtime });
  registerDiagnosticsRoutes(app, { store, runtime, connections, version: VERSION });
  // Office files seen with their format: this computer's Office or LibreOffice, cached by content.
  const officePdf = office || createOfficeConverter({ cacheDir: path.join(store.directory, "cache", "office-pdf") });
  registerWorkFileRoutes(app, { store, rootOf, check, z, mustGet, HttpError, office: officePdf });
  registerTurnChangeRoutes(app, { store, runtime, check, z, mustGet, HttpError, office: officePdf }); // «Archivos cambiados» and before/after
  registerDragRoutes(app, { store, rootOf, check, z }); // dragging files out (desktop shell)
  app.use("/api", (_req, res) => res.status(404).json({ error: "Operación no disponible." }));
  app.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: zodMessage(err), fields: err.issues.map((i) => i.path.join(".")) });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "La petición no es un JSON válido." });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "La petición es demasiado grande." });
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 422;
    res.status(status).json({ error: err?.message || "No se pudo completar la operación.", ...(err?.revision ? { revision: err.revision } : {}), ...(err?.details && typeof err.details === "object" ? { details: err.details } : {}) });
  });
  app.locals.scheduler = scheduler;
  app.locals.connectorCache = connectorCache;
  return app;
}
