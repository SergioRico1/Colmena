import { describeAppAction } from "./appactions.mjs";

// Which pending approvals may be decided together («Aprobar todas»). Several requests of the
// same kind in a row (five files, three calendar events) fold into one card; the person still
// sees every one of them. A short list on purpose — when in doubt, a request is decided alone:
//   - never a red line (it sends, buys, publishes, pays, deletes or leaves your account), nor
//     a send, a question, a plan, a key, a skill, a personality change or a revert;
//   - never what a routine left for later, a send about to leave on its own, a computer or
//     project action, nor anything proposed after reading content with injection phrases;
//   - only the internal writes of server/runtime/effects.mjs and the non-red-line actions in
//     a connected app (server/connections.mjs `classify`).

// What each internal write is, in the plural, after «3 peticiones de Nora: ».
const LOCAL = {
  write_file: "crear archivos",
  create_deliverable: "guardar entregables en la Biblioteca",
  create_presentation: "crear presentaciones",
  create_document: "crear documentos",
  create_spreadsheet: "crear hojas de cálculo",
  create_image: "crear imágenes",
  fill_pdf: "rellenar documentos PDF",
  remember: "cambiar la memoria",
};
const ALONE = new Set(["send", "question", "plan", "secret", "skill", "soul", "revert"]);

/** Up to how many requests one «Aprobar todas» takes. */
export const BATCH_MAX = 20;

/**
 * {key, label} when this stored approval may be decided with others of the same key (same
 * mission, bot and tool; for a connected app, the same action in the same app), else null.
 * `flagged`: its step read content with injection phrases (external-content.mjs isFlagged).
 */
export function approvalGroup(a, { flagged = false } = {}) {
  if (!a || a.status !== "pending" || !a.missionId || !a.botId || !a.tool) return null;
  if (a.redLine || a.external || a.deferred || a.autoSendAt || a.computer || a.project || a.secret || a.email || flagged) return null;
  if (ALONE.has(a.kind) || ALONE.has(a.uiKind)) return null;
  if (a.tool === "apps_execute") {
    const toolkit = String(a.review?.toolkit || "").toLowerCase();
    const action = String(a.review?.tool || "").toUpperCase();
    if (!toolkit || !action || !["write", "read"].includes(a.kind)) return null;
    const said = describeAppAction(a).title;
    return { key: JSON.stringify([a.missionId, a.botId, a.tool, toolkit, action]), label: said.charAt(0).toLowerCase() + said.slice(1) };
  }
  if (!Object.hasOwn(LOCAL, a.tool) || !["write", "memory"].includes(a.kind)) return null;
  return { key: JSON.stringify([a.missionId, a.botId, a.tool]), label: LOCAL[a.tool] };
}
