import { useState } from "react";
import { post } from "../../lib/api.js";
import { BotMark } from "../v2/chat/Mark.jsx";
import { askChoices } from "../../lib/roomView.js";

// What other people asked YOUR bots in this room and waits for you (`asks` of the room view,
// docs/CONTRACT.md §18). It waits for you, so it is honey; everyone else sees the neutral line
// «Vera espera el OK de Sergio». Shown once, here (not again among the composer's approvals).
const btn = { minHeight: "36px", padding: "0 14px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", fontSize: "13px", fontWeight: 600, cursor: "pointer" };

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
    <section aria-label="Te esperan en esta sala" style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "0 clamp(16px, 3vw, 28px) 10px" }}>
      {waiting.map((ask) => (
        <div key={ask.id} id={"peticion-" + ask.id} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "16px", background: "#FFF4D1", boxShadow: "inset 0 0 0 1px #F2D27A" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", lineHeight: 1.45 }}>
            {ask.bot ? <BotMark bot={ask.bot} size={16} /> : null}
            <span><strong style={{ fontWeight: 600 }}>{ask.from?.name || "Alguien"}</strong>{" pide algo a "}<strong style={{ fontWeight: 600 }}>{ask.bot?.name || "tu bot"}</strong>{". Trabajará en tu ordenador, con tu cuenta."}</span>
          </span>
          {ask.text ? <p style={{ margin: 0, padding: "8px 12px", borderRadius: "10px", background: "rgba(255,255,255,.7)", fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ask.text}</p> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {askChoices(ask).map(([decision, label], i) => (
              <button key={decision} type="button" disabled={busy === ask.id} onClick={() => decide(ask, decision)} style={i === 0 ? { ...btn, background: "#12131A", borderColor: "#12131A", color: "#FFFFFF" } : btn}>{label}</button>
            ))}
          </div>
        </div>
      ))}
      {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4372A" }}>{error}</span> : null}
    </section>
  );
}
