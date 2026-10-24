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
// PATCH /api/peers/messages/:id {text} (yours)     DELETE /api/peers/messages/:id (yours, for everyone)
// GET  /api/peers/search?q=&share=
// GET  /api/peers/events?share=                SSE: typing, presence, messages of that conversation
// POST /api/peers/shares/:id/files {name, content (base64), caption?}   sealed and shared
// POST /api/peers/shares/:id/files/artifact {artifact, caption?}   a deliverable of yours
// GET  /api/peers/files/:id[?download=1]   GET …/preview   GET …/pages/:n   POST …/retry
import express from "express";
import { PEER_LIMITS, PeerError } from "./service.mjs";
import { FILE_LIMITS } from "./files.mjs";

/** JSON up to 36 MB only for sharing a file (25 MB in base64); mounted before the global parser. */
export const peerFileParser = (() => {
  const parse = express.json({ limit: "36mb" });
  return (req, res, next) => (req.method === "POST" && /^\/api\/peers\/shares\/[^/]+\/files$/.test(req.path) ? parse(req, res, next) : next());
})();

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
  // Your status for other people: available, «dnd» (No molestar) or «away» (Fuera), until a time.
  app.patch("/api/peers/status", run((req, p) => {
    const data = check(z.object({ mode: z.enum(["available", "dnd", "away"]), until: z.string().trim().max(40).nullable().optional() }).strict(), req.body);
    return p.setStatus(data.mode, data.until || null);
  }));
  app.post("/api/peers/invites", run((req, p) => p.createInvite(check(z.object({ name: z.string().trim().min(1).max(PEER_LIMITS.name) }).strict(), req.body).name)));
  app.delete("/api/peers/invites/:id", run((req, p) => p.cancelInvite(req.params.id)));
  app.post("/api/peers/invites/preview", run((req, p) => p.previewInvite(check(code, req.body).code)));
  app.post("/api/peers/invites/accept", run((req, p) => p.acceptInvite(check(code, req.body).code)));
  app.patch("/api/peers/contacts/:id", run((req, p) => {
    const ask = z.enum(["pregunta", "siempre", "nunca", "mencion"]);
    return p.updateContact(req.params.id, check(z.object({ asks: z.object({ libre: ask.optional(), bots: ask.optional(), archivos: ask.optional(), encargos: ask.optional() }).strict().optional(), verified: z.boolean().optional() }).strict(), req.body));
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
  app.get("/api/peers/shares/:id/messages", run((req, p) => p.messages(req.params.id, { before: typeof req.query.before === "string" ? req.query.before : null, thread: typeof req.query.thread === "string" ? req.query.thread : null })));
  app.post("/api/peers/shares/:id/messages", run((req, p) => {
    const mention = z.object({ owner: z.string().trim().min(43).max(43), bot: z.string().trim().min(1).max(40) }).strict();
    const data = check(z.object({ text: z.string().trim().min(1).max(PEER_LIMITS.text), replyTo: id.optional(), thread: id.optional(), mentions: z.array(mention).max(8).optional(), people: z.array(z.string().trim().min(43).max(43)).max(16).optional() }).strict(), req.body);
    return p.post(req.params.id, data.text, { replyTo: data.replyTo || null, thread: data.thread || null, mentions: data.mentions || [], people: data.people || [] });
  }));
  app.patch("/api/peers/messages/:id", run((req, p) => p.edit(req.params.id, check(z.object({ text: z.string().trim().min(1).max(PEER_LIMITS.text) }).strict(), req.body).text)));
  app.delete("/api/peers/messages/:id", run((req, p) => p.unsend(req.params.id)));
  // A «Código» task shared with people (codeshare.mjs): yours (who sees it, who is looking,
  // what they said of the plan) and the ones shared with you.
  const codeShare = (p) => {
    if (!p.codeShare) throw new PeerError("Código no está disponible.", 503);
    return p.codeShare;
  };
  const address = z.string().trim().min(43).max(43);
  app.get("/api/peers/code/tasks/:task", run((req, p) => codeShare(p).view(id.parse(req.params.task))));
  app.put("/api/peers/code/tasks/:task/people", run((req, p) => codeShare(p).share(id.parse(req.params.task), check(z.object({ people: z.array(address).max(16) }).strict(), req.body).people)));
  app.post("/api/peers/code/tasks/:task/refine", run((req, p) => {
    const data = check(z.object({ item: id, from: address }).strict(), req.body);
    return codeShare(p).refineWith(id.parse(req.params.task), data.item, data.from);
  }));
  app.post("/api/peers/code/looking", run((req, p) => codeShare(p).looking(check(z.object({ task: id.optional(), mirror: id.optional(), on: z.boolean() }).strict(), req.body))));
  // A whole project: who is invited and what of their comments reaches Bruno; their comments.
  const comments = z.enum(["nunca", "pregunta", "siempre"]);
  const projectId = z.string().trim().min(1).max(80);
  app.get("/api/peers/code/projects/:project", run((req, p) => codeShare(p).projectView(projectId.parse(req.params.project))));
  app.put("/api/peers/code/projects/:project/people", run((req, p) => codeShare(p).inviteProject(projectId.parse(req.params.project), check(z.object({ people: z.array(z.object({ id: address, comments: comments.optional() }).strict()).max(16) }).strict(), req.body).people)));
  app.post("/api/peers/code/comments/:id/forward", run((req, p) => codeShare(p).forwardComment(z.string().max(80).parse(req.params.id))));
  app.post("/api/peers/code/comments/:id/drop", run((req, p) => codeShare(p).dropComment(z.string().max(80).parse(req.params.id))));
  // «Pedir revisión a…»: the owner asks; the reviewer drafts (by hand or with their bot) and sends.
  const finding = z.object({ severity: z.enum(["P0", "P1", "P2", "P3"]), title: z.string().trim().max(160), file: z.string().max(300).nullable().optional(), line: z.number().int().min(0).max(10_000_000).nullable().optional(), detail: z.string().max(800).optional() }).strict();
  app.post("/api/peers/code/tasks/:task/review", run((req, p) => { const data = check(z.object({ person: address, note: z.string().max(2000).optional() }).strict(), req.body); return codeShare(p).askReview(id.parse(req.params.task), data.person, data.note || ""); }));
  app.post("/api/peers/code/shared/:id/review/draft", run((req, p) => codeShare(p).draftAdd(id.parse(req.params.id), check(finding, req.body))));
  app.delete("/api/peers/code/shared/:id/review/draft/:finding", run((req, p) => codeShare(p).draftRemove(id.parse(req.params.id), z.string().max(20).parse(req.params.finding))));
  app.post("/api/peers/code/shared/:id/review/bot", run((req, p) => codeShare(p).botReview(id.parse(req.params.id))));
  app.post("/api/peers/code/shared/:id/review/send", run((req, p) => codeShare(p).submitReview(id.parse(req.params.id), check(z.object({ verdict: z.enum(["approve", "changes"]), summary: z.string().max(1200).optional() }).strict(), req.body))));
  app.get("/api/peers/code/invited", run((_req, p) => ({ items: codeShare(p).invitedProjects() })));
  app.post("/api/peers/code/shared/:id/diff", run((req, p) => codeShare(p).requestDiff(id.parse(req.params.id))));
  app.post("/api/peers/code/shared/:id/comments", run((req, p) => codeShare(p).comment(id.parse(req.params.id), check(z.object({ file: z.string().max(400), line: z.number().int().min(0).max(10_000_000), text: z.string().trim().min(1).max(2000), excerpt: z.string().max(2000).optional() }).strict(), req.body))));
  app.get("/api/peers/code/shared", run((_req, p) => ({ items: codeShare(p).mirrors() })));
  app.get("/api/peers/code/shared/:id", run((req, p) => codeShare(p).mirror(id.parse(req.params.id))));
  app.post("/api/peers/code/shared/:id/plan", run((req, p) => codeShare(p).planVote(id.parse(req.params.id), check(z.object({ action: z.enum(["approve", "changes"]), text: z.string().max(2000).optional() }).strict(), req.body))));
  // Files (files.mjs): sealed here, left at the mailbox in parts, opened only by who is in the conversation.
  const files = (p) => {
    if (!p.files) throw new PeerError("Los archivos no están disponibles.", 503);
    return p.files;
  };
  app.post("/api/peers/shares/:id/files", run((req, p) => {
    const data = check(z.object({ name: z.string().trim().min(1).max(200), content: z.string().min(1).max(Math.ceil(FILE_LIMITS.bytes / 3) * 4 + 8), caption: z.string().max(2000).optional() }).strict(), req.body);
    return files(p).send(req.params.id, { name: data.name, bytes: Buffer.from(data.content, "base64"), caption: data.caption || "" });
  }));
  app.post("/api/peers/shares/:id/files/artifact", run((req, p) => {
    const data = check(z.object({ artifact: z.string().trim().min(1).max(80), caption: z.string().max(2000).optional() }).strict(), req.body);
    return files(p).sendArtifact(req.params.id, data.artifact, data.caption || "");
  }));
  app.get("/api/peers/files/:id/preview", run((req, p) => files(p).preview(id.parse(req.params.id))));
  app.post("/api/peers/files/:id/retry", run((req, p) => files(p).retry(id.parse(req.params.id))));
  // The file itself: inline only for images and PDF (shown in a sandbox), anything else downloads.
  const sendFile = (res, file, target, inline) => {
    const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
    res.set({
      "Content-Type": inline ? file.mime : "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox", "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": (inline ? "inline" : "attachment") + `; filename="${ascii}"; filename*=UTF-8''` + encodeURIComponent(file.name),
    });
    res.sendFile(target, { dotfiles: "allow" }); // the data folder may sit under a dot folder
  };
  const INLINE = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;
  app.get("/api/peers/files/:id", (req, res, next) => {
    try {
      const { file, path: target } = files(peers()).pathOf(id.parse(req.params.id));
      sendFile(res, file, target, req.query.download !== "1" && INLINE.test(file.mime));
    } catch (error) { next(error instanceof PeerError ? new HttpError(error.status, error.message) : error); }
  });
  app.get("/api/peers/files/:id/pages/:n", async (req, res, next) => {
    try {
      const n = Number(req.params.n);
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, "Página no válida.");
      const width = Math.min(1600, Math.max(320, Number(req.query.width) || 900));
      const { png } = await files(peers()).page(id.parse(req.params.id), n, width);
      res.set({ "Content-Type": "image/png", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "private, max-age=3600" }).send(png);
    } catch (error) { next(error instanceof PeerError ? new HttpError(error.status, error.message) : error); }
  });
  // Errands for your bots (errands.mjs): approve or decline one; the tools they may use.
  const errands = (p) => {
    if (!p.errands) throw new PeerError("Los encargos no están disponibles.", 503);
    return p.errands;
  };
  app.post("/api/peers/errands/:id/approve", run((req, p) => errands(p).approve(id.parse(req.params.id))));
  app.post("/api/peers/errands/:id/decline", run((req, p) => errands(p).decline(id.parse(req.params.id))));
  app.get("/api/peers/errand-tools", run((_req, p) => errands(p).settings()));
  app.put("/api/peers/errand-tools", run((req, p) => errands(p).setTools(check(z.object({ web: z.boolean().optional(), carpetas: z.boolean().optional(), apps: z.boolean().optional(), ordenador: z.boolean().optional() }).strict(), req.body))));
  app.get("/api/peers/search", run((req, p) => p.search(check(z.string().max(200), String(req.query.q ?? "")), { shareId: typeof req.query.share === "string" && req.query.share ? req.query.share : null })));
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
