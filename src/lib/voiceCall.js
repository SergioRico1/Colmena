// «Hablar»: the screen side of a live voice call (server/voice-live.mjs). This page holds the
// WebRTC peer: the microphone goes straight to the voice model and its voice comes back as an
// audio track; Colmena's server only exchanges the SDP and streams subtitles and states.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, del, get, post } from "./api.js";

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
// Loudness (RMS) above which a side counts as speaking; it must stay low for a while to stop.
// The bot's subtitles count too: a pause between words is not the end of its turn.
const SPEAKING = 0.02, QUIET_MS = 900, WORDS_MS = 1200;

/** The ICE candidates in the offer (a short wait: Codex forwards the SDP once). */
function gathered(pc, ms = 1500) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => { if (pc.iceGatheringState === "complete") resolve(); };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, ms);
  });
}

function meter(ctx, stream) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  };
}

const micMessage = (error) =>
  error?.name === "NotAllowedError" ? "Colmena no tiene permiso para usar el micrófono."
    : error?.name === "NotFoundError" ? "No encuentro ningún micrófono en este ordenador."
      : error?.message || "No se pudo empezar la llamada.";

/**
 * One call with the bot of `missionId`. `levels.current` = {bot, you} (0–1, for drawing);
 * `phase`: idle | connecting | listening | speaking | thinking | ended | error.
 */
export function useVoiceCall({ missionId, botId }) {
  const [info, setInfo] = useState(null); // {available, reason, voices, voice}
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState({ user: "", assistant: "", last: null });
  const [tool, setTool] = useState(null);
  const [confirms, setConfirms] = useState([]);
  const [voice, setVoice] = useState(null);
  const levels = useRef({ bot: 0, you: 0 });
  const live = useRef(null);
  const thinking = useRef(false);
  const botWords = useRef(0);
  // The last call stays answerable after hanging up: a pending confirmation is not lost.
  const lastCall = useRef(null);

  useEffect(() => {
    let off = false;
    get("/voice-live?botId=" + encodeURIComponent(botId)).then((d) => { if (!off) { setInfo(d); setVoice(d.voice); } }).catch((e) => !off && setInfo({ available: false, reason: e.message, voices: [] }));
    return () => { off = true; };
  }, [botId]);

  const teardown = useCallback((remote = true) => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    cancelAnimationFrame(l.frame);
    l.source?.close();
    try { l.pc?.close(); } catch {}
    l.mic?.getTracks().forEach((t) => t.stop());
    if (l.audio) { l.audio.srcObject = null; l.audio.remove?.(); }
    l.ctx?.close().catch(() => {});
    if (remote && l.callId) del("/voice-live/calls/" + l.callId).catch(() => {});
    levels.current = { bot: 0, you: 0 };
  }, []);

  const onEvent = useCallback((e) => {
    // A finished line stays until that side speaks again; then a new one starts.
    if (e.type === "caption" && e.role === "assistant") botWords.current = performance.now();
    if (e.type === "caption") setCaptions((c) => ({ ...c, [e.role]: (c.said?.[e.role] ? "" : c[e.role]) + e.delta, said: { ...c.said, [e.role]: false }, last: e.role }));
    else if (e.type === "said") setCaptions((c) => ({ ...c, [e.role]: e.text, said: { ...c.said, [e.role]: true }, last: e.role }));
    else if (e.type === "state" && e.state === "thinking") { thinking.current = true; setPhase("thinking"); }
    else if (e.type === "state" && e.state === "live") { thinking.current = false; setTool(null); setPhase((p) => (p === "thinking" || p === "connecting" ? "listening" : p)); }
    else if (e.type === "tool") setTool(e.status === "running" ? e.label : null);
    else if (e.type === "confirm") setConfirms((list) => (list.some((c) => c.id === e.id) ? list : [...list, { ...e, callId: lastCall.current }]));
    else if (e.type === "confirmed") setConfirms((list) => list.filter((c) => c.id !== e.id));
    else if (e.type === "error") setError(e.message);
    else if (e.type === "closed") {
      teardown(false);
      setPhase((p) => (p === "error" ? p : "ended"));
      if (e.reason && !["Colgaste", "Otra llamada"].includes(e.reason)) setError((x) => x || e.reason);
    }
  }, [teardown]);

  const start = useCallback(async (chosen = voice) => {
    teardown();
    setError(null);
    setCaptions({ user: "", assistant: "", last: null });
    setTool(null);
    setMuted(false);
    setPhase("connecting");
    const l = { frame: 0 };
    live.current = l;
    try {
      l.mic = await navigator.mediaDevices.getUserMedia({ audio: MIC });
      if (live.current !== l) return l.mic.getTracks().forEach((t) => t.stop());
      l.ctx = new AudioContext();
      l.pc = new RTCPeerConnection();
      for (const track of l.mic.getAudioTracks()) l.pc.addTrack(track, l.mic);
      l.pc.createDataChannel("oai-events");
      l.audio = new Audio();
      l.audio.autoplay = true;
      l.pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        if (!stream || l.botLevel) return;
        l.audio.srcObject = stream;
        l.audio.play().catch(() => {});
        l.botLevel = meter(l.ctx, stream);
      };
      l.pc.onconnectionstatechange = () => {
        if (["failed", "disconnected"].includes(l.pc?.connectionState) && live.current === l) {
          setError("Se cortó la conexión de la llamada.");
          setPhase("error");
          teardown();
        }
      };
      l.youLevel = meter(l.ctx, l.mic);
      await l.pc.setLocalDescription(await l.pc.createOffer());
      await gathered(l.pc);
      const call = await post("/voice-live/calls", { missionId, sdp: l.pc.localDescription.sdp, ...(chosen ? { voice: chosen } : {}) });
      if (live.current !== l) { del("/voice-live/calls/" + call.id).catch(() => {}); return; }
      l.callId = call.id;
      lastCall.current = call.id;
      setVoice(call.voice);
      await l.pc.setRemoteDescription({ type: "answer", sdp: call.sdp });
      l.source = new EventSource("/api/voice-live/calls/" + call.id + "/events");
      l.source.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
      setPhase("listening");
      // Speaking or listening from the loudness of each side (the voice model does not say it).
      let speakingUntil = 0;
      const tick = () => {
        if (live.current !== l) return;
        const bot = l.botLevel ? l.botLevel() : 0;
        const you = l.muted ? 0 : l.youLevel();
        levels.current = { bot: Math.min(1, bot * 6), you: Math.min(1, you * 6) };
        const t = performance.now();
        if (bot > SPEAKING) speakingUntil = t + QUIET_MS;
        // Speaking wins over thinking: «un momento, lo miro» is said while Codex looks.
        const next = t < speakingUntil || t - botWords.current < WORDS_MS ? "speaking" : thinking.current ? "thinking" : "listening";
        setPhase((p) => (["listening", "speaking", "thinking"].includes(p) && p !== next ? next : p));
        l.frame = requestAnimationFrame(tick);
      };
      l.frame = requestAnimationFrame(tick);
    } catch (e) {
      if (live.current !== l) return;
      teardown();
      setError(micMessage(e));
      setPhase("error");
    }
  }, [missionId, voice, teardown, onEvent]);

  const hangUp = useCallback(() => { teardown(); setPhase("ended"); }, [teardown]);
  const toggleMute = useCallback(() => {
    const l = live.current;
    setMuted((m) => {
      const next = !m;
      l?.mic?.getAudioTracks().forEach((t) => { t.enabled = !next; });
      if (l) l.muted = next;
      return next;
    });
  }, []);
  /** Another voice: kept in the bot's record; a call in progress starts again with it. */
  const chooseVoice = useCallback(async (v) => {
    setVoice(v);
    await api("/voice-live/bots/" + encodeURIComponent(botId) + "/voice", "PUT", { voice: v }).catch(() => {});
    if (live.current) await start(v);
  }, [botId, start]);
  /** «Confirmar» / «No» on a red line; it still works after hanging up (the server keeps it a minute). */
  const answer = useCallback(async (confirm, approve) => {
    try {
      await post(`/voice-live/calls/${confirm.callId}/confirms/${confirm.id}`, { approve });
      setConfirms((list) => list.filter((c) => c.id !== confirm.id));
    } catch (e) {
      setError(e.message);
      if (e.status === 404) setConfirms((list) => list.filter((c) => c.id !== confirm.id));
    }
  }, []);

  useEffect(() => () => teardown(), [teardown]);
  return { info, phase, error, muted, captions, tool, confirms, voice, levels, start, hangUp, toggleMute, chooseVoice, answer };
}
