// A person's profile in team messaging: picture, name, title, status, presence, local time,
// phone, mail and role, with «Enviar mensaje» and «Sus mensajes». Shown in «Personas» (?p=<id>) and,
// as in Slack, beside a conversation when you click someone's name or avatar (PersonPanel, used by
// src/screens/Canal.jsx with ?persona=<id>).
import { useEffect, useRef, useState } from "react";
import { BellSlash, ChatCircleText, Pencil, Search, X } from "../components/Icon.js";
import { navigate } from "../lib/router.jsx";
import { chat } from "./api.js";
import { upsertChannel, useChat } from "./store.js";
import { Avatar, Empty, ROLE_LABEL, localTimeOf, whenOf } from "./ui.jsx";
import "./people.css";

export const cityOf = (tz) => (tz && tz !== "UTC" ? tz.split("/").pop().replace(/_/g, " ") : tz || "");

/** The clock moves: local times re-render each half minute. */
export function useMinute() {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
}

/** How to name someone in a search filter (server/cloud/chat.mjs › findPerson). */
const handleOf = (p) => (p.email ? p.email : (p.name || "").replace(/\s+/g, ""));

export function Chips({ p, presence }) {
  return (
    <>
      {p.role === "owner" || p.role === "admin" || p.role === "guest" ? <span className="ch-chip">{ROLE_LABEL[p.role]}</span> : null}
      {p.deactivated ? <span className="ch-chip">Desactivada</span> : null}
      {!p.deactivated && (p.away || presence === "away") ? <span className="ch-chip">Ausente</span> : null}
      {!p.deactivated && p.dnd ? <span className="ch-chip"><BellSlash size={12} />No molestar</span> : null}
    </>
  );
}

export function Status({ status }) {
  if (!status || (!status.emoji && !status.text)) return null;
  return (
    <span className="pp-status">
      {status.emoji ? <span className="pp-status-emoji" aria-hidden="true">{status.emoji}</span> : null}
      <span className="ch-ellipsis">{status.text || ""}</span>
    </span>
  );
}

export function Profile({ p, you, busy, error, onMessage, onEdit, size = 72 }) {
  const s = useChat();
  const presence = s.presence.get(p.id);
  const local = p.tz ? localTimeOf(p.tz) : null;
  const state = p.deactivated ? "Desactivada" : presence === "active" ? "Conectada" : presence === "away" ? "Ausente" : "Desconectada";
  return (
    <div className="pp-profile">
      <div className="pp-profile-top">
        <Avatar id={p.id} size={size} />
        <h3 className="pp-profile-name">{p.name}{you ? <span className="pp-you"> (tú)</span> : null}</h3>
        {p.title ? <p className="pp-profile-title">{p.title}</p> : null}
        {p.status ? <Status status={p.status} /> : null}
        <div className="pp-chips"><Chips p={p} presence={presence} /></div>
      </div>

      <div className="ch-row-actions pp-profile-actions">
        {you ? (
          <button type="button" className="ch-btn is-primary" onClick={onEdit}><Pencil size={16} />Editar tu perfil</button>
        ) : (
          <button type="button" className="ch-btn is-primary" disabled={p.deactivated || busy} onClick={onMessage}><ChatCircleText size={16} />{busy ? "Abriendo…" : "Enviar mensaje"}</button>
        )}
        <a className="ch-btn" href={"/buscar?q=" + encodeURIComponent("from:@" + handleOf(p))}><Search size={16} />{you ? "Tus mensajes" : "Sus mensajes"}</a>
      </div>
      {error ? <p className="ch-error">{error}</p> : null}

      <dl className="pp-facts">
        <div><dt>Estado</dt><dd>{state}{!p.deactivated && p.dnd ? (p.dndUntil ? " · no molestar hasta " + whenOf(p.dndUntil) : " · no molestar") : ""}</dd></div>
        {local ? <div><dt>Hora local</dt><dd>{local}{cityOf(p.tz) ? " · " + cityOf(p.tz) : ""}</dd></div> : null}
        {p.phone ? <div><dt>Teléfono</dt><dd><a className="ch-link" href={"tel:" + p.phone.replace(/[^\d+]/g, "")}>{p.phone}</a></dd></div> : null}
        {p.email ? <div><dt>Correo</dt><dd><a className="ch-link" href={"mailto:" + p.email}>{p.email}</a></dd></div> : null}
        <div><dt>Rol</dt><dd>{ROLE_LABEL[p.role] || "Miembro"}</dd></div>
      </dl>
    </div>
  );
}

/** Opens (or reuses) the direct message with these people and goes there. */
export async function openDirect(ids) {
  const view = await chat.post("/dm", { people: ids });
  upsertChannel(view);
  navigate("/canal/" + view.id);
}

/** The profile as a side panel next to a conversation; Escape or the cross closes it. */
export function PersonPanel({ personId, onClose }) {
  const s = useChat();
  useMinute();
  const panel = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const person = s.people.get(personId) || null;
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, [personId]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape" && !e.defaultPrevented && panel.current?.contains(document.activeElement)) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const message = async () => {
    setBusy(true);
    setError(null);
    try { await openDirect([personId]); } catch (e) { setError(e.message || "No se pudo abrir la conversación."); setBusy(false); }
  };
  return (
    <aside ref={panel} tabIndex={-1} className="th pp-side r-overlay" aria-label="Perfil">
      <div className="th-head">
        <div className="th-title"><h2>Perfil</h2></div>
        <button type="button" className="ch-iconbtn th-close" onClick={onClose} aria-label="Cerrar el perfil"><X size={18} /></button>
      </div>
      <div className="th-body">
        {person ? (
          <Profile p={person} you={person.id === s.me?.id} busy={busy} error={error} onMessage={message} onEdit={() => navigate("/personas?p=yo")} size={160} />
        ) : s.ready ? (
          <Empty title="No está en la empresa">Puede que la hayan quitado del espacio.</Empty>
        ) : null}
      </div>
    </aside>
  );
}
