// The HTTP routes of team messaging (/api/chat/*, docs/CLOUD.md › Phase 2), mounted by the hosted
// workspace after its guard: every request already runs as its person (server/identity.mjs). The
// rules themselves live in chat.mjs; here they are only called and their errors given a status.
import express from "express";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { currentPerson } from "../identity.mjs";
import { ChatError, CHAT_LIMITS } from "./chat.mjs";
import { zipStream } from "./zip.mjs";
import { validSubscription } from "./webpush.mjs";

/** Stores an uploaded file's bytes (or stream) and registers it, waiting to be sent in a message. */
export async function uploadFile({ chat, blobs }, person, { channel, name, type, size, width, height, body }) {
  const n = Math.floor(Number(size));
  if (!(n >= 0)) throw new ChatError("Falta el tamaño del archivo.", 411);
  if (n > CHAT_LIMITS.fileMax) throw new ChatError("El archivo es demasiado grande (máximo 100 MB).", 413);
  chat.mustPost(person, String(channel || ""));
  const id = randomUUID();
  const key = chat.fileKey(channel, id, name);
  await blobs.put(key, body, { size: n, type: String(type || "application/octet-stream").slice(0, 100) });
  return chat.registerFile(person, channel, { id, key, name, type, size: n, width: Number(width) || null, height: Number(height) || null });
}

/** Headers for serving a stored file: only images, audio, video and PDF inline, everything else downloads. */
export function fileHeaders(file, { download = false } = {}) {
  const type = String(file.type || "application/octet-stream");
  const inline = !download && /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|audio\/|video\/)/i.test(type);
  const ascii = String(file.name || "archivo").replace(/[^\x20-\x7e]|["\\]/g, "_");
  return {
    "Content-Type": inline ? type : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name || "archivo")}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=3600",
  };
}

export function chatRoutes(app, { chat, importer, blobs, workspace, presence, push }) {
  const me = () => currentPerson();
  const run = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (error) {
      if (res.headersSent) return;
      const status = error instanceof ChatError || error?.status ? error.status || 400 : 500;
      if (status >= 500) console.error("chat: " + (error?.stack || error));
      res.status(status).json({ error: status >= 500 ? "Algo ha fallado. Prueba otra vez." : error.message, code: error.code || null });
    }
  };
  const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

  app.get("/api/chat/bootstrap", run(() => {
    const person = me();
    const self = chat.must(person);
    return {
      me: { id: self.id, name: self.name, email: self.email, role: self.role, profile: chat.myProfile(self.id) },
      people: chat.directory(), channels: chat.myChannels(person), settings: chat.isAdmin(person) ? chat.settings() : { defaultChannels: chat.settings().defaultChannels },
      push: { publicKey: push?.publicKey || null }, workspace,
    };
  }));
  app.get("/api/chat/people", run(() => { chat.must(me()); return { people: chat.directory() }; }));
  app.patch("/api/chat/me", run((req) => chat.updateMe(me(), body(req))));
  app.get("/api/chat/presence", run(() => { chat.must(me()); return { presence: Object.fromEntries(presence()) }; }));

  // ---- channels
  app.get("/api/chat/channels", run(() => ({ channels: chat.myChannels(me()) })));
  app.get("/api/chat/channels/browse", run(() => ({ channels: chat.browse(me()) })));
  app.post("/api/chat/channels", run((req, res) => { res.status(201); return chat.createChannel(me(), body(req)); }));
  app.post("/api/chat/dm", run((req) => chat.openDm(me(), Array.isArray(body(req).people) ? body(req).people : [])));
  app.get("/api/chat/channels/:id", run((req) => chat.channel(me(), req.params.id)));
  app.patch("/api/chat/channels/:id", run((req) => chat.updateChannel(me(), req.params.id, body(req))));
  app.post("/api/chat/channels/:id/join", run((req) => chat.join(me(), req.params.id)));
  app.post("/api/chat/channels/:id/leave", run((req) => chat.leave(me(), req.params.id)));
  app.post("/api/chat/channels/:id/members", run((req) => chat.addMembers(me(), req.params.id, Array.isArray(body(req).people) ? body(req).people : [])));
  app.delete("/api/chat/channels/:id/members/:person", run((req) => chat.removeMember(me(), req.params.id, req.params.person)));
  app.get("/api/chat/channels/:id/messages", run((req) => {
    const q = req.query || {};
    const num = (v) => (v == null || v === "" ? null : Number(v));
    return chat.history(me(), req.params.id, { before: num(q.before), after: num(q.after), around: q.message ? chat.seqOf(me(), req.params.id, String(q.message)) : num(q.around), limit: num(q.limit) || undefined });
  }));
  app.post("/api/chat/channels/:id/messages", run((req, res) => { res.status(201); return chat.post(me(), req.params.id, body(req)); }));
  app.get("/api/chat/channels/:id/pins", run((req) => chat.pins(me(), req.params.id)));
  app.post("/api/chat/channels/:id/read", run((req) => chat.markRead(me(), req.params.id, body(req).seq ?? null)));
  app.put("/api/chat/channels/:id/draft", run((req) => chat.setDraft(me(), req.params.id, body(req).text)));
  app.put("/api/chat/channels/:id/prefs", run((req) => chat.setPrefs(me(), req.params.id, body(req))));

  // ---- messages
  app.get("/api/chat/messages/:id/thread", run((req) => chat.thread(me(), req.params.id)));
  app.patch("/api/chat/messages/:id", run((req) => chat.edit(me(), req.params.id, body(req).text)));
  app.delete("/api/chat/messages/:id", run((req) => chat.remove(me(), req.params.id)));
  app.post("/api/chat/messages/:id/reactions", run((req) => chat.react(me(), req.params.id, body(req).emoji, body(req).on !== false)));
  app.post("/api/chat/messages/:id/pin", run((req) => chat.pin(me(), req.params.id, body(req).on !== false)));
  app.get("/api/chat/search", run((req) => chat.search(me(), String(req.query?.q || ""), { before: req.query?.before ? Number(req.query.before) : null })));
  app.get("/api/chat/mentions", run((req) => chat.mentions(me(), { before: req.query?.before ? Number(req.query.before) : null })));

  // ---- files (the Durable Object streams uploads and downloads itself; these serve Node and small files)
  app.put("/api/chat/files", express.raw({ type: () => true, limit: "100mb" }), run(async (req, res) => {
    const q = req.query || {};
    res.status(201);
    return uploadFile({ chat, blobs }, me(), { channel: q.channel, name: q.name, type: req.headers["content-type"], size: req.body?.length ?? 0, width: q.w, height: q.h, body: req.body ? new Uint8Array(req.body) : new Uint8Array(0) });
  }));
  app.get("/api/chat/files/:id", run(async (req, res) => {
    const file = chat.fileFor(me(), req.params.id);
    const found = await blobs.get(file.key);
    if (!found) throw new ChatError("No existe ese archivo.", 404);
    res.set({ ...fileHeaders(file, { download: req.query?.download === "1" }), "Content-Length": String(found.size) });
    Readable.fromWeb(found.body).pipe(res);
  }));

  // ---- notifications on devices (Web Push)
  app.post("/api/chat/push", run((req) => {
    const sub = validSubscription(body(req).subscription);
    if (!sub) throw new ChatError("Ese dispositivo no admite avisos.", 400);
    return chat.addPush(me(), sub, { agent: req.headers["user-agent"] });
  }));
  app.delete("/api/chat/push", run((req) => chat.removePush(me(), body(req).endpoint)));
  app.post("/api/chat/push/test", run(async () => {
    const person = me();
    chat.must(person);
    if (!push?.send) throw new ChatError("Los avisos en el dispositivo no están configurados.", 501);
    return push.send(person.id, { title: "Colmena", body: "Así te llegarán los avisos.", url: "/canales", tag: "test" });
  }));

  // ---- workspace admin
  app.get("/api/chat/admin", run(() => chat.adminOverview(me())));
  app.patch("/api/chat/admin/settings", run((req) => chat.setSettings(me(), body(req))));
  app.get("/api/chat/admin/audit", run((req) => chat.auditLog(me(), { before: req.query?.before ? Number(req.query.before) : null })));
  app.get("/api/chat/admin/export.zip", run(async (req, res) => {
    const person = me();
    chat.mustAdmin(person);
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="colmena-export-${stamp}.zip"`, "Cache-Control": "no-store" });
    Readable.fromWeb(zipStream(chat.exportEntries(person, { workspace, files: req.query?.files !== "0" }))).pipe(res);
  }));

  // ---- Slack import
  app.get("/api/chat/import", run(() => { chat.mustAdmin(me()); return { import: importer.view(importer.latest()) }; }));
  app.post("/api/chat/import", run((req, res) => { res.status(201); return importer.create(me(), body(req)); }));
  app.put("/api/chat/import/:id/parts/:n", express.raw({ type: () => true, limit: "70mb" }), run((req) => importer.putPart(me(), req.params.id, req.params.n, req.body ? new Uint8Array(req.body) : new Uint8Array(0), req.body?.length ?? 0)));
  app.post("/api/chat/import/:id/start", run((req) => importer.start(me(), req.params.id)));
  app.post("/api/chat/import/:id/cancel", run((req) => importer.cancel(me(), req.params.id)));
}
