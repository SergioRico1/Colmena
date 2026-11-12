import { useEffect, useId, useRef, useState } from "react";
import { useDialogFocus } from "../../lib/useDialogFocus.js";

// Two small pieces the live browser views share (BrowserLive.jsx, screens/OrdenadorV2.jsx):
//  - WatchedView: while you only watch, what you see is a picture of the bot's browser, so a
//    click or a key on it never reaches the page. The first one asks «¿Quieres tomar el
//    control?» instead of doing nothing, with the same «Tomar el control» button.
//  - ReturnNote: «Deja un recado para <bot>» beside «Devolver». The bot reads it at its next
//    round as your words about how you left the page; it approves nothing
//    (server/computer/routes.mjs returnNoteText).

/** How long a hand-back note may be (server/computer/routes.mjs RETURN_NOTE_MAX). */
export const NOTE_MAX = 500;

// Keys that move around the app or belong to a shortcut: they are not «trying to use the page».
const PASS = new Set(["Tab", "Escape", "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "ContextMenu", "F5", "F12"]);
/** Whether this key press on the watched view means «I want to use the page». */
export const wantsControl = (e) => !!e && !e.ctrlKey && !e.metaKey && !e.altKey && !PASS.has(e.key);

/**
 * @param {object} p
 * @param {boolean} p.watching a frame is shown and you do not have the control
 * @param {string} p.name the bot's name
 * @param {boolean} p.busy
 * @param {() => void} p.onTake the screen's own «Tomar el control»
 * @param {object} p.takeStyle its button style, so the prompt's button is the same one
 * @param {object} p.quietStyle the screen's secondary button style
 * @param {object} [p.style] the view's own box
 */
export function WatchedView({ watching, name, busy = false, onTake, takeStyle, quietStyle, style = null, children }) {
  const [asking, setAsking] = useState(false);
  const view = useRef(null);
  const title = useId();
  useEffect(() => { if (!watching) setAsking(false); }, [watching]);
  const close = () => setAsking(false);
  const prompt = useDialogFocus({ onEscape: close, active: asking });
  const ask = () => { if (watching && !asking) setAsking(true); };
  return (
    <div
      ref={view}
      {...(watching ? { tabIndex: 0, role: "group", "aria-label": `Lo que ve ${name}. Solo estás mirando: pulsa para tomar el control.` } : {})}
      className="colmena-live-btn"
      onClick={(e) => { if (!e.target.closest?.("[data-take-prompt]")) ask(); }}
      onKeyDown={(e) => { if (e.target === view.current && wantsControl(e)) { e.preventDefault(); ask(); } }}
      style={{ position: "relative", ...style }}
    >
      {children}
      {asking ? (
        <div ref={prompt} data-take-prompt="" role="dialog" aria-labelledby={title} style={{ position: "absolute", left: "16px", right: "16px", bottom: "16px", margin: "0 auto", maxWidth: "440px", display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "16px", background: "#FFFFFF", color: "#12131A", boxShadow: "0 2px 6px rgba(18,19,26,.12), 0 24px 48px -20px rgba(18,19,26,.5)", textAlign: "left" }}>
          <strong id={title} style={{ fontSize: "15px", fontWeight: 600 }}>{"¿Quieres tomar el control?"}</strong>
          <span style={{ fontSize: "13.5px", lineHeight: 1.45, color: "#4A4F5C" }}>{`Ahora solo estás mirando. Si lo tomas, ${name} se para y espera sin tocar nada hasta que se lo devuelvas.`}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" data-autofocus="" className="colmena-live-btn" disabled={busy} onClick={() => { close(); onTake(); }} style={takeStyle}>{"Tomar el control"}</button>
            <button type="button" className="colmena-live-btn" onClick={close} style={quietStyle}>{"Seguir mirando"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The optional one-line note that goes with «Devolver». Enter gives the control back.
 * @param {object} p
 * @param {string} p.name the bot's name
 * @param {string} p.value
 * @param {(value: string) => void} p.onChange
 * @param {() => void} p.onSubmit
 * @param {object} [p.inputStyle] the screen's own field style
 */
export function ReturnNote({ name, value, onChange, onSubmit, disabled = false, inputStyle = null, style = null }) {
  const id = useId();
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, ...style }}>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "#12131A" }}>{`Deja un recado para ${name}`} <span style={{ fontWeight: 400, color: "#5C606C" }}>{"(opcional)"}</span></span>
      <input
        id={id} className="c-quiet" type="text" value={value} maxLength={NOTE_MAX} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent?.isComposing) { e.preventDefault(); onSubmit(); } }}
        placeholder="Ej.: ya inicié sesión, sigue desde el carrito"
        style={{ height: "40px", minWidth: 0, padding: "0 14px", border: "1px solid #DCE0E8", borderRadius: "10px", background: "#FFFFFF", fontSize: "14px", fontFamily: "inherit", color: "#12131A", ...inputStyle }}
      />
    </label>
  );
}

/** The body of the hand-back call: the note only when something was written. */
export const returnBody = (missionId, botId, note) => ({ missionId, action: "return", ...(botId ? { botId } : {}), ...(String(note || "").trim() ? { note: String(note).trim().slice(0, NOTE_MAX) } : {}) });
