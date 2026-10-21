import { z } from "zod";
import { activateSkill, setSkillPinned, curateSkills, skillsUsedByAutomations, resolveSkillApproval } from "./skills.mjs";
import { capabilitiesOf, CAPABILITY_DEFAULTS } from "./tools.mjs";
import { memoryMeters, MEMORY_LIMITS } from "./memory.mjs";
import { userProfile, saveUserProfile, learningCounters, REVIEW_EVERY } from "./learning.mjs";
import { learningTimeline, teachPrompt, TEACH_SOURCES } from "./journey.mjs";

// HTTP routes of the learning loop and bot capabilities. The coordinator mounts them
// in createApp() BEFORE the final `/api` 404 handler:  registerLearningRoutes(app, { store, runtime, computerAvailable })
// (the CSRF/origin middleware and the JSON error handler of app.mjs apply as usual).
//
//   POST  /api/missions/:id/learn        «Aprende de esta misión» → {status, skill, memories, soul, notes, reasons}
//   GET   /api/missions/:id/learn        → {learningStatus, learningError, learning}
//   GET   /api/bots/:id/learning         → {capabilities, computer, memory:{user,memory,bot}, counters, skills:[…+pinned,lastUsedAt]}
//   PATCH /api/bots/:id/capabilities     {web?, carpetas?, apps?, ordenador?} → {capabilities}
//   GET   /api/learning/skills           → every skill with curation fields (Biblioteca)
//   PATCH /api/skills/:id/curation       {pinned?, status?: 'active'|'archived'} («Fijar», «Reactivar», archivar)
//   POST  /api/learning/curate           runs the curator now → {checked, stale, archived, reactivated}
//   GET   /api/user-profile              → {content, chars, limit, updatedAt, directives}
//   PUT   /api/user-profile              {content} (edited by the person)
//   POST  /api/user-profile/condense     condenses the person's memories into USER.md now

const httpError = (status, message) => Object.assign(Error(message), { status });
const check = (schema, input) => schema.parse(input ?? {});
const capabilityPatch = z.object({ web: z.boolean(), carpetas: z.boolean(), apps: z.boolean(), ordenador: z.boolean() }).partial().strict();
const curationPatch = z.object({ pinned: z.boolean(), status: z.enum(["active", "archived"]) }).partial().strict()
  .refine((d) => d.pinned !== undefined || d.status, { message: "Indica pinned o status." });

/** Skill summary plus the curator fields (pinned, lastUsedAt, protected by an automation). */
export function curatedSkill(s, protectedIds = new Set()) {
  return {
    id: s.id, name: s.name, description: s.description || "", botId: s.botId ?? null,
    status: s.status || "pending", origin: s.origin || (s.missionId ? "learned" : "imported"), version: s.version || 1,
    steps: s.steps ?? 0, uses: s.uses || 0, learnedFrom: s.learnedFrom ?? null, missionId: s.missionId ?? null,
    createdAt: s.createdAt ?? null, pinned: !!s.pinned, lastUsedAt: s.lastUsedAt ?? null,
    curatedAt: s.curatedAt ?? null, automation: protectedIds.has(s.id), previous: typeof s.previous === "string" ? s.previous : null,
  };
}

export function registerLearningRoutes(app, { store, runtime, computerAvailable = null } = {}) {
  if (!store) throw Error("registerLearningRoutes necesita el almacén.");
  const mustGet = (kind, key, what) => {
    const record = store.get(kind, key);
    if (!record) throw httpError(404, what + " no encontrado.");
    return record;
  };
  const computer = () => {
    try {
      const value = typeof computerAvailable === "function" ? computerAvailable() : null;
      return { available: value === true || value?.available === true, label: value?.label || null };
    } catch {
      return { available: false, label: null };
    }
  };

  app.post("/api/missions/:id/learn", async (req, res) => {
    mustGet("missions", req.params.id, "Misión");
    if (typeof runtime?.learnNow !== "function") throw httpError(501, "Disponible más adelante.");
    res.json(await runtime.learnNow(req.params.id));
  });
  app.get("/api/missions/:id/learn", (req, res) => {
    const m = mustGet("missions", req.params.id, "Misión");
    res.json({ learningStatus: m.learningStatus || null, learningError: m.learningError || null, learning: m.learning || null });
  });

  // «Qué ha aprendido»: the bot's learning timeline, newest first.
  app.get("/api/bots/:id/timeline", (req, res) => {
    const bot = mustGet("bots", req.params.id, "Bot");
    res.json({ items: learningTimeline(store, bot.id) });
  });
  // «Enséñale»: a short room where the bot studies the material and says what it understood.
  app.post("/api/bots/:id/teach", (req, res) => {
    const bot = mustGet("bots", req.params.id, "Bot");
    const data = check(z.object({
      what: z.string().trim().min(3).max(300),
      source: z.object({ type: z.enum(TEACH_SOURCES), value: z.string().trim().max(20000).default("") }).strict().default({ type: "texto", value: "" }),
    }).strict(), req.body);
    if (data.source.type === "web" && !/^https?:\/\//i.test(data.source.value)) throw httpError(400, "Escribe la dirección completa de la página (https://…).");
    if (bot.enabled === false) throw httpError(409, bot.name + " está desactivado.");
    if (typeof runtime?.create !== "function") throw httpError(501, "Disponible más adelante.");
    const prompt = teachPrompt(store, data);
    const what = data.what.replace(/[.\s]+$/, "");
    const mission = runtime.create({ prompt, title: "Aprender " + what.slice(0, 70), mode: "solo", botIds: [bot.id] });
    store.patch("missions", mission.id, { teach: { what, source: data.source.type } });
    runtime.launch?.(mission.id);
    res.status(201).json(store.get("missions", mission.id));
  });
  app.get("/api/bots/:id/learning", (req, res) => {
    const bot = mustGet("bots", req.params.id, "Bot");
    const protectedIds = skillsUsedByAutomations(store);
    const meters = memoryMeters(store, bot.id);
    res.json({
      capabilities: capabilitiesOf(bot),
      computer: computer(),
      memory: { ...meters, limits: MEMORY_LIMITS },
      counters: { ...learningCounters(store, bot.id), every: REVIEW_EVERY },
      skills: store.list("skills").filter((s) => s.botId === bot.id).map((s) => curatedSkill(s, protectedIds)),
    });
  });
  app.patch("/api/bots/:id/capabilities", (req, res) => {
    const patch = check(capabilityPatch, req.body);
    const bot = mustGet("bots", req.params.id, "Bot");
    if (patch.ordenador === true && !computer().available)
      throw httpError(422, "Usar el ordenador estará disponible con la app de escritorio de Colmena.");
    const updated = store.patch("bots", bot.id, (old) => ({ capabilities: { ...CAPABILITY_DEFAULTS, ...(old.capabilities || {}), ...patch } }));
    res.json({ capabilities: capabilitiesOf(updated) });
  });

  app.get("/api/learning/skills", (_req, res) => {
    const protectedIds = skillsUsedByAutomations(store);
    res.json(store.list("skills").map((s) => curatedSkill(s, protectedIds)));
  });
  app.patch("/api/skills/:id/curation", (req, res) => {
    const data = check(curationPatch, req.body);
    const skill = mustGet("skills", req.params.id, "Habilidad");
    if (data.pinned !== undefined) setSkillPinned(store, skill.id, data.pinned);
    if (data.status === "active") {
      if (!["stale", "archived", "disabled", "active"].includes(skill.status)) throw httpError(409, "Revisa primero esta habilidad: aún no está aprobada.");
      activateSkill(store, skill.id, "active");
      resolveSkillApproval(store, skill.id, "active");
    } else if (data.status === "archived") {
      if (skill.status === "pending") throw httpError(409, "Una habilidad sin revisar se descarta, no se archiva.");
      store.patch("skills", skill.id, { status: "archived", curatedAt: new Date().toISOString(), curatedFrom: skill.status });
    }
    res.json(curatedSkill(store.get("skills", skill.id), skillsUsedByAutomations(store)));
  });
  app.post("/api/learning/curate", (_req, res) => res.json(curateSkills(store, Date.now())));

  app.get("/api/user-profile", (_req, res) => res.json(userProfile(store)));
  app.put("/api/user-profile", (req, res) => {
    const { content } = check(z.object({ content: z.string().max(2800) }).strict(), req.body);
    res.json(saveUserProfile(store, content));
  });
  app.post("/api/user-profile/condense", async (_req, res) => {
    if (typeof runtime?.condenseUserProfile !== "function") throw httpError(501, "Disponible más adelante.");
    const result = await runtime.condenseUserProfile({ force: true });
    res.json({ status: result.status, profile: userProfile(store) });
  });
  return app;
}
