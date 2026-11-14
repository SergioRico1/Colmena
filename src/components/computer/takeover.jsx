import { useEffect, useId, useRef, useState } from "react";
import { useDialogFocus } from "../../lib/useDialogFocus.js";

// Two small pieces the live browser views share (BrowserLive.jsx, screens/OrdenadorV2.jsx):
//  - WatchedView: while you only watch, what you see is a picture of the bot's browser, so a
//    click or a key on it never reaches the page. The first one asks «¿Quieres tomar el
//    control?» instead of doing nothing, with the same «Tomar el control» button.
//  - HandBack: «Devolver el control» and an optional note for the bot, as one step. The bot
//    reads the note at its next round as your words about how you left the page; it approves
//    nothing (server/computer/routes.mjs returnNoteText).

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
        <div ref={prompt} data-take-prompt="" role="dialog" aria-labelledby={title} style={{ position: "absolute", left: "16px", right: "16px", bottom: "16px", margin: "0 auto", maxWidth: "440px", display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "var(--r-lg)", background: "var(--c-card)", color: "var(--c-text)", boxShadow: "var(--c-shadow-pop)", textAlign: "left" }}>
          <strong id={title} style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{"¿Quieres tomar el control?"}</strong>
          <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-text-2)" }}>{`Ahora solo estás mirando. Si lo tomas, ${name} se para y espera sin tocar nada hasta que se lo devuelvas.`}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" data-autofocus="" className="colmena-live-btn" disabled={busy} onClick={() => { close(); onTake(); }} style={takeStyle}>{"Tomar el control"}</button>
            <button type="button" className="colmena-live-btn" onClick={close} style={quietStyle}>{"Seguir mirando"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** How a sentence names the bot: «a Nora» / «al bot», «de Nora» / «del bot», «Nora» / «el bot». */
export const botWords = (name) => (name
  ? { to: "a " + name, of: "de " + name, who: name, Who: name }
  : { to: "al bot", of: "del bot", who: "el bot", Who: "El bot" });

/**
 * Giving the control back, as one step: an optional note for the bot and the button that sends
 * both. Enter in the note gives the control back too.
 * @param {object} p
 * @param {string|null} p.name the bot's name (null when unknown)
 * @param {string} p.value
 * @param {(value: string) => void} p.onChange
 * @param {() => void} p.onSubmit
 * @param {boolean} [p.busy] the hand-back is on its way
 * @param {boolean} [p.disabled]
 * @param {object} [p.style] the step's own box
 */
export function HandBack({ name, value, onChange, onSubmit, busy = false, disabled = false, style = null }) {
  const id = useId();
  const hint = useId();
  const w = botWords(name);
  return (
    <form
      className="bl-back"
      aria-label={"Devolver el control " + w.to}
      onSubmit={(e) => { e.preventDefault(); if (!busy && !disabled) onSubmit(); }}
      style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px 14px", borderRadius: "var(--r-md)", background: "var(--c-sunken)", minWidth: 0, ...style }}
    >
      <label htmlFor={id} style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)" }}>
        {`¿Algo que deba saber ${w.who}?`} <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{"Opcional"}</span>
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <input
          id={id} type="text" value={value} maxLength={NOTE_MAX} disabled={busy || disabled} aria-describedby={hint}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ej.: ya inicié sesión, sigue desde el carrito"
          className="bl-note"
        />
        <button type="submit" className="bl-give" disabled={busy || disabled}>
          {busy ? "Devolviendo…" : "Devolver el control " + w.to}
        </button>
      </div>
      <span id={hint} style={{ fontSize: "var(--t-caption)", lineHeight: 1.4, color: "var(--c-text-3)" }}>{`${w.Who} lo leerá al seguir. Un recado no aprueba nada por ti.`}</span>
    </form>
  );
}

/** HandBack's and the live view's own controls (BrowserLive.jsx, screens/OrdenadorV2.jsx). */
export const HANDBACK_CSS = `
.bl-note{flex:1 1 200px;min-width:0;height:40px;padding:0 12px;border:1px solid var(--c-line-strong);border-radius:var(--r-sm);background:var(--c-card);font:400 var(--t-ui)/1.3 'Geist',sans-serif;color:var(--c-text);outline:none}
.bl-note::placeholder{color:var(--c-placeholder,var(--c-text-4))}
.bl-note:focus-visible{border-color:var(--c-focus);box-shadow:0 0 0 1px var(--c-focus)}
.bl-give,.bl-btn{flex:0 0 auto;height:40px;padding:0 14px;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:var(--r-sm);background:var(--c-btn);color:var(--c-btn-text);font:600 var(--t-ui)/1 'Geist',sans-serif;cursor:pointer;transition:background .12s ease}
.bl-give:hover:not(:disabled),.bl-btn:hover:not(:disabled){background:var(--c-btn-hover)}
.bl-btn--quiet{background:var(--c-card);color:var(--c-text);box-shadow:inset 0 0 0 1px var(--c-line-strong);font-weight:500}
.bl-btn--quiet:hover:not(:disabled){background:var(--c-hover)}
.bl-give:disabled,.bl-btn:disabled{opacity:.55;cursor:not-allowed}
.bl-give:focus-visible,.bl-btn:focus-visible{outline:2px solid var(--c-focus);outline-offset:2px}
`;

/** The body of the hand-back call: the note only when something was written. */
export const returnBody = (missionId, botId, note) => ({ missionId, action: "return", ...(botId ? { botId } : {}), ...(String(note || "").trim() ? { note: String(note).trim().slice(0, NOTE_MAX) } : {}) });
