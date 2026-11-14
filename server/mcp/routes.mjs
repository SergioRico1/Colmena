// HTTP routes of the connections marketplace (Ajustes › Apps › Marketplace, docs/CONNECTIONS.md):
//   GET    /api/mcp/catalog              → {available, google, composio, categories, items:[entryView + servers]}
//   GET    /api/mcp/servers              → {servers:[…]} (the company's and yours; never someone else's)
//   POST   /api/mcp/connect              {catalogId | url, name?, token?, mail?, scope?} → {server, authorizeUrl?}
//   POST   /api/mcp/servers/:id/test     → {ok, error?, server} («Probar»)
//   POST   /api/mcp/servers/:id/refresh  → re-reads its tools
//   DELETE /api/mcp/servers/:id
//   GET    /api/mcp/composio             → {configured, mine, company, canRemove}
//   PUT    /api/mcp/composio             {key} → your own Composio key, checked live
//   DELETE /api/mcp/composio             → forget your own key (the company's, if any, applies again)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CATALOG, CATEGORIES, LOGO_SITES, entryView } from "./catalog.mjs";
import { serverView } from "./hub.mjs";
import { currentPerson, isPerson } from "../identity.mjs";

const mailSchema = (z) => z.object({
  email: z.string().min(3).max(254), password: z.string().min(1).max(300), name: z.string().max(80).optional(),
  provider: z.string().max(20).optional(),
  imap: z.object({ host: z.string().max(253), port: z.number().int(), tls: z.enum(["on", "starttls", "off"]).optional() }).strict().optional(),
  smtp: z.object({ host: z.string().max(253), port: z.number().int(), tls: z.enum(["on", "starttls", "off"]).optional() }).strict().optional(),
}).strict();

export function registerMcpRoutes(app, { hub, z, composio = null }) {
  const parse = (schema, body) => schema.parse(body ?? {});
  const fail = (res, error) => res.status(error.status || (error.name === "ZodError" ? 400 : 422)).json({ error: error.name === "ZodError" ? "Revisa los datos: falta algo o no tiene el formato esperado." : error.message });
  const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (error) { fail(res, error); } };

  app.get("/api/mcp/catalog", guard(async (req, res) => {
    const servers = hub.servers();
    const google = !!hub.googleClient?.();
    const key = composio ? await composio.status().catch(() => ({ configured: false })) : { configured: false };
    res.json({
      available: hub.available, google, composio: key, categories: CATEGORIES,
      // Who is looking (hosted): an owner or admin may connect an app for the whole company.
      person: isPerson(currentPerson()) ? { role: currentPerson().role } : null,
      items: CATALOG.filter((e) => e.listed !== false).map((e) => {
        const mine = e.auth === "composio" ? [] : servers.filter((s) => s.catalogId === e.id);
        return { ...entryView(e, { google }), server: mine[0] || null, servers: mine };
      }),
    });
  }));
  // The site's own icon for brands without a simple-icons logo; fetched once, kept on disk.
  const logos = path.join(hub.store.directory || "", "logos");
  app.get("/api/mcp/logo/:id", async (req, res) => {
    const site = LOGO_SITES[req.params.id];
    if (!site || !hub.store.directory) return res.status(404).end();
    const file = path.join(logos, req.params.id + ".img");
    let body = await readFile(file).catch(() => null);
    let type = await readFile(file + ".type", "utf8").catch(() => "image/x-icon");
    if (!body) {
      try {
        const r = await fetch("https://" + site + "/favicon.ico", { redirect: "follow", signal: AbortSignal.timeout(8000) });
        type = String(r.headers.get("content-type") || "").split(";")[0];
        const buf = Buffer.from(await r.arrayBuffer());
        if (!r.ok || !/^image\//.test(type) || buf.length > 300000 || !buf.length) return res.status(404).end();
        body = buf;
        await mkdir(logos, { recursive: true });
        await writeFile(file, body);
        await writeFile(file + ".type", type);
      } catch {
        return res.status(404).end();
      }
    }
    res.set({ "Content-Type": /^image\/(x-icon|vnd\.microsoft\.icon|png|jpeg|gif|webp)$/.test(type) ? type : "image/x-icon", "Cache-Control": "max-age=86400" });
    res.end(body);
  });
  app.get("/api/mcp/servers", (req, res) => res.json({ servers: hub.servers() }));
  app.post("/api/mcp/connect", guard(async (req, res) => {
    const data = parse(z.object({
      catalogId: z.string().min(1).max(60).optional(), url: z.string().min(8).max(2000).optional(), name: z.string().max(60).optional(),
      token: z.string().max(4000).optional(), mail: mailSchema(z).optional(), scope: z.enum(["mine", "company"]).optional(),
    }).strict().refine((d) => d.catalogId || d.url, { message: "Elige una app del catálogo o escribe la dirección del servidor MCP." }), req.body);
    res.json(await hub.connect(data));
  }));
  app.post("/api/mcp/servers/:id/test", guard(async (req, res) => res.json(await hub.test(req.params.id))));
  app.post("/api/mcp/servers/:id/refresh", guard(async (req, res) => {
    hub.server(req.params.id);
    await hub.refreshTools(req.params.id, await hub.client(req.params.id));
    res.json(serverView(hub.server(req.params.id)));
  }));
  app.delete("/api/mcp/servers/:id", guard(async (req, res) => res.json(await hub.remove(req.params.id))));

  // Composio: your own account's key (or the company's), checked against Composio before it is kept.
  app.get("/api/mcp/composio", guard(async (req, res) => res.json(composio ? await composio.status() : { configured: false, mine: false, company: false, canRemove: false })));
  app.put("/api/mcp/composio", guard(async (req, res) => {
    if (!composio) throw Object.assign(Error("Composio no está disponible aquí."), { status: 404 });
    const { key } = parse(z.object({ key: z.string().trim().min(10).max(300) }).strict(), req.body);
    if (!/^ak_[A-Za-z0-9_-]{10,200}$/.test(key)) throw Object.assign(Error("Eso no parece una clave de API de Composio (empieza por «ak_»)."), { status: 400 });
    try { await composio.setKey(key); } catch (e) { throw Object.assign(Error(/no respondi|inválid|401|403|unauthor/i.test(e.message) ? "Composio no aceptó esa clave. Cópiala otra vez desde composio.dev › Settings › API Keys." : e.message.replaceAll("Composio", "Composio")), { status: e.status || 422 }); }
    res.json(await composio.status());
  }));
  app.delete("/api/mcp/composio", guard(async (req, res) => {
    if (!composio?.removeKey) throw Object.assign(Error("Aquí la clave de Composio no se puede quitar."), { status: 404 });
    await composio.removeKey();
    res.json(await composio.status());
  }));
}
