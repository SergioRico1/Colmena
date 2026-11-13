import { useState } from "react";
import { X } from "../../Icon.js";
import { post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { DIALOG_VEIL, useDialogFocus } from "../../../lib/useDialogFocus.js";
import { C } from "../../../lib/theme.js";
import InviteSheet from "../../people/InviteSheet.jsx";
import JoinSheet from "../../people/JoinSheet.jsx";

// The team's sheets (docs/PLAN-equipo-y-salas.md › 4.1), opened from the sidebar's team menu
// and from Equipo, in the one vocabulary of docs/SCREENS.md › «Invitar»:
//   create  «Crear un equipo»        POST /api/teams {name} → the team (you administer it), then
//                                    the «Invitar» sheet of that team
//   join    «Unirme con un código»   people/JoinSheet.jsx (any code: a team's, a room's, a person's)
//   invite  «Invitar»                people/InviteSheet.jsx with the team as its context
// Colmena never sends an invitation: you copy it and send it yourself.
export const INK = C.text, MUTED = C.text3;
const veil = { position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: "24px", background: DIALOG_VEIL, animation: "fade .2s ease-out", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: INK, WebkitAppRegion: "no-drag" };
const cardStyle = (w) => ({ width: `min(${w}px, 100%)`, maxHeight: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px", padding: "28px", borderRadius: "var(--r-lg)", background: "var(--c-card)", boxShadow: "0 0 0 1px rgb(var(--c-ink-rgb) / .06), var(--c-shadow-pop)", animation: "sheet .3s cubic-bezier(.2,.8,.2,1)", boxSizing: "border-box", textAlign: "left" });
export const darkBtn = (on = true) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "46px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", cursor: on ? "pointer" : "default", fontSize: "var(--t-ui)", fontWeight: 600, background: on ? "var(--c-btn)" : C.lineStrong, color: on ? "var(--c-btn-text)" : C.text2 });
export const quietBtn = { minHeight: "44px", padding: "0 18px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text-3)" };
export const fieldBox = { display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "var(--r-pill)", background: "var(--c-sunken)" };
export const fieldInput = { flex: 1, minWidth: 0, height: "44px", border: 0, background: "transparent", fontSize: "var(--t-read)", color: "var(--c-text)" };
export const hidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
export const note = { margin: 0, fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" };
export const errorLine = { margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-error)" };

/** The sheet itself: a veil, a dialog that keeps the keyboard inside, a title and «Cerrar». */
export function Sheet({ id, title, sub = null, width = 540, onClose, children }) {
  const box = useDialogFocus({ onEscape: onClose });
  return (
    <div style={veil} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} role="dialog" aria-modal="true" aria-labelledby={id} style={cardStyle(width)}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
            <h2 id={id} style={{ margin: 0, font: "600 var(--t-read)/1.3 'Geist', sans-serif", overflowWrap: "anywhere" }}>{title}</h2>
            {sub ? <span style={{ fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{sub}</span> : null}
          </span>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)", cursor: "pointer" }}><X size={15} strokeWidth={2.6} aria-hidden="true" /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

/** «Crear un equipo»: a name; then you are offered to invite the first person. */
export function CreateTeamSheet({ onClose, onCreated = null }) {
  const { run } = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ok = !!name.trim() && !busy;
  const make = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const team = await run(() => post("/teams", { name: name.trim() }));
      if (onCreated) onCreated(team); else onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Sheet id="team-new-t" title="Crear un equipo" sub="Un sitio para ti, tus compañeros y los bots de todos." onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); make(); }} className="c-ring" style={fieldBox}>
        <label style={{ flex: 1, display: "flex", minWidth: 0 }}>
          <span style={hidden}>{"Nombre del equipo"}</span>
          <input className="c-bare" autoFocus data-autofocus="" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Nombre del equipo" style={fieldInput} />
        </label>
        <button type="submit" disabled={!ok} style={darkBtn(ok)}>{busy ? "Creando…" : "Crear equipo"}</button>
      </form>
      <p style={note}>{"Nace con una sala de todos, «general». Lo administras tú: invitas, quitas, cambias el nombre y nombras a otros administradores. Cada persona sigue con sus bots en su ordenador; el equipo comparte la conversación, no los datos."}</p>
      {error ? <p role="alert" style={errorLine}>{error}</p> : null}
    </Sheet>
  );
}

/**
 * The team's sheets by name, so the sidebar and Equipo open the same ones.
 * `sheet`: {kind: "create" | "join" | "invite", team?, fresh?}; `onSheet` opens another.
 */
export default function TeamSheets({ sheet, onClose, onSheet }) {
  if (!sheet) return null;
  if (sheet.kind === "create") return <CreateTeamSheet onClose={onClose} onCreated={(team) => onSheet({ kind: "invite", team: { id: team.id, name: team.name, admin: true }, fresh: true })} />;
  if (sheet.kind === "join") return <JoinSheet onClose={onClose} />;
  if (sheet.kind === "invite" && sheet.team) return <InviteSheet context={{ kind: "team", team: sheet.team }} lead={sheet.fresh ? `«${sheet.team.name}» está creado, con su sala #general. Invita a la primera persona, o hazlo más tarde desde Equipo.` : null} onClose={onClose} />;
  return null;
}
