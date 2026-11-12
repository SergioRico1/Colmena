import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { id, now } from "./store.mjs";
import { containsSecret, factProblem, MEMORY_LIMITS, memoryUsage, scanMemoryThreat, settleCore } from "./memory.mjs";

// «Traer lo que ChatGPT sabe de ti» (OpenClaw memory import): the browser reads the export
// or the pasted list (src/lib/chatgptImport.js) and sends only candidate lines. Here each one
// is checked (no secrets, no orders, no duplicates) for a preview; nothing is written until you
// choose the lines and confirm. Before writing, a copy of the whole memory goes to
// backups/memoria-<fecha>.json. The person's facts beyond the limit are condensed into USER.md;
// what still does not fit in a store stays in its archive (memory.mjs), never refused.
//
//   POST /api/memories/import/preview {source, items:[{text, from?}]} → {items:[…status, reason, target], usage}
//   POST /api/memories/import         {source, items:[{text, target}]} → {added, skipped, backup}
export const IMPORT_SOURCES = { "chatgpt-memoria": "Importado de la memoria de ChatGPT", "chatgpt-export": "Importado de tus conversaciones de ChatGPT" };

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function reviewImport(store, items) {
  const existing = new Set(store.list("memories").filter((m) => m.active !== false && typeof m.text === "string").map((m) => fold(m.text)));
  const seen = new Set();
  return items.map(({ text, from = null }) => {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    const key = fold(value);
    // What ChatGPT knew is about you; «Del equipo» is one click away for a shared fact.
    const target = "user";
    let status = "ok", reason = null;
    if (containsSecret(value)) { status = "bloqueado"; reason = "Parece una clave, contraseña o dato de pago: no se guarda."; }
    else if (scanMemoryThreat(value)) { status = "bloqueado"; reason = scanMemoryThreat(value); }
    else if (existing.has(key)) { status = "duplicado"; reason = "Ya está en la memoria."; }
    else if (seen.has(key)) { status = "duplicado"; reason = "Repetido en la lista."; }
    else if (factProblem(value)) { status = "revisar"; reason = "Es una indicación, no un hecho: cámbialo si quieres guardarlo."; }
    seen.add(key);
    return { text: value, from, target, status, reason };
  });
}

export function registerMemoryImportRoutes(app, { store, runtime, z, check }) {
  const source = z.enum(Object.keys(IMPORT_SOURCES));
  const usage = () => ({ user: memoryUsage(store, "user"), memory: memoryUsage(store, "memory") });

  app.post("/api/memories/import/preview", (req, res) => {
    const data = check(z.object({ source, items: z.array(z.object({ text: z.string().max(2000), from: z.string().max(200).nullable().optional() }).strict()).min(1).max(400) }).strict(), req.body);
    res.json({ items: reviewImport(store, data.items), usage: usage(), limits: MEMORY_LIMITS });
  });

  app.post("/api/memories/import", async (req, res) => {
    const data = check(z.object({ source, items: z.array(z.object({ text: z.string().trim().min(3).max(2000), target: z.enum(["user", "memory"]) }).strict()).min(1).max(120) }).strict(), req.body);
    const reviewed = reviewImport(store, data.items.map((x) => ({ text: x.text })));
    const keep = reviewed.map((r, i) => ({ ...r, target: data.items[i].target })).filter((r) => r.status === "ok" || r.status === "revisar");
    // A copy of the whole memory first, so an import can always be undone by hand.
    const folder = path.join(store.directory, "backups");
    await mkdir(folder, { recursive: true });
    const backup = `memoria-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(path.join(folder, backup), JSON.stringify({ at: now(), memories: store.list("memories") }, null, 2), { flag: "wx" });
    const label = IMPORT_SOURCES[data.source];
    const batch = id();
    store.tx(() => {
      keep.forEach((r, i) => store.put("memories", {
        id: `${batch}:${i}`, text: r.text, botId: null, scope: "equipo", target: r.target, kind: r.target === "user" ? "preferencia" : "hecho",
        source: "importado", sourceLabel: label, origin: "persona", importBatch: batch, review: false, active: true, missionId: null, tier: "core", createdAt: now(),
      }));
      // The team's store has no condenser: what does not fit goes to its archive.
      settleCore(store, "memory");
    });
    // More about you than fits: the daily condenser folds it into USER.md now.
    if (memoryUsage(store, "user").used > MEMORY_LIMITS.user && typeof runtime?.condenseUserProfile === "function")
      void Promise.resolve().then(() => runtime.condenseUserProfile({ force: true })).catch(() => {}).finally(() => { try { settleCore(store, "user"); } catch {} });
    else settleCore(store, "user");
    res.json({ added: keep.length, skipped: data.items.length - keep.length, backup, batch, usage: usage() });
  });
}
