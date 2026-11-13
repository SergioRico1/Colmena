import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, Paperclip, PaperPlaneRight } from "../../Icon.js";
import { DictationHelp, EngineTag, LiveWords, useDictation } from "../../interaction/Voice.jsx";
import PastedCard from "../../room/PastedCard.jsx";
import { FileCard } from "../../room/common.jsx";
import { EmojiButton } from "../../room/ComposerBits.jsx";
import { MESSAGE_MAX, dropOverlay } from "../../../lib/useFileDrop.js";
import { MentionMirror, findMentions } from "../MentionPill.jsx";
import "../../../styles/conversation.css";

// The composer of a chat with a bot (Colmena 4: design/v4 › .cbox): one bar with attach and
// emoji, the text, the screen's own chips (`tools`: «Piensa», the model…), «Detener» while the bot
// works, the microphone and send. While you speak the bar turns ink (up to 2 minutes: the words
// as they arrive with this computer's recognizer, a wave that follows your voice with an OpenAI
// key and «Pasando tu voz a texto…» after). Files: the clip, drop or paste. `v3` is accepted
// from older callers and changes nothing.
const MAX_S = 120;

export default function Composer({ value, onChange, onKeyDown, onSubmit, placeholder, label, working, onStop, inputRef, inputProps = {}, files = [], onRemoveFile, onInlinePasted, onAttach, attachOpen = null, chips = [], onRemoveChip, mentionBots = [], drop = null, menu = null, above = null, below = null, busy = false, tools = null, dictationScope = null }) {
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
  const ready = !!String(value || "").trim() || files.length > 0;
  const insertAtCaret = (s) => {
    const el = box.current;
    const text = String(value || "");
    const at = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? at;
    onChange(text.slice(0, at) + s + text.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + s.length, at + s.length); });
  };
  const chipRow = chips.length || files.length ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 8px" }}>
      {chips.map((c) => (
        <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: c.icon ? "7px" : "4px", height: "30px", padding: c.icon ? "0 4px 0 8px" : "0 4px 0 10px", borderRadius: "var(--r-sm)", background: "var(--c-sunken)", border: "1px solid var(--c-line)", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)", animation: "pop .25s ease-out" }}>
          {c.icon || null}
          {c.label}
          <button type="button" className="c-hit" onClick={() => onRemoveChip?.(c.key)} aria-label={"Quitar " + c.label} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-xs)", background: "transparent", cursor: "pointer", color: "var(--c-text-3)" }}>
            <X size={12} weight="bold" />
          </button>
        </span>
      ))}
      {files.map((f, i) => <span key={f.name + ":" + i} style={{ display: "inline-flex", maxWidth: "100%", animation: "pop .25s ease-out" }}>{f.pasted ? <PastedCard file={f} onInline={String(f.content || "").length <= MESSAGE_MAX ? () => onInlinePasted?.(i) : null} onRemove={() => onRemoveFile(i)} /> : <FileCard file={f} onRemove={() => onRemoveFile(i)} />}</span>)}
    </div>
  ) : null;
  return (
    <form onSubmit={onSubmit} {...(drop?.props || {})} style={{ position: "relative", flex: "none", width: "100%", padding: "0 24px 18px", boxSizing: "border-box" }}>
      <div style={{ position: "relative", maxWidth: "820px", margin: "0 auto" }}>
        {above}
        {d.error ? <DictationHelp problem={d.error} onClose={d.clearError} style={{ margin: "0 0 10px auto", maxWidth: "min(440px, 100%)" }} /> : null}
        {(rec || trans) && d.where?.fallback ? <p role="note" style={{ margin: "0 0 8px", fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-2)", textAlign: "right" }}>{d.where.note}</p> : null}
        {rec || trans ? null : chipRow}
        <div style={{ position: "relative" }}>{menu}</div>
        <div className="v4-cbox" style={{ position: "relative", transition: "background .3s ease", ...(rec ? { background: "var(--c-btn)", borderColor: "var(--c-btn)", color: "var(--c-btn-text)" } : null) }}>
          {drop?.dragging ? <div aria-hidden="true" style={{ ...dropOverlay, borderRadius: "var(--r-md)" }}>{"Suelta aquí para adjuntar"}</div> : null}
          {rec ? (
            <div role="status" style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "center", gap: "14px", minHeight: "36px", padding: "0 0 0 8px", animation: "fade .2s ease-out" }}>
              <span aria-hidden="true" style={{ width: "10px", height: "10px", flex: "none", borderRadius: "var(--r-circle)", background: "var(--c-close)", animation: "halo 1.4s ease-out infinite", transform: live ? `scale(${1 + d.level * 0.5})` : undefined, transition: "transform .1s linear" }} />
              {live ? <LiveWords d={d} dark style={{ flex: "1", fontSize: "var(--t-read)", lineHeight: "32px" }} /> : (
                <span aria-hidden="true" style={{ flex: "1", minWidth: "0", height: "32px", display: "flex", alignItems: "center", gap: "3px", overflow: "hidden" }}>
                  {bars.map((b, i) => <span key={i} style={{ width: "3px", flex: "none", borderRadius: "var(--r-xs)", background: "var(--c-btn-text)", transition: "height .1s linear", height: b.h, opacity: b.o }} />)}
                </span>
              )}
              <span style={{ font: "500 var(--t-ui)/1 'Geist Mono', monospace", color: "var(--c-btn-text)" }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} / 2:00`}</span>
              {live ? null : <span style={{ fontSize: "var(--t-meta)", color: "color-mix(in oklab, var(--c-btn-text) 72%, transparent)", whiteSpace: "nowrap" }}>{"Escuchando… pulsa para terminar"}</span>}
              <EngineTag where={d.where} dark note={false} style={{ flex: "none" }} />
              <button type="button" onClick={d.stop} aria-label="Dejar de dictar" className="v4-send" style={{ background: "var(--c-btn-text)", color: "var(--c-btn)" }}><span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-xs)", background: "var(--c-btn)" }} /></button>
            </div>
          ) : trans ? (
            <div role="status" style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "center", gap: "12px", minHeight: "36px", padding: "0 8px", animation: "fade .2s ease-out" }}>
              <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "var(--r-circle)", border: "2px solid rgb(var(--c-ink-rgb) / .15)", borderTopColor: "var(--c-text)", animation: "spin .8s linear infinite" }} />
              <span style={{ fontSize: "var(--t-read)", fontWeight: "500", background: "linear-gradient(90deg, var(--c-text-3) 0%, var(--c-text-3) 35%, var(--c-text) 50%, var(--c-text-3) 65%, var(--c-text-3) 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2s linear infinite" }}>{"Pasando tu voz a texto…"}</span>
              <EngineTag where={d.where} note={false} />
            </div>
          ) : <>
            {onAttach ? (
              <button type="button" className="v4-ib" onClick={onAttach} data-plus-toggle="" aria-label={attachOpen === null ? "Adjuntar" : "Adjuntar archivos, herramientas o apps"} title={attachOpen === null ? "Adjuntar archivo" : "Añadir archivos, herramientas o apps"}
                {...(attachOpen === null ? {} : { "aria-haspopup": "menu", "aria-expanded": attachOpen ? "true" : "false" })} style={{ alignSelf: "flex-end" }}>
                <Paperclip size={18} />
              </button>
            ) : null}
            <EmojiButton onPick={insertAtCaret} />
            <label style={{ flex: "1 1 auto", display: "flex", position: "relative", minWidth: 0, alignSelf: "center" }}>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}</span>
              {pills ? <MentionMirror ref={mirror} value={value} bots={mentionBots} style={{ padding: "5px 6px", fontSize: "var(--t-read)", lineHeight: "1.4", fontFamily: "inherit" }} /> : null}
              <textarea className="c-bare" ref={box} rows="1" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} {...inputProps}
                onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
                style={{ position: "relative", flex: "1", minWidth: "0", minHeight: "32px", maxHeight: "200px", padding: "5px 6px", border: "0", background: "transparent", color: "var(--c-text)", fontSize: "var(--t-read)", lineHeight: "1.4", resize: "none", fieldSizing: "content", fontFamily: "inherit", ...(pills ? { color: "transparent", caretColor: "var(--c-text)" } : {}) }} />
            </label>
            {tools ? <div style={{ display: "flex", alignItems: "center", gap: "4px", alignSelf: "flex-end", minHeight: "36px" }}>{tools}</div> : null}
            {working ? <button type="button" className="v4-ib" onClick={onStop} aria-label="Detener" title="Detener (Esc)" style={{ alignSelf: "flex-end" }}><span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-xs)", background: "var(--c-text)" }} /></button> : null}
            {d.available || d.fixable ? (
              <button type="button" className="v4-ib" onClick={d.fixable && d.error ? d.clearError : d.start} aria-label={d.fixable ? "El dictado no está disponible: ver cómo activarlo" : "Dictar"} title={d.fixable ? "Dictado no disponible" : "Dictar (hasta 2 minutos)" + (d.where ? " · " + d.where.where : "")} style={{ alignSelf: "flex-end", color: d.fixable ? "var(--c-text-4)" : undefined }}>
                {d.fixable ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
              </button>
            ) : null}
            <button type="submit" className="v4-send" aria-label="Enviar" disabled={busy || !ready} style={{ alignSelf: "flex-end" }}>
              <PaperPlaneRight size={18} weight="fill" />
            </button>
          </>}
        </div>
        {below}
      </div>
    </form>
  );
}
