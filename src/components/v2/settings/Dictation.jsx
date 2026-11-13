import Select from "../../Select.jsx";
import { useState } from "react";
import { DictationHelp, refreshVoiceStatus, setDictationEngine, useVoiceStatus } from "../../interaction/Dictation.jsx";
import { reversible } from "../../../lib/undoToast.js";
import { Alert, LINE, Row, UNDO_MS, btn, select } from "./v3.jsx";

// Ajustes › Privacidad › «Dictado por voz» (design/V3Privacidad.dc.html): who turns your voice
// into text. Automático uses this computer's recognizer (your voice stays here) and the OpenAI
// key only when that is missing; the person can pin either one. Says what dictates now and,
// when the computer's recognizer is missing, how to install it.

const ITEMS = [["auto", "Automático"], ["sistema", "En este ordenador"], ["openai", "Con tu clave de OpenAI"]];
const WORD = Object.fromEntries(ITEMS);

function nowLine(v) {
  if (!v) return { text: "Comprobando…", color: "var(--c-text-3)" };
  if (v.mode === "sistema") return { text: "Se transcribe en este ordenador; tu voz no sale" + (v.system?.onDevice === false ? " salvo al servicio de Apple." : "."), color: "var(--c-text-3)" };
  if (v.mode === "openai") return { text: "Con tu clave de OpenAI: el audio va a OpenAI para pasarlo a texto.", color: "var(--c-text-3)" };
  if (v.preference === "openai") return { text: "Falta la clave de OpenAI (Ajustes › Avanzado).", color: "var(--c-error)" };
  return { text: "Ahora mismo no se puede dictar.", color: "var(--c-error)" };
}

export default function DictationRow() {
  const v = useVoiceStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pick = async (engine) => {
    const before = v?.preference || "auto";
    setBusy(true); setError(null);
    try {
      await setDictationEngine(engine);
      reversible({ id: "setting:dictation", text: "Dictado: " + WORD[engine].toLowerCase(), ms: UNDO_MS, undo: () => setDictationEngine(before) });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const retry = async () => { setBusy(true); try { await refreshVoiceStatus({ fresh: true }); } finally { setBusy(false); } };
  const line = nowLine(v);
  return (
    <>
      <Row as="label" anchor="dictado" title="Dictado por voz" sub={line.text} subColor={line.color} min="64px">
        <Select aria-label="Dictado" disabled={busy || !v} value={v?.preference || "auto"} onChange={(e) => pick(e.target.value)} style={{ ...select, width: "auto", height: "36px", fontSize: "var(--t-ui)" }} options={ITEMS} />
      </Row>
      {v?.problem && v.preference !== "openai" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "0 22px 14px" }}>
          <DictationHelp problem={v.problem} style={{ width: "auto", maxWidth: "none", padding: 0, boxShadow: "none", animation: "none" }} />
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
            <button type="button" onClick={retry} disabled={busy} style={btn("outline", 32)}>{busy ? "Comprobando…" : "Ya lo he hecho: comprobar otra vez"}</button>
            {v.mode === "openai" ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Mientras tanto se dicta con tu clave de OpenAI.</span> : null}
          </span>
        </div>
      ) : null}
      {error ? <div style={{ padding: "0 22px 12px", borderTop: LINE }}><Alert>{error}</Alert></div> : null}
    </>
  );
}
