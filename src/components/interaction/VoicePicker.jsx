import { useState } from "react";
import { patch } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { Notice } from "../team/common.jsx";
import { pickVoice, spanishVoices, speak, stopSpeaking, useVoices } from "./Voice.jsx";

// «Voz» in the bot profile: which Windows voice reads its answers («Escuchar»).
// Saved in bot.voice (voiceURI). Without Spanish voices it says so; no dead controls.

export function VoicePicker({ bot, onSaved }) {
  const voices = useVoices();
  const options = spanishVoices(voices);
  const current = pickVoice(voices, bot.voice);
  const { act, busy, error } = useAction();
  const [trying, setTrying] = useState(false);
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const choose = async (uri) => {
    const voice = uri || null;
    const result = await act(() => patch(`/bots/${bot.id}`, { voice }));
    if (result !== undefined) onSaved?.(voice);
  };
  const tryIt = () => {
    if (trying) {
      stopSpeaking();
      setTrying(false);
      return;
    }
    const v = current;
    if (!v) return;
    setTrying(true);
    speak(`Hola, soy ${bot.name}. Así sonarán mis respuestas cuando pulses Escuchar.`, v, "probar-" + bot.id);
    setTimeout(() => setTrying(false), 6000);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontSize: "14px", fontWeight: "600" }}>Voz</span>
      {options.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <label style={{ flex: "1 1 220px", display: "flex" }}>
            <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{`Voz de ${bot.name}`}</span>
            <select value={current?.voiceURI || ""} disabled={busy} onChange={(e) => choose(e.target.value)} style={{ flex: "1", minWidth: 0, height: "40px", padding: "0 10px", background: "#FFFFFF", border: "0", borderRadius: "999px", fontSize: "14px", cursor: "pointer" }}>
              {options.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{`${v.name.replace(/^Microsoft\s+/i, "").replace(/\s+-\s+.*$/, "")} · ${v.lang}`}</option>)}
            </select>
          </label>
          <button type="button" onClick={tryIt} aria-pressed={trying ? "true" : "false"} style={{ height: "40px", padding: "0 12px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px" }}>{trying ? "Parar" : "Probar"}</button>
        </div>
      ) : (
        <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#6B6F7A" }}>Este ordenador no tiene voces en español. Añádelas en Configuración de Windows › Hora e idioma › Voz para poder escuchar las respuestas.</span>
      )}
      <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{`Con «Escuchar» lee en voz alta sus respuestas y entregables.`}</span>
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
