// Shared pieces of the team-messaging screens (src/chat/): the page frame, avatars with presence,
// counts, dialogs, tabs, times. Everything draws from Colmena's tokens (styles/base.css) and
// opts into the responsive helpers (styles/responsive.css): one column under 640 px.
import { useEffect, useId, useRef } from "react";
import Shell from "../components/v2/Shell.jsx";
import { PersonAvatar } from "../components/room/Author.jsx";
import { X } from "../components/Icon.js";
import { useTopTitle } from "./title.js";
import { personOf, useChat } from "./store.js";
import "./chat.css";

/** A place of team messaging: the shell, a header whose title the phone's top bar carries, the body. */
export function ChatPage({ title, top = null, icon = null, sub = null, actions = null, children, scroll = true, active = "chats", bodyClass = "" }) {
  useTopTitle(top || title);
  return (
    <Shell active={active} scroll={false} background="var(--c-app)">
      <main className="ch-page" aria-label={top || title}>
        <header className="ch-head">
          <div className="ch-head-title">
            <h1 className="ch-h1">{icon}<span className="ch-ellipsis">{title}</span></h1>
            {sub ? <p className="ch-sub">{sub}</p> : null}
          </div>
          {actions ? <div className="ch-head-actions">{actions}</div> : null}
        </header>
        <div className={"ch-body" + (scroll ? " is-scroll" : "") + (bodyClass ? " " + bodyClass : "")}>{children}</div>
      </main>
    </Shell>
  );
}

/** A person's round avatar (or someone from an import), with their presence when known. */
export function Avatar({ id, size = 32, presence = true }) {
  const s = useChat();
  const p = personOf(id, s) || { name: "?" };
  const online = presence && !p.ghost ? (s.presence.get(p.id) === "active" ? "online" : s.presence.get(p.id) === "away" ? "away" : null) : null;
  return <PersonAvatar person={{ name: p.name, color: p.color || null }} size={size} presence={online === "online" ? "online" : online ? "offline" : null} ring="var(--c-app)" />;
}

/** A small presence dot: active (green), away (ring), offline (nothing). */
export function Presence({ id }) {
  const s = useChat();
  const state = s.presence.get(id);
  if (!state) return <span className="ch-dot is-off" aria-label="Desconectado" role="img" />;
  return <span className={"ch-dot" + (state === "active" ? " is-on" : " is-away")} role="img" aria-label={state === "active" ? "Conectado" : "Ausente"} />;
}

export function Count({ n, strong = false, label }) {
  if (!n) return null;
  return <span className={"ch-count" + (strong ? " is-strong" : "")} aria-label={label || `${n} sin leer`}>{n > 99 ? "99+" : n}</span>;
}

export function Empty({ title, children = null, action = null }) {
  return (
    <div className="ch-empty">
      <p className="ch-empty-title">{title}</p>
      {children ? <p className="ch-empty-text">{children}</p> : null}
      {action}
    </div>
  );
}

/** A modal dialog for a short task (create a channel, start a conversation). Escape closes it. */
export function Dialog({ title, onClose, children, footer = null, width = 480 }) {
  const id = useId();
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    box.current?.querySelector("input,textarea,select,button")?.focus();
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="ch-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={id} className="ch-dialog" style={{ width: width + "px" }}>
        <div className="ch-dialog-head">
          <h2 id={id} className="ch-dialog-title">{title}</h2>
          <button type="button" className="ch-iconbtn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="ch-dialog-body">{children}</div>
        {footer ? <div className="ch-dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Tabs as links or buttons; a strip that scrolls sideways on a phone. */
export function Tabs({ items, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="ch-tabs r-scroll-x">
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className="ch-tab" onClick={() => onChange(t.id)}>
          {t.label}{t.count ? <span className="ch-tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
export const timeOf = (ms) => new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
export function dayLabel(ms) {
  const now = Date.now();
  if (sameDay(ms, now)) return "Hoy";
  if (sameDay(ms, now - 86400000)) return "Ayer";
  const d = new Date(ms);
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
export const whenOf = (ms) => (sameDay(ms, Date.now()) ? timeOf(ms) : new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " · " + timeOf(ms));
/** «hace 5 min», «hace 3 h», or the date. */
export function ago(ms) {
  const d = (Date.now() - ms) / 60000;
  if (d < 1) return "ahora";
  if (d < 60) return `hace ${Math.round(d)} min`;
  if (d < 24 * 60) return `hace ${Math.round(d / 60)} h`;
  return whenOf(ms);
}
/** The local time of someone in their time zone («10:42»), or null. */
export function localTimeOf(tz) {
  if (!tz) return null;
  try { return new Date().toLocaleTimeString("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" }); } catch { return null; }
}
export const sizeOf = (n) => (n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1).replace(".", ",") + " MB");
export const ROLE_LABEL = { owner: "Propietario", admin: "Administración", member: "Miembro", guest: "Invitado" };
