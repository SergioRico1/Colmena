// «Canales» of hosted Colmena (docs/CLOUD.md › Phase 2), at /canales: every public channel to
// browse and join, what was for you lately («Menciones»), and the two ways to start something:
// a new channel (?nuevo=1) and a new direct message or group (?mensaje=1).
import { useEffect, useState } from "react";
import { At, Hash, LockSimple, MessageSquarePlus, Plus, Search } from "../components/Icon.js";
import { navigate } from "../lib/router.jsx";
import { chat } from "../chat/api.js";
import { PeoplePicker } from "../chat/ChannelDialogs.jsx";
import { MessageText } from "../chat/format.jsx";
import { channelTitle, mergeGhosts, nameOf, upsertChannel, useChat } from "../chat/store.js";
import { Avatar, ChatPage, Dialog, Empty, Tabs, ago, whenOf } from "../chat/ui.jsx";
import "../chat/channel.css";

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function NewChannel({ onClose }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("public");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const clean = name.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const view = await chat.post("/channels", { name, kind, description, members: people });
      upsertChannel(view);
      navigate("/canal/" + view.id);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Dialog title="Crear un canal" onClose={onClose} width={520}
      footer={<><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="submit" form="new-channel" className="ch-btn is-primary" disabled={busy || !clean}>Crear el canal</button></>}>
      <form id="new-channel" onSubmit={create}>
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
        <label className="ch-field">Nombre
          <span className="nc-name"><span aria-hidden="true">#</span><input className="ch-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="p. ej. ventas-norte" autoFocus /></span>
          <small>{clean ? "Se llamará #" + clean : "En minúsculas y sin espacios. Los canales se usan mejor por tema."}</small>
        </label>
        <fieldset className="nc-kind">
          <legend>Quién lo ve</legend>
          <label className="ch-check"><input type="radio" name="kind" checked={kind === "public"} onChange={() => setKind("public")} /><span><b>Público</b><br /><small>Cualquiera de la empresa puede encontrarlo y entrar. Los invitados, solo si los añades.</small></span></label>
          <label className="ch-check"><input type="radio" name="kind" checked={kind === "private"} onChange={() => setKind("private")} /><span><b>Privado</b><br /><small>Solo lo ven las personas que añadas. Sus mensajes no aparecen en las búsquedas de nadie más.</small></span></label>
        </fieldset>
        <label className="ch-field">Descripción <small>(opcional)</small><input className="ch-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="Para qué sirve" /></label>
        <div className="ch-field">Añadir personas <small>(opcional)</small><PeoplePicker value={people} onChange={setPeople} /></div>
      </form>
    </Dialog>
  );
}

function NewMessage({ onClose }) {
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true); setError(null);
    try { const view = await chat.post("/dm", { people }); upsertChannel(view); navigate("/canal/" + view.id); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Dialog title="Nuevo mensaje" onClose={onClose} width={480}
      footer={<><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="button" className="ch-btn is-primary" disabled={busy || !people.length} onClick={open}>{people.length > 1 ? "Abrir el grupo" : "Abrir la conversación"}</button></>}>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      <p className="ch-hint">Una persona para un mensaje directo; hasta 8 para un grupo. Solo vosotros lo veréis.</p>
      <PeoplePicker value={people} onChange={setPeople} max={8} label="¿A quién escribes?" />
    </Dialog>
  );
}

function Browse() {
  const s = useChat();
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => { chat.get("/channels/browse").then((r) => setList(r.channels)).catch((e) => setError(e.message)); }, []);
  const join = async (c) => {
    try { const view = await chat.post(`/channels/${c.id}/join`, {}); upsertChannel(view); setList((l) => l.map((x) => (x.id === c.id ? { ...x, member: true } : x))); navigate("/canal/" + c.id); }
    catch (e) { setError(e.message); }
  };
  const mine = [...s.channels.values()].filter((c) => c.kind === "private");
  const all = [...(list || []), ...mine.filter((c) => !(list || []).some((x) => x.id === c.id))];
  const shown = all.filter((c) => !q || fold(c.name + " " + c.topic + " " + c.description).includes(fold(q))).sort((a, b) => (a.archived - b.archived) || String(a.name).localeCompare(String(b.name), "es"));
  if (s.me?.role === "guest") return <Empty title="Como invitado ves los canales a los que te añaden">Aparecen en la barra lateral, en «Canales».</Empty>;
  return (
    <div className="ch-section">
      <label className="cl-search"><Search size={16} aria-hidden="true" /><input className="ch-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar canales" aria-label="Buscar canales" /></label>
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {!list ? <p className="ch-hint">Cargando…</p> : !shown.length ? <Empty title={q ? "Ningún canal se llama así" : "Aún no hay canales"} action={<a className="ch-btn is-primary" href="/canales?nuevo=1"><Plus size={16} /> Crear un canal</a>} /> : (
        <ul className="ch-list">
          {shown.map((c) => (
            <li key={c.id} className={"ch-item" + (c.archived ? " is-archived" : "")}>
              <span className="cl-icon" aria-hidden="true">{c.kind === "private" ? <LockSimple size={18} /> : <Hash size={18} />}</span>
              <div className="ch-item-main">
                <a className="ch-item-title" href={"/canal/" + c.id}>{c.name}{c.archived ? <span className="ch-chip">Archivado</span> : null}{c.isDefault ? <span className="ch-chip">Por defecto</span> : null}</a>
                <span className="ch-item-meta">{[c.memberCount === 1 ? "1 persona" : `${c.memberCount} personas`, c.topic || c.description, c.lastAt ? "activo " + ago(c.lastAt) : null].filter(Boolean).join(" · ")}</span>
              </div>
              {c.member ? <span className="ch-chip is-accent">Estás dentro</span> : c.archived ? null : <button type="button" className="ch-btn" onClick={() => join(c)}>Unirme</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Mentions() {
  const s = useChat();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { chat.get("/mentions").then((r) => { mergeGhosts(r.ghosts); setItems(r.items); }).catch((e) => setError(e.message)); }, []);
  const KIND = { mention: "te mencionó", dm: "te escribió", channel: "avisó al canal", here: "avisó a quien estaba", thread: "respondió en un hilo tuyo", keyword: "dijo una de tus palabras clave" };
  return (
    <div className="ch-section">
      {error ? <p className="ch-error" role="alert">{error}</p> : null}
      {!items ? <p className="ch-hint">Cargando…</p> : !items.length ? <Empty title="Nada para ti todavía">Aquí verás cuando alguien te mencione, te escriba o responda en tus hilos.</Empty> : (
        <ul className="ch-list">
          {items.map(({ kind, seen, message: m }) => {
            const ch = s.channels.get(m.channel);
            const href = "/canal/" + m.channel + (m.threadId ? "?hilo=" + m.threadId : "?m=" + m.id);
            return (
              <li key={m.id} className={"ch-item cl-mention" + (seen ? "" : " is-new")}>
                <Avatar id={m.author} size={32} />
                <div className="ch-item-main">
                  <a className="cl-mention-head" href={href}><b>{nameOf(m.author, s)}</b> {KIND[kind] || ""}{ch ? <span>{" en " + (ch.kind === "public" || ch.kind === "private" ? "#" : "") + channelTitle(ch, s)}</span> : null}<span className="cl-when">{whenOf(m.at)}</span></a>
                  <div className="cl-mention-text"><MessageText text={m.text} /></div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function Canales({ query }) {
  const s = useChat();
  const [tab, setTab] = useState(query?.ver === "menciones" ? "menciones" : "explorar");
  const close = () => navigate("/canales", { replace: true });
  const mentions = [...s.channels.values()].reduce((n, c) => n + (c.mentions || 0), 0);
  return (
    <ChatPage title="Canales" icon={<Hash size={19} />} scroll
      actions={<>
        <a className="ch-btn r-hide-phone" href="/canales?mensaje=1"><MessageSquarePlus size={16} /> Nuevo mensaje</a>
        {s.me?.role !== "guest" ? <a className="ch-btn is-primary" href="/canales?nuevo=1"><Plus size={16} /> Crear un canal</a> : null}
      </>}>
      <Tabs label="Canales" value={tab} onChange={setTab} items={[{ id: "explorar", label: "Explorar" }, { id: "menciones", label: <><At size={15} /> Para ti</>, count: mentions || null }]} />
      {tab === "explorar" ? <Browse /> : <Mentions />}
      {query?.nuevo ? <NewChannel onClose={close} /> : null}
      {query?.mensaje ? <NewMessage onClose={close} /> : null}
    </ChatPage>
  );
}
