import { useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { DictationHelp, refreshVoiceStatus, setDictationEngine, useVoiceStatus } from "../../interaction/Dictation.jsx";
import { FAINT, Group, LINE, MUTED, Segmented, Text, anchorOf, pill } from "./rows.jsx";

// Ajustes › Privacidad › «Dictado por voz»: who turns your voice into text. Automático uses
// this computer's recognizer (your voice stays here) and the OpenAI key only when that is
// missing; the person can pin either one. Shows what dictates now and, when the computer's
// recognizer is missing, how to install it.

const ITEMS = [["auto", "Automático"], ["sistema", "Este ordenador"], ["openai", "Clave de OpenAI"]];

function nowLine(v) {
  if (!v) return { text: "Comprobando…", color: MUTED };
  if (v.mode === "sistema") return { text: v.system.label + ". Tu voz no sale de aquí" + (v.system.onDevice ? "." : " salvo al servicio de Apple."), color: "#0B6B4A" };
  if (v.mode === "openai") return { text: "Con tu clave de OpenAI: el audio se envía a OpenAI para pasarlo a texto.", color: MUTED };
  if (v.preference === "openai") return { text: "Falta la clave de OpenAI (Inteligencia › Clave de OpenAI).", color: "#B4372A" };
  return { text: "Ahora mismo no se puede dictar.", color: "#B4372A" };
}

export default function DictationSettings() {
  const v = useVoiceStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pick = async (engine) => {
    setBusy(true);
    setError(null);
    try { await setDictationEngine(engine); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const retry = async () => {
    setBusy(true);
    try { await refreshVoiceStatus({ fresh: true }); } finally { setBusy(false); }
  };
  const line = nowLine(v);
  const ok = !!v?.mode;
  return (
    <Group id="dic-t" title="Dictado por voz" note="Pulsa el micrófono en cualquier chat, sala o en Código y habla: verás el texto mientras hablas. Hasta 2 minutos cada vez." anchor="dictado">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "76px", padding: "12px 20px", borderBottom: LINE }}>
        <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: ok ? "#12131A" : "rgba(18,19,26,.06)", color: ok ? "#FFFFFF" : "#A3A6AF" }}>
          {ok ? <Mic size={17} strokeWidth={2} /> : <MicOff size={17} strokeWidth={2} />}
        </span>
        <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex" }}><Text title="Quién pasa tu voz a texto" sub={line.text} subColor={line.color} /></span>
        <span style={{ flex: "0 1 420px", minWidth: "min(100%, 300px)" }}>
          <Segmented label="Quién pasa tu voz a texto" items={ITEMS} value={v?.preference || "auto"} busy={busy || !v} onPick={pick} />
        </span>
      </div>
      {v?.problem && v.preference !== "openai" ? (
        <div {...anchorOf("dictado-idioma")} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px" }}>
          <DictationHelp problem={v.problem} style={{ width: "auto", maxWidth: "none", padding: 0, boxShadow: "none", animation: "none" }} />
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
            <button type="button" onClick={retry} disabled={busy} style={{ ...pill(false), height: "36px", fontSize: "13px", cursor: busy ? "wait" : "pointer" }}>{busy ? "Comprobando…" : "Ya lo he hecho: comprobar otra vez"}</button>
            {v.mode === "openai" ? <span style={{ fontSize: "13px", color: FAINT }}>Mientras tanto se dicta con tu clave de OpenAI.</span> : null}
          </span>
        </div>
      ) : null}
      {error ? <p role="alert" style={{ margin: 0, padding: "0 20px 16px", fontSize: "13px", color: "#B4372A" }}>{error}</p> : null}
    </Group>
  );
}
