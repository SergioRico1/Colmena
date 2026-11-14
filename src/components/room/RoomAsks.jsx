import { useState } from "react";
import { post } from "../../lib/api.js";
import BotFace from "../BotFace.jsx";
import { Cloud, Desktop } from "../Icon.js";
import { isCloud } from "../../lib/cloud.js";
import { askChoices } from "../../lib/roomView.js";
import { PersonAvatar } from "./Author.jsx";
import { WaitPill } from "./InlineApprovals.jsx";
import "../../styles/conversation.css";

// What other people asked YOUR bots in this room and waits for you (`asks` of the room view,
// docs/CONTRACT.md §18; Colmena 4: design/v4 › the colleague's request). It waits for you, so it
// wears the honey pill on the muted amber card; everyone else sees the neutral line «Vera espera
// el OK de Sergio». Shown once, here (not again among the composer's approvals): what they asked,
// where it will run, and «Adelante» · «Ahora no» · «Siempre para Lucía» · «Nunca para Lucía».
export default function RoomAsks({ roomId, asks = [], onDecided = null }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const waiting = asks.filter((a) => a.state === "asked");
  if (!waiting.length) return null;
  const decide = async (ask, decision) => {
    setBusy(ask.id);
    setError(null);
    try { await post(`/rooms/${encodeURIComponent(roomId)}/asks/${encodeURIComponent(ask.id)}`, { decision }); }
    catch (e) { if (e.status !== 409) setError(e.message); } // 409: already decided elsewhere
    finally { setBusy(null); onDecided?.(); }
  };
  return (
    <section aria-label="Te esperan en esta sala" style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "0 0 10px" }}>
      {waiting.map((ask) => {
        const who = ask.from?.name || "Alguien";
        const first = who.split(" ")[0];
        const choices = askChoices(ask);
        return (
          <section key={ask.id} id={"peticion-" + ask.id} aria-labelledby={"peticion-t-" + ask.id} className="v4-need" style={{ width: "100%" }}>
            <div className="v4-need-h">
              <WaitPill />
              <span className="t" id={"peticion-t-" + ask.id}>
                {ask.from ? <PersonAvatar person={ask.from} size={20} /> : null}
                <span>{`${first} pide algo a `}</span>
                {ask.bot ? <BotFace bot={ask.bot} size={20} decorative /> : null}
                <span>{ask.bot?.name || "tu bot"}</span>
              </span>
            </div>
            {ask.text ? <p className="v4-need-q" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{`«${ask.text}»`}</p> : null}
            {isCloud()
              ? <div className="v4-need-w"><Cloud size={16} style={{ flex: "none", color: "var(--c-text-3)" }} />{`Trabajará en la nube de tu empresa, con tu cuenta de IA. ${first} solo verá la respuesta.`}</div>
              : <div className="v4-need-w"><Desktop size={16} style={{ flex: "none", color: "var(--c-text-3)" }} />{`Trabajará en tu ordenador, con tu cuenta. ${first} solo verá la respuesta.`}</div>}
            <div className="v4-need-f">
              {choices.map(([decision, label], i) => (
                <span key={decision} style={{ display: "contents" }}>
                  {i === 2 ? <span style={{ flex: 1 }} /> : null}
                  <button type="button" className={i === 0 ? "v4-btn primary" : i === 1 ? "v4-btn" : "v4-btn ghost"} disabled={busy === ask.id} onClick={() => decide(ask, decision)}>{label}</button>
                </span>
              ))}
            </div>
          </section>
        );
      })}
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</span> : null}
    </section>
  );
}
