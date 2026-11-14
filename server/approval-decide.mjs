// One decision on one approval, the same wherever it comes from: the card you click (routes/
// approvals.mjs, after checking it is what you saw) or a person of your team you asked to
// decide a routine's red lines (peers/delegation.mjs). An app action goes through the reviewed
// connections flow (review, then decide); anything else through the runtime, which sends a red
// line left for later by an unattended routine to approveDeferred.

/**
 * `deps`: {store, runtime, connection, approve?}. `decidedBy`: who decided it, as the record
 * says it («tú», a person's name); null keeps each path's own default.
 */
export async function decideApproval({ store, runtime, connection, approve = null }, a, { decision, always = false, reason = "", decidedBy = null } = {}) {
  // The reason travels with the denial: the bot reads it on its next turn.
  if (decision === "denied" && reason) store.patch("approvals", a.id, { denyReason: reason });
  if (a.tool === "apps_execute") {
    const conn = connection();
    const { revision } = await conn.review(a.id);
    await conn.decide(a.id, { decision, revision, remember: always, ...(decidedBy ? { by: decidedBy } : {}) });
    const prior = runtime?.missionJobs?.get?.(a.missionId);
    void Promise.resolve(prior).then(() => runtime?.launch?.(a.missionId)).catch(() => {});
  } else {
    const run = approve || ((...args) => runtime.approve(...args));
    await run(a.id, decision, { always, ...(decidedBy ? { decidedBy } : {}) });
  }
  // Someone else decided it: the record says who, in words.
  if (decidedBy && decidedBy !== "tú") {
    const fresh = store.get("approvals", a.id);
    if (fresh) store.patch("approvals", a.id, { decidedBy, resolution: (decision === "approved" ? "Lo aprobó " : "Lo denegó ") + decidedBy + (fresh.resolution && !/^(Aprobado|Denegado)$/.test(fresh.resolution) ? " · " + fresh.resolution : "") });
  }
}
