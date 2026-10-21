import React, { useEffect, useState } from "react";
import { post, del } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { BotAvatar, CheckIcon, darkBtn, dueLabel, errorText, mono, smallBtn, textBtn, waitsForYou, Spinner } from "./shared.jsx";

/** Atlas's milestone proposal: a draft the person reviews. Nothing is added until «Añadir…». */
export default function PlanDraft({ goal, atlas, onAgain, againBusy }) {
  const draft = goal.planDraft;
  const [chosen, setChosen] = useState(() => new Set(draft.milestones.map((_, i) => i)));
  useEffect(() => setChosen(new Set(draft.milestones.map((_, i) => i))), [draft.createdAt, draft.milestones.length]);
  const { act, busy, error } = useAction();
  const base = `/goals/${encodeURIComponent(goal.id)}/plan`;
  const toggle = (i) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });
  const accept = () => act(() => post(base + "/accept", { indexes: [...chosen] }));
  const discard = () => act(() => del(base));
  return (
    <section aria-labelledby="propuesta-atlas" style={{ ...waitsForYou, padding: "20px", display: "flex", flexDirection: "column", gap: "14px", marginRight: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <BotAvatar bot={atlas} size={30} />
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={mono}>{"Te espera"}</span>
          <h3 id="propuesta-atlas" style={{ margin: "0", font: "600 18px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{`${atlas?.name || "Atlas"} propone estos hitos`}</h3>
        </div>
      </div>
      {draft.note ? <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#2B2D36" }}>{draft.note}</p> : null}
      <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
        {draft.milestones.map((m, i) => {
          const on = chosen.has(i);
          return (
            <li key={i}>
              <button type="button" role="checkbox" aria-checked={on ? "true" : "false"} onClick={() => toggle(i)}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) auto", gap: "12px", alignItems: "start", padding: "10px 12px", textAlign: "left", background: on ? "#FFF4D1" : "#F7F8FA", border: "0", borderRadius: "10px", cursor: "pointer" }}>
                <span aria-hidden="true" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", background: on ? "#12131A" : "#FFFFFF", color: "#FFFFFF", border: "2px solid #12131A", borderRadius: "6px" }}>{on ? <CheckIcon size={12} width={3} /> : null}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" }}>
                  <strong style={{ fontSize: "14px", lineHeight: "1.35" }}>{m.title}</strong>
                  {m.hint ? <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#4A4F5C" }}>{m.hint}</span> : null}
                </span>
                <span style={{ font: "500 12px/22px 'Geist Mono', monospace", color: "#4A4F5C", whiteSpace: "nowrap" }}>{m.dueAt ? dueLabel(m.dueAt) : "Sin fecha"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <button type="button" disabled={busy || !chosen.size} onClick={accept} style={{ ...darkBtn, height: "42px" }}>
          {busy ? <Spinner /> : null}
          {chosen.size === draft.milestones.length ? "Añadir todos" : chosen.size ? `Añadir ${chosen.size === 1 ? "el elegido" : `los ${chosen.size} elegidos`}` : "Elige al menos uno"}
        </button>
        <button type="button" disabled={busy || againBusy} onClick={onAgain} style={smallBtn}>{againBusy ? "Pensando…" : "Proponer otros"}</button>
        <button type="button" disabled={busy} onClick={discard} style={textBtn}>{"Descartar"}</button>
      </div>
      {error ? <span role="alert" style={errorText}>{error}</span> : null}
    </section>
  );
}
