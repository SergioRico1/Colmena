import { useState } from "react";
import { del, get, patch, post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { lacksOwnName } from "../../lib/ownName.js";
import { later, useHidden } from "../../lib/undoToast.js";
import { CODE_RULES, ROOM_ROLES, WORDS, WORDS_WHY, contextOf, inviteBlock, pendingCodeLine, pendingCodes, roleHint } from "../../lib/invite.js";
import { Blocked, CopyButtons, useCopy } from "./parts.jsx";
import { Check, Ticket } from "../Icon.js";

// «Invitar a alguien que aún no está» (lib/invite.js): a one-use code scoped to what the sheet is
// about (a room, a team, or just to talk), shown big with «Copiar mensaje» (the server's
// `inviteText`: who you are, what Colmena is, where to get it and where to paste the code) and
// «Copiar código», how long it lasts, and why the four words are compared by voice. Under it,
// this context's codes nobody used yet, with «Copiar de nuevo» and «Revocar».
//   room  POST /api/rooms/:id/people {invite: {name, role}}   team  POST /api/teams/:id/invite {name?}
//   none  POST /api/peers/invites {name}                      again GET /api/peers/invites/:id
//   revoke DELETE /api/peers/invites/:id
// Colmena never sends the code: you copy it and send it yourself.

/** The role chooser of a room, each choice explained in one line. */
export function RoomRoles({ role, onRole }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span className="inv-h3" id="inv-role-l">{"Entra como"}</span>
      <div role="radiogroup" aria-labelledby="inv-role-l" className="inv-roles" onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault();
        const next = ROOM_ROLES[(ROOM_ROLES.findIndex((r) => r.id === role) + 1) % ROOM_ROLES.length].id;
        onRole(next);
        requestAnimationFrame(() => e.currentTarget?.querySelector(`[data-role="${next}"]`)?.focus());
      }}>
        {ROOM_ROLES.map((r) => <button key={r.id} type="button" role="radio" data-role={r.id} aria-checked={role === r.id} tabIndex={role === r.id ? 0 : -1} onClick={() => onRole(r.id)}>{r.label}</button>)}
      </div>
      <span className="inv-note">{roleHint(role)}</span>
    </div>
  );
}

/** This context's open codes: who each is for, until when, «Copiar de nuevo» and «Revocar». */
export function PendingCodes({ context, title = "Códigos sin usar", onError, boxStyle = null }) {
  const { peers } = useStore();
  const hidden = useHidden("invite");
  const [copied, copy] = useCopy(onError);
  const [busy, setBusy] = useState(null);
  const list = pendingCodes(peers?.invites || [], context).filter((i) => !hidden(i.id));
  if (!list.length) return null;
  const again = async (inv) => {
    setBusy(inv.id);
    try { const full = await get(`/peers/invites/${encodeURIComponent(inv.id)}`); await copy(inv.id, full.text); } catch (e) { onError?.(e.message); } finally { setBusy(null); }
  };
  const revoke = (inv) => later({ id: "invite:" + inv.id, keys: ["invite:" + inv.id], ms: 8000, text: `Código revocado${inv.name && inv.name !== "Alguien" ? " · " + inv.name : ""}: ya no sirve`, error: "No se pudo revocar", run: () => del(`/peers/invites/${encodeURIComponent(inv.id)}`) });
  return (
    <section aria-label={title} style={{ display: "flex", flexDirection: "column", gap: "4px", ...boxStyle }}>
      <h3 className="inv-h3">{`${title} · ${list.length}`}</h3>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {list.map((inv) => (
          <li key={inv.id} className="inv-row">
            <Ticket size={16} style={{ flex: "none", color: "var(--c-text-3)" }} />
            <span className="main"><b>{WORDS.pending}</b><span>{pendingCodeLine(inv)}</span></span>
            <button type="button" className="v4-btn ghost" disabled={busy === inv.id} onClick={() => again(inv)} aria-label={`${WORDS.copyAgain}: el mensaje con el código para ${inv.name || "alguien"}`}>{copied === inv.id ? "Copiado" : WORDS.copyAgain}</button>
            <button type="button" className="v4-btn" onClick={() => revoke(inv)} aria-label={`${WORDS.revoke} el código para ${inv.name || "alguien"}`}>{WORDS.revoke}</button>
          </li>
        ))}
      </ul>
      <span role="status" className="inv-sr">{copied ? "Mensaje copiado" : ""}</span>
    </section>
  );
}

/**
 * The code path. `context` (lib/invite.js › contextOf), `role`/`onRole` (a room you made),
 * `initialName`, `onMade(made)` after a code is made. `asks`: a room you did not make: only its
 * owner gives codes (the server answers 403), so it says whom to ask.
 */
export default function CodePanel({ context, role = "member", onRole = null, initialName = "", onMade = null, asks = null }) {
  const store = useStore();
  const c = contextOf(context);
  const block = inviteBlock(store.peers);
  const [nameless] = useState(() => lacksOwnName(store));
  const [mine, setMine] = useState("");
  const [name, setName] = useState(initialName);
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, copy] = useCopy(setError);
  const optional = c.kind === "team";
  const ready = (optional || !!name.trim()) && (!nameless || mine.trim().length >= 2) && !busy;
  if (asks) return <p className="inv-note" role="note">{`Para alguien que aún no está en Colmena, el código lo crea ${asks}: la sala es suya. Pídeselo por mensaje directo; tú puedes proponer aquí a quien ya está entre tus personas.`}</p>;
  if (block && !block.codes) return <Blocked block={block} />;

  const make = async (e) => {
    e?.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (nameless) await store.run(() => patch("/settings", { userName: mine.trim() }));
      const who = name.trim();
      const out = await store.run(() => (c.kind === "room" ? post(`/rooms/${encodeURIComponent(c.room.id)}/people`, { invite: { name: who, role } }).then((r) => r.invite)
        : c.kind === "team" ? post(`/teams/${encodeURIComponent(c.team.id)}/invite`, who ? { name: who } : {})
          : post("/peers/invites", { name: who })));
      setMade(out);
      onMade?.(out);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (made) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="inv-panel">
          <p className="inv-ok"><Check size={16} weight="bold" />{made.name && made.name !== "Alguien" ? `Código para ${made.name}` : "Código listo"}</p>
          <output className="inv-code" aria-label={`Código: ${made.code}`}>{made.code}</output>
          <CopyButtons made={made} copied={copied} copy={copy} />
          <span className="inv-note">{CODE_RULES + ". Colmena no lo envía: lo mandas tú, por donde quieras."}</span>
          <details>
            <summary className="inv-note" style={{ cursor: "pointer" }}>{"Ver el mensaje que se copia"}</summary>
            <p className="inv-msg" style={{ marginTop: "8px" }}>{made.text}</p>
          </details>
        </div>
        <p className="inv-truth">{WORDS_WHY}</p>
        <button type="button" className="v4-btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setMade(null); setName(""); setError(null); }}>{"Crear otro código"}</button>
        {error ? <p role="alert" className="inv-err">{error}</p> : null}
      </div>
    );
  }
  return (
    <form onSubmit={make} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {block?.kind === "offline" ? <Blocked block={block} /> : null}
      {nameless ? (
        <label className="inv-field">
          {"Tu nombre"}
          <input type="text" value={mine} maxLength={80} autoComplete="name" onChange={(e) => setMine(e.target.value)} placeholder="Como quieres que te vean" aria-label="Tu nombre" aria-describedby="inv-mine-hint" />
          <small id="inv-mine-hint">{"El mensaje empieza por «Hola, soy…». Se guarda como tu nombre; lo cambias en Ajustes."}</small>
        </label>
      ) : null}
      <label className="inv-field">
        {optional ? "¿Para quién es? (opcional)" : "¿Para quién es?"}
        <input type="text" value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder="Su nombre, para reconocer el código" data-autofocus="" aria-label={optional ? "¿Para quién es? (opcional)" : "¿Para quién es?"} aria-describedby="inv-name-hint" />
        <small id="inv-name-hint">{optional ? "Solo para que reconozcas el código en la lista. El mensaje lo saluda por su nombre." : "El mensaje lo saluda por su nombre y así reconoces el código en la lista."}</small>
      </label>
      {c.kind === "room" && onRole ? <RoomRoles role={role} onRole={onRole} /> : null}
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <button type="submit" className="v4-btn primary lg" disabled={!ready}>{busy ? "Creando…" : WORDS.createCode}</button>
        <span className="inv-note">{CODE_RULES}</span>
      </span>
      {error ? <p role="alert" className="inv-err">{error}</p> : null}
    </form>
  );
}
