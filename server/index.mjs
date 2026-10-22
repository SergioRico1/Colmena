import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Store } from "./store.mjs";
import { ChatGPTSession } from "./nexo/oauth.mjs";
import * as providers from "./provider.mjs";
import { Runtime } from "./runtime.mjs";
import { Scheduler } from "./scheduler.mjs";
import { SiteVault } from "./vault.mjs";
import { SecretStore, secretsExtraTools } from "./secrets.mjs";
import { importNexoComposio } from "./nexo/import.mjs";
import { McpHub } from "./mcp/hub.mjs";
import { mcpExtraTools } from "./mcp/tools.mjs";
import { CuaDesktop, desktopExtraTools } from "./computer/desktop.mjs";
import { createApp } from "./app.mjs";
import { computer } from "./computer/bridge.mjs";
import { computerExtraTools } from "./computer/wire.mjs";
import { lockInstance } from "./instance.mjs";
import { ComposioHub } from "./nexo/composio.mjs";
import { windowsVault } from "./nexo/credential-vault.mjs";
import { Connections } from "./connections.mjs";
import { AppTools } from "./apptools.mjs";
import { Projects } from "./projects/tools.mjs";
import { CodeService } from "./code/service.mjs";
import { pendingCount } from "./notifications.mjs";
import { watchStalls } from "./stalls.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The installed app runs this server on Electron's Node (desktop/main.cjs); the programs it
// starts (Claude Code, Codex, a project's npm…) must not inherit that switch.
delete process.env.ELECTRON_RUN_AS_NODE;
const directory =
  process.env.COLMENA_DATA_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Colmena");
const instance = lockInstance(directory);
const store = new Store(directory),
  session = new ChatGPTSession({ directory: path.join(directory, "auth") });
await session.init();
try {
  await session.restore();
} catch (error) {
  console.warn("No se pudo restaurar la sesion: " + error.message);
}
const connections = new Connections(store, new ComposioHub({ vault: windowsVault(path.join(directory, "connections")) }));
// The Composio account already set up in NEXO, imported once (real data only, never QA).
if (!process.env.COLMENA_DATA_DIR)
  importNexoComposio({ store, directory })
    .then((r) => r.imported && console.log("Colmena: cuenta de Composio importada de NEXO."))
    .catch(() => {});
// Provisioned by the operator, never by the app UI or by an agent tool.
if (process.env.COLMENA_COMPOSIO_KEY) {
  try {
    await connections.manage("configure", { key: process.env.COLMENA_COMPOSIO_KEY });
  } catch {
    console.warn("No se pudo provisionar el servicio de conexiones.");
  } finally {
    delete process.env.COLMENA_COMPOSIO_KEY;
  }
}
// ChatGPT (session, API key or local model), Claude and OpenCode Go behind one provider;
// falls back to the plain ChatGPT provider while ProviderHub is unavailable.
let provider;
try {
  provider = typeof providers.ProviderHub === "function" ? new providers.ProviderHub({ session, store }) : null;
} catch (error) {
  console.warn("Proveedor multiple no disponible: " + error.message);
}
provider ??= new providers.OpenAIProvider(session);
const runtime = new Runtime(store, provider, connections);
const aiConnected = () => {
  const status = provider.status?.();
  if (status && "kind" in status) return !!status.kind;
  return !!session.status() && !!store.get("settings", "main").model;
};
const scheduler = new Scheduler(store, runtime, aiConnected, { connections });
let origin = "http://127.0.0.1:4317";
runtime.vault = new SiteVault(store); // site passwords for browser_sign_in (DPAPI)
runtime.mcp = new McpHub(store); // MCP connections (catalogue in Ajustes › Conexiones)
const computerTools = computerExtraTools(runtime, { computer });
// Projects (custom development): files, npm/node, a dev server and its preview.
runtime.projects = new Projects({ store, runtime, computer });
// «Código»: projects and tasks worked by Claude Code of this computer (server/code/).
// Its OpenCode engine uses your OpenCode Go key from the vault, only in that process's memory.
// A task that ends or waits for you says so like a mission does (Ajustes › Avisos).
runtime.code = new CodeService({ store, directory, goKey: () => provider.secret?.("opencode-apikey"), notifier: scheduler.notifier });
const mcpTools = mcpExtraTools(runtime, runtime.mcp);
// Desktop apps through Cua Driver, when it is installed (started on demand, no admin).
const desktop = new CuaDesktop();
const desktopTools = desktopExtraTools(runtime, desktop);
runtime.secrets = new SecretStore(store); // API keys for api_request (DPAPI), asked with request_secret
const secretTools = secretsExtraTools(runtime, runtime.secrets);
// The main actions of your connected apps, ready to call (one round instead of four).
runtime.appTools = new AppTools(connections);
// Right away: the first chat after a restart should already have its direct app tools.
setTimeout(() => runtime.appTools.refresh(), 0).unref?.();
runtime.extraTools = (bot, mission) => [...computerTools(bot, mission), ...runtime.projects.extraTools(bot, mission), ...desktopTools(bot, mission), ...mcpTools(bot, mission), ...secretTools(bot, mission), ...runtime.appTools.list(bot, mission, runtime)];
runtime.accountEmail = () => session.status()?.email || null;
// Windows notifications through the desktop shell (Electron) for «Una novedad».
if (typeof process.send === "function") {
  // «presence» feeds the tray icon's face: working, waiting for you, paused, just finished.
  let presenceTimer = null, lastPresence = "";
  const sendPresence = () => {
    presenceTimer = null;
    const missions = store.list("missions");
    const presence = {
      working: missions.filter((m) => ["running", "planning", "queued"].includes(m.status)).length,
      waiting: store.list("approvals").filter((a) => a.status === "pending").length,
      paused: !!store.get("settings", "main")?.paused,
      finished: missions.filter((m) => m.status === "completed").length,
      // The taskbar counter: everything that waits for you.
      pending: pendingCount(store),
    };
    const key = JSON.stringify(presence);
    if (key === lastPresence) return;
    lastPresence = key;
    try { process.send({ type: "presence", ...presence }); } catch {}
  };
  store.listeners.add((event) => {
    if (event?.type === "notify") process.send({ type: "notify", kind: event.kind || null, title: event.title, text: event.text, url: event.url || "/", tag: event.tag || null, toast: event.toast !== false, sound: event.sound || null, ...(event.quick ? { quick: event.quick } : {}) });
    if (event?.type === "record" && ["missions", "approvals", "settings"].includes(event.kind) && !presenceTimer) presenceTimer = setTimeout(sendPresence, 400);
  });
  setTimeout(sendPresence, 1500).unref();
}
const app = createApp({ store, runtime, session, scheduler, connections, getOrigin: () => origin, computer });
// What was cut by the last close goes on by itself once the AI account is ready.
setTimeout(() => {
  try { if (aiConnected()) runtime.resumeInterrupted(); } catch {}
}, 2000).unref();
const server = http.createServer(app);
let vite;
if (process.argv.includes("--production")) {
  // The SPA in dist/ is the whole frontend: no eval, no legacy /screens or /connections pages.
  const csp =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
  const legacy = /^\/(screens|connections|design-reference)(\/|$)/;
  const assets = express.static(path.join(root, "dist"), { index: false });
  app.use((req, res, next) => {
    res.set("Content-Security-Policy", csp);
    if (legacy.test(req.path)) return next();
    assets(req, res, next);
  });
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
  app.use(vite.middlewares);
}
server.requestTimeout = 20000;
const requested = Number(process.env.COLMENA_PORT ?? process.env.PORT ?? 4317);
await new Promise((resolve, reject) => {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && requested !== 0) {
      server.listen(0, "127.0.0.1", resolve);
    } else reject(error);
  });
  server.listen(requested, "127.0.0.1", resolve);
});
origin = "http://127.0.0.1:" + server.address().port;
runtime.code.excludePorts = [server.address().port];
instance.ready(origin);
scheduler.start();
// Long pauses of the server are written down (and shown in /api/health).
app.locals.stalls = watchStalls();
app.locals.watcher?.start();
console.log("COLMENA_READY " + origin);
// Windows ends this process without a clean exit: write the compiled-code cache now that
// every module is loaded (T3 Code flushes it once the server is ready).
try { (await import("node:module")).flushCompileCache?.(); } catch {}
// Prewarm (OpenClaw gateway prewarm): the access token and the model list are fresh before
// the first message, so the first answer does not wait for them.
setTimeout(() => {
  void (async () => {
    try {
      if (!aiConnected()) return;
      if (provider.kind === "chatgpt") await session.accessToken?.();
      await provider.models?.();
    } catch {}
  })();
}, 300).unref();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  scheduler.stop();
  app.locals.watcher?.stop();
  desktop.close();
  runtime.projects?.servers.shutdown();
  runtime.code?.shutdown();
  provider.close?.(); // Claude Code processes of the «Claude Code de este ordenador» engine
  session.closePending();
  await runtime.shutdown();
  session.dispose();
  await vite?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  store.close();
  instance.release();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
process.on("disconnect", close);
