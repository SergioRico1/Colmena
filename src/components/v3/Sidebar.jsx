import BotFace from "../BotFace.jsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, useResource } from "../../lib/store.jsx";
import { navigate, useRouter } from "../../lib/router.jsx";
import { patch, put } from "../../lib/api.js";
import { WindowDots } from "../v2/Rail.jsx";
import { NewConversation } from "../v2/chat/ConvList.jsx";
import InviteSheet from "../people/InviteSheet.jsx";
import JoinSheet from "../people/JoinSheet.jsx";
import NewMessageSheet from "../people/NewMessageSheet.jsx";
import NewRoomSheet from "./team/NewRoomSheet.jsx";
import TeamSheets from "./team/TeamSheets.jsx";
import { useExpert } from "../../lib/expert.js";
import { reducedMotion } from "../../lib/motion.js";
import { statusText } from "../../lib/peers.js";
import { failure } from "../../lib/undoToast.js";
import { realTeams } from "../../lib/teams.js";
import WorkingDots from "../room/Dots.jsx";
import { PersonAvatar } from "../room/Author.jsx";
import { LogoMark, LOGO_FONT } from "../Logo.jsx";
import { C, line } from "../../lib/theme.js";
import { STATE_WORD, STATUS_WORD, conversationPath, foldBots, foldRooms, rememberConversation, rowLabel, scrollFade, sidebarModel, teamHeader, waitingLabel } from "../../lib/sidebar.js";
import { selfName } from "../../lib/ownName.js";
import { Bell, Books, Bot, ChatCircleText, CheckSquare, ChevronDown, CircleHelp, Code, Ellipsis, Gear, Hash, Hourglass, House, KeyRound, ListChecks, LockSimple, LogOut, MessageSquare, NotePencil, Pencil, Plug, Plus, Repeat, Search, Sidebar as SidebarIcon, Smiley, Target, UserPlus, UsersThree } from "../Icon.js";
import { MenuButton } from "../Menu.js";
import { signOut } from "../../lib/cloud.js";

// The Colmena sidebar, the same on every screen (docs/PLAN-equipo-y-salas.md; Colmena 4:
// design/v4/colmena-v4.html › .side). Top to bottom: the window's three dots and the wordmark,
// your team (or «Solo tú»), «Ir a…» (Ctrl K) with «Nuevo» (Ctrl N) beside it, five places
// (Ctrl 1–5), and three live groups — Salas, Personas, Bots — that fold and remember it; at the
// foot, you (your status, profile, Ajustes, Modo experto) and the bell (Actividad). Ctrl B folds
// it to a rail of icons and avatars. Honey only marks what waits for you; unread is bold with a
// neutral count. The rows come from src/lib/sidebar.js.
export const PLACES = [
  { id: "inicio", label: "Inicio", href: "/", icon: House },
  { id: "trabajo", label: "Trabajo", href: "/trabajo", icon: ListChecks },
  { id: "codigo", label: "Código", href: "/codigo", icon: Code },
  { id: "equipo", label: "Equipo", href: "/equipo", icon: UsersThree },
  { id: "biblioteca", label: "Biblioteca", href: "/biblioteca", icon: Books },
];
// Old place ids (Colmena 2) still passed by some screens. «Chats» is no longer a place: its
// screens light their own row in a group instead.
const ALIAS = { hoy: "inicio", conversaciones: "chats", rutinas: "trabajo", objetivos: "trabajo", colmena: "equipo", archivo: "biblioteca" };
export const placeId = (id) => ALIAS[id] || id;

const NEW_ITEMS = [
  { id: "chat", label: "Chat con un bot", hint: "Pregunta o encarga algo", icon: MessageSquare },
  { id: "sala", label: "Sala", hint: "Con personas y varios bots", icon: Hash },
  { id: "dm", label: "Mensaje directo", hint: "A una persona, solo vosotros dos", icon: ChatCircleText },
  { id: "tarea", label: "Tarea", hint: "Un trabajo con plan y entrega", href: "/trabajo?nueva=1", icon: CheckSquare },
  { id: "rutina", label: "Rutina", hint: "Algo que se repite solo", href: "/trabajo/rutinas?nueva=1", icon: Repeat },
  { id: "objetivo", label: "Objetivo", hint: "Una meta a largo plazo", href: "/trabajo/objetivos?nuevo=1", icon: Target },
  { id: "bot", label: "Bot", hint: "Un compañero nuevo", href: "/equipo/nuevo", icon: Bot },
  { id: "codigo", label: "Tarea de código", hint: "En uno de tus proyectos", href: "/codigo", icon: Code },
];
// «Nuevo» shows five (the most used: a chat, a room, a direct message, a task, a routine); «Más…» unfolds the rest.
export const NEW_FIRST = ["chat", "sala", "dm", "tarea", "rutina"];

// The status you set for the people you talk to (PATCH /api/peers/status), from the profile menu.
const atNextHour = (h) => { const d = new Date(); d.setDate(d.getDate() + (d.getHours() >= h ? 1 : 0)); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const STATUSES = [
  ["available", "Disponible", () => ({ mode: "available", until: null })],
  ["dnd-1h", "No molestar durante 1 hora", () => ({ mode: "dnd", until: new Date(Date.now() + 3600e3).toISOString() })],
  ["dnd", "No molestar hasta que lo quite", () => ({ mode: "dnd", until: null })],
  ["away-1", "Fuera hasta mañana", () => ({ mode: "away", until: atNextHour(9) })],
  ["away", "Fuera hasta que lo quite", () => ({ mode: "away", until: null })],
];

const font = "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif";
const kbdStyle = { display: "inline-grid", placeItems: "center", minWidth: "20px", height: "20px", padding: "0 5px", boxSizing: "border-box", borderRadius: "var(--r-xs)", background: C.sunken, border: line(), font: "500 var(--t-micro)/1 'Geist Mono', ui-monospace, monospace", color: C.text3 };
const Kbd = ({ children }) => <kbd style={kbdStyle}>{children}</kbd>;
const rowLink = { position: "relative", flex: "none", display: "flex", alignItems: "center", gap: "10px", padding: "0 8px", borderRadius: "var(--r-sm)", color: C.text2, fontSize: "var(--t-ui)", textDecoration: "none" };
const onRow = { background: C.selected, color: C.text, fontWeight: "600", boxShadow: C.shadowLift };
const ellipsis = { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const iconBtn = { flex: "none", width: "32px", height: "32px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: C.text3, cursor: "pointer" };

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
  if (href.startsWith("/codigo/")) return { key: href, href, label: decodeURIComponent(href.split("/").pop() || "Código"), glyph: true };
  return null;
}

/** A neutral count (unread: ink on light, light on dark) or a honey one (it waits for you). */
function Count({ n, honey = false, label }) {
  return <span aria-hidden={label ? undefined : "true"} aria-label={label} style={{ flex: "none", minWidth: "20px", height: "20px", padding: "0 6px", boxSizing: "border-box", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: honey ? C.honey : C.unreadBg, color: honey ? C.honeyInk : C.unreadFg, font: `600 var(--t-micro)/1 ${font}`, fontVariantNumeric: "tabular-nums" }}>{n > 99 ? "99+" : n}</span>;
}

/** A bot's role, the small tag under its name. */
const Tag = ({ children }) => <span className="v4-tag" style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>;

export default function Sidebar({ active = "inicio" }) {
  const store = useStore();
  const { bots = [], settings = {}, peers = null, run } = store;
  const { pathname } = useRouter();
  const current = placeId(active);
  const here = conversationPath(pathname);
  const [expert, setExpert] = useExpert();
  const [menu, setMenu] = useState(null); // "new" | "team" | "me": which menu is open (components/Menu.js)
  // Ctrl+K's «Nuevo…» opens this same menu (the palette shows its shortcut, Ctrl N).
  useEffect(() => {
    const open = () => setMenu("new");
    window.addEventListener("colmena:new", open);
    return () => window.removeEventListener("colmena:new", open);
  }, []);
  const [sheet, setSheet] = useState(null); // "chat" | "sala" | "dm" | "invitar" | "aceptar"
  const [inviteName, setInviteName] = useState("");
  const [teamSheet, setTeamSheet] = useState(null); // {kind: "create" | "join" | "invite", team?} (team/TeamSheets.jsx)
  const [folded, setFoldedState] = useState(!!settings.sidebarFolded);
  const [closed, setClosed] = useState(() => readJson(GROUPS_KEY, {}));
  const [showAll, setShowAll] = useState(allRooms);
  const [showBots, setShowBots] = useState(allBots);
  // A fade where the list goes under the pinned top (the places) and over the pinned foot.
  const [fade, setFade] = useState(null);
  const measure = () => { const box = scroller.current; if (box) setFade(scrollFade({ top: box.scrollTop, height: box.scrollHeight, client: box.clientHeight })); };
  const newRef = useRef(null), teamRef = useRef(null), meRef = useRef(null), scroller = useRef(null);
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
  const roomPrivate = useMemo(() => new Map((store.rooms || []).map((r) => [r.id, r.private])), [store.rooms]);

  const usage = useResource(expert ? "/usage/overview?days=1" : null);
  const today = usage?.data?.total;
  const tokensLine = expert && today ? `${new Intl.NumberFormat("es-ES", { notation: "compact" }).format(today.tokens || 0)} tokens hoy${today.cachePercent != null ? ` · caché ${today.cachePercent} %` : ""}` : null;
  const userName = selfName(store);
  const statusMode = peers?.me?.status?.mode || "available";
  const myStatus = peers?.me ? statusText(statusMode !== "available" ? peers.me.status : null) || "Disponible" : "Ajustes y cuenta";
  const me = { you: true, name: userName, color: settings.botLooks?.family?.tint || null };
  const desktop = typeof window !== "undefined" && !!window.colmenaWindow?.close;

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
    // Hosted: a direct message is with someone of your company (the company page lists them).
    if (item.id === "dm") return store.cloud ? window.location.assign("/empresa#personas") : setSheet("dm");
    navigate(item.href);
  };
  const setStatus = (s) => {
    setMenu(null);
    run(() => patch("/peers/status", s[2]())).catch((e) => failure("No se pudo cambiar tu estado", e?.message));
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
      if (k === ",") { e.preventDefault(); navigate("/ajustes"); return; }
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); navigate(PLACES[Number(e.key) - 1].href); }
    };
    // The palette's «Nuevo chat» and old links ask for the sheet with this event.
    const onNew = (e) => { if (!document.querySelector("[data-chats-home], [data-convlist]")) setSheet(e?.detail?.kind === "sala" ? "sala" : "chat"); };
    // Any screen opens the people sheets with these: «Nuevo mensaje», «Unirme con un código».
    const onDm = () => setSheet("dm");
    const onJoin = () => setSheet("aceptar");
    window.addEventListener("keydown", onKey);
    window.addEventListener("colmena:new-conversation", onNew);
    window.addEventListener("colmena:new-message", onDm);
    window.addEventListener("colmena:join", onJoin);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("colmena:new-conversation", onNew); window.removeEventListener("colmena:new-message", onDm); window.removeEventListener("colmena:join", onJoin); };
  }, [expert, folded]); // eslint-disable-line react-hooks/exhaustive-deps
  const width = folded ? 68 : 272;
  const noDrag = { WebkitAppRegion: "no-drag" };
  const opened = (which) => (v) => setMenu(v ? which : null);

  // «Nuevo» (Ctrl N): the five made most often, each with what it is for; the rest one step
  // away under «Más» (Objetivo, Bot, Tarea de código).
  const newItem = (n) => ({ label: n.label, hint: n.hint, icon: n.icon, onSelect: () => pick(n) });
  const newEntries = () => [
    ...NEW_ITEMS.filter((n) => NEW_FIRST.includes(n.id)).map(newItem),
    { group: null, items: [{ label: "Más", icon: Ellipsis, subLabel: "Crear algo más", items: NEW_ITEMS.filter((n) => !NEW_FIRST.includes(n.id)).map(newItem) }] },
  ];

  // The team menu (server/routes/teams.mjs): change team (PUT /api/teams/current), «Invitar al
  // equipo» (POST /api/teams/:id/invite; whoever does not administer it is told who does),
  // «Ajustes del equipo» (Equipo, where admins rename, name admins and take people out),
  // «Crear un equipo» (POST /api/teams) and «Unirme con un código» (one field for a team's, a
  // room's or a person's code). Inviting one person to talk stays on the «+» of Personas.
  const teamEntries = () => [
    team.others.length ? { group: "Cambiar de equipo", items: [
      { label: team.name, radio: "team", checked: true, onSelect: () => {} },
      ...team.others.map((t) => ({ label: t.name, radio: "team", checked: false, onSelect: () => pickTeam(t.id) })),
    ] } : null,
    team.solo ? null : { group: null, items: [
      peopleOff ? null : { label: "Invitar al equipo", icon: UserPlus, onSelect: () => openTeamSheet("invite") },
      { label: team.admin ? "Ajustes del equipo" : "Ver el equipo", icon: team.admin ? Gear : UsersThree, href: "/equipo#equipo" },
    ] },
    { group: null, items: peopleOff
      ? [{ label: "Conectar con otras personas", icon: Plug, href: "/ajustes/contactos" }]
      : [
        { label: team.solo ? "Crear un equipo" : "Crear otro equipo", icon: Plus, onSelect: () => openTeamSheet("create") },
        { label: "Unirme con un código", icon: KeyRound, onSelect: () => openTeamSheet("join") },
      ] },
    { group: null, items: [
      team.solo ? { label: "Ver tus bots y personas", icon: UsersThree, href: "/equipo" } : null,
      { label: "Cómo funcionan los equipos", icon: CircleHelp, href: "/personas/como-funciona#equipos" },
    ] },
    joining.length ? { group: "Pendientes", items: joining.map((p) => ({ label: p.name, icon: Hourglass, href: "/equipo#equipo", hint: p.state === "refused" ? "No has podido entrar" : p.from ? "Te invitó " + String(p.from).trim().split(/\s+/)[0] : "Has pedido entrar" })) } : null,
  ];

  // Your menu (design/v4 › .menu): who you are and your status, «Definir estado ›» (what the people
  // you talk to see; only with a mailbox), «Editar perfil» (your name, Ajustes › General), «Ajustes»
  // (Ctrl ,) and «Modo experto» (Ctrl Mayús E). Colmena has no account to sign out of: on the
  // desktop the last item is «Cerrar Colmena» (the window's own red dot, said in words).
  const meHeader = (
    <>
      <PersonAvatar person={me} size={40} ring={C.raised} presence={peers?.me ? (statusMode === "away" ? "offline" : "online") : null} />
      <span style={{ minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontWeight: "600", fontSize: "var(--t-ui)", ...ellipsis, flex: "none" }}>{userName}</span>
        <span style={{ fontSize: "var(--t-caption)", color: C.text3, ...ellipsis, flex: "none" }}>{peers?.me ? myStatus : store.cloud ? store.cloud.workspace?.name || "Tu empresa" : "Solo en este ordenador"}</span>
      </span>
    </>
  );
  const meEntries = () => [
    { group: null, items: [
      peers?.me && !peopleOff ? { label: "Definir estado", icon: Smiley, subLabel: "Tu estado", items: STATUSES.map((s) => ({ label: s[1], radio: "status", checked: s[0] === statusMode, onSelect: () => setStatus(s) })) } : null,
      { label: "Editar perfil", icon: Pencil, href: "/ajustes/general#tu-nombre" },
      { label: "Ajustes", icon: Gear, href: "/ajustes", shortcut: "Ctrl+," },
      { label: "Modo experto", icon: Code, checked: !!expert, shortcut: "Ctrl+Mayús+E", onSelect: () => setExpert(!expert) },
    ] },
    desktop ? { group: null, items: [{ label: "Cerrar Colmena", icon: LogOut, onSelect: () => window.colmenaWindow.close() }] } : null,
    // Hosted (src/lib/cloud.js): your company and its people, and signing out.
    store.cloud ? { group: null, items: [
      { label: "Empresa y personas", icon: UsersThree, onSelect: () => window.location.assign("/empresa") },
      { label: "Cerrar sesión", icon: LogOut, onSelect: () => signOut() },
    ] } : null,
  ];

  const groupHead = (id, label, count, addLabel, onAdd, marks) => (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "2px", margin: "10px 0 2px" }}>
      <button type="button" onClick={() => toggleGroup(id)} aria-expanded={!closed[id]} aria-controls={`v3-group-${id}`} className="v4-ghead" style={{ flex: "1", minWidth: "0", height: "28px", display: "flex", alignItems: "center", gap: "4px", padding: "0 4px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: C.text3, font: `600 var(--t-caption)/1 ${font}`, textAlign: "left", cursor: "pointer" }}>
        <ChevronDown size={12} weight="bold" style={{ flex: "none", transform: closed[id] ? "rotate(-90deg)" : "none", transition: "transform .15s ease" }} />
        <span style={{ color: closed[id] && marks.unread ? C.text : undefined }}>{label}</span>
        {closed[id] ? <span style={{ fontWeight: "500", fontVariantNumeric: "tabular-nums" }}>{"· " + count}</span> : null}
        <span style={{ flex: "1" }} />
        {/* Folded away, the group still says what is new inside it. */}
        {closed[id] && marks.unread ? <Count n={marks.unread} label={`${marks.unread} sin leer`} /> : null}
        {closed[id] && marks.waiting ? <Count n={marks.waiting} honey label={marks.waiting === 1 ? "1 te espera" : `${marks.waiting} te esperan`} /> : null}
      </button>
      <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} className="v3-hover" style={{ ...iconBtn, width: "26px", height: "26px" }}><Plus size={15} /></button>
    </div>
  );
  const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const empty = (text) => <span style={{ padding: "4px 8px 6px", fontSize: "var(--t-meta)", lineHeight: "1.4", color: C.text3 }}>{text}</span>;
  const rowStyle = (on, h) => ({ ...rowLink, minHeight: h + "px", ...(on ? onRow : {}) });
  const moreRow = (onClick, open, text) => (
    <button type="button" onClick={onClick} aria-expanded={open} className="v3-hover" style={{ ...rowLink, minHeight: "32px", border: "0", background: "transparent", color: C.text3, fontSize: "var(--t-meta)", textAlign: "left", cursor: "pointer" }}>
      <span aria-hidden="true" style={{ flex: "none", width: "20px", display: "grid", placeItems: "center" }}><Ellipsis size={16} /></span>{text}
    </button>
  );

  const roomRow = (r) => {
    const on = r.href === here;
    // A lock: only you and your bots (no share); «#»: a room with people.
    const lock = roomPrivate.get(r.id) !== false && !r.withPeople;
    const RoomIcon = lock ? LockSimple : Hash;
    return (
      <a key={r.id} href={r.href} aria-label={rowLabel("room", r)} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={rowStyle(on, 32)}>
        <RoomIcon size={16} style={{ flex: "none", width: "20px", color: r.unread || on ? C.text : C.text3 }} />
        <span style={{ ...ellipsis, fontWeight: r.unread ? "700" : on ? "600" : "400", color: r.unread || on ? C.text : C.text2 }}>{r.title}</span>
        {r.working ? <span title={r.working === 1 ? "Un bot está trabajando aquí" : `${r.working} bots están trabajando aquí`} style={{ flex: "none", display: "inline-flex" }}>{calm ? <span aria-hidden="true" style={{ fontSize: "var(--t-caption)", color: C.text3 }}>{"trabajando"}</span> : <WorkingDots />}</span> : null}
        {r.unread ? <Count n={r.unread} /> : null}
        {r.waiting ? <Count n={r.waiting} honey /> : null}
      </a>
    );
  };
  // A bot's state on the right of its row: «te espera» is the honey chip; the rest are words.
  const botState = (b) => (b.waiting || b.state === "waiting"
    ? <span aria-hidden="true" style={{ flex: "none", height: "20px", display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: "var(--r-pill)", background: C.honey, color: C.honeyInk, fontSize: "var(--t-caption)", fontWeight: "600", whiteSpace: "nowrap" }}>{STATE_WORD.waiting}</span>
    : <span aria-hidden="true" style={{ flex: "none", fontSize: "var(--t-caption)", color: b.state === "paused" ? C.text4 : C.text3, whiteSpace: "nowrap" }}>{STATE_WORD[b.busy ? "working" : b.state]}</span>);
  const faceState = (b) => (b.state === "working" || b.busy ? "work" : b.waiting || b.state === "waiting" ? "wait" : b.state === "paused" ? "pause" : "rest");
  const botRow = (b) => {
    const on = b.href === here;
    const bot = { ...(botOf(b.id) || b), shape: b.shape };
    return (
      <a key={b.id} href={b.href} aria-label={rowLabel("bot", b)} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={{ ...rowStyle(on, 44), padding: "4px 8px", fontWeight: "400" }}>
        <BotFace bot={bot} size={32} state={faceState(b)} decorative />
        <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "3px" }}>
          <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: "1.1", fontWeight: b.unread ? "700" : "500", color: C.text }}>{b.name}</span>
          {b.role ? <Tag>{b.role}</Tag> : null}
        </span>
        {b.unread ? <Count n={b.unread} /> : null}
        {botState(b)}
      </a>
    );
  };
  const personRow = (p) => {
    const on = p.href === here;
    const away = p.presence !== "online";
    return (
      <a key={p.id} href={p.href} aria-label={rowLabel("person", p)} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={rowStyle(on, 36)}>
        <PersonAvatar person={p} size={24} ring={on ? C.selected : C.sidebar} presence={p.presence} />
        <span style={{ ...ellipsis, fontWeight: p.unread ? "700" : on ? "600" : "400", color: p.unread || on ? C.text : away ? C.text3 : C.text2 }}>{p.name}</span>
        {p.unread ? <Count n={p.unread} /> : p.status ? <span aria-hidden="true" style={{ flex: "none", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--t-caption)", color: C.text3 }}>{STATUS_WORD[p.status]}</span> : null}
        {p.waiting ? <Count n={p.waiting} honey /> : null}
      </a>
    );
  };

  const places = PLACES.filter((p) => !store.cloud?.hidden?.includes(p.id)).map((p, i) => {
    const on = p.id === current;
    const n = p.id === "inicio" ? model.waitingCount : 0;
    return (
      <a key={p.id} href={p.href} aria-current={on ? "page" : undefined} aria-label={folded ? p.label + (n ? `, ${waitingLabel(n)}` : "") : undefined} title={folded ? `${p.label} (Ctrl ${i + 1})` : undefined} className={on ? undefined : "v3-hover"} style={{ ...rowLink, width: folded ? "44px" : "auto", minHeight: "32px", justifyContent: folded ? "center" : "flex-start", padding: folded ? "0" : "0 8px", ...(on ? onRow : {}) }}>
        <p.icon size={18} active={on} style={{ flex: "none", width: "20px", color: on ? C.text : C.text3 }} />
        {folded ? null : <span style={ellipsis}>{p.label}</span>}
        {n ? <span aria-label={folded ? undefined : waitingLabel(n)} aria-hidden={folded ? "true" : undefined} style={{ ...(folded ? { position: "absolute", top: "-4px", right: "0", boxShadow: `0 0 0 2px ${C.sidebar}` } : {}), minWidth: "20px", height: "20px", padding: "0 6px", boxSizing: "border-box", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: C.honey, color: C.honeyInk, font: `600 var(--t-micro)/1 ${font}`, fontVariantNumeric: "tabular-nums" }}>{n}</span> : null}
        {!folded && expert && !n ? <span style={{ display: "flex", gap: "3px" }}><Kbd>{"Ctrl"}</Kbd><Kbd>{String(i + 1)}</Kbd></span> : null}
      </a>
    );
  });

  // Folded: the same people and bots as avatars; rooms stay behind one «#» that unfolds the bar.
  const railTile = { position: "relative", flex: "none", width: "44px", height: "40px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: C.text2, textDecoration: "none", cursor: "pointer" };
  const railDot = (honey) => <span aria-hidden="true" style={{ position: "absolute", top: "3px", right: "5px", width: "9px", height: "9px", borderRadius: "var(--r-circle)", background: honey ? C.honey : C.unreadBg, boxShadow: `0 0 0 2px ${C.sidebar}` }} />;
  const roomsNew = { unread: sum(model.rooms, "unread"), waiting: sum(model.rooms, "waiting") };
  const rail = (
    <>
      <button type="button" onClick={() => setFolded(false)} aria-label={["Salas", `${model.rooms.length}`, roomsNew.unread ? `${roomsNew.unread} sin leer` : null, roomsNew.waiting ? "te esperan" : null, "desplegar la barra"].filter(Boolean).join(", ")} title="Salas" className="v3-hover" style={railTile}><Hash size={18} />{roomsNew.waiting ? railDot(true) : roomsNew.unread ? railDot(false) : null}</button>
      {model.people.map((p) => {
        const on = p.href === here;
        return <a key={p.id} href={p.href} aria-label={rowLabel("person", p)} title={[p.name, p.status ? STATUS_WORD[p.status] : null].filter(Boolean).join(" · ")} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={{ ...railTile, ...(on ? onRow : {}) }}><PersonAvatar person={p} size={28} ring={on ? C.selected : C.sidebar} presence={p.presence} />{p.waiting ? railDot(true) : p.unread ? railDot(false) : null}</a>;
      })}
      {model.bots.map((b) => {
        const on = b.href === here;
        return <a key={b.id} href={b.href} aria-label={rowLabel("bot", b)} title={`${b.name} · ${STATE_WORD[b.state]}`} aria-current={on ? "page" : undefined} className={on ? undefined : "v3-hover"} style={{ ...railTile, ...(on ? onRow : {}) }}><BotFace bot={{ ...(botOf(b.id) || b), shape: b.shape }} size={32} state={faceState(b)} decorative />{b.waiting ? railDot(true) : b.unread ? railDot(false) : null}</a>;
      })}
    </>
  );

  const groups = (
    <>
      {pinned.length ? <>
        <span style={{ flex: "none", padding: "12px 4px 2px", font: `600 var(--t-caption)/1 ${font}`, color: C.text3 }}>{"Fijados"}</span>
        {pinned.map((p) => (
          <a key={p.key} href={p.href} className="v3-hover" style={rowStyle(false, 32)}>
            {p.bot ? <BotFace bot={p.bot} size={20} decorative /> : <Code size={16} style={{ flex: "none", width: "20px", color: C.text3 }} />}
            <span style={ellipsis}>{p.label}</span>
          </a>
        ))}
      </> : null}

      {groupHead("salas", "Salas", model.rooms.length, "Nueva sala", () => openNew("sala"), roomsNew)}
      {closed.salas ? null : (
        <div id="v3-group-salas" style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {rooms.shown.map(roomRow)}
          {model.rooms.length ? null : empty("Aún no hay salas. Crea la primera con el +.")}
          {canFold ? moreRow(toggleAll, showAll, showAll ? "Ver menos" : `Ver todas · ${model.rooms.length}`) : null}
        </div>
      )}

      {groupHead("personas", "Personas", model.people.length, "Nuevo mensaje", () => setSheet("dm"), { unread: sum(model.people, "unread"), waiting: sum(model.people, "waiting") })}
      {closed.personas ? null : (
        <div id="v3-group-personas" style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {model.people.map(personRow)}
          {model.people.length ? null : <span style={{ padding: "4px 8px 6px", fontSize: "var(--t-meta)", lineHeight: "1.4", color: C.text3 }}>{"Tus mensajes directos aparecen aquí. "}<button type="button" onClick={() => setSheet("dm")} style={{ padding: "0", border: "0", background: "transparent", color: C.text2, font: "inherit", fontWeight: "600", textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer" }}>{"Nuevo mensaje"}</button></span>}
        </div>
      )}
      {groupHead("bots", "Bots", model.bots.length, "Nuevo bot", () => navigate("/equipo/nuevo"), { unread: sum(model.bots, "unread"), waiting: sum(model.bots, "waiting") })}
      {closed.bots ? null : (
        <div id="v3-group-bots" style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {botsFold.shown.map(botRow)}
          {model.bots.length ? null : empty("Aún no tienes bots. Crea el primero con el +.")}
          {canFoldBots ? moreRow(toggleBots, showBots, showBots ? "Ver menos" : `Ver todos · ${model.bots.length}`) : null}
        </div>
      )}
    </>
  );

  // «Solo tú»: your own Colmena, its mark in the tile. A team: its initial on an ink tile.
  const tile = team.solo
    ? <span aria-hidden="true" style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: C.raised, border: line() }}><LogoMark size={22} /></span>
    : <span aria-hidden="true" style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: C.text, color: C.app, font: "700 var(--t-read)/1 'Bricolage Grotesque', 'Geist', sans-serif" }}>{[...String(team.name || "E")][0].toUpperCase()}</span>;

  // «Ir a…» (the palette) and «Nuevo» beside it.
  const findRow = (
    <div ref={newRef} style={{ flex: "none", position: "relative", zIndex: "5", display: "flex", flexDirection: folded ? "column" : "row", alignItems: "center", gap: "6px", margin: folded ? "0 0 8px" : "0 10px 10px", ...noDrag }}>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("colmena:palette"))} aria-label={folded ? "Ir a… o pedir (Ctrl K)" : "Ir a… o pedir (Ctrl K)"} title={folded ? "Ir a… (Ctrl K)" : undefined} className="v4-goto" style={{ flex: folded ? "none" : "1", width: folded ? "40px" : "auto", minWidth: "0", height: "34px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "8px", padding: folded ? "0" : "0 8px 0 10px", border: line(), borderRadius: "var(--r-sm)", background: C.raised, color: C.text4, fontSize: "var(--t-ui)", cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}>
        <Search size={16} style={{ flex: "none", color: C.text3 }} />
        {folded ? null : <><span style={ellipsis}>{"Ir a…"}</span><span aria-hidden="true" style={{ display: "flex", gap: "3px" }}><Kbd>{"Ctrl"}</Kbd><Kbd>{"K"}</Kbd></span></>}
      </button>
      <MenuButton label="Nuevo (Ctrl N)" menuLabel="Crear algo nuevo" items={newEntries} open={menu === "new"} onOpenChange={opened("new")} placement={folded ? "bottom-start" : "bottom-end"} className="v4-goto" style={{ ...iconBtn, width: folded ? "40px" : "34px", height: "34px", border: line(), background: C.raised, color: C.text2, boxSizing: "border-box" }} openStyle={{ border: `1px solid ${C.lineStrong}` }}>
        <NotePencil size={18} />
      </MenuButton>
    </div>
  );

  // The sheets hang from <body>: the bar is a window-drag region and would swallow their clicks.
  const sheets = teamSheet ? <TeamSheets sheet={teamSheet} onClose={() => setTeamSheet(null)} onSheet={setTeamSheet} />
    : sheet === "sala" ? <NewRoomSheet onClose={() => setSheet(null)} />
      : sheet === "chat" ? <NewConversation mode="chat" onClose={() => setSheet(null)} onPeople={(which) => setSheet(which)} />
        : sheet === "dm" ? <NewMessageSheet onClose={() => setSheet(null)} onInvite={(name) => { setInviteName(name || ""); setSheet("invitar"); }} />
          : sheet === "invitar" ? <InviteSheet initialName={inviteName} onClose={() => { setSheet(null); setInviteName(""); }} />
            : sheet === "aceptar" ? <JoinSheet onClose={() => setSheet(null)} /> : null;

  const activityLabel = `Actividad: ${model.summary.text}`;
  return (
    <nav aria-label="Colmena: equipo, sitios y conversaciones" data-v3-sidebar={folded ? "folded" : "open"} style={{ position: "relative", zIndex: "40", boxSizing: "border-box", flex: "none", width: width + "px", height: "100%", minHeight: "0", display: "flex", flexDirection: "column", alignItems: folded ? "center" : "stretch", background: C.sidebar, borderRight: line(), fontFamily: font, color: C.text, WebkitFontSmoothing: "antialiased", WebkitAppRegion: "drag", transition: "width .18s ease", "--c-cut": C.sidebar }}>
      <style>{SIDEBAR_CSS}</style>
      <a href="#contenido" onClick={skip} className="v3-skip" style={noDrag}>{here ? "Ir a la conversación" : "Ir al contenido"}</a>
      {/* The title strip: the window's dots, the wordmark and «Plegar». It never scrolls. */}
      <div style={{ flex: "none", height: folded ? "auto" : "44px", display: "flex", flexDirection: folded ? "column" : "row", alignItems: "center", gap: "10px", padding: folded ? "14px 0 8px" : "0 10px 0 14px" }}>
        <span style={{ display: "flex", alignItems: "center", ...noDrag }}><WindowDots inline compact={folded} /></span>
        {folded ? null : <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: "7px", marginLeft: "6px" }}><LogoMark size={20} /><b style={{ font: `800 15px/1 ${LOGO_FONT}`, letterSpacing: "-0.02em", color: C.text }}>{"Colmena"}</b></span>}
        {folded ? null : <span style={{ flex: "1" }} />}
        <button type="button" onClick={() => setFolded(!folded)} aria-label={folded ? "Desplegar la barra (Ctrl B)" : "Plegar la barra (Ctrl B)"} title={folded ? "Desplegar la barra (Ctrl B)" : "Plegar la barra (Ctrl B)"} className="v3-hover" style={{ ...iconBtn, ...noDrag }}><SidebarIcon size={18} /></button>
      </div>

      <div ref={teamRef} style={{ flex: "none", position: "relative", zIndex: "6", margin: folded ? "0 0 8px" : "2px 10px 8px", ...noDrag }}>
        <MenuButton label={`${team.name}, ${team.line}`} showTitle={false} title={folded ? `${team.name} · ${team.line}` : undefined} menuLabel={team.solo ? "Tu Colmena" : `Equipo ${team.name}`} items={teamEntries} open={menu === "team"} onOpenChange={opened("team")} placement="bottom-start" openStyle={{ background: C.sidebarHover }}
          className="v3-hover" style={{ width: folded ? "44px" : "100%", minHeight: "46px", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "0" : "6px 8px", border: "0", borderRadius: "var(--r-md)", background: "transparent", color: C.text, textAlign: "left", cursor: "pointer", boxSizing: "border-box" }}>
          {tile}
          {folded ? null : <>
            <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontWeight: "600", fontSize: "var(--t-body)", lineHeight: "1.2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.name}</span>
              <span style={{ fontSize: "var(--t-caption)", lineHeight: "1.3", color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.line}</span>
            </span>
            <ChevronDown size={16} style={{ flex: "none", color: C.text3 }} />
          </>}
        </MenuButton>
      </div>

      {findRow}

      <nav aria-label="Sitios" style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: folded ? "center" : "stretch", gap: "1px", padding: folded ? "0 0 8px" : "0 10px 8px", ...noDrag }}>{places}</nav>

      {/* The only part that scrolls: the groups. The window never does. */}
      <div ref={scroller} onScroll={(e) => { scrolled = e.currentTarget.scrollTop; measure(); }} className="v3-scroll" style={{ flex: "1", minHeight: "0", alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: folded ? "center" : "stretch", gap: folded ? "2px" : "0", padding: folded ? "8px 0 10px" : "4px 10px 10px", borderTop: line(), overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", ...(fade ? { WebkitMaskImage: fade, maskImage: fade } : {}), ...noDrag }}>
        {folded ? rail : groups}
      </div>

      {/* You: your name and status (the menu), and the bell (Actividad). */}
      <div ref={meRef} style={{ position: "relative", flex: "none", alignSelf: "stretch", display: "flex", flexDirection: folded ? "column" : "row", alignItems: "center", gap: folded ? "4px" : "10px", padding: folded ? "8px 0 10px" : "10px 10px 12px", borderTop: line(), ...noDrag }}>
        <MenuButton label={`${userName}, ${myStatus}. Tu perfil y ajustes`} showTitle={false} title={folded ? `${userName} · ${myStatus}` : undefined} menuLabel="Tu perfil" items={meEntries} header={meHeader} open={menu === "me"} onOpenChange={opened("me")} placement="top-start" openStyle={{ background: C.sidebarHover }}
          className="v3-hover" style={{ flex: folded ? "none" : "1", minWidth: "0", display: "flex", alignItems: "center", justifyContent: folded ? "center" : "flex-start", gap: "10px", padding: folded ? "4px" : "5px 6px", border: "0", borderRadius: "var(--r-md)", background: current === "ajustes" ? C.sidebarHover : "transparent", color: C.text, textAlign: "left", cursor: "pointer" }}>
          <PersonAvatar person={me} size={32} ring={C.sidebar} presence={peers?.me ? (statusMode === "away" ? "offline" : "online") : null} />
          {folded ? null : (
            <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "1px" }}>
              <span style={{ fontSize: "var(--t-ui)", fontWeight: "600", lineHeight: "1.2", ...ellipsis, flex: "none" }}>{userName}</span>
              <span style={{ fontSize: "var(--t-caption)", color: C.text3, ...ellipsis, flex: "none" }}>{tokensLine || myStatus}</span>
            </span>
          )}
        </MenuButton>
        <a href="/actividad" aria-current={current === "actividad" ? "page" : undefined} aria-label={activityLabel} title={`Actividad · ${model.summary.text}`} className="v3-hover" style={{ ...iconBtn, position: "relative", color: current === "actividad" ? C.text : C.text3, background: current === "actividad" ? C.selected : "transparent" }}>
          <Bell size={18} active={current === "actividad"} />
          {model.waitingCount ? <span aria-hidden="true" style={{ position: "absolute", top: "5px", right: "6px", width: "8px", height: "8px", borderRadius: "var(--r-circle)", background: C.honey, boxShadow: `0 0 0 2px ${C.sidebar}` }} /> : null}
        </a>
      </div>
      {sheets ? createPortal(sheets, document.body) : null}
    </nav>
  );
}

const SIDEBAR_CSS = `
[data-v3-sidebar] .v3-hover:hover{background:var(--c-sidebar-hover)!important;color:var(--c-text)!important}
[data-v3-sidebar] .v4-ghead:hover{color:var(--c-text)!important}
[data-v3-sidebar] .v4-goto:hover{border-color:var(--c-line-strong)!important}
[data-v3-sidebar] :focus-visible{outline:2px solid var(--c-focus);outline-offset:2px}
[data-v3-sidebar] .v3-scroll :focus-visible{outline-offset:-2px}
[data-v3-sidebar] .v3-scroll{scrollbar-width:thin;scrollbar-color:var(--c-scroll) transparent}
[data-theme="dark"] [data-v3-sidebar] a[aria-current="page"]{box-shadow:none!important}
[data-v3-sidebar] .v3-skip{position:absolute;z-index:60;top:8px;left:8px;padding:9px 14px;border-radius:12px;background:var(--c-btn);color:var(--c-btn-text);font-size:var(--t-ui);font-weight:600;text-decoration:none;white-space:nowrap;transform:translateY(-220%)}
[data-v3-sidebar] .v3-skip:focus{transform:none;outline:2px solid var(--c-focus);outline-offset:2px}
@keyframes v3sheet{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){[data-v3-sidebar] *{animation:none!important;transition:none!important}}
`;
