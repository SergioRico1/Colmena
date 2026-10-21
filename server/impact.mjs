// What an approval would affect, in one plain sentence (OpenClaw approval cards): who gets
// a message and whether they are outside your organisation, how much money goes to whom,
// whether a post is public, how many things are deleted. Shown on top of the Bandeja card
// so a person can judge the decision without reading the technical details.

const EMAIL = /[^\s@<>,;"']+@([^\s@<>,;"']+\.[^\s@<>,;"']+)/i;
const list = (v) => (Array.isArray(v) ? v.flatMap(list) : typeof v === "string" && v.trim() ? v.split(/[,;]\s*/) : v && typeof v === "object" && v.email ? [v.email] : [])
  .map((x) => String(x).trim()).filter(Boolean);
const domainOf = (address) => (EMAIL.exec(address)?.[1] || "").toLowerCase();
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const first = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k]; return null; };

/** «nombre@empresa.com» domains that count as yours (your account, your people). */
export function ownDomainsOf(emails = []) {
  const free = new Set(["gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com", "yahoo.es", "icloud.com", "me.com", "proton.me", "protonmail.com"]);
  return [...new Set(emails.map(domainOf).filter((d) => d && !free.has(d)))];
}

function recipients(payload) {
  const to = list(first(payload, ["recipient_email", "to", "recipients", "email"]));
  const cc = list(payload?.cc), bcc = list(first(payload, ["bcc", "cco"]));
  const attendees = list(first(payload, ["attendees", "guests", "invitees", "participants"]));
  return { to, cc, bcc, attendees, all: [...new Set([...to, ...cc, ...bcc, ...attendees])] };
}

function money(payload) {
  const raw = first(payload, ["amount", "total", "price", "value", "amount_total", "importe"]);
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || raw == null) return null;
  const currency = String(first(payload, ["currency", "currency_code", "moneda"]) || "EUR").toUpperCase();
  const cents = payload?.amount_in_cents || payload?.unit === "cents" || (Number.isInteger(n) && /cents?|minor/i.test(JSON.stringify(payload?.amount_unit || "")));
  const value = cents ? n / 100 : n;
  let text;
  try { text = new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(value); } catch { text = value + " " + currency; }
  const payee = first(payload, ["payee", "recipient", "merchant", "beneficiary", "vendor", "to_account", "destination", "description"]);
  return { text, payee: payee ? String(payee).slice(0, 80) : null };
}

/**
 * {tone, headline, details[]} or null. tone: 'external' | 'internal' | 'money' | 'public' |
 * 'private' | 'delete'. `tool` is the action's name (e.g. GMAIL_SEND_EMAIL, stripe_create_payment).
 */
export function impactOf({ tool = "", kind = null, payload = {}, ownDomains = [] } = {}) {
  const name = String(tool || "").toLowerCase();
  const p = payload && typeof payload === "object" ? payload : {};
  const mine = new Set(ownDomains.map((d) => d.toLowerCase()));
  const isExternal = (a) => !mine.size || !mine.has(domainOf(a));

  if (/pay|transfer|purchase|charge|refund|checkout|buy|order|invoice/.test(name) || (kind === "pay")) {
    const m = money(p);
    if (m) return { tone: "money", headline: (/refund/.test(name) ? "Devolver " : "Pagar ") + m.text + (m.payee ? " a " + m.payee : ""), details: [] };
    return { tone: "money", headline: "Mueve dinero (importe sin indicar)", details: [] };
  }
  if (/delete|remove|trash|destroy|purge|archive/.test(name)) {
    const ids = first(p, ["ids", "message_ids", "file_ids", "items", "paths"]);
    const n = Array.isArray(ids) ? ids.length : 1;
    return { tone: "delete", headline: (/archive/.test(name) ? "Archivar " : "Borrar ") + plural(n, "elemento", "elementos"), details: [] };
  }
  const r = recipients(p);
  if (kind === "send" || /send|reply|forward|invite|email|mail|message|sms/.test(name) || r.all.length) {
    if (!r.all.length) return { tone: "external", headline: "Envía un mensaje (destinatario sin indicar)", details: [] };
    const external = r.all.filter(isExternal);
    const verb = r.attendees.length && !r.to.length ? "Invitar a " : "Enviar a ";
    const invite = verb.startsWith("Invitar");
    const who = r.all.length === 1 ? r.all[0] : invite ? plural(r.all.length, "persona", "personas") : plural(r.all.length, "destinatario", "destinatarios");
    const where = !mine.size ? "" : external.length === r.all.length ? (r.all.length === 1 ? " (fuera de tu organización)" : " · todos de fuera de tu organización")
      : external.length ? " · " + external.length + " de fuera de tu organización" : r.all.length === 1 ? " (de tu organización)" : " · todos de tu organización";
    const details = [];
    const some = (xs) => xs.slice(0, 6).join(", ") + (xs.length > 6 ? " y " + (xs.length - 6) + " más" : "");
    if (mine.size && external.length && external.length < r.all.length) details.push("De fuera: " + some(external));
    if (r.bcc.length) details.push("En copia oculta: " + plural(r.bcc.length, "persona", "personas"));
    return { tone: external.length || !mine.size ? "external" : "internal", headline: verb + who + where, details };
  }
  if (/post|publish|tweet|share|upload|status|comment|story/.test(name)) {
    const vis = String(first(p, ["visibility", "privacy", "audience", "privacy_status", "access"]) ?? (p.public === true ? "public" : p.public === false ? "private" : "")).toLowerCase();
    const where = first(p, ["channel", "page", "board", "subreddit", "group", "account"]);
    const isPrivate = /priv|only_me|draft|unlisted|connections|friends|internal/.test(vis);
    const head = isPrivate ? "Publicar con visibilidad restringida" : vis ? "Publicar en público" : "Publicar (visibilidad sin indicar: puede ser pública)";
    return { tone: isPrivate ? "private" : "public", headline: head + (where ? " en " + String(where).slice(0, 60) : ""), details: [] };
  }
  return null;
}
