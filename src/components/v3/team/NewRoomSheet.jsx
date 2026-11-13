import { useState } from "react";
import { Check } from "../../Icon.js";
import { post } from "../../../lib/api.js";
import { useResource, useStore } from "../../../lib/store.jsx";
import { navigate } from "../../../lib/router.jsx";
import { BotMark, PersonMark } from "../../v2/chat/Mark.jsx";
import { ROOM_MAX_BOTS, currentTeam, realTeams, roomHint, roomPayload, roomPeople } from "../../../lib/teams.js";
import { Sheet, darkBtn, errorLine, hidden, note, quietBtn } from "./TeamSheets.jsx";
import { coordinatorOf } from "../../../lib/bots.js";

// «Nuevo → Sala» (docs/CONTRACT.md §18): a name, where it lives (one of your teams or
// «Privada»), people and bots → POST /api/rooms {title, team?, botIds?, people?} → the room,
// opened at /sala/<id>. People are the teammates of the chosen team (GET /api/teams/:id), or
// the people you already talk to for a private room. Without a team or people it is the room
// of your bots it always was.
const label = { fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)" };
const group = { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, margin: 0, padding: 0, border: 0 };
const chip = (on, off = false) => ({ display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "4px 12px 4px 8px", border: 0, borderRadius: "var(--r-pill)", background: on ? "var(--c-btn)" : "var(--c-sunken)", color: on ? "var(--c-btn-text)" : "var(--c-text)", fontSize: "var(--t-ui)", textAlign: "left", cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1 });

export default function NewRoomSheet({ onClose, preset = [] }) {
  const { bots = [], teams = [], peers = null, run } = useStore();
  const mine = realTeams(teams);
  const [title, setTitle] = useState("");
  const [team, setTeam] = useState(() => currentTeam(teams)?.id || null); // null: «Privada»
  const [people, setPeople] = useState([]);
  // Not empty by default: the coordinator is in, as it is in every room with bots.
  const [botIds, setBotIds] = useState(() => (preset.length ? preset : bots.some((b) => b.id === "atlas" && b.enabled !== false) ? ["atlas"] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const detail = useResource(team ? `/teams/${encodeURIComponent(team)}` : null);
  const view = team && detail.data?.id === team ? detail.data : null;
  const candidates = roomPeople({ team: team ? view : null, contacts: team ? [] : peers?.contacts || [] });
  const myBots = bots.filter((b) => b.enabled !== false);
  const coord = coordinatorOf(bots);
  // The room's limit is six bots besides the one that coordinates (server/room.mjs ROOM_LIMITS.bots).
  const others = botIds.filter((id) => id !== "atlas").length;
  const missing = !title.trim() ? "Falta el nombre de la sala." : null;
  const teamName = mine.find((t) => t.id === team)?.name || null;
  const pickTeam = (id) => { setTeam(id); setPeople([]); setError(null); };
  const toggle = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const ok = !!title.trim() && !busy;
  const create = async () => {
    if (!title.trim()) { setError("Ponle un nombre a la sala."); return; }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const room = await run(() => post("/rooms", roomPayload({ title, team, botIds, people })));
      onClose();
      navigate(`/sala/${encodeURIComponent(room.id)}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Sheet id="room-new-t" title="Nueva sala" width={600} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <label style={group}>
          <span style={label}>{"Nombre"}</span>
          <input className="c-quiet" autoFocus data-autofocus="" type="text" value={title} maxLength={60} onChange={(e) => { setTitle(e.target.value); setError(null); }} placeholder="lanzamiento-web" style={{ height: "48px", padding: "0 16px", border: 0, borderRadius: "var(--r-lg)", background: "var(--c-sunken)", fontSize: "var(--t-read)", color: "var(--c-text)" }} />
        </label>

        {mine.length ? (
          <fieldset style={group}>
            <legend style={{ ...label, padding: 0, marginBottom: "8px" }}>{"Dónde"}</legend>
            <div role="radiogroup" aria-label="Dónde vive la sala" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {[...mine.map((t) => [t.id, t.name]), [null, "Privada"]].map(([id, name]) => {
                const on = id === team;
                return <button key={id || "privada"} type="button" role="radio" aria-checked={on ? "true" : "false"} onClick={() => pickTeam(id)} style={{ ...chip(on), padding: "4px 14px", fontWeight: on ? 600 : 500 }}>{name}</button>;
              })}
            </div>
          </fieldset>
        ) : null}

        <fieldset style={group}>
          <legend style={{ ...label, padding: 0, marginBottom: "8px" }}>{team ? "Personas del equipo" : "Personas"}<span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{" · opcional"}</span></legend>
          {team && !view ? <span style={note}>{detail.error ? "No se pudo leer el equipo. Puedes crear la sala e invitar desde ella." : "Leyendo el equipo…"}</span> : null}
          {candidates.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", maxHeight: "168px", overflowY: "auto" }}>
              {candidates.map((p) => {
                const on = people.includes(p.address);
                return (
                  <button key={p.address} type="button" aria-pressed={on ? "true" : "false"} onClick={() => toggle(people, setPeople, p.address)} style={chip(on)}>
                    <PersonMark name={p.name} size={26} tint={on ? "#FFFFFF" : "#E6E7EC"} />
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                    {on ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : (!team || view) ? <span style={note}>{team ? "Aún no hay nadie más en este equipo. Podrás invitar desde la sala." : "Aún no hablas con nadie desde Colmena. Podrás invitar desde la sala."}</span> : null}
        </fieldset>

        <fieldset style={group}>
          <legend style={{ ...label, padding: 0, marginBottom: "8px" }}>{"Tus bots"}<span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{` · ${coord} coordina; hasta ${ROOM_MAX_BOTS} más`}</span></legend>
          {myBots.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", maxHeight: "168px", overflowY: "auto" }}>
              {myBots.map((b) => {
                const on = botIds.includes(b.id);
                const full = !on && b.id !== "atlas" && others >= ROOM_MAX_BOTS;
                return (
                  <button key={b.id} type="button" aria-pressed={on ? "true" : "false"} disabled={full} onClick={() => toggle(botIds, setBotIds, b.id)} style={chip(on, full)}>
                    <span aria-hidden="true" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center" }}><BotMark bot={b} size={18} /></span>
                    <span style={{ display: "flex", flexDirection: "column", gap: "1px", lineHeight: 1.2 }}>
                      <span style={{ fontWeight: 600 }}>{b.name}</span>
                      {b.role ? <span style={{ fontSize: "var(--t-caption)", color: on ? "#D6D8DE" : "var(--c-text-3)" }}>{b.role}</span> : null}
                    </span>
                    {on ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : <span style={note}>{"Aún no tienes bots. Puedes crear la sala y añadirlos después."}</span>}
        </fieldset>

        <p style={note}>{roomHint({ teamName, people: people.length, bots: botIds.length })}</p>
        {error ? <p role="alert" style={errorLine}>{error}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <button type="submit" disabled={busy} aria-disabled={!ok} aria-describedby={missing ? "room-new-missing" : undefined} style={darkBtn(ok)}>{busy ? "Creando…" : "Crear sala"}</button>
          <button type="button" onClick={onClose} style={quietBtn}>{"Cancelar"}</button>
          {missing && !error ? <span id="room-new-missing" style={note}>{missing}</span> : null}
          <span role="status" style={hidden}>{busy ? "Creando la sala" : ""}</span>
        </div>
      </form>
    </Sheet>
  );
}
