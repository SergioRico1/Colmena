import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useResource } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { patch } from "../../lib/api.js";
import { needsCount } from "../v2/needs.js";
import { BotPresence, shapeOf } from "../v2/Presence.jsx";
import { WindowDots } from "../v2/Rail.jsx";
import { listRows } from "../../lib/threads.js";
import { useExpert } from "../../lib/expert.js";

// The Colmena 3 sidebar (design/V3Barra.dc.html), the same on every screen: «Nuevo» (Ctrl N) and
// «Buscar o pedir» (Ctrl K), the six places (Ctrl 1–6), what you pinned and what you used last,
// the team's pulse (Actividad) and you (Ajustes) with the «Modo experto» switch (Ctrl Shift E).
// Ctrl B folds it to a rail of icons. Icons are the ones drawn on the board.
export const PLACES = [
  { id: "inicio", label: "Inicio", href: "/", icon: "M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z" },
  { id: "chats", label: "Chats", href: "/chats", icon: "M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6.5L6 19.5V16a2.5 2.5 0 0 1-1.5-2.3z" },
  { id: "trabajo", label: "Trabajo", href: "/trabajo", icon: "M10 6h10M10 12h10M10 18h10M4 6l1.3 1.3L7.8 4.8M4 12l1.3 1.3 2.5-2.5M4 18l1.3 1.3 2.5-2.5" },
  { id: "codigo", label: "Código", href: "/codigo", icon: "m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" },
  { id: "equipo", label: "Equipo", href: "/equipo", icon: "M8 3.8h8l4 8.2-4 8.2H8l-4-8.2zM12 9.3l2.3 1.35v2.7L12 14.7l-2.3-1.35v-2.7z" },
  { id: "biblioteca", label: "Biblioteca", href: "/biblioteca", icon: "M4 4.5h3.5v15H4zM9.5 4.5H13v15H9.5zM15 5.5l3.2-1 3.3 14-3.2 1z" },
];
// Old place ids (Colmena 2) still passed by some screens.
const ALIAS = { hoy: "inicio", conversaciones: "chats", rutinas: "trabajo", objetivos: "trabajo", colmena: "equipo", archivo: "biblioteca" };
export const placeId = (id) => ALIAS[id] || id;

const NEW_ITEMS = [
  { id: "chat", label: "Chat con un bot", hint: "Pregunta o encarga algo", icon: "M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6.5L6 19.5V16a2.5 2.5 0 0 1-1.5-2.3z" },
  { id: "sala", label: "Sala", hint: "Con personas y varios bots", icon: "M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" },
  { id: "tarea", label: "Tarea", hint: "Un trabajo con plan y entrega", href: "/trabajo?nueva=1", icon: "M5 12.5l4 4 10-10" },
  { id: "rutina", label: "Rutina", hint: "Algo que se repite solo", href: "/trabajo/rutinas?nueva=1", icon: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.8 4.5v3.6h-3.6" },
  { id: "objetivo", label: "Objetivo", hint: "Una meta a largo plazo", href: "/trabajo/objetivos?nuevo=1", icon: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" },
  { id: "bot", label: "Bot", hint: "Un compañero nuevo", href: "/equipo/nuevo", icon: "M8 3.8h8l4 8.2-4 8.2H8l-4-8.2z" },
  { id: "codigo", label: "Tarea de código", hint: "En uno de tus proyectos", href: "/codigo", icon: "m18 16 4-4-4-4M6 8l-4 4 4 4" },
];

const DONE = new Set(["done", "completed", "cancelled", "failed"]);
const kbd = { font: "500 11px/1 'Geist Mono', monospace", color: "#5C606C" };
const sectionLabel = { padding: "8px 10px 4px", fontSize: "12px", fontWeight: "600", color: "#5C606C" };
const rowLink = { flex: "none", height: "32px", display: "flex", alignItems: "center", gap: "10px", padding: "0 10px", borderRadius: "9px", color: "#3D404A", fontSize: "14px", textDecoration: "none" };
const ellipsis = { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const initials = (name) => String(name || "Tú").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "TÚ";
const at = (m) => Date.parse(m.rowAt || m.updatedAt || m.createdAt || 0) || 0;

/** What a mission is in the sidebar: a chat with one bot, a room, or a task. */
function entryOf(m, botOf) {
  if (m.conversation && m.botIds?.length === 1 && !m.room) {
    const bot = botOf(m.botIds[0]);
    return { key: m.id, href: `/chat/${m.botIds[0]}`, label: bot?.name || "Chat", bot };
  }
  if (m.room || m.conversation) return { key: m.id, href: `/sala/${m.id}`, label: m.room || m.title || "Sala", glyph: "#" };
  return { key: m.id, href: `/encargo/${m.id}`, label: m.title || m.prompt || "Tarea", glyph: "✓", box: true };
}

/** The 18 px mark before a row: a bot's shape, «#» for a room, a ticked box for a task, initials for a person. */
function Mark({ entry }) {
  if (entry.bot) return <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center" }}><span style={{ width: "14px", height: "14px", background: entry.bot.color || "#C9CBD1", clipPath: shapeOf(entry.bot).clip, borderRadius: shapeOf(entry.bot).radius }} /></span>;
  if (entry.person) return <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#DCDCD5", font: "600 7.5px/1 'Geist', sans-serif", color: "#3D404A" }}>{initials(entry.person)}</span>;
  if (entry.box) return <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center" }}><span style={{ width: "16px", height: "16px", display: "grid", placeItems: "center", borderRadius: "5px", background: "#DCDCD5", font: "600 10px/1 'Geist', sans-serif", color: "#3D404A" }}>{entry.glyph}</span></span>;
  return <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center", font: `600 ${entry.glyph === "</>" ? "9.5px" : "14px"}/1 'Geist', sans-serif`, color: "#3D404A" }}>{entry.glyph}</span>;
}

/** Turns an address you pinned into a row, from what the store knows about it. */
function pinnedEntry(href, { missions, bots, botOf }) {
  let m;
  if ((m = /^\/chat\/([^/?#]+)/.exec(href))) { const bot = botOf(m[1]); return bot ? { key: href, href, label: bot.name, bot } : null; }
  if ((m = /^\/(?:sala|encargo|misiones)\/([^/?#]+)/.exec(href))) { const x = missions.find((y) => y.id === m[1]); return x ? { ...entryOf(x, botOf), key: href, href } : null; }
  if ((m = /^\/(?:equipo|colmena)\/([^/?#]+)/.exec(href))) { const bot = bots.find((b) => b.id === m[1]); return bot ? { key: href, href, label: bot.name, bot } : null; }
  if (href.startsWith("/codigo/")) return { key: href, href, label: decodeURIComponent(href.split("/").pop() || "Código"), glyph: "</>" };
  return null;
}

export default function Sidebar({ active = "inicio" }) {
  const store = useStore();
  const { bots = [], missions = [], notifications = [], settings = {}, run } = store;
  const current = placeId(active);
  const [expert, setExpert] = useExpert();
  const [menu, setMenu] = useState(false);
  const [folded, setFoldedState] = useState(!!settings.sidebarFolded);
  const menuRef = useRef(null);
  useEffect(() => setFoldedState(!!settings.sidebarFolded), [settings.sidebarFolded]);
  const setFolded = (v) => { setFoldedState(v); run(() => patch("/settings", { sidebarFolded: v })).catch(() => {}); };

  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const needs = needsCount(store);
  const unreadChats = new Set(notifications.filter((n) => !n.read && n.missionId && (n.kind === "mention" || n.kind === "message")).map((n) => n.missionId));
  const badges = { inicio: needs ? { n: needs, honey: true, label: needs === 1 ? "1 cosa te necesita" : `${needs} cosas te necesitan` } : null, chats: unreadChats.size ? { n: unreadChats.size, label: unreadChats.size === 1 ? "1 chat sin leer" : `${unreadChats.size} chats sin leer` } : null };

  const pinnedHrefs = settings.pinned || [];
  const pinned = useMemo(() => pinnedHrefs.map((h) => pinnedEntry(h, { missions, bots, botOf })).filter(Boolean), [pinnedHrefs, missions, bots]);
  const recent = useMemo(() => {
    const taken = new Set(pinned.map((p) => p.href));
    const rows = listRows(missions).filter((m) => !m.incognito).map((m) => ({ m, at: at(m) }));
    const tasks = missions.filter((m) => !m.conversation && !m.room && !m.archived && !m.automationId && !m.incognito).map((m) => ({ m, at: at(m) }));
    const seen = new Set();
    return [...rows, ...tasks].sort((a, b) => b.at - a.at).map(({ m }) => entryOf(m, botOf)).filter((e) => {
      if (taken.has(e.href) || seen.has(e.href)) return false;
      seen.add(e.href);
      return true;
    }).slice(0, 5);
  }, [missions, bots, pinned]);

  // The team's pulse: who works, who waits for you.
  const team = bots.filter((b) => b.enabled !== false);
  const working = team.filter((b) => b.status === "trabaja");
  const waiting = team.filter((b) => b.status === "espera");
  const pulse = [...working, ...waiting, ...team.filter((b) => b.status !== "trabaja" && b.status !== "espera")].slice(0, 6);
  const usage = useResource(expert ? "/usage/overview?days=1" : null);
  const today = usage?.data?.total;
  const pulseLine = expert && today
    ? `${new Intl.NumberFormat("es-ES", { notation: "compact" }).format(today.tokens || 0)} tokens hoy${today.cachePercent != null ? ` · caché ${today.cachePercent} %` : ""}`
    : waiting[0] ? `${waiting[0].name} espera tu decisión` : working[0] ? `${working[0].name} está trabajando` : "Todos libres";
  const pulseHead = [working.length ? `${working.length} trabajando` : "Nadie trabajando", waiting.length ? `${waiting.length} te espera${waiting.length === 1 ? "" : "n"}` : null].filter(Boolean).join(" · ");

  const pick = (item) => {
    setMenu(false);
    // Chats opens its sheet from ?nuevo=; when it is already open, the event does it in place.
    if (item.id === "chat" || item.id === "sala") {
      if (location.pathname === "/chats") window.dispatchEvent(new CustomEvent("colmena:new-conversation", { detail: { kind: item.id } }));
      else navigate(`/chats?nuevo=${item.id}`);
      return;
    }
    navigate(item.href);
  };

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === "e") { e.preventDefault(); setExpert(!expert); return; }
      if (e.shiftKey) return;
      if (k === "n") { e.preventDefault(); setMenu((v) => !v); return; }
      if (k === "b") { e.preventDefault(); setFolded(!folded); return; }
      if (/^[1-6]$/.test(e.key)) { e.preventDefault(); navigate(PLACES[Number(e.key) - 1].href); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expert, folded]);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    requestAnimationFrame(() => menuRef.current?.querySelector("[role=menuitem]")?.focus());
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc); };
  }, [menu]);
  const menuKeys = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...menuRef.current.querySelectorAll("[role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const width = folded ? 68 : 248;
  const noDrag = { WebkitAppRegion: "no-drag" };
  const userName = settings.userName || "Tú";
  const newMenu = menu ? (
    <div role="menu" aria-label="Crear algo nuevo" onKeyDown={menuKeys} style={{ position: "absolute", top: "46px", left: "0", right: folded ? "auto" : "-6px", width: folded ? "260px" : "auto", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "v3sheet .18s ease-out" }}>
      {NEW_ITEMS.map((n) => (
        <button key={n.id} type="button" role="menuitem" onClick={() => pick(n)} className="v3-menuitem" style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", padding: "6px 10px", border: "0", borderRadius: "10px", background: "transparent", color: "#12131A", textAlign: "left", cursor: "pointer" }}>
          <span aria-hidden="true" style={{ flex: "none", width: "28px", height: "28px", display: "grid", placeItems: "center", borderRadius: "9px", background: "#F1F1EC" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg></span>
          <span style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}><span style={{ fontSize: "14px", fontWeight: "600" }}>{n.label}</span><span style={{ fontSize: "12px", color: "#5C606C" }}>{n.hint}</span></span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <nav aria-label="Navegación de Colmena" data-v3-sidebar={folded ? "folded" : "open"} style={{ position: "relative", zIndex: "40", boxSizing: "border-box", flex: "none", width: width + "px", height: "100%", minHeight: "560px", display: "flex", flexDirection: "column", gap: "12px", padding: "12px", background: "#ECECE7", borderRight: "1px solid rgba(18,19,26,.07)", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#12131A", WebkitFontSmoothing: "antialiased", WebkitAppRegion: "drag", transition: "width .18s ease" }}>
      <style>{SIDEBAR_CSS}</style>
      <div style={{ flex: "none", display: "flex", flexDirection: folded ? "column" : "row", alignItems: "center", justifyContent: "space-between", gap: folded ? "10px" : "0", minHeight: "24px", padding: folded ? "0" : "0 4px" }}>
        <span style={{ display: "flex", alignItems: "center", height: "24px", ...noDrag }}><WindowDots inline compact={folded} /></span>
        <button type="button" onClick={() => setFolded(!folded)} aria-label={folded ? "Desplegar la barra (Ctrl B)" : "Plegar la barra (Ctrl B)"} title={folded ? "Desplegar la barra (Ctrl B)" : "Plegar la barra (Ctrl B)"} className="v3-hover" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "8px", background: "transparent", color: "#4A4D57", cursor: "pointer", ...noDrag }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15" /></svg></button>
      </div>

      <a href="/" aria-label={folded ? "Colmena" : undefined} style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0" : "0 6px", color: "#12131A", textDecoration: "none", ...noDrag }}>
        <img src="/colmena-icon-128.png" alt="" width="28" height="28" style={{ display: "block", width: "28px", height: "28px", filter: "drop-shadow(0 2px 4px rgba(201,120,0,.35))" }} />
        {folded ? null : <span style={{ font: "600 20px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Colmena"}</span>}
      </a>

      <div ref={menuRef} style={{ flex: "none", position: "relative", zIndex: "5", display: "flex", flexDirection: "column", gap: "8px", ...noDrag }}>
        <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu" aria-label={folded ? "Nuevo (Ctrl N)" : undefined} title={folded ? "Nuevo (Ctrl N)" : undefined} style={{ height: "40px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0" : "0 12px 0 14px", border: "0", borderRadius: "12px", background: "#12131A", color: "#FFFFFF", fontSize: "14.5px", fontWeight: "600", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {folded ? null : <><span style={{ flex: "1", textAlign: "left" }}>{"Nuevo"}</span><kbd style={{ ...kbd, color: "#A9ACB6" }}>{"Ctrl N"}</kbd></>}
        </button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("colmena:palette"))} aria-label={folded ? "Buscar o pedir (Ctrl K)" : undefined} title={folded ? "Buscar o pedir (Ctrl K)" : undefined} style={{ height: "40px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0" : "0 12px", border: "0", borderRadius: "12px", background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.08)", color: "#5C606C", fontSize: "14px", cursor: "pointer", textAlign: "left" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2" /></svg>
          {folded ? null : <><span style={{ flex: "1" }}>{"Buscar o pedir"}</span><kbd style={kbd}>{"Ctrl K"}</kbd></>}
        </button>
        {newMenu}
      </div>

      <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: "2px", ...noDrag }}>
        {PLACES.map((p, i) => {
          const on = p.id === current;
          const badge = badges[p.id];
          return (
            <a key={p.id} href={p.href} aria-current={on ? "page" : undefined} aria-label={folded ? p.label : undefined} title={folded ? `${p.label} (Ctrl ${i + 1})` : undefined} className={on ? undefined : "v3-hover"} style={{ position: "relative", height: "36px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "11px", padding: folded ? "0" : "0 10px", borderRadius: "10px", textDecoration: "none", color: on ? "#12131A" : "#3D404A", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.08), 0 6px 14px -8px rgba(18,19,26,.3)" : "none", fontSize: "14.5px", fontWeight: on ? "600" : "500" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p.icon} /></svg>
              {folded ? null : <span style={{ flex: "1" }}>{p.label}</span>}
              {badge ? <span aria-label={badge.label} style={{ ...(folded ? { position: "absolute", top: "-2px", right: "2px", boxShadow: "0 0 0 2px #ECECE7" } : {}), minWidth: "20px", height: "20px", padding: "0 6px", display: "grid", placeItems: "center", borderRadius: "10px", background: badge.honey ? "#FFC93C" : "#12131A", color: badge.honey ? "#12131A" : "#FFFFFF", fontSize: "11.5px", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{badge.n}</span> : null}
              {!folded && expert && !badge ? <kbd style={kbd}>{`Ctrl ${i + 1}`}</kbd> : null}
            </a>
          );
        })}
      </div>

      {folded ? <span style={{ flex: "1" }} /> : (
        <div style={{ flex: "1", minHeight: "0", display: "flex", flexDirection: "column", gap: "1px", margin: "0 -4px", padding: "2px 4px", overflowY: "auto", ...noDrag }}>
          {pinned.length ? <>
            <span style={sectionLabel}>{"Fijados"}</span>
            {pinned.map((p) => (
              <a key={p.key} href={p.href} className="v3-hover" style={rowLink}>
                <Mark entry={p} />
                <span style={ellipsis}>{p.label}</span>
              </a>
            ))}
          </> : null}
          {recent.length ? <>
            <span style={{ ...sectionLabel, paddingTop: pinned.length ? "12px" : "8px" }}>{"Recientes"}</span>
            {recent.map((p) => (
              <a key={p.key} href={p.href} className="v3-hover" style={rowLink}>
                <Mark entry={p} />
                <span style={ellipsis}>{p.label}</span>
                {unreadChats.has(p.key) ? <span aria-label="Sin leer" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#12131A" }} /> : null}
              </a>
            ))}
          </> : null}
        </div>
      )}

      {folded ? null : (
        <a href="/actividad" aria-current={current === "actividad" ? "page" : undefined} style={{ flex: "none", display: "flex", flexDirection: "column", gap: "7px", padding: "11px 12px", borderRadius: "14px", background: current === "actividad" ? "#FFFFFF" : "rgba(255,255,255,.55)", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.07)", color: "#12131A", textDecoration: "none", ...noDrag }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", minHeight: "13px" }}>
            {pulse.map((b) => <BotPresence key={b.id} bot={b} size={13} />)}
            <span style={{ marginLeft: "auto", fontSize: "12px", color: "#5C606C" }}>{"Actividad"}</span>
          </span>
          <span style={{ fontSize: "13.5px", fontWeight: "600" }}>{pulseHead}</span>
          <span style={{ fontSize: "12.5px", color: "#5C606C", ...ellipsis, flex: "none" }}>{pulseLine}</span>
        </a>
      )}

      <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: folded ? "center" : "stretch", gap: "4px", paddingTop: "10px", borderTop: "1px solid rgba(18,19,26,.08)", ...noDrag }}>
        {folded ? (
          <a href="/actividad" aria-label="Actividad" title="Actividad" className="v3-hover" style={{ width: "40px", height: "36px", display: "grid", placeItems: "center", borderRadius: "10px", color: "#3D404A" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l2.5-6 5 12 2.5-6H21" /></svg></a>
        ) : null}
        <a href="/ajustes" aria-current={current === "ajustes" ? "page" : undefined} aria-label={folded ? "Ajustes y cuenta" : undefined} title={folded ? "Ajustes y cuenta" : undefined} className={current === "ajustes" ? undefined : "v3-hover"} style={{ height: "44px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0 6px" : "0 8px", borderRadius: "12px", background: current === "ajustes" ? "#FFFFFF" : "transparent", color: "#12131A", textDecoration: "none" }}>
          <span aria-hidden="true" style={{ flex: "none", width: "30px", height: "30px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#E6E7EC", color: "#12131A", fontSize: "11px", fontWeight: "600" }}>{initials(userName)}</span>
          {folded ? null : <>
            <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}><span style={{ fontSize: "14px", fontWeight: "600", ...ellipsis, flex: "none" }}>{userName}</span><span style={{ fontSize: "12px", color: "#5C606C" }}>{"Ajustes y cuenta"}</span></span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A4D57" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5" /></svg>
          </>}
        </a>
        <button type="button" role="switch" aria-checked={expert} onClick={() => setExpert(!expert)} aria-label={folded ? "Modo experto (Ctrl Shift E)" : undefined} title={folded ? "Modo experto (Ctrl Shift E)" : undefined} className="v3-hover" style={{ height: "34px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0 6px" : "0 8px 0 10px", border: "0", borderRadius: "10px", background: "transparent", cursor: "pointer", fontSize: "13.5px", fontWeight: "500", color: "#3D404A" }}>
          {folded ? null : <span style={{ flex: "1", textAlign: "left" }}>{"Modo experto"}</span>}
          {!folded && expert ? <kbd style={{ ...kbd, fontSize: "10.5px" }}>{"Ctrl ⇧ E"}</kbd> : null}
          <span aria-hidden="true" style={{ position: "relative", flex: "none", width: "34px", height: "20px", borderRadius: "10px", background: expert ? "#12131A" : "#8A8D96", transition: "background .2s ease" }}><span style={{ position: "absolute", top: "2px", left: expert ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)", transition: "left .2s ease" }} /></span>
        </button>
      </div>
    </nav>
  );
}

const SIDEBAR_CSS = `
[data-v3-sidebar] .v3-hover:hover{background:rgba(18,19,26,.05)!important}
[data-v3-sidebar] .v3-menuitem:hover,[data-v3-sidebar] .v3-menuitem:focus-visible{background:#F6F6F3!important;outline:none}
[data-v3-sidebar] :focus-visible{outline:2px solid #1F4FD1;outline-offset:2px}
@keyframes v3sheet{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){[data-v3-sidebar] *{animation:none!important;transition:none!important}}
`;
