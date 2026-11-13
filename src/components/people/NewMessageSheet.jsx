import { useMemo, useState } from "react";
import { post } from "../../lib/api.js";
import { useResource, useStore } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { currentTeam } from "../../lib/teams.js";
import { WORDS, inviteBlock, reachLine, reachable } from "../../lib/invite.js";
import { PersonAvatar } from "../room/Author.jsx";
import { Search, UserPlus } from "../Icon.js";
import { Blocked, InvSheet, useRoving } from "./parts.jsx";

// «Nuevo mensaje» (docs/SCREENS.md › «Invitar»), from the «+» of Personas and «Nuevo › Mensaje
// directo»: search the people you can reach and pick one; their direct conversation opens at
// once. Someone you already talk to has it (`dm`); a teammate needs no code
// (POST /api/teams/:id/members/:address/dm); anyone else is a contact (POST /api/peers/dm/:id).
// Whoever you cannot reach yet: «Invitar a alguien que aún no está», in the same place.

export default function NewMessageSheet({ onClose, onInvite }) {
  const store = useStore();
  const { peers = null, teams = [] } = store;
  const current = currentTeam(teams);
  const team = useResource(current ? `/teams/${encodeURIComponent(current.id)}` : null);
  const block = inviteBlock(peers, { talk: true });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const teamList = useMemo(() => (team.data?.members ? [{ id: team.data.id, name: team.data.name, members: team.data.members }] : []), [team.data]);
  const people = useMemo(() => reachable({ teams: teamList, contacts: peers?.contacts || [], query }), [teamList, peers, query]);
  const any = useMemo(() => reachable({ teams: teamList, contacts: peers?.contacts || [] }).length, [teamList, peers]);

  const open = async (p) => {
    if (busy) return;
    setError(null);
    if (p.dm) { onClose(); navigate(`/con/${encodeURIComponent(p.dm)}`); return; }
    setBusy(p.address);
    try {
      const out = p.source === "equipo" && p.teamId
        ? await store.run(() => post(`/teams/${encodeURIComponent(p.teamId)}/members/${encodeURIComponent(p.address)}/dm`))
        : await store.run(() => post(`/peers/dm/${encodeURIComponent(p.address)}`));
      const id = out?.share?.id || out?.id;
      onClose();
      if (id) navigate(`/con/${encodeURIComponent(id)}`);
    } catch (e) { setError(e.message); setBusy(null); }
  };
  const items = people.map((p) => ({ ...p, key: p.address }));
  const roving = useRoving(items, open);
  const loading = !!current && !team.data && !team.error;

  return (
    <InvSheet id="nm-t" title={WORDS.newMessage} sub="Un mensaje directo: solo lo leéis los dos, cifrado." width={520} onClose={onClose}
      foot={<><span className="grow inv-note">{"¿Te han mandado un código?"}</span><button type="button" className="v4-btn ghost" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("colmena:join")); }}>{WORDS.join}</button></>}>
      {block && !block.people ? <Blocked block={block} onGo={onClose} /> : (
        <>
          <label className="inv-search">
            <span style={{ flex: "none", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-3)" }}>{"Para:"}</span>
            <span className="inv-sr">{"Buscar a una persona de tu equipo o con quien ya hablas"}</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre de una persona" data-autofocus=""
              onKeyDown={(e) => { if (e.key === "ArrowDown" && items.length) { e.preventDefault(); roving.focusFirst(); } else if (e.key === "Enter" && items.length === 1) { e.preventDefault(); open(items[0]); } }} />
            <Search size={16} style={{ flex: "none", color: "var(--c-text-3)" }} />
          </label>
          {loading ? <span className="colmena-skeleton" style={{ height: "44px", borderRadius: "var(--r-sm)" }} aria-busy="true" /> : items.length ? (
            <ul role="listbox" aria-label="Personas a las que puedes escribir" className="inv-list" style={{ maxHeight: "320px" }} {...roving.listProps}>
              {items.map((p, i) => (
                <li key={p.address} role="option" aria-selected={false} className="inv-opt" {...roving.itemProps(i)} aria-busy={busy === p.address || undefined}>
                  <PersonAvatar person={p} size={32} ring="var(--c-raised)" presence={p.presence} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="nm">{p.name}</span>
                    <span className="ln">{busy === p.address ? "Abriendo la conversación…" : reachLine(p)}</span>
                  </span>
                  {p.dm || p.source !== "equipo" ? null : <span className="inv-kind" title="Sois del mismo equipo: no hace falta código">{"Primer mensaje"}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="inv-block">
              <b>{query ? `Nadie llamado «${query}» entre tus personas.` : any ? "" : "Aún no hay nadie a quien escribir."}</b>
              <span>{"Puedes escribir sin código a tu equipo y a quien ya habla contigo. A cualquier otra persona se la invita con un código: lo copias y se lo mandas tú."}</span>
            </div>
          )}
          <button type="button" className="v4-btn lg" style={{ alignSelf: "flex-start" }} onClick={() => onInvite?.(query.trim())}><UserPlus size={16} />{WORDS.newcomer}</button>
          {error ? <p role="alert" className="inv-err">{error}</p> : null}
        </>
      )}
    </InvSheet>
  );
}
