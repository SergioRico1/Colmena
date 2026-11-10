import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Cloud, Laptop, LoaderCircle, Mic, MicOff, Square } from "lucide-react";
import { get, patch, post } from "../../lib/api.js";
import { appendText, engineNote, planInsert } from "../../lib/dictation.js";

// Dictation in every composer (chats, rooms, Código, a new bot). The server picks the engine
// (server/voice.mjs): the speech recognizer of this computer first — Windows' offline one or
// macOS's — which listens to the microphone itself and sends the words live, so you see them
// while you speak; then, with an OpenAI API key, a recording sent for transcription. When
// neither works the microphone stays, quiet, and says why and how to fix it.
// While you speak it says where («En este equipo» / «En la nube»); when it ends, what you said
// goes where the caret was, as one edit Ctrl+Z undoes, and nothing arrives in another chat.

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

const readBox = (el) => (el && typeof el.value === "string" ? { value: el.value, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length, el } : null);
/** Puts `text` in place of start…end as the browser's own edit (so Ctrl+Z undoes it at once). */
function insertInto(el, start, end, text, caret) {
  try {
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
    if (document.execCommand?.("insertText", false, text)) return true;
  } catch {}
  // No execCommand: the value React reads, set the way it notices (not undoable, but in place).
  try {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!setter) return false;
    setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * {available, mode, where, state:'idle'|'starting'|'listening'|'transcribing', partial, heard,
 *  level, error, problem, start, stop, toggle, clearError}.
 * - `target`: the text box (a ref or a function returning it). What you dictate goes, when the
 *   dictation ends, at the caret or selection it had when you began, as one undoable edit; if you
 *   moved it or the text changed meanwhile, it is appended with `onText(text)` instead (also the
 *   only way without a target).
 * - `scope`: what the box belongs to (a chat, a room). If it changes while dictating, the
 *   dictation stops and its words, even a transcription still on its way, are dropped.
 * `partial` is the phrase being spoken (system engine only), `heard` all this dictation heard and
 * `where` the engine in use ({where, cloud, note}). `error`/`problem` are {message, help, open}.
 */
export function useDictation({ onText, target = null, scope = null }) {
  const voice = useVoiceStatus();
  const canRecord = typeof window !== "undefined" && typeof window.MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;
  const mode = voice?.mode === "sistema" ? "sistema" : voice?.mode === "openai" && canRecord ? "openai" : null;
  const [state, setState] = useState("idle");
  const [partial, setPartial] = useState("");
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);
  // The engine of the dictation under way (fixed when it starts, even if the status changes).
  const [using, setUsing] = useState(null);
  const session = useRef(null);
  const recorder = useRef(null);
  const timer = useRef(null);
  const stopSoon = useRef(false);
  const textRef = useRef(onText);
  textRef.current = onText;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const targetRef = useRef(target);
  targetRef.current = target;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // Where this dictation began (scope and box), what it heard, and a number that changes when
  // a dictation is dropped so its late answers find nobody waiting.
  const origin = useRef({ scope: null, box: null });
  const said = useRef([]);
  const pending = useRef(null);
  const run = useRef(0);
  const [flush, setFlush] = useState(0);
  const element = () => (typeof targetRef.current === "function" ? targetRef.current() : targetRef.current?.current) || null;
  const current = () => origin.current.scope === scopeRef.current;
  const begin = (engine) => {
    run.current += 1;
    origin.current = { scope: scopeRef.current, box: readBox(element()) };
    said.current = [];
    pending.current = null;
    setUsing(engineNote(voiceRef.current, engine));
    return run.current;
  };
  /** Hands the words over once the composer has its box back (an effect, after the render). */
  const deliver = (text) => {
    if (!text || !current()) return;
    pending.current = (pending.current ? pending.current + " " : "") + text;
    setFlush((n) => n + 1);
  };
  useEffect(() => {
    if (state !== "idle" || pending.current == null) return;
    const text = pending.current;
    pending.current = null;
    if (!current()) return;
    const el = element();
    const plan = planInsert(origin.current.box, readBox(el), text);
    if (!plan) return;
    if (plan.mode === "caret" && el && insertInto(el, plan.start, plan.end, plan.text, plan.caret)) return;
    textRef.current?.(plan.text);
  }, [state, flush]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Everything it heard, in one go: one edit, not one per phrase.
    deliver(said.current.join(" "));
    said.current = [];
    setState("idle");
    setPartial("");
    setLevel(0);
    setUsing(null);
  }, [cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another chat or room in the same composer: this dictation is not for it.
  useEffect(() => {
    if (origin.current.scope === scope || (!session.current && !recorder.current && state === "idle")) return;
    run.current += 1;
    cleanup();
    said.current = [];
    pending.current = null;
    setState("idle");
    setPartial("");
    setHeard("");
    setLevel(0);
    setUsing(null);
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSystem = useCallback(async () => {
    stopSoon.current = false;
    const mine = begin("sistema");
    setState("starting");
    setPartial("");
    setHeard("");
    let id;
    try {
      ({ id } = await post("/voice/listen"));
    } catch (e) {
      if (run.current !== mine) return;
      setState("idle");
      setUsing(null);
      setError({ message: e.message });
      void refreshVoiceStatus({ fresh: true });
      return;
    }
    // Dropped (another chat) while the microphone opened: close it at once.
    if (run.current !== mine) {
      post(`/voice/listen/${encodeURIComponent(id)}/stop`).catch(() => {});
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
        if (event.text && current()) {
          said.current.push(event.text);
          setHeard((h) => appendText(h, event.text));
        }
      } else if (event.type === "error") {
        setError({ message: event.message, help: event.help, open: event.open });
        void refreshVoiceStatus({ fresh: true });
      } else if (event.type === "end") finish();
    };
    // The stream broke (server restarted): what was heard until then still goes in.
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
    const mine = begin("openai");
    r.stream = stream;
    r.ondataavailable = (e) => e.data?.size && parts.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      clearTimeout(timer.current);
      const blob = new Blob(parts, { type: r.mimeType || type || "audio/webm" });
      if (!blob.size) { setState("idle"); setUsing(null); return; }
      setState("transcribing");
      try {
        const { text } = await post("/voice/transcribe", { audio: await toBase64(blob), mime: blob.type || "audio/webm", durationMs: Date.now() - began });
        // Late: you went to another chat (or started again) while it was being transcribed.
        if (run.current !== mine) return;
        if (text) deliver(text);
        else setError({ message: "No he entendido nada.", help: "Prueba a hablar más cerca del micrófono." });
      } catch (e) {
        if (run.current === mine) setError({ message: e.message });
      } finally {
        if (run.current === mine) {
          setState("idle");
          setUsing(null);
        }
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
    // «En este equipo» / «En la nube»: the dictation under way, or the one the mic would start.
    where: using || engineNote(voice, mode),
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

/** «En este equipo» / «En la nube», shown while you dictate (and why, when auto had to use the cloud). */
export function EngineTag({ where, dark = false, note = true, style }) {
  if (!where) return null;
  const soft = dark ? "rgba(255,255,255,.62)" : "#5C606C";
  const Icon = where.cloud ? Cloud : Laptop;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "2px", minWidth: 0, ...style }}>
      <span title={where.note || undefined} style={{ display: "inline-flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap", fontSize: "12px", fontWeight: 600, color: soft }}>
        <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
        {where.where}
      </span>
      {note && where.fallback ? <span style={{ fontSize: "12px", lineHeight: 1.35, color: soft, whiteSpace: "normal" }}>{where.note}</span> : null}
    </span>
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
  const soft = dark ? "rgba(255,255,255,.55)" : "#6B6F7A";
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
export function MicButton({ onText, target = null, scope = null, style, size = 40, bordered = false, tone = "light", place = "above" }) {
  const d = useDictation({ onText, target, scope });
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
        aria-label={label} title={on ? "Escuchando… pulsa para terminar" : busy ? "Pasando a texto…" : d.fixable ? "Dictado no disponible" : `Dictar (hasta 2 minutos)${d.where ? " · " + d.where.where : ""}${d.where?.cloud ? "" : d.engine ? " · " + d.engine : ""}`}
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
      {on || busy ? (
        <span role="status" style={{ ...bubble, display: "flex", flexDirection: "column", gap: "4px", width: "max-content", maxWidth: "min(420px, 70vw)", padding: "10px 16px", borderRadius: d.where?.fallback ? "18px" : "22px", background: "#12131A", color: "#FFFFFF", fontSize: "14px", boxShadow: "0 18px 40px -18px rgba(18,19,26,.6)", animation: "c-pop-in .18s ease-out", pointerEvents: "none" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "20px" }}>
            <span aria-hidden="true" style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: "#FF5A4E", transform: `scale(${1 + d.level * 0.6})`, transition: "transform .1s linear" }} />
            {busy ? <span style={{ flex: "1" }}>Pasando tu voz a texto…</span> : d.mode === "sistema" ? <LiveWords d={d} dark style={{ flex: "1" }} /> : <span style={{ flex: "1", color: "rgba(255,255,255,.75)" }}>Grabando… pulsa para terminar</span>}
          </span>
          <EngineTag where={d.where} dark />
        </span>
      ) : null}
      {shown && !on ? <DictationHelp problem={shown} onClose={() => { d.clearError(); setHelp(false); }} style={bubble} /> : null}
    </span>
  );
}

/** Appends dictated text to a composer value. */
export const appendDictation = (setText) => (said) => setText((prev) => appendText(prev, said));
