// /empresa: your companies (open one, make one) and the one you are in: its people (the
// directory, with a direct message to each), their roles, invitations, and leaving it.
// Owners and admins manage; everyone sees who is in it.
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ChatCircleText, Check, CircleAlert, Copy, DoorOpen, LogOut, Plus, UserPlus, X } from "../components/Icon.js";
import { Shell } from "./Shell.jsx";
import { auth, me, unnamed } from "./api.js";
import { YourName } from "./YourName.jsx";
import { Roster } from "./Roster.jsx";
import { SEEDED_TEAM } from "../lib/hive.js";

const ROLE_LABEL = { owner: "Propietario", admin: "Administra", member: "Miembro", guest: "Invitado" };
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
const Problem = ({ text }) => (text ? <p className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{text}</p> : null);

export function Companies() {
  const [who, setWho] = useState(undefined);
  const [error, setError] = useState(null);
  const load = useCallback(() => me().then(setWho, (e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (who === null) location.replace("/entrar?next=/empresa"); }, [who]);
  const signOut = async () => { await auth.logout().catch(() => {}); location.assign("/entrar?salir=1"); };
  const right = who?.user ? (
    <div className="cl-me">
      <span className="cl-me-name">{who.user.name}</span>
      <button type="button" className="cl-iconbtn" onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></button>
    </div>
  ) : null;
  if (!who) return <Shell right={right}>{error ? <Problem text={error} /> : <div className="cl-skeleton" style={{ width: "40%", height: 28 }} />}</Shell>;
  const open = async (id) => {
    setError(null);
    try { await auth.select(id); location.assign("/"); } catch (e) { setError(e.message); }
  };
  const hasAny = who.workspaces.length > 0;
  return (
    <Shell wide={hasAny || !!who.current} right={right} asleep={!hasAny}>
      <h1 className="cl-title">{hasAny ? "Tus empresas" : "Crea tu empresa"}</h1>
      <p className="cl-lead">{hasAny ? "Elige dónde trabajar o crea otra. Cada empresa tiene sus propios canales, personas y bots." : "El chat de tu equipo y de sus bots. Ponle nombre y tus seis bots llegan con ella. ¿Te han invitado a una que ya existe? Abre el enlace de tu invitación."}</p>
      <Problem text={error} />
      <ForYou onError={setError} />
      {hasAny ? (
        <ul className="cl-list" aria-label="Tus empresas">
          {who.workspaces.map((w) => (
            <li key={w.id} className="cl-item">
              <span className="cl-avatar" aria-hidden="true">{initials(w.name)}</span>
              <span className="cl-item-main">
                <span className="cl-item-name">{w.name}</span>
                <span className="cl-item-meta">{ROLE_LABEL[w.role] || w.role}</span>
              </span>
              <span className="cl-item-actions">
                {who.current?.id === w.id ? <span className="cl-tag here">Ahora</span> : null}
                <button type="button" className="cl-btn small" onClick={() => open(w.id)}>Abrir<ArrowRight size={14} /></button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <CreateCompany first={!hasAny} user={who.user} onError={setError} />
      {who.current ? <Manage who={who} onChanged={load} /> : null}
    </Shell>
  );
}

/** «Invitaciones para ti»: open invitations to my address (imported ones too), joined with one press. */
function ForYou({ onError }) {
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(null);
  useEffect(() => { let live = true; auth.myInvitations().then((r) => { if (live) setList(r?.invitations || []); }, () => {}); return () => { live = false; }; }, []);
  if (!list.length) return null;
  const join = async (id) => {
    setBusy(id);
    onError(null);
    try { await auth.acceptInviteById(id); location.assign("/"); } catch (e) { setBusy(null); onError(e.message); }
  };
  return (
    <section aria-labelledby="for-you-head" style={{ marginBottom: 32 }}>
      <h2 className="cl-h2" id="for-you-head">Invitaciones para ti</h2>
      <p className="cl-sub">{list.length === 1 ? "Una empresa te espera." : `${list.length} empresas te esperan.`}</p>
      <ul className="cl-list" aria-label="Invitaciones para ti">
        {list.map((i) => (
          <li key={i.id} className="cl-item">
            <span className="cl-avatar" aria-hidden="true">{initials(i.workspace)}</span>
            <span className="cl-item-main">
              <span className="cl-item-name">{i.workspace}</span>
              <span className="cl-item-meta">{i.inviter} te invita · {ROLE_LABEL[i.role] || i.role}</span>
            </span>
            <span className="cl-item-actions">
              <button type="button" className="cl-btn small" onClick={() => join(i.id)} disabled={busy !== null}>{busy === i.id ? "Uniéndote…" : "Unirme"}{busy === i.id ? null : <ArrowRight size={14} />}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The team arriving: one seeded bot takes its cell per letter of the company's name (all six
 * once it has six), asleep until an AI account wakes them in /empezar.
 */
function Arriving({ count }) {
  const items = SEEDED_TEAM.map((b, i) => (i < count
    ? { kind: "bot", key: b.id, bot: b, asleep: true, name: b.name, line: b.role, fresh: true }
    : { kind: "empty", key: b.id }));
  return (
    <div className="cl-below" style={{ marginTop: 22 }}>
      <p className="cl-below-label" id="arriving-label">{count >= SEEDED_TEAM.length ? "Tu equipo ya está aquí, dormido. Lo despiertas en el paso siguiente." : "Tu equipo llega con el nombre."}</p>
      <Roster items={items} label="Los bots de tu empresa" />
    </div>
  );
}

function CreateCompany({ first, user, onError }) {
  const [openForm, setOpen] = useState(first);
  const askName = first && unnamed(user);
  const [person, setPerson] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async (e) => {
    e.preventDefault();
    if (askName && !person.trim()) { onError("Escribe tu nombre: así te ven tu equipo y tus bots."); return; }
    if (!name.trim()) { onError("Escribe el nombre de la empresa."); return; }
    setBusy(true);
    onError(null);
    try {
      if (askName && person.trim()) await auth.rename(person.trim());
      await auth.createWorkspace(name.trim());
      // The guided start: your AI, your bots, your team, a first request (Setup.jsx).
      location.assign("/empezar");
    } catch (err) { setBusy(false); onError(err.message); }
  };
  if (!openForm) return <button type="button" className="cl-btn ghost small" style={{ marginTop: 16, alignSelf: "flex-start" }} onClick={() => setOpen(true)}><Plus size={14} />Crear otra empresa</button>;
  return (
    <form className="cl-form" onSubmit={create} style={{ marginTop: first ? 0 : 24 }}>
      {askName ? <YourName value={person} onChange={setPerson} autoFocus /> : null}
      <label className="cl-field">
        <span className="cl-label">Nombre de la empresa</span>
        <input className="cl-input" autoFocus={first && !askName} maxLength={60} required placeholder="Por ejemplo, Estudio Norte" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="cl-row">
        <button className="cl-btn" type="submit" disabled={busy}>{busy ? "Creando…" : "Crear y entrar"}{busy ? null : <ArrowRight size={16} />}</button>
        {first ? null : <button type="button" className="cl-btn ghost" onClick={() => setOpen(false)}>Cancelar</button>}
      </div>
      {first ? <Arriving count={Math.min(SEEDED_TEAM.length, name.trim().length)} /> : null}
    </form>
  );
}

function Manage({ who, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const refresh = useCallback(() => auth.workspace().then(setData, (e) => setError(e.message)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!data) return error ? <Problem text={error} /> : null;
  const manager = ["owner", "admin"].includes(data.role);
  const active = data.members.filter((m) => !m.deactivated).length;
  const act = async (fn, after = refresh) => {
    setError(null);
    try { await fn(); await after(); } catch (e) { setError(e.message); }
  };
  const write = async (person) => {
    setError(null);
    try { const r = await auth.directMessage(person.id); location.assign(r.href); } catch (e) { setError(e.message); }
  };
  return (
    <section aria-labelledby="people-head" id="personas" style={{ display: "flex", flexDirection: "column", marginTop: 48, paddingTop: 8, borderTop: "1px solid var(--c-line)" }}>
      <h2 className="cl-h2" id="people-head" style={{ marginTop: 24 }}>Personas de {data.workspace?.name}</h2>
      <p className="cl-sub">{active === 1 ? "Solo estás tú. Invita a tu equipo." : `${active} personas`}</p>
      <Problem text={error} />
      {notice ? <p className="cl-ok" role="status"><Check size={16} />{notice}</p> : null}
      <ul className="cl-list" aria-label="Personas de la empresa">
        {data.members.map((m) => {
          const self = m.id === data.me.id;
          return (
            <li key={m.id} className={"cl-item" + (m.deactivated ? " off" : "")}>
              <span className="cl-avatar" aria-hidden="true">{initials(m.name)}</span>
              <span className="cl-item-main">
                <span className="cl-item-name">{m.name}{self ? " (tú)" : ""}</span>
                <span className="cl-item-meta">{m.email}</span>
              </span>
              <span className="cl-item-actions">
                {m.deactivated ? <span className="cl-tag off">Desactivada</span> : manager && !self ? (
                  <select className="cl-select small" aria-label={"Papel de " + m.name} value={m.role} onChange={(e) => act(() => auth.setRole(m.id, e.target.value))}>
                    {Object.entries(ROLE_LABEL).filter(([r]) => data.role === "owner" || !["owner", "admin"].includes(r) || r === m.role).map(([r, label]) => <option key={r} value={r}>{label}</option>)}
                  </select>
                ) : <span className="cl-tag">{ROLE_LABEL[m.role]}</span>}
                {self || m.deactivated ? null : <button type="button" className="cl-btn ghost small" onClick={() => write(m)}><ChatCircleText size={14} />Escribir</button>}
                {manager && !self ? <button type="button" className="cl-iconbtn" aria-label={"Sacar a " + m.name + " de la empresa"} title="Sacar de la empresa"
                  onClick={() => { if (confirm(`¿Sacar a ${m.name} de ${data.workspace?.name}? Se cerrarán sus sesiones.`)) act(() => auth.remove(m.id)); }}><X size={16} /></button> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {manager ? <Invite data={data} onInvited={refresh} onNotice={setNotice} /> : null}
      <div style={{ marginTop: 32 }}>
        <button type="button" className="cl-btn danger small" onClick={() => { if (confirm(`¿Salir de ${data.workspace?.name}? Necesitarás otra invitación para volver.`)) act(() => auth.leave(), async () => { await onChanged(); location.assign("/empresa"); }); }}>
          <DoorOpen size={14} />Salir de la empresa
        </button>
      </div>
    </section>
  );
}

function Invite({ data, onInvited, onNotice }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await auth.invite(email.trim(), role);
      setMade(r);
      setEmail("");
      setCopied(false);
      onNotice(r.delivery === "email" ? `Invitación enviada a ${r.invitation.email}.` : `Invitación creada para ${r.invitation.email}.`);
      await onInvited();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(made.link); setCopied(true); } catch { setCopied(false); } };
  return (
    <>
      <h2 className="cl-h2">Invitar</h2>
      <p className="cl-sub">Le llega un enlace por correo. Solo sirve para esa dirección y caduca en 7 días.</p>
      <form className="cl-form" onSubmit={send}>
        <div className="cl-row" style={{ alignItems: "flex-end" }}>
          <label className="cl-field">
            <span className="cl-label">Correo</span>
            <input className="cl-input" type="email" required autoComplete="off" inputMode="email" placeholder="nombre@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="cl-field" style={{ flex: "0 1 170px" }}>
            <span className="cl-label">Papel</span>
            <select className="cl-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Miembro</option>
              <option value="guest">Invitado</option>
              {data.role === "owner" ? <option value="admin">Administra</option> : null}
            </select>
          </label>
          <button className="cl-btn" type="submit" disabled={busy || !email.trim()}><UserPlus size={16} />{busy ? "Invitando…" : "Invitar"}</button>
        </div>
        <Problem text={error} />
      </form>
      {made ? (
        <div className="cl-panel">
          <p className="cl-note">{made.delivery === "email" ? "Si no le llega, pásale este enlace:" : "El correo aún no está configurado en este espacio: pásale este enlace tú mismo."}</p>
          <div className="cl-linkbox">
            <code aria-label="Enlace de invitación">{made.link}</code>
            <button type="button" className="cl-btn ghost small" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copiado" : "Copiar"}</button>
          </div>
        </div>
      ) : null}
      {data.invitations.length ? (
        <>
          <h3 className="cl-label" style={{ margin: "24px 0 8px" }}>Pendientes</h3>
          <ul className="cl-list" aria-label="Invitaciones pendientes">
            {data.invitations.map((i) => (
              <li key={i.id} className="cl-item">
                <span className="cl-item-main">
                  <span className="cl-item-name">{i.email}</span>
                  <span className="cl-item-meta">{ROLE_LABEL[i.role]} · caduca el {new Date(i.expiresAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}</span>
                </span>
                <span className="cl-item-actions">
                  <button type="button" className="cl-btn ghost small" onClick={async () => { try { await auth.revokeInvite(i.id); await onInvited(); } catch (e) { setError(e.message); } }}>Retirar</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
