// «Hablar»: the voice panel over a bot's chat. One presence in the middle that listens and
// speaks, the words underneath as they are said, three controls at the bottom. Everything else
// stays out of the way; what is said lands in the chat behind it as messages.
import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, Mic, MicOff, PhoneOff, RotateCw, X } from "lucide-react";
import { BotPresence } from "../Presence.jsx";
import { useVoiceCall } from "../../../lib/voiceCall.js";

const ink = "#12131A", grey = "#5C606C";
const shimmer = { background: "linear-gradient(90deg, #8A8D96 0%, #8A8D96 35%, #12131A 50%, #8A8D96 65%, #8A8D96 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" };
const round = (dark) => ({ width: "60px", height: "60px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", cursor: "pointer", background: dark ? ink : "#FFFFFF", color: dark ? "#FFFFFF" : ink, boxShadow: dark ? "0 14px 30px -14px rgba(18,19,26,.55)" : "0 0 0 1px rgba(18,19,26,.08), 0 10px 24px -16px rgba(18,19,26,.3)", transition: "transform .15s ease, background .2s ease" });
const label = { fontSize: "12px", color: grey, textAlign: "center" };
const voiceName = (v) => (v ? v[0].toUpperCase() + v.slice(1) : "");

const STATUS = { connecting: "Conectando…", listening: "Escuchando", speaking: "Hablando", thinking: "Pensando…", ended: "Llamada terminada", error: "No se pudo hablar", idle: "" };

export default function VoiceCall({ bot, missionId, onClose }) {
  const call = useVoiceCall({ missionId, botId: bot?.id });
  const { info, phase, error, muted, captions, tool, confirms, voice, levels } = call;
  const [voicesOpen, setVoicesOpen] = useState(false);
  const glow = useRef(null), ring = useRef(null), body = useRef(null);
  const color = bot?.color || "#7B4DFF";
  const name = bot?.name || "el bot";
  const inCall = ["connecting", "listening", "speaking", "thinking"].includes(phase);

  // The call starts as the panel opens (when Codex is ready).
  const started = useRef(false);
  useEffect(() => {
    if (info?.available && !started.current) { started.current = true; void call.start(); }
  }, [info?.available, call]);

  // Loudness drives the presence: its glow follows the bot's voice, the ring follows yours.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const { bot: b, you } = levels.current;
      if (glow.current) { glow.current.style.transform = `scale(${1 + b * 0.55})`; glow.current.style.opacity = String(0.16 + b * 0.5); }
      if (body.current) body.current.style.transform = `scale(${1 + b * 0.07})`;
      if (ring.current) { ring.current.style.transform = `scale(${1 + you * 0.22})`; ring.current.style.opacity = String(0.35 + you * 0.65); }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [levels]);

  const close = () => { call.hangUp(); onClose(); };
  // Hanging up with a red line still on screen keeps the panel: it is answered first.
  const hangUp = () => (confirms.length ? call.hangUp() : close());
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); if (voicesOpen) setVoicesOpen(false); else hangUp(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const other = captions.last === "assistant" ? "user" : "assistant";
  const main = captions.last ? captions[captions.last] : "";
  const before = captions.last ? captions[other] : "";
  const status = muted && inCall && phase !== "thinking" ? "Silenciado" : phase === "thinking" && tool ? tool + "…" : STATUS[phase];
  const unavailable = info && !info.available;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Llamada con ${name}`}
      style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", background: "rgba(245,245,242,.94)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", animation: "fade .25s ease-out" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "28px clamp(20px, 5vw, 56px) 30px", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
        <p style={{ margin: 0, fontSize: "13px", color: grey, letterSpacing: "0.01em" }}>{`${name} · Voz ${voiceName(voice) || "…"}`}</p>

        <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "26px" }}>
          <div aria-hidden="true" style={{ position: "relative", width: "240px", height: "240px", display: "grid", placeItems: "center" }}>
            <span ref={glow} style={{ position: "absolute", width: "170px", height: "170px", borderRadius: "50%", background: color, filter: "blur(30px)", opacity: 0.16, transition: "transform .09s linear, opacity .09s linear" }} />
            <span ref={ring} style={{ position: "absolute", width: "204px", height: "204px", borderRadius: "50%", boxShadow: `0 0 0 1px ${inCall && !muted ? "rgba(18,19,26,.12)" : "rgba(18,19,26,.05)"}`, opacity: 0.35, transition: "transform .09s linear, opacity .09s linear" }} />
            <span ref={body} style={{ display: "grid", transition: "transform .09s linear" }}>
              <BotPresence bot={bot} size={132} state={phase === "thinking" || phase === "connecting" ? "work" : "rest"} />
            </span>
          </div>

          <span role="status" aria-live="polite" style={{ minHeight: "20px", fontSize: "15px", fontWeight: 500, color: grey, ...(phase === "thinking" || phase === "connecting" ? shimmer : {}) }}>{unavailable ? "" : status}</span>

          <div aria-live="polite" style={{ width: "100%", maxWidth: "640px", minHeight: "96px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
            {unavailable ? (
              <p style={{ margin: 0, font: "500 20px/1.4 'Geist', sans-serif", color: ink, animation: "rise .3s ease-out" }}>{info.reason}</p>
            ) : error && !inCall ? (
              <p role="alert" style={{ margin: 0, font: "500 19px/1.4 'Geist', sans-serif", color: ink, animation: "rise .3s ease-out" }}>{error}</p>
            ) : (
              <>
                {before ? <p key={"b" + other + before.slice(0, 12)} style={{ margin: 0, fontSize: "15px", lineHeight: 1.45, color: "#8A8D96", animation: "fade .3s ease-out", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{before}</p> : null}
                {main ? <p key={"m" + captions.last + main.slice(0, 12)} style={{ margin: 0, font: `500 ${captions.last === "assistant" ? 23 : 20}px/1.38 'Geist', sans-serif`, letterSpacing: "-0.01em", color: captions.last === "assistant" ? ink : grey, animation: "fade .3s ease-out", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{main}</p>
                  : phase === "listening" ? <p style={{ margin: 0, fontSize: "17px", color: "#8A8D96", animation: "fade .6s ease-out" }}>{`Habla cuando quieras. Para cortar a ${name}, háblale por encima.`}</p> : null}
              </>
            )}
          </div>
        </div>

        {confirms.map((c) => (
          <div key={c.id} role="group" aria-label="Confirmación pendiente"
            style={{ width: "100%", maxWidth: "520px", marginBottom: "22px", background: "#FFFFFF", borderRadius: "24px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px", animation: "rise .3s ease-out" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#8A5A00" }}>{"Por voz no se hace: confírmalo aquí"}</span>
            <strong style={{ font: "600 19px/1.25 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>{c.accion}</strong>
            <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.5, color: grey }}>{c.detalle}</p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={() => call.answer(c, true)} style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "44px", padding: "0 20px", background: ink, color: "#FFFFFF", border: 0, borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontSize: "15px" }}>
                <Check size={17} strokeWidth={2.4} aria-hidden="true" />{"Confirmar y pasarlo al chat"}
              </button>
              <button type="button" onClick={() => call.answer(c, false)} style={{ minHeight: "44px", padding: "0 18px", background: "#F6F6F3", color: ink, border: 0, borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontSize: "15px" }}>{"No"}</button>
            </div>
          </div>
        ))}

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: "34px" }}>
          {inCall ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <button type="button" onClick={call.toggleMute} aria-pressed={muted ? "true" : "false"} aria-label={muted ? "Activar el micrófono" : "Silenciar"} style={round(false)}>
                {muted ? <MicOff size={22} strokeWidth={2} aria-hidden="true" /> : <Mic size={22} strokeWidth={2} aria-hidden="true" />}
              </button>
              <span style={label}>{muted ? "Silenciado" : "Silenciar"}</span>
            </div>
          ) : null}

          {info?.voices?.length && !unavailable ? (
            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <button type="button" aria-haspopup="listbox" aria-expanded={voicesOpen ? "true" : "false"} aria-label={`Voz de ${name}: ${voiceName(voice)}`} onClick={() => setVoicesOpen((v) => !v)}
                style={{ ...round(false), width: "auto", minWidth: "60px", padding: "0 18px", borderRadius: "999px", display: "flex", gap: "8px", font: "500 15px/1 'Geist', sans-serif" }}>
                <AudioLines size={20} strokeWidth={2} aria-hidden="true" />{voiceName(voice)}<ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <span style={label}>{"Voz"}</span>
              {voicesOpen ? (
                <div role="listbox" aria-label="Voces" onMouseLeave={() => setVoicesOpen(false)}
                  style={{ position: "absolute", bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)", zIndex: 2, width: "200px", maxHeight: "300px", overflowY: "auto", padding: "6px", borderRadius: "18px", background: "#FFFFFF", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35), 0 0 0 1px rgba(18,19,26,.06)", animation: "rise .2s ease-out" }}>
                  {info.voices.map((v) => (
                    <button key={v} type="button" role="option" aria-selected={v === voice ? "true" : "false"} onClick={() => { setVoicesOpen(false); if (v !== voice) void call.chooseVoice(v); }}
                      style={{ width: "100%", minHeight: "40px", padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "space-between", border: 0, borderRadius: "12px", background: v === voice ? "rgba(18,19,26,.05)" : "transparent", cursor: "pointer", fontSize: "14px", color: ink }}>
                      {voiceName(v)}{v === voice ? <Check size={15} strokeWidth={2.4} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {inCall ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <button type="button" onClick={hangUp} aria-label="Colgar" style={round(true)}><PhoneOff size={22} strokeWidth={2} aria-hidden="true" /></button>
              <span style={label}>{"Colgar"}</span>
            </div>
          ) : (
            <>
              {!unavailable && info ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                  <button type="button" onClick={() => call.start()} aria-label="Llamar otra vez" style={round(true)}><RotateCw size={22} strokeWidth={2} aria-hidden="true" /></button>
                  <span style={label}>{"Llamar otra vez"}</span>
                </div>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                <button type="button" onClick={close} aria-label="Volver al chat" style={round(false)}><X size={22} strokeWidth={2} aria-hidden="true" /></button>
                <span style={label}>{"Volver al chat"}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
