// Gmail drafts and replies the way a person handles them: a draft keeps its thread when it is
// changed, «envíalo» sends that very draft, and a reply goes inside its conversation. The bot
// is told what it already left in Gmail in this chat, so it never has to go looking for it.

const flat = (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(/[,;]/) : []).map((x) => String(x).trim()).filter(Boolean);

/** The first value under one of these keys, anywhere in a Composio result. */
function find(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return undefined;
  for (const k of keys) if (value[k] !== undefined && value[k] !== null && value[k] !== "") return value[k];
  for (const v of Object.values(value)) {
    const hit = find(v, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** A draft's HTML body as the plain text a person wrote, without the quoted thread. */
export function draftText(html = "") {
  let s = String(html);
  const quote = s.search(/<div class=\\?"gmail_quote|<blockquote|\n\s*El .{5,80} escribió:|\n\s*On .{5,80} wrote:/i);
  if (quote >= 0) s = s.slice(0, quote);
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}

/** {to, cc, subject, body, threadId, messageId} of a GMAIL_GET_DRAFT result (also a cut preview). */
export function draftFields(data) {
  let o = data;
  const cut = typeof data?.preview === "string" ? data.preview : null;
  if (cut) { try { o = JSON.parse(cut); } catch { o = null; } }
  const fromCut = (k) => {
    if (!cut) return undefined;
    const m = cut.match(new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    if (!m) return undefined;
    try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; }
  };
  const get = (keys) => (o ? find(o, keys) : undefined) ?? keys.map(fromCut).find((v) => v !== undefined);
  const to = flat(get(["to", "recipient_email"]));
  if (!to.length && !get(["threadId", "messageId"])) return null;
  return {
    to,
    cc: flat(get(["cc"])),
    subject: String(get(["subject"]) ?? ""),
    body: draftText(get(["messageText", "body"]) ?? ""),
    threadId: String(get(["threadId", "thread_id"]) ?? ""),
    messageId: String(get(["messageId"]) ?? ""),
  };
}

const json = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };
const accountId = (a) => String(a.args?.account || a.review?.account || "").split(" · ").pop();
const alias = (a) => a.review?.account_alias || "";

/**
 * What the bot left in Gmail in this chat (its drafts, what it sent), as context for the next
 * turn: «envíalo» then means GMAIL_SEND_DRAFT with that draft_id, not a search.
 */
export function appWorkNote(approvals = []) {
  const drafts = new Map();
  const sent = [];
  const done = approvals.filter((a) => a.tool === "apps_execute" && a.status === "executed" && a.result?.ok)
    .sort((a, b) => String(a.updatedAt || a.createdAt).localeCompare(String(b.updatedAt || b.createdAt)));
  for (const a of done) {
    const tool = String(a.review?.tool || a.args?.tool || "").toUpperCase();
    const args = a.review?.arguments || json(a.args?.arguments_json);
    const data = a.result?.data || {};
    if (tool === "GMAIL_CREATE_EMAIL_DRAFT" || tool === "GMAIL_UPDATE_DRAFT") {
      const id = String(data.id || args.draft_id || "");
      if (!id) continue;
      const old = drafts.get(id) || {};
      drafts.set(id, {
        id, account: accountId(a) || old.account, alias: alias(a) || old.alias,
        to: flat(args.recipient_email).length ? flat(args.recipient_email) : old.to || [],
        subject: args.subject || old.subject || "",
        thread: args.thread_id || old.thread || (data.message?.threadId && data.message.threadId !== data.message.id ? data.message.threadId : ""),
        changed: tool === "GMAIL_UPDATE_DRAFT" || old.changed,
      });
    } else if (tool === "GMAIL_SEND_DRAFT") {
      const d = drafts.get(String(args.draft_id || ""));
      if (d) d.sent = true;
      sent.push({ to: a.review?.draft?.to || d?.to || [], subject: a.review?.draft?.subject || d?.subject || "", thread: data.threadId || d?.thread || "" });
    } else if (tool === "GMAIL_SEND_EMAIL" || tool === "GMAIL_REPLY_TO_THREAD") {
      sent.push({ to: [...flat(args.recipient_email), ...flat(args.extra_recipients)], subject: args.subject || "", thread: args.thread_id || data.threadId || "", reply: tool === "GMAIL_REPLY_TO_THREAD" });
    }
  }
  const open = [...drafts.values()].filter((d) => !d.sent).slice(-5);
  if (!open.length && !sent.length) return "";
  const lines = ["Lo que ya has dejado en Gmail en esta conversación (datos de la app; no hace falta buscarlo):"];
  for (const d of open) {
    lines.push(`- Borrador sin enviar: draft_id ${d.id}, cuenta ${d.account}${d.alias ? ` (${d.alias})` : ""}` +
      (d.to.length ? `, para ${d.to.join(", ")}` : "") + (d.subject ? `, asunto «${d.subject}»` : "") +
      (d.thread ? `, en el hilo thread_id ${d.thread}` : "") + (d.changed ? ", ya modificado" : "") + ".");
  }
  for (const s of sent.slice(-3)) lines.push(`- Enviado${s.reply ? " como respuesta en su hilo" : ""}: ${s.to.join(", ") || "destinatario"}${s.subject ? `, «${s.subject}»` : ""}.`);
  if (open.length) lines.push("Si te piden enviarlo, envía ese borrador con GMAIL_SEND_DRAFT y su draft_id (sale tal cual, en su hilo). Si te piden cambiarlo, GMAIL_UPDATE_DRAFT con su draft_id, el texto completo y el thread_id del hilo.");
  return lines.join("\n");
}
