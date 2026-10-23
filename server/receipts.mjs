// One receipt per tool call, and the intent before every effect (T3 Code's EventSink and
// CommandReceiptStore): no action runs twice.
//
//   running   → the effect was about to start (intent): written in one transaction, with the
//               call's arguments hash, before anything leaves this process or touches a file;
//   waiting   → it waits for an OK (its approval record decides what happens next);
//   done      → it finished; `result` is what the bot reads, and the call is never run again;
//   uncertain → Colmena closed while it was «running»: nobody knows whether it happened, so it
//               is never repeated on its own; the bot is told to check, and its approval (if
//               any) is closed as «sin confirmar» in the same transaction.
//
// Reads are not effects: a read cut by a close simply runs again. Composio's own
// two-phase commit (connections.mjs: approval «executing» → «sin confirmar») stays as it was;
// the receipt adds the same rule for every other effect (files, deliverables, memory,
// commands, the browser and the desktop, MCP, API calls).
import { createHash } from "node:crypto";
import { now } from "./store.mjs";

export const RECEIPT = Object.freeze({ running: "running", waiting: "waiting", done: "done", uncertain: "uncertain" });
export const UNCERTAIN_ERROR = "Colmena se cerró mientras se hacía esto. No se repetirá solo: comprueba si llegó a hacerse antes de volver a pedirlo.";

// Calls that only look (or only ask): re-running them after a close is harmless.
const NOT_EFFECTS = new Set([
  "read_file", "read_folder_file", "web_fetch", "search_history", "read_thread", "pdf_fields", "read_deliverable", "mission_brief",
  "list_files", "list_folder", "list_skills", "read_skill", "recall", "react", "ask_user", "ask_bot", "request_secret",
  "apps_accounts", "apps_search", "apps_describe", "apps_table", "mcp_tools",
  "browser_read", "browser_screenshot", "desktop_look", "desktop_windows", "project_files",
]);
// Direct app tools that only read (apptools.mjs): fetch, list, get, search…
const DIRECT_READ = /^(gmail|googlecalendar|googlesheets|googledrive|googledocs|notion|slack|outlook)_\w*(fetch|list|get|find|search|download|batch_get|info|history)\w*$/;
const CHANGES = /(create|update|send|reply|delete|draft|insert|move|trash|remove|add|patch|modify|forward)/;
// Effects that only write Colmena's own records under the call's id (an artifact, a file of the
// mission, a memory keyed by it): stopped by you before finishing, they may simply run again.
export const KEYED_EFFECTS = new Set(["write_file", "create_deliverable", "create_presentation", "create_document", "create_spreadsheet", "fill_pdf", "remember", "create_image"]);

/** Whether a tool call changes something (anything not known to only read). */
export const isEffect = (name) => !NOT_EFFECTS.has(name) && !(DIRECT_READ.test(name) && !CHANGES.test(name));

const hash = (text) => createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 24);

/**
 * The intent, before the effect: {receipt, fresh}. `fresh` false means the call already has a
 * receipt that is not «waiting» (done, uncertain, or running in this very process) and must
 * not start again. In one transaction with the step's own record of it (`inflight`).
 */
export function beginEffect(store, { id, tool, missionId = null, stepId = null, args = "" }) {
  return store.tx(() => {
    const old = store.get("receipts", id);
    if (old && old.status && old.status !== RECEIPT.waiting) return { receipt: old, fresh: false };
    const at = now();
    const receipt = store.put("receipts", {
      ...(old || {}), id, tool, missionId, stepId, status: RECEIPT.running, intent: { args: hash(args), at }, attempts: (old?.attempts || 0) + 1, at,
    });
    if (stepId && store.get("steps", stepId)) store.patch("steps", stepId, (s) => ({ inflight: [...new Set([...(s.inflight || []), id])] }));
    return { receipt, fresh: true };
  });
}

/** The outcome: «waiting» (an OK is pending) or «done» with its result; the step's mark goes in the same transaction. */
export function finishEffect(store, id, result, { ms = null, stored = result } = {}) {
  return store.tx(() => {
    const old = store.get("receipts", id) || { id };
    const waiting = !!result?.waiting;
    const receipt = store.put("receipts", {
      ...old, status: waiting ? RECEIPT.waiting : RECEIPT.done, ...(waiting ? {} : { result: stored, ms, doneAt: now() }), at: now(),
    });
    if (old.stepId && store.get("steps", old.stepId)) store.patch("steps", old.stepId, (s) => ({ inflight: (s.inflight || []).filter((x) => x !== id) }));
    return receipt;
  });
}

/** Stopped by you mid-way: a keyed internal effect may run again on resume; any other is «sin confirmar». */
export function abandonEffect(store, id) {
  const receipt = store.get("receipts", id);
  if (!receipt || receipt.status !== RECEIPT.running) return receipt;
  if (KEYED_EFFECTS.has(receipt.tool))
    return store.tx(() => {
      store.remove("receipts", id);
      if (receipt.stepId && store.get("steps", receipt.stepId)) store.patch("steps", receipt.stepId, (s) => ({ inflight: (s.inflight || []).filter((x) => x !== id) }));
      return null;
    });
  return markUncertain(store, receipt, "Se paró mientras se hacía esto. No se repetirá solo: comprueba si llegó a hacerse antes de volver a pedirlo.");
}

function markUncertain(store, receipt, error = UNCERTAIN_ERROR) {
  return store.tx(() => {
    const result = { ok: false, uncertain: true, error };
    const next = store.put("receipts", { ...receipt, status: RECEIPT.uncertain, result, at: now() });
    // Its approval (same id: step:call) was approved and never got a result.
    const approval = store.get("approvals", receipt.id);
    if (approval && ["approved", "executing"].includes(approval.status)) store.patch("approvals", approval.id, { status: "executed", result });
    if (receipt.stepId && store.get("steps", receipt.stepId)) store.patch("steps", receipt.stepId, (s) => ({ inflight: (s.inflight || []).filter((x) => x !== receipt.id) }));
    return next;
  });
}

/**
 * At start, before anything resumes: every effect left «running» by a close becomes «sin
 * confirmar» and is never repeated. Returns the receipts it changed.
 */
export function recoverEffects(store) {
  const left = store.where("receipts", "status", RECEIPT.running);
  return left.map((r) => {
    // A deliverable or file of the mission is saved under the call's id: if it is there, it
    // happened (the close came between saving it and writing the receipt).
    const artifact = KEYED_EFFECTS.has(r.tool) && r.tool !== "remember" ? store.get("artifacts", r.id) : null;
    if (!artifact) return markUncertain(store, r);
    return store.tx(() => {
      const result = { saved: true, recovered: true, artifactId: artifact.id, title: artifact.title, version: artifact.version || 1, note: "Se guardó justo antes de que Colmena se cerrara." };
      const approval = store.get("approvals", r.id);
      if (approval && ["approved", "executing"].includes(approval.status)) store.patch("approvals", approval.id, { status: "executed", result });
      if (r.stepId && store.get("steps", r.stepId)) store.patch("steps", r.stepId, (s) => ({ inflight: (s.inflight || []).filter((x) => x !== r.id) }));
      return store.put("receipts", { ...r, status: RECEIPT.done, result, at: now() });
    });
  });
}
