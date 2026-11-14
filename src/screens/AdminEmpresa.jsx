// «Empresa»: the admin screen of a hosted company (routes /admin and /admin/:tab). Owners and
// admins manage the people (directory: src/chat/adminApi.js → /auth/workspace…), the channels and
// settings of team messaging (/api/chat/admin, server/cloud/chat.mjs), a Slack import
// (chat/SlackImport.jsx) and read the audit log. Everyone else is sent back to the channels.
import { useCallback, useEffect, useMemo, useState } from "react";
import { navigate } from "../lib/router.jsx";
import { chat } from "../chat/api.js";
import { directory } from "../chat/adminApi.js";
import { nameOf, useChat } from "../chat/store.js";
import { ChatPage, Dialog, Empty, Tabs, ROLE_LABEL, ago, dayLabel, sizeOf, timeOf, whenOf } from "../chat/ui.jsx";
import SlackImport from "../chat/SlackImport.jsx";
import Select from "../components/Select.jsx";
import { MenuButton } from "../components/Menu.js";
import { PersonAvatar } from "../components/room/Author.jsx";
import { Archive, ArchiveRestore, Copy, DotsThreeVertical, Download, Hash, Lock, Power, UserMinus, X } from "../components/Icon.js";
import "../chat/admin.css";

const TABS = [
  { id: "personas", label: "Personas" },
  { id: "canales", label: "Canales" },
  { id: "ajustes", label: "Ajustes" },
  { id: "importar", label: "Importar de Slack" },
  { id: "registro", label: "Registro" },
];
const MANAGERS = new Set(["owner", "admin"]);
const ONLY_OWNER = "Solo quien es propietario cambia a quien administra.";
const LAST_OWNER = "La empresa necesita al menos una persona propietaria.";
const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function AdminEmpresa({ params = {} }) {
  const s = useChat();
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab : "personas";
  const title = "Empresa";

  if (!s.ready) {
    return (
      <ChatPage title={title}>
        <div className="ch-section">{s.error ? <p className="ch-error" role="alert">{s.error}</p> : <p className="ad-loading" role="status">Cargando…</p>}</div>
      </ChatPage>
    );
  }
  if (!MANAGERS.has(s.me?.role)) {
    return (
      <ChatPage title={title}>
        <Empty title="Solo quien administra la empresa ve esta página" action={<a className="ch-btn" href="/canales">Volver a los canales</a>}>
          Si necesitas cambiar algo de la empresa, pídeselo a quien la administra.
        </Empty>
      </ChatPage>
    );
  }
  return (
    <ChatPage title={title} sub={s.workspace?.name || null} scroll={false}>
      <Tabs label="Secciones de la empresa" items={TABS} value={tab} onChange={(id) => navigate("/admin/" + id)} />
      <div className="ad-scroll" role="tabpanel" aria-label={TABS.find((t) => t.id === tab).label}>
        <div className="ch-section">
          {tab === "personas" ? <People /> : null}
          {tab === "canales" ? <Channels /> : null}
          {tab === "ajustes" ? <Settings /> : null}
          {tab === "importar" ? <SlackImport /> : null}
          {tab === "registro" ? <AuditLog /> : null}
        </div>
      </div>
    </ChatPage>
  );
}

/* ── Personas ─────────────────────────────────────────────────────────────────────────────── */

function People() {
  const s = useChat();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState(null); // { kind, member }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => directory.load().then((d) => { setData(d); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (!data) return error ? <p className="ch-error" role="alert">{error}</p> : <p className="ad-loading" role="status">Cargando…</p>;

  const mine = data.role;
  const myId = data.me?.id;
  const owners = data.members.filter((m) => m.role === "owner" && !m.deactivated).length;
  const q = filter.trim().toLowerCase();
  const members = [...data.members]
    .sort((a, b) => Number(!!a.deactivated) - Number(!!b.deactivated))
    .filter((m) => !q || (m.name || "").toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q));
  const active = data.members.filter((m) => !m.deactivated).length;

  /** Why this person cannot be changed by me, or null. */
  const lockOf = (m, { role = false } = {}) => {
    if (!role && m.id === myId) return "No puedes hacerlo contigo.";
    if (role && m.deactivated) return "Reactívala para cambiar su papel.";
    if (mine !== "owner" && MANAGERS.has(m.role)) return ONLY_OWNER;
    if (m.role === "owner" && !m.deactivated && owners <= 1) return LAST_OWNER;
    return null;
  };

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e.message); await load(); }
    finally { setBusy(false); }
  };
  const setRole = (m, role) => {
    setData((d) => ({ ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, role } : x)) }));
    run(() => directory.setRole(m.id, role));
  };
  const roleOptions = [
    { value: "owner", label: ROLE_LABEL.owner, disabled: mine !== "owner" ? ONLY_OWNER : false },
    { value: "admin", label: ROLE_LABEL.admin, disabled: mine !== "owner" ? ONLY_OWNER : false },
    { value: "member", label: ROLE_LABEL.member },
    { value: "guest", label: ROLE_LABEL.guest },
  ];

  const menu = (m) => () => {
    const lock = lockOf(m);
    return [{ group: null, items: [
      m.deactivated
        ? { label: "Reactivar", icon: Power, disabled: lock || false, onSelect: () => setConfirm({ kind: "reactivate", member: m }) }
        : { label: "Desactivar", icon: Power, disabled: lock || false, onSelect: () => setConfirm({ kind: "deactivate", member: m }) },
      { label: "Quitar de la empresa", icon: UserMinus, danger: true, disabled: lock || false, onSelect: () => setConfirm({ kind: "remove", member: m }) },
    ] }];
  };

  const who = confirm ? confirm.member.name || confirm.member.email : "";
  const dialogs = {
    deactivate: { title: `¿Desactivar a ${who}?`, text: "Se cerrarán todas sus sesiones. Sus mensajes se quedan. No podrá entrar hasta que la reactives.", action: "Desactivar", danger: true, go: (m) => directory.deactivate(m.id) },
    reactivate: { title: `¿Reactivar a ${who}?`, text: "Podrá volver a entrar en la empresa, con el papel que tenía.", action: "Reactivar", danger: false, go: (m) => directory.reactivate(m.id) },
    remove: { title: `¿Quitar a ${who} de la empresa?`, text: "Se cerrarán todas sus sesiones. Sus mensajes se quedan. Para que vuelva tendrás que invitarla otra vez.", action: "Quitar", danger: true, go: (m) => directory.remove(m.id) },
  };
  const d = confirm ? dialogs[confirm.kind] : null;

  return (
    <>
      <Invite mine={mine} onDone={load} />
      {error ? <p className="ch-error" role="alert">{error}</p> : null}

      <div className="ad-head-row">
        <div className="ad-grow">
          <h2 className="ch-section-title">Personas</h2>
          <p className="ch-hint ad-num">{active} {active === 1 ? "activa" : "activas"}{data.members.length > active ? ` · ${data.members.length - active} desactivadas` : ""}</p>
        </div>
        {data.members.length > 8 ? <input className="ch-input ad-filter" type="search" placeholder="Buscar por nombre o correo" aria-label="Buscar personas" value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
      </div>
      <div className="ad-table ad-people r-rtable" role="table" aria-label="Personas de la empresa">
        <div className="ad-row is-head" role="row">
          <span role="columnheader">Persona</span><span role="columnheader">Papel</span><span role="columnheader">Se unió</span><span role="columnheader">Estado</span><span role="columnheader"><span className="ad-sr">Acciones</span></span>
        </div>
        {members.map((m) => {
          const roleLock = lockOf(m, { role: true });
          return (
            <div key={m.id} className={"ad-row" + (m.deactivated ? " is-dim" : "")} role="row">
              <div className="ad-who" role="rowheader">
                <PersonAvatar person={{ name: m.name || m.email, color: s.people.get(m.id)?.color || null }} size={32} />
                <span className="ad-who-text">
                  <span className="ad-name">{m.name || m.email}{m.id === myId ? <span className="ad-muted" style={{ fontWeight: 400 }}> (tú)</span> : null}</span>
                  <span className="ad-sub">{m.email}</span>
                </span>
              </div>
              <div className="ad-cell ad-keep" role="cell" data-label="Papel">
                <Select label={`Papel de ${m.name || m.email}`} value={m.role} options={roleOptions} disabled={busy || !!roleLock} title={roleLock || undefined}
                  onChange={(e) => setRole(m, e.target.value)} />
              </div>
              <div className="ad-cell ad-num" role="cell" data-label="Se unió">{dateOf(m.joinedAt)}</div>
              <div className="ad-cell" role="cell" data-label="Estado">
                <span className={"ad-status" + (m.deactivated ? " is-off" : "")}>{m.deactivated ? "Desactivada" : "Activa"}</span>
              </div>
              <div className="ad-cell ad-end ad-keep" role="cell">
                {m.id === myId ? null : (
                  <MenuButton className="ch-iconbtn" label={`Acciones para ${m.name || m.email}`} items={menu(m)} disabled={busy}>
                    <DotsThreeVertical size={18} aria-hidden="true" />
                  </MenuButton>
                )}
              </div>
            </div>
          );
        })}
        {!members.length ? <p className="ad-loading">Nadie coincide con «{filter}».</p> : null}
      </div>

      <Invitations list={data.invitations || []} onDone={load} />
      <Domains workspace={data.workspace} onSaved={(workspace) => setData((x) => ({ ...x, workspace }))} />

      {d ? (
        <Dialog title={d.title} onClose={() => setConfirm(null)} footer={<>
          <button type="button" className="ch-btn" onClick={() => setConfirm(null)}>Cancelar</button>
          <button type="button" className={"ch-btn " + (d.danger ? "is-danger" : "is-primary")} disabled={busy}
            onClick={() => { const m = confirm.member; setConfirm(null); run(() => d.go(m)); }}>{d.action}</button>
        </>}>
          <p style={{ margin: 0 }}>{d.text}</p>
        </Dialog>
      ) : null}
    </>
  );
}

function Invite({ mine, onDone }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError(null); setCopied(false);
    try {
      const r = await directory.invite(email.trim(), role);
      setMade(r);
      setEmail("");
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(made.link); setCopied(true); }
    catch { setError("No se pudo copiar: selecciona el enlace y cópialo a mano."); }
  };
  const days = made?.invitation?.expiresAt ? Math.max(1, Math.round((made.invitation.expiresAt - Date.now()) / 86400000)) : null;

  return (
    <>
      <h2 className="ch-section-title">Invitar a alguien</h2>
      <form className="ad-inline" onSubmit={submit}>
        <label className="ch-field">Correo
          <input className="ch-input" type="email" required autoComplete="off" placeholder="nombre@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="ch-field ad-narrow"><span id="ad-invite-role">Papel</span>
          <Select aria-label="Papel de la invitación" value={role} onChange={(e) => setRole(e.target.value)} options={[
            { value: "member", label: ROLE_LABEL.member },
            { value: "guest", label: ROLE_LABEL.guest },
            { value: "admin", label: ROLE_LABEL.admin, disabled: mine !== "owner" ? "Solo quien es propietario invita a administrar." : false },
          ]} />
        </div>
        <button type="submit" className="ch-btn is-primary" disabled={busy || !email.trim()}>{busy ? "Invitando…" : "Invitar"}</button>
      </form>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {made ? (
        <div className="ad-result" role="status">
          <p>
            {made.delivery === "email"
              ? <>Hemos enviado la invitación a <strong>{made.invitation.email}</strong>. También puedes pasarle tú el enlace.</>
              : <>El correo no está configurado: no se ha enviado nada. Pásale tú el enlace a <strong>{made.invitation.email}</strong>.</>}
            {days ? ` Solo sirve para esa dirección y caduca en ${days} ${days === 1 ? "día" : "días"}.` : ""}
          </p>
          <div className="ad-copy">
            <input className="ch-input" readOnly value={made.link} aria-label="Enlace de la invitación" onFocus={(e) => e.target.select()} />
            <button type="button" className="ch-btn" onClick={copy}><Copy size={16} aria-hidden="true" />{copied ? "Copiado" : "Copiar enlace"}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Invitations({ list, onDone }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  if (!list.length) return null;
  const revoke = async (id) => {
    setBusy(id); setError(null);
    try { await directory.revoke(id); onDone(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  return (
    <>
      <div className="ad-head-row">
        <div className="ad-grow">
          <h2 className="ch-section-title">Invitaciones pendientes</h2>
          <p className="ch-hint ad-num">{list.length}</p>
        </div>
      </div>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      <ul className="ch-list">
        {list.map((i) => (
          <li key={i.id} className="ch-item">
            <div className="ch-item-main">
              <span className="ch-item-title"><span className="ch-ellipsis">{i.email}</span><span className="ch-chip">{ROLE_LABEL[i.role] || i.role}</span></span>
              <span className="ch-item-meta">
                {i.imported ? "De la importación de Slack" : `Invitó ${i.invitedBy || "alguien"}`} · {dateOf(i.createdAt)} · caduca el {dateOf(i.expiresAt)}
              </span>
            </div>
            <button type="button" className="ch-btn" disabled={busy === i.id} onClick={() => revoke(i.id)}>Revocar</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Domains({ workspace, onSaved }) {
  const domains = workspace?.domains || [];
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (next) => {
    setBusy(true); setError(null);
    try { const r = await directory.setDomains(next); onSaved(r.workspace); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  };
  const add = async (e) => {
    e.preventDefault();
    const added = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
    if (!added.length) return;
    if (await save([...new Set([...domains, ...added])])) setText("");
  };
  return (
    <>
      <h2 className="ch-section-title">Dominios permitidos</h2>
      <p className="ch-hint">Quien entre con un correo de estos dominios se une como miembro, sin invitación. No sirven los correos públicos (Gmail, Outlook…).</p>
      {domains.length ? (
        <div className="ad-chips">
          {domains.map((d) => (
            <span key={d} className="ch-chip">@{d}
              <button type="button" className="ad-chip-x" aria-label={`Quitar ${d}`} disabled={busy} onClick={() => save(domains.filter((x) => x !== d))}><X size={12} aria-hidden="true" /></button>
            </span>
          ))}
        </div>
      ) : <p className="ch-hint">Ninguno: solo entra quien recibe una invitación.</p>}
      <form className="ad-inline" onSubmit={add}>
        <label className="ch-field">Añadir un dominio
          <input className="ch-input" placeholder="empresa.com" value={text} onChange={(e) => { setText(e.target.value); setError(null); }} autoComplete="off" />
        </label>
        <button type="submit" className="ch-btn" disabled={busy || !text.trim()}>Añadir</button>
      </form>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
    </>
  );
}

/* ── Canales ──────────────────────────────────────────────────────────────────────────────── */

function Channels() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => chat.get("/admin").then((d) => { setData(d); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const patch = async (c, body) => {
    setBusy(c.id); setError(null);
    setData((d) => ({ ...d, channels: d.channels.map((x) => (x.id === c.id ? { ...x, ...body } : x)) }));
    try { await chat.patch("/channels/" + encodeURIComponent(c.id), body); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); load(); }
  };

  if (!data) return error ? <p className="ch-error" role="alert">{error}</p> : <p className="ad-loading" role="status">Cargando…</p>;
  const q = filter.trim().toLowerCase().replace(/^#/, "");
  const channels = data.channels.filter((c) => !q || (c.name || "").toLowerCase().includes(q) || (c.topic || "").toLowerCase().includes(q));
  const open = data.channels.filter((c) => !c.archived).length;

  return (
    <>
      <div className="ad-head-row">
        <div className="ad-grow">
          <h2 className="ch-section-title">Canales</h2>
          <p className="ch-hint ad-num">
            {open} abiertos{data.channels.length > open ? ` · ${data.channels.length - open} archivados` : ""}
            {data.counts ? ` · ${Number(data.counts.messages || 0).toLocaleString("es-ES")} mensajes, ${Number(data.counts.files || 0).toLocaleString("es-ES")} con archivos` : ""}
          </p>
        </div>
        {data.channels.length > 8 ? <input className="ch-input ad-filter" type="search" placeholder="Buscar canal" aria-label="Buscar canales" value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
      </div>
      <p className="ch-hint">Quien entra nuevo en la empresa se une a los canales <strong>por defecto</strong> (los invitados, no). Un canal archivado se puede leer pero ya no admite mensajes.</p>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {!data.channels.length ? <Empty title="Todavía no hay canales">Los canales que cree cualquiera de la empresa aparecerán aquí.</Empty> : (
        <div className="ad-table ad-channels r-rtable" role="table" aria-label="Canales de la empresa">
          <div className="ad-row is-head" role="row">
            <span role="columnheader">Canal</span><span role="columnheader">Tipo</span><span role="columnheader">Personas</span><span role="columnheader">Última actividad</span><span role="columnheader">Por defecto</span><span role="columnheader"><span className="ad-sr">Acciones</span></span>
          </div>
          {channels.map((c) => {
            const pub = c.kind === "public";
            const Icon = pub ? Hash : Lock;
            return (
              <div key={c.id} className={"ad-row" + (c.archived ? " is-dim" : "")} role="row">
                <div className="ad-who-text" role="rowheader">
                  <span className="ad-chan ad-name"><Icon size={14} aria-hidden="true" /><span className="ch-ellipsis">{c.name}</span>{c.archived ? <span className="ch-chip">Archivado</span> : null}</span>
                  {c.topic || c.imported ? <span className="ad-sub">{[c.imported ? "De Slack" : null, c.topic || null].filter(Boolean).join(" · ")}</span> : null}
                </div>
                <div className="ad-cell" role="cell" data-label="Tipo">{pub ? "Público" : "Privado"}</div>
                <div className="ad-cell ad-num" role="cell" data-label="Personas">{c.memberCount ?? "—"}</div>
                <div className="ad-cell" role="cell" data-label="Última actividad">{c.lastAt ? ago(c.lastAt) : "Sin mensajes"}</div>
                <div className="ad-cell ad-keep" role="cell" data-label="Por defecto">
                  {pub ? (
                    <button type="button" role="switch" className="ad-switch" aria-checked={!!c.isDefault} aria-label={`#${c.name} por defecto`}
                      disabled={busy === c.id || (c.archived && !c.isDefault)} title={c.archived ? "Desarchívalo para que sea por defecto." : undefined}
                      onClick={() => patch(c, { isDefault: !c.isDefault })} />
                  ) : <span className="ad-muted">—</span>}
                </div>
                <div className="ad-cell ad-end ad-keep" role="cell">
                  {c.archived
                    ? <button type="button" className="ch-btn" disabled={busy === c.id} onClick={() => patch(c, { archived: false })}><ArchiveRestore size={16} aria-hidden="true" />Desarchivar</button>
                    : <button type="button" className="ch-btn" disabled={busy === c.id} onClick={() => setConfirm(c)}><Archive size={16} aria-hidden="true" />Archivar</button>}
                </div>
              </div>
            );
          })}
          {!channels.length ? <p className="ad-loading">Ningún canal coincide con «{filter}».</p> : null}
        </div>
      )}
      {confirm ? (
        <Dialog title={`¿Archivar #${confirm.name}?`} onClose={() => setConfirm(null)} footer={<>
          <button type="button" className="ch-btn" onClick={() => setConfirm(null)}>Cancelar</button>
          <button type="button" className="ch-btn is-primary" onClick={() => { const c = confirm; setConfirm(null); patch(c, { archived: true, ...(c.isDefault ? { isDefault: false } : {}) }); }}>Archivar</button>
        </>}>
          <p style={{ margin: 0 }}>Nadie podrá escribir en él; sus mensajes se pueden seguir leyendo y buscando. Puedes desarchivarlo cuando quieras.{confirm.isDefault ? " Deja también de ser un canal por defecto." : ""}</p>
        </Dialog>
      ) : null}
    </>
  );
}

/* ── Ajustes ──────────────────────────────────────────────────────────────────────────────── */

const RETENTION = [["0", "Para siempre"], ["30", "30 días"], ["90", "90 días"], ["180", "180 días"], ["365", "365 días"], ["custom", "Otro número de días"]];
const DIGEST = [15, 30, 60, 120];

function Settings() {
  const s = useChat();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState("0");
  const [custom, setCustom] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(null); // "retention" | "digest" | "name"
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(null);

  const apply = (settings) => {
    const d = Number(settings.retentionDays) || 0;
    const preset = RETENTION.some(([v]) => v === String(d));
    setChoice(preset ? String(d) : "custom");
    setCustom(preset ? "" : String(d));
  };
  useEffect(() => {
    chat.get("/admin").then((d) => { setData(d); apply(d.settings || {}); }, (e) => setError(e.message));
    directory.load().then((d) => setName(d.workspace?.name || ""), () => setName(s.workspace?.name || ""));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return error ? <p className="ch-error" role="alert">{error}</p> : <p className="ad-loading" role="status">Cargando…</p>;
  const current = Number(data.settings?.retentionDays) || 0;
  const days = choice === "custom" ? Math.floor(Number(custom)) : Number(choice);
  const valid = choice !== "custom" || (Number.isFinite(days) && days >= 1 && days <= 3650);
  const changed = valid && days !== current;
  const destructive = days > 0 && (current === 0 || days < current);

  const save = async (patch, which) => {
    setBusy(true); setError(null); setSaved(null);
    try { const settings = await chat.patch("/admin/settings", patch); setData((d) => ({ ...d, settings })); apply(settings); setSaved(which); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveName = async (e) => {
    e.preventDefault();
    setBusy(true); setNameError(null); setSaved(null);
    try { const r = await directory.rename(name.trim()); setName(r.workspace?.name || name.trim()); setSaved("name"); }
    catch (err) { setNameError(err.message); }
    finally { setBusy(false); }
  };
  const digest = Number(data.settings?.digestMinutes) || 30;
  const digestOptions = [...new Set([...DIGEST, digest])].sort((a, b) => a - b).map((m) => [String(m), m < 60 ? `${m} minutos` : m === 60 ? "1 hora" : `${m / 60} horas`]);

  return (
    <>
      <h2 className="ch-section-title">Nombre de la empresa</h2>
      <form className="ad-inline" onSubmit={saveName}>
        <label className="ch-field">Nombre
          <input className="ch-input" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setSaved(null); }} />
        </label>
        <button type="submit" className="ch-btn" disabled={busy || !name.trim()}>Guardar</button>
      </form>
      {nameError ? <p className="ch-error" role="alert">{nameError}</p> : saved === "name" ? <p className="ad-saved" role="status">Nombre guardado.</p> : null}

      <h2 className="ch-section-title">Cuánto se guardan los mensajes</h2>
      <p className="ch-hint">Vale para todos los canales y conversaciones, también los importados.</p>
      <div className="ad-inline">
        <div className="ch-field ad-narrow"><span>Guardar</span>
          <Select aria-label="Cuánto se guardan los mensajes" value={choice} options={RETENTION} onChange={(e) => { setChoice(e.target.value); setSaved(null); }} />
        </div>
        {choice === "custom" ? (
          <label className="ch-field ad-tiny">Días
            <input className="ch-input ad-num" type="number" min={1} max={3650} inputMode="numeric" value={custom} onChange={(e) => { setCustom(e.target.value); setSaved(null); }} />
          </label>
        ) : null}
        <button type="button" className="ch-btn is-primary" disabled={busy || !changed} onClick={() => (destructive ? setConfirm(true) : save({ retentionDays: days }, "retention"))}>Guardar</button>
      </div>
      {choice === "custom" && custom && !valid ? <p className="ch-error" role="alert">Escribe un número de días entre 1 y 3650.</p> : null}
      {days > 0 && valid ? (
        <p className="ad-danger-note"><strong>Los mensajes y archivos de más de {days} días se borran para siempre</strong>, cada día, sin papelera: no se pueden recuperar. Si quieres conservar una copia, exporta antes.</p>
      ) : null}
      {saved === "retention" ? <p className="ad-saved" role="status">Guardado.</p> : null}

      <h2 className="ch-section-title">Resumen por correo</h2>
      <p className="ch-hint">Quien tenga menciones o mensajes directos sin leer recibe un correo con ellos pasado este tiempo. Cada persona puede apagarlo en su perfil.</p>
      <div className="ad-inline">
        <div className="ch-field ad-narrow"><span>Enviar pasados</span>
          <Select aria-label="Enviar el resumen pasados" value={String(digest)} options={digestOptions} disabled={busy}
            onChange={(e) => save({ digestMinutes: Number(e.target.value) }, "digest")} />
        </div>
      </div>
      {saved === "digest" ? <p className="ad-saved" role="status">Guardado.</p> : null}
      {error ? <p className="ch-error" role="alert">{error}</p> : null}

      <h2 className="ch-section-title">Exportar todo</h2>
      <p className="ch-hint">Un archivo ZIP con las personas, los canales con sus miembros, todos los mensajes en JSON y los archivos. Queda anotado en el registro quién lo descargó y cuándo.</p>
      <div className="ad-links">
        <a className="ch-btn" href="/api/chat/admin/export.zip" download><Download size={16} aria-hidden="true" />Exportar todo</a>
        <a className="ch-btn" href="/api/chat/admin/export.zip?files=0" download>Sin archivos</a>
      </div>

      {confirm ? (
        <Dialog title={`¿Borrar los mensajes de más de ${days} días?`} onClose={() => setConfirm(false)} footer={<>
          <button type="button" className="ch-btn" onClick={() => setConfirm(false)}>Cancelar</button>
          <button type="button" className="ch-btn is-danger" onClick={() => { setConfirm(false); save({ retentionDays: days }, "retention"); }}>Borrar y guardar</button>
        </>}>
          <p style={{ margin: "0 0 8px" }}>A partir de ahora, los mensajes y archivos de más de {days} días se borran para siempre en todos los canales y conversaciones. Los que ya tienen esa edad empiezan a borrarse hoy.</p>
          <p style={{ margin: 0, color: "var(--c-text-3)" }}>No hay forma de recuperarlos. Exporta antes si quieres una copia.</p>
        </Dialog>
      ) : null}
    </>
  );
}

/* ── Registro ─────────────────────────────────────────────────────────────────────────────── */

const ROLE_AS = { owner: "como propietario", admin: "para administrar", member: "como miembro", guest: "como invitado" };
const retentionText = (d) => (Number(d) ? `${d} días` : "para siempre");
const channelOf = (t) => (t?.name ? "#" + t.name : "un canal");
const personText = (t) => t?.name || t?.email || "alguien";

/** One entry as a sentence: [what they did, details or null]. */
function describe(e, s) {
  const t = e.target || {};
  const x = e.details || {};
  const count = (n, one, many) => `${Number(n || 0).toLocaleString("es-ES")} ${Number(n) === 1 ? one : many}`;
  switch (e.action) {
    case "invite": return [`invitó a ${t.email || "alguien"} ${ROLE_AS[x.role] || ""}`.trim(), null];
    case "invitation.revoke": return ["revocó una invitación", null];
    case "invitations.import": return ["creó invitaciones a partir de una importación", [count(x.created, "nueva", "nuevas"), x.existing ? count(x.existing, "ya estaba", "ya estaban") : null, x.skipped ? count(x.skipped, "omitida", "omitidas") : null].filter(Boolean).join(" · ")];
    case "role": return [`cambió el papel de ${personText(t)} a ${ROLE_LABEL[x.role] || x.role}`, null];
    case "remove": return [`quitó a ${personText(t)} de la empresa`, null];
    case "deactivate": return [`desactivó a ${personText(t)}`, null];
    case "reactivate": return [`reactivó a ${personText(t)}`, null];
    case "domains": return ["cambió los dominios permitidos", x.domains?.length ? x.domains.map((d) => "@" + d).join(", ") : "Ninguno"];
    case "rename": return [x.name ? `cambió el nombre de la empresa a «${x.name}»` : "cambió el nombre de la empresa", null];
    case "channel.archive": return [`archivó ${channelOf(t)}`, null];
    case "channel.unarchive": return [`desarchivó ${channelOf(t)}`, null];
    case "channel.rename": return [x.from ? `cambió el nombre de #${x.from} a ${channelOf(t)}` : `cambió el nombre de ${channelOf(t)}`, null];
    case "channel.default": return [x.on ? `puso ${channelOf(t)} por defecto` : `quitó ${channelOf(t)} de los canales por defecto`, null];
    case "channel.members": {
      const names = (ids) => (ids || []).map((id) => nameOf(id, s)).join(", ");
      if (x.added?.length) return [`añadió a ${count(x.added.length, "persona", "personas")} a ${channelOf(t)}`, names(x.added)];
      if (x.removed?.length) return [`quitó a ${names(x.removed)} de ${channelOf(t)}`, null];
      return [`cambió los miembros de ${channelOf(t)}`, null];
    }
    case "settings": {
      const b = x.before || {}, a = x.after || {};
      const out = [];
      if ((b.retentionDays || 0) !== (a.retentionDays || 0)) out.push(`mensajes: ${retentionText(b.retentionDays)} → ${retentionText(a.retentionDays)}`);
      if (b.digestMinutes !== a.digestMinutes) out.push(`resumen por correo: ${b.digestMinutes ?? 30} → ${a.digestMinutes} min`);
      if (JSON.stringify(b.defaultChannels || []) !== JSON.stringify(a.defaultChannels || [])) out.push("canales por defecto");
      return ["cambió los ajustes", out.join(" · ") || null];
    }
    case "export": return [x.files === false ? "exportó todo, sin archivos" : "exportó todo, con archivos", null];
    case "import.start": return ["empezó una importación de Slack", [x.name, x.size ? sizeOf(x.size) : null].filter(Boolean).join(" · ") || null];
    case "import.done": {
      const ch = x.channels || {};
      return ["terminó la importación de Slack", x.messages != null ? `${count(x.messages, "mensaje", "mensajes")} en ${count((ch.public || 0) + (ch.private || 0) + (ch.dm || 0) + (ch.group || 0), "conversación", "conversaciones")}` : null];
    }
    case "import.cancel": return ["canceló una importación de Slack", null];
    case "retention.purge": return [`borró ${count(x.removed, "mensaje", "mensajes")} por antigüedad`, x.before ? `anteriores al ${dateOf(Date.parse(x.before))}` : null];
    case "message.delete": {
      const where = t.channel ? s.channels.get(t.channel) : null;
      return [`borró un mensaje de ${x.author ? nameOf(x.author, s) : "otra persona"}${where?.name ? " en #" + where.name : ""}`, null];
    }
    default: return [e.action, null];
  }
}

function AuditLog() {
  const s = useChat();
  const [entries, setEntries] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const page = useCallback(async (before) => {
    setBusy(true); setError(null);
    try {
      const r = await chat.get("/admin/audit" + (before ? "?before=" + before : ""));
      setEntries((list) => [...(before ? list || [] : []), ...(r.entries || [])]);
      setNext(r.next || null);
    } catch (e) { setError(e.message); setEntries((list) => list || []); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { page(null); }, [page]);

  const days = useMemo(() => {
    const out = [];
    for (const e of entries || []) {
      const label = dayLabel(e.at);
      if (out.at(-1)?.label !== label) out.push({ label, list: [] });
      out.at(-1).list.push(e);
    }
    return out;
  }, [entries]);

  if (entries === null) return <p className="ad-loading" role="status">Cargando…</p>;
  return (
    <>
      <p className="ch-hint">Lo que han hecho quienes administran la empresa, lo más reciente primero. Solo lo ven quienes administran.</p>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {!entries.length && !error ? <Empty title="Nada anotado todavía">Aquí aparecerán las invitaciones, los cambios de papel, los canales archivados, las exportaciones…</Empty> : null}
      <div className="ad-log">
        {days.map((d) => (
          <section key={d.label + d.list[0].seq} aria-label={d.label}>
            <h3 className="ad-day">{d.label.charAt(0).toUpperCase() + d.label.slice(1)}</h3>
            <ul className="ch-list">
              {d.list.map((e) => {
                const [what, more] = describe(e, s);
                const actor = e.actor?.name || e.actor?.email || null;
                return (
                  <li key={e.seq} className="ch-item">
                    <time className="ad-log-time" dateTime={new Date(e.at).toISOString()} title={whenOf(e.at)}>{timeOf(e.at)}</time>
                    <div className="ch-item-main">
                      <span className="ad-log-text">{actor ? <><strong>{actor}</strong> {what}</> : <><strong>Colmena</strong> {what}</>}</span>
                      {more ? <span className="ch-item-meta">{more}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {next ? <div className="ad-more"><button type="button" className="ch-btn" disabled={busy} onClick={() => page(next)}>{busy ? "Cargando…" : "Más"}</button></div> : null}
    </>
  );
}
