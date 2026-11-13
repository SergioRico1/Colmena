import { useState } from "react";
import { Check } from "../../Icon.js";
import { post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { TEAM_CHOICES } from "../../../lib/onboarding.js";
import CodePanel from "../../people/CodePanel.jsx";
import { JoinFlow } from "../../people/JoinSheet.jsx";
import { C } from "../../../lib/theme.js";

// Bienvenida › «Tu equipo» (docs/PLAN-equipo-y-salas.md, scope 5): create a team, join one
// with a code, or start alone. The same pieces and words as everywhere (docs/SCREENS.md ›
// «Invitar»): POST /api/teams {name}, then the code panel of the «Invitar» sheet for that team
// (people/CodePanel.jsx); «Unirme con un código» is the same flow as its sheet (people/JoinSheet.jsx).
// Nothing here is needed to go on: «Empezar solo» is a choice like the others, and a team
// can be created or joined later from the bar's header.
const INK = C.text, GREEN = C.okInk;
const hidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
const fieldRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" };
const input = { flex: "1 1 240px", minWidth: 0, height: "46px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-lg)", background: "var(--c-card)", fontSize: "var(--t-body)", color: "var(--c-text)" };
const dark = (on = true) => ({ height: "36px", padding: "0 14px", border: 0, borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: 600, cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.5, flex: "none" });
const note = { margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-3)" };
const body = { display: "flex", flexDirection: "column", gap: "12px", padding: "0 20px 20px 20px", animation: "rise .25s ease-out" };

/**
 * `value`: {choice: "create" | "join" | "solo", team?: {id, name}, joined?: {name, kind}};
 * `onChange` gets the next one. `off`: Colmena has no mailbox, so there is nobody to reach yet.
 */
export default function TeamStep({ value, onChange, off = false }) {
  const { run } = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const choice = value?.choice || "solo";
  const pick = (id) => { if (id !== choice) { setError(null); onChange({ ...value, choice: id }); } };
  const create = async () => {
    if (busy) return;
    setBusy("create");
    setError(null);
    try {
      const team = await run(() => post("/teams", { name: name.trim() }));
      onChange({ ...value, choice: "create", team: { id: team.id, name: team.name } });
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const offNote = <p role="note" style={note}>{"Para invitar a gente, Colmena usa un buzón cifrado: por él viajan los mensajes cerrados con llave. Lo activas en Ajustes › Contactos y equipos; puedes seguir y hacerlo después."}</p>;
  const panels = {
    create: value?.team ? (
      <div style={body}>
        <p role="status" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-body)", fontWeight: 600, color: "var(--c-ok-ink)" }}><Check size={16} strokeWidth={2.8} aria-hidden="true" />{`«${value.team.name}» está creado, con su sala #general.`}</p>
        <CodePanel context={{ kind: "team", team: { id: value.team.id, name: value.team.name, admin: true } }} />
        <p style={note}>{"También puedes invitar más tarde, con «Invitar» en Equipo o en la cabecera de la barra."}</p>
      </div>
    ) : (
      <div style={body}>
        {off ? offNote : (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create(); }} style={fieldRow}>
            <label style={{ flex: "1 1 240px", display: "flex", minWidth: 0 }}>
              <span style={hidden}>{"Nombre del equipo"}</span>
              <input className="c-quiet" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Nombre del equipo" style={input} />
            </label>
            <button type="submit" disabled={!name.trim() || !!busy} style={dark(!!name.trim() && !busy)}>{busy === "create" ? "Creando…" : "Crear equipo"}</button>
          </form>
        )}
        <p style={note}>{"Nace con una sala de todos, «general». Lo administras tú. Cada persona sigue con sus bots en su ordenador: el equipo comparte la conversación, no los datos."}</p>
      </div>
    ),
    join: (
      <div style={body}>
        {off ? offNote : <JoinFlow inline onDone={(done) => onChange({ ...value, choice: "join", joined: { kind: done.kind, name: done.name } })} />}
      </div>
    ),
    solo: (
      <div style={body}>
        <p style={note}>{"Trabajas con tus bots desde ya. Cuando quieras, crea un equipo o únete a uno desde la cabecera de la barra, arriba a la izquierda."}</p>
      </div>
    ),
  };

  return (
    <div role="radiogroup" aria-label="Con quién trabajas" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {TEAM_CHOICES.map((c) => {
        const on = choice === c.id;
        const done = (c.id === "create" && value?.team) || (c.id === "join" && value?.joined);
        return (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", boxShadow: `inset 0 0 0 2px ${on ? INK : "transparent"}` }}>
            <button type="button" role="radio" aria-checked={on} onClick={() => pick(c.id)} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "72px", padding: "14px 20px", border: 0, borderRadius: "var(--r-xl)", background: "transparent", textAlign: "left", cursor: "pointer" }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{c.title}</span>
                <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{c.text}</span>
              </span>
              <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: done ? GREEN : on ? INK : "transparent", boxShadow: on || done ? "none" : "inset 0 0 0 1.5px rgb(var(--c-ink-rgb) / .25)" }}>
                <Check size={12} strokeWidth={3.2} color={C.btnText} style={{ opacity: on || done ? 1 : 0 }} />
              </span>
            </button>
            {on ? panels[c.id] : null}
            {on && error ? <p role="alert" style={{ margin: 0, padding: "0 20px 18px", fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-error)" }}>{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
