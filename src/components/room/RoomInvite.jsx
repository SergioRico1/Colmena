import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { post } from "../../lib/api.js";
import { useResource, useStore } from "../../lib/store.jsx";
import { firstName } from "../../lib/identity.js";
import { inviteCandidates, inviteTruth } from "../../lib/roomView.js";
import { Sheet, darkBtn, errorLine, fieldBox, fieldInput, hidden, note } from "../v3/team/TeamSheets.jsx";
import { PersonAvatar } from "./Author.jsx";

// «Invitar» from the room (docs/PLAN-equipo-y-salas.md, scope 3): teammates and people you
// already talk to, one click each; someone new gets a code. It always says the truth about what
// they will see. Whoever did not make the room asks its owner (`POST /api/rooms/:id/people`
// answers 202: nothing has changed yet).
const row = { display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "4px 6px 4px 8px", borderRadius: "var(--r-lg)" };
const smallBtn = { flex: "none", minHeight: "34px", padding: "0 14px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-pill)", background: "#FFFFFF", color: "#12131A", fontSize: "var(--t-meta)", fontWeight: 600, cursor: "pointer" };

export default function RoomInvite({ view, onClose, onChanged = null }) {
  const { peers } = useStore();
  const team = useResource(view.teamId ? `/teams/${encodeURIComponent(view.teamId)}` : null);
  const [query, setQuery] = useState("");
  const [done, setDone] = useState({}); // address → "added" | "asked"
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  const truth = inviteTruth(view);
  const all = useMemo(() => inviteCandidates({ view, team: team.data, contacts: peers?.contacts || [] }), [view, team.data, peers]);
  const list = useMemo(() => inviteCandidates({ view, team: team.data, contacts: peers?.contacts || [], query }), [view, team.data, peers, query]);
  // Someone added a moment ago leaves the candidates with the next room view: keep their row.
  const [kept, setKept] = useState([]);
  const shown = [...kept.filter((p) => !list.some((x) => x.address === p.address) && (!query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()))), ...list];
  const path = `/rooms/${encodeURIComponent(view.id)}/people`;

  const add = async (p) => {
    if (busy) return;
    setBusy(p.address);
    setError(null);
    try {
      const out = await post(path, { address: p.address });
      setKept((k) => (k.some((x) => x.address === p.address) ? k : [...k, p]));
      setDone((d) => ({ ...d, [p.address]: out?.asked ? "asked" : "added" }));
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const makeCode = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy("code");
    setError(null);
    try { const out = await post(path, { invite: { name: name.trim() } }); setMade(out.invite); onChanged?.(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(made.text || made.code); setCopied(true); } catch { setError("No se pudo copiar. Selecciona el texto y cópialo tú."); }
  };

  const title = "Invitar a #" + view.title;
  if (view.general) {
    return (
      <Sheet id="room-inv" title={title} onClose={onClose} width={520}>
        <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: 1.55 }}>{"En «general» está todo el equipo: quien entra al equipo entra aquí."}</p>
        <a href="/equipo#equipo" onClick={onClose} style={{ ...darkBtn(), alignSelf: "flex-start", textDecoration: "none" }}>{"Invitar al equipo"}</a>
      </Sheet>
    );
  }
  return (
    <Sheet id="room-inv" title={title} sub={<>{truth.line + " "}<a href="/personas/como-funciona#quien-entra" onClick={onClose} style={{ color: "#1F4FD1", fontWeight: 600 }}>{"Cómo funciona"}</a></>} onClose={onClose} width={560}>
      {truth.asks ? <p role="note" style={{ margin: 0, padding: "12px 16px", borderRadius: "var(--r-lg)", background: "#F4F4F0", fontSize: "var(--t-ui)", lineHeight: 1.5 }}>{`${truth.ask}: la sala es suya y solo ${firstName(truth.owner)} puede añadir personas.`}</p> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {all.length > 5 || query ? (
          <label style={{ ...fieldBox, padding: "0 14px" }}>
            <Search size={16} strokeWidth={2.2} aria-hidden="true" color="#5C606C" />
            <span style={hidden}>{"Buscar a una persona"}</span>
            <input className="c-bare" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre" style={{ ...fieldInput, height: "42px", fontSize: "var(--t-body)" }} />
          </label>
        ) : null}
        {shown.length ? (
          <ul aria-label="Personas que puedes añadir" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px", maxHeight: "280px", overflowY: "auto" }}>
            {shown.map((p) => {
              const state = done[p.address];
              return (
                <li key={p.address} style={row}>
                  <PersonAvatar person={p} size={30} ring="#FFFFFF" presence={p.source === "equipo" || p.presence === "online" ? p.presence : null} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                    <span style={{ fontSize: "var(--t-body)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontSize: "var(--t-meta)", color: "#5C606C" }}>{p.source === "equipo" ? "del equipo" : "ya habláis"}</span>
                  </span>
                  {state ? (
                    <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: "#3D404A" }}>
                      <Check size={14} strokeWidth={2.6} aria-hidden="true" />{state === "asked" ? `Pedido a ${firstName(truth.owner)}` : "Ya está en la sala"}
                    </span>
                  ) : (
                    <button type="button" onClick={() => add(p)} disabled={!!busy} aria-label={(truth.asks ? "Pedir que añadan a " : "Añadir a ") + p.name} style={{ ...smallBtn, opacity: busy === p.address ? 0.6 : 1 }}>{busy === p.address ? "Un momento…" : truth.asks ? "Pedirlo" : "Añadir"}</button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p style={note}>{query ? "Nadie con ese nombre. Para alguien nuevo, usa un código." : all.length ? "" : view.teamId ? "Todo tu equipo y las personas con las que hablas están ya en la sala." : truth.asks ? "Todas las personas con las que hablas están ya en la sala." : "Todavía no hablas con nadie más. Invita a alguien nuevo con un código."}</p>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "18px", borderTop: "1px solid rgba(18,19,26,.08)" }}>
        <h3 style={{ margin: 0, fontSize: "var(--t-body)", fontWeight: 600 }}>{"Invitar con un código"}</h3>
        {truth.asks ? (
          <p style={note}>{`Para alguien que aún no usa Colmena contigo, pídele a ${firstName(truth.owner)} que le invite con un código.`}</p>
        ) : made ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRadius: "var(--r-xl)", background: "#F4F4F0" }}>
            <code style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "var(--r-md)", background: "#FFFFFF", font: "500 var(--t-body)/1 'Geist Mono', monospace", letterSpacing: "0.04em", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.08)", userSelect: "all" }}>{made.code}</code>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
              <button type="button" onClick={copy} style={darkBtn()}><Copy size={15} strokeWidth={2.2} aria-hidden="true" />{copied ? "Copiada" : "Copiar invitación"}</button>
              <span style={{ fontSize: "var(--t-meta)", color: "#5C606C" }}>{"24 h, un solo uso. Envíasela tú: Colmena no la manda."}</span>
              <span role="status" style={hidden}>{copied ? "Invitación copiada" : ""}</span>
            </div>
          </div>
        ) : (
          <form onSubmit={makeCode} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={fieldBox}>
              <span style={hidden}>{"Nombre de la persona"}</span>
              <input className="c-bare" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Cómo se llama" style={fieldInput} />
              <button type="submit" disabled={!name.trim() || !!busy} style={{ ...darkBtn(!!name.trim() && !busy), height: "40px" }}>{busy === "code" ? "Creando…" : "Crear código"}</button>
            </label>
            <p style={note}>{"Para alguien que aún no está entre tus personas. Al aceptarlo entra directamente en esta sala."}</p>
          </form>
        )}
      </div>
      {error ? <p role="alert" style={errorLine}>{error}</p> : null}
    </Sheet>
  );
}
