import { useEffect, useMemo, useState } from "react";
import { get, post } from "../../lib/api.js";
import { useResource, useStore } from "../../lib/store.jsx";
import { firstName } from "../../lib/identity.js";
import { adminNames, listNames } from "../../lib/teams.js";
import { WORDS, addLabel, askedLine, contextOf, doneLine, inviteBlock, reachLine, roomOwner, roomPicker, roomRoom, sheetTitle, truthLine } from "../../lib/invite.js";
import { PersonAvatar } from "../room/Author.jsx";
import { Check, Clock3, Eye, Search, X } from "../Icon.js";
import CodePanel, { PendingCodes, RoomRoles } from "./CodePanel.jsx";
import { Blocked, InvSheet, useRoving } from "./parts.jsx";

// The one «Invitar» sheet (docs/SCREENS.md › «Invitar»), opened with what it is about:
//   {kind: "room", room}  a room view (GET /api/rooms/:id): «Personas» (search the people you can
//                         reach, pick several, choose «Miembro» or «Invitado», add them at once;
//                         in a room you did not make it asks its owner) and «Invitar a alguien que
//                         aún no está» (a code for that room);
//   {kind: "team", team}  {id, name, admin}: a code for the team (entering a team is always the
//                         newcomer's choice, so even people you talk to get a code);
//   nothing               a code to talk to someone who is not in Colmena with you yet.
// Each says the truth first: who will see what, from when. The room's own pending codes and
// «please add» requests are listed where they belong (here and in the member panel).

/** A picked person as a chip: its name and «Quitar». */
function Chip({ person, onRemove }) {
  return (
    <button type="button" className="inv-chip" onClick={onRemove} aria-label={`Quitar a ${person.name} de la selección`}>
      <PersonAvatar person={person} size={20} />
      <span>{firstName(person.name)}</span>
      <X size={12} weight="bold" style={{ flex: "none", color: "var(--c-text-3)" }} />
    </button>
  );
}

/** «Personas» of a room: search, pick, role, add (or ask its owner). */
function RoomPeople({ view, onChanged, onNewcomer }) {
  const { peers } = useStore();
  const team = useResource(view.teamId ? `/teams/${encodeURIComponent(view.teamId)}` : null);
  const owner = roomOwner(view);
  const asks = !!owner;
  const block = inviteBlock(peers);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState([]);
  const [error, setError] = useState(null);
  const teams = useMemo(() => (team.data?.members ? [{ id: team.data.id, name: team.data.name, members: team.data.members }] : []), [team.data]);
  const all = useMemo(() => roomPicker({ view, teams, contacts: peers?.contacts || [] }), [view, teams, peers]);
  const found = useMemo(() => roomPicker({ view, teams, contacts: peers?.contacts || [], query }), [view, teams, peers, query]);
  const space = roomRoom(view, picked.length);
  const isPicked = (p) => picked.some((x) => x.address === p.address);
  const toggle = (p) => {
    if (p.inRoom) return;
    setDone([]);
    if (isPicked(p)) setPicked((list) => list.filter((x) => x.address !== p.address));
    else if (space.left > 0) setPicked((list) => [...list, p]);
  };
  // Someone you already asked the owner for waits for them: said, never asked twice.
  const asked = new Set((view.asked || []).map((a) => a.person?.address));
  const items = found.map((p) => ({ ...p, key: p.address, asked: asked.has(p.address), disabled: !!p.inRoom || asked.has(p.address) || (!isPicked(p) && space.left <= 0) }));
  const roving = useRoving(items, toggle);

  const add = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    setError(null);
    const out = [];
    try {
      for (const p of picked) {
        const res = await post(`/rooms/${encodeURIComponent(view.id)}/people`, asks ? { address: p.address } : { address: p.address, role });
        out.push({ name: p.name, asked: !!res?.asked });
      }
      setPicked([]);
      setQuery("");
    } catch (e) { setError(e.message); } finally {
      setDone(out);
      setBusy(false);
      if (out.length) onChanged?.();
    }
  };

  if (block && !block.people) return <Blocked block={block} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p className="inv-truth"><Eye size={16} />{asks ? `${owner.name ? firstName(owner.name) : "Quien creó la sala"} decide: la sala es suya y solo quien la creó añade personas. ${truthLine({ kind: "room", room: view }, Math.max(1, picked.length))}` : truthLine({ kind: "room", room: view }, Math.max(1, picked.length))}</p>
      {space.full ? <p className="inv-note" role="note">{space.text}</p> : null}
      {/* Not a <label>: the chips inside are buttons, and a label names its first control. */}
      <div className="inv-search">
        <Search size={16} style={{ flex: "none", color: "var(--c-text-3)" }} />
        {picked.map((p) => <Chip key={p.address} person={p} onRemove={() => toggle(p)} />)}
        <input inputMode="search" enterKeyHint="search" autoComplete="off" type="search" aria-label="Buscar entre las personas que puedes invitar" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={picked.length ? "Añadir a alguien más" : "Buscar por nombre"} data-autofocus=""
          onKeyDown={(e) => { if (e.key === "ArrowDown" && items.length) { e.preventDefault(); roving.focusFirst(); } else if (e.key === "Backspace" && !query && picked.length) setPicked((l) => l.slice(0, -1)); }} />
      </div>
      {items.length ? (
        <ul role="listbox" aria-multiselectable="true" aria-label="Personas que puedes invitar" className="inv-list" {...roving.listProps}>
          {items.map((p, i) => (
            <li key={p.address} role="option" aria-selected={isPicked(p)} aria-disabled={p.disabled || undefined} className="inv-opt" {...roving.itemProps(i)}>
              {p.inRoom ? <Check size={16} style={{ flex: "none", width: "18px", color: "var(--c-text-3)" }} /> : p.asked ? <Clock3 size={16} style={{ flex: "none", width: "18px", color: "var(--c-text-3)" }} /> : <span className="inv-box" aria-hidden="true">{isPicked(p) ? <Check size={12} weight="bold" /> : null}</span>}
              <PersonAvatar person={p} size={28} ring="var(--c-raised)" presence={p.presence} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="nm">{p.name}</span>
                <span className="ln">{p.inRoom ? "Ya está en la sala" : p.asked ? `${WORDS.pending}: se lo has pedido a ${firstName(owner?.name)}` : reachLine(p)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="inv-block">
          <b>{query ? "Nadie con ese nombre entre tus personas." : all.length ? "" : view.teamId ? "Todo tu equipo y las personas con las que hablas están ya en la sala." : "Todas las personas con las que hablas están ya en la sala, o aún no hablas con nadie."}</b>
          <span>{"A alguien que aún no está en Colmena contigo se le invita con un código."}</span>
          {asks ? null : <button type="button" className="inv-link" style={{ alignSelf: "flex-start" }} onClick={() => onNewcomer(query)}>{WORDS.newcomer}</button>}
        </div>
      )}
      {!asks && picked.length ? <RoomRoles role={role} onRole={setRole} /> : null}
      {view.asked?.length && !done.length ? <p className="inv-truth"><Clock3 size={16} />{askedLine(view.asked, owner?.name)}</p> : null}
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <button type="button" className="v4-btn primary lg" disabled={!picked.length || busy} onClick={add}>{busy ? (asks ? "Pidiéndolo…" : "Añadiendo…") : addLabel(picked, { owner: asks ? owner.name : null })}</button>
        {block?.kind === "offline" ? <span className="inv-note">{"Sin conexión con el buzón: saldrá en cuanto vuelva."}</span> : null}
      </span>
      <p role="status" className={done.length ? "inv-ok" : "inv-sr"} style={done.length ? { fontWeight: 500 } : undefined}>{done.length ? <><Check size={16} weight="bold" />{doneLine(done, { room: view.title, owner: owner?.name })}</> : ""}</p>
      {error ? <p role="alert" className="inv-err">{error}</p> : null}
    </div>
  );
}

/** A team: only its admins invite; anyone else is told who can. */
function TeamCode({ team, initialName }) {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (team.admin) return undefined;
    let alive = true;
    get(`/teams/${encodeURIComponent(team.id)}`).then((t) => { if (alive) setAdmins(adminNames(t.members)); }).catch(() => { if (alive) setAdmins([]); });
    return () => { alive = false; };
  }, [team.id, team.admin]);
  if (!team.admin) {
    return (
      <div className="inv-block" role="note">
        <b>{"Solo invitan quienes administran el equipo."}</b>
        <span>{admins == null ? "Buscando quién lo administra…" : admins.length ? `Pídeselo a ${listNames(admins)}: crearán un código para esa persona.` : "Pídeselo a quien lo creó."}</span>
        <a href="/equipo#equipo" className="v4-btn" style={{ alignSelf: "flex-start", marginTop: "4px" }}>{"Ver el equipo"}</a>
      </div>
    );
  }
  return (
    <>
      <p className="inv-truth"><Eye size={16} />{truthLine({ kind: "team", team }, 1) + " Entrar en un equipo lo decide quien entra: también a quien ya habla contigo se le manda un código."}</p>
      <CodePanel context={{ kind: "team", team }} initialName={initialName} />
      <PendingCodes context={{ kind: "team", team }} onError={setError} />
      {error ? <p role="alert" className="inv-err">{error}</p> : null}
    </>
  );
}

/**
 * The sheet. `context`: {kind: "room", room} | {kind: "team", team} | null. `start`: "code" opens
 * a room on its code tab. `initialName` fills «¿Para quién es?». `onChanged` after people were added.
 * `lead`: a line under the title (a team just created).
 */
export default function InviteSheet({ context = null, onClose, onChanged = null, start = null, initialName = "", lead = null }) {
  const store = useStore();
  // The context follows the screen (a room view refreshed after adding someone); #general may switch it to its team.
  const [override, setCtx] = useState(null);
  const ctx = override || contextOf(context);
  const [tab, setTab] = useState(start === "code" ? "code" : "people");
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState("member");
  const [error, setError] = useState(null);
  const block = inviteBlock(store.peers);
  const room = ctx.kind === "room" ? ctx.room : null;
  const owner = room ? roomOwner(room) : null;
  const guest = room ? (room.people || []).find((p) => p.you)?.role === "guest" : false;
  const teamRow = room?.teamId ? (store.teams || []).find((t) => t.id === room.teamId) : null;

  let body;
  if (room?.general) {
    body = (
      <div className="inv-block" role="note">
        <b>{"En #general está todo el equipo."}</b>
        <span>{"Quien entra en el equipo entra aquí, y nadie entra en #general por separado."}</span>
        {teamRow ? <button type="button" className="v4-btn primary" style={{ alignSelf: "flex-start", marginTop: "4px" }} onClick={() => setCtx({ kind: "team", team: { id: teamRow.id, name: teamRow.name, admin: !!teamRow.admin } })}>{`Invitar a «${teamRow.name}»`}</button> : null}
      </div>
    );
  } else if (guest) {
    body = <div className="inv-block" role="note"><b>{"Como invitado no puedes invitar a nadie."}</b><span>{`Si quieres que entre alguien, díselo a ${owner?.name ? firstName(owner.name) : "quien creó la sala"}.`}</span></div>;
  } else if (room) {
    body = (
      <>
        <div className="inv-tabs" role="tablist" aria-label="Cómo invitar">
          <button type="button" role="tab" id="inv-tab-people" aria-selected={tab === "people"} aria-controls="inv-pane" tabIndex={tab === "people" ? 0 : -1} onClick={() => setTab("people")} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { setTab("code"); e.currentTarget.nextSibling?.focus(); } }}>{"Personas"}</button>
          <button type="button" role="tab" id="inv-tab-code" aria-selected={tab === "code"} aria-controls="inv-pane" tabIndex={tab === "code" ? 0 : -1} onClick={() => setTab("code")} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { setTab("people"); e.currentTarget.previousSibling?.focus(); } }}>{WORDS.newcomer}</button>
        </div>
        <div id="inv-pane" role="tabpanel" aria-labelledby={tab === "people" ? "inv-tab-people" : "inv-tab-code"} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {tab === "people" ? <RoomPeople view={room} onChanged={onChanged} onNewcomer={(q) => { setName(q); setTab("code"); }} /> : (
            <>
              {owner ? null : <p className="inv-truth"><Eye size={16} />{truthLine(ctx, 1) + " Al usar el código entra directamente en esta sala."}</p>}
              <CodePanel context={ctx} role={role} onRole={owner ? null : setRole} initialName={name} asks={owner ? firstName(owner.name) : null} onMade={() => onChanged?.()} />
              {owner ? null : <PendingCodes context={ctx} onError={setError} />}
            </>
          )}
        </div>
      </>
    );
  } else if (ctx.kind === "team") {
    body = block && !block.codes ? <Blocked block={block} onGo={onClose} /> : <TeamCode team={ctx.team} initialName={name} />;
  } else if (block && !block.codes && !block.people) {
    body = <Blocked block={block} onGo={onClose} />;
  } else {
    body = (
      <>
        <p className="inv-truth"><Eye size={16} />{truthLine(ctx, 1)}</p>
        <CodePanel context={ctx} initialName={name} />
        <PendingCodes context={ctx} onError={setError} />
        <p className="inv-note">{"¿Ya está en tu equipo o ya habláis? Escríbele sin código: "}<button type="button" className="inv-link" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("colmena:new-message")); }}>{WORDS.newMessage}</button>{"."}</p>
      </>
    );
  }
  return (
    <InvSheet id="inv-t" title={sheetTitle(ctx)} sub={lead || (room && !room.general && owner ? `Se lo pediremos a ${firstName(owner.name)}` : null)} onClose={onClose}
      foot={<><span className="grow inv-note">{"Si te han mandado un código a ti: "}</span><button type="button" className="v4-btn ghost" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("colmena:join")); }}>{WORDS.join}</button><button type="button" className="v4-btn" onClick={onClose}>{"Listo"}</button></>}>
      {body}
      {error ? <p role="alert" className="inv-err">{error}</p> : null}
      {room && !room.general ? <a href="/personas/como-funciona#quien-entra" onClick={onClose} className="inv-note" style={{ alignSelf: "flex-start", color: "var(--c-text-2)", textDecoration: "underline", textUnderlineOffset: "3px" }}>{"Cómo funciona"}</a> : null}
    </InvSheet>
  );
}
