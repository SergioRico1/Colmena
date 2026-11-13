// Ajustes › Cuentas de IA › «Conectar otra IA»: Gemini, OpenRouter, DeepSeek, Kimi and
// «Servidor propio» (server/providers/accounts.mjs). The key travels once, in the body of a
// POST to this loopback server; answers never carry it back (only its last four characters).
import { z } from "zod";
import { KEY_ENGINES } from "../providers/catalog.mjs";
import { COMPATIBLE } from "../providers/accounts.mjs";
import { HttpError, SOON, check } from "./shared.mjs";

const fields = z.object({
  key: z.string().max(2000).optional(),
  baseUrl: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  vision: z.boolean().optional(),
}).strict();

export function registerAiAccountRoutes(app, { hub, emit, changed }) {
  const accounts = () => {
    const a = hub()?.accounts;
    if (!a) throw new HttpError(501, SOON);
    return a;
  };
  const engineOf = (req) => {
    const engine = String(req.params.engine || "");
    if (!KEY_ENGINES.includes(engine)) throw new HttpError(404, "Esa IA no existe.");
    return engine;
  };
  // What the connect flow shows for each provider: where to get the key and what it looks like.
  app.get("/api/ai/accounts", (_req, res) => {
    res.json({ providers: KEY_ENGINES.map((id) => ({ id, keyUrl: COMPATIBLE[id].keyUrl || null, keySite: COMPATIBLE[id].keySite || null, placeholder: COMPATIBLE[id].placeholder, keyOptional: !!COMPATIBLE[id].keyOptional, dynamic: !!COMPATIBLE[id].dynamic })) });
  });
  // «Probar»: a tiny answer with what was typed (or what is saved).
  app.post("/api/ai/accounts/:engine/test", async (req, res) => {
    const engine = engineOf(req);
    const data = check(fields, req.body || {});
    res.json(await accounts().test(engine, data));
  });
  // The models to pick from (OpenRouter's list, the server's /models, the catalogue).
  app.post("/api/ai/accounts/:engine/models", async (req, res) => {
    const engine = engineOf(req);
    const data = check(fields, req.body || {});
    res.json({ models: await accounts().listModels(engine, data) });
  });
  app.post("/api/ai/accounts/:engine", async (req, res) => {
    const engine = engineOf(req);
    const data = check(fields, req.body || {});
    const engines = await accounts().connect(engine, data);
    changed();
    emit(["account"]);
    res.json({ ok: true, engines });
  });
  // The model an account thinks with (null: «Automático»).
  app.patch("/api/ai/accounts/:engine", async (req, res) => {
    const engine = engineOf(req);
    const { model } = check(z.object({ model: z.string().trim().max(240).nullable() }).strict(), req.body || {});
    const engines = await accounts().setModel(engine, model);
    changed();
    emit(["account"]);
    res.json({ ok: true, engines });
  });
}
