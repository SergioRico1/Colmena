import { z } from "zod";
import { notificationView } from "../state.mjs";
import { placeName } from "../mission-kind.mjs";
import { linkPreview } from "../web.mjs";
import { usageCsv, usageHistory } from "../usage.mjs";
import { search } from "../search.mjs";
import { HttpError, short, check } from "./shared.mjs";

/** Notifications, search, the usage history, a room's recap and link previews. */
export function registerNotificationRoutes(app, { store, scheduler, rootOf, mustGet, runtime }) {
  // ------------------------------------------------------ notifications
  app.get("/api/notifications", (_req, res) => {
    res.json(store.list("notifications").reverse().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100).map(notificationView));
  });
  app.post("/api/notifications/read", (req, res) => {
    const data = check(
      z.object({ ids: z.array(short).max(200).optional(), all: z.boolean().optional() }).strict().refine((d) => d.all === true || d.ids?.length, { message: "Indica qué avisos marcar como leídos." }),
      req.body,
    );
    const changed = scheduler.notifier.markRead(data);
    res.json({ ok: true, changed, unread: store.list("notifications").filter((n) => !n.read).length });
  });

  app.get("/api/search", async (req, res) => {
    const q = check(z.string().max(200), String(req.query.q ?? ""));
    res.json(await search(store, q, { rootOf }));
  });

  // «Uso de los últimos 30 días»: per day, bot and room, and the same as CSV.
  const usageNames = () => ({
    botName: (id) => store.get("bots", id)?.name || id,
    roomName: (id) => { const m = store.get("missions", id); return !m ? "(borrada)" : m.incognito ? "(de incógnito)" : placeName(m); },
  });
  app.get("/api/usage/history", (req, res) => {
    const days = check(z.coerce.number().int().min(7).max(90), req.query.days ?? 30);
    const { rows, ...history } = usageHistory(store, { days });
    const { botName, roomName } = usageNames();
    res.json({ ...history, bots: history.bots.map((b) => ({ ...b, name: botName(b.botId) })), rooms: history.rooms.slice(0, 12).map((r) => { const m = store.get("missions", r.missionId); return { ...r, name: roomName(r.missionId), conversation: !!m?.conversation, exists: !!m && !m.incognito }; }) });
  });
  app.get("/api/usage/history.csv", (req, res) => {
    const days = check(z.coerce.number().int().min(7).max(90), req.query.days ?? 30);
    const history = usageHistory(store, { days });
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="colmena-uso-${history.from}-a-${history.to}.csv"`);
    res.send(usageCsv(history, usageNames()));
  });

  // «Reintentar resumen» (or a fresh one now): the room's recap, written again.
  app.post("/api/missions/:id/recap", async (req, res) => {
    const mission = mustGet("missions", req.params.id, "Sala");
    if (mission.conversation || mission.incognito) throw new HttpError(400, "Las conversaciones no tienen resumen de sala.");
    const recap = await runtime.recapRoom(mission.id, { force: true });
    if (!recap) throw new HttpError(502, "No se pudo escribir el resumen ahora. Prueba otra vez en un momento.");
    res.json({ recap });
  });

  // Link hover previews: public pages only, anonymous, title/description/site as text.
  app.get("/api/link-preview", async (req, res) => {
    const url = check(z.string().min(8).max(2048), String(req.query.url ?? ""));
    try {
      res.json({ preview: await linkPreview(url) });
    } catch (error) {
      res.json({ preview: null, reason: error.code === "COLMENA_WEB" ? error.message : "No se pudo leer la página." });
    }
  });
}
