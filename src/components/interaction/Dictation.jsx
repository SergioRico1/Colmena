import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LoaderCircle, Mic, MicOff, Square } from "lucide-react";
import { get, patch, post } from "../../lib/api.js";

// Dictation in every composer (chats, rooms, Código, a new bot). The server picks the engine
// (server/voice.mjs): the speech recognizer of this computer first — Windows' offline one or
// macOS's — which listens to the microphone itself and sends the words live, so you see them
// while you speak; then, with an OpenAI API key, a recording sent for transcription. When
// neither works the microphone stays, quiet, and says why and how to fix it.

/* ───────────── status, shared by every composer and Ajustes ───────────── */

let status = null;
let loading = null;
const subscribers = new Set();
const publish = (next) => {
  status = next;
  subscribers.forEach((fn) => fn());
};
export function refreshVoiceStatus({ fresh = false } = {}) {
  loading = get("/voice/status" + (fresh ? "?fresh=1" : "")).then((s) => {
    publish(s);
    return s;
  }).catch(() => {
    publish(status || { mode: null, problem: null });
    return status;
  }).finally(() => { loading = null; });
  return loading;
}
export function useVoiceStatus() {
  const value = useSyncExternalStore((fn) => {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }, () => status);
  useEffect(() => {
    if (!status && !loading) void refreshVoiceStatus();
  }, []);
  return value;
}
/** Ajustes › «Dictado por voz»: auto | sistema | openai. */
export async function setDictationEngine(engine) {
  const next = await patch("/voice/settings", { engine });
  publish(next);
  return next;
}
export const openSystemSettings = (page) => post("/voice/open-settings", { page }).catch(() => {});

const MAX_MS = 120000;
const toBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
  reader.onerror = () => reject(Error("No se pudo leer el audio."));
  reader.readAsDataURL(blob);
});
const micProblem = (platform) => ({
  message: "No puedo usar el micrófono.",
  help: platform === "darwin" ? "Ajustes del Sistema › Privacidad y seguridad › Micrófono: activa Colmena." : "Configuración › Privacidad y seguridad › Micrófono: permite que las aplicaciones de escritorio lo usen.",
  open: "microphone",
});

/**
 * {available, mode, state:'idle'|'starting'|'listening'|'transcribing', partial, heard, level,
 *  error, problem, start, stop, toggle, clearError}. `onText(text)` gets each finished phrase;
 * `partial` is the phrase being spoken (system engine only) and `heard` all that this
 * dictation already wrote. `error`/`problem` are {message, help, open}.
 */
export function useDictation({ onText }) {
  const voice = useVoiceStatus();
  const canRecord = typeof window !== "undefined" && typeof window.MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;
  const mode = voice?.mode === "sistema" ? "sistema" : voice?.mode === "openai" && canRecord ? "openai" : null;
  const [state, setState] = useState("idle");
  const [partial, setPartial] = useState("");
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);
  const session = useRef(null);
  const recorder = useRef(null);
  const timer = useRef(null);
  const stopSoon = useRef(false);
  const textRef = useRef(onText);
  textRef.current = onText;

  const cleanup = useCallback(() => {
    clearTimeout(timer.current);
    const s = session.current;
    session.current = null;
    // Closing the stream ends the dictation on the server too.
    s?.source?.close();
    const r = recorder.current;
    recorder.current = null;
    if (r && r.state !== "inactive") {
      r.onstop = null;
      try { r.stop(); } catch {}
    }
    r?.stream?.getTracks?.().forEach((t) => t.stop());
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const finish = useCallback(() => {
    cleanup();
    setState("idle");
    setPartial("");
    setLevel(0);
  }, [cleanup]);

  const startSystem = useCallback(async () => {
    stopSoon.current = false;
    setState("starting");
    setPartial("");
    setHeard("");
    let id;
    try {
      ({ id } = await post("/voice/listen"));
    } catch (e) {
      setState("idle");
      setError({ message: e.message });
      void refreshVoiceStatus({ fresh: true });
      return;
    }
    const source = new EventSource(`/api/voice/listen/${encodeURIComponent(id)}/events`);
    session.current = { id, source };
    // «Stop» pressed while the microphone was still opening.
    if (stopSoon.current) {
      stopSoon.current = false;
      setState("transcribing");
      post(`/voice/listen/${encodeURIComponent(id)}/stop`).catch(() => {});
    }
    source.onmessage = (m) => {
      let event;
      try { event = JSON.parse(m.data); } catch { return; }
      if (event.type === "ready") setState((s) => (s === "starting" ? "listening" : s));
      else if (event.type === "level") setLevel(event.value || 0);
      else if (event.type === "partial") setPartial(event.text || "");
      else if (event.type === "final") {
        setPartial("");
        if (event.text) {
          textRef.current?.(event.text);
          setHeard((h) => (h ? h + " " : "") + event.text);
        }
      } else if (event.type === "error") {
        setError({ message: event.message, help: event.help, open: event.open });
        void refreshVoiceStatus({ fresh: true });
      } else if (event.type === "end") finish();
    };
    // The stream broke (server restarted): what was said is already in the box.
    source.onerror = () => {
      if (session.current?.source === source) finish();
    };
    timer.current = setTimeout(() => session.current?.id === id && post(`/voice/listen/${encodeURIComponent(id)}/stop`).catch(() => {}), MAX_MS + 1000);
  }, [finish]);

  const startOpenAI = useCallback(async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(micProblem(voice?.platform));
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
        else setError({ message: "No he entendido nada.", help: "Prueba a hablar más cerca del micrófono." });
      } catch (e) {
        setError({ message: e.message });
      } finally {
        setState("idle");
      }
    };
    recorder.current = r;
    r.start(1000);
    setHeard("");
    setState("listening");
    timer.current = setTimeout(() => recorder.current?.state === "recording" && recorder.current.stop(), MAX_MS);
  }, [voice?.platform]);

  const start = useCallback(() => {
    if (state !== "idle") return;
    setError(null);
    if (mode === "sistema") void startSystem();
    else if (mode === "openai") void startOpenAI();
    else if (voice?.problem) setError(voice.problem);
  }, [mode, state, startSystem, startOpenAI, voice?.problem]);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    const s = session.current;
    if (s) {
      setState("transcribing");
      post(`/voice/listen/${encodeURIComponent(s.id)}/stop`).catch(() => finish());
      return;
    }
    if (recorder.current?.state === "recording") recorder.current.stop();
    else if (state === "starting") stopSoon.current = true;
  }, [finish, state]);

  const busy = state !== "idle";
  return {
    available: !!mode || busy,
    // Nothing can dictate here, but there is something the person can do about it.
    fixable: !mode && !busy && !!voice?.problem,
    mode,
    engine: voice?.system?.label || null,
    state,
    partial,
    heard,
    level,
    error,
    problem: voice?.problem || null,
    start,
    stop,
    toggle: () => (state === "listening" || state === "starting" ? stop() : start()),
    clearError: () => setError(null),
  };
}

/* ───────────── what you see ───────────── */

const OPEN_LABEL = { language: "Abrir la configuración de idioma", microphone: "Abrir la configuración del micrófono", speech: "Abrir la configuración de privacidad" };

/** The fix for a dictation problem: what happened, how to solve it, a button to the right page. */
export function DictationHelp({ problem, onClose, style }) {
  if (!problem) return null;
  return (
    <div role="alert" style={{ display: "flex", flexDirection: "column", gap: "6px", width: "max-content", maxWidth: "min(360px, 80vw)", padding: "14px 16px", borderRadius: "18px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.06), 0 24px 48px -20px rgba(18,19,26,.45)", fontSize: "13px", lineHeight: 1.45, color: "#3D404A", textAlign: "left", animation: "c-pop-in .18s ease-out", ...style }}>
      <strong style={{ fontSize: "14px", fontWeight: 600, color: "#12131A" }}>{problem.message}</strong>
      {problem.help ? <span>{problem.help}</span> : null}
      <span style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
        {problem.open ? (
          <button type="button" onClick={() => { void openSystemSettings(problem.open); }} style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>{OPEN_LABEL[problem.open] || "Abrir la configuración"}</button>
        ) : null}
        {onClose ? <button type="button" onClick={onClose} style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", color: "#12131A", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>Entendido</button> : null}
      </span>
    </div>
  );
}

/** The words as they arrive: what is already written, then the phrase still being heard. */
export function LiveWords({ d, dark = false, style }) {
  const said = d.heard || "";
  const live = d.partial || "";
  const all = (said + (said && live ? " " : "") + live).trim();
  const tail = all.length > 120 ? "…" + all.slice(-118) : all;
  const cut = Math.max(0, tail.length - live.length);
  const text = dark ? "#FFFFFF" : "#12131A";
  const soft = dark ? "rgba(255,255,255,.55)" : "#8A8D96";
  if (!tail) {
    return <span style={{ color: soft, ...style }}>{d.state === "starting" ? "Preparando el micrófono…" : d.mode === "openai" ? "Grabando… pulsa para terminar" : "Te escucho…"}</span>;
  }
  return (
    <span aria-live="polite" style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "clip", direction: "rtl", textAlign: "left", ...style }}>
      <bdi style={{ direction: "ltr" }}>
        <span style={{ color: text }}>{tail.slice(0, cut)}</span>
        <span style={{ color: soft }}>{tail.slice(cut)}</span>
      </bdi>
    </span>
  );
}

/**
 * Microphone button for a composer. Idle: a quiet mic. Listening: a dark disc that breathes
 * with your voice, the stop square inside and the words above. Transcribing: a spinner.
 * Nothing can dictate: a crossed mic that explains how to fix it.
 */
export function MicButton({ onText, style, size = 40, bordered = false, tone = "light", place = "above" }) {
  const d = useDictation({ onText });
  const [help, setHelp] = useState(false);
  if (!d.available && !d.fixable && !d.error) return null;
  const on = d.state === "listening" || d.state === "starting";
  const busy = d.state === "transcribing";
  const ring = on ? Math.round(3 + d.level * 9) : 0;
  const shown = d.error || (help ? d.problem : null);
  const label = on ? "Dejar de dictar" : busy ? "Pasando tu voz a texto" : d.fixable ? "El dictado no está disponible: ver cómo activarlo" : "Dictar con el micrófono";
  const bubble = { position: "absolute", [place === "below" ? "top" : "bottom"]: `calc(100% + 10px)`, right: "-6px", zIndex: 30 };
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      <button type="button" className="rm-focus" aria-pressed={on ? "true" : "false"} aria-busy={busy || d.state === "starting" ? "true" : undefined} disabled={busy}
        aria-label={label} title={on ? "Escuchando… pulsa para terminar" : busy ? "Pasando a texto…" : d.fixable ? "Dictado no disponible" : `Dictar (hasta 2 minutos)${d.engine ? " · " + d.engine : ""}`}
        onClick={() => {
          if (d.fixable) return setHelp((v) => !v);
          d.clearError();
          d.toggle();
        }}
        style={{
          width: size + "px", height: size + "px", display: "grid", placeItems: "center", flex: "none", borderRadius: "50%", cursor: busy ? "progress" : "pointer",
          border: bordered && !on ? "1px solid #DCE0E8" : "0",
          background: on ? "#12131A" : "transparent",
          color: on ? "#FFFFFF" : d.fixable ? "#A3A6AF" : tone === "dark" ? "#FFFFFF" : "#3D404A",
          boxShadow: on ? `0 0 0 ${ring}px rgba(255,90,78,.22)` : "none",
          transition: "background .2s ease, color .2s ease, box-shadow .12s linear",
          ...style,
          ...(on ? { background: "#12131A", color: "#FFFFFF" } : d.fixable ? { color: "#A3A6AF" } : {}),
        }}>
        {busy ? <LoaderCircle size={17} strokeWidth={2.2} aria-hidden="true" style={{ animation: "colmena-spin .8s linear infinite" }} />
          : on ? <Square size={12} strokeWidth={0} fill="currentColor" aria-hidden="true" style={d.state === "starting" ? { animation: "colmena-pulse 1.2s ease-in-out infinite" } : undefined} />
          : d.fixable ? <MicOff size={17} strokeWidth={2} aria-hidden="true" />
          : <Mic size={17} strokeWidth={2} aria-hidden="true" />}
      </button>
      {on && d.mode === "sistema" ? (
        <span role="status" style={{ ...bubble, display: "flex", alignItems: "center", gap: "10px", width: "max-content", maxWidth: "min(420px, 70vw)", height: "40px", padding: "0 16px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14px", boxShadow: "0 18px 40px -18px rgba(18,19,26,.6)", animation: "c-pop-in .18s ease-out", pointerEvents: "none" }}>
          <span aria-hidden="true" style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: "#FF5A4E", transform: `scale(${1 + d.level * 0.6})`, transition: "transform .1s linear" }} />
          <LiveWords d={d} dark style={{ flex: "1" }} />
        </span>
      ) : null}
      {shown && !on ? <DictationHelp problem={shown} onClose={() => { d.clearError(); setHelp(false); }} style={bubble} /> : null}
    </span>
  );
}

/** Appends dictated text to a composer value. */
export const appendDictation = (setText) => (said) => setText((prev) => (prev && !/\s$/.test(prev) ? prev + " " : prev || "") + said);
