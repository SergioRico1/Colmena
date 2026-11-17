// The desktop's «para después» (server/room-plus.mjs) over HTTP:
// GET/POST /api/plus/saved · DELETE /api/plus/saved/:id
// GET/POST /api/plus/reminders · DELETE /api/plus/reminders/:id
// GET/POST /api/plus/scheduled · DELETE /api/plus/scheduled/:id · POST /api/plus/scheduled/:id/send
import { z } from "zod";
import { PlusError, RoomPlus } from "../room-plus.mjs";

const where = z.object({ room: z.string().max(80).optional(), share: z.string().max(80).optional(), mission: z.string().max(80).optional() }).strict();
const when = { when: z.string().max(120).optional(), at: z.union([z.number(), z.string().max(40)]).optional() };

/** Makes the engine (sending through `rooms`, missions and person chats) and its routes; returns it. */
export function registerPlusRoutes(app, { store, runtime, rooms, sendMessage, notify }) {
  const send = async ({ where: w, text }) => {
    if (w.room) return rooms.send(w.room, { text });
    if (w.share) { const p = app.locals.peers; if (!p) throw new PlusError("Las conversaciones con personas no están activas."); return p.post(w.share, text, {}); }
    return sendMessage(w.mission, { text });
  };
  const resume = ({ missionId, botId, note }) => {
    const mission = store.get("missions", missionId);
    if (!mission || mission.status === "cancelled") return null;
    return runtime.addMessage(missionId, "[Colmena] Es la hora que te apuntaste para volver a esto" + (note ? ": " + note : ".") + " Mira cómo está y di en la conversación lo que toque.", [], { origin: "followup", to: [botId] });
  };
  const plus = new RoomPlus({ store, send, resume, notify, tz: () => store.get("settings", "main")?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || null });
  const run = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Datos no válidos." });
      res.status(error.status || 500).json({ error: error.message || "No se pudo." });
    }
  };
  app.get("/api/plus/saved", run(() => ({ saved: plus.saved() })));
  app.post("/api/plus/saved", run((req) => plus.save(z.object({ where, messageId: z.string().min(1).max(80), text: z.string().max(4000).optional(), author: z.string().max(120).optional() }).strict().parse(req.body))));
  app.delete("/api/plus/saved/:id", run((req) => plus.unsave(req.params.id)));
  app.get("/api/plus/reminders", run(() => ({ reminders: plus.reminders() })));
  app.post("/api/plus/reminders", run((req) => plus.remind(z.object({ where, messageId: z.string().max(80).optional(), text: z.string().max(4000).optional(), ...when }).strict().parse(req.body))));
  app.delete("/api/plus/reminders/:id", run((req) => plus.cancelReminder(req.params.id)));
  app.get("/api/plus/scheduled", run(() => ({ scheduled: plus.scheduled() })));
  app.post("/api/plus/scheduled", run((req) => plus.schedule(z.object({ where, text: z.string().min(1).max(4000), ...when }).strict().parse(req.body))));
  app.delete("/api/plus/scheduled/:id", run((req) => plus.cancelScheduled(req.params.id)));
  app.post("/api/plus/scheduled/:id/send", run((req) => plus.sendNow(req.params.id)));
  return plus;
}
