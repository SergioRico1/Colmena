// The channel's small dialogs: its people (add, remove), pinned messages, topic and description;
// and the people picker the «new message» and «create a channel» dialogs share.
import { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "../components/Icon.js";
import { chat } from "./api.js";
import { MessageText } from "./format.jsx";
import { mergeGhosts, nameOf, useChat } from "./store.js";
import { Avatar, Dialog, Presence, ROLE_LABEL, whenOf } from "./ui.jsx";

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Choose people of the company (not yourself, not `exclude`); `max` at most. */
export function PeoplePicker({ value, onChange, exclude = [], max = 50, label = "Buscar personas" }) {
  const s = useChat();
  const [q, setQ] = useState("");
  const skip = new Set([s.me?.id, ...exclude]);
  const list = [...s.people.values()].filter((p) => !p.deactivated && !skip.has(p.id) && (!q || fold(p.name + " " + p.email + " " + (p.title || "")).includes(fold(q))))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : value.length >= max ? value : [...value, id]);
  return (
    <div className="pk">
      {value.length ? (
        <ul className="pk-chosen" aria-label="Elegidas">
          {value.map((id) => <li key={id}><span className="ch-chip">{nameOf(id, s)}<button type="button" className="pk-x" onClick={() => toggle(id)} aria-label={"Quitar a " + nameOf(id, s)}><X size={12} /></button></span></li>)}
        </ul>
      ) : null}
      <label className="pk-search"><Search size={16} aria-hidden="true" /><input className="ch-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} aria-label={label} /></label>
      <ul className="pk-list" role="listbox" aria-multiselectable="true" aria-label="Personas">
        {list.length ? list.map((p) => {
          const on = value.includes(p.id);
          return (
            <li key={p.id} role="option" aria-selected={on} tabIndex={0} className={"pk-row" + (on ? " is-on" : "")} onClick={() => toggle(p.id)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(p.id); } }}>
              <Avatar id={p.id} size={28} />
              <span className="pk-main"><span className="pk-name">{p.name}</span><span className="pk-sub">{p.title || p.email}{p.role === "guest" ? " · Invitado" : ""}</span></span>
              <span className="pk-check" aria-hidden="true">{on ? <Check size={16} weight="bold" /> : null}</span>
            </li>
          );
        }) : <li className="pk-empty">Nadie con ese nombre.</li>}
      </ul>
    </div>
  );
}

export function ChannelInfo({ channel, info, onClose, onChanged }) {
  const s = useChat();
  const [adding, setAdding] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ids = info?.memberIds || info?.people || [];
  const dm = info && (info.kind === "dm" || info.kind === "group");
  const canAdd = info && info.canManage !== false && info.kind !== "dm" && !info.archived;
  const add = async () => {
    setBusy(true); setError(null);
    try { const r = await chat.post(`/channels/${channel}/members`, { people: adding }); onChanged?.(r.channel); setAdding([]); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const remove = async (pid) => {
    if (!confirm(`¿Quitar a ${nameOf(pid, s)} del canal?`)) return;
    try { await chat.del(`/channels/${channel}/members/${pid}`); onChanged?.(await chat.get(`/channels/${channel}`)); }
    catch (e) { setError(e.message); }
  };
  const sorted = [...ids].sort((a, b) => nameOf(a, s).localeCompare(nameOf(b, s), "es"));
  return (
    <Dialog title={dm ? "Personas de la conversación" : "Personas y detalles"} onClose={onClose} width={520}
      footer={canAdd && adding.length ? <button type="button" className="ch-btn is-primary" disabled={busy} onClick={add}>{adding.length === 1 ? "Añadir a 1 persona" : `Añadir a ${adding.length} personas`}</button> : null}>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {info && !dm ? (
        <dl className="ci-facts">
          <div><dt>Tipo</dt><dd>{info.kind === "private" ? "Privado: solo lo ven sus miembros" : "Público: cualquiera de la empresa puede entrar"}</dd></div>
          {info.topic ? <div><dt>Tema</dt><dd>{info.topic}</dd></div> : null}
          {info.description ? <div><dt>Descripción</dt><dd>{info.description}</dd></div> : null}
          <div><dt>Creado</dt><dd>{whenOf(info.createdAt)}{info.createdBy ? " por " + nameOf(info.createdBy, s) : ""}</dd></div>
          {info.isDefault ? <div><dt>Por defecto</dt><dd>Quien entra en la empresa se une a este canal.</dd></div> : null}
        </dl>
      ) : null}
      <h3 className="ci-h">{ids.length === 1 ? "1 persona" : `${ids.length} personas`}</h3>
      <ul className="ci-people">
        {sorted.map((pid) => {
          const p = s.people.get(pid);
          return (
            <li key={pid} className="ci-person">
              <Avatar id={pid} size={28} />
              <span className="pk-main"><span className="pk-name">{nameOf(pid, s)}{pid === s.me?.id ? " (tú)" : ""}</span><span className="pk-sub">{[p?.title, p && p.role !== "member" ? ROLE_LABEL[p.role] : null].filter(Boolean).join(" · ")}</span></span>
              <Presence id={pid} />
              {!dm && info?.canManage && pid !== s.me?.id ? <button type="button" className="ch-btn" onClick={() => remove(pid)}>Quitar</button> : null}
            </li>
          );
        })}
      </ul>
      {canAdd ? (<><h3 className="ci-h">Añadir personas</h3><PeoplePicker value={adding} onChange={setAdding} exclude={ids} max={info.kind === "group" ? Math.max(0, 9 - ids.length) : 100} /></>) : null}
    </Dialog>
  );
}

export function PinsDialog({ channel, onClose, onOpen }) {
  const [pins, setPins] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { chat.get(`/channels/${channel}/pins`).then((p) => { mergeGhosts(p.ghosts); setPins(p.messages); }).catch((e) => setError(e.message)); }, [channel]);
  const s = useChat();
  return (
    <Dialog title="Mensajes fijados" onClose={onClose} width={560}>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {!pins ? <p className="ch-hint">Cargando…</p> : !pins.length ? <p className="ch-hint">Nada fijado todavía. Fija un mensaje desde su menú «⋯» para tenerlo a mano aquí.</p> : (
        <ul className="ci-pins">
          {pins.map((m) => (
            <li key={m.id}>
              <button type="button" className="ci-pin" onClick={() => onOpen(m)}>
                <span className="ci-pin-head"><Avatar id={m.author} size={20} presence={false} /><b>{nameOf(m.author, s)}</b><span>{whenOf(m.at)}</span></span>
                <span className="ci-pin-text"><MessageText text={m.text} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function TopicDialog({ channel, info, onClose, onChanged }) {
  const [name, setName] = useState(info?.name || "");
  const [topic, setTopic] = useState(info?.topic || "");
  const [description, setDescription] = useState(info?.description || "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onChanged(await chat.patch(`/channels/${channel}`, { name, topic, description })); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const valid = useMemo(() => name.trim().length > 0, [name]);
  return (
    <Dialog title="Editar el canal" onClose={onClose}
      footer={<><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="submit" form="topic-form" className="ch-btn is-primary" disabled={busy || !valid}>Guardar</button></>}>
      <form id="topic-form" onSubmit={save}>
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
        <label className="ch-field">Nombre<input className="ch-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /><small>En minúsculas y sin espacios: «ventas-norte».</small></label>
        <label className="ch-field">Tema<input className="ch-input" value={topic} maxLength={250} onChange={(e) => setTopic(e.target.value)} placeholder="De qué se habla ahora" /></label>
        <label className="ch-field">Descripción<textarea className="ch-textarea" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué sirve este canal" /></label>
      </form>
    </Dialog>
  );
}
