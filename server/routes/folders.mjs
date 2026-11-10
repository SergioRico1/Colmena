import path from "node:path";
import { id, now } from "../store.mjs";
import { HttpError, notFound, folderFields, personFields, check, fold } from "./shared.mjs";

/** Working folders and people. */
export function registerFolderRoutes(app, { mustGet, validateFolder, store }) {
  // --------------------------------------------- folders & people & search
  const folderBots = (botIds = []) => {
    for (const b of botIds) mustGet("bots", b, "Bot");
    return [...new Set(botIds)];
  };
  app.post("/api/folders", async (req, res) => {
    const data = check(folderFields.partial({ label: true, botIds: true, access: true }).strict(), req.body);
    const real = await validateFolder(data.path, store.directory);
    if (store.list("folders").some((f) => fold(f.path) === fold(real))) throw new HttpError(409, "Esa carpeta ya está añadida.");
    const folder = store.put("folders", { id: id(), path: real, label: data.label || path.basename(real), botIds: folderBots(data.botIds), access: data.access || "lee", createdAt: now() });
    res.status(201).json(folder);
  });
  app.patch("/api/folders/:id", (req, res) => {
    const data = check(folderFields.omit({ path: true }).partial().strict(), req.body);
    mustGet("folders", req.params.id, "Carpeta");
    if (data.botIds) data.botIds = folderBots(data.botIds);
    res.json(store.patch("folders", req.params.id, data));
  });
  app.delete("/api/folders/:id", (req, res) => {
    if (!store.remove("folders", req.params.id)) throw notFound("Carpeta");
    res.json({ ok: true });
  });
  const notSelf = (personId) => {
    if (personId === "me") throw Error("Tu propia ficha se cambia en Ajustes › Espacio.");
  };
  app.get("/api/people", (_req, res) => res.json(store.list("people")));
  app.post("/api/people", (req, res) => {
    const data = check(personFields.partial({ email: true, role: true }).strict(), req.body);
    if (data.email && store.list("people").some((p) => p.email?.toLowerCase() === data.email.toLowerCase())) throw new HttpError(409, "Ya hay una persona con ese correo.");
    res.status(201).json(store.put("people", { id: id(), name: data.name, email: data.email ?? null, role: data.role || "", createdAt: now() }));
  });
  app.patch("/api/people/:id", (req, res) => {
    notSelf(req.params.id);
    const data = check(personFields.partial().strict(), req.body);
    mustGet("people", req.params.id, "Persona");
    res.json(store.patch("people", req.params.id, data));
  });
  app.delete("/api/people/:id", (req, res) => {
    notSelf(req.params.id);
    if (!store.remove("people", req.params.id)) throw notFound("Persona");
    res.json({ ok: true });
  });
  app.delete("/api/grants/:id", (req, res) => {
    const grant = store.get("grants", req.params.id);
    if (!grant) throw notFound("Regla");
    store.patch("grants", grant.id, { active: false, revokedAt: now() });
    res.json({ ok: true });
  });
}
