import { useEffect, useRef, useState } from "react";
import { Clock3, MessageSquare, UserPlus } from "lucide-react";
import { del, get, patch, post, put } from "../../../lib/api.js";
import { useResource, useStore } from "../../../lib/store.jsx";
import { navigate } from "../../../lib/router.jsx";
import { later, promise, useHidden } from "../../../lib/undoToast.js";
import { scrollBehavior } from "../../../lib/motion.js";
import { BotMark } from "../../v2/chat/Mark.jsx";
import { PeerAvatar } from "../../v2/people/PeerAvatar.jsx";
import { More, Seg, outline } from "./parts.jsx";
import TeamSheets from "./TeamSheets.jsx";
import {
  avatarOf, canInvite, canMakeAdmin, canMessage, canRemove, canRename, canStepDown, canUnmakeAdmin, countLine, currentTeam, leaveText, pendingLine,
  presenceWords, realTeams, removeText, roleLabel, sortMembers, untilText, waitingFor, waitingLine, waitingRest,
} from "../../../lib/teams.js";

// Equipo › the team (docs/PLAN-equipo-y-salas.md › 4.1): the team the sidebar shows, as every
// member sees it. GET /api/teams/:id → its people with their role, whether they are there,
// their status and their bots (read-only: a bot works on its owner's computer). Admins invite
// (POST …/invite), take people out (DELETE …/members/:address), name admins (PUT|DELETE
// …/admins/:address) and rename (PATCH). Anyone opens a direct conversation (POST
// …/members/:address/dm → {contact, share}) and leaves (POST …/leave; the creator closes it
// for everyone). What an admin asks waits for the creator's Colmena: `waiting` says so.
// Alone, one invitation to create a team or join one. Teams you asked to join and are not in
// yet come from the state (`teamsPending`).
const INK = "#12131A", TEXT = "#3D404A", MUTED = "#5C606C";
const LINE = "1px solid rgba(18,19,26,.06)";
const panel = { display: "flex", flexDirection: "column", borderRadius: "22px", background: "#FFFFFF" };
const h2 = { margin: 0, font: "600 var(--t-heading)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", overflowWrap: "anywhere" };
const h3 = { margin: 0, fontSize: "var(--t-meta)", fontWeight: 600, color: MUTED };
const dark = { height: "36px", padding: "0 16px", display: "inline-flex", alignItems: "center", gap: "6px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "var(--t-ui)", fontWeight: 600, cursor: "pointer" };
const danger = { ...dark, background: "#B4231A" };
const tag = { flex: "none", height: "20px", padding: "0 8px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "#F1F1EC", color: TEXT, fontSize: "var(--t-caption)", fontWeight: 600 };
const pendingText = { display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "var(--t-meta)", lineHeight: 1.4, color: TEXT };
const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", minHeight: "64px", padding: "12px 18px" };

/** A read-only bot: its shape, its name and its role. */
function BotChip({ bot }) {
  return (
    <li style={{ display: "inline-flex", alignItems: "center", gap: "7px", minHeight: "28px", padding: "2px 10px 2px 8px", borderRadius: "999px", background: "#F6F6F3", fontSize: "var(--t-meta)", lineHeight: 1.2 }}>
      <BotMark bot={bot} size={14} />
      <span style={{ fontWeight: 600 }}>{bot.name}</span>
      {bot.role ? <span style={{ color: MUTED }}>{bot.role}</span> : null}
    </li>
  );
}

/** «Pendiente»: a neutral line with a clock. Never honey: it does not wait for you. */
function Pending({ text }) {
  return <span style={pendingText}><Clock3 size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} /><span>{text}</span></span>;
}

/** An inline confirmation: what will happen, the action and «Cancelar». */
function Confirm({ title, text, action, busy, onYes, onNo }) {
  const box = useRef(null);
  useEffect(() => { box.current?.querySelector("button")?.focus(); }, []);
  return (
    <div ref={box} role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "16px", background: "#F6F6F3" }}>
      <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{title}</strong>
      <span style={{ maxWidth: "70ch", fontSize: "var(--t-ui)", lineHeight: 1.5, color: TEXT }}>{text}</span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button type="button" onClick={onNo} disabled={busy} style={outline}>{"Cancelar"}</button>
        <button type="button" onClick={onYes} disabled={busy} style={danger}>{busy ? "Un momento…" : action}</button>
      </span>
    </div>
  );
}

export default function TeamSection() {
  const { teams = [], teamsPending = [], peers = null, notifications = [], run } = useStore();
  const mine = realTeams(teams);
  const current = currentTeam(teams);
  const path = current ? `/teams/${encodeURIComponent(current.id)}` : null;
  const detail = useResource(path);
  const team = current && detail.data?.id === current.id && detail.data.state === "active" ? detail.data : null;
  const hiddenInvite = useHidden("invite");
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(null); // what is on its way: "leave", "rename", "<op>:<address>"
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // "leave" | a member's address
  const [renaming, setRenaming] = useState(null); // the name being typed
  const section = useRef(null);
  const peopleOff = !peers?.me || peers?.relay?.status === "off";

  // Who is there changes without anything being written: look again every minute while visible.
  const { setData } = detail;
  useEffect(() => {
    if (!path) return undefined;
    const tick = setInterval(() => { if (document.visibilityState === "visible") get(path).then(setData).catch(() => {}); }, 60000);
    return () => clearInterval(tick);
  }, [path, setData]);
  // «Ajustes del equipo» and the team's notices open /equipo#equipo.
  useEffect(() => {
    const go = () => { if (location.hash === "#equipo") section.current?.scrollIntoView({ block: "start", behavior: scrollBehavior() }); };
    go();
    window.addEventListener("colmena:navigate", go);
    return () => window.removeEventListener("colmena:navigate", go);
  }, []);
  useEffect(() => { setConfirm(null); setRenaming(null); setError(null); }, [current?.id]);

  /** Runs a change; the answer is the team as it is now (with `waiting` when the creator must sign). */
  const change = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const next = await run(fn);
      if (next?.members) setData(next);
      setConfirm(null);
      return next;
    } catch (e) {
      setError(e.message);
      return null;
    } finally { setBusy(null); }
  };
  const base = current ? `/teams/${encodeURIComponent(current.id)}` : "";
  const member = (m) => `${base}/members/${encodeURIComponent(m.address)}`;
  const admin = (m) => `${base}/admins/${encodeURIComponent(m.address)}`;
  const message = async (m) => {
    if (m.dm) return navigate(`/con/${encodeURIComponent(m.dm)}`);
    const out = await change("dm:" + m.address, () => post(`${member(m)}/dm`));
    if (out?.share?.id) navigate(`/con/${encodeURIComponent(out.share.id)}`);
  };
  const rename = async (e) => {
    e.preventDefault();
    const name = String(renaming || "").trim();
    if (!name) return setError("Ponle un nombre al equipo.");
    if (name === team.name) return setRenaming(null);
    if (await change("rename", () => patch(base, { name }))) setRenaming(null);
  };
  const leave = () => {
    const name = current.name;
    setBusy("leave");
    promise(run(() => post(`${base}/leave`)), { loading: team?.role === "creador" ? "Cerrando el equipo…" : "Saliendo del equipo…", success: team?.role === "creador" ? `«${name}» está cerrado` : `Has salido de «${name}»`, error: team?.role === "creador" ? "No se pudo cerrar el equipo" : "No se pudo salir del equipo" })
      .then(() => setConfirm(null), () => {}).finally(() => setBusy(null));
  };
  const cancelInvite = (inv) => later({ id: "invite:" + inv.id, keys: ["invite:" + inv.id], ms: 10000, text: "Invitación cancelada", error: "No se pudo cancelar", run: () => run(() => del(`/peers/invites/${encodeURIComponent(inv.id)}`)) });
  const discard = (p) => promise(run(() => post(`/teams/${encodeURIComponent(p.id)}/leave`)), { loading: "Un momento…", success: p.state === "refused" ? "Descartado" : `Ya no pides entrar en «${p.name}»`, error: "No se pudo descartar" }).catch(() => {});
  const switchTeam = (id) => promise(run(() => put("/teams/current", { id })), { loading: "Cambiando de equipo…", success: "Equipo cambiado", error: "No se pudo cambiar de equipo" }).catch(() => {});
  const seen = (n) => run(() => post("/notifications/read", { ids: [n.id] })).catch(() => {});

  const news = notifications.filter((n) => n.kind === "team" && !n.read);
  const members = team ? sortMembers(team.members) : [];
  const invitations = (team?.invitations || []).filter((i) => !hiddenInvite(i.id));
  const rest = team ? waitingRest(team.waiting, team.members) : [];
  const leaving = current ? leaveText(team || current, team?.role) : null;

  return (
    <section ref={section} id="equipo" aria-labelledby="team-t" style={{ display: "flex", flexDirection: "column", gap: "14px", scrollMarginTop: "24px" }}>
      {/* What happened to your teams while you were away (the notices that open this screen). */}
      {news.length ? (
        <ul aria-label="Novedades de tus equipos" style={{ ...panel, margin: 0, padding: 0, listStyle: "none" }}>
          {news.map((n, i) => (
            <li key={n.id} style={{ ...row, minHeight: "56px", borderTop: i ? LINE : 0 }}>
              <span style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{n.title}</span>
                {n.text ? <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.4, color: MUTED }}>{n.text}</span> : null}
              </span>
              <button type="button" onClick={() => seen(n)} style={outline}>{"Entendido"}</button>
            </li>
          ))}
        </ul>
      ) : null}

      {!current ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "12px" }}>
            <h2 id="team-t" tabIndex={-1} style={h2}>{"Solo tú"}</h2>
            <span style={{ fontSize: "var(--t-ui)", color: MUTED }}>{"Todavía no estás en ningún equipo."}</span>
          </div>
          <div style={{ ...panel, gap: "14px", padding: "22px" }}>
            <p style={{ margin: 0, maxWidth: "68ch", fontSize: "var(--t-body)", lineHeight: 1.55, color: TEXT }}>{"Con un equipo hablas con tus compañeros y con los bots de todos en las mismas salas. Cada bot sigue trabajando en el ordenador de su dueño, con su cuenta y sus datos: el equipo comparte la conversación, nada más."}</p>
            {peopleOff ? (
              <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: TEXT }}>{peers?.me ? "Para crear un equipo o entrar en uno, primero conecta Colmena al buzón. " : "Colmena está preparando las claves de este ordenador. En unos segundos podrás crear un equipo. "}{peers?.me ? <a href="/ajustes/personas" style={{ fontWeight: 600, color: "#1F4FD1" }}>{"Abrir Ajustes › Personas"}</a> : null}</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button type="button" onClick={() => setSheet({ kind: "create" })} style={{ ...dark, height: "44px", padding: "0 20px", fontSize: "var(--t-body)" }}>{"Crear un equipo"}</button>
                <button type="button" onClick={() => setSheet({ kind: "join" })} style={{ ...outline, height: "44px", padding: "0 18px", fontSize: "var(--t-body)" }}>{"Unirme con un código"}</button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px 16px" }}>
            {renaming != null ? (
              <form onSubmit={rename} style={{ flex: "1 1 320px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <h2 id="team-t" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{`Cambiar el nombre de ${current.name}`}</h2>
                <input className="c-quiet" autoFocus type="text" aria-label="Nombre del equipo" value={renaming} maxLength={60} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} style={{ flex: "1 1 220px", minWidth: 0, height: "40px", padding: "0 14px", border: "1px solid rgba(18,19,26,.2)", borderRadius: "12px", background: "#FFFFFF", fontSize: "var(--t-read)", fontWeight: 600, color: INK }} />
                <button type="submit" disabled={busy === "rename"} style={dark}>{busy === "rename" ? "Guardando…" : "Guardar"}</button>
                <button type="button" onClick={() => { setRenaming(null); setError(null); }} style={outline}>{"Cancelar"}</button>
              </form>
            ) : (
              <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 12px" }}>
                <h2 id="team-t" tabIndex={-1} style={h2}>{team?.name || current.name}</h2>
                <span style={{ fontSize: "var(--t-ui)", color: MUTED }}>{[countLine(team || current), team?.role === "creador" ? "Lo creaste tú" : team?.role === "admin" ? "Lo administras" : null].filter(Boolean).join(" · ")}</span>
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              {mine.length > 1 ? <Seg label="Cambiar de equipo" items={mine.map((t) => [t.id, t.name])} value={current.id} onPick={switchTeam} /> : null}
              {team && canInvite(team.role) ? <button type="button" onClick={() => setSheet({ kind: "invite", team: current })} disabled={peopleOff} style={dark}><UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />{"Invitar"}</button> : null}
              {team ? (
                <More label="Más acciones del equipo" items={[
                  canRename(team.role) ? { label: "Cambiar el nombre", run: () => { setError(null); setRenaming(team.name); } } : null,
                  !canInvite(team.role) ? { label: "Quién puede invitar", run: () => setSheet({ kind: "invite", team: current }) } : null,
                  { label: "Crear otro equipo", run: () => setSheet({ kind: "create" }), disabled: peopleOff },
                  { label: "Unirme con un código", run: () => setSheet({ kind: "join" }), disabled: peopleOff },
                  { label: leaving.action, danger: true, run: () => setConfirm("leave") },
                ]} />
              ) : null}
            </div>
          </div>

          {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.45, color: "#B4231A" }}>{error}</p> : null}
          {confirm === "leave" ? <Confirm title={leaving.title} text={leaving.text} action={leaving.confirm} busy={busy === "leave"} onYes={leave} onNo={() => setConfirm(null)} /> : null}
          {rest.length ? <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>{rest.map((w, i) => <Pending key={i} text={waitingLine(w, team.members)} />)}</div> : null}

          {!team ? (
            <div style={{ ...panel, padding: "18px", gap: "12px" }} aria-busy={detail.error ? undefined : "true"}>
              {detail.error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: TEXT }}>{`No se pudo leer el equipo. ${detail.error}`}</p>
                : [0, 1, 2].map((i) => <span key={i} className="colmena-skeleton" style={{ height: "40px", borderRadius: "12px" }} />)}
            </div>
          ) : (
            <ul aria-label={`Personas de ${team.name}`} style={{ ...panel, margin: 0, padding: 0, listStyle: "none" }}>
              {members.map((m, i) => {
                const words = presenceWords(m);
                const waits = waitingFor(team.waiting, m.address);
                const asking = confirm === m.address;
                const removing = removeText(team, m);
                const more = [
                  canMakeAdmin(team.role, m) ? { label: "Hacer administrador", run: () => change("admin:" + m.address, () => put(admin(m))) } : null,
                  canUnmakeAdmin(team.role, m) ? { label: "Quitar como administrador", run: () => change("admin:" + m.address, () => del(admin(m))) } : null,
                  canStepDown(team.role, m) ? { label: "Dejar de administrar", run: () => change("admin:" + m.address, () => del(admin(m))) } : null,
                  canRemove(team.role, m) ? { label: "Quitar del equipo", danger: true, run: () => { setError(null); setConfirm(m.address); } } : null,
                ].filter(Boolean);
                return (
                  <li key={m.address || "tu"} style={{ display: "flex", flexDirection: "column", borderTop: i ? LINE : 0 }}>
                    <div style={row}>
                      <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
                        <PeerAvatar person={avatarOf(m)} size={38} ring="#FFFFFF" dot />
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
                            <span style={{ fontSize: "var(--t-body)", fontWeight: 600, overflowWrap: "anywhere" }}>{m.name}</span>
                            {m.you ? <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>{"(tú)"}</span> : null}
                            <span style={m.role === "miembro" ? { ...tag, padding: 0, background: "transparent", fontWeight: 400, color: MUTED } : tag}>{roleLabel(m.role)}</span>
                          </span>
                          <span style={{ fontSize: "var(--t-meta)", color: words.online || words.mode !== "available" ? TEXT : MUTED }}>{words.text}</span>
                          {waits.map((w, k) => <Pending key={k} text={waitingLine(w, team.members)} />)}
                        </span>
                      </span>
                      {m.bots?.length ? (
                        <ul aria-label={m.you ? "Tus bots" : `Bots de ${m.name}`} style={{ flex: "2 1 280px", minWidth: 0, display: "flex", flexWrap: "wrap", gap: "6px", margin: 0, padding: 0, listStyle: "none" }}>
                          {m.bots.map((b) => <BotChip key={b.id} bot={b} />)}
                        </ul>
                      ) : <span style={{ flex: "2 1 280px", fontSize: "var(--t-meta)", color: MUTED }}>{"Sin bots a la vista"}</span>}
                      <span style={{ flex: "none", display: "flex", alignItems: "center", gap: "4px", minWidth: "36px", justifyContent: "flex-end" }}>
                        {canMessage(m) ? <button type="button" onClick={() => message(m)} disabled={busy === "dm:" + m.address} aria-label={`Mensaje directo a ${m.name}`} style={outline}><MessageSquare size={14} strokeWidth={2.2} aria-hidden="true" />{busy === "dm:" + m.address ? "Abriendo…" : "Mensaje"}</button> : null}
                        {more.length ? <More label={`Más acciones para ${m.name}`} items={more} /> : null}
                      </span>
                    </div>
                    {asking ? <div style={{ padding: "0 18px 16px" }}><Confirm title={removing.title} text={removing.text} action={removing.confirm} busy={busy === "remove:" + m.address} onYes={() => change("remove:" + m.address, () => del(member(m)))} onNo={() => setConfirm(null)} /></div> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {team && members.length === 1 ? (
            <div style={{ ...panel, padding: "18px", gap: "10px", alignItems: "flex-start" }}>
              <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{"De momento solo estás tú"}</strong>
              <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: TEXT }}>{"Invita a alguien: le das un código, lo pega en su Colmena y entra en el equipo y en la sala «general», con sus bots."}</span>
              {canInvite(team.role) ? <button type="button" onClick={() => setSheet({ kind: "invite", team: current })} disabled={peopleOff} style={dark}><UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />{"Crear un código de invitación"}</button> : null}
            </div>
          ) : null}

          {invitations.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h3 style={h3}>{"Invitaciones sin usar"}</h3>
              <ul style={{ ...panel, margin: 0, padding: 0, listStyle: "none" }}>
                {invitations.map((inv, i) => (
                  <li key={inv.id} style={{ ...row, minHeight: "52px", borderTop: i ? LINE : 0 }}>
                    <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "var(--t-body)", fontWeight: 600, overflowWrap: "anywhere" }}>{inv.name || "Alguien"}</span>
                      <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>{`Aún no la ha usado · vale ${untilText(inv.expiresAt)}`}</span>
                    </span>
                    <button type="button" onClick={() => cancelInvite(inv)} aria-label={`Cancelar la invitación de ${inv.name || "alguien"}`} style={outline}>{"Cancelar"}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {teamsPending.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h3 style={h3}>{"Equipos en los que has pedido entrar"}</h3>
          <ul style={{ ...panel, margin: 0, padding: 0, listStyle: "none" }}>
            {teamsPending.map((p, i) => {
              const line = pendingLine(p);
              return (
                <li key={p.id} style={{ ...row, minHeight: "56px", borderTop: i ? LINE : 0 }}>
                  <span style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "var(--t-body)", fontWeight: 600, overflowWrap: "anywhere" }}>{p.name}</span>
                      <span style={tag}>{line.refused ? "No has entrado" : "Pendiente"}</span>
                    </span>
                    <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.4, color: MUTED }}>{line.text}</span>
                  </span>
                  <button type="button" onClick={() => discard(p)} aria-label={`${line.action}: ${p.name}`} style={outline}>{line.action}</button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <TeamSheets sheet={sheet} onClose={() => setSheet(null)} onSheet={setSheet} />
    </section>
  );
}
