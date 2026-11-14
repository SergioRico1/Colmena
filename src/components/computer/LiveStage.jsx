import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Keyboard, LoaderCircle, ZoomIn, ZoomOut } from "../Icon.js";

// The picture of a bot's browser, and — when the person holds the control of a cloud browser —
// the page itself under their hands (docs/CLOUD.md › The bots' browser, POST /api/computer/input):
//   - the frame keeps the page's own aspect ratio (no letterbox) and fills the width it is given,
//     or, with `fill`, the largest box that fits its container (the enlarged view);
//   - a click lands where it was made, in the page's own pixels;
//   - the wheel or a finger dragged up and down scrolls the page;
//   - «Acercar» shows the page at twice the size inside a box you pan (a phone starts there): the
//     wheel and the finger then move the view, and «Subir»/«Bajar» scroll the page;
//   - while the frame has the keyboard (a click, Intro on the frame or «Teclado»), what you type
//     goes straight to the page: letters as text, Intro, Tab, Borrar, Supr, arrows, AvPág/RePág,
//     Inicio, Fin and Esc as keys. Esc twice (or Mayús+Tab, or «Soltar el teclado») gives the
//     keyboard back to Colmena. On a touch screen the same focus opens the on-screen keyboard;
//   - the toolbar holds the keys a phone keyboard lacks (Tab, Esc, arrows) and scrolling for
//     keyboard users.
// The page only gets what the protocol carries: click, type, key, scroll and open.

// KeyboardEvent.key → the key name the browser understands (server/cloud/browser-cloud.mjs › KEYS).
const KEYS = {
  Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  PageUp: "PageUp", PageDown: "PageDown", Home: "Home", End: "End",
};
// The hidden field always holds one character, so a phone's «borrar» has something to delete
// and reports it (beforeinput › deleteContentBackward) even when it sends no key code.
const SENTINEL = " ";
const ESC_WINDOW_MS = 1500;
const TYPE_PAUSE_MS = 140;
const SCROLL_STEP_PX = 60;
const SCROLL_GAP_MS = 350;
const DRAG_PX = 36;
const ZOOM = 2;

export const STAGE_CSS = `
.bl-stage{position:relative;display:block;width:100%;max-width:100%;margin:0 auto;overflow:hidden;background:var(--c-sunken);border-radius:var(--r-sm);outline:none;box-shadow:0 0 0 1px var(--c-line)}
.bl-stage[data-control]{cursor:crosshair;touch-action:none;box-shadow:0 0 0 1px var(--c-accent)}
.bl-stage[data-control]:focus-visible{outline:none;box-shadow:0 0 0 2px var(--c-focus)}
.bl-stage[data-control][data-typing]{box-shadow:0 0 0 2px var(--c-card),0 0 0 4px var(--c-focus)}
.bl-stage img{display:block;width:100%;height:100%;object-fit:fill;user-select:none;-webkit-user-drag:none}
.bl-fill{flex:1 1 auto;min-height:0;display:grid;place-items:center;container-type:size;padding:4px}
.bl-fill>.bl-stage{width:min(100cqw,calc(100cqh * var(--bl-ratio)));height:auto}
.bl-pan{overflow:auto;overscroll-behavior:contain;max-height:min(70vh,560px);padding:4px;border-radius:var(--r-sm);scrollbar-width:thin;scrollbar-color:var(--c-scroll) transparent}
.bl-fill.bl-pan{display:block;max-height:none}
.bl-pan>.bl-stage{width:calc(var(--bl-zoom) * 100%);max-width:none;margin:0}
.bl-pan>.bl-stage[data-control]{touch-action:pan-x pan-y;box-shadow:none}
.bl-pan:has(>.bl-stage[data-control]){outline:1px solid var(--c-accent);outline-offset:0}
.bl-pan:has(>.bl-stage:focus-visible){outline:2px solid var(--c-focus)}
.bl-pan:has(>.bl-stage[data-typing]){outline:3px solid var(--c-focus);outline-offset:2px}
.bl-sink{position:absolute;inset:0;width:100%;height:100%;padding:0;margin:0;border:0;opacity:0;resize:none;pointer-events:none;font-size:16px;color:transparent;background:transparent;caret-color:transparent}
.bl-caption{display:flex;align-items:center;gap:8px;min-height:20px;margin:0;font-size:var(--t-caption);line-height:1.4;color:var(--c-text-2)}
.bl-caption[data-typing]{color:var(--c-accent-ink);font-weight:500}
.bl-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.bl-key{height:30px;min-width:30px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--c-line-strong);border-radius:var(--r-sm);background:var(--c-card);color:var(--c-text);font:500 var(--t-meta)/1 'Geist',sans-serif;cursor:pointer;transition:background .12s ease,border-color .12s ease}
.bl-key:hover:not(:disabled){background:var(--c-hover)}
.bl-key:disabled{opacity:.5;cursor:not-allowed}
.bl-key[aria-pressed="true"]{background:var(--c-accent-soft);border-color:var(--c-accent);color:var(--c-accent-ink)}
.bl-key:focus-visible{outline:2px solid var(--c-focus);outline-offset:2px}
.bl-key--icon{padding:0}
.bl-key kbd{font:inherit}
.bl-sep{width:1px;height:20px;background:var(--c-line)}
@media (pointer: coarse){.bl-key{height:40px;min-width:40px}}
.bl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

/**
 * @param {object} p
 * @param {{image: string, url?: string, title?: string}} p.frame
 * @param {string} p.alt the picture's description
 * @param {string} p.label what the frame is, for screen readers («Página de Nora: app.colmena.team»)
 * @param {boolean} [p.control] the person holds the control of a browser that takes input here
 * @param {(body: object) => Promise<any>} [p.onInput] sends one input (POST /computer/input)
 * @param {(error: Error) => void} [p.onError]
 * @param {boolean} [p.fill] fit the largest box the container allows (the enlarged view)
 * @param {boolean} [p.startZoomed] begin at «Acercar» (a phone)
 * @param {(width: number) => void} [p.onWidth] the frame's drawn width, as it changes
 */
export default function LiveStage({ frame, alt, label, control = false, onInput, onError, fill = false, startZoomed = false, onWidth }) {
  const [size, setSize] = useState({ w: 1280, h: 800 });
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState(0);
  const [hint, setHint] = useState("");
  const [zoomed, setZoomed] = useState(startZoomed);
  const stage = useRef(null);
  const sink = useRef(null);
  const queue = useRef(Promise.resolve());
  const text = useRef("");
  const textTimer = useRef(null);
  const escAt = useRef(0);
  const drag = useRef(null);
  const wheel = useRef({ acc: 0, last: 0 });
  const hintId = useId();
  const zoom = control && zoomed ? ZOOM : 1;

  // One input at a time, in order: the page answers each with a fresh frame.
  const send = useCallback((body) => {
    if (!onInput) return;
    setPending((n) => n + 1);
    queue.current = queue.current.then(() => onInput(body)).catch((e) => onError?.(e)).finally(() => setPending((n) => n - 1));
  }, [onInput, onError]);
  const flush = useCallback(() => {
    clearTimeout(textTimer.current);
    const t = text.current;
    text.current = "";
    if (t) send({ kind: "type", text: t });
  }, [send]);
  // Letters typed close together travel as one piece of text.
  const typeText = (t) => {
    if (!t) return;
    text.current += t;
    clearTimeout(textTimer.current);
    textTimer.current = setTimeout(flush, TYPE_PAUSE_MS);
  };
  const press = (key) => { flush(); send({ kind: "key", key }); };
  const scroll = (up) => { flush(); send({ kind: "scroll", up }); };

  useEffect(() => () => clearTimeout(textTimer.current), []);
  useEffect(() => { if (!control) { setTyping(false); flush(); } }, [control, flush]);

  // The drawn width, for a column that lines up with the frame (BrowserLive's enlarged view).
  useEffect(() => {
    const el = stage.current;
    if (!el || !onWidth || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => onWidth(Math.round(el.getBoundingClientRect().width / zoom)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onWidth, zoom]);

  const capture = () => {
    const el = sink.current;
    if (!el) return;
    el.value = SENTINEL;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    try { el.setSelectionRange(1, 1); } catch { /* not laid out */ }
  };
  const release = () => { flush(); escAt.current = 0; setHint(""); stage.current?.focus({ preventScroll: true }); };

  // The wheel scrolls the page, not the panel around it (a native listener: React's is passive).
  // Zoomed in, it moves the view instead, as a finger does.
  useEffect(() => {
    const el = stage.current;
    if (!el || !control || zoom > 1) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const w = wheel.current;
      w.acc += e.deltaY;
      const now = Date.now();
      if (Math.abs(w.acc) < SCROLL_STEP_PX || now - w.last < SCROLL_GAP_MS) return;
      w.last = now;
      const up = w.acc < 0;
      w.acc = 0;
      flush();
      send({ kind: "scroll", up });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [control, zoom, send, flush]);

  // Text from the hidden field: beforeinput covers phone keyboards (no key codes), paste and IME.
  useEffect(() => {
    const el = sink.current;
    if (!el || !control) return undefined;
    const reset = () => { el.value = SENTINEL; try { el.setSelectionRange(1, 1); } catch { /* gone */ } };
    const onBefore = (e) => {
      if (e.isComposing || e.inputType === "insertCompositionText") return;
      if (e.inputType === "insertText" || e.inputType === "insertReplacementText") { e.preventDefault(); typeText(e.data ?? e.dataTransfer?.getData("text/plain") ?? ""); }
      else if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") { e.preventDefault(); press("Enter"); }
      else if (e.inputType === "deleteContentBackward") { e.preventDefault(); press("Backspace"); }
      else if (e.inputType === "deleteContentForward") { e.preventDefault(); press("Delete"); }
      else if (e.inputType !== "insertFromPaste") e.preventDefault();
    };
    const onPaste = (e) => { e.preventDefault(); typeText((e.clipboardData?.getData("text/plain") || "").slice(0, 2000)); };
    const onEnd = (e) => { typeText(e.data || ""); reset(); };
    const onInputEvent = (e) => { if (!e.isComposing) reset(); };
    el.addEventListener("beforeinput", onBefore);
    el.addEventListener("paste", onPaste);
    el.addEventListener("compositionend", onEnd);
    el.addEventListener("input", onInputEvent);
    return () => {
      el.removeEventListener("beforeinput", onBefore);
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("compositionend", onEnd);
      el.removeEventListener("input", onInputEvent);
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps -- rebinds with the latest handlers

  const onSinkKey = (e) => {
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // paste arrives as a paste; other shortcuts stay Colmena's
    if (e.key === "Tab" && e.shiftKey) return; // Mayús+Tab leaves the frame
    if (e.key === "Escape") {
      e.preventDefault();
      const now = Date.now();
      if (now - escAt.current < ESC_WINDOW_MS) { release(); return; }
      escAt.current = now;
      press("Escape");
      setHint("Esc ha llegado a la página. Pulsa Esc otra vez para volver a Colmena.");
      return;
    }
    escAt.current = 0;
    if (hint) setHint("");
    const key = KEYS[e.key];
    if (key) { e.preventDefault(); press(key); }
  };

  const onClick = (e) => {
    if (!control) return;
    if (drag.current?.moved) { drag.current = null; return; }
    drag.current = null;
    const img = stage.current?.querySelector("img");
    const r = (img || stage.current).getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * size.w);
    const y = Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * size.h);
    flush();
    send({ kind: "click", x, y });
    capture(); // a field you click is a field you type in; on a phone this opens the keyboard
  };
  // A finger dragged up or down scrolls the page (zoomed in, the browser pans the view instead).
  const onPointerDown = (e) => { if (control && zoom === 1 && e.pointerType !== "mouse") drag.current = { y: e.clientY, moved: false }; };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!control || !d || e.pointerType === "mouse") return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) < DRAG_PX) return;
    d.moved = true;
    d.y = e.clientY;
    scroll(dy > 0);
  };
  const onStageKey = (e) => {
    if (!control || e.target !== stage.current) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); capture(); }
  };

  // Zoomed in, the view opens on the middle of the page (where pages put their content).
  useEffect(() => {
    const pan = zoom > 1 ? stage.current?.parentElement : null;
    if (pan) pan.scrollLeft = Math.max(0, (pan.scrollWidth - pan.clientWidth) / 2);
  }, [zoom]);

  const caption = hint || (typing ? "Lo que escribes va a la página. Esc dos veces para volver a Colmena." : "Haz clic en la página donde quieras pulsar; luego escribe.")
    + (zoom > 1 && !hint ? " Desliza la vista para ver el resto." : "");
  const box = (
    <div
      ref={stage}
      data-bl-stage=""
      className="bl-stage"
      {...(control ? { "data-control": "", "data-autofocus": "", tabIndex: 0, role: "group", "aria-label": label, "aria-describedby": hintId } : {})}
      {...(typing ? { "data-typing": "" } : {})}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={onStageKey}
      style={{ aspectRatio: `${size.w} / ${size.h}`, "--bl-ratio": size.w / size.h, "--bl-zoom": zoom }}
    >
      <img src={frame.image} alt={alt} draggable={false}
        onLoad={(e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (w && h && (w !== size.w || h !== size.h)) setSize({ w, h }); }} />
      {control ? (
        <textarea
          ref={sink} className="bl-sink" tabIndex={-1} rows={1} defaultValue={SENTINEL}
          aria-label={"Escribir en la página: " + label} aria-describedby={hintId}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="enter"
          onFocus={() => setTyping(true)} onBlur={() => { setTyping(false); escAt.current = 0; setHint(""); flush(); }}
          onKeyDown={onSinkKey}
        />
      ) : null}
    </div>
  );
  const area = zoom > 1 ? <div className={"bl-pan" + (fill ? " bl-fill" : "")}>{box}</div> : fill ? <div className="bl-fill">{box}</div> : box;

  return (
    <>
      {area}
      {control ? (
        <>
          <span id={hintId} className="bl-sr">{"Haz clic donde quieras pulsar en la página. Intro empieza a escribir en ella; Esc dos veces o Mayús+Tab te devuelven a Colmena."}</span>
          <p className="bl-caption" {...(typing ? { "data-typing": "" } : {})}>
            <span role="status" style={{ flex: 1, minWidth: 0 }}>{caption}</span>
            {pending ? <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--c-text-3)" }}><LoaderCircle size={14} className="c-spin" aria-hidden="true" />{"Enviando"}</span> : null}
          </p>
          <div role="toolbar" aria-label="Teclas y desplazamiento de la página" className="bl-tools">
            <button type="button" className="bl-key" aria-pressed={typing}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => (typing ? release() : capture())}>
              <Keyboard size={16} /> {typing ? "Soltar el teclado" : "Teclado"}
            </button>
            <span className="bl-sep" aria-hidden="true" />
            {[["Tab", "Tab"], ["Escape", "Esc"]].map(([k, l]) => (
              <button key={k} type="button" className="bl-key" aria-label={"Tecla " + l} onPointerDown={(e) => e.preventDefault()} onClick={() => press(k)}><kbd>{l}</kbd></button>
            ))}
            <button type="button" className="bl-key bl-key--icon" aria-label="Tecla flecha arriba" title="Flecha arriba" onPointerDown={(e) => e.preventDefault()} onClick={() => press("ArrowUp")}><ChevronUp size={16} /></button>
            <button type="button" className="bl-key bl-key--icon" aria-label="Tecla flecha abajo" title="Flecha abajo" onPointerDown={(e) => e.preventDefault()} onClick={() => press("ArrowDown")}><ChevronDown size={16} /></button>
            <span className="bl-sep" aria-hidden="true" />
            <button type="button" className="bl-key" title="Desplazar la página hacia arriba" onPointerDown={(e) => e.preventDefault()} onClick={() => scroll(true)}>Subir</button>
            <button type="button" className="bl-key" title="Desplazar la página hacia abajo" onPointerDown={(e) => e.preventDefault()} onClick={() => scroll(false)}>Bajar</button>
            <button type="button" className="bl-key bl-key--icon" aria-pressed={zoomed} aria-label={zoomed ? "Alejar: ver la página entera" : "Acercar la página"} title={zoomed ? "Ver la página entera" : "Acercar"}
              onPointerDown={(e) => e.preventDefault()} onClick={() => setZoomed((z) => !z)}>
              {zoomed ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
