// /api/rooms…: the one room object (server/room.mjs; docs/ROOMS-CONTRACT.md, docs/PEOPLE.md › Salas).
// `:id` is a room's id, its sala's (mission) or its conversation's (share): /sala/:id and /con/:id keep working.
// GET   /api/rooms?team=&archived=           rooms of a team; `team=solo` or none: private ones and those of no team
// POST  /api/rooms {title, team?, botIds?, people?, text?}   private (a sala), or with a share (a team, people)
// GET   /api/rooms/:id                       the room, who is in it and the bots of each
// PATCH /api/rooms/:id {title?, archived?, snooze?, snoozedUntil?}   with people, only its creator renames
// GET   /api/rooms/:id/timeline?cursor=&limit=   one page of both stores as one conversation
// POST  /api/rooms/:id/messages {text, to?, thread?, replyTo?, mentions?, people?, …}   routed by what the room is
// POST  /api/rooms/:id/people {address} | {invite: {name, role?}}   the first person gives a private room its share
// POST  /api/rooms/:id/requests/:request {decision}   a «please add» a member sent you: approve | decline
// POST  /api/rooms/:id/leave                 POST /api/rooms/:id/seen
import { z } from "zod";
import { MAX_PAGE } from "../history.mjs";
import { PEER_LIMITS } from "../peers/service.mjs";
import { ROOM_LIMITS } from "../room.mjs";
import { roomTimeline } from "../room-timeline.mjs";
import { check, short } from "./shared.mjs";

/** Rooms: the list, one room, its merged timeline and what you do in it. */
export function registerRoomRoutes(app, { store, rooms, messageView, stepView, sendMessage, messageFields }) {
  const run = (fn) => async (req, res) => { res.json(await fn(req, res)); };
  const address = z.string().trim().length(43);
  const anyId = z.string().trim().min(1).max(200);
  const flag = z.enum(["0", "1", "true", "false"]).optional();

  app.get("/api/rooms", run((req) => {
    const q = check(z.object({ team: z.string().trim().min(1).max(64).optional(), archived: flag }), { ...req.query });
    return rooms.list({ team: q.team || null, archived: q.archived === undefined ? null : ["1", "true"].includes(q.archived) });
  }));
  app.post("/api/rooms", async (req, res) => {
    const data = check(z.object({
      title: z.string().trim().min(1).max(ROOM_LIMITS.title), team: z.string().trim().min(4).max(64).optional(), botIds: z.array(short).max(ROOM_LIMITS.bots).default([]),
      people: z.array(address).max(PEER_LIMITS.members - 1).default([]), text: z.string().trim().max(PEER_LIMITS.text).optional(),
    }).strict(), req.body);
    res.status(201).json(rooms.create(data));
  });
  app.get("/api/rooms/:id", run((req) => rooms.detail(req.params.id)));
  app.patch("/api/rooms/:id", run((req) => rooms.patch(req.params.id, check(z.object({
    title: z.string().trim().min(1).max(ROOM_LIMITS.title).optional(), archived: z.boolean().optional(),
    snooze: z.enum(["tarde", "manana", "lunes"]).optional(), snoozedUntil: z.string().datetime({ offset: true }).nullable().optional(),
  }).strict(), req.body))));
  app.get("/api/rooms/:id/timeline", run((req) => {
    const q = check(z.object({ cursor: z.string().max(400).optional(), limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional() }), { ...req.query });
    const room = rooms.must(req.params.id);
    return { room: rooms.view(room), ...roomTimeline({ store, room, peers: rooms.peers, me: rooms.me(), cursor: q.cursor || null, limit: q.limit, messageView, stepView }) };
  }));
  app.post("/api/rooms/:id/messages", run((req) => {
    const mention = z.object({ owner: address, bot: z.string().trim().min(1).max(40) }).strict();
    const data = check(z.object({
      ...messageFields, to: z.array(short).max(4).optional(), thread: anyId.optional(),
      mentions: z.array(mention).max(8).optional(), people: z.array(address).max(16).optional(),
    }).strict(), req.body);
    // With people a message holds what the mailbox carries.
    if (rooms.must(req.params.id).shareId && data.text.length > PEER_LIMITS.text) throw Object.assign(Error("El mensaje es demasiado largo."), { status: 400 });
    return rooms.send(req.params.id, data, { toMission: sendMessage });
  }));
  app.post("/api/rooms/:id/people", async (req, res) => {
    const data = check(z.union([
      z.object({ address }).strict(),
      z.object({ invite: z.object({ name: z.string().trim().min(1).max(PEER_LIMITS.name), role: z.enum(["member", "guest"]).optional() }).strict() }).strict(),
    ]), req.body);
    const out = await rooms.invite(req.params.id, data);
    // Asked to whoever made the room: nothing has changed yet.
    res.status(out.asked ? 202 : 200).json(out);
  });
  app.post("/api/rooms/:id/requests/:request", run((req) => rooms.decide(req.params.id, req.params.request, check(z.object({ decision: z.enum(["approve", "decline"]) }).strict(), req.body).decision)));
  app.post("/api/rooms/:id/leave", run((req) => rooms.leave(req.params.id)));
  app.post("/api/rooms/:id/seen", run((req) => rooms.seen(req.params.id)));
}
