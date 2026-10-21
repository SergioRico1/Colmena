import { bump } from "../lib/motion.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefetch, useStore } from "../lib/store.jsx";
import { patch } from "../lib/api.js";
import { Archive, Ellipsis, Plus } from "lucide-react";
import Logo from "./Logo.jsx";
import WorkingDots from "./room/Dots.jsx";
import { avatarStyle, faceOf, initial } from "../lib/bots.js";
import { roomUrl, isRoom, needsYou, waitingOnYou, orderRooms, moveId } from "../lib/format.js";

// The same sidebar on every screen (as in Slack): what you are looking at changes, the
// map never does. Built from the mockups' parts (design/*.dc.html): nav items, «Salas»
// and «Tu equipo» lists, account row. Rooms that wait for you go first and stand out;
// each bot says in words whether it works or waits for you (free bots stay quiet).
// active: 'inicio'|'bandeja'|'misiones'|'biblioteca'|'automatizaciones'|'equipo'|'ajustes'|null
// (`variant` is accepted for older call sites and no longer changes the layout.)
const MAX_ROOMS = 8;
const plus = <Plus size={14} strokeWidth={2.4} aria-hidden="true" />;
const sectionTitle = { font: "500 11px/1 'Geist Mono', monospace", color: "#9DA2B0", letterSpacing: "0.06em", textTransform: "uppercase" };
const quietRow = { display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: "0 12px", borderRadius: "10px", color: "#9DA2B0", fontSize: "13px" };
const ROOM_TYPE = "application/x-colmena-room";
// Hovering or focusing a room loads it ahead: opening it is instant (OpenClaw warm-up).
const warm = (m) => ({ onMouseEnter: () => prefetch("/missions/" + m.id), onFocus: () => prefetch("/missions/" + m.id) });
const SEEN_KEY = "colmena:rooms-seen";
// The first time, everything up to now counts as seen (no wall of old green dots).
function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "null");
    if (v && typeof v === "object") return v;
  } catch {}
  const fresh = { __since: new Date().toISOString() };
  saveSeen(fresh);
  return fresh;
}
function saveSeen(v) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch {} }
const COUNTS_KEY = "colmena:sidebar-counts";
const ROW_WIDTHS = ["62%", "48%", "70%", "54%", "40%"];
/** A dark placeholder row with the height of a room or bot row. */
function SkeletonRow({ avatar, width }) {
  return (
    <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "0 12px" }}>
      <span className="colmena-skeleton colmena-skeleton--dark" style={avatar ? { width: "22px", height: "22px", borderRadius: "6px", flex: "none" } : { width: "10px", height: "12px", borderRadius: "3px", flex: "none" }} />
      <span className="colmena-skeleton colmena-skeleton--dark" style={{ height: "10px", width, borderRadius: "5px" }} />
    </span>
  );
}
const addIcon = { width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", border: "1px dashed #3A3E4B", borderRadius: "6px" };

/** The newest sentence of a text being written, without code (≤ 120 characters). */
export function lastSentence(text) {
  const clean = String(text || "").replace(/```[\s\S]*?(```|$)/g, " ").replace(/[*_`#>|]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const parts = clean.split(/(?<=[.!?…:])\s+/).filter((p) => p.length > 3);
  const last = parts.at(-1) || clean;
  return last.length > 120 ? "…" + last.slice(-119) : last;
}

/** Changes at most every `ms` (OpenClaw sidebar narration: one update per 2 s). */
function useThrottled(value, ms) {
  const [shown, setShown] = useState(value);
  const at = useRef(0);
  useEffect(() => {
    if (value === shown) return undefined;
    const wait = Math.max(0, ms - (Date.now() - at.current));
    const t = setTimeout(() => { at.current = Date.now(); setShown(value); }, wait);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

/** Under a room at work: what its bot says it is doing, or the latest thing it wrote. */
function RoomNarration({ mission, live, bots }) {
  const writing = Object.values(live || {}).filter((l) => l.mission === mission.id && l.text).at(-1);
  const who = (id) => bots.find((b) => b.id === id)?.name;
  const raw = mission.narration?.text
    ? (who(mission.narration.botId) ? who(mission.narration.botId) + ": " : "") + mission.narration.text
    : writing ? (who(writing.botId) ? who(writing.botId) + ": " : "") + lastSentence(writing.text)
      : mission.activityLine || "";
  const line = useThrottled(raw, 2000);
  if (!line) return null;
  return <span key={line} className="c-phrase" style={{ display: "block", padding: "0 12px 6px 32px", marginTop: "-6px", fontSize: "12px", lineHeight: "1.35", color: "#8C91A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</span>;
}

export default function Sidebar({ active = null, activeRoom = null, activeBot = null }) {
  const { bots, missions, approvals, settings, people, ready, live } = useStore();
  const me = (people || []).find((p) => p.self);
  const pending = waitingOnYou(approvals).length;
  const open = missions.filter((m) => !["completed", "cancelled"].includes(m.status) && !m.conversation);
  // Snoozed and archived rooms leave the list (the one you have open stays).
  const away = (m) => m.archived || (m.snoozedUntil && Date.parse(m.snoozedUntil) > Date.now());
  const roomList = missions.filter(isRoom).reverse();
  const allRooms = roomList.filter((m) => !away(m) || m.id === activeRoom);
  const tucked = roomList.length - allRooms.length;
  // Your order once you drag a room (until then, rooms that wait for you go first). Rooms
  // that wait for you and the open one always show, even past the first eight.
  const [localOrder, setLocalOrder] = useState(null);
  const savedOrder = settings?.roomOrder || null;
  useEffect(() => setLocalOrder(null), [JSON.stringify(savedOrder)]);
  const ordered = orderRooms(allRooms, localOrder || savedOrder);
  const rooms = ordered.slice(0, MAX_ROOMS);
  for (const m of ordered.slice(MAX_ROOMS)) if (needsYou(m) || m.id === activeRoom) rooms.push(m);
  const [dragging, setDragging] = useState(null);
  const [drop, setDrop] = useState(null); // { id, after }
  // After a drop the other rooms glide to their new place (FLIP: first, last, invert, play).
  const rowRefs = useRef({});
  const before = useRef(null);
  const orderKey = ordered.map((m) => m.id).join();
  useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    if (!first || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    for (const [id, top] of Object.entries(first)) {
      const el = rowRefs.current[id];
      if (!el) continue;
      const delta = top - el.getBoundingClientRect().top;
      if (!delta) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
        el.style.transform = "";
      });
    }
  }, [orderKey]);
  const reorder = (id, target, after) => {
    const next = moveId(ordered.map((m) => m.id), id, target, after);
    if (next.join() === ordered.map((m) => m.id).join()) return;
    before.current = Object.fromEntries(Object.entries(rowRefs.current).filter(([, el]) => el).map(([k, el]) => [k, el.getBoundingClientRect().top]));
    setLocalOrder(next);
    patch("/settings", { roomOrder: next }).catch(() => setLocalOrder(null));
  };
  // Drag a room to reorder it: the row itself is the drag image (never the link's URL).
  const dragProps = (m) => ({
    ref: (el) => { rowRefs.current[m.id] = el; },
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.clearData();
      e.dataTransfer.setData(ROOM_TYPE, m.id);
      e.dataTransfer.effectAllowed = "move";
      const r = e.currentTarget.getBoundingClientRect();
      e.dataTransfer.setDragImage(e.currentTarget, e.clientX - r.left, e.clientY - r.top);
      setDragging(m.id);
    },
    onDragEnd: () => {
      setDragging(null);
      setDrop(null);
    },
    onDragOver: (e) => {
      if (!dragging || !e.dataTransfer.types.includes(ROOM_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (drop?.id !== m.id || drop.after !== after) setDrop({ id: m.id, after });
    },
    onDrop: (e) => {
      const id = e.dataTransfer.getData(ROOM_TYPE);
      e.preventDefault();
      if (id && drop) reorder(id, m.id, drop.after);
      setDragging(null);
      setDrop(null);
    },
    // Keyboard: Alt + Shift + ↑/↓ moves the focused room.
    onKeyDown: (e) => {
      if (!e.altKey || !e.shiftKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const list = ordered.map((x) => x.id);
      const i = list.indexOf(m.id);
      const target = list[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (target) reorder(m.id, target, e.key === "ArrowDown");
      const el = e.currentTarget;
      requestAnimationFrame(() => el.focus());
    },
    "aria-description": "Arrastra o pulsa Alt + Mayús + flecha para cambiarla de sitio",
  });
  const dropLine = (m) => (drop?.id === m.id && dragging && dragging !== m.id ? { boxShadow: drop.after ? "inset 0 -2px 0 #FFC93C" : "inset 0 2px 0 #FFC93C" } : {});
  const team = bots.filter((b) => b.enabled !== false);
  let narrated = 0;
  // What finished or failed while you were elsewhere stays marked until you open it.
  const [seen, setSeen] = useState(() => readSeen());
  useEffect(() => {
    if (!activeRoom) return;
    setSeen((all) => { const next = { ...all, [activeRoom]: new Date().toISOString() }; saveSeen(next); return next; });
  }, [activeRoom, missions.find((m) => m.id === activeRoom)?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const unseen = (m) => {
    if (m.id === activeRoom) return null;
    const since = seen[m.id] || seen.__since;
    const at = m.completedAt || m.updatedAt;
    if (!at || (since && Date.parse(at) <= Date.parse(since))) return null;
    return m.status === "completed" ? "done" : m.status === "failed" ? "failed" : null;
  };
  // While the first state loads, placeholders take the room the lists had last time (no jump).
  const roomRows = rooms.length + (allRooms.length > rooms.length ? 1 : 0) + (tucked ? 1 : 0);
  const [lastCounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COUNTS_KEY) || "null"); } catch { return null; }
  });
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(COUNTS_KEY, JSON.stringify({ rooms: roomRows, team: team.length })); } catch {}
  }, [ready, roomRows, team.length]);
  const placeholders = (n, avatar) => Array.from({ length: Math.max(0, Math.min(12, n)) }, (_, i) => <SkeletonRow key={i} avatar={avatar} width={ROW_WIDTHS[i % ROW_WIDTHS.length]} />);

  const item = (key) => (active === key
    ? { display: "flex", alignItems: "center", gap: "12px", minHeight: "42px", padding: "0 12px", borderRadius: "10px", background: "#FFC93C", color: "#12131A", fontWeight: "600", fontSize: "14px" }
    : { display: "flex", alignItems: "center", gap: "12px", minHeight: "42px", padding: "0 12px", borderRadius: "10px", color: "#C9CCD6", fontSize: "14px" });
  const here = (key) => (active === key ? { "aria-current": "page" } : {});

  return (
    <nav aria-label="Navegación principal" className="colmena-sidebar" style={{ flex: "1 1 248px", background: "#12131A", color: "#C9CCD6", display: "flex", flexDirection: "column" }}>
      {/* The inner box scrolls, so the dark background is painted by a box that doesn't:
          its edge then lands on the same device pixel as the title bar above. */}
      <div className="colmena-sidebar-scroll" style={{ flex: "1 1 auto", minHeight: 0, padding: "20px 14px 16px", display: "flex", flexDirection: "column", gap: "24px" }}>
        <a href="/" aria-label="Colmena · Inicio" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 8px" }}>
          <Logo size={30} fontSize={21} tone="light" />
        </a>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <a href="/" {...here("inicio")} style={item("inicio")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></svg>Inicio</a>
          <a href="/bandeja" {...here("bandeja")} style={item("bandeja")} title="Lo que espera tu respuesta o tu OK"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M4 13h4l1 3h6l1-3h4M5 5h14l1 8v6H4v-6z" /></svg><span style={{ flex: "1" }}>Bandeja</span>
            {pending ? (active === "bandeja"
              ? <span style={{ font: "600 12px/1 'Geist Mono', monospace" }}>{pending}</span>
              : <span key={pending} className={bump("bandeja", pending)} aria-label={`${pending} te esperan`} style={{ minWidth: "20px", height: "20px", padding: "0 5px", borderRadius: "10px", background: "#FFC93C", color: "#12131A", font: "600 11px/20px 'Geist Mono', monospace", textAlign: "center" }}>{pending}</span>) : null}
          </a>
          <a href="/misiones" {...here("misiones")} style={item("misiones")} title="Todos los encargos, sus objetivos y su calendario"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg><span style={{ flex: "1" }}>Misiones</span>
            {open.length ? <span aria-label={`${open.length} abiertas`} style={active === "misiones" ? { font: "500 12px/1 'Geist Mono', monospace" } : { font: "500 12px/1 'Geist Mono', monospace", color: "#9DA2B0" }}>{open.length}</span> : null}
          </a>
          <a href="/biblioteca" {...here("biblioteca")} style={item("biblioteca")} title="Entregables, memoria y habilidades del equipo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4v16H5zM11 4h4v16h-4zM17 6l3 .8-3.2 13.4-3-.8z" /></svg>Biblioteca</a>
          <a href="/automatizaciones" {...here("automatizaciones")} style={item("automatizaciones")} title="Trabajo que pasa solo, a una hora o cuando ocurre algo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>Automatizaciones</a>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 6px" }}>
            <span style={sectionTitle}>Salas</span>
            <a href="/?modo=equipo" aria-label="Nueva sala" title="Nueva sala" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", color: "#9DA2B0", borderRadius: "8px" }}>{plus}</a>
          </div>
          {!ready ? <span role="status" aria-label="Cargando las salas" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>{placeholders(lastCounts?.rooms ?? 3, false)}</span> : null}
          {ready && rooms.map((m) => {
            const on = m.id === activeRoom;
            const attention = !on && needsYou(m);
            const base = { display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "0 12px", borderRadius: "10px", fontSize: "14px", ...(dragging === m.id ? { opacity: ".45" } : {}), ...dropLine(m) };
            const name = <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.room}</span>;
            if (on) return <a key={m.id} {...dragProps(m)} {...warm(m)} href={roomUrl(m)} aria-current="page" title={m.title} style={{ ...base, background: "#FFC93C", color: "#12131A", fontWeight: "600" }}><span>#</span>{name}</a>;
            if (attention) return <a key={m.id} {...dragProps(m)} {...warm(m)} href={roomUrl(m)} title={m.title + " · te espera"} style={{ ...base, color: "#FFFFFF", fontWeight: "600" }}><span style={{ color: "#9DA2B0" }}>#</span>{name}<span style={{ width: "8px", height: "8px", flex: "none", borderRadius: "2px", background: "#FFC93C" }} aria-label="Te espera" /></a>;
            // Live digest on hover; dots while it works; green or red until you open what finished or failed.
            const working = ["running", "queued", "planning"].includes(m.status);
            const news = unseen(m);
            const tip = m.title + (working && m.activityLine ? " · " + m.activityLine : news === "done" ? " · terminada" : news === "failed" ? " · se ha detenido" : "");
            const mark = working ? <WorkingDots style={{ color: "#9DA2B0" }} />
              : news ? <span aria-label={news === "done" ? "Terminada" : "Se ha detenido"} style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: news === "done" ? "#3DDC97" : "#FF6B5E" }} /> : null;
            const row = <a key={m.id} {...dragProps(m)} {...warm(m)} href={roomUrl(m)} title={tip} style={{ ...base, color: news ? "#FFFFFF" : "#C9CCD6", fontWeight: news ? "600" : "400" }}><span style={{ color: "#9DA2B0" }}>#</span>{name}{mark}</a>;
            // Up to six rooms at work say, under their name, what is going on (OpenClaw narration).
            if (!working || narrated++ >= 6) return row;
            return <div key={m.id}>{row}<RoomNarration mission={m} live={live} bots={bots} /></div>;
          })}
          {ready && allRooms.length > rooms.length ? <a href="/misiones?vista=lista" style={quietRow}><span style={{ ...addIcon, border: "0" }}><Ellipsis size={16} strokeWidth={2.2} aria-hidden="true" /></span>{`Ver todas las salas (${allRooms.length})`}</a> : null}
          {ready && tucked ? <a href="/misiones?vista=lista&guardadas=1" style={quietRow}><span style={{ ...addIcon, border: "0" }}><Archive size={15} strokeWidth={2.2} aria-hidden="true" /></span>{`Pospuestas y archivadas (${tucked})`}</a> : null}
          <a href="/?modo=equipo" style={quietRow}><span style={addIcon}>{plus}</span>{rooms.length || !ready ? "Nueva sala" : "Crea tu primera sala"}</a>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 6px" }}>
            <a href="/equipo" {...here("equipo")} title="Ver todo el equipo" style={{ ...sectionTitle, ...(active === "equipo" ? { color: "#FFC93C", fontWeight: "600" } : {}) }}>Tu equipo</a>
            <a href="/equipo/nuevo" aria-label="Contratar un bot" title="Contratar un bot" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", color: "#9DA2B0", borderRadius: "8px" }}>{plus}</a>
          </div>
          {!ready ? <span role="status" aria-label="Cargando el equipo" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>{placeholders(lastCounts?.team ?? 4, true)}</span> : null}
          {ready && team.map((b) => {
            const on = b.id === activeBot;
            const face = faceOf(b, b.status === "trabaja" ? "pensando" : b.status === "espera" ? "duda" : null);
            const avatar = face ? <img src={face} alt="" aria-hidden="true" draggable="false" width={22} height={22} style={{ width: 22 + "px", height: 22 + "px", flex: "none", objectFit: "contain" }} /> : <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", ...avatarStyle(b, 22), font: `800 ${b.shape === "diamond" ? 10 : 11}px/1 'Bricolage Grotesque', sans-serif` }}>{initial(b)}</span>;
            const waiting = b.status === "espera";
            const working = b.status === "trabaja";
            const state = waiting
              ? <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: "600", color: on ? "#12131A" : "#FFC93C" }}><span style={{ width: "7px", height: "7px", borderRadius: "2px", background: on ? "#12131A" : "#FFC93C" }} />Te espera</span>
              : working
                ? <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: on ? "#12131A" : "#9DA2B0" }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: on ? "#0B8A5F" : "#3DDC97" }} />Trabajando</span>
                : null;
            const style = { display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "0 12px", borderRadius: "10px", fontSize: "14px", ...(on ? { background: "#FFC93C", color: "#12131A", fontWeight: "600" } : { color: "#E6E8EE" }) };
            return <a key={b.id} href={`/chat/${b.id}`} {...(on ? { "aria-current": "page" } : {})} title={`${b.name} · ${b.role}${b.statusLabel ? " · " + b.statusLabel : ""}`} style={style}>{avatar}<span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>{state}</a>;
          })}
          <a href="/equipo/nuevo" style={quietRow}><span style={addIcon}>{plus}</span>Contratar un bot</a>
        </div>
      </div>

      <a href="/ajustes" {...here("ajustes")} title="Ajustes: cuenta de IA, apps conectadas, carpetas y límites" style={{ flex: "none", display: "flex", alignItems: "center", gap: "10px", margin: "0 14px 14px", padding: "10px 12px", borderTop: "1px solid #2C2F3A", borderRadius: active === "ajustes" ? "10px" : "0", background: active === "ajustes" ? "#1D1F27" : "transparent", color: "inherit" }}>
        <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "none", borderRadius: "50%", background: "#E6E8EE", color: "#12131A", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "13px" }}>TÚ</span>
        <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ color: "#FFFFFF", fontWeight: "600", fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ready ? me?.name || settings.userName || "Tu cuenta" : <span aria-hidden="true" className="colmena-skeleton colmena-skeleton--dark" style={{ display: "block", height: "10px", width: "90px", borderRadius: "5px", margin: "3px 0" }} />}</span><span style={{ fontSize: "12px", color: "#9DA2B0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{settings.spaceName ? settings.spaceName : "Ajustes"}</span></span>
        <span style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", borderRadius: "10px", ...(active === "ajustes" ? { background: "#FFC93C", color: "#12131A" } : { color: "#C9CCD6" }) }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg></span>
      </a>
    </nav>
  );
}
