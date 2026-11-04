// Where an answer comes from (after assistant-ui sources, inline-citation and link-preview):
// the web pages it links to that the bot really searched or read, the mails a notice is
// about, and the documents it read. Nothing is fetched: titles, excerpts and dates come from
// the bot's own reads and from the notice itself.

const MAX = 8;
const EXCERPT = 280;

export const normUrl = (u) => {
  try {
    const x = new URL(u);
    x.hash = "";
    // OpenAI's search adds utm_source=openai to the links it cites: the same page either way.
    for (const k of [...x.searchParams.keys()]) if (/^utm_/.test(k)) x.searchParams.delete(k);
    return x.href.replace(/\/$/, "").replace(/\?$/, "");
  } catch { return null; }
};
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
/** The page's prose without the «external content» frame the bots get. */
const prose = (t) => String(t || "").split("\n").filter((l) => !/^(<<<|>>>|Source:|---$)/.test(l.trim())).join(" ").replace(/\s+/g, " ").trim();
const clip = (t, n) => { const s = String(t || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** The links an answer cites, in order, normalized. */
export function citedUrls(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()"']+)/g)) {
    const u = normUrl(m[1] || m[2]);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * The sources of one answer: [{ key, kind: "web"|"mail"|"file", url, title, site, excerpt,
 * meta }]. Web pages only when the answer links to them; mails from a notice's `sources`;
 * documents the step read (one per document, however many pages).
 */
export function collectSources({ text = "", tools = [], mails = [] } = {}) {
  const out = [];
  const seen = new Set();
  const add = (s) => { if (!seen.has(s.key) && out.length < MAX) { seen.add(s.key); out.push(s); } };
  // Mails (and events, messages…) a notice is about: they are what it says.
  for (const m of mails || []) {
    if (!m) continue;
    const key = "mail:" + (m.hilo || m.id || m.url || m.titulo);
    add({ key, kind: "mail", url: m.url || null, title: clip(m.asunto || m.titulo || "Sin asunto", 180), site: m.fuente || "Correo", excerpt: null, meta: [m.de, m.fecha ? String(m.fecha).slice(0, 10) : null, m.cuenta].filter(Boolean).join(" · ") || null });
  }
  // Web: what it searched or read in this step, when the answer links to it.
  const known = new Map();
  for (const t of tools || []) {
    const c = t?.card;
    if (!c || t.status === "error") continue;
    if (c.type === "websearch") for (const s of c.sources || []) { const u = normUrl(s.url); if (u && !known.has(u)) known.set(u, { url: s.url, title: s.title || null, excerpt: s.snippet ? prose(s.snippet) : null, how: "Resultado de la búsqueda" }); }
    if (c.type === "web" && c.url) { const u = normUrl(c.url); if (u) known.set(u, { url: c.url, title: c.title || null, excerpt: c.excerpt ? prose(c.excerpt) : null, how: "Extracto de la página" }); }
  }
  for (const u of citedUrls(text)) {
    const s = known.get(u);
    if (s) add({ key: "web:" + u, kind: "web", url: s.url, title: clip(s.title || hostOf(s.url), 180), site: hostOf(s.url), excerpt: s.excerpt ? clip(s.excerpt, EXCERPT) : null, meta: s.how });
  }
  // Documents it read (PDF, Word, Excel…), once each.
  for (const t of tools || []) {
    const c = t?.card;
    if (!c || t.status === "error" || !["file", "pdf_fields"].includes(c.type)) continue;
    const name = c.name || (c.path ? String(c.path).split(/[\\/]/).pop() : null);
    if (!name) continue;
    const pages = c.pages ? (c.pages === 1 ? "1 página" : `${c.pages} páginas`) : null;
    add({ key: "file:" + (c.path || name), kind: "file", url: null, title: name, site: "Documento", excerpt: null, meta: [pages, c.path && c.path !== name ? c.path : null].filter(Boolean).join(" · ") || null });
  }
  return out;
}

/** url → source, for the links of the answer that are one of its sources (inline citations). */
export function citationMap(sources = []) {
  const map = new Map();
  for (const s of sources) if (s.url) { const u = normUrl(s.url); if (u) map.set(u, s); }
  return map;
}
