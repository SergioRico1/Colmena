import { useState } from "react";
import { Check } from "lucide-react";
import { post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { codeKind, findCode } from "../../../lib/teams.js";
import { TEAM_CHOICES } from "../../../lib/onboarding.js";
import { CodeCard } from "../team/TeamSheets.jsx";

// Bienvenida › «Tu equipo» (docs/PLAN-equipo-y-salas.md, scope 5): create a team, join one
// with a code, or start alone. The same calls as the team's sheets (v3/team/TeamSheets.jsx):
//   POST /api/teams {name} · POST /api/teams/:id/invite {name?} → {code, text}
//   POST /api/peers/invites/preview {code} · POST /api/teams/join | /api/peers/invites/accept
// Nothing here is needed to go on: «Empezar solo» is a choice like the others, and a team
// can be created or joined later from the bar's header.
const INK = "#12131A", MUTED = "#5C606C", TEXT2 = "#4A4D57", GREEN = "#0B6B4A", RED = "#B4232A";
const hidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
const fieldRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" };
const input = { flex: "1 1 240px", minWidth: 0, height: "46px", padding: "0 16px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-lg)", background: "#FFFFFF", fontSize: "var(--t-body)", color: INK };
const dark = (on = true) => ({ height: "46px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: INK, color: "#FFFFFF", fontSize: "var(--t-body)", fontWeight: 600, cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.5, flex: "none" });
const quiet = { height: "46px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", color: TEXT2, fontSize: "var(--t-body)", fontWeight: 500, cursor: "pointer" };
const note = { margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: MUTED };
const body = { display: "flex", flexDirection: "column", gap: "12px", padding: "0 20px 20px 20px", animation: "rise .25s ease-out" };

/**
 * `value`: {choice: "create" | "join" | "solo", team?: {id, name}, joined?: {name, kind}};
 * `onChange` gets the next one. `off`: Colmena has no mailbox, so there is nobody to reach yet.
 */
export default function TeamStep({ value, onChange, off = false }) {
  const { run } = useStore();
  const [name, setName] = useState("");
  const [person, setPerson] = useState("");
  const [made, setMade] = useState(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const choice = value?.choice || "solo";
  const pick = (id) => { if (id !== choice) { setError(null); onChange({ ...value, choice: id }); } };
  const act = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const create = () => act("create", async () => {
    const team = await run(() => post("/teams", { name: name.trim() }));
    onChange({ ...value, choice: "create", team: { id: team.id, name: team.name } });
  });
  const invite = () => act("invite", async () => setMade(await run(() => post(`/teams/${encodeURIComponent(value.team.id)}/invite`, person.trim() ? { name: person.trim() } : {}))));
  const code = findCode(text);
  const what = preview ? codeKind(preview) : null;
  const look = () => {
    if (!code) { setError("Eso no parece un código de Colmena. Es como COLMENA-XXXX-XXXX-XXXX-XXXX; puedes pegar el mensaje entero."); return; }
    act("look", async () => setPreview(await post("/peers/invites/preview", { code })));
  };
  const accept = () => act("join", async () => {
    const out = await run(() => (what.kind === "team" ? post("/teams/join", { code }) : post("/peers/invites/accept", { code })));
    onChange({ ...value, choice: "join", joined: { kind: what.kind, name: what.kind === "team" ? out?.name || preview.team : what.from } });
  });

  const offNote = <p role="note" style={note}>{"Para trabajar con otras personas, Colmena tiene que estar conectada al buzón de mensajes. Lo activas en Ajustes › Personas conectadas; puedes seguir y hacerlo después."}</p>;
  const panels = {
    create: value?.team ? (
      <div style={body}>
        <p role="status" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-body)", fontWeight: 600, color: GREEN }}><Check size={16} strokeWidth={2.8} aria-hidden="true" />{`«${value.team.name}» está creado, con su sala «general».`}</p>
        {made ? (
          <>
            <CodeCard made={made} onError={setError} />
            <p style={note}>{"Mándasela tú, por donde quieras: Colmena no escribe a nadie por ti. Cuando pegue el código os saldrán las mismas cuatro palabras a los dos."}</p>
            <button type="button" onClick={() => { setMade(null); setPerson(""); }} style={{ ...quiet, alignSelf: "flex-start", paddingLeft: 0 }}>{"Invitar a otra persona"}</button>
          </>
        ) : (
          <>
            <form onSubmit={(e) => { e.preventDefault(); invite(); }} style={fieldRow}>
              <label style={{ flex: "1 1 240px", display: "flex", minWidth: 0 }}>
                <span style={hidden}>{"Nombre de la primera persona (opcional)"}</span>
                <input className="c-quiet" type="text" value={person} maxLength={80} onChange={(e) => setPerson(e.target.value)} placeholder="¿A quién invitas primero? (opcional)" style={input} />
              </label>
              <button type="submit" disabled={!!busy} style={dark(!busy)}>{busy === "invite" ? "Creando…" : "Crear invitación"}</button>
            </form>
            <p style={note}>{"Te damos un código para que se lo mandes. Vale 24 horas y una sola vez. También puedes invitar más tarde, desde Equipo."}</p>
          </>
        )}
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
    join: value?.joined ? (
      <div style={body}>
        <p role="status" style={{ margin: 0, display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "var(--t-body)", lineHeight: 1.45, fontWeight: 600, color: GREEN }}>
          <Check size={16} strokeWidth={2.8} aria-hidden="true" style={{ flex: "none", marginTop: "3px" }} />
          {value.joined.kind === "team" ? `Has pedido entrar en «${value.joined.name}».` : `Ya puedes escribirte con ${value.joined.name}.`}
        </p>
        {value.joined.kind === "team" ? <p style={note}>{"Estarás dentro en cuanto la Colmena de quien creó el equipo esté encendida. Mientras, lo verás como pendiente arriba, en la barra."}</p> : null}
      </div>
    ) : preview ? (
      <div style={body}>
        <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: 1.5 }}><strong style={{ fontWeight: 600 }}>{what.title + "."}</strong>{" " + what.text}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "#F4F4F0" }}>
          <span style={{ fontSize: "var(--t-ui)", color: TEXT2 }}>{`Pídele a ${what.from} que te diga sus cuatro palabras. Deben ser estas:`}</span>
          <strong style={{ font: "600 var(--t-title)/1.25 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{(preview.words || []).join(" · ")}</strong>
        </div>
        <div style={fieldRow}>
          <button type="button" onClick={accept} disabled={!!busy} style={dark(!busy)}>{busy === "join" ? "Un momento…" : what.confirm}</button>
          <button type="button" onClick={() => { setPreview(null); setError(null); }} style={quiet}>{"No coinciden o no le conozco"}</button>
        </div>
      </div>
    ) : (
      <div style={body}>
        {off ? offNote : (
          <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) look(); }} style={fieldRow}>
            <label style={{ flex: "1 1 240px", display: "flex", minWidth: 0 }}>
              <span style={hidden}>{"Código de invitación"}</span>
              <input className="c-quiet" type="text" value={text} maxLength={600} onChange={(e) => { setText(findCode(e.target.value) || e.target.value); setError(null); }} placeholder="COLMENA-XXXX-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" style={{ ...input, font: "500 var(--t-body)/1 'Geist Mono', monospace" }} />
            </label>
            <button type="submit" disabled={!text.trim() || !!busy} style={dark(!!text.trim() && !busy)}>{busy === "look" ? "Buscando…" : "Continuar"}</button>
          </form>
        )}
        <p style={note}>{"Pega el código que te han mandado, o el mensaje entero. Antes de entrar verás de quién es y para qué."}</p>
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
          <div key={c.id} style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "#FFFFFF", boxShadow: `inset 0 0 0 2px ${on ? INK : "transparent"}` }}>
            <button type="button" role="radio" aria-checked={on} onClick={() => pick(c.id)} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "72px", padding: "14px 20px", border: 0, borderRadius: "var(--r-xl)", background: "transparent", textAlign: "left", cursor: "pointer" }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{c.title}</span>
                <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.45, color: MUTED }}>{c.text}</span>
              </span>
              <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: done ? GREEN : on ? INK : "transparent", boxShadow: on || done ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.25)" }}>
                <Check size={12} strokeWidth={3.2} color="#FFFFFF" style={{ opacity: on || done ? 1 : 0 }} />
              </span>
            </button>
            {on ? panels[c.id] : null}
            {on && error ? <p role="alert" style={{ margin: 0, padding: "0 20px 18px", fontSize: "var(--t-ui)", lineHeight: 1.45, color: RED }}>{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
