// The places «Te avisa de lo importante» (watch.mjs) looks at. Each source turns what is new
// there into the same short items, so one pipeline decides for all of them what matters:
//
//   { id, label, toolkits | local, collect(ctx, account, mem) → items, detail?(ctx, item) → text }
//
// An item is data for the model, never instructions: { id, fuente, cuenta, de, titulo, fecha,
// texto, ... } plus what only Colmena uses (url, account, hilo, slot). `mem` is the source's own
// memory for that account (since when it looked, a page size…), saved after the look.
// Reads go through Connections#readNow: only actions that look, and only what the bot may read.
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";

export const clip = (v, n) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
/** HTML as text (what the model needs is the words, not the markup). */
export const asText = (s) => {
  const raw = String(s || "");
  if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return raw.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
};
export const listOf = (data, ...keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((o, x) => o?.[x], data);
    if (Array.isArray(v)) return v;
  }
  return [];
};
export const addressOf = (s) => (String(s || "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [""])[0].toLowerCase();
/** «Oriol» of «Oriol Vidal <o@v.es>»; a company («No Reply <noreply@aquamar.es>») by its domain. */
export const nameOf = (s) => {
  const raw = String(s || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  const domain = (addressOf(s).split("@")[1] || "").split(".").slice(-2, -1)[0] || "";
  if (/^(no.?reply|notific|info\b|hello|hola|team|equipo|support|soporte|mailer|news|alert|aviso)/i.test(raw || addressOf(s)) && domain) return domain.replace(/^./, (c) => c.toUpperCase());
  const name = raw && !raw.includes("@") ? raw : addressOf(s).split("@")[0].replace(/[._-]+/g, " ");
  return name.split(/\s+/)[0]?.replace(/^./, (c) => c.toUpperCase()) || "alguien";
};
const MINUTE = 60000;
export const FIRST_LOOK_MS = 12 * 3600 * 1000; // the first time, the last 12 hours count as new
/** Since when this source looks (Date.parse(0) is the year 2000, so an empty value never reaches it). */
const sinceOf = (mem, time) => (mem.since && Date.parse(mem.since)) || time - FIRST_LOOK_MS;

// ---- Mail: Gmail ------------------------------------------------------------------------
/** Your address in that mailbox: the one most of its mail is sent to. */
export function ownAddress(messages) {
  const count = new Map();
  for (const m of messages) for (const a of String(m.to || "").split(",").map(addressOf).filter(Boolean)) count.set(a, (count.get(a) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
export function gmailUrl(m, address = null) {
  const id = encodeURIComponent(String(m.threadId || m.messageId || m.id || ""));
  return "https://mail.google.com/mail/u/" + (address ? "?authuser=" + encodeURIComponent(address) : "0/") + "#all/" + id;
}
/** What the model reads of one mail; `full` is its whole text once read. */
export function compactMail(m, account, full = null) {
  return {
    id: String(m.messageId || m.id || ""), hilo: String(m.threadId || ""), fuente: "Correo", cuenta: account.alias || "Gmail",
    de: clip(m.sender || m.from, 120), para: clip(m.to, 200), titulo: clip(m.subject || m.preview?.subject, 200),
    fecha: m.messageTimestamp || null, etiquetas: (m.labelIds || []).filter((l) => /^(IMPORTANT|STARRED|CATEGORY_UPDATES|CATEGORY_PERSONAL)$/.test(l)),
    adjuntos: (m.attachmentList || []).map((a) => clip(a.filename, 80)).slice(0, 5),
    texto: clip(asText(full || m.messageText || m.preview?.body || m.snippet), full ? 3000 : 400),
  };
}
// Mail is listed with `verbose: false` (subject, sender, a ~200-character snippet: ~1 KB each);
// the service cuts answers over 80 000 characters, so pages stay small, and a size that was
// too big is remembered (every failed read stays «sin confirmar» in Conexiones).
const PAGE = 20, PAGES = 3;
async function fetchMail(ctx, account, mem, query, pages = PAGES) {
  const out = [];
  let token = null;
  for (let page = 0; page < pages; page++) {
    let size = Math.min(PAGE, Math.max(2, Number(mem.pageSize) || PAGE)), data;
    for (;;) {
      try {
        data = await ctx.read("GMAIL_FETCH_EMAILS", account, { user_id: "me", query, max_results: size, verbose: false, include_payload: false, ...(token ? { page_token: token } : {}) });
        if (data?.truncated && !Array.isArray(data?.messages)) throw Error("Respuesta demasiado grande.");
        break;
      } catch (error) {
        if (!/demasiado grande/i.test(error?.message || "") || size <= 2) throw error;
        size = Math.ceil(size / 2.5);
        mem.pageSize = size;
      }
    }
    const list = listOf(data, "messages", "data.messages");
    out.push(...list);
    token = data?.nextPageToken || data?.next_page_token || data?.data?.nextPageToken || null;
    if (!token || list.length < size) break;
  }
  return out;
}
const gmail = {
  id: "gmail", label: "Correo", toolkits: ["gmail"],
  link: (s) => `Correo de ${nameOf(s.de)}`,
  async collect(ctx, account, mem) {
    const after = Math.floor((sinceOf(mem, ctx.time) - 10 * MINUTE) / 1000); // Gmail dates by second; mail can arrive late
    // Every tab, as Codex does (an invoice or a renewal may land in «Notificaciones» or
    // «Promociones»); what deserves a note is decided by importance, never by the tab.
    // Spam and trash never count.
    const messages = await fetchMail(ctx, account, mem, `in:inbox -in:spam -in:trash newer_than:2d after:${after}`);
    mem.address = mem.address || ownAddress(messages);
    const items = [];
    for (const m of messages) {
      const mail = compactMail(m, account);
      if (!mail.id || (m.labelIds || []).includes("SENT")) continue;
      const sent = Date.parse(m.messageTimestamp || "");
      if (sent && sent < after * 1000) continue; // the list is not always filtered by date
      if (mem.address && addressOf(mail.de) === mem.address) continue;
      items.push({ ...mail, url: gmailUrl(m, mem.address) });
    }
    if (items.length) {
      const sent = await fetchMail(ctx, account, mem, `in:sent after:${after}`, 1).catch(() => []);
      const answered = new Set(sent.map((m) => String(m.threadId || "")).filter(Boolean));
      for (const it of items) it.respondido = !!(it.hilo && answered.has(it.hilo));
    }
    return items;
  },
  async detail(ctx, item) {
    const data = await ctx.read("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", item.account, { user_id: "me", message_id: item.id });
    return data?.messageText || data?.data?.messageText || null;
  },
};

// ---- Mail: Outlook ----------------------------------------------------------------------
const outlook = {
  id: "outlook", label: "Correo de Outlook", toolkits: ["outlook", "microsoft_outlook"],
  link: (s) => `Correo de ${nameOf(s.de)}`,
  async collect(ctx, account, mem) {
    const from = sinceOf(mem, ctx.time) - 10 * MINUTE;
    const data = await ctx.read("OUTLOOK_OUTLOOK_LIST_MESSAGES", account, { user_id: "me", folder: "inbox", top: 20, orderby: "receivedDateTime desc", filter: `receivedDateTime ge ${new Date(from).toISOString()}` });
    return listOf(data, "value", "messages", "data.value").filter((m) => Date.parse(m.receivedDateTime || 0) >= from).map((m) => ({
      id: String(m.id || ""), hilo: String(m.conversationId || ""), fuente: "Correo", cuenta: account.alias || "Outlook",
      de: clip(m.from?.emailAddress ? `${m.from.emailAddress.name || ""} <${m.from.emailAddress.address || ""}>` : m.from, 120),
      titulo: clip(m.subject, 200), fecha: m.receivedDateTime || null, texto: clip(asText(m.bodyPreview || m.body?.content), 400), url: typeof m.webLink === "string" ? m.webLink : null,
    })).filter((x) => x.id);
  },
};

// ---- Calendar: invitations waiting for your answer, changes and cancellations ----------
const dayTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
};
const calendar = {
  id: "calendar", label: "Agenda", toolkits: ["googlecalendar"],
  link: (s) => `Evento «${clip(s.titulo, 40)}»`,
  async collect(ctx, account, mem) {
    const first = !mem.since;
    const from = sinceOf(mem, ctx.time) - 10 * MINUTE;
    const data = await ctx.read("GOOGLECALENDAR_EVENTS_LIST", account, {
      calendarId: "primary", timeMin: new Date(ctx.time).toISOString(), timeMax: new Date(ctx.time + 21 * 86400000).toISOString(),
      updatedMin: new Date(from).toISOString(), singleEvents: true, showDeleted: true, orderBy: "startTime", maxResults: 50,
    });
    const items = [];
    for (const e of listOf(data, "items", "events", "data.items")) {
      const start = e.start?.dateTime || e.start?.date, end = e.end?.dateTime || e.end?.date;
      if (!e.id || !start || Date.parse(e.updated || 0) < from) continue;
      if (e.organizer?.self && e.status !== "cancelled") continue; // what you changed yourself
      const me = (e.attendees || []).find((a) => a.self);
      const what = e.status === "cancelled" ? "cancelada" : me?.responseStatus === "needsAction" ? "invitacion" : "cambio";
      if (first && what !== "invitacion") continue; // the first look only brings what waits for you
      const who = e.organizer?.displayName || e.organizer?.email || "";
      const label = { invitacion: "Te invitan", cancelada: "Cancelada", cambio: "Ha cambiado" }[what];
      items.push({
        id: e.id + ":" + (e.updated || e.etag || ""), fuente: "Agenda", cuenta: account.alias || "Calendario", de: clip(who, 120), titulo: clip(e.summary || "Evento", 200),
        fecha: e.updated || null, que: what,
        texto: clip(`${label}: «${e.summary || "Evento"}», ${e.start?.dateTime ? dayTime(start) + "–" + new Date(end).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "todo el día " + start}` +
          `${e.location ? ", en " + e.location : ""}. ${(e.attendees || []).length ? (e.attendees.length - 1) + " personas más." : ""} ${asText(e.description || "")}`, 900),
        url: typeof e.htmlLink === "string" && e.htmlLink.startsWith("https://") ? e.htmlLink : null,
        slot: e.start?.dateTime && what !== "cancelada" ? { inicio: e.start.dateTime, fin: e.end?.dateTime || null, eventId: e.id } : null,
      });
    }
    return items;
  },
};

// ---- Team chat: Slack -------------------------------------------------------------------
const slack = {
  id: "slack", label: "Slack", toolkits: ["slack"],
  link: (s) => `Mensaje de ${nameOf(s.de)}`,
  async collect(ctx, account, mem) {
    const from = sinceOf(mem, ctx.time) - 10 * MINUTE;
    const day = new Date(from - 86400000).toISOString().slice(0, 10);
    const data = await ctx.read("SLACK_SEARCH_MESSAGES", account, { query: `after:${day}`, count: 30, sort: "timestamp", sort_dir: "desc" });
    return listOf(data, "messages.matches", "data.messages.matches", "matches").filter((m) => Number(m.ts) * 1000 >= from && !m.bot_id).map((m) => ({
      id: String(m.iid || (m.channel?.id || "") + ":" + m.ts), fuente: "Slack", cuenta: account.alias || "Slack",
      de: clip(m.username || m.user_name || m.user, 80), titulo: m.channel?.is_im ? "Mensaje directo" : "#" + (m.channel?.name || "canal"),
      fecha: new Date(Number(m.ts) * 1000).toISOString(), texto: clip(m.text, 900), url: typeof m.permalink === "string" ? m.permalink : null,
    }));
  },
};

// ---- Documents: Google Drive and Notion -------------------------------------------------
const drive = {
  id: "drive", label: "Drive", toolkits: ["googledrive"],
  link: (s) => `«${clip(s.titulo, 40)}»`,
  async collect(ctx, account, mem) {
    const from = new Date(sinceOf(mem, ctx.time) - 10 * MINUTE).toISOString();
    const q = `modifiedTime > '${from}' and trashed = false`;
    const data = await ctx.read("GOOGLEDRIVE_FIND_FILE", account, { q, query: q, orderBy: "modifiedTime desc", pageSize: 25, fields: "files(id,name,mimeType,modifiedTime,lastModifyingUser,webViewLink,sharedWithMeTime,owners)" });
    return listOf(data, "files", "data.files").filter((f) => !f.lastModifyingUser?.me && Date.parse(f.modifiedTime || 0) >= Date.parse(from)).map((f) => ({
      id: String(f.id) + ":" + f.modifiedTime, fuente: "Drive", cuenta: account.alias || "Drive", de: clip(f.lastModifyingUser?.displayName || f.owners?.[0]?.displayName, 80),
      titulo: clip(f.name, 200), fecha: f.modifiedTime || null, texto: clip(`${f.sharedWithMeTime && Date.parse(f.sharedWithMeTime) >= Date.parse(from) ? "Lo han compartido contigo" : "Lo han modificado"} (${String(f.mimeType || "").split(".").pop()}).`, 300),
      url: typeof f.webViewLink === "string" ? f.webViewLink : null,
    }));
  },
};
const titleOfPage = (p) => {
  for (const v of Object.values(p?.properties || {})) if (v?.type === "title") return (v.title || []).map((t) => t.plain_text || "").join("");
  return p?.title?.[0]?.plain_text || p?.title || "";
};
const notion = {
  id: "notion", label: "Notion", toolkits: ["notion"],
  link: (s) => `«${clip(s.titulo, 40)}»`,
  async collect(ctx, account, mem) {
    const from = sinceOf(mem, ctx.time) - 10 * MINUTE;
    const data = await ctx.read("NOTION_SEARCH_NOTION_PAGE", account, { query: "", page_size: 25, direction: "descending", timestamp: "last_edited_time" });
    return listOf(data, "results", "data.results", "response_data.results").filter((p) => Date.parse(p.last_edited_time || 0) >= from).map((p) => ({
      id: String(p.id) + ":" + p.last_edited_time, fuente: "Notion", cuenta: account.alias || "Notion", de: "", titulo: clip(titleOfPage(p) || "Página", 200),
      fecha: p.last_edited_time || null, texto: "Página editada.", url: typeof p.url === "string" ? p.url : null,
    }));
  },
};

// ---- Your folders (Ajustes › Este ordenador): new files ---------------------------------
const TEXTY = /\.(txt|md|csv|json)$/i;
const folders = {
  id: "folders", label: "Tus carpetas", local: true,
  link: () => null, // a local file has no web address; the message names it
  available: (ctx) => ctx.store.list("folders").filter((f) => !f.botIds?.length || f.botIds.includes(ctx.bot.id)),
  async collect(ctx, folder, mem) {
    const from = sinceOf(mem, ctx.time);
    const items = [];
    const look = async (dir, depth) => {
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries.slice(0, 400)) {
        if (e.name.startsWith(".") || e.name.startsWith("~$") || /\.(tmp|crdownload|part)$/i.test(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 1) await look(full, depth + 1); continue; }
        let info;
        try { info = await stat(full); } catch { continue; }
        if (Math.max(info.birthtimeMs || 0, info.mtimeMs) < from) continue;
        let excerpt = "";
        if (TEXTY.test(e.name) && info.size < 2e6) excerpt = await readFile(full, "utf8").then((t) => clip(t, 600)).catch(() => "");
        items.push({
          id: full + ":" + Math.round(info.mtimeMs), fuente: "Carpeta", cuenta: folder.label, de: "", titulo: path.relative(folder.path, full).replace(/\\/g, "/"),
          fecha: new Date(info.mtimeMs).toISOString(), texto: clip(`${info.birthtimeMs >= from ? "Archivo nuevo" : "Archivo cambiado"} en «${folder.label}» (${Math.max(1, Math.round(info.size / 1024))} KB). ${excerpt}`, 800), url: null,
        });
      }
    };
    await look(folder.path, 0);
    return items.slice(0, 20);
  },
};

export const SOURCES = [gmail, outlook, calendar, slack, drive, notion, folders];
export const SOURCE_IDS = SOURCES.map((s) => s.id);

/** Busy events of the calendar that overlap each proposed slot ([] = free); `skip`: the event itself. */
export function availability(slots, events, skip = null) {
  const busy = events.filter((e) => e?.id !== skip && e?.start?.dateTime && e?.end?.dateTime && e.transparency !== "transparent" && e.status !== "cancelled"
    && !(e.attendees || []).some((a) => a.self && ["declined", "needsAction"].includes(a.responseStatus)));
  return slots.map((s) => {
    const from = Date.parse(s.inicio), to = Date.parse(s.fin || s.inicio) || from + 3600000;
    if (!from) return null;
    const clash = busy.filter((e) => Date.parse(e.start.dateTime) < to && Date.parse(e.end.dateTime) > from).map((e) => ({ titulo: clip(e.summary || "Ocupado", 80), inicio: e.start.dateTime, fin: e.end.dateTime }));
    return { inicio: s.inicio, fin: s.fin || null, libre: !clash.length, choca: clash };
  }).filter(Boolean);
}
