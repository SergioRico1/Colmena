import { useState } from "react";
import { post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { SELF_FALLBACK, lacksOwnName, selfLabel } from "../../lib/ownName.js";
import { BotMark } from "../v2/chat/Mark.jsx";
import { PersonAvatar } from "./Author.jsx";
import { QUEUE } from "./RoomExtras.jsx";
import { compactBots, noBotsText } from "../../lib/roomView.js";
import { srOnly } from "../../lib/alt.js";

// The member panel of a room (docs/PLAN-equipo-y-salas.md, scope 3), on the right while no other
// panel is open: «Personas · N» with their role in the room and their presence in words, «Bots»
// grouped by owner («Tus bots», «Bots de Lucía») with role and state in words, then the room's
// rules and files. What waits for someone else is neutral here; only «te espera» wears honey.
const head = { margin: "0 0 2px", fontSize: "var(--t-meta)", fontWeight: 600, color: "#5C606C" };
const small = { fontSize: "var(--t-meta)", color: "#5C606C" };
const pill = { minHeight: "32px", padding: "0 12px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-pill)", background: "#FFFFFF", color: "#12131A", fontSize: "var(--t-meta)", fontWeight: 500, cursor: "pointer" };
const ellipsis = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** «Lucía pide añadir a Marta»: informative, for whoever made the room. Neutral colours. */
function Requests({ view, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const decide = async (r, decision) => {
    setBusy(r.id);
    setError(null);
    try { await post(`/rooms/${encodeURIComponent(view.id)}/requests/${encodeURIComponent(r.id)}`, { decision }); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  if (!view.requests?.length) return null;
  return (
    <section aria-label="Peticiones para añadir personas" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {view.requests.map((r) => (
        <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px", borderRadius: "var(--r-lg)", background: "#F6F6F3" }}>
          <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.45 }}><strong style={{ fontWeight: 600 }}>{r.from?.name || "Alguien"}</strong>{" pide añadir a "}<strong style={{ fontWeight: 600 }}>{r.person?.name || "una persona"}</strong>{" a la sala."}</span>
          <span style={small}>{"Verá lo que se escriba a partir de ahora, no lo anterior."}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" disabled={busy === r.id} onClick={() => decide(r, "approve")} style={{ ...pill, background: "#12131A", borderColor: "#12131A", color: "#FFFFFF", fontWeight: 600 }}>{"Añadir"}</button>
            <button type="button" disabled={busy === r.id} onClick={() => decide(r, "decline")} style={pill}>{"Ahora no"}</button>
          </span>
        </div>
      ))}
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "#B4372A" }}>{error}</span> : null}
    </section>
  );
}

/**
 * Someone else's bots: one compact row of marks and names (wrapping to a second line), the busy
 * ones first, the rest behind «Ver los N». Each says whose it is to a screen reader.
 */
function OwnerBots({ group }) {
  const [open, setOpen] = useState(false);
  const { shown, hidden } = compactBots(group.bots, open);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <h2 style={head}>{`${group.label} · ${group.bots.length}`}</h2>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
        {shown.map((b) => (
          <li key={b.id} title={[b.shown, b.role, b.state !== "free" ? b.stateWord : null].filter(Boolean).join(" · ")}
            style={{ display: "inline-flex", alignItems: "center", gap: "7px", minHeight: "28px", maxWidth: "100%", fontSize: "var(--t-ui)", color: "#12131A" }}>
            <BotMark bot={b} size={20} owner={group.owner} state={b.state === "working" || b.state === "thinking" ? "work" : "rest"} style={{ marginRight: "3px" }} />
            <span style={srOnly}>{b.a11y + (b.state !== "free" ? ", " + b.stateWord : "")}</span>
            <span aria-hidden="true" style={{ ...ellipsis, fontWeight: 500 }}>{b.name}</span>
            {b.state !== "free" ? <span aria-hidden="true" style={{ ...small, flex: "none" }}>{b.stateWord}</span> : null}
          </li>
        ))}
      </ul>
      {hidden || open ? (
        <button type="button" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} style={{ ...pill, alignSelf: "flex-start", minHeight: "28px", padding: "0 10px" }}>
          {open ? "Ver menos" : `Ver los ${group.bots.length}`}
        </button>
      ) : null}
    </section>
  );
}

export default function MemberPanel({ view, panel, mission = null, addable = [], fileCount = 0, onRules = null, onFiles = null, onInvite = null, onChanged = null }) {
  const { act, busy } = useAction();
  const nameless = lacksOwnName(useStore());
  const queue = QUEUE.find(([v]) => v === (mission?.queueMode || "steer"))?.[1] || QUEUE[0][1];
  const rules = mission ? [
    ["Si escribes mientras trabajan", queue.charAt(0).toUpperCase() + queue.slice(1)],
    ["Para enviar algo fuera o gastar dinero", mission.safety === "avisar" ? "Te avisan antes y esperan tu OK" : "Siempre esperan tu OK"],
    ...(view.private ? [] : [["Lo que ven los demás", "Lo que dicen tus bots y lo que entregan. Nunca sus pasos ni tus archivos"]]),
  ] : [];
  return (
    <aside id="sala-miembros" aria-label="Miembros de la sala" style={{ flex: "1 1 300px", maxWidth: "360px", minWidth: "280px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "22px", padding: "20px", background: "#FFFFFF", borderLeft: "1px solid rgba(18,19,26,.07)" }}>
      <Requests view={view} onChanged={onChanged} />
      <section style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 style={head}>{`Personas · ${panel.people.length}`}</h2>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
          {panel.people.map((p) => (
            <li key={p.address || p.name} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px" }}>
              <PersonAvatar person={p} size={28} ring="#FFFFFF" presence={p.you ? null : p.presence === "online" ? "online" : "offline"} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                <span style={{ ...ellipsis, fontSize: "var(--t-ui)", fontWeight: 500 }}>{p.you ? (selfLabel(p.name) === SELF_FALLBACK ? SELF_FALLBACK : `${p.name} (tú)`) : p.name}</span>
                <span style={{ ...ellipsis, ...small }}>{p.roleWord}</span>
              </span>
              <span style={{ flex: "none", ...small }}>{p.presenceWord}</span>
            </li>
          ))}
        </ul>
        {/* Where your name matters (a room with people): a quiet way to set it. */}
        {nameless && panel.people.length > 1 ? <a href="/ajustes/general#tu-nombre" style={{ ...small, lineHeight: 1.45, paddingTop: "2px", color: "#3D404A" }}>{"Los demás te ven como «Sin nombre». "}<span style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{"Ponte un nombre"}</span></a> : null}
        {onInvite && !view.general ? <button type="button" onClick={onInvite} style={{ ...pill, alignSelf: "flex-start", marginTop: "6px" }}>{"Invitar a una persona"}</button> : null}
      </section>
      {panel.groups.map((g) => (g.mine ? (
        <section key="mine" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 style={head}>{`${g.label} · ${g.bots.length}`}</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
            {g.bots.map((b) => (
              <li key={b.id}>
                <a href={`/equipo/${b.id}`} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", color: "#12131A" }}>
                  <span aria-hidden="true" style={{ flex: "none", width: "28px", height: "28px", display: "grid", placeItems: "center" }}><BotMark bot={b} size={20} state={b.state === "working" || b.state === "thinking" ? "work" : b.state === "waiting" ? "wait" : "rest"} /></span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                    <span style={{ ...ellipsis, fontSize: "var(--t-ui)", fontWeight: 500 }}>{b.name}</span>
                    <span style={{ ...ellipsis, ...small }}>{b.role || "bot"}</span>
                  </span>
                  <span style={{ flex: "none", fontSize: "var(--t-meta)", color: b.state === "waiting" ? "#12131A" : "#5C606C", fontWeight: b.state === "waiting" ? 600 : 400 }}>{b.stateWord}</span>
                </a>
              </li>
            ))}
          </ul>
          {addable.length && mission ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingTop: "6px" }}>
              {addable.map((b) => (
                <button key={b.id} type="button" disabled={busy} onClick={() => act(() => post(`/missions/${mission.id}/members`, { botId: b.id }))} aria-label={`Añadir a ${b.name} a la sala`} title={[b.name, b.role].filter(Boolean).join(" · ")} style={{ ...pill, display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 10px 0 8px", fontSize: "var(--t-meta)", color: "#3D404A" }}>
                  <BotMark bot={b} size={12} />{"+ " + b.name}
                </button>
              ))}
            </div>
          ) : null}
          {!view.private ? <span style={{ ...small, lineHeight: 1.45, paddingTop: "4px" }}>{"Trabajan en tu ordenador, con tu cuenta. Nómbralos con @ para que contesten aquí."}</span> : null}
        </section>
      ) : <OwnerBots key={g.owner?.address || g.label} group={g} />))}
      {panel.groups.length ? null : (
        <section style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 style={head}>{"Bots · 0"}</h2>
          <span style={{ ...small, lineHeight: 1.5 }}>{noBotsText(view)}</span>
          {view.private ? null : <a href="/equipo" style={{ ...pill, alignSelf: "flex-start", marginTop: "4px", display: "inline-flex", alignItems: "center", textDecoration: "none", color: "#12131A" }}>{"Ver mis bots"}</a>}
        </section>
      )}
      {rules.length ? (
        <section style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "var(--r-lg)", background: "#F6F6F3" }}>
          <h2 style={{ margin: 0, fontSize: "var(--t-ui)", fontWeight: 600 }}>{"Reglas de esta sala"}</h2>
          {rules.map(([k, v]) => <div key={k} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--t-ui)", lineHeight: "1.45" }}><span style={{ color: "#5C606C" }}>{k}</span><span style={{ fontWeight: 500 }}>{v}</span></div>)}
          {onRules ? <button type="button" onClick={onRules} style={{ ...pill, alignSelf: "flex-start" }}>{"Cambiar reglas"}</button> : null}
        </section>
      ) : null}
      {/* How rooms, people and bots work: the help page, one step away from where it matters. */}
      {view.private ? null : <a href="/personas/como-funciona" style={{ ...small, alignSelf: "flex-start", minHeight: "24px", display: "inline-flex", alignItems: "center", color: "#3D404A", textDecoration: "underline", textUnderlineOffset: "3px" }}>{"Cómo funciona"}</a>}
      {onFiles ? <button type="button" onClick={onFiles} style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "44px", padding: "0 14px", borderRadius: "var(--r-md)", border: "1px solid rgba(18,19,26,.1)", background: "transparent", color: "#12131A", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer" }}>{"Archivos de la sala"}<span style={{ color: "#5C606C" }}>{fileCount}</span></button> : null}
    </aside>
  );
}
