import { DENY_REASON_MAX } from "../denial.mjs";
import { z } from "zod";
import { now } from "../store.mjs";
import { context, approvalView } from "../state.mjs";
import { HttpError, short, check } from "./shared.mjs";

/** Approvals: what the person reviews and decides. */
export function registerApprovalRoutes(app, { store, runtime, mustGet, connection, need, emailEdit }) {
  // -------------------------------------------------------- approvals
  // Decisions are bound to the exact content the person reviewed (revision = SHA-256 of it).
  const CHANGED = "El contenido ha cambiado; revísalo de nuevo.";
  const EXPIRED = "Han pasado más de 30 minutos desde que se preparó. Pide al bot que lo vuelva a preparar.";
  const revisionField = z.string().trim().min(1, "Falta la revisión de lo que has visto. Recarga y revísalo de nuevo.").max(100);
  const reviewed = (a, revision, { allowExpired = false } = {}) => {
    const view = approvalView(a, context(store, runtime));
    if (revision !== view.revision) throw Object.assign(new HttpError(409, CHANGED), { revision: view.revision });
    if (view.status === "expired" && !allowExpired) throw new HttpError(409, EXPIRED);
    return view;
  };
  app.post("/api/approvals/:id", async (req, res) => {
    const { decision, always, revision, reason } = check(z.object({ decision: z.enum(["approved", "denied"]), always: z.boolean().default(false), revision: revisionField, reason: z.string().trim().max(DENY_REASON_MAX).default("") }).strict(), req.body);
    const a = mustGet("approvals", req.params.id, "Aviso");
    reviewed(a, revision, { allowExpired: decision === "denied" });
    // The reason travels with the denial: the bot reads it on its next turn.
    if (decision === "denied" && reason) store.patch("approvals", a.id, { denyReason: reason });
    if (a.tool === "apps_execute") {
      // Outbound app actions are decided through the reviewed connections flow.
      const { revision } = await connection().review(a.id);
      await connection().decide(a.id, { decision, revision, remember: always });
      const prior = runtime.missionJobs?.get(a.missionId);
      void Promise.resolve(prior).then(() => runtime.launch(a.missionId));
    } else await need("approve")(req.params.id, decision, { always });
    res.json({ ok: true });
  });
  app.post("/api/approvals/:id/answer", async (req, res) => {
    const data = check(
      z.object({
        optionId: short.optional(), text: z.string().trim().min(1).max(4000).optional(), revision: revisionField,
        // Several questions answered by steps (questions.mjs): one entry per question.
        answers: z.array(z.object({ id: short, optionId: short.optional(), text: z.string().trim().max(4000).optional(), skipped: z.boolean().optional() }).strict()).min(1).max(5).optional(),
      }).strict().refine((d) => d.optionId || d.text || d.answers, { message: "Elige una opción o escribe una respuesta." }),
      req.body,
    );
    const { revision, ...answer } = data;
    reviewed(mustGet("approvals", req.params.id, "Pregunta"), revision);
    await need("answer")(req.params.id, answer);
    res.json({ ok: true });
  });
  // «Descartar» a question: no answer; the bot goes on with the most prudent option.
  app.post("/api/approvals/:id/dismiss", async (req, res) => {
    const { revision } = check(z.object({ revision: revisionField }).strict(), req.body);
    reviewed(mustGet("approvals", req.params.id, "Pregunta"), revision);
    need("dismissQuestion")(req.params.id);
    res.json({ ok: true });
  });
  // «Volver a preparar»: an expired send/permission is withdrawn and the bot is asked for a fresh one.
  app.post("/api/approvals/:id/renew", async (req, res) => {
    const { revision } = check(z.object({ revision: revisionField }).strict(), req.body);
    const a = mustGet("approvals", req.params.id, "Aviso");
    const view = reviewed(a, revision, { allowExpired: true });
    if (view.status !== "expired") throw new HttpError(409, "Todavía puedes decidirlo: no ha caducado.");
    if (!a.missionId) throw Error("Este aviso no viene de una misión; no hay a quién pedírselo.");
    if (a.tool === "apps_execute") {
      const { revision: connectionRevision } = await connection().review(a.id);
      await connection().decide(a.id, { decision: "denied", revision: connectionRevision, remember: false });
    } else await need("approve")(a.id, "denied", { always: false });
    store.patch("approvals", a.id, { resolution: "Caducó · se pidió de nuevo", expiredAt: now() });
    const prior = runtime.missionJobs?.get?.(a.missionId);
    await Promise.resolve(prior);
    const message = await need("addMessage")(a.missionId,
      "Vuelve a preparar «" + view.title + "»: la revisión anterior caducó sin hacerse (pasaron más de 30 minutos). Prepárala otra vez con los datos actuales para que la revise.", []);
    res.json({ ok: true, messageId: message?.id ?? null });
  });
  app.patch("/api/approvals/:id/email", async (req, res) => {
    const { attachments, revision, ...data } = check(emailEdit.extend({ revision: revisionField.optional(), attachments: z.array(z.object({ name: z.string().max(255), size: z.number().int().min(0).nullable().optional() }).strict()).max(20).optional() }).strict(), req.body);
    const a = mustGet("approvals", req.params.id, "Envío");
    const view = revision ? reviewed(a, revision, { allowExpired: true }) : approvalView(a, context(store, runtime));
    if (view.kind !== "send") throw Error("Solo puedes editar un envío.");
    if (!["pending", "denied"].includes(a.status)) throw Error("Este envío ya está resuelto.");
    if (a.tool === "apps_execute") {
      const { revision } = await connection().review(a.id);
      await connection().edit(a.id, { revision, ...data });
    }
    const updated = store.patch("approvals", a.id, (old) => ({ email: { ...(old.email || view.email || {}), ...data, ...(attachments ? { attachments: (old.email?.attachments || view.email?.attachments || []).filter((f) => attachments.some((k) => k.name === f.name)) } : {}) }, edited: true, status: "pending", decidedAt: null, editedAt: now() }));
    res.json(approvalView(updated, context(store, runtime)));
  });
}
