// HTTP routes of the MCP connections (Ajustes › Conexiones):
//   GET    /api/mcp/catalog            → {available, categories, items:[{id, name, via, category, description, server?}]}
//   GET    /api/mcp/servers            → {servers:[…]}
//   POST   /api/mcp/connect            {catalogId} | {url, name?} → {server, authorizeUrl?}
//   POST   /api/mcp/servers/:id/refresh → re-reads its tools
//   DELETE /api/mcp/servers/:id
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CATALOG, CATEGORIES, LOGO_SITES } from "./catalog.mjs";
import { serverView } from "./hub.mjs";

export function registerMcpRoutes(app, { hub, z }) {
  const parse = (schema, body) => schema.parse(body ?? {});
  app.get("/api/mcp/catalog", (req, res) => {
    const servers = hub.store.list("mcpServers");
    res.json({
      available: hub.available, categories: CATEGORIES,
      items: CATALOG.map((e) => {
        const s = e.via === "mcp" ? servers.find((x) => x.catalogId === e.id) : null;
        return { id: e.id, name: e.name, via: e.via, toolkit: e.toolkit || null, category: e.category, description: e.description, logo: LOGO_SITES[e.id] ? "/api/mcp/logo/" + e.id : null, server: s ? serverView(s) : null };
      }),
    });
  });
  // The site's own icon for brands without a simple-icons logo; fetched once, kept on disk.
  const logos = path.join(hub.store.directory, "logos");
  app.get("/api/mcp/logo/:id", async (req, res) => {
    const site = LOGO_SITES[req.params.id];
    if (!site) return res.status(404).end();
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
  app.post("/api/mcp/connect", async (req, res) => {
    const data = parse(z.object({ catalogId: z.string().min(1).max(60).optional(), url: z.string().min(8).max(2000).optional(), name: z.string().max(60).optional() }).strict()
      .refine((d) => d.catalogId || d.url, { message: "Elige una app del catálogo o escribe la dirección del servidor MCP." }), req.body);
    res.json(await hub.connect(data));
  });
  app.post("/api/mcp/servers/:id/refresh", async (req, res) => {
    hub.server(req.params.id);
    await hub.refreshTools(req.params.id, await hub.client(req.params.id));
    res.json(serverView(hub.server(req.params.id)));
  });
  app.delete("/api/mcp/servers/:id", async (req, res) => res.json(await hub.remove(req.params.id)));
}
