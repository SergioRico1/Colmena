import { useState } from "react";
import { post } from "../../lib/api.js";
import { firstName } from "../../lib/identity.js";
import { UserPlus } from "../Icon.js";
import { PersonAvatar } from "./Author.jsx";
import { WaitPill } from "./InlineApprovals.jsx";
import "../../styles/conversation.css";

// «Please add» (docs/PEOPLE.md › Salas): someone in a room YOU made asks you to let a person in.
// Only you can (you sign who is in it), so it waits for you: the honey card over the composer,
// counted with everything else that waits (server/waiting.mjs). «Añadir» puts them in at once;
// «Ahora no» tells whoever asked. Whoever asked sees a neutral «Pendiente» meanwhile.
//   POST /api/rooms/:id/requests/:request {decision: approve | decline}
export default function RoomAddRequests({ roomId, title = "sala", requests = [], onDecided = null }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!requests.length) return null;
  const decide = async (r, decision) => {
    setBusy(r.id);
    setError(null);
    try { await post(`/rooms/${encodeURIComponent(roomId)}/requests/${encodeURIComponent(r.id)}`, { decision }); }
    catch (e) { if (e.status !== 409) setError(e.message); } // 409: already decided
    finally { setBusy(null); onDecided?.(); }
  };
  return (
    <section aria-label="Peticiones para añadir personas, te esperan" style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "0 0 10px" }}>
      {requests.map((r) => {
        const asker = firstName(r.from?.name);
        const who = r.person?.name || "una persona";
        return (
          <section key={r.id} aria-labelledby={"anadir-t-" + r.id} className="v4-need" style={{ width: "100%" }}>
            <div className="v4-need-h">
              <WaitPill />
              <span className="t" id={"anadir-t-" + r.id}>
                {r.from ? <PersonAvatar person={r.from} size={20} /> : null}
                <span>{`${asker} pide añadir a ${who}`}</span>
              </span>
            </div>
            <div className="v4-need-w"><UserPlus size={16} style={{ flex: "none", color: "var(--c-text-3)" }} />{`Solo tú puedes, porque creaste #${title}. ${firstName(who)} verá lo que se escriba a partir de ahora, no lo anterior.`}</div>
            <div className="v4-need-f">
              <button type="button" className="v4-btn primary" disabled={busy === r.id} onClick={() => decide(r, "approve")}>{busy === r.id ? "Un momento…" : `Añadir a ${firstName(who)}`}</button>
              <button type="button" className="v4-btn" disabled={busy === r.id} onClick={() => decide(r, "decline")}>{"Ahora no"}</button>
              <span className="note">{`Si dices que no, se lo diremos a ${asker}.`}</span>
            </div>
          </section>
        );
      })}
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</span> : null}
    </section>
  );
}
