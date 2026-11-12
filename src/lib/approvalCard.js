// One approval card model for every surface (Inicio, the chat, a room, Revisar): the same
// verbs for the same request wherever it is shown. Pure: no React, no network. Each surface
// draws it in its own density (components/ApprovalParts.jsx has the shared pieces).
//
// The verbs:
//   - an ordinary request (a permission, a file, a memory…): «Aprobar» · «Siempre en <app>» /
//     «Siempre a <bot>» where the server allows it (`canAlways`) · «Revisar» · «No permitir».
//     A denial is final for that request (the bot is told not to repeat it), so it is not
//     called «Ahora no»: putting it off is «Recordar después» (lib/snooze.js).
//   - a red line (it sends, pays, publishes, deletes…): the button says what it does and that
//     it must be held, «Mantén para enviar», and its refusal says what will not happen, «No
//     enviar». With «reduce motion» the hold is two steps, so the button reads «Enviar» and
//     then «Confirmar» (components/HoldButton.jsx).
//   - a plan and a key are decided where they are read: «Revisar el plan», «Revisar».
import { needsHold } from "./holdApprove.js";

/** The undo window an approval gets where the surface schedules it (lib/undoable.js UNDO_MS). */
export const UNDO_SECONDS = 10;
/** How much of a send's text a card shows before it says the rest is in Revisar. */
export const EXCERPT = 220;
/** Recipients a card names before «y 2 más». */
export const RECIPIENTS_SHOWN = 3;

// verb → [infinitive, what does not happen at expiry, its refusal, what the wait says, when done]
const VERBS = {
  enviar: ["enviar", "no se envía", "No enviar", "Se envía en", "Enviado"],
  pagar: ["pagar", "no se paga", "No pagar", "Se paga en", "Pagado"],
  devolver: ["devolver", "no se devuelve", "No devolver", "Se devuelve en", "Devuelto"],
  publicar: ["publicar", "no se publica", "No publicar", "Se publica en", "Publicado"],
  borrar: ["borrar", "no se borra", "No borrar", "Se borra en", "Borrado"],
  archivar: ["archivar", "no se archiva", "No archivar", "Se archiva en", "Archivado"],
  invitar: ["invitar", "no se invita a nadie", "No invitar", "Se invita en", "Invitación enviada"],
};

/**
 * What a red line does, in one verb, from what the server says it affects (`impact`,
 * server/impact.mjs): "enviar" | "pagar" | "devolver" | "publicar" | "borrar" | "archivar" |
 * "invitar"; null when it is no red line or the server does not say (a risky command…).
 */
export function redLineVerb(a) {
  if (!a) return null;
  if (a.kind === "send") return "enviar";
  if (!a.redLine) return null;
  const head = String(a.impact?.headline || "");
  switch (a.impact?.tone) {
    case "money": return head.startsWith("Devolver") ? "devolver" : "pagar";
    case "public": case "private": return "publicar";
    case "delete": return head.startsWith("Archivar") ? "archivar" : "borrar";
    case "external": case "internal": return head.startsWith("Invitar") ? "invitar" : "enviar";
    default: return null;
  }
}

/** «45 s», «11 min», «2 h»: how long is left, rounded up. */
export function leftText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.ceil(s / 60);
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
}

const stamp = (iso) => { const t = Date.parse(iso || ""); return Number.isNaN(t) ? null : t; };

/**
 * What happens if nobody decides in time, in words: {text, urgent, deadline} or null when the
 * request waits as long as it takes. It states what the server does:
 *   - a send you asked for yourself leaves on its own at `autoSendAt` (server/connections.mjs);
 *   - a send or any action that leaves the computer can be approved for 30 minutes after it
 *     was prepared (server/state.mjs approvalExpiresAt). After that it cannot be approved and
 *     nothing is done; the bot does not prepare it again by itself, it has to be asked;
 *   - a key not given in time: the bot goes on without it (server/secrets.mjs);
 *   - a timed question: the bot goes on with the most prudent option and the question stays
 *     open for a late answer (server/runtime/approvals.mjs).
 */
export function expiryLine(a, { botName = "el bot", now = Date.now() } = {}) {
  if (!a || a.status !== "pending") return null;
  const who = botName || "el bot";
  const auto = stamp(a.autoSendAt);
  if (auto != null && auto > now) return { deadline: auto, urgent: false, text: `Lo pediste tú: se envía solo en ${leftText(auto - now)} si no lo cancelas.` };
  if (a.kind === "question") {
    const wait = stamp(a.waitUntil);
    if (wait == null || a.stillOpen) return null;
    if (wait <= now) return { deadline: wait, urgent: false, text: `${who} ha seguido con la opción más prudente. Aún puedes responder.` };
    return { deadline: wait, urgent: wait - now < 120e3, text: `Si no respondes en ${leftText(wait - now)}, ${who} sigue con la opción más prudente. Podrás responder después.` };
  }
  const end = stamp(a.expiresAt);
  if (end == null) return null;
  if (a.kind === "secret") {
    return end <= now
      ? { deadline: end, urgent: true, text: `Ya no espera la clave: ${who} ha seguido sin ella.` }
      : { deadline: end, urgent: end - now < 120e3, text: `Si no respondes en ${leftText(end - now)}, ${who} sigue sin la clave.` };
  }
  const verb = redLineVerb(a);
  const undone = verb ? VERBS[verb][1] : "no se hace";
  if (end <= now) return { deadline: end, urgent: true, text: `Ha caducado y ${undone}. Pídele a ${who} que lo prepare otra vez.` };
  return { deadline: end, urgent: end - now < 120e3, text: `Si no decides en ${leftText(end - now)}, caduca y ${undone}. Después tendrás que pedirle a ${who} que lo prepare otra vez.` };
}

/** What a send carries, cut to what a card shows; `truncated` says something was left out. */
export function sendWhat(email, { excerpt = EXCERPT, recipients = RECIPIENTS_SHOWN } = {}) {
  if (!email) return null;
  const to = (email.to || []).map(String).filter(Boolean);
  const copies = [...(email.cc || []), ...(email.cco || [])].length;
  const body = String(email.body || "").replace(/\s+/g, " ").trim();
  const cut = body.length > excerpt;
  // Never «y 1 más»: one more name is shown instead.
  const shown = to.length <= recipients + 1 ? to : to.slice(0, recipients);
  const attachments = (email.attachments || []).map((f) => String(f?.name || f)).filter(Boolean);
  return {
    to: shown, moreTo: to.length - shown.length, copies,
    subject: String(email.subject || "").trim(),
    excerpt: cut ? body.slice(0, excerpt).replace(/\s+\S*$/, "") + "…" : body,
    attachments,
    truncated: cut || to.length > shown.length,
  };
}

/**
 * The card of one pending approval:
 *   { kind, verb, hold, title, send, text, impact,
 *     primary: {label, plain, hold, action: "approve" | "open", href} | null,
 *     secondary: [{id: "always" | "review" | "deny", label, href?}],
 *     waitText, doneText, denyToast, undoLine, expiryLine, truncatedLine }
 * `undo`: whether this surface gives the 10 s window when you approve (it then says so).
 * Questions are answered with their own options: they only get `title` and `expiryLine`.
 */
export function approvalCard(a, { botName = "", now = Date.now(), undo = true, excerpt = EXCERPT } = {}) {
  if (!a) return null;
  const kind = a.kind || "permission";
  const who = botName || "El bot";
  const isSend = kind === "send";
  const send = isSend ? sendWhat(a.email, { excerpt }) : null;
  const verb = redLineVerb(a);
  const hold = needsHold(a);
  const words = verb ? VERBS[verb] : null;
  const review = `/revisar/${encodeURIComponent(a.id)}`;
  const title = isSend && send?.subject ? `Enviar «${send.subject}»` : kind === "question" && a.questions?.length > 1 ? `${who} tiene ${a.questions.length} preguntas` : a.title || "Necesita tu OK";
  const text = !isSend && a.summary && a.summary !== a.title ? a.summary : "";
  const expiry = expiryLine(a, { botName: botName || "el bot", now });
  const base = { kind, verb, hold, title, send, text, impact: (a.redLine || isSend) && a.impact?.headline ? a.impact.headline : null, expiryLine: expiry, truncatedLine: send?.truncated ? "Aquí va recortado: ábrelo en «Revisar» para leerlo entero." : null };

  if (kind === "question") return { ...base, primary: null, secondary: [], waitText: "Se decide en", doneText: "Decidido", denyToast: "", undoLine: null };
  if (kind === "plan") {
    return { ...base, primary: { label: "Revisar el plan", plain: "Revisar el plan", hold: false, action: "open", href: a.missionId ? `/sala/${a.missionId}#plan` : review }, secondary: [], waitText: "", doneText: "", denyToast: "", undoLine: null };
  }
  if (kind === "secret") {
    return { ...base, primary: { label: "Revisar", plain: "Revisar", hold: false, action: "open", href: review }, secondary: [], waitText: "", doneText: "", denyToast: "", undoLine: null };
  }
  const plain = words ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : "Aprobar";
  const primary = { label: hold ? `Mantén para ${words ? words[0] : "aprobar"}` : "Aprobar", plain, hold, action: "approve" };
  const secondary = [];
  // «Siempre» is the server's to offer, and never for what leaves the computer.
  if (a.canAlways && !hold && !a.redLine) secondary.push({ id: "always", label: a.app ? `Siempre en ${a.app}` : botName ? `Siempre a ${botName}` : "Siempre" });
  secondary.push({ id: "review", label: "Revisar", href: review });
  secondary.push({ id: "deny", label: words ? words[2] : "No permitir" });
  return {
    ...base, primary, secondary,
    waitText: words ? words[3] : "Se aprueba en",
    doneText: words ? words[4] : "Aprobado",
    denyToast: words ? words[1].charAt(0).toUpperCase() + words[1].slice(1) : "No se permite",
    undoLine: undo ? `Tendrás ${UNDO_SECONDS} segundos para deshacer.` : null,
  };
}

/** The buttons of several requests decided together (lib/approvalGroups.js): never a red line. */
export const GROUP_VERBS = { approve: "Aprobar todas", retry: "Reintentar todas", each: "Ver cada una", together: "Ver juntas", deny: "No permitir", undoLine: `Tendrás ${UNDO_SECONDS} segundos para deshacer.` };
