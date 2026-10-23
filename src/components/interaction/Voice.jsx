import { useEffect, useRef, useState } from "react";
import { get } from "../../lib/api.js";
import { plain } from "../room/Markdown.jsx";

// Voz: «Escuchar» with the browser's speechSynthesis (in Electron, the Windows voices) and
// dictation in the composers (Dictation.jsx: the computer's own speech recognizer, else an
// OpenAI API key).

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

/** Voices of this computer; refreshed when the list loads (it arrives async on Windows). */
export function useVoices() {
  const [voices, setVoices] = useState(() => synth()?.getVoices?.() || []);
  useEffect(() => {
    const s = synth();
    if (!s) return undefined;
    const load = () => setVoices(s.getVoices() || []);
    load();
    s.addEventListener?.("voiceschanged", load);
    return () => s.removeEventListener?.("voiceschanged", load);
  }, []);
  return voices;
}

const isSpanish = (v) => /^es([-_]|$)/i.test(v.lang || "");
/** Spanish voices first (es-ES before other Spanish), then nothing else. */
export function spanishVoices(voices) {
  return voices.filter(isSpanish).sort((a, b) => Number(/^es[-_]ES$/i.test(b.lang)) - Number(/^es[-_]ES$/i.test(a.lang)) || a.name.localeCompare(b.name));
}
/** The bot's chosen voice if it is installed, else the first es-ES voice, else any Spanish voice. */
export function pickVoice(voices, voiceURI) {
  if (voiceURI) {
    const own = voices.find((v) => v.voiceURI === voiceURI || v.name === voiceURI);
    if (own) return own;
  }
  return spanishVoices(voices)[0] || null;
}

/** Splits long text into chunks the engine reads reliably (≈ 220 characters, at sentence ends). */
function chunks(text) {
  const out = [];
  let current = "";
  for (const part of String(text).split(/(?<=[.!?;:])\s+|\n+/)) {
    const piece = part.trim();
    if (!piece) continue;
    if ((current + " " + piece).length > 220 && current) {
      out.push(current);
      current = piece;
    } else current = current ? current + " " + piece : piece;
  }
  if (current) out.push(current);
  return out.flatMap((c) => (c.length > 400 ? c.match(/.{1,400}(\s|$)/g) || [c] : [c]));
}

let speakingId = null;
const listeners = new Set();
const announce = () => listeners.forEach((fn) => fn(speakingId));

export function stopSpeaking() {
  synth()?.cancel();
  speakingId = null;
  announce();
}

/** Reads `text` aloud with the bot's voice. Returns false when there is no voice to use. */
export function speak(text, voice, id = "x") {
  const s = synth();
  if (!s || !voice) return false;
  s.cancel();
  speakingId = id;
  announce();
  const parts = chunks(plain(text).slice(0, 12000));
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.voice = voice;
    u.lang = voice.lang || "es-ES";
    u.rate = 1;
    if (i === parts.length - 1) u.onend = u.onerror = () => {
      if (speakingId === id) {
        speakingId = null;
        announce();
      }
    };
    s.speak(u);
  });
  return true;
}

let seq = 0;
/** «Escuchar» / «Parar». Renders nothing when this computer has no Spanish voice. */
export function ListenButton({ text, bot, style, label = "Escuchar", compact = false }) {
  const voices = useVoices();
  const voice = pickVoice(voices, bot?.voice);
  const id = useRef(null);
  if (id.current === null) id.current = "say" + seq++;
  const [on, setOn] = useState(false);
  useEffect(() => {
    const fn = (current) => setOn(current === id.current);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      if (speakingId === id.current) stopSpeaking();
    };
  }, []);
  if (!voice || !String(text || "").trim()) return null;
  const toggle = () => (on ? stopSpeaking() : speak(text, voice, id.current));
  const name = bot?.name ? ` con la voz de ${bot.name}` : "";
  return (
    <button type="button" className="rm-focus" aria-pressed={on ? "true" : "false"} aria-label={on ? "Parar la lectura" : `${label}${name}`} title={on ? "Parar" : `${label} (${voice.name})`} onClick={toggle}
      style={compact
        ? { width: "40px", height: "40px", display: "grid", placeItems: "center", background: on ? "#FFF4D1" : "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "inherit", ...style }
        : { display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 10px", background: on ? "#FFF4D1" : "#FFFFFF", border: on ? "1.5px solid #12131A" : "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600", ...style }}>
      {on ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>
      )}
      {compact ? null : on ? "Parar" : label}
    </button>
  );
}

/** «Escuchar» for a text deliverable: loads its content on demand. */
export function ListenArtifactButton({ artifactId, bot, title }) {
  const voices = useVoices();
  const voice = pickVoice(voices, bot?.voice);
  const id = useRef(null);
  if (id.current === null) id.current = "doc" + seq++;
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const fn = (current) => setOn(current === id.current);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      if (speakingId === id.current) stopSpeaking();
    };
  }, []);
  if (!voice || !artifactId) return null;
  const toggle = async () => {
    if (on) return stopSpeaking();
    setLoading(true);
    try {
      const a = await get(`/artifacts/${encodeURIComponent(artifactId)}`);
      speak((title ? title + ". " : "") + String(a?.content || ""), voice, id.current);
    } catch {
      // Nothing to read: the card stays as it was.
    } finally {
      setLoading(false);
    }
  };
  return (
    <button type="button" className="rm-focus" aria-pressed={on ? "true" : "false"} aria-busy={loading ? "true" : undefined} aria-label={on ? "Parar la lectura" : `Escuchar ${title || "el entregable"}`} title={on ? "Parar" : "Escuchar"} onClick={toggle}
      style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: on ? "#FFF4D1" : "#FFFFFF", border: on ? "1.5px solid #12131A" : "1px solid #DCE0E8", borderRadius: "10px", cursor: loading ? "progress" : "pointer" }}>
      {on ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>}
    </button>
  );
}

/* ───────────── dictation (Dictation.jsx) ───────────── */

export { useDictation, MicButton, appendDictation, LiveWords, DictationHelp, useVoiceStatus, refreshVoiceStatus, setDictationEngine } from "./Dictation.jsx";
