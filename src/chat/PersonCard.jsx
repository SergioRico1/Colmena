// A person's quick card next to their name, face or @mention in a conversation (like the bot's
// card): their picture on Colmena's pixels in their colour, title, status, whether they are on,
// their local time, and «Enviar mensaje» / «Ver perfil». The full profile stays in the side panel
// (PersonProfile.jsx, ?persona=).
import { useState } from "react";
import { createPortal } from "react-dom";
import { BellSlash, ChatCircleText, Pencil, UserRound, X } from "../components/Icon.js";
import { PixelBanner } from "../components/Hive.jsx";
import { familyInk } from "../lib/personColor.js";
import { personTint } from "../lib/identity.js";
import { navigate } from "../lib/router.jsx";
import { cityOf, openDirect, Status, useMinute } from "./PersonProfile.jsx";
import { placeStyle, usePopover } from "./popover.js";
import { useChat } from "./store.js";
import { Avatar, ROLE_LABEL, localTimeOf } from "./ui.jsx";
import "./botcard.css";

export default function PersonCard({ id, anchor, channel, onClose }) {
  const s = useChat();
  useMinute();
  const p = s.people.get(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { box, place } = usePopover(anchor, onClose, { width: 320 });
  if (!p) return null;
  const you = p.id === s.me?.id;
  const presence = s.presence.get(p.id);
  const state = p.deactivated ? "Desactivada" : presence === "active" ? "Conectada" : presence === "away" ? "Ausente" : "Desconectada";
  const local = p.tz ? localTimeOf(p.tz) : null;
  const message = async () => {
    setBusy(true); setError(null);
    try { await openDirect([p.id]); onClose(); } catch (e) { setError(e.message || "No se pudo abrir la conversación."); setBusy(false); }
  };
  const profile = () => { onClose(); navigate((channel ? "/canal/" + channel : "/personas") + (channel ? "?persona=" : "?p=") + encodeURIComponent(p.id)); };
  return createPortal(
    <div ref={box} className="bc pc" role="dialog" aria-label={"Ficha de " + p.name} style={placeStyle(place)}>
      <div className="bc-banner pc-banner">
        <PixelBanner color={familyInk(p.color || personTint(p.name))} seed={p.id} height={64} />
        <button type="button" className="bc-close" onClick={onClose} aria-label="Cerrar la ficha"><X size={16} /></button>
      </div>
      <div className="bc-face pc-face"><Avatar id={p.id} size={64} /></div>
      <div className="bc-body">
        <div className="bc-name">{p.name}{you ? <span className="pc-you"> (tú)</span> : null}</div>
        {p.title ? <div className="bc-sub">{p.title}</div> : null}
        {p.status ? <Status status={p.status} /> : null}
        <dl className="pc-facts">
          <div><dt>Estado</dt><dd><span className={"pc-dot" + (presence === "active" && !p.deactivated ? " is-on" : "")} aria-hidden="true" />{state}{!p.deactivated && p.dnd ? <span className="pc-dnd"><BellSlash size={12} /> no molestar</span> : null}</dd></div>
          {local ? <div><dt>Su hora</dt><dd>{local}{cityOf(p.tz) ? " · " + cityOf(p.tz) : ""}</dd></div> : null}
          {p.role && p.role !== "member" ? <div><dt>Rol</dt><dd>{ROLE_LABEL[p.role]}</dd></div> : null}
        </dl>
        <div className="pc-actions">
          {you ? (
            <button type="button" className="ch-btn is-primary" onClick={() => { onClose(); navigate("/personas?p=yo"); }}><Pencil size={16} />Editar tu perfil</button>
          ) : (
            <button type="button" className="ch-btn is-primary" disabled={p.deactivated || busy} onClick={message}><ChatCircleText size={16} />{busy ? "Abriendo…" : "Mensaje"}</button>
          )}
          <button type="button" className="ch-btn" onClick={profile}><UserRound size={16} />Ver perfil</button>
        </div>
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
