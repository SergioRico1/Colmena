import { forget } from "../forgotten.mjs";
import { z } from "zod";
import { id, now } from "../store.mjs";
import * as skillsModule from "../skills.mjs";
import { skillSummary, memorySummary } from "../state.mjs";
import { registerMemoryImportRoutes } from "../memory-import.mjs";
import { notFound, short, check } from "./shared.mjs";

/** Skills and memories. */
export function registerSkillRoutes(app, { store, mustGet, runtime, optional }) {
  // ------------------------------------------------ skills & memories
  app.get("/api/skills", (_req, res) => res.json(store.list("skills").filter((s) => !s.removed).map(skillSummary)));
  app.get("/api/skills/:id", (req, res) => {
    const skill = mustGet("skills", req.params.id, "Habilidad");
    const detail = typeof skillsModule.skillDetail === "function" ? skillsModule.skillDetail(store, skill.id) : null;
    const prior = detail?.previous ?? (typeof skill.previous === "string" ? store.get("skills", skill.previous) : null);
    res.json({ ...skillSummary(skill), content: skill.content, previous: prior ? { version: prior.version, content: prior.content } : null });
  });
  // Runtime-owned resolver when available (method or module export), else the store.
  const skillResolver = async () => {
    if (typeof runtime?.resolveSkillApproval === "function") return (skillId, decision) => runtime.resolveSkillApproval(skillId, decision);
    for (const name of ["./runtime.mjs", "./learning.mjs"]) {
      const mod = await optional(name);
      if (typeof mod?.resolveSkillApproval === "function") return (skillId, decision) => mod.resolveSkillApproval(store, skillId, decision);
    }
    return null;
  };
  app.patch("/api/skills/:id", async (req, res) => {
    const { status } = check(z.object({ status: z.enum(["active", "disabled", "pending"]) }).strict(), req.body);
    mustGet("skills", req.params.id, "Habilidad");
    const skill = skillsModule.activateSkill(store, req.params.id, status);
    const resolver = status !== "pending" ? await skillResolver() : null;
    // A reviewed skill also resolves its pending entry in the Bandeja.
    if (resolver) await resolver(skill.id, status === "active" ? "approved" : "denied");
    else if (status !== "pending")
      for (const a of store.list("approvals").filter((x) => x.skillId === skill.id && x.status === "pending"))
        store.patch("approvals", a.id, { status: status === "active" ? "approved" : "denied", decidedAt: now(), decidedBy: "tú" });
    res.json(skillSummary(skill));
  });
  app.post("/api/skills", (req, res) => {
    const data = check(z.object({ content: z.string().min(20).max(60000), source: z.string().max(500).optional(), botId: short.nullable().optional() }).strict(), req.body);
    if (data.botId) mustGet("bots", data.botId, "Bot");
    res.status(201).json(skillSummary(skillsModule.importSkill(store, { ...data, botId: data.botId ?? null })));
  });
  app.post("/api/memories", (req, res) => {
    const data = check(z.object({ text: z.string().trim().min(1).max(2000), botId: short.nullable().optional(), scope: z.enum(["bot", "equipo"]).optional() }).strict(), req.body);
    if (data.botId) mustGet("bots", data.botId, "Bot");
    const scope = data.scope || (data.botId ? "bot" : "equipo");
    if (scope === "bot" && !data.botId) throw Error("Elige de qué bot es este recuerdo.");
    const memory = store.put("memories", { id: id(), text: data.text, botId: data.botId ?? null, scope, source: "dijiste", review: false, missionId: null, active: true, createdAt: now() });
    res.json(memorySummary(memory));
  });
  registerMemoryImportRoutes(app, { store, runtime, z, check });
  app.patch("/api/memories/:id", (req, res) => {
    const data = check(z.object({ text: z.string().trim().min(1).max(2000), review: z.boolean() }).partial().strict(), req.body);
    mustGet("memories", req.params.id, "Recuerdo");
    res.json(memorySummary(store.patch("memories", req.params.id, data)));
  });
  app.delete("/api/memories/:id", (req, res) => {
    const memory = store.get("memories", req.params.id);
    if (!store.remove("memories", req.params.id)) throw notFound("Recuerdo");
    // A bot's deduction you threw away is never learned again (forgotten.mjs).
    if (memory.source !== "dijiste") forget(store, "memory", memory.text, null, { missionId: memory.missionId ?? null, reason: "rejected" });
    res.json({ ok: true });
  });
}
