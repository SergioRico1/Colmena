// «Traer las conversaciones de la nube» (server/cloud-import.mjs) over HTTP, on this computer only:
// POST /api/import/nube {zip (base64), preview?: true, me?: id} → what it holds, or what came in.
import express from "express";
import { z } from "zod";
import { ImportError, importExport, previewExport } from "../cloud-import.mjs";

/** A company's export is a ZIP of up to ~40 MB, sent as base64 in JSON (like «Notas» imports). */
export const cloudImportParser = (() => {
  const parse = express.json({ limit: "60mb" });
  return (req, res, next) => (req.method === "POST" && /^\/api\/import\/nube\/?$/.test(req.path) ? parse(req, res, next) : next());
})();

export function registerCloudImportRoutes(app, { store, rooms, runtime }) {
  app.post("/api/import/nube", async (req, res) => {
    try {
      const data = z.object({ zip: z.string().min(10).max(80 * 1024 * 1024), preview: z.boolean().optional(), me: z.string().max(80).nullable().optional() }).strict().parse(req.body);
      const bytes = Buffer.from(data.zip, "base64");
      res.json(data.preview ? await previewExport(bytes) : await importExport(bytes, { store, rooms, runtime, me: data.me || null }));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Falta el ZIP de la exportación." });
      res.status(error instanceof ImportError ? error.status : 500).json({ error: error.message || "No se pudo traer." });
    }
  });
}
