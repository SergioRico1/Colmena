import { useState } from "react";
import { ArrowUpRight, Globe, X } from "lucide-react";
import { useDismiss } from "./common.jsx";

// «Fuentes» under a researched answer (OpenClaw chat-source-previews): the pages the answer
// links to that the bot actually searched or read in that turn, in the order cited, at most
// 8. Nothing is fetched: title, site and excerpt come from the bot's own searches and reads.
const MAX = 8;
const EXCERPT = 280;
const I = { size: 13, strokeWidth: 2.3, "aria-hidden": "true" };

const norm = (u) => {
  try {
    const x = new URL(u);
    x.hash = "";
    // OpenAI's search adds utm_source=openai to the links it cites: the same page either way.
    for (const k of [...x.searchParams.keys()]) if (/^utm_/.test(k)) x.searchParams.delete(k);
    return x.href.replace(/\/$/, "").replace(/\?$/, "");
  } catch { return null; }
};
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
/** The page's prose without the «external content» frame the bots get. */
const prose = (t) => String(t || "").split("\n").filter((l) => !/^(<<<|>>>|Source:|---$)/.test(l.trim())).join(" ").replace(/\s+/g, " ").trim();
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** Links of the answer that match a search result or a page read in the same step. */
export function sourcesOf(text, tools = []) {
  const cited = [];
  for (const m of String(text || "").matchAll(/\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()"']+)/g)) {
    const u = norm(m[1] || m[2]);
    if (u && !cited.includes(u)) cited.push(u);
  }
  if (!cited.length) return [];
  const known = new Map();
  for (const t of tools) {
    const c = t?.card;
    if (!c || t.status === "error") continue;
    if (c.type === "websearch") for (const s of c.sources || []) { const u = norm(s.url); if (u && !known.has(u)) known.set(u, { url: s.url, title: s.title || null, excerpt: s.snippet ? prose(s.snippet) : null, kind: "search" }); }
    if (c.type === "web" && c.url) { const u = norm(c.url); if (u) known.set(u, { url: c.url, title: c.title || null, excerpt: c.excerpt ? prose(c.excerpt) : null, kind: "page" }); }
  }
  const out = [];
  for (const u of cited) {
    const s = known.get(u);
    if (s) out.push({ ...s, domain: host(s.url), title: clip(s.title || host(s.url), 180), excerpt: s.excerpt ? clip(s.excerpt, EXCERPT) : null });
    if (out.length >= MAX) break;
  }
  return out;
}

function SourceCard({ s }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <span ref={ref} style={{ position: "relative", display: "flex", flex: "0 1 220px", maxWidth: "240px", minWidth: 0 }}>
      <button type="button" className="rm-focus c-lift" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)} title={s.url}
        style={{ flex: "1", minWidth: 0, minHeight: "58px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "4px", padding: "8px 10px", background: "#FFFFFF", border: "1px solid " + (open ? "#12131A" : "#DCE0E8"), borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: "13px", fontWeight: "600", color: "#12131A", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: "1.3" }}>{s.title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#555A68", minWidth: 0 }}>
          <Globe {...I} size={12} style={{ flex: "none" }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.domain}</span>
        </span>
      </button>
      {open ? (
        <div role="dialog" aria-label={"Fuente: " + s.domain} className="c-pop" style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: 0, width: "min(340px, 80vw)", padding: "12px 14px", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "14px", boxShadow: "4px 4px 0 #FFC93C", display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#555A68" }}><Globe {...I} size={12} />{s.domain}</span>
            <button type="button" className="rm-focus" onClick={() => setOpen(false)} aria-label="Cerrar" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "7px", cursor: "pointer" }}><X {...I} /></button>
          </span>
          <strong style={{ fontSize: "14px", lineHeight: "1.35" }}>{s.title}</strong>
          <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.05em", textTransform: "uppercase", color: "#555A68" }}>{s.kind === "page" ? "Extracto de la página" : "Resultado de la búsqueda"}</span>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.5", color: "#2B2D36" }}>{s.excerpt || "Sin extracto."}</p>
          <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", borderRadius: "9px", fontSize: "13px", fontWeight: "600" }}>Abrir la fuente<ArrowUpRight {...I} /></a>
        </div>
      ) : null}
    </span>
  );
}

export default function Sources({ text, tools }) {
  const list = sourcesOf(text, tools);
  if (!list.length) return null;
  return (
    <div role="group" aria-label="Fuentes" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{`Fuentes · ${list.length}`}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{list.map((s) => <SourceCard key={s.url} s={s} />)}</div>
    </div>
  );
}
