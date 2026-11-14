import { z } from "zod";
import { HttpError, check } from "./shared.mjs";
import { isFlagged } from "../external-content.mjs";
import { PREAPPROVE_USES, candidatesFor, eligibility, entryFrom, entryView, stepOf, withEntry } from "../preapprovals.mjs";

/**
 * A routine's red lines (docs/CONNECTIONS.md «Aprobado por adelantado», docs/PEOPLE.md
 * «Delegar aprobaciones»): what it may do at its time with nobody there, and who of your team
 * decides the rest besides you.
 */
export function registerPreapprovalRoutes(app, { store, mustGet }) {
  const people = () => store.list("peerContacts").filter((c) => c.status === "active").map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const view = (rule) => {
    const contact = rule.approver?.contactId ? store.get("peerContacts", rule.approver.contactId) : null;
    return {
      entries: (rule.preapprovals || []).map(entryView),
      candidates: candidatesFor(store, rule, { flagged: (stepId) => isFlagged(store, stepId) }),
      approver: rule.approver?.contactId ? { contactId: rule.approver.contactId, name: contact?.name || "Una persona", active: contact?.status === "active" } : null,
      people: people(),
    };
  };
  app.get("/api/automations/:id/preapprovals", (req, res) => res.json(view(mustGet("automations", req.params.id, "Automatización"))));
  // «Añadir»: only something this routine asked for in one of its runs.
  app.post("/api/automations/:id/preapprovals", (req, res) => {
    const { approvalId, uses } = check(z.object({ approvalId: z.string().trim().min(1).max(300), uses: z.enum(PREAPPROVE_USES) }).strict(), req.body);
    const rule = mustGet("automations", req.params.id, "Automatización");
    const a = store.get("approvals", approvalId);
    const mission = a?.missionId ? store.get("missions", a.missionId) : null;
    if (!a || mission?.automationId !== rule.id) throw new HttpError(404, "Esta rutina no ha pedido eso nunca.");
    const e = eligibility(a, { mission, flagged: isFlagged(store, stepOf(a)) });
    if (!e.ok) throw new HttpError(400, e.reason);
    const entry = entryFrom(a, { uses });
    const updated = store.patch("automations", rule.id, (old) => ({ preapprovals: withEntry(old.preapprovals, entry) }));
    res.status(201).json(view(updated));
  });
  app.delete("/api/automations/:id/preapprovals/:entryId", (req, res) => {
    const rule = mustGet("automations", req.params.id, "Automatización");
    if (!(rule.preapprovals || []).some((x) => x.id === req.params.entryId)) throw new HttpError(404, "Eso ya no estaba aprobado.");
    const updated = store.patch("automations", rule.id, (old) => ({ preapprovals: (old.preapprovals || []).filter((x) => x.id !== req.params.entryId) }));
    res.json(view(updated));
  });
  // «Quién decide sus líneas rojas»: you, or also a person you talk to (you can always decide too).
  app.put("/api/automations/:id/approver", (req, res) => {
    const { contactId } = check(z.object({ contactId: z.string().trim().min(1).max(200).nullable() }).strict(), req.body);
    const rule = mustGet("automations", req.params.id, "Automatización");
    if (contactId && store.get("peerContacts", contactId)?.status !== "active") throw new HttpError(400, "Solo puedes elegir a alguien con quien ya hablas en Colmena.");
    const updated = store.patch("automations", rule.id, { approver: contactId ? { contactId } : null });
    res.json(view(updated));
  });
}
