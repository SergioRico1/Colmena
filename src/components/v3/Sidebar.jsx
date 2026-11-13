import { stepOf } from "../../lib/type.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, useResource } from "../../lib/store.jsx";
import { navigate, useRouter } from "../../lib/router.jsx";
import { patch, put } from "../../lib/api.js";
import { BotPresence, shapeOf } from "../v2/Presence.jsx";
import { WindowDots } from "../v2/Rail.jsx";
import { NewConversation } from "../v2/chat/ConvList.jsx";
import { AcceptSheet, InviteSheet } from "../v2/people/InviteSheets.jsx";
import NewRoomSheet from "./team/NewRoomSheet.jsx";
import TeamSheets from "./team/TeamSheets.jsx";
import { useExpert } from "../../lib/expert.js";
import { reducedMotion } from "../../lib/motion.js";
import { statusText } from "../../lib/peers.js";
import { failure } from "../../lib/undoToast.js";
import { realTeams } from "../../lib/teams.js";
import WorkingDots from "../room/Dots.jsx";
import { STATE_WORD, STATUS_WORD, conversationPath, foldBots, foldRooms, rememberConversation, rowLabel, scrollFade, sidebarModel, teamHeader, waitingLabel } from "../../lib/sidebar.js";

// The Colmena sidebar, the same on every screen (docs/PLAN-equipo-y-salas.md): it names who you
// talk to. Top to bottom: your team (or «Solo tú»), «Nuevo» (Ctrl N) and «Buscar o pedir»
// (Ctrl K), five places (Ctrl 1–5), and three live groups — Salas, Bots, Personas — that fold
// and remember it; at the foot, you, one line of activity and the «Modo experto» switch
// (Ctrl Shift E). Ctrl B folds it to a rail of icons and avatars. Honey only marks what waits
// for you; unread is bold with a neutral count. The rows come from src/lib/sidebar.js.
export const PLACES = [
  { id: "inicio", label: "Inicio", href: "/", icon: "M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z" },
  { id: "trabajo", label: "Trabajo", href: "/trabajo", icon: "M10 6h10M10 12h10M10 18h10M4 6l1.3 1.3L7.8 4.8M4 12l1.3 1.3 2.5-2.5M4 18l1.3 1.3 2.5-2.5" },
  { id: "codigo", label: "Código", href: "/codigo", icon: "m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" },
  { id: "equipo", label: "Equipo", href: "/equipo", icon: "M8 3.8h8l4 8.2-4 8.2H8l-4-8.2zM12 9.3l2.3 1.35v2.7L12 14.7l-2.3-1.35v-2.7z" },
  { id: "biblioteca", label: "Biblioteca", href: "/biblioteca", icon: "M4 4.5h3.5v15H4zM9.5 4.5H13v15H9.5zM15 5.5l3.2-1 3.3 14-3.2 1z" },
];
// Old place ids (Colmena 2) still passed by some screens. «Chats» is no longer a place: its
// screens light their own row in a group instead.
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

const INK = "#12131A", TEXT = "#3D404A", MUTED = "#5C606C", HONEY = "#FFC93C";
const kbd = { font: "500 var(--t-micro)/1 'Geist Mono', monospace", color: MUTED };
const rowLink = { position: "relative", flex: "none", display: "flex", alignItems: "center", gap: "10px", padding: "0 8px 0 10px", borderRadius: "var(--r-sm)", color: TEXT, fontSize: "var(--t-ui)", textDecoration: "none" };
const onRow = { background: "#FFFFFF", color: INK, boxShadow: "0 1px 2px rgba(18,19,26,.08), 0 6px 14px -8px rgba(18,19,26,.3)" };
const ellipsis = { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const menuBox = { position: "absolute", left: "0", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-lg)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "v3sheet .18s ease-out" };
const menuItem = { display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", padding: "6px 10px", border: "0", borderRadius: "var(--r-md)", background: "transparent", color: INK, fontSize: "var(--t-ui)", fontWeight: "500", textAlign: "left", textDecoration: "none", cursor: "pointer" };
const initials = (name) => String(name || "Tú").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "TÚ";

// What the sidebar remembers between screens (each screen mounts its own): which groups are
// folded (also across sessions), whether every room shows, how far it was scrolled.
const GROUPS_KEY = "colmena:sidebar-groups";
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
let allRooms = false, allBots = false, scrolled = 0;

/** Turns an address you pinned that no group shows (a Código task, a bot's page) into a row. */
function pinnedEntry(href, { bots }) {
  let m;
  if ((m = /^\/(?:equipo|colmena)\/([^/?#]+)/.exec(href))) { const bot = bots.find((b) => b.id === m[1]); return bot ? { key: href, href, label: bot.name, bot } : null; }
  if (href.startsWith("/codigo/")) return { key: href, href, label: decodeURIComponent(href.split("/").pop() || "Código"), glyph: "</>" };
  return null;
}

/** A neutral count (unread) or a honey one (it waits for you). */
function Count({ n, honey = false, label }) {
  return <span aria-hidden={label ? undefined : "true"} aria-label={label} style={{ flex: "none", minWidth: "18px", height: "18px", padding: "0 5px", boxSizing: "border-box", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: honey ? HONEY : "rgba(18,19,26,.1)", color: INK, fontSize: "var(--t-micro)", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{n > 99 ? "99+" : n}</span>;
}

/** A person: a round avatar with initials and a presence dot (filled: online; a ring: not). */
function PersonMark({ person, size = 24, ring = "#ECECE7" }) {
  const online = person.presence === "online";
  return (
    <span aria-hidden="true" style={{ position: "relative", flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: person.color, color: INK, font: `600 ${stepOf(Math.round(size / 2.5))}px/1 'Geist', sans-serif`, letterSpacing: "0.01em" }}>
      {person.initials}
      <span style={{ position: "absolute", right: "-2px", bottom: "-2px", width: "8px", height: "8px", boxSizing: "border-box", borderRadius: "var(--r-circle)", background: online ? "#1E9E6A" : ring, border: online ? "0" : "2px solid #8A8D96", boxShadow: `0 0 0 2px ${ring}` }} />
    </span>
  );
}

export default function Sidebar({ active = "inicio" }) {
  const store = useStore();
  const { bots = [], settings = {}, peers = null, run } = store;
  const { pathname } = useRouter();
  const current = placeId(active);
  const here = conversationPath(pathname);
  const [expert, setExpert] = useExpert();
  const [menu, setMenu] = useState(null); // "new" | "team"
  const [sheet, setSheet] = useState(null); // "chat" | "sala" | "invitar" | "aceptar"
  const [teamSheet, setTeamSheet] = useState(null); // {kind: "create" | "join" | "invite", team?} (team/TeamSheets.jsx)
  const [folded, setFoldedState] = useState(!!settings.sidebarFolded);
  const [closed, setClosed] = useState(() => readJson(GROUPS_KEY, {}));
  const [showAll, setShowAll] = useState(allRooms);
  const [showBots, setShowBots] = useState(allBots);
  // A fade where the list goes under the pinned top (Nuevo, Buscar) and over the pinned foot.
  const [fade, setFade] = useState(null);
  const measure = () => { const box = scroller.current; if (box) setFade(scrollFade({ top: box.scrollTop, height: box.scrollHeight, client: box.clientHeight })); };
  const newRef = useRef(null), teamRef = useRef(null), scroller = useRef(null);
  useEffect(() => setFoldedState(!!settings.sidebarFolded), [settings.sidebarFolded]);
  const setFolded = (v) => { setFoldedState(v); run(() => patch("/settings", { sidebarFolded: v })).catch(() => {}); };
  // /chats comes back to the conversation you had open last.
  useEffect(() => rememberConversation(pathname), [pathname]);
  // The list comes back where you left it, with the open conversation's row in view.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    box.scrollTop = scrolled;
    const row = box.querySelector("[aria-current=page]");
    if (!row) return;
    const a = row.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (a.top < b.top || a.bottom > b.bottom) row.scrollIntoView({ block: "nearest" });
  }, [folded, here]);


  // The team comes from the state (`teams`, the same list as GET /api/teams; kept live by
  // /api/events like everything else). Alone, the server sends one «solo» entry: that is no team.
  const teams = useMemo(() => realTeams(store.teams), [store.teams]);
  const joining = store.teamsPending || [];
  const team = teamHeader(teams, { bots: bots.filter((b) => b.enabled !== false).length });
  const teamRow = teams.find((t) => t.id === team.id) || null;
  const model = useMemo(() => sidebarModel(store, { team: team.id }), [store, team.id]);
  const rooms = foldRooms(model.rooms, { current: here, all: showAll });
  const canFold = showAll ? foldRooms(model.rooms, { current: here }).hidden > 0 : rooms.hidden > 0;
  const botsFold = foldBots(model.bots, { current: here, all: showBots });
  const canFoldBots = showBots ? foldBots(model.bots, { current: here }).hidden > 0 : botsFold.hidden > 0;
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const calm = reducedMotion();
  const peopleOff = !peers || peers.relay?.status === "off"; // no mailbox: nobody to invite yet
  const pinned = useMemo(() => (settings.pinned || []).map((h) => pinnedEntry(h, { bots })).filter(Boolean), [settings.pinned, bots]);

  const usage = useResource(expert ? "/usage/overview?days=1" : null);
  const today = usage?.data?.total;
  const tokensLine = expert && today ? `${new Intl.NumberFormat("es-ES", { notation: "compact" }).format(today.tokens || 0)} tokens hoy${today.cachePercent != null ? ` · caché ${today.cachePercent} %` : ""}` : null;
  const userName = settings.userName || "Tú";
  const myStatus = peers?.me ? statusText(peers.me.status?.mode && peers.me.status.mode !== "available" ? peers.me.status : null) || "Disponible" : "Ajustes y cuenta";

  const toggleGroup = (id) => setClosed((c) => { const next = { ...c, [id]: !c[id] }; writeJson(GROUPS_KEY, next); return next; });
  const toggleAll = () => { allRooms = !showAll; setShowAll(allRooms); };
  const toggleBots = () => { allBots = !showBots; setShowBots(allBots); };
  useEffect(() => {
    const box = scroller.current;
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    for (const child of box.children) ro.observe(child);
    return () => ro.disconnect();
  }, [folded, model.rooms.length, model.people.length, model.bots.length, showAll, showBots, closed]); // eslint-disable-line react-hooks/exhaustive-deps
  // The team the bar shows is kept by the server (PUT /api/teams/current), the same in every window.
  const pickTeam = (id) => {
    setMenu(null);
    teamRef.current?.querySelector("button[aria-haspopup]")?.focus();
    run(() => put("/teams/current", { id })).catch((e) => failure("No se pudo cambiar de equipo", e?.message));
  };
  const openTeamSheet = (kind) => { setMenu(null); setTeamSheet({ kind, team: teamRow }); };
  // «Nuevo chat» / «Nueva sala» open here, over whatever screen you are on. Chats' own list
  // (when it is on screen) has the same sheet and answers the event itself.
  const openNew = (kind) => {
    if (document.querySelector("[data-chats-home], [data-convlist]")) window.dispatchEvent(new CustomEvent("colmena:new-conversation", { detail: { kind } }));
    else setSheet(kind === "sala" ? "sala" : "chat");
  };
  const pick = (item) => {
    setMenu(null);
    if (item.id === "chat" || item.id === "sala") return openNew(item.id);
    navigate(item.href);
  };
  const skip = (e) => {
    e.preventDefault();
    const content = document.querySelector("[data-v2-content]");
    const target = content?.querySelector("textarea:not([disabled])") || content?.querySelector("main, [role=main]") || content;
    if (!target) return;
    if (!target.matches("textarea, input, button, a[href]") && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  };

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === "e") { e.preventDefault(); setExpert(!expert); return; }
      if (e.shiftKey) return;
      if (k === "n") { e.preventDefault(); setMenu((v) => (v === "new" ? null : "new")); return; }
      if (k === "b") { e.preventDefault(); setFolded(!folded); return; }
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); navigate(PLACES[Number(e.key) - 1].href); }
    };
    // The palette's «Nuevo chat» and old links ask for the sheet with this event.
    const onNew = (e) => { if (!document.querySelector("[data-chats-home], [data-convlist]")) setSheet(e?.detail?.kind === "sala" ? "sala" : "chat"); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("colmena:new-conversation", onNew);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("colmena:new-conversation", onNew); };
  }, [expert, folded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return undefined;
    const box = menu === "new" ? newRef : teamRef;
    const close = (e) => { if (!box.current?.contains(e.target)) setMenu(null); };
    const esc = (e) => { if (e.key === "Escape") { setMenu(null); box.current?.querySelector("button[aria-haspopup]")?.focus(); } };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    requestAnimationFrame(() => box.current?.querySelector("[role^=menuitem]")?.focus());
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc); };
  }, [menu]);
  const menuKeys = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll("[role^=menuitem]")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const width = folded ? 68 : 248;
  const noDrag = { WebkitAppRegion: "no-drag" };
  const newMenu = menu === "new" ? (
    <div role="menu" aria-label="Crear algo nuevo" onKeyDown={menuKeys} style={{ ...menuBox, top: "46px", right: folded ? "auto" : "-6px", width: folded ? "260px" : "auto" }}>
      {NEW_ITEMS.map((n) => (
        <button key={n.id} type="button" role="menuitem" onClick={() => pick(n)} className="v3-menuitem" style={{ ...menuItem, minHeight: "44px", fontWeight: "400" }}>
          <span aria-hidden="true" style={{ flex: "none", width: "28px", height: "28px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "#F1F1EC" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg></span>
          <span style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}><span style={{ fontSize: "var(--t-ui)", fontWeight: "600" }}>{n.label}</span><span style={{ fontSize: "var(--t-caption)", color: MUTED }}>{n.hint}</span></span>
        </button>
      ))}
    </div>
  ) : null;

  // The team menu (server/routes/teams.mjs): change team (PUT /api/teams/current), «Invitar al
  // equipo» (POST /api/teams/:id/invite; whoever does not administer it is told who does),
  // «Ajustes del equipo» (Equipo, where admins rename, name admins and take people out),
  // «Crear un equipo» (POST /api/teams) and «Unirme con un código» (one field for a team's, a
  // room's or a person's code). Inviting one person to talk stays on the «+» of Personas.
  const menuLine = <span aria-hidden="true" style={{ height: "1px", margin: "6px 4px", background: "rgba(18,19,26,.08)" }} />;
  const teamMenu = menu === "team" ? (
    <div role="menu" aria-label={team.solo ? "Tu Colmena" : `Equipo ${team.name}`} onKeyDown={menuKeys} style={{ ...menuBox, top: "48px", right: folded ? "auto" : "-6px", width: folded ? "260px" : "auto" }}>
      {team.others.length ? <>
        <span style={{ padding: "6px 10px 4px", fontSize: "var(--t-caption)", fontWeight: "600", color: MUTED }}>{"Cambiar de equipo"}</span>
        <button type="button" role="menuitemradio" aria-checked="true" onClick={() => setMenu(null)} className="v3-menuitem" style={{ ...menuItem, fontWeight: "600" }}><span style={ellipsis}>{team.name}</span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4 4 10-10" /></svg></button>
        {team.others.map((t) => <button key={t.id} type="button" role="menuitemradio" aria-checked="false" onClick={() => pickTeam(t.id)} className="v3-menuitem" style={menuItem}><span style={ellipsis}>{t.name}</span></button>)}
        {menuLine}
      </> : null}
      {team.solo ? null : <>
        {peopleOff ? null : <button type="button" role="menuitem" onClick={() => openTeamSheet("invite")} className="v3-menuitem" style={menuItem}>{"Invitar al equipo"}</button>}
        <a role="menuitem" href="/equipo#equipo" onClick={() => setMenu(null)} className="v3-menuitem" style={menuItem}>{team.admin ? "Ajustes del equipo" : "Ver el equipo"}</a>
        {menuLine}
      </>}
      {peopleOff ? (
        <a role="menuitem" href="/ajustes/contactos" onClick={() => setMenu(null)} className="v3-menuitem" style={menuItem}>{"Conectar con otras personas"}</a>
      ) : <>
        <button type="button" role="menuitem" onClick={() => openTeamSheet("create")} className="v3-menuitem" style={menuItem}>{team.solo ? "Crear un equipo" : "Crear otro equipo"}</button>
        <button type="button" role="menuitem" onClick={() => openTeamSheet("join")} className="v3-menuitem" style={menuItem}>{"Unirme con un código"}</button>
      </>}
      {team.solo ? <a role="menuitem" href="/equipo" onClick={() => setMenu(null)} className="v3-menuitem" style={menuItem}>{"Ver tus bots y personas"}</a> : null}
      <a role="menuitem" href="/personas/como-funciona#equipos" onClick={() => setMenu(null)} className="v3-menuitem" style={menuItem}>{"Cómo funcionan los equipos"}</a>
      {joining.length ? <>
        {menuLine}
        {joining.map((p) => (
          <a key={p.id} role="menuitem" href="/equipo#equipo" onClick={() => setMenu(null)} className="v3-menuitem" style={{ ...menuItem, alignItems: "flex-start", flexDirection: "column", gap: "1px" }}>
            <span style={{ ...ellipsis, flex: "none", maxWidth: "100%" }}>{p.name}</span>
            <span style={{ fontSize: "var(--t-caption)", fontWeight: "400", color: MUTED }}>{p.state === "refused" ? "No has podido entrar" : p.from ? "Pendiente · te invitó " + String(p.from).trim().split(/s+/)[0] : "Pendiente: has pedido entrar"}</span>
          </a>
        ))}
      </> : null}
    </div>
  ) : null;

  const groupHead = (id, label, count, addLabel, onAdd, marks) => (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "2px", marginTop: "10px" }}>
      <button type="button" onClick={() => toggleGroup(id)} aria-expanded={!closed[id]} aria-controls={`v3-group-${id}`} className="v3-hover" style={{ flex: "1", minWidth: "0", height: "28px", display: "flex", alignItems: "center", gap: "6px", padding: "0 6px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: MUTED, fontSize: "var(--t-caption)", fontWeight: "600", textAlign: "left", cursor: "pointer" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", transform: closed[id] ? "rotate(-90deg)" : "none", transition: "transform .15s ease" }}><path d="m6 9 6 6 6-6" /></svg>
        <span style={{ color: closed[id] && marks.unread ? INK : MUTED }}>{label}</span>
        <span style={{ fontWeight: "500", fontVariantNumeric: "tabular-nums" }}>{count}</span>
        <span style={{ flex: "1" }} />
        {/* Folded away, the group still says what is new inside it. */}
        {closed[id] && marks.unread ? <Count n={marks.unread} label={`${marks.unread} sin leer`} /> : null}
        {closed[id] && marks.waiting ? <Count n={marks.waiting} honey label={marks.waiting === 1 ? "1 te espera" : `${marks.waiting} te esperan`} /> : null}
      </button>
      <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} className="v3-hover" style={{ flex: "none", width: "28px", height: "28px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: MUTED, cursor: "pointer" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
    </div>
  );
  const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const empty = (text) => <span style={{ padding: "4px 10px 6px", fontSize: "var(--t-meta)", lineHeight: "1.4", color: MUTED }}>{text}</span>;
  const rowStyle = (on, h) => ({ ...rowLink, height: h + "px", ...(on ? onRow : {}) });

  const roomRow = (r) => {
    const on = r.href === here;
    return (
      <a key={r.id} href={r.href} aria-label={rowLabel("room", r)} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={rowStyle(on, 32)}>
        <span aria-hidden="true" style={{ flex: "none", width: "18px", textAlign: "center", font: "600 var(--t-ui)/1 'Geist', sans-serif", color: r.unread ? INK : MUTED }}>{"#"}</span>
        <span style={{ ...ellipsis, fontWeight: r.unread ? "700" : on ? "600" : "400", color: r.unread || on ? INK : TEXT }}>{r.title}</span>
        {r.working ? <span title={r.working === 1 ? "Un bot está trabajando aquí" : `${r.working} bots están trabajando aquí`} style={{ flex: "none", display: "inline-flex" }}>{calm ? <span aria-hidden="true" style={{ fontSize: "var(--t-caption)", color: MUTED }}>{"trabajando"}</span> : <WorkingDots />}</span> : null}
        {r.unread ? <Count n={r.unread} /> : null}
        {r.waiting ? <Count n={r.waiting} honey /> : null}
      </a>
    );
  };
  const botState = (b) => (
    <span aria-hidden="true" style={{ flex: "none", display: "flex", alignItems: "center", gap: "5px", fontSize: "var(--t-caption)", fontWeight: b.state === "working" || b.state === "waiting" ? "600" : "400", color: b.state === "working" || b.state === "waiting" ? INK : MUTED }}>
      {b.waiting ? <span style={{ width: "8px", height: "8px", borderRadius: "var(--r-circle)", background: HONEY, boxShadow: "0 0 0 1px rgba(18,19,26,.18)" }} /> : null}
      {STATE_WORD[b.state]}
    </span>
  );
  const botRow = (b) => {
    const on = b.href === here;
    const bot = { ...(botOf(b.id) || b), shape: b.shape };
    return (
      <a key={b.id} href={b.href} aria-label={rowLabel("bot", b)} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={rowStyle(on, 44)}>
        <span aria-hidden="true" style={{ flex: "none", width: "24px", height: "24px", display: "grid", placeItems: "center" }}><BotPresence bot={bot} size={20} state={calm ? "rest" : b.state === "working" || b.busy ? "work" : "rest"} /></span>
        <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ ...ellipsis, fontWeight: b.unread ? "700" : "500", color: INK }}>{b.name}</span>
            {b.unread ? <Count n={b.unread} /> : null}
            {botState(b)}
          </span>
          {b.role ? <span style={{ fontSize: "var(--t-caption)", lineHeight: "1.2", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.role}</span> : null}
        </span>
      </a>
    );
  };
  const personRow = (p) => {
    const on = p.href === here;
    return (
      <a key={p.id} href={p.href} aria-label={rowLabel("person", p)} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={rowStyle(on, 36)}>
        <PersonMark person={p} ring={on ? "#FFFFFF" : "#ECECE7"} />
        <span style={{ ...ellipsis, fontWeight: p.unread ? "700" : on ? "600" : "400", color: p.unread || on ? INK : p.presence === "online" ? TEXT : MUTED }}>{p.name}</span>
        {p.status ? <span aria-hidden="true" style={{ flex: "none", fontSize: "var(--t-caption)", color: MUTED }}>{STATUS_WORD[p.status]}</span> : null}
        {p.unread ? <Count n={p.unread} /> : null}
        {p.waiting ? <Count n={p.waiting} honey /> : null}
      </a>
    );
  };

  const places = PLACES.map((p, i) => {
    const on = p.id === current;
    const n = p.id === "inicio" ? model.waitingCount : 0;
    return (
      <a key={p.id} href={p.href} aria-current={on ? "page" : undefined} aria-label={folded ? p.label + (n ? `, ${waitingLabel(n)}` : "") : undefined} title={folded ? `${p.label} (Ctrl ${i + 1})` : undefined} className={on ? undefined : "v3-hover"} style={{ position: "relative", flex: "none", width: folded ? "44px" : "auto", height: "36px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "11px", padding: folded ? "0" : "0 10px", borderRadius: "var(--r-md)", textDecoration: "none", color: on ? INK : TEXT, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? onRow.boxShadow : "none", fontSize: "var(--t-body)", fontWeight: on ? "600" : "500" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p.icon} /></svg>
        {folded ? null : <span style={{ flex: "1" }}>{p.label}</span>}
        {n ? <span aria-label={folded ? undefined : waitingLabel(n)} aria-hidden={folded ? "true" : undefined} style={{ ...(folded ? { position: "absolute", top: "-2px", right: "2px", boxShadow: "0 0 0 2px #ECECE7" } : {}), minWidth: "20px", height: "20px", padding: "0 6px", boxSizing: "border-box", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: HONEY, color: INK, fontSize: "var(--t-caption)", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{n}</span> : null}
        {!folded && expert && !n ? <kbd style={kbd}>{`Ctrl ${i + 1}`}</kbd> : null}
      </a>
    );
  });

  // Folded: the same people and bots as avatars; rooms stay behind one «#» that unfolds the bar.
  const railTile = { position: "relative", flex: "none", width: "44px", height: "36px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-md)", background: "transparent", color: TEXT, textDecoration: "none", cursor: "pointer" };
  const railDot = (honey) => <span aria-hidden="true" style={{ position: "absolute", top: "3px", right: "5px", width: "9px", height: "9px", borderRadius: "var(--r-circle)", background: honey ? HONEY : INK, boxShadow: "0 0 0 2px #ECECE7" }} />;
  const roomsNew = { unread: sum(model.rooms, "unread"), waiting: sum(model.rooms, "waiting") };
  const rail = (
    <>
      <span aria-hidden="true" style={{ flex: "none", width: "24px", height: "1px", margin: "6px 0", background: "rgba(18,19,26,.1)" }} />
      <button type="button" onClick={() => setFolded(false)} aria-label={["Salas", `${model.rooms.length}`, roomsNew.unread ? `${roomsNew.unread} sin leer` : null, roomsNew.waiting ? "te esperan" : null, "desplegar la barra"].filter(Boolean).join(", ")} title="Salas" className="v3-hover" style={{ ...railTile, font: "600 var(--t-read)/1 'Geist', sans-serif" }}>{"#"}{roomsNew.waiting ? railDot(true) : roomsNew.unread ? railDot(false) : null}</button>
      {model.people.map((p) => {
        const on = p.href === here;
        return <a key={p.id} href={p.href} aria-label={rowLabel("person", p)} title={[p.name, p.status ? STATUS_WORD[p.status] : null].filter(Boolean).join(" · ")} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={{ ...railTile, ...(on ? onRow : {}) }}><PersonMark person={p} size={24} ring={on ? "#FFFFFF" : "#ECECE7"} />{p.waiting ? railDot(true) : p.unread ? railDot(false) : null}</a>;
      })}
      {model.bots.map((b) => {
        const on = b.href === here;
        return <a key={b.id} href={b.href} aria-label={rowLabel("bot", b)} title={`${b.name} · ${STATE_WORD[b.state]}`} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={{ ...railTile, ...(on ? onRow : {}) }}><BotPresence bot={{ ...(botOf(b.id) || b), shape: b.shape }} size={20} state={calm ? "rest" : b.state === "working" || b.busy ? "work" : "rest"} />{b.waiting ? railDot(true) : b.unread ? railDot(false) : null}</a>;
      })}
    </>
  );

  const groups = (
    <>
      {pinned.length ? <>
        <span style={{ flex: "none", padding: "14px 10px 4px", fontSize: "var(--t-caption)", fontWeight: "600", color: MUTED }}>{"Fijados"}</span>
        {pinned.map((p) => (
          <a key={p.key} href={p.href} className="v3-hover" style={rowStyle(false, 32)}>
            {p.bot ? <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center" }}><span style={{ width: "14px", height: "14px", background: p.bot.color || "#C9CBD1", clipPath: shapeOf(p.bot).clip, borderRadius: p.bot.shape === "circle" ? "24%" : shapeOf(p.bot).radius }} /></span>
              : <span aria-hidden="true" style={{ flex: "none", width: "18px", textAlign: "center", font: "600 var(--t-micro)/1 'Geist', sans-serif", color: TEXT }}>{p.glyph}</span>}
            <span style={ellipsis}>{p.label}</span>
          </a>
        ))}
      </> : null}

      {groupHead("salas", "Salas", model.rooms.length, "Nueva sala", () => openNew("sala"), roomsNew)}
      {closed.salas ? null : (
        <div id="v3-group-salas" style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {rooms.shown.map(roomRow)}
          {model.rooms.length ? null : empty("Aún no hay salas. Crea la primera con el +.")}
          {canFold ? (
            <button type="button" onClick={toggleAll} aria-expanded={showAll} className="v3-hover" style={{ flex: "none", height: "28px", display: "flex", alignItems: "center", padding: "0 10px 0 38px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: MUTED, fontSize: "var(--t-meta)", fontWeight: "500", textAlign: "left", cursor: "pointer" }}>{showAll ? "Ver menos" : `Ver todas (${model.rooms.length})`}</button>
          ) : null}
        </div>
      )}

      {groupHead("personas", "Personas", model.people.length, "Invitar a una persona", () => (peopleOff ? navigate("/ajustes/contactos") : setSheet("invitar")), { unread: sum(model.people, "unread"), waiting: sum(model.people, "waiting") })}
      {closed.personas ? null : (
        <div id="v3-group-personas" style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {model.people.map(personRow)}
          {model.people.length ? null : empty(team.solo ? "Aquí verás a las personas con las que hablas a solas. Invita a alguien con el +." : "Aún no hay mensajes directos. Escribe a alguien desde Equipo.")}
        </div>
      )}
      {groupHead("bots", "Bots", model.bots.length, "Nuevo bot", () => navigate("/equipo/nuevo"), { unread: sum(model.bots, "unread"), waiting: sum(model.bots, "waiting") })}
      {closed.bots ? null : (
        <div id="v3-group-bots" style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {botsFold.shown.map(botRow)}
          {model.bots.length ? null : empty("Aún no tienes bots. Crea el primero con el +.")}
          {canFoldBots ? (
            <button type="button" onClick={toggleBots} aria-expanded={showBots} className="v3-hover" style={{ flex: "none", height: "28px", display: "flex", alignItems: "center", padding: "0 10px 0 38px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: MUTED, fontSize: "var(--t-meta)", fontWeight: "500", textAlign: "left", cursor: "pointer" }}>{showBots ? "Ver menos" : `Ver todos (${model.bots.length})`}</button>
          ) : null}
        </div>
      )}

    </>
  );

  // «Sala» is its own small sheet (name, team or private, people, bots → POST /api/rooms).
  const sheets = teamSheet ? <TeamSheets sheet={teamSheet} onClose={() => setTeamSheet(null)} onSheet={setTeamSheet} />
    : sheet === "sala" ? <NewRoomSheet onClose={() => setSheet(null)} />
      : sheet === "chat" ? <NewConversation mode="chat" onClose={() => setSheet(null)} onPeople={(which) => setSheet(which)} />
        : sheet === "invitar" ? <InviteSheet onClose={() => setSheet(null)} />
          : sheet === "aceptar" ? <AcceptSheet onClose={() => setSheet(null)} /> : null;

  return (
    <nav aria-label="Colmena: equipo, sitios y conversaciones" data-v3-sidebar={folded ? "folded" : "open"} style={{ position: "relative", zIndex: "40", boxSizing: "border-box", flex: "none", width: width + "px", height: "100%", minHeight: "0", display: "flex", flexDirection: "column", gap: "10px", padding: "12px 12px 10px", background: "#ECECE7", borderRight: "1px solid rgba(18,19,26,.07)", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: INK, WebkitFontSmoothing: "antialiased", WebkitAppRegion: "drag", transition: "width .18s ease" }}>
      <style>{SIDEBAR_CSS}</style>
      <a href="#contenido" onClick={skip} className="v3-skip" style={noDrag}>{here ? "Ir a la conversación" : "Ir al contenido"}</a>
      <div style={{ flex: "none", display: "flex", flexDirection: folded ? "column" : "row", alignItems: "center", justifyContent: "space-between", gap: folded ? "10px" : "0", minHeight: "24px", padding: folded ? "0" : "0 4px" }}>
        <span style={{ display: "flex", alignItems: "center", height: "24px", ...noDrag }}><WindowDots inline compact={folded} /></span>
        <button type="button" onClick={() => setFolded(!folded)} aria-label={folded ? "Desplegar la barra (Ctrl B)" : "Plegar la barra (Ctrl B)"} title={folded ? "Desplegar la barra (Ctrl B)" : "Plegar la barra (Ctrl B)"} className="v3-hover" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: "#4A4D57", cursor: "pointer", ...noDrag }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15" /></svg></button>
      </div>

      <div ref={teamRef} style={{ flex: "none", position: "relative", zIndex: "6", ...noDrag }}>
        <button type="button" onClick={() => setMenu(menu === "team" ? null : "team")} aria-haspopup="menu" aria-expanded={menu === "team"} aria-label={`${team.name}, ${team.line}`} title={folded ? `${team.name} · ${team.line}` : undefined} className="v3-hover" style={{ width: "100%", minHeight: "44px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0" : "4px 6px", border: "0", borderRadius: "var(--r-md)", background: "transparent", color: INK, textAlign: "left", cursor: "pointer" }}>
          <img src="/colmena-icon-128.png" alt="" width="28" height="28" style={{ flex: "none", display: "block", width: "28px", height: "28px", filter: "drop-shadow(0 2px 4px rgba(201,120,0,.35))" }} />
          {folded ? null : <>
            <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ font: `600 ${team.solo ? "var(--t-title)" : "var(--t-lead)"}/1.1 'Bricolage Grotesque', sans-serif`, letterSpacing: "-0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.name}</span>
              <span style={{ fontSize: "var(--t-caption)", lineHeight: "1.2", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.line}</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d="m6 9 6 6 6-6" /></svg>
          </>}
        </button>
        {teamMenu}
      </div>

      <div ref={newRef} style={{ flex: "none", position: "relative", zIndex: "5", display: "flex", flexDirection: "column", gap: "8px", ...noDrag }}>
        <button type="button" onClick={() => setMenu(menu === "new" ? null : "new")} aria-expanded={menu === "new"} aria-haspopup="menu" aria-label={folded ? "Nuevo (Ctrl N)" : undefined} title={folded ? "Nuevo (Ctrl N)" : undefined} style={{ height: "40px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0" : "0 12px 0 14px", border: "0", borderRadius: "var(--r-md)", background: INK, color: "#FFFFFF", fontSize: "var(--t-body)", fontWeight: "600", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {folded ? null : <><span style={{ flex: "1", textAlign: "left" }}>{"Nuevo"}</span><kbd style={{ ...kbd, color: "#A9ACB6" }}>{"Ctrl N"}</kbd></>}
        </button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("colmena:palette"))} aria-label={folded ? "Buscar o pedir (Ctrl K)" : undefined} title={folded ? "Buscar o pedir (Ctrl K)" : undefined} style={{ height: "40px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0" : "0 12px", border: "0", borderRadius: "var(--r-md)", background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.08)", color: MUTED, fontSize: "var(--t-ui)", cursor: "pointer", textAlign: "left" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2" /></svg>
          {folded ? null : <><span style={{ flex: "1" }}>{"Buscar o pedir"}</span><kbd style={kbd}>{"Ctrl K"}</kbd></>}
        </button>
        {newMenu}
      </div>

      {/* The only part that scrolls: the places and the groups. The window never does. */}
      <div ref={scroller} onScroll={(e) => { scrolled = e.currentTarget.scrollTop; measure(); }} className="v3-scroll" style={{ flex: "1", minHeight: "0", display: "flex", flexDirection: "column", alignItems: folded ? "center" : "stretch", gap: "2px", margin: "0 -6px", padding: "2px 6px 8px", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", ...(fade ? { WebkitMaskImage: fade, maskImage: fade } : {}), ...noDrag }}>
        {places}
        {folded ? rail : groups}
      </div>

      <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: folded ? "center" : "stretch", gap: "2px", paddingTop: "8px", borderTop: "1px solid rgba(18,19,26,.08)", ...noDrag }}>
        <a href="/ajustes" aria-current={current === "ajustes" ? "page" : undefined} aria-label={`${userName}, ${myStatus}. Ajustes`} title={folded ? "Ajustes y cuenta" : undefined} className={current === "ajustes" ? undefined : "v3-hover"} style={{ height: "44px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0 6px" : "0 8px", borderRadius: "var(--r-md)", background: current === "ajustes" ? "#FFFFFF" : "transparent", color: INK, textDecoration: "none" }}>
          <span aria-hidden="true" style={{ flex: "none", width: "30px", height: "30px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "#E6E7EC", color: INK, fontSize: "var(--t-micro)", fontWeight: "600" }}>{initials(userName)}</span>
          {folded ? null : <>
            <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}><span style={{ fontSize: "var(--t-ui)", fontWeight: "600", ...ellipsis, flex: "none" }}>{userName}</span><span style={{ fontSize: "var(--t-caption)", color: MUTED, ...ellipsis, flex: "none" }}>{myStatus}</span></span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A4D57" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5" /></svg>
          </>}
        </a>
        <a href="/actividad" aria-current={current === "actividad" ? "page" : undefined} aria-label={`Actividad: ${model.summary.text}`} title={folded ? `Actividad · ${model.summary.text}` : undefined} className={current === "actividad" ? undefined : "v3-hover"} style={{ position: "relative", minHeight: "34px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0 6px" : "4px 8px 4px 14px", borderRadius: "var(--r-md)", background: current === "actividad" ? "#FFFFFF" : "transparent", color: TEXT, textDecoration: "none" }}>
          {folded ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d="M3 12h4l2.5-6 5 12 2.5-6H21" /></svg> : null}
          {folded ? (model.waitingCount ? railDot(true) : null) : (
            <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "var(--t-meta)", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.summary.text}</span>
              {tokensLine ? <span style={{ fontSize: "var(--t-caption)", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tokensLine}</span> : null}
            </span>
          )}
        </a>
        <button type="button" role="switch" aria-checked={expert} onClick={() => setExpert(!expert)} aria-label={folded ? "Modo experto (Ctrl Shift E)" : undefined} title={folded ? "Modo experto (Ctrl Shift E)" : undefined} className="v3-hover" style={{ height: "34px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0 6px" : "0 8px 0 14px", border: "0", borderRadius: "var(--r-md)", background: "transparent", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: "500", color: TEXT }}>
          {folded ? null : <span style={{ flex: "1", textAlign: "left" }}>{"Modo experto"}</span>}
          {!folded && expert ? <kbd style={{ ...kbd, fontSize: "var(--t-micro)" }}>{"Ctrl ⇧ E"}</kbd> : null}
          <span aria-hidden="true" style={{ position: "relative", flex: "none", width: "34px", height: "20px", borderRadius: "var(--r-pill)", background: expert ? INK : "#8A8D96", transition: "background .2s ease" }}><span style={{ position: "absolute", top: "2px", left: expert ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "var(--r-circle)", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)", transition: "left .2s ease" }} /></span>
        </button>
      </div>
      {/* The sheets hang from <body>: the bar is a window-drag region and would swallow their clicks. */}
      {sheets ? createPortal(sheets, document.body) : null}
    </nav>
  );
}

const SIDEBAR_CSS = `
[data-v3-sidebar] .v3-hover:hover{background:rgba(18,19,26,.05)!important}
[data-v3-sidebar] .v3-menuitem:hover,[data-v3-sidebar] .v3-menuitem:focus-visible{background:#F6F6F3!important;outline:none}
[data-v3-sidebar] :focus-visible{outline:2px solid #1F4FD1;outline-offset:2px}
[data-v3-sidebar] .v3-scroll :focus-visible{outline-offset:-2px}
[data-v3-sidebar] .v3-scroll{scrollbar-width:thin;scrollbar-color:rgba(18,19,26,.18) transparent}
[data-v3-sidebar] .v3-skip{position:absolute;z-index:60;top:8px;left:8px;padding:9px 14px;border-radius:12px;background:#12131A;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;white-space:nowrap;transform:translateY(-220%)}
[data-v3-sidebar] .v3-skip:focus{transform:none;outline:2px solid #1F4FD1;outline-offset:2px}
@keyframes v3sheet{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){[data-v3-sidebar] *{animation:none!important;transition:none!important}}
`;
