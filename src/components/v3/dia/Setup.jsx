import { useState } from "react";
import { CircleCheck, Sparkles, UserRound, Plug, UserPlus, X } from "../../Icon.js";
import { patch } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { setupSteps } from "../../../lib/setupSteps.js";
import { C, line } from "../../../lib/theme.js";
import { B, CARD, H2, ONE } from "../../../lib/ui4.js";

// Inicio › «Para empezar · 1 de 4» (design/v4 proto-inicio): the four steps that make Colmena
// useful, each one a link to the flow that already does it. «Ahora no» puts an optional step
// off and the × closes the card (settings.setupHidden); it hides by itself once all is done.

const ICONS = { ai: Sparkles, about: UserRound, apps: Plug, invite: UserPlus };
const go = (href) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(href); };

export default function SetupCard({ state }) {
  const { steps, done, total, show } = setupSteps(state);
  const [busy, setBusy] = useState(false);
  if (!show) return null;
  const hidden = Array.isArray(state.settings?.setupHidden) ? state.settings.setupHidden : [];
  const hide = (id) => async () => {
    setBusy(true);
    try { await state.run(() => patch("/settings", { setupHidden: [...new Set([...hidden, id])] })); } finally { setBusy(false); }
  };
  const shown = steps.filter((s) => !s.hidden);
  return (
    <section aria-labelledby="setup-t" style={{ ...CARD, background: C.raised }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 12px 10px 16px" }}>
        <h2 id="setup-t" style={{ ...H2, flex: 1 }}>{"Para empezar"}</h2>
        <span style={{ fontSize: "var(--t-meta)", color: C.text3, fontVariantNumeric: "tabular-nums" }}>{`${done} de ${total}`}</span>
        <button type="button" className="u4-ghost" onClick={hide("all")} disabled={busy} aria-label="Cerrar «Para empezar»" title="Cerrar" style={{ ...B.icon, width: "28px", height: "28px" }}><X size={15} /></button>
      </div>
      <div role="progressbar" aria-label="Pasos hechos" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} style={{ display: "flex", gap: "4px", padding: "0 16px 12px" }}>
        {steps.map((s, i) => <i key={s.id} style={{ flex: 1, height: "4px", borderRadius: "var(--r-xs)", background: i < done ? C.ok : C.line }} />)}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {shown.map((s) => {
          const Icon = s.done ? CircleCheck : ICONS[s.id];
          return (
            <li key={s.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 16px", borderTop: line() }}>
              <Icon size={20} active={s.done} aria-hidden="true" style={{ flex: "none", color: s.done ? C.ok : C.text3 }} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                <span style={{ fontSize: "var(--t-ui)", fontWeight: s.done ? 500 : 600, color: s.done ? C.text3 : C.text }}>{s.title}{s.done ? <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{" (hecho)"}</span> : null}</span>
                <span style={{ ...ONE, fontSize: "var(--t-meta)", color: C.text3 }}>{s.text}</span>
              </span>
              {s.done ? null : (
                <span style={{ flex: "none", display: "flex", alignItems: "center", gap: "6px" }}>
                  {s.optional ? <button type="button" className="u4-ghost" onClick={hide(s.id)} disabled={busy} style={B.ghost}>{"Ahora no"}</button> : null}
                  <a href={s.action.href} onClick={go(s.action.href)} className="u4-sec" style={B.secondary}>{s.action.label}</a>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
