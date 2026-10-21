// HTTP routes for computer use. Register BEFORE the /api 404 handler in app.mjs:
//   registerComputerRoutes(app, { store, runtime, computer })
import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { safePath } from "../files.mjs";
import { computer as defaultComputer, UNAVAILABLE_MESSAGE } from "./bridge.mjs";
import { allowedApps, DEFAULT_APPS } from "./system.mjs";

const RUNNING = ["running", "queued", "planning"];
const SHOT = /^capturas\/[\w.-]+\.jpg$/;
const RETURN_HINT = "He tomado el control del navegador y ya te lo he devuelto. Las referencias anteriores ya no valen: vuelve a leer la página antes de seguir.";

function httpError(status, message) {
  const error = Error(message);
  error.status = status;
  return error;
}

export function registerComputerRoutes(app, { store, runtime, computer = defaultComputer } = {}) {
  const viewers = new Set(); // own SSE clients: {res, mission}
  const pausedByTakeover = new Set();
  const rootOf = (missionId) => {
    try { return runtime.root(missionId); } catch { return path.join(store.directory, "workspaces", missionId); }
  };
  const write = (res, event) => res.write("data: " + JSON.stringify(event) + "\n\n");

  // Frames: memory only. Re-emitted through the store listeners ({type:'browser_frame'})
  // so /api/events can forward them, and to this module's own SSE viewers.
  computer.onFrame((frame) => {
    for (const fn of [...store.listeners]) {
      try { fn(frame); } catch {}
    }
    for (const v of viewers) if (!v.mission || v.mission === frame.mission) write(v.res, frame);
  });

  const relaunch = (missionId) => {
    if (typeof runtime?.relaunch === "function") return runtime.relaunch(missionId);
    const prior = runtime?.missionJobs?.get?.(missionId);
    void Promise.resolve(prior).catch(() => {}).then(() => runtime?.launch?.(missionId));
  };

  async function afterReturn(missionId, botId) {
    const bot = store.get("bots", botId);
    try { store.event(missionId, "computer_returned", { botId, text: "Has devuelto el control del navegador" + (bot ? " a " + bot.name : "") }); } catch {}
    if (!pausedByTakeover.has(missionId)) return;
    pausedByTakeover.delete(missionId);
    try { runtime?.threadHint?.(missionId, RETURN_HINT); } catch {}
    const m = store.get("missions", missionId);
    if (m?.status === "paused") relaunch(missionId);
  }

  computer.onEvent((event) => {
    for (const v of viewers) if (!v.mission || v.mission === event.missionId) write(v.res, { type: "computer_" + event.event, mission: event.missionId, botId: event.botId });
    if (event.event === "returned") void afterReturn(event.missionId, event.botId);
    if (event.event === "closed") computer.forget?.(event.missionId);
  });

  // Close the browser of a cancelled mission.
  store.listeners.add((change) => {
    if (change?.type === "record" && change.kind === "missions" && change.data?.status === "cancelled" && computer.available)
      computer.call("closeMission", { missionId: change.data.id }).catch(() => {});
  });

  app.get("/api/computer/status", async (_req, res) => {
    let sessions = [];
    if (computer.available) {
      try { ({ sessions = [] } = await computer.call("status", {})); } catch {}
    }
    res.json({ available: computer.available, message: computer.available ? null : UNAVAILABLE_MESSAGE, sessions });
  });

  app.get("/api/computer/frame/:missionId", (req, res) => {
    res.json({ available: computer.available, frame: computer.lastFrame(req.params.missionId) });
  });

  app.get("/api/computer/events", (req, res) => {
    const mission = typeof req.query.mission === "string" ? req.query.mission.slice(0, 200) : "";
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    const viewer = { res, mission };
    viewers.add(viewer);
    const last = mission ? computer.lastFrame(mission) : null;
    if (last) write(res, last);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      viewers.delete(viewer);
    });
  });

  app.post("/api/computer/takeover", async (req, res) => {
    const { missionId, action, botId } = z.object({
      missionId: z.string().min(1).max(200), action: z.enum(["take", "return"]), botId: z.string().min(1).max(200).optional(),
    }).strict().parse(req.body);
    const mission = store.get("missions", missionId);
    if (!mission) throw httpError(404, "Misión no encontrada.");
    if (!computer.available) throw httpError(409, UNAVAILABLE_MESSAGE);
    const tab = await computer.call("takeover", { missionId, action, botId });
    if (action === "take") {
      if (RUNNING.includes(store.get("missions", missionId)?.status)) {
        try {
          runtime.stop(missionId, false);
          pausedByTakeover.add(missionId);
        } catch {}
      }
      const bot = store.get("bots", tab.botId);
      store.event(missionId, "computer_takeover", { botId: tab.botId, text: "Has tomado el control del navegador" + (bot ? " de " + bot.name : "") });
    }
    // 'return' continues in the 'returned' event sent by Electron (also fired when the window is closed).
    res.json({ ok: true, tab, paused: pausedByTakeover.has(missionId) });
  });

  app.get("/api/computer/approval/:id", (req, res) => {
    const a = store.get("approvals", req.params.id);
    if (!a || !a.computer) throw httpError(404, "Esta aprobación no tiene datos del ordenador.");
    const c = a.computer;
    res.json({
      tool: a.tool, redLine: !!a.redLine, scopeLabel: a.scopeLabel || null,
      fields: Array.isArray(c.fields) ? c.fields : [], domain: c.domain || null, url: c.url || null, title: c.title || null, button: c.button || null,
      hasShot: typeof c.shot === "string" && SHOT.test(c.shot),
      program: c.program || null, resolvedProgram: c.resolvedProgram || null, args: c.args || null, line: c.line || null, danger: c.danger || null,
      folder: c.folder || null, file: c.file || null, app: c.app || null,
    });
  });

  app.get("/api/computer/shot/:id", async (req, res) => {
    const a = store.get("approvals", req.params.id);
    const shot = a?.computer?.shot;
    if (!a || typeof shot !== "string" || !SHOT.test(shot)) throw httpError(404, "No hay captura.");
    let file;
    try {
      file = await readFile(await safePath(rootOf(a.missionId), shot));
    } catch {
      throw httpError(404, "La captura ya no existe.");
    }
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" });
    res.end(file);
  });

  // Apps the bots may open (Ajustes › Este ordenador). Only the person edits this list.
  app.get("/api/computer/apps", (_req, res) => {
    const settings = store.get("settings", "main") || {};
    res.json({
      apps: allowedApps(settings).map(({ id, label, installed }) => ({ id, label, installed })),
      defaults: DEFAULT_APPS.map(({ id, label }) => ({ id, label })),
    });
  });
  const appEntry = z.union([
    z.enum(DEFAULT_APPS.map((a) => a.id)),
    z.object({ label: z.string().trim().min(1).max(60), path: z.string().trim().min(4).max(400).regex(/^[a-zA-Z]:\\.+\.exe$/i, "Indica la ruta completa de un .exe") }).strict(),
  ]);
  app.put("/api/computer/apps", (req, res) => {
    const { apps } = z.object({ apps: z.array(appEntry).max(30) }).strict().parse(req.body);
    for (const entry of apps)
      if (typeof entry === "object" && !existsSync(entry.path)) throw httpError(422, "No existe «" + entry.path + "».");
    store.patch("settings", "main", { allowedApps: apps });
    res.json({ apps: allowedApps({ allowedApps: apps }).map(({ id, label, installed }) => ({ id, label, installed })) });
  });

  return { viewers: () => viewers.size, pausedByTakeover };
}
