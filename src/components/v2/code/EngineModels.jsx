import { useState } from "react";
import { Download, TriangleAlert } from "../../Icon.js";
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

/** «Instalar OpenCode» from inside the menu: its state lives with the menu's owner. */
export function useEngineInstall() {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(null);
  const install = async () => {
    setInstalling(true); setError(null);
    try { await post("/code/engines/opencode/install", {}); } catch (e) { setError(e.message); } finally { setInstalling(false); }
  };
  return { installing, error, install };
}

/**
 * The engines and their models as groups of the app's one menu (components/Menu.js): one group
 * per engine, headed by its mark, the current one first («ahora»).
 * `engines`: GET /api/code engines ({id, label, available, models, need, note, installable}).
 * `current` {engine, model}; `onPick(engine, model)`; `install` from useEngineInstall();
 * `multi`: the picks when several are tried at once (checkboxes; the menu stays open).
 */
export function engineModelGroups(engines = [], { current, onPick, install = null, multi = null }) {
  const order = [...engines].sort((a, b) => (a.id === current?.engine ? -1 : b.id === current?.engine ? 1 : 0));
  return order.map((e) => {
    const heading = (
      <span>
        <EngineMark engine={e.id} size={14} />{e.label}
        {e.id === current?.engine ? <span style={{ font: `500 var(--t-micro)/1 ${MONO}`, color: C.quiet }}>ahora</span> : null}
      </span>
    );
    if (!e.available) {
      const busy = !!(e.installing || install?.installing);
      const need = e.need || "No está disponible en este ordenador.";
      const item = e.installable
        ? { id: e.id + ":install", label: busy ? "Instalando OpenCode…" : "Instalar OpenCode", icon: Download, hint: install?.error || need, disabled: busy ? "Se está instalando para Colmena" : false, keepOpen: true, onSelect: () => install?.install() }
        : { id: e.id + ":off", label: "No está listo", icon: TriangleAlert, hint: need, disabled: need };
      return { group: heading, items: [item] };
    }
    const items = e.models.map((m) => {
      const on = multi ? multi.some((x) => x.engine === e.id && x.model === m.id) : current?.engine === e.id && current?.model === m.id;
      return { id: e.id + ":" + m.id, label: m.label, hint: modelNote(m) || undefined, icon: <EngineMark engine={e.id} size={16} />, radio: !multi, checked: on, keepOpen: !!multi, onSelect: () => onPick(e.id, m.id) };
    });
    return { group: heading, items, note: e.note || null };
  });
}
