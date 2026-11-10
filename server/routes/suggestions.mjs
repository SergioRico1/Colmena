import { z } from "zod";
import { id, now } from "../store.mjs";
import { automationView } from "../state.mjs";
import { acceptGoalSuggestion } from "../goals.mjs";
import { HttpError, automationCreate, check, pick, safe } from "./shared.mjs";

/** Suggestions the team makes to the person. */
export function registerSuggestionRoutes(app, { mustGet, store, need, runtime, createAutomation }) {
  // ------------------------------------------------------ suggestions
  app.post("/api/suggestions/:id", (req, res) => {
    const { decision } = check(z.object({ decision: z.enum(["accept", "dismiss"]) }).strict(), req.body);
    const s = mustGet("suggestions", req.params.id, "Sugerencia");
    if (s.status && !["active", "pending"].includes(s.status)) throw new HttpError(409, "Esta sugerencia ya está resuelta.");
    // A goal proposed by a bot becomes a goal only when you accept it.
    if (decision === "accept" && s.kind === "goal") return res.json({ ok: true, goal: acceptGoalSuggestion(store, s) });
    // An idea with evidence (mail, calendar) becomes a mission when you accept it; nothing is sent.
    if (decision === "accept" && s.kind === "idea") {
      const prompt = String(s.payload?.prompt || "").trim();
      if (!prompt) throw Error("Esta idea no tiene un encargo que preparar.");
      const botId = store.get("bots", s.botId)?.enabled ? s.botId : "atlas";
      const mission = need("create")({ prompt, mode: "solo", botIds: [botId], safety: "preguntar", attachments: [] });
      store.patch("suggestions", s.id, { status: "accepted", decidedAt: now(), payload: { ...(s.payload || {}), missionId: mission.id } });
      safe(() => runtime.launch(mission.id));
      return res.json({ ok: true, missionId: mission.id });
    }
    const result = store.tx(() => {
      let created = {};
      if (decision === "accept" && s.kind === "automation") {
        const payload = check(automationCreate, pick(s.payload || {}, ["name", "botId", "prompt", "enabled", "trigger", "notify", "needs"]));
        created = { automation: automationView(createAutomation(payload)) };
      } else if (decision === "accept" && s.kind === "always-approve") {
        const p = s.payload || {};
        created = { grant: store.put("grants", { ...pick(p, ["tool", "kind", "scope", "missionId", "target", "account"]), id: id(), botId: p.botId ?? s.botId ?? null, active: true, origin: "suggestion", suggestionId: s.id, createdAt: now() }) };
      } else if (decision === "accept") throw Error("No sé aplicar este tipo de sugerencia.");
      store.patch("suggestions", s.id, { status: decision === "accept" ? "accepted" : "dismissed", decidedAt: now() });
      return { ok: true, ...created };
    });
    res.json(result);
  });
}
