import { bump, freshness, leave } from "../../lib/motion.js";
import { useRef } from "react";
import { CalendarClock, Check, CircleAlert, FileText } from "lucide-react";
import { useAction, useStore } from "../../lib/store.jsx";
import { post } from "../../lib/api.js";
import { navigate } from "../../lib/router.jsx";
import { botById } from "../../lib/bots.js";
import { ago, needsYou, roomUrl, time } from "../../lib/format.js";
import { useMarkRead } from "../notifications/Notifications.jsx";
import ApprovalConflict, { ExpiredActions } from "../room/ApprovalConflict.jsx";
import { Avatar, AvatarStack, joinNames } from "./shared.jsx";
import Recap from "./Recap.jsx";

// Sections of «Inicio», in the order of what matters (Slack / Claude home):
// what waits for you → ask → your work (running, just finished) → today.
// Empty sections say one quiet line or do not show at all.

export const H2 = { margin: "0", font: "700 22px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" };
export const KICKER = { font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" };
const LINK = { fontSize: "14px", fontWeight: "600", color: "#1F4FD1" };
const plural = (n, one, many) => (n === 1 ? one : many);

/** One sentence that says how things are, with links to the detail (replaces the three counters). */
export function StatusSentence({ pending, working, team }) {
  const busyBots = team.filter((b) => b.status === "trabaja");
  const parts = [];
  if (pending.length) parts.push(<a key="p" href="#te-espera" style={{ fontWeight: "700", color: "#12131A", textDecoration: "underline", textDecorationColor: "#FFC93C", textDecorationThickness: "3px", textUnderlineOffset: "4px" }}>{pending.length + " " + plural(pending.length, "cosa te espera", "cosas te esperan")}</a>);
  if (working.length) parts.push(<span key="w">{joinNames(busyBots.map((b) => b.name)) || "Tu equipo"}{" " + (busyBots.length === 1 ? "trabaja" : "trabajan") + " en "}<a href={working.length === 1 ? roomUrl(working[0]) : "/misiones"} style={{ fontWeight: "600" }}>{working.length === 1 ? "#" + (working[0].room || working[0].title) : working.length + " misiones"}</a></span>);
  if (!pending.length) parts.push(<span key="n">{"Nada te espera"}</span>);
  // Bots are only «libres» when nobody works and nothing waits (otherwise they wait for you).
  if (!working.length && !pending.length) parts.push(<span key="f">{team.length ? (team.length === 1 ? "tu bot está libre" : "tus " + team.length + " bots están libres") : "aún no hay bots en tu equipo"}</span>);
  return (
    <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.5", color: "#2B2D36" }}>
      {parts.map((p, i) => <span key={i}>{i ? " · " : ""}{p}</span>)}
      {"."}
    </p>
  );
}

/** «Te espera»: only when something does; first thing under the greeting. */
export function WaitingCard({ pending, bots, missions }) {
  if (!pending.length) return null;
  return (
    <section id="te-espera" aria-labelledby="te-espera-t" style={{ background: "#FFFFFF", border: "1px solid #E8D18A", borderLeft: "6px solid #FFC93C", borderRadius: "16px", padding: "14px 20px", display: "flex", flexDirection: "column", gap: "2px", scrollMarginTop: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingBottom: "6px" }}>
        <h2 id="te-espera-t" style={{ ...H2, fontSize: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          {"Te espera"}
          <span key={pending.length} className={bump("te-espera", pending.length)} style={{ minWidth: "26px", height: "26px", padding: "0 7px", borderRadius: "13px", background: "#FFC93C", font: "600 13px/26px 'Geist Mono', monospace", textAlign: "center" }}>{pending.length}</span>
        </h2>
        <a href="/bandeja" style={LINK}>{pending.length > 3 ? "Ver las " + pending.length + " en la Bandeja" : "Abrir la Bandeja"}</a>
      </div>
      {pending.slice(0, 3).map((a, i, list) => <ApprovalRow key={a.id} a={a} last={i === list.length - 1} bots={bots} missions={missions} />)}
    </section>
  );
}

/** «Prueba con»: starting ideas, only until you have a room. */
export function ContinueChips({ rooms, suggestions, onSuggest }) {
  // The sidebar already lists your rooms: only someone who has none gets starting ideas.
  if (rooms.length) return null;
  const recent = rooms.slice(0, 4);
  const chip = { display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "36px", padding: "6px 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", cursor: "pointer", fontSize: "14px", color: "#12131A", maxWidth: "100%" };
  if (recent.length >= 2) {
    return (
      <nav aria-label="Seguir con" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "14px", color: "#555A68", marginRight: "4px" }}>Seguir con</span>
        {recent.map((m) => (
          <a key={m.id} href={roomUrl(m)} style={chip} title={m.title}>
            <span aria-hidden="true" style={{ width: "8px", height: "8px", flex: "none", ...(needsYou(m) ? { borderRadius: "2px", background: "#C98A00" } : ["running", "planning"].includes(m.status) ? { borderRadius: "50%", background: "#0B8A5F" } : { borderRadius: "50%", border: "1.5px solid #A9AEBB" }) }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"#" + (m.room || m.title)}</span>
          </a>
        ))}
      </nav>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "14px", color: "#555A68", marginRight: "4px" }}>Prueba con</span>
      {suggestions.map((s) => (
        <button key={s} type="button" onClick={() => onSuggest(s)} style={{ ...chip, background: "transparent", border: "1px dashed #A9AEBB", textAlign: "left" }}>{s}</button>
      ))}
    </div>
  );
}

/** «Terminado hace poco»: results of the last days, «Nuevo» until you open them (replaces «Una novedad»). */
export function RecentDone({ missions, artifacts, bots }) {
  const { notifications = [] } = useStore();
  const { read } = useMarkRead();
  const since = Date.now() - 3 * 864e5;
  const done = missions
    .filter((m) => !m.conversation && m.status === "completed" && Date.parse(m.completedAt || m.updatedAt || 0) > since)
    .sort((a, b) => Date.parse(b.completedAt || b.updatedAt || 0) - Date.parse(a.completedAt || a.updatedAt || 0))
    .slice(0, 4);
  const isNew = freshness("recent-done", done.map((m) => m.id));
  if (!done.length) return null;
  const open = async (m) => {
    const unread = notifications.filter((n) => !n.read && n.missionId === m.id).map((n) => n.id);
    if (unread.length) await read(unread).catch(() => {});
    navigate(roomUrl(m));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={KICKER}>Terminado hace poco</span>
      <div style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", overflow: "hidden" }}>
        {done.map((m, i) => {
          const fresh = notifications.some((n) => !n.read && n.missionId === m.id && n.kind === "done");
          const files = artifacts.filter((a) => a.missionId === m.id);
          const team = (m.botIds || []).map((id) => botById(bots, id)).filter(Boolean);
          return (
            <button key={m.id} type="button" onClick={() => open(m)} className="rm-focus"
              style={{ width: "100%", display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: "14px", padding: "14px 18px", background: "transparent", border: "0", borderTop: i ? "1px solid #E6E8EE" : "0", cursor: "pointer", textAlign: "left", color: "#12131A" }}>
              <span aria-hidden="true" className={isNew(m.id) ? "c-pop" : undefined} style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#E1F4EC", color: "#0B6B4A" }}><Check size={17} strokeWidth={2.6} className={isNew(m.id) ? "c-draw" : undefined} /></span>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <strong style={{ fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"#" + (m.room || m.title)}</strong>
                  {fresh ? <span style={{ flex: "none", padding: "2px 7px", borderRadius: "5px", background: "#FFC93C", font: "600 11px/1.4 'Geist Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase" }}>Nuevo</span> : null}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#4A4F5C", minWidth: 0 }}>
                  {files.length ? <FileText size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none" }} /> : null}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {files.length ? files.slice(0, 2).map((f) => f.title).join(" · ") + (files.length > 2 ? " y " + (files.length - 2) + " más" : "") : m.title}
                  </span>
                </span>
                <Recap m={m} lines={2} />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {team.length ? <AvatarStack bots={team.slice(0, 3)} size={24} /> : null}
                <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#555A68", whiteSpace: "nowrap" }}>{ago(m.completedAt || m.updatedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** «Hoy»: automations that ran or will run today; one quiet line when there are none. */
export function TodayCard({ today }) {
  return (
    <section aria-labelledby="hoy" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingBottom: today.length ? "6px" : "0" }}>
        <h2 id="hoy" style={{ ...H2, fontSize: "18px", display: "flex", alignItems: "center", gap: "8px" }}><CalendarClock size={18} strokeWidth={2.2} aria-hidden="true" />Hoy</h2>
        <a href="/automatizaciones" style={{ ...LINK, fontSize: "13px" }}>Automatizaciones</a>
      </div>
      {today.map((r) => <ScheduleRow key={r.key} r={r} />)}
      {today.length === 0 ? <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.45", color: "#555A68" }}>Nada programado. <a href="/automatizaciones" style={{ fontWeight: "600", color: "#1F4FD1" }}>Crea una automatización</a> para que algo pase solo.</p> : null}
    </section>
  );
}

function ApprovalRow({ a, last, bots, missions }) {
  const { act, busy, error, conflict } = useAction();
  const self = useRef(null);
  const bot = botById(bots, a.botId);
  const mission = missions.find((m) => m.id === a.missionId);
  const room = mission ? roomUrl(mission) : a.missionId ? `/sala/${a.missionId}` : "/bandeja";
  const decide = (decision) => act(() => leave(self.current, () => post(`/approvals/${a.id}`, { decision, revision: a.revision })));
  const primary = { height: "38px", padding: "0 14px", background: "#FFC93C", border: "0", borderRadius: "10px", cursor: "pointer", fontWeight: "600", fontSize: "14px", opacity: busy ? "0.6" : "1" };
  const secondary = { height: "38px", padding: "0 14px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px", color: "#12131A" };
  const dark = { display: "flex", alignItems: "center", height: "38px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", borderRadius: "10px", fontWeight: "600", fontSize: "14px" };
  const name = bot?.name || "Un bot";
  const sentence = a.summary || a.title || "";
  const rest = sentence.startsWith(name) ? sentence.slice(name.length) : " · " + sentence;
  let actions;
  if (a.status === "expired") actions = null;
  else if (a.kind === "question") actions = <a href={room} style={dark}>Responder</a>;
  else if (a.kind === "send") actions = (
    <>
      <button type="button" disabled={busy} onClick={() => decide("approved")} style={primary}>Aprobar y enviar</button>
      <a href={`/bandeja/${a.id}/editar?ver=confirmar`} style={{ ...secondary, display: "flex", alignItems: "center" }}>Revisar</a>
    </>
  );
  else if (a.kind === "plan") actions = <a href={room} style={dark}>Ver el plan</a>;
  else if (a.kind === "skill") actions = <a href={`/equipo/${a.botId}?skill=${encodeURIComponent(a.skillId || a.targetId || a.id)}`} style={dark}>Revisar</a>;
  else actions = (
    <>
      <button type="button" disabled={busy} onClick={() => decide("approved")} style={primary}>Permitir</button>
      <button type="button" disabled={busy} onClick={() => decide("denied")} style={secondary}>Denegar</button>
    </>
  );
  return (
    <div ref={self} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: last ? "12px 0 2px" : "12px 0", borderTop: "1px solid #E6E8EE" }}>
      <Avatar bot={bot} size={28} />
      <p style={{ margin: "0", flex: "1 1 280px", fontSize: "14px", lineHeight: "1.45" }}>
        <strong>{name}</strong>
        {rest}
        {mission ? <span style={{ color: "#555A68" }}>{" · #" + (mission.room || mission.title)}</span> : null}
      </p>
      {a.status === "expired" ? (
        <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>Caducó: pasaron más de 30 minutos sin decidirlo.</span>
          <ExpiredActions a={a} name={name} dark={{ ...dark, border: "0", cursor: "pointer" }} light={secondary} />
        </span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{actions}</div>
      )}
      <ApprovalConflict error={error} conflict={conflict} />
    </div>
  );
}

function inLabel(at) {
  const min = Math.max(1, Math.round((Date.parse(at) - Date.now()) / 60000));
  return min < 60 ? `En ${min} min` : `En ${Math.round(min / 60)} h`;
}

function ScheduleRow({ r }) {
  const failed = r.done && /fall|error|fail/i.test(r.a.lastStatus || "");
  const running = !r.done && r.a.state === "running";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", alignItems: "center", gap: "10px", minHeight: "44px", borderTop: "1px solid #E6E8EE" }}>
      <span style={{ font: "500 13px/1 'Geist Mono', monospace", color: "#555A68" }}>{time(r.at)}</span>
      <span style={{ fontSize: "14px", lineHeight: "1.35" }}>
        {r.a.name}
        {r.bot ? <span style={{ color: "#555A68" }}>{" · " + r.bot.name}</span> : null}
      </span>
      {r.done ? (
        failed ? (
          <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "#B4372A", fontWeight: "600" }}><CircleAlert size={14} strokeWidth={2.4} aria-hidden="true" />Falló</span>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}><Check size={14} strokeWidth={2.6} aria-hidden="true" />Hecho</span>
        )
      ) : (
        <span style={{ fontSize: "13px", color: "#555A68" }}>{running ? "En marcha" : inLabel(r.at)}</span>
      )}
    </div>
  );
}
