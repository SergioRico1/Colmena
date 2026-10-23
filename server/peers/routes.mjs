// /api/peers/…: people, invitations and conversations with them (server/peers/service.mjs).
// GET  /api/peers                              me, mailbox, contacts, open invitations, conversations
// PATCH /api/peers/settings {relayUrl}         the mailbox this Colmena uses
// POST /api/peers/invites {name}               → {code, text, expiresAt}: you send it yourself
// DELETE /api/peers/invites/:id
// POST /api/peers/invites/preview {code}       who invites you and the safety words
// POST /api/peers/invites/accept {code}
// PATCH /api/peers/contacts/:id {asks?, verified?}   DELETE /api/peers/contacts/:id
// POST /api/peers/dm/:contact                  → the direct conversation with a contact
// POST /api/peers/shares {title, members}      a group (up to 32 people)
// POST /api/peers/shares/:id/members {members} POST /api/peers/shares/:id/leave
// GET  /api/peers/shares/:id/messages?before=  POST /api/peers/shares/:id/messages {text, replyTo?}
// POST /api/peers/shares/:id/seen              POST /api/peers/shares/:id/typing
// POST /api/peers/messages/:id/reactions {emoji}   POST /api/peers/messages/:id/retry
// GET  /api/peers/events?share=                SSE: typing, presence, messages of that conversation
import { PEER_LIMITS, PeerError } from "./service.mjs";

export function registerPeerRoutes(app, { getPeers, check, z, HttpError }) {
  const peers = () => {
    const p = getPeers();
    if (!p?.identity) throw new HttpError(503, "«Personas» se está preparando. Prueba en unos segundos.");
    return p;
  };
  // Service errors keep their status (404, 409…); the app's handler turns them into JSON.
  const run = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, peers()));
    } catch (error) {
      if (error instanceof PeerError) throw new HttpError(error.status, error.message);
      throw error;
    }
  };
  const id = z.string().trim().min(8).max(80);
  const code = z.object({ code: z.string().trim().min(16).max(60) }).strict();

  app.get("/api/peers", run((_req, p) => p.stateView()));
  app.patch("/api/peers/settings", run((req, p) => p.setRelay(check(z.object({ relayUrl: z.string().trim().max(200).nullable() }).strict(), req.body).relayUrl)));
  app.post("/api/peers/invites", run((req, p) => p.createInvite(check(z.object({ name: z.string().trim().min(1).max(PEER_LIMITS.name) }).strict(), req.body).name)));
  app.delete("/api/peers/invites/:id", run((req, p) => p.cancelInvite(req.params.id)));
  app.post("/api/peers/invites/preview", run((req, p) => p.previewInvite(check(code, req.body).code)));
  app.post("/api/peers/invites/accept", run((req, p) => p.acceptInvite(check(code, req.body).code)));
  app.patch("/api/peers/contacts/:id", run((req, p) => {
    const ask = z.enum(["pregunta", "siempre", "nunca", "mencion"]);
    return p.updateContact(req.params.id, check(z.object({ asks: z.object({ libre: ask.optional(), bots: ask.optional(), archivos: ask.optional() }).strict().optional(), verified: z.boolean().optional() }).strict(), req.body));
  }));
  app.delete("/api/peers/contacts/:id", run((req, p) => p.removeContact(req.params.id)));
  app.post("/api/peers/dm/:contact", run((req, p) => {
    if (p.contact(req.params.contact)?.status !== "active") throw new PeerError("Aún no hablas con esa persona.", 404);
    return p.shareView(p.ensureDm(req.params.contact));
  }));
  app.post("/api/peers/shares", run((req, p) => {
    const data = check(z.object({ title: z.string().trim().min(1).max(PEER_LIMITS.title), members: z.array(id).min(1).max(PEER_LIMITS.members - 1) }).strict(), req.body);
    return p.createGroup(data.title, data.members);
  }));
  app.post("/api/peers/shares/:id/members", run((req, p) => p.addMembers(req.params.id, check(z.object({ members: z.array(id).min(1).max(PEER_LIMITS.members - 1) }).strict(), req.body).members)));
  app.post("/api/peers/shares/:id/leave", run((req, p) => p.leave(req.params.id)));
  app.get("/api/peers/shares/:id/messages", run((req, p) => p.messages(req.params.id, { before: typeof req.query.before === "string" ? req.query.before : null })));
  app.post("/api/peers/shares/:id/messages", run((req, p) => {
    const mention = z.object({ owner: z.string().trim().min(43).max(43), bot: z.string().trim().min(1).max(40) }).strict();
    const data = check(z.object({ text: z.string().trim().min(1).max(PEER_LIMITS.text), replyTo: id.optional(), mentions: z.array(mention).max(8).optional() }).strict(), req.body);
    return p.post(req.params.id, data.text, { replyTo: data.replyTo || null, mentions: data.mentions || [] });
  }));
  app.post("/api/peers/shares/:id/seen", run((req, p) => p.seen(req.params.id)));
  app.post("/api/peers/shares/:id/typing", run((req, p) => p.typingNow(req.params.id)));
  app.post("/api/peers/messages/:id/reactions", run((req, p) => p.react(req.params.id, check(z.object({ emoji: z.string().trim().min(1).max(16) }).strict(), req.body).emoji)));
  app.post("/api/peers/messages/:id/retry", run((req, p) => p.retry(req.params.id)));

  // Meetings agreed between Colmenas (meetings.mjs): see, preview what would be shared, share
  // free/busy or decline, vote a slot (-1 = none fits), cancel (the organizer).
  const meetings = (p) => {
    if (!p.meetings) throw new PeerError("Las reuniones no están disponibles.", 501);
    return p.meetings;
  };
  const meeting = (p, id) => {
    const view = meetings(p).view(id);
    if (!view) throw new PeerError("No existe esa reunión.", 404);
    return view;
  };
  const wrap = (fn) => run(async (req, p) => {
    try { return await fn(req, p); } catch (error) { throw error instanceof PeerError ? error : new PeerError(error.message, 409); }
  });
  app.get("/api/peers/meetings/:id", run((req, p) => meeting(p, req.params.id)));
  app.get("/api/peers/meetings/:id/preview", wrap((req, p) => { meeting(p, req.params.id); return meetings(p).preview(req.params.id); }));
  app.post("/api/peers/meetings/:id/share", wrap((req, p) => { meeting(p, req.params.id); return meetings(p).shareFree(req.params.id, check(z.object({ always: z.boolean().optional() }).strict(), req.body)); }));
  app.post("/api/peers/meetings/:id/decline", wrap((req, p) => { meeting(p, req.params.id); return meetings(p).decline(req.params.id); }));
  app.post("/api/peers/meetings/:id/vote", wrap((req, p) => { meeting(p, req.params.id); return meetings(p).vote(req.params.id, check(z.object({ slot: z.number().int().min(-1).max(5) }).strict(), req.body).slot); }));
  app.post("/api/peers/meetings/:id/cancel", wrap((req, p) => { meeting(p, req.params.id); return meetings(p).cancel(req.params.id); }));

  app.get("/api/peers/events", (req, res) => {
    const p = getPeers();
    const share = typeof req.query.share === "string" ? req.query.share : null;
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    const send = (event) => {
      if (share && event.shareId && event.shareId !== share) return;
      res.write("data: " + JSON.stringify(event) + "\n\n");
    };
    p?.on("live", send);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      p?.off("live", send);
    });
  });
}
