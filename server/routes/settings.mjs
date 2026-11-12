import { z } from "zod";
import { applyOnboarding, ROLES, DAILY_APPS } from "../onboarding.mjs";
import { short, check, safe } from "./shared.mjs";

/** Ajustes: reading and changing the settings. */
export function registerSettingsRoutes(app, { listModels, store, runtime }) {
  // --------------------------------------------------------- settings
  const settingsPatch = z
    .object({
      spaceName: z.string().trim().min(1).max(80), userName: short, userRole: short, learning: z.boolean(), model: z.string().max(150),
      // planPauseAt: long work waits from this share of the AI plan's window on (admission.mjs; unset = 95, null = never).
      limits: z.object({ monthlyTokens: z.number().int().min(1000).max(1e12).nullable(), pauseAtLimit: z.boolean(), warnAt80: z.boolean(), planPauseAt: z.number().int().min(50).max(99).nullable() }).partial().strict(),
      fallback: z.enum(["local", "none"]), onboarded: z.boolean(), holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60),
      // Your order of the rooms in the sidebar (drag to reorder); new rooms go on top.
      roomOrder: z.array(z.string().min(1).max(200)).max(500),
      suggestions: z.boolean(),
      narration: z.boolean(),
      recaps: z.boolean(),
      autoReview: z.boolean(),
      // Tools on demand (server/tool-search.mjs): false lists every tool on every call, as before.
      toolSearch: z.boolean(),
      // «Elegir solo quién responde en las salas» (server/router.mjs): false sends every message
      // that names nobody to Atlas, as before.
      routing: z.boolean(),
      // Ajustes › Autonomía: minutes a bot waits for your answer before going on (0 = no limit),
      // and «Sin supervisión»: routines and triggers never wait for red lines (they stay for later).
      questionWaitMinutes: z.number().int().min(0).max(1440),
      unattended: z.boolean(),
      // Windows notices: none from 19:00 to 9:00 and at weekends; which kinds pop at all.
      quietHours: z.boolean(),
      notifyLevel: z.enum(["todo", "importante", "tuyo"]),
      // How a notice reaches you: Windows notice and sound, only one of them, or nothing.
      notifyMode: z.enum(["both", "windows", "sound", "off"]),
      // Colmena 3 sidebar: «Modo experto», the sidebar folded to a rail (Ctrl B) and what you pinned (app addresses).
      expert: z.boolean(),
      sidebarFolded: z.boolean(),
      pinned: z.array(z.string().trim().regex(/^\/[^\s]*$/).max(300)).max(30),
    })
    .partial()
    .strict();
  app.patch("/api/settings", async (req, res) => {
    const data = check(settingsPatch, req.body);
    if (data.model && !(await listModels()).some((m) => m.slug === data.model)) throw Error("Modelo no disponible en la cuenta.");
    const next = store.patch("settings", "main", (old) => ({ ...data, ...(data.limits ? { limits: { ...old.limits, ...data.limits } } : {}) }));
    const { id: _id, ...visible } = next;
    res.json(visible);
  });
  app.post("/api/control", async (req, res) => {
    const { action } = check(z.object({ action: z.enum(["pause-all", "resume-all"]) }).strict(), req.body);
    const pause = action === "pause-all";
    store.patch("settings", "main", { paused: pause });
    const fn = pause ? runtime?.pauseAll : runtime?.resumeAll;
    if (typeof fn === "function") await fn.call(runtime);
    else if (pause) {
      for (const m of store.list("missions").filter((m) => ["queued", "planning", "running"].includes(m.status))) {
        safe(() => runtime.stop(m.id, false));
        store.patch("missions", m.id, { pausedByAll: true });
      }
    } else {
      for (const m of store.list("missions").filter((m) => m.pausedByAll && m.status === "paused")) {
        store.patch("missions", m.id, { pausedByAll: false });
        safe(() => runtime.launch(m.id));
      }
    }
    res.json({ paused: pause });
  });
  app.post("/api/onboarding", (req, res) => {
    const { role, ...rest } = check(z.object({
      role: z.enum(Object.keys(ROLES)),
      // From the onboarding chat with Atlas (all optional).
      team: z.array(short).max(8).optional(), userName: z.string().trim().min(1).max(80).optional(), apps: z.array(z.enum(DAILY_APPS)).max(10).optional(),
    }).strict(), req.body);
    res.json(applyOnboarding(store, role, rest));
  });
}
