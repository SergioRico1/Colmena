// Hosted Ajustes › Tu cuenta de IA › «Modelo de cada bot»: the same choice the desktop shows in
// «Qué usa cada bot» (Accounts.jsx), with only the model: in the cloud each bot thinks with the
// account of whoever asks, so a model that account does not offer falls back to «Automático».
import Select from "../../Select.jsx";
import { useAction, useStore } from "../../../lib/store.jsx";
import { patch } from "../../../lib/api.js";
import { reversible } from "../../../lib/undoToast.js";
import { botModelChoice } from "../../../lib/botModels.js";
import { Alert, BotMark, Panel, UNDO_MS, select } from "./v3.jsx";

const small = { ...select, width: "100%", height: "32px", padding: "0 6px", fontSize: "var(--t-ui)" };

export default function BotModels({ chatgpt = null }) {
  const store = useStore();
  const act = useAction();
  const bots = (store.bots || []).filter((b) => b.enabled !== false && !b.archived);
  if (!bots.length || !bots.some((b) => botModelChoice(store, b).options.length > 1)) return null;
  const set = (b, slug, label) => {
    const before = b.modelPin ?? null;
    act.act(() => patch(`/bots/${encodeURIComponent(b.id)}`, { modelPin: slug || null }))
      .then(() => reversible({ id: `bot:${b.id}:modelo`, text: `${b.name}: modelo ${label}`, ms: UNDO_MS, undo: () => store.run(() => patch(`/bots/${encodeURIComponent(b.id)}`, { modelPin: before })) }));
  };
  return (
    <Panel anchor="modelo-por-bot" title="Modelo de cada bot" sub="Automático elige uno por su trabajo. Si tu cuenta no tiene el que elijas, usa el automático." style={{ gap: "4px" }}>
      <Alert>{act.error}</Alert>
      {chatgpt?.error ? <p role="note" style={{ margin: 0, fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{"No hay modelos de ChatGPT para elegir: " + chatgpt.error}</p> : null}
      <div role="table" aria-label="Modelo de cada bot" style={{ display: "flex", flexDirection: "column" }}>
        {bots.map((b) => {
          const choice = botModelChoice(store, b);
          return (
            <div role="row" key={b.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: "12px", alignItems: "center", minHeight: "44px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .05)", fontSize: "var(--t-ui)" }}>
              <span role="rowheader" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}><BotMark bot={b} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span></span>
              <span role="cell">
                <Select aria-label={"Modelo de " + b.name} disabled={act.busy} value={choice.value} onChange={(e) => set(b, e.target.value, choice.label(e.target.value))} style={small} options={choice.options} />
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
