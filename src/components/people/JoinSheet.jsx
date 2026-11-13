import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { shareUrl } from "../../lib/peers.js";
import { findCode, realTeams } from "../../lib/teams.js";
import { WORDS, inviteBlock, joinError, joinView } from "../../lib/invite.js";
import { PersonAvatar } from "../room/Author.jsx";
import { Check, Clock3, Hash, MessageSquare, UsersThree } from "../Icon.js";
import { Blocked, InvSheet } from "./parts.jsx";

// «Unirme con un código» (docs/SCREENS.md › «Invitar»): one field for any code. As soon as a
// whole code is pasted (or the message it came in) it says what it is — a team's, a room's or a
// person's — who sent it and to what, and the four safety words to compare by voice; then
// «Coinciden · …». Clear states for a code that expired, was used or revoked, the mailbox that
// cannot be reached, and success: where it takes you next.
//   POST /api/peers/invites/preview {code}  → {name, address, kind, words, room, team, already}
//   POST /api/teams/join {code} (a team's)  · POST /api/peers/invites/accept {code} (the rest)
const KIND = { team: ["Código de equipo", UsersThree], room: ["Código de sala", Hash], person: ["Código para hablar", MessageSquare] };

/** Where accepting took you, once it is there: the room, #general of the team, the conversation. */
function useArrival(done, preview) {
  const { rooms = [], teams = [], peers } = useStore();
  return useMemo(() => {
    if (!done) return null;
    if (done.kind === "person") return { href: shareUrl(done.dm), label: "Abrir la conversación" };
    if (done.kind === "room") {
      const share = (peers?.shares || []).find((s) => s.kind !== "dm" && s.owner === preview?.address && s.title === preview?.room && !s.left && !s.removed);
      return share ? { href: `/sala/${encodeURIComponent(share.id)}`, label: `Abrir #${share.title}` } : null;
    }
    const team = realTeams(teams).find((t) => t.id === done.team || t.name === preview?.team);
    if (!team) return null;
    const general = rooms.find((r) => r.general && r.teamId === team.id);
    return { href: general ? `/sala/${encodeURIComponent(general.id)}` : "/equipo#equipo", label: general ? "Abrir #general" : "Ver el equipo" };
  }, [done, preview, rooms, teams, peers]);
}

/**
 * The flow without its dialog (the welcome uses it inline). `onDone(done)` once accepted;
 * `onClose` (in a sheet) closes it when you go where it took you.
 */
export function JoinFlow({ onDone = null, onClose = null, inline = false }) {
  const store = useStore();
  const block = inviteBlock(store.peers);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(null); // "look" | "join"
  const [error, setError] = useState(null);
  const code = findCode(text);
  const what = preview ? joinView(preview) : null;
  const arrival = useArrival(done, preview);
  const looked = useRef(null);

  const look = async (c = code) => {
    if (busy) return;
    if (!c) { setError("Eso no parece un código de Colmena. Es como COLMENA-XXXX-XXXX-XXXX-XXXX; puedes pegar el mensaje entero."); return; }
    looked.current = c;
    setBusy("look");
    setError(null);
    try { setPreview(await post("/peers/invites/preview", { code: c })); } catch (e) { setError(joinError(e)); } finally { setBusy(null); }
  };
  // A whole code pasted: say what it is right away.
  useEffect(() => { if (code && code !== looked.current && !preview && !busy) void look(code); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const accept = async () => {
    if (busy) return;
    setBusy("join");
    setError(null);
    try {
      const out = await store.run(() => (what.kind === "team" ? post("/teams/join", { code }) : post("/peers/invites/accept", { code })));
      const next = { kind: what.kind, dm: out?.dm || null, team: out?.id || out?.team || null, name: what.kind === "team" ? out?.name || preview.team : what.from };
      setDone(next);
      onDone?.(next);
    } catch (e) { setError(joinError(e)); } finally { setBusy(null); }
  };
  const go = (href) => { onClose?.(); navigate(href); };

  if (block && block.kind !== "offline") return <Blocked block={block} onGo={onClose} />;
  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p className="inv-ok" role="status"><Check size={16} weight="bold" />{arrival ? what.arrived : what.done}</p>
        <p className="inv-note" style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{arrival && what.arrivedText ? what.arrivedText : what.doneText}</p>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          {arrival ? <button type="button" className="v4-btn primary lg" data-autofocus="" onClick={() => go(arrival.href)}>{arrival.label}</button>
            : <span className="inv-truth" role="status"><Clock3 size={16} />{`${WORDS.pending}: esperando a la Colmena de ${what.from}…`}</span>}
          {inline ? null : <button type="button" className="v4-btn lg" onClick={onClose}>{"Cerrar"}</button>}
        </span>
      </div>
    );
  }
  if (preview) {
    const [kindLabel, KindIcon] = KIND[what.kind];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <PersonAvatar person={{ name: preview.name }} size={40} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="inv-kind" style={{ alignSelf: "flex-start" }}><KindIcon size={13} />{kindLabel}</span>
            <strong style={{ fontSize: "var(--t-body)", fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>{what.title}</strong>
          </span>
        </div>
        <p className="inv-note" style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{what.text}</p>
        {preview.already && what.kind === "person" ? <p className="inv-note" role="note">{`Ya habláis con ${what.from}: aceptar no cambia nada.`}</p> : null}
        <div className="inv-panel">
          <span className="inv-note">{`Pídele a ${what.from} que te diga sus cuatro palabras, de viva voz (en persona o por teléfono). Deben ser estas:`}</span>
          <span className="inv-words">{(preview.words || []).join(" · ")}</span>
          <span className="inv-note">{`Si coinciden, el código es de verdad de ${what.from} y nadie se ha puesto en medio. Si no coinciden, no sigas.`}</span>
        </div>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" className="v4-btn primary lg" data-autofocus="" disabled={!!busy} onClick={accept}>{busy === "join" ? "Un momento…" : what.confirm}</button>
          <button type="button" className="v4-btn ghost lg" onClick={() => { setPreview(null); setError(null); setText(""); looked.current = null; }}>{"No coinciden o no le conozco"}</button>
        </span>
        {error ? <p role="alert" className="inv-err">{error}</p> : null}
      </div>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); look(); }} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {block ? <Blocked block={block} /> : null}
      <label className="inv-field">
        {"Código"}
        <input type="text" value={text} maxLength={800} spellCheck={false} autoComplete="off" data-autofocus="" placeholder="COLMENA-XXXX-XXXX-XXXX-XXXX" aria-label="Código de invitación"
          onChange={(e) => { setText(e.target.value); setError(null); }} style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", letterSpacing: "0.03em" }} aria-describedby="join-hint" />
        <small id="join-hint">{"Vale el de un equipo, el de una sala o el de una persona. Puedes pegar el mensaje entero: Colmena encuentra el código. Antes de entrar verás de quién es y para qué."}</small>
      </label>
      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button type="submit" className="v4-btn primary lg" disabled={!text.trim() || !!busy}>{busy === "look" ? "Buscando el código…" : "Continuar"}</button>
        {code ? <span className="inv-note">{code}</span> : null}
      </span>
      {error ? <p role="alert" className="inv-err">{error}</p> : null}
    </form>
  );
}

export default function JoinSheet({ onClose }) {
  return (
    <InvSheet id="join-t" title={WORDS.join} sub="Pega el código que te han mandado. Colmena te dirá qué es antes de entrar." width={520} onClose={onClose}>
      <JoinFlow onClose={onClose} />
    </InvSheet>
  );
}
