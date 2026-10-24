import { useState } from "react";
import { Check, Download } from "lucide-react";
import { post } from "../../../lib/api.js";
import ProviderMark from "../ProviderMark.jsx";
import { C, MONO } from "./parts.jsx";

// The models of the three engines in one menu (T3 Code provider switching), grouped by engine
// with its mark, the current engine first. An engine that is not ready says why and how to get it
// ready in place («Instalar OpenCode», «codex login»). Picking a model of another engine makes
// the task go on with that engine on its next turn, with the history (server/code/service.mjs
// switchEngine).

export const ENGINE_NAME = { "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode" };
/** Code engine → the provider mark of components/v2/ProviderMark.jsx. */
export const ENGINE_MARK = { "claude-code": "anthropic", codex: "openai", opencode: "opencode-go" };

export function EngineMark({ engine, size = 14 }) {
  return <ProviderMark engine={ENGINE_MARK[engine]} size={size} tile={false} />;
}

export function modelNote(m) {
  if (m.id === "claude-opus-5-5") return "El más capaz. Recomendado para programar.";
  if (m.id === "claude-haiku-5-5") return "Rápido y barato, para cambios pequeños.";
  if (m.id === "claude-sonnet-5-5") return "Equilibrado.";
  if (m.go) return "Con tu cuenta de OpenCode Go.";
  if (String(m.id).startsWith("opencode/")) return "Gratis, con los límites de OpenCode.";
  // Codex's own descriptions come in English: Colmena says it in its words.
  const name = String(m.label || m.id).toLowerCase();
  const older = /5\.5|5\.6/.test(name) ? " Generación anterior." : "";
  if (m.isDefault) return "El que recomienda Codex para programar.";
  if (name.includes("astra")) return "El más capaz, para lo más difícil." + older;
  if (name.includes("luna")) return "Rápido y barato, para cambios pequeños." + older;
  if (name.includes("sol") || name.includes("terra")) return "Equilibrado." + older;
  return older.trim();
}

/**
 * `engines`: GET /api/code engines ({id, label, available, models, need, note, installable}).
 * `current` {engine, model}; `onPick(engine, model)`; `switchNote`: what changing engine means here.
 */
export default function EngineModelMenu({ engines = [], current, onPick, close, switchNote = null, multi = null }) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(null);
  const order = [...engines].sort((a, b) => (a.id === current?.engine ? -1 : b.id === current?.engine ? 1 : 0));
  const install = async () => {
    setInstalling(true); setError(null);
    try { await post("/code/engines/opencode/install", {}); } catch (e) { setError(e.message); } finally { setInstalling(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {order.map((e, k) => (
        <div key={e.id} role="group" aria-label={e.label} style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: k ? "6px" : 0, marginTop: k ? "4px" : 0, borderTop: k ? "1px solid " + C.rule : 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px 4px" }}>
            <EngineMark engine={e.id} size={14} />
            <span style={{ flex: 1, font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>{e.label}</span>
            {e.id === current?.engine ? <span style={{ font: `500 11px/1 ${MONO}`, color: C.quiet }}>ahora</span> : null}
          </span>
          {!e.available ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "2px 8px 6px", padding: "10px 12px", borderRadius: "14px", background: C.soft }}>
              <span style={{ fontSize: "12px", lineHeight: 1.5, color: C.text }}>{e.installing || installing ? "Instalando OpenCode para Colmena…" : e.need || "No está disponible en este ordenador."}</span>
              {e.installable ? (
                <button type="button" disabled={installing || e.installing} onClick={install}
                  style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: installing || e.installing ? "default" : "pointer", fontSize: "12px", fontWeight: 600, opacity: installing || e.installing ? 0.6 : 1 }}>
                  <Download size={12} strokeWidth={2.4} aria-hidden="true" />{installing || e.installing ? "Instalando…" : "Instalar OpenCode"}
                </button>
              ) : null}
              {error && e.installable ? <span role="alert" style={{ fontSize: "12px", color: C.red }}>{error}</span> : null}
            </div>
          ) : (
            <>
              {e.models.map((m) => {
                const on = multi ? multi.some((x) => x.engine === e.id && x.model === m.id) : current?.engine === e.id && current?.model === m.id;
                return (
                  <button key={m.id} type="button" role="menuitemradio" aria-checked={on} className="code-hover" onClick={() => { onPick(e.id, m.id); if (!multi) close?.(); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "9px 12px", border: 0, borderRadius: "14px", background: on ? C.soft : "transparent", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <strong style={{ fontSize: "14px", fontWeight: 600, color: C.ink }}>{m.label}</strong>
                      {modelNote(m) ? <span style={{ fontSize: "12px", lineHeight: 1.45, color: C.muted }}>{modelNote(m)}</span> : null}
                    </span>
                    {on ? <Check size={15} strokeWidth={2.6} color={C.ink} aria-hidden="true" /> : null}
                  </button>
                );
              })}
              {e.note ? <span style={{ padding: "2px 12px 6px", fontSize: "11px", lineHeight: 1.45, color: C.faint }}>{e.note}</span> : null}
            </>
          )}
        </div>
      ))}
      {switchNote ? <p style={{ margin: "6px 12px 4px", fontSize: "12px", lineHeight: 1.5, color: C.faint }}>{switchNote}</p> : null}
    </div>
  );
}
