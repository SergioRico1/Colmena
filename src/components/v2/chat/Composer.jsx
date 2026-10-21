import { useEffect, useRef, useState } from "react";
import { useDictation } from "../../interaction/Voice.jsx";
import PastedCard from "../../room/PastedCard.jsx";
import { FileCard } from "../../room/common.jsx";
import { MESSAGE_MAX, dropOverlay } from "../../../lib/useFileDrop.js";
import { MentionMirror, findMentions } from "../MentionPill.jsx";

// The Colmena 2.0 writing capsule (design/V2Conversacion.dc.html): a white pill with the text,
// «Detener» while the bot works, the microphone (dark capsule with a live wave while you speak,
// up to 2 minutes; «Pasando tu voz a texto…» after) and send. Files: «+», drop or paste.
const MAX_S = 120;

export default function Composer({ value, onChange, onKeyDown, onSubmit, placeholder, label, working, onStop, inputRef, inputProps = {}, files = [], onRemoveFile, onInlinePasted, onAttach, attachOpen = null, chips = [], onRemoveChip, mentionBots = [], drop = null, menu = null, above = null, below = null, busy = false }) {
  // «@Vera» shows as a pill while you write (MentionMirror behind the textarea).
  const mirror = useRef(null);
  const pills = mentionBots.length > 0 && findMentions(value, mentionBots).length > 0;
  const [since, setSince] = useState(0);
  const [k, setK] = useState(0);
  const d = useDictation({ onText: (said) => onChange((prev) => (prev && !/\s$/.test(prev) ? prev + " " : prev || "") + said) });
  const rec = d.state === "listening";
  const trans = d.state === "transcribing";
  useEffect(() => {
    if (!rec) return undefined;
    setSince(Date.now());
    const t = setInterval(() => setK((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [rec]);
  const secs = rec ? Math.min(MAX_S, Math.floor((Date.now() - since) / 1000)) : 0;
  const bars = Array.from({ length: 40 }, (_, i) => { const v = Math.abs(Math.sin((k + i * 3) * 0.55) * Math.cos((k * 0.7 + i) * 0.31)); return { h: Math.round(4 + v * 26) + "px", o: (0.45 + v * 0.55).toFixed(2) }; });
  const round = { width: "46px", height: "46px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", cursor: "pointer" };
  return (
    <form onSubmit={onSubmit} {...(drop?.props || {})} style={{ position: "relative", flex: "none", width: "100%", maxWidth: "860px", margin: "0 auto", padding: "6px clamp(20px, 4vw, 44px) 22px" }}>
      {above}
      {d.error ? (
        <p role="alert" style={{ margin: "0 0 10px 18px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#8E2A1F", animation: "rise .25s ease-out" }}>
          {/micr|permis|denied|allowed/i.test(d.error) ? "No puedo usar el micrófono. Revisa el permiso del micrófono en Windows." : d.error}
          <button type="button" onClick={d.clearError} style={{ height: "30px", padding: "0 10px", border: "0", borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: "600", color: "#12131A" }}>{"Entendido"}</button>
        </p>
      ) : null}
      {chips.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", margin: "0 0 10px 12px" }}>
          {chips.map((c) => (
            <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "32px", padding: "0 6px 0 14px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.08)", fontSize: "13px", fontWeight: 600, color: "#12131A", animation: "pop .25s ease-out" }}>
              {c.label}
              <button type="button" onClick={() => onRemoveChip?.(c.key)} aria-label={"Quitar " + c.label} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", margin: "0 0 10px 12px" }}>
          {files.map((f, i) => <span key={f.name + ":" + i} style={{ display: "inline-flex", maxWidth: "100%", animation: "pop .25s ease-out" }}>{f.pasted ? <PastedCard file={f} onInline={String(f.content || "").length <= MESSAGE_MAX ? () => onInlinePasted?.(i) : null} onRemove={() => onRemoveFile(i)} /> : <FileCard file={f} onRemove={() => onRemoveFile(i)} />}</span>)}
        </div>
      ) : null}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "8px", minHeight: "62px", padding: "8px 8px 8px 18px", borderRadius: "31px", transition: "background .3s ease, box-shadow .3s ease", background: rec ? "#12131A" : "#FFFFFF", boxShadow: rec ? "0 20px 50px -20px rgba(18,19,26,.6)" : "0 1px 2px rgba(18,19,26,.05), 0 20px 50px -24px rgba(18,19,26,.35)" }}>
        {drop?.dragging ? <div aria-hidden="true" style={{ ...dropOverlay, borderRadius: "31px" }}>{"Suelta aquí para adjuntar"}</div> : null}
        {menu}
        {rec ? (
          <div role="status" style={{ flex: "1", minWidth: "0", display: "flex", alignItems: "center", gap: "14px", animation: "fade .2s ease-out" }}>
            <span aria-hidden="true" style={{ width: "10px", height: "10px", flex: "none", borderRadius: "50%", background: "#FF5A4E", animation: "halo 1.4s ease-out infinite" }} />
            <span aria-hidden="true" style={{ flex: "1", minWidth: "0", height: "32px", display: "flex", alignItems: "center", gap: "3px", overflow: "hidden" }}>
              {bars.map((b, i) => <span key={i} style={{ width: "3px", flex: "none", borderRadius: "2px", background: "#FFFFFF", transition: "height .1s linear", height: b.h, opacity: b.o }} />)}
            </span>
            <span style={{ font: "500 14px/1 'Geist Mono', monospace", color: "#FFFFFF" }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} / 2:00`}</span>
            <span style={{ fontSize: "13px", color: "#C9CBD3", whiteSpace: "nowrap" }}>{"Escuchando… pulsa para terminar"}</span>
            <button type="button" onClick={d.stop} aria-label="Dejar de dictar" style={{ ...round, background: "#FFFFFF" }}>
              <span aria-hidden="true" style={{ width: "14px", height: "14px", borderRadius: "4px", background: "#12131A" }} />
            </button>
          </div>
        ) : trans ? (
          <div role="status" style={{ flex: "1", minWidth: "0", height: "46px", display: "flex", alignItems: "center", gap: "12px", animation: "fade .2s ease-out" }}>
            <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid rgba(18,19,26,.15)", borderTopColor: "#12131A", animation: "spin .8s linear infinite" }} />
            <span style={{ fontSize: "16px", fontWeight: "500", background: "linear-gradient(90deg, #8A8D96 0%, #8A8D96 35%, #12131A 50%, #8A8D96 65%, #8A8D96 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2s linear infinite" }}>{"Pasando tu voz a texto…"}</span>
          </div>
        ) : (
          <div style={{ flex: "1", minWidth: "0", display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ flex: "1", display: "flex", position: "relative", minWidth: 0 }}>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}</span>
              {pills ? <MentionMirror ref={mirror} value={value} bots={mentionBots} style={{ padding: "12px 6px", fontSize: "16px", lineHeight: "1.4", fontFamily: "inherit" }} /> : null}
              <textarea ref={inputRef} rows="1" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} {...inputProps}
                onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
                style={{ position: "relative", flex: "1", minWidth: "0", minHeight: "46px", maxHeight: "200px", padding: "12px 6px", border: "0", outline: "none", background: "transparent", fontSize: "16px", lineHeight: "1.4", resize: "none", fieldSizing: "content", fontFamily: "inherit", ...(pills ? { color: "transparent", caretColor: "#12131A" } : {}) }} />
            </label>
            {onAttach ? (
              <button type="button" onClick={onAttach} data-plus-toggle="" aria-label={attachOpen === null ? "Adjuntar archivo" : "Añadir"} title={attachOpen === null ? "Adjuntar archivo" : "Añadir archivos, herramientas o apps"}
                {...(attachOpen === null ? {} : { "aria-haspopup": "menu", "aria-expanded": attachOpen ? "true" : "false" })}
                style={{ ...round, background: attachOpen ? "#12131A" : "rgba(18,19,26,.05)", color: attachOpen ? "#FFFFFF" : "#3D404A", transition: "background .2s ease, color .2s ease" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            ) : null}
            {working ? (
              <button type="button" onClick={onStop} aria-label="Detener" title="Detener (Esc)" style={{ ...round, background: "rgba(18,19,26,.08)" }}>
                <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#12131A" }} />
              </button>
            ) : null}
            {d.available ? (
              <button type="button" onClick={d.start} aria-label="Dictar con el micrófono" title="Dictar (hasta 2 minutos)" style={{ ...round, background: "rgba(18,19,26,.05)", color: "#3D404A" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
              </button>
            ) : null}
            <button type="submit" aria-label="Enviar" disabled={busy} style={{ ...round, background: String(value || "").trim() || files.length ? "#12131A" : "#C9CBD1", color: "#FFFFFF", transition: "background .2s ease" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
            </button>
          </div>
        )}
      </div>
      {below}
    </form>
  );
}
