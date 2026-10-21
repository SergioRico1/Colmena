import { useCallback, useEffect, useRef, useState } from "react";
import { get, post } from "../../lib/api.js";
import { plain } from "../room/Markdown.jsx";

// Voz: «Escuchar» with the browser's speechSynthesis (in Electron, the Windows voices) and
// dictation in the composers. Dictation uses the Web Speech API when it exists and works;
// otherwise MediaRecorder + POST /api/voice/transcribe (only with an OpenAI API key). When
// there is no way to do it the button is not rendered: never a dead button.

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

/* ───────────── dictation ───────────── */

const BROKEN_KEY = "colmena:dictado-web";
const readBroken = () => {
  try {
    return localStorage.getItem(BROKEN_KEY) === "no";
  } catch {
    return false;
  }
};
const writeBroken = () => {
  try {
    localStorage.setItem(BROKEN_KEY, "no");
  } catch {}
};
let serverStatus = null;
function transcribeStatus() {
  serverStatus ??= get("/voice/status").then((s) => !!s?.transcribe).catch(() => {
    serverStatus = null;
    return false;
  });
  return serverStatus;
}
const MAX_MS = 120000;
const toBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
  reader.onerror = () => reject(Error("No se pudo leer el audio."));
  reader.readAsDataURL(blob);
});

/**
 * Dictation: {available, state:'idle'|'listening'|'transcribing', error, start, stop}.
 * `onText(text)` receives each finished phrase.
 */
export function useDictation({ onText }) {
  const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const canRecord = typeof window !== "undefined" && typeof window.MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;
  const [webBroken, setWebBroken] = useState(readBroken);
  const [server, setServer] = useState(false);
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const recognition = useRef(null);
  const recorder = useRef(null);
  const timer = useRef(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  useEffect(() => {
    let alive = true;
    if (canRecord) transcribeStatus().then((ok) => alive && setServer(ok));
    return () => {
      alive = false;
    };
  }, [canRecord]);

  const mode = Recognition && !webBroken ? "web" : canRecord && server ? "server" : null;

  const cleanup = useCallback(() => {
    clearTimeout(timer.current);
    try { recognition.current?.abort?.(); } catch {}
    recognition.current = null;
    const r = recorder.current;
    recorder.current = null;
    if (r && r.state !== "inactive") {
      r.onstop = null;
      try { r.stop(); } catch {}
    }
    r?.stream?.getTracks?.().forEach((t) => t.stop());
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const startServer = useCallback(async () => {
    setError(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("No puedo usar el micrófono. Revisa el permiso del micrófono en Windows.");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"].find((t) => window.MediaRecorder.isTypeSupported?.(t)) || "";
    const r = new window.MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const parts = [];
    const began = Date.now();
    r.stream = stream;
    r.ondataavailable = (e) => e.data?.size && parts.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      clearTimeout(timer.current);
      const blob = new Blob(parts, { type: r.mimeType || type || "audio/webm" });
      if (!blob.size) return setState("idle");
      setState("transcribing");
      try {
        const { text } = await post("/voice/transcribe", { audio: await toBase64(blob), mime: blob.type || "audio/webm", durationMs: Date.now() - began });
        if (text) textRef.current?.(text);
        else setError("No he entendido nada. Prueba a hablar más cerca del micrófono.");
      } catch (e) {
        setError(e.message);
      } finally {
        setState("idle");
      }
    };
    recorder.current = r;
    r.start(1000);
    setState("listening");
    timer.current = setTimeout(() => recorder.current?.state === "recording" && recorder.current.stop(), MAX_MS);
  }, []);

  const startWeb = useCallback(() => {
    setError(null);
    const rec = new Recognition();
    rec.lang = "es-ES";
    rec.interimResults = false;
    rec.continuous = true;
    let heard = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal && r[0]?.transcript?.trim()) {
          heard = true;
          textRef.current?.(r[0].transcript.trim());
        }
      }
    };
    rec.onerror = (e) => {
      const code = e?.error;
      if (code === "not-allowed") {
        setError("No puedo usar el micrófono. Revisa el permiso del micrófono en Windows.");
        return;
      }
      if (code === "no-speech" || code === "aborted") return;
      // network / service-not-allowed / language-not-supported: this computer has no speech service.
      if (!heard) {
        writeBroken();
        setWebBroken(true);
        recognition.current = null;
        if (canRecord && server) void startServer();
        else setError("El dictado no está disponible en este ordenador.");
      }
    };
    rec.onend = () => {
      if (recognition.current === rec) recognition.current = null;
      setState((s) => (s === "listening" && !recorder.current ? "idle" : s));
    };
    recognition.current = rec;
    try {
      rec.start();
      setState("listening");
      timer.current = setTimeout(() => recognition.current?.stop?.(), MAX_MS);
    } catch {
      writeBroken();
      setWebBroken(true);
      recognition.current = null;
      if (canRecord && server) void startServer();
    }
  }, [Recognition, canRecord, server, startServer]);

  const start = useCallback(() => {
    if (state !== "idle") return;
    if (mode === "web") startWeb();
    else if (mode === "server") void startServer();
  }, [mode, state, startWeb, startServer]);
  const stop = useCallback(() => {
    clearTimeout(timer.current);
    if (recognition.current) {
      try { recognition.current.stop(); } catch {}
      return;
    }
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  return { available: !!mode || state !== "idle", mode, state, error, start, stop, clearError: () => setError(null) };
}

/** Microphone button for a composer. Renders nothing when dictation is impossible here. */
export function MicButton({ onText, style, size = 40, bordered = false }) {
  const d = useDictation({ onText });
  if (!d.available && !d.error) return null;
  if (!d.available) {
    return <span role="alert" style={{ fontSize: "12px", color: "#B4372A", fontWeight: "600", maxWidth: "220px" }}>{d.error}</span>;
  }
  const listening = d.state === "listening";
  const busy = d.state === "transcribing";
  return (
    <span style={{ position: "relative", display: "flex" }}>
      <button type="button" className="rm-focus" aria-pressed={listening ? "true" : "false"} aria-busy={busy ? "true" : undefined} disabled={busy}
        aria-label={listening ? "Dejar de dictar" : busy ? "Pasando tu voz a texto" : "Dictar con el micrófono"} title={listening ? "Escuchando… pulsa para terminar" : busy ? "Pasando a texto…" : "Dictar (hasta 2 minutos)"}
        onClick={() => { d.clearError(); listening ? d.stop() : d.start(); }}
        style={{ width: size + "px", height: size + "px", display: "grid", placeItems: "center", background: listening ? "#FBE7DF" : "transparent", border: listening ? "1.5px solid #B4372A" : bordered ? "1px solid #DCE0E8" : "0", borderRadius: "10px", cursor: busy ? "progress" : "pointer", color: listening ? "#B4372A" : "inherit", ...style }}>
        {busy ? (
          <span aria-hidden="true" style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid #C9CCD6", borderTopColor: "#12131A", animation: "colmena-spin .8s linear infinite" }} />
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={listening ? { animation: "colmena-pulse 1.2s ease-in-out infinite" } : undefined}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        )}
      </button>
      {d.error ? (
        <span role="alert" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "0", width: "max-content", maxWidth: "260px", padding: "6px 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "8px", fontSize: "12px", color: "#B4372A", fontWeight: "600", zIndex: "5" }}>{d.error}</span>
      ) : null}
    </span>
  );
}

/** Appends dictated text to a composer value. */
export const appendDictation = (setText) => (said) => setText((prev) => (prev && !/\s$/.test(prev) ? prev + " " : prev || "") + said);
