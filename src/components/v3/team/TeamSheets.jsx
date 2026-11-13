import { useEffect, useState } from "react";
import { Copy, X } from "lucide-react";
import { get, post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { navigate } from "../../../lib/router.jsx";
import { shareUrl } from "../../../lib/peers.js";
import { DIALOG_VEIL, useDialogFocus } from "../../../lib/useDialogFocus.js";
import { adminNames, codeKind, findCode, listNames } from "../../../lib/teams.js";

// The team's sheets (docs/PLAN-equipo-y-salas.md › 4.1), opened from the sidebar's team menu
// and from Equipo. Same vocabulary as «Hablar con una persona» (v2/people/InviteSheets.jsx).
//   create  «Crear un equipo»        POST /api/teams {name} → the team (you administer it)
//   join    «Unirme con un código»   POST /api/peers/invites/preview {code} says what the code is
//                                    for; a team's goes to POST /api/teams/join, a person's or a
//                                    room's to POST /api/peers/invites/accept
//   invite  «Invitar al equipo»      POST /api/teams/:id/invite {name?} → {code, text, expiresAt}
// Colmena never sends an invitation: you copy it and send it yourself.
export const INK = "#12131A", MUTED = "#5C606C";
/** «Cómo funciona», at what the others see of your bots' work. */
const HELP = "/personas/como-funciona#que-ven";
const veil = { position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: "24px", background: DIALOG_VEIL, animation: "fade .2s ease-out", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: INK, WebkitAppRegion: "no-drag" };
const cardStyle = (w) => ({ width: `min(${w}px, 100%)`, maxHeight: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px", padding: "28px", borderRadius: "32px", background: "#FFFFFF", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 0 0 1px rgba(18,19,26,.06)", animation: "sheet .3s cubic-bezier(.2,.8,.2,1)", boxSizing: "border-box", textAlign: "left" });
export const darkBtn = (on = true) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "46px", padding: "0 20px", border: 0, borderRadius: "999px", cursor: on ? "pointer" : "default", fontSize: "14px", fontWeight: 600, background: on ? INK : "#C9CBD1", color: on ? "#FFFFFF" : "#3D404A" });
export const quietBtn = { minHeight: "44px", padding: "0 18px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: MUTED };
export const fieldBox = { display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "999px", background: "#F2F2EE" };
export const fieldInput = { flex: 1, minWidth: 0, height: "44px", border: 0, background: "transparent", fontSize: "16px", color: INK };
export const hidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
export const note = { margin: 0, fontSize: "13px", lineHeight: 1.5, color: MUTED };
export const errorLine = { margin: 0, fontSize: "14px", lineHeight: 1.45, color: "#B4231A" };

/** The sheet itself: a veil, a dialog that keeps the keyboard inside, a title and «Cerrar». */
export function Sheet({ id, title, sub = null, width = 540, onClose, children }) {
  const box = useDialogFocus({ onEscape: onClose });
  return (
    <div style={veil} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} role="dialog" aria-modal="true" aria-labelledby={id} style={cardStyle(width)}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
            <h2 id={id} style={{ margin: 0, font: "600 26px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>{title}</h2>
            {sub ? <span style={{ fontSize: "15px", lineHeight: 1.5, color: MUTED }}>{sub}</span> : null}
          </span>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", color: INK, cursor: "pointer" }}><X size={15} strokeWidth={2.6} aria-hidden="true" /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

/** The code and the message that goes with it, with «Copiar». */
export function CodeCard({ made, onError }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(made.text || made.code); setCopied(true); } catch { onError("No se pudo copiar. Selecciona el texto y cópialo tú."); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "18px", borderRadius: "22px", background: "#F4F4F0" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", lineHeight: 1.5, color: "#1E2029", userSelect: "text" }}>
        {String(made.text || made.code).split("\n").map((line, i) => line === made.code
          ? <code key={i} style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "12px", background: "#FFFFFF", font: "500 15px/1 'Geist Mono', monospace", letterSpacing: "0.04em", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.08)", userSelect: "all" }}>{line}</code>
          : <span key={i} style={{ overflowWrap: "anywhere" }}>{line}</span>)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
        <button type="button" onClick={copy} data-autofocus="" style={darkBtn()}><Copy size={15} strokeWidth={2.2} aria-hidden="true" />{copied ? "Copiada" : "Copiar invitación"}</button>
        <span style={{ fontSize: "13px", color: MUTED }}>{"24 h, un solo uso"}</span>
        <span role="status" style={hidden}>{copied ? "Invitación copiada" : ""}</span>
      </div>
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
 * «Invitar al equipo». An admin gets a code for one person; anyone else is told who can invite.
 * `team` is a row of the team list: {id, name, admin}.
 */
export function TeamInviteSheet({ team, onClose, fresh = false }) {
  const { run } = useStore();
  const [name, setName] = useState("");
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [admins, setAdmins] = useState(null);
  useEffect(() => {
    if (team.admin) return undefined;
    let alive = true;
    get(`/teams/${encodeURIComponent(team.id)}`).then((t) => { if (alive) setAdmins(adminNames(t.members)); }).catch(() => { if (alive) setAdmins([]); });
    return () => { alive = false; };
  }, [team.id, team.admin]);
  const make = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { setMade(await run(() => post(`/teams/${encodeURIComponent(team.id)}/invite`, name.trim() ? { name: name.trim() } : {}))); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (!team.admin) {
    return (
      <Sheet id="team-inv-t" title={`Invitar a «${team.name}»`} onClose={onClose}>
        <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.55 }}>
          {admins == null ? "Buscando quién administra el equipo…" : admins.length ? `Solo invita quien administra el equipo: ${listNames(admins)}. Pídele que mande la invitación.` : "Solo invita quien administra el equipo. Pídeselo a quien lo creó."}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" data-autofocus="" onClick={() => { onClose(); navigate("/equipo#equipo"); }} style={darkBtn()}>{"Ver el equipo"}</button>
          <button type="button" onClick={onClose} style={quietBtn}>{"Cerrar"}</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet id="team-inv-t" width={560} title={made ? "Invitación lista" : fresh ? `«${team.name}» está creado` : `Invitar a «${team.name}»`} sub={made ? "Cópiala y mándasela tú. Colmena no escribe a nadie por ti." : fresh ? "Invita a la primera persona, o hazlo más tarde desde Equipo." : "Un código por persona. Quien lo use entra en el equipo y en «general»."} onClose={onClose}>
      {made ? (
        <>
          <CodeCard made={made} onError={setError} />
          <p style={note}>{"Cuando pegue el código en su Colmena con «Unirme con un código», os saldrán las mismas cuatro palabras a los dos. Si coinciden, nadie se ha puesto en medio."}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" onClick={() => { setMade(null); setName(""); }} style={{ ...quietBtn, paddingLeft: 0 }}>{"Invitar a otra persona"}</button>
          </div>
        </>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); make(); }} className="c-ring" style={fieldBox}>
            <label style={{ flex: 1, display: "flex", minWidth: 0 }}>
              <span style={hidden}>{"Nombre de la persona (opcional)"}</span>
              <input className="c-bare" autoFocus data-autofocus="" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="¿Para quién es? (opcional)" style={fieldInput} />
            </label>
            <button type="submit" disabled={busy} style={darkBtn(!busy)}>{busy ? "Creando…" : "Crear invitación"}</button>
          </form>
          <p style={note}>{"El código sirve 24 h y una sola vez. El nombre solo es para que reconozcas la invitación en la lista. "}<a href={HELP} onClick={() => onClose()} style={{ color: "#1F4FD1", fontWeight: 600 }}>{"Qué verá quien entre"}</a></p>
        </>
      )}
      {error ? <p role="alert" style={errorLine}>{error}</p> : null}
    </Sheet>
  );
}

/** «Unirme con un código»: one field for any code; it says what the code is for before you confirm. */
export function JoinSheet({ onClose }) {
  const { run } = useStore();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const code = findCode(text);
  const what = preview ? codeKind(preview) : null;
  const look = async () => {
    if (busy || !text.trim()) return;
    if (!code) { setError("Eso no parece un código de Colmena. Es como COLMENA-XXXX-XXXX-XXXX-XXXX; puedes pegar el mensaje entero."); return; }
    setBusy(true);
    setError(null);
    try { setPreview(await post("/peers/invites/preview", { code })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await run(() => (what.kind === "team" ? post("/teams/join", { code }) : post("/peers/invites/accept", { code })));
      setDone({ kind: what.kind, ...out });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (done) {
    const team = done.kind === "team";
    return (
      <Sheet id="team-join-t" title={team ? `Has pedido entrar en «${done.name || preview.team}»` : `Ya puedes escribirte con ${what.from}`} sub={team ? `Estarás dentro en cuanto la Colmena de quien creó el equipo esté encendida. Mientras, lo verás en Equipo como pendiente.` : "Sus mensajes llegan cerrados con llave: solo los abre tu ordenador."} onClose={onClose}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" data-autofocus="" onClick={() => { onClose(); navigate(team ? "/equipo#equipo" : shareUrl(done.dm)); }} style={darkBtn()}>{team ? "Ver en Equipo" : "Abrir la conversación"}</button>
          <button type="button" onClick={onClose} style={quietBtn}>{"Cerrar"}</button>
        </div>
      </Sheet>
    );
  }
  if (preview) {
    return (
      <Sheet id="team-join-t" title={what.title} sub={what.text} onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "18px", borderRadius: "22px", background: "#F4F4F0" }}>
          <span style={{ fontSize: "13px", color: MUTED }}>{`Pídele a ${what.from} que te diga sus cuatro palabras. Deben ser estas:`}</span>
          <strong style={{ font: "600 21px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{(preview.words || []).join(" · ")}</strong>
          <span style={{ fontSize: "13px", lineHeight: 1.45, color: MUTED }}>{`Si coinciden, la invitación es de verdad de ${what.from}. Si no, no sigas.`}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <button type="button" data-autofocus="" onClick={accept} disabled={busy} style={{ ...darkBtn(!busy), minHeight: "50px", fontSize: "15px" }}>{busy ? "Un momento…" : what.confirm}</button>
          <button type="button" onClick={() => { setPreview(null); setError(null); }} style={quietBtn}>{"No coinciden o no le conozco"}</button>
        </div>
        {error ? <p role="alert" style={errorLine}>{error}</p> : null}
      </Sheet>
    );
  }
  return (
    <Sheet id="team-join-t" title="Unirme con un código" sub="Pega el código que te han mandado. Vale el de un equipo, el de una sala o el de una persona." onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); look(); }} className="c-ring" style={fieldBox}>
        <label style={{ flex: 1, display: "flex", minWidth: 0 }}>
          <span style={hidden}>{"Código de invitación"}</span>
          <input className="c-bare" autoFocus data-autofocus="" type="text" value={text} maxLength={600} onChange={(e) => { setText(findCode(e.target.value) || e.target.value); setError(null); }} placeholder="COLMENA-XXXX-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" style={{ ...fieldInput, font: "500 15px/1 'Geist Mono', monospace", letterSpacing: "0.03em" }} />
        </label>
        <button type="submit" disabled={!text.trim() || busy} style={darkBtn(!!text.trim() && !busy)}>{busy ? "Buscando…" : "Continuar"}</button>
      </form>
      <p style={note}>{"Antes de entrar verás para qué es el código y de quién. Puedes pegar el mensaje entero: Colmena encuentra el código."}</p>
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
  if (sheet.kind === "invite" && sheet.team) return <TeamInviteSheet team={sheet.team} fresh={!!sheet.fresh} onClose={onClose} />;
  return null;
}
