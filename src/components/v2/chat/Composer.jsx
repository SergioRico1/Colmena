import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, Plus, ArrowUp } from "../../Icon.js";
import { DictationHelp, EngineTag, LiveWords, useDictation } from "../../interaction/Voice.jsx";
import PastedCard from "../../room/PastedCard.jsx";
import { FileCard } from "../../room/common.jsx";
import { MESSAGE_MAX, dropOverlay } from "../../../lib/useFileDrop.js";
import { MentionMirror, findMentions } from "../MentionPill.jsx";

// The Colmena 2.0 writing capsule (design/V2Conversacion.dc.html): a white pill with the text,
// «Detener» while the bot works, the microphone (dark capsule while you speak, up to 2 minutes:
// the words as they arrive with this computer's recognizer, a wave that follows your voice with
// an OpenAI key and «Pasando tu voz a texto…» after) and send. Files: «+», drop or paste.
const MAX_S = 120;

export default function Composer({ value, onChange, onKeyDown, onSubmit, placeholder, label, working, onStop, inputRef, inputProps = {}, files = [], onRemoveFile, onInlinePasted, onAttach, attachOpen = null, chips = [], onRemoveChip, mentionBots = [], drop = null, menu = null, above = null, below = null, busy = false, v3 = false, tools = null, dictationScope = null }) {
  // «@Vera» shows as a pill while you write (MentionMirror behind the textarea).
  const mirror = useRef(null);
  const pills = mentionBots.length > 0 && findMentions(value, mentionBots).length > 0;
  const [since, setSince] = useState(0);
  const [k, setK] = useState(0);
  // Dictation goes where the caret was (the box is swapped for the live words meanwhile) and
  // never into another chat: `dictationScope` names the one it belongs to.
  const ownBox = useRef(null);
  const box = inputRef || ownBox;
  const d = useDictation({ onText: (said) => onChange((prev) => (prev && !/\s$/.test(prev) ? prev + " " : prev || "") + said), target: box, scope: dictationScope });
  const rec = d.state === "listening" || d.state === "starting";
  const trans = d.state === "transcribing";
  const live = rec && d.mode === "sistema";
  useEffect(() => {
    if (!rec) return undefined;
    setSince(Date.now());
    const t = setInterval(() => setK((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [rec]);
  const secs = rec ? Math.min(MAX_S, Math.floor((Date.now() - since) / 1000)) : 0;
  const bars = Array.from({ length: 40 }, (_, i) => { const v = Math.abs(Math.sin((k + i * 3) * 0.55) * Math.cos((k * 0.7 + i) * 0.31)); return { h: Math.round(4 + v * 26) + "px", o: (0.45 + v * 0.55).toFixed(2) }; });
  const round = { width: "46px", height: "46px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "var(--r-circle)", cursor: "pointer" };
  const chipRow = chips.length ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", ...(v3 ? { padding: "12px 14px 0" } : { margin: "0 0 10px 12px" }) }}>
      {chips.map((c) => (
        <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "32px", padding: "0 6px 0 14px", borderRadius: v3 ? "var(--r-md)" : "var(--r-pill)", background: v3 ? "var(--c-hover)" : "var(--c-card)", boxShadow: v3 ? "none" : "0 0 0 1px rgba(18,19,26,.08)", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)", animation: "pop .25s ease-out", ...(c.icon ? { gap: "7px", paddingLeft: "8px" } : {}) }}>
          {c.icon || null}
          {c.label}
          <button type="button" onClick={() => onRemoveChip?.(c.key)} aria-label={"Quitar " + c.label} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "transparent", cursor: "pointer", color: "var(--c-text-3)" }}>
            <X size={12} weight="bold" />
          </button>
        </span>
      ))}
    </div>
  ) : null;
  const fileRow = files.length ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", ...(v3 ? { padding: "12px 14px 0" } : { margin: "0 0 10px 12px" }) }}>
      {files.map((f, i) => <span key={f.name + ":" + i} style={{ display: "inline-flex", maxWidth: "100%", animation: "pop .25s ease-out" }}>{f.pasted ? <PastedCard file={f} onInline={String(f.content || "").length <= MESSAGE_MAX ? () => onInlinePasted?.(i) : null} onRemove={() => onRemoveFile(i)} /> : <FileCard file={f} onRemove={() => onRemoveFile(i)} />}</span>)}
    </div>
  ) : null;
  // `v3` (design/V3Chat.dc.html): a white card anchored at the bottom — what you attach, the
  // text, and a toolbar: «+», the screen's own buttons and chips (`tools`), dictate and send.
  if (v3) {
    const ghost = { width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "var(--r-md)", background: "transparent", color: "var(--c-text-2)", cursor: "pointer" };
    return (
      <form onSubmit={onSubmit} {...(drop?.props || {})} style={{ position: "relative", flex: "none", width: "100%", padding: "0 28px 20px" }}>
        <div style={{ position: "relative", maxWidth: "764px", margin: "0 auto" }}>
          {above}
          {d.error ? <DictationHelp problem={d.error} onClose={d.clearError} style={{ margin: "0 0 10px auto", maxWidth: "min(440px, 100%)" }} /> : null}
          {(rec || trans) && d.where?.fallback ? <p role="note" style={{ margin: "0 0 8px", fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-2)", textAlign: "right" }}>{d.where.note}</p> : null}
          <div className="c-ring" style={{ position: "relative", display: "flex", flexDirection: "column", borderRadius: "var(--r-2xl)", transition: "background .3s ease", background: rec ? "#12131A" : "var(--c-card)", boxShadow: "0 1px 2px rgba(18,19,26,.06), 0 18px 44px -24px rgba(18,19,26,.4)" }}>
            {drop?.dragging ? <div aria-hidden="true" style={{ ...dropOverlay, borderRadius: "var(--r-2xl)" }}>{"Suelta aquí para adjuntar"}</div> : null}
            {menu}
            {rec ? (
              <div role="status" style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "62px", padding: "8px 8px 8px 18px", animation: "fade .2s ease-out" }}>
                <span aria-hidden="true" style={{ width: "10px", height: "10px", flex: "none", borderRadius: "var(--r-circle)", background: "#FF5A4E", animation: "halo 1.4s ease-out infinite", transform: live ? `scale(${1 + d.level * 0.5})` : undefined, transition: "transform .1s linear" }} />
                {live ? <LiveWords d={d} dark style={{ flex: "1", fontSize: "var(--t-read)", lineHeight: "32px" }} /> : (
                  <span aria-hidden="true" style={{ flex: "1", minWidth: "0", height: "32px", display: "flex", alignItems: "center", gap: "3px", overflow: "hidden" }}>
                    {bars.map((b, i) => <span key={i} style={{ width: "3px", flex: "none", borderRadius: "var(--r-xs)", background: "var(--c-card)", transition: "height .1s linear", height: b.h, opacity: b.o }} />)}
                  </span>
                )}
                <span style={{ font: "500 var(--t-ui)/1 'Geist Mono', monospace", color: "#FFFFFF" }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} / 2:00`}</span>
                {live ? null : <span style={{ fontSize: "var(--t-meta)", color: "#C9CBD3", whiteSpace: "nowrap" }}>{"Escuchando… pulsa para terminar"}</span>}
                <EngineTag where={d.where} dark note={false} style={{ flex: "none" }} />
                <button type="button" onClick={d.stop} aria-label="Dejar de dictar" style={{ ...round, background: "var(--c-card)" }}><span aria-hidden="true" style={{ width: "14px", height: "14px", borderRadius: "var(--r-xs)", background: "#12131A" }} /></button>
              </div>
            ) : trans ? (
              <div role="status" style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "62px", padding: "8px 18px", animation: "fade .2s ease-out" }}>
                <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "var(--r-circle)", border: "2px solid rgb(var(--c-ink-rgb) / .15)", borderTopColor: "var(--c-text)", animation: "spin .8s linear infinite" }} />
                <span style={{ fontSize: "var(--t-read)", fontWeight: "500", background: "linear-gradient(90deg, #6B6F7A 0%, #6B6F7A 35%, #12131A 50%, #6B6F7A 65%, #6B6F7A 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2s linear infinite" }}>{"Pasando tu voz a texto…"}</span>
                <EngineTag where={d.where} note={false} />
              </div>
            ) : <>
              {chipRow}
              {fileRow}
              <label style={{ display: "flex", position: "relative", padding: "10px 18px 4px" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}</span>
                {pills ? <MentionMirror ref={mirror} value={value} bots={mentionBots} style={{ padding: "10px 18px 4px", fontSize: "var(--t-read)", lineHeight: "1.5", fontFamily: "inherit" }} /> : null}
                <textarea className="c-bare" ref={box} rows="2" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} {...inputProps}
                  onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
                  style={{ position: "relative", flex: "1", minWidth: "0", minHeight: "46px", maxHeight: "200px", padding: 0, border: "0", background: "transparent", fontSize: "var(--t-read)", lineHeight: "1.5", resize: "none", fieldSizing: "content", fontFamily: "inherit", ...(pills ? { color: "transparent", caretColor: "var(--c-text)" } : {}) }} />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px 10px" }}>
                {onAttach ? (
                  <button type="button" onClick={onAttach} data-plus-toggle="" aria-label={attachOpen === null ? "Adjuntar" : "Añadir"} title={attachOpen === null ? "Adjuntar archivo" : "Añadir archivos, herramientas o apps"}
                    {...(attachOpen === null ? {} : { "aria-haspopup": "menu", "aria-expanded": attachOpen ? "true" : "false" })} style={{ ...ghost, background: attachOpen ? "var(--c-chip)" : "transparent" }}>
                    <Plus size={18} />
                  </button>
                ) : null}
                <div style={{ flex: "1", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" }}>{tools}</div>
                {working ? <button type="button" onClick={onStop} aria-label="Detener" title="Detener (Esc)" style={{ ...ghost, width: "38px", height: "38px", borderRadius: "var(--r-circle)" }}><span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-xs)", background: "#12131A" }} /></button> : null}
                {d.available || d.fixable ? (
                  <button type="button" onClick={d.fixable && d.error ? d.clearError : d.start} aria-label={d.fixable ? "El dictado no está disponible: ver cómo activarlo" : "Dictar"} title={d.fixable ? "Dictado no disponible" : "Dictar (hasta 2 minutos)" + (d.where ? " · " + d.where.where : "")} style={{ ...ghost, width: "38px", height: "38px", borderRadius: "var(--r-circle)", color: d.fixable ? "#A3A6AF" : "var(--c-text-2)" }}>
                    {d.fixable ? <MicOff size={18} strokeWidth={1.9} aria-hidden="true" /> : <Mic size={18} strokeWidth={1.9} aria-hidden="true" />}
                  </button>
                ) : null}
                <button type="submit" aria-label="Enviar" disabled={busy} style={{ ...round, width: "40px", height: "40px", background: String(value || "").trim() || files.length ? "var(--c-btn)" : "#C9CBD1", color: "var(--c-btn-text)", transition: "background .2s ease" }}>
                  <ArrowUp size={17} weight="bold" />
                </button>
              </div>
            </>}
          </div>
          {below}
        </div>
      </form>
    );
  }
  return (
    <form onSubmit={onSubmit} {...(drop?.props || {})} style={{ position: "relative", flex: "none", width: "100%", maxWidth: "860px", margin: "0 auto", padding: "6px clamp(20px, 4vw, 44px) 22px" }}>
      {above}
      {d.error ? <DictationHelp problem={d.error} onClose={d.clearError} style={{ margin: "0 0 10px auto", maxWidth: "min(440px, 100%)" }} /> : null}
          {(rec || trans) && d.where?.fallback ? <p role="note" style={{ margin: "0 0 8px", fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-2)", textAlign: "right" }}>{d.where.note}</p> : null}
      {chipRow}
      {fileRow}
      <div className="c-ring" style={{ position: "relative", display: "flex", alignItems: "center", gap: "8px", minHeight: "62px", padding: "8px 8px 8px 18px", borderRadius: "var(--r-3xl)", transition: "background .3s ease, box-shadow .3s ease", background: rec ? "#12131A" : "var(--c-card)", boxShadow: rec ? "0 20px 50px -20px rgba(18,19,26,.6)" : "0 1px 2px rgba(18,19,26,.05), 0 20px 50px -24px rgba(18,19,26,.35)" }}>
        {drop?.dragging ? <div aria-hidden="true" style={{ ...dropOverlay, borderRadius: "var(--r-3xl)" }}>{"Suelta aquí para adjuntar"}</div> : null}
        {menu}
        {rec ? (
          <div role="status" style={{ flex: "1", minWidth: "0", display: "flex", alignItems: "center", gap: "14px", animation: "fade .2s ease-out" }}>
            <span aria-hidden="true" style={{ width: "10px", height: "10px", flex: "none", borderRadius: "var(--r-circle)", background: "#FF5A4E", animation: "halo 1.4s ease-out infinite", transform: live ? `scale(${1 + d.level * 0.5})` : undefined, transition: "transform .1s linear" }} />
            {live ? (
              <LiveWords d={d} dark style={{ flex: "1", fontSize: "var(--t-read)", lineHeight: "32px" }} />
            ) : (
              <span aria-hidden="true" style={{ flex: "1", minWidth: "0", height: "32px", display: "flex", alignItems: "center", gap: "3px", overflow: "hidden" }}>
                {bars.map((b, i) => <span key={i} style={{ width: "3px", flex: "none", borderRadius: "var(--r-xs)", background: "var(--c-card)", transition: "height .1s linear", height: b.h, opacity: b.o }} />)}
              </span>
            )}
            <span style={{ font: "500 var(--t-ui)/1 'Geist Mono', monospace", color: "#FFFFFF" }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} / 2:00`}</span>
            {live ? null : <span style={{ fontSize: "var(--t-meta)", color: "#C9CBD3", whiteSpace: "nowrap" }}>{"Escuchando… pulsa para terminar"}</span>}
                <EngineTag where={d.where} dark note={false} style={{ flex: "none" }} />
            <button type="button" onClick={d.stop} aria-label="Dejar de dictar" style={{ ...round, background: "var(--c-card)" }}>
              <span aria-hidden="true" style={{ width: "14px", height: "14px", borderRadius: "var(--r-xs)", background: "#12131A" }} />
            </button>
          </div>
        ) : trans ? (
          <div role="status" style={{ flex: "1", minWidth: "0", height: "46px", display: "flex", alignItems: "center", gap: "12px", animation: "fade .2s ease-out" }}>
            <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "var(--r-circle)", border: "2px solid rgb(var(--c-ink-rgb) / .15)", borderTopColor: "var(--c-text)", animation: "spin .8s linear infinite" }} />
            <span style={{ fontSize: "var(--t-read)", fontWeight: "500", background: "linear-gradient(90deg, #6B6F7A 0%, #6B6F7A 35%, #12131A 50%, #6B6F7A 65%, #6B6F7A 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2s linear infinite" }}>{"Pasando tu voz a texto…"}</span>
                <EngineTag where={d.where} note={false} />
          </div>
        ) : (
          <div style={{ flex: "1", minWidth: "0", display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ flex: "1", display: "flex", position: "relative", minWidth: 0 }}>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}</span>
              {pills ? <MentionMirror ref={mirror} value={value} bots={mentionBots} style={{ padding: "12px 6px", fontSize: "var(--t-read)", lineHeight: "1.4", fontFamily: "inherit" }} /> : null}
              <textarea className="c-bare" ref={box} rows="1" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} {...inputProps}
                onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
                style={{ position: "relative", flex: "1", minWidth: "0", minHeight: "46px", maxHeight: "200px", padding: "12px 6px", border: "0", background: "transparent", fontSize: "var(--t-read)", lineHeight: "1.4", resize: "none", fieldSizing: "content", fontFamily: "inherit", ...(pills ? { color: "transparent", caretColor: "var(--c-text)" } : {}) }} />
            </label>
            {onAttach ? (
              <button type="button" onClick={onAttach} data-plus-toggle="" aria-label={attachOpen === null ? "Adjuntar archivo" : "Añadir"} title={attachOpen === null ? "Adjuntar archivo" : "Añadir archivos, herramientas o apps"}
                {...(attachOpen === null ? {} : { "aria-haspopup": "menu", "aria-expanded": attachOpen ? "true" : "false" })}
                style={{ ...round, background: attachOpen ? "var(--c-btn)" : "rgb(var(--c-ink-rgb) / .05)", color: attachOpen ? "var(--c-btn-text)" : "#3D404A", transition: "background .2s ease, color .2s ease" }}>
                <Plus size={17} />
              </button>
            ) : null}
            {working ? (
              <button type="button" onClick={onStop} aria-label="Detener" title="Detener (Esc)" style={{ ...round, background: "rgb(var(--c-ink-rgb) / .08)" }}>
                <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-xs)", background: "#12131A" }} />
              </button>
            ) : null}
            {d.available || d.fixable ? (
              <button type="button" onClick={d.fixable && d.error ? d.clearError : d.start} aria-label={d.fixable ? "El dictado no está disponible: ver cómo activarlo" : "Dictar con el micrófono"} title={d.fixable ? "Dictado no disponible" : "Dictar (hasta 2 minutos)" + (d.where ? " · " + d.where.where : "")} style={{ ...round, background: "rgb(var(--c-ink-rgb) / .05)", color: d.fixable ? "#A3A6AF" : "var(--c-text-2)" }}>
                {d.fixable ? <MicOff size={18} strokeWidth={2} aria-hidden="true" /> : <Mic size={18} strokeWidth={2} aria-hidden="true" />}
              </button>
            ) : null}
            <button type="submit" aria-label="Enviar" disabled={busy} style={{ ...round, background: String(value || "").trim() || files.length ? "var(--c-btn)" : "#C9CBD1", color: "var(--c-btn-text)", transition: "background .2s ease" }}>
              <ArrowUp size={18} weight="bold" />
            </button>
          </div>
        )}
      </div>
      {below}
    </form>
  );
}
