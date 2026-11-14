// The sidebar's team messaging (hosted only; components/v3/Sidebar.jsx draws it above its groups):
// search, people and the company; your channels; your direct messages. Unread channels read in
// ink and bold, what is for you carries a count.
import { useState } from "react";
import { ChevronDown, Hash, LockSimple, Plus, Search, ShieldCheck, UsersThree } from "../components/Icon.js";
import { channelTitle, useChat } from "./store.js";
import { Avatar, Count } from "./ui.jsx";
import "./nav.css";

function Group({ id, label, add, addLabel, children, unread }) {
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem("colmena.chatnav." + id) === "1"; } catch { return false; } });
  const toggle = () => { setClosed(!closed); try { localStorage.setItem("colmena.chatnav." + id, closed ? "0" : "1"); } catch {} };
  return (
    <section className="cn-group" aria-labelledby={"cn-" + id}>
      <div className="cn-group-head">
        <button type="button" id={"cn-" + id} className="cn-group-btn" aria-expanded={!closed} onClick={toggle}>
          <ChevronDown size={12} weight="bold" style={{ transform: closed ? "rotate(-90deg)" : "none" }} />
          <span>{label}</span>
          {closed && unread ? <Count n={unread} /> : null}
        </button>
        {add ? <a className="cn-add" href={add} aria-label={addLabel} title={addLabel}><Plus size={15} /></a> : null}
      </div>
      {closed ? null : <ul className="cn-list">{children}</ul>}
    </section>
  );
}

function Row({ ch, s, on }) {
  const dm = ch.kind === "dm" || ch.kind === "group";
  const other = dm ? (ch.people || []).find((p) => p !== s.me?.id) || s.me?.id : null;
  const unread = (ch.unread || 0) > 0 && !ch.muted;
  const Icon = ch.kind === "private" ? LockSimple : Hash;
  return (
    <li>
      <a href={"/canal/" + ch.id} aria-current={on ? "page" : undefined} className={"cn-row" + (unread || ch.mentions ? " is-unread" : "") + (ch.muted ? " is-muted" : "")}>
        <span className="cn-icon" aria-hidden="true">
          {dm ? (ch.kind === "dm" ? <Avatar id={other} size={20} /> : <UsersThree size={16} />) : <Icon size={16} />}
        </span>
        <span className="cn-name">{channelTitle(ch, s)}</span>
        {ch.mentions ? <Count n={ch.mentions} strong label={`${ch.mentions} para ti`} /> : null}
      </a>
    </li>
  );
}

export default function ChannelsNav({ pathname }) {
  const s = useChat();
  if (!s.ready) return null;
  const all = [...s.channels.values()];
  const channels = all.filter((c) => c.kind === "public" || c.kind === "private").filter((c) => !c.archived).sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  const direct = all.filter((c) => c.kind === "dm" || c.kind === "group").sort((a, b) => (b.lastAt || b.createdAt || 0) - (a.lastAt || a.createdAt || 0)).slice(0, 30);
  const here = (href) => pathname === href || pathname.startsWith(href + "/");
  const sum = (list) => list.reduce((n, c) => n + (c.muted ? 0 : c.unread || 0), 0);
  const admin = ["owner", "admin"].includes(s.me?.role);
  return (
    <div className="cn" data-chat-nav="">
      <nav aria-label="Mensajería del equipo" className="cn-places">
        <a href="/buscar" className="cn-row" aria-current={here("/buscar") ? "page" : undefined}><span className="cn-icon" aria-hidden="true"><Search size={16} /></span><span className="cn-name">Buscar mensajes</span></a>
        <a href="/personas" className="cn-row" aria-current={here("/personas") ? "page" : undefined}><span className="cn-icon" aria-hidden="true"><UsersThree size={16} /></span><span className="cn-name">Personas</span></a>
        {admin ? <a href="/admin" className="cn-row" aria-current={here("/admin") ? "page" : undefined}><span className="cn-icon" aria-hidden="true"><ShieldCheck size={16} /></span><span className="cn-name">Empresa</span></a> : null}
      </nav>
      <Group id="canales" label="Canales" add="/canales?nuevo=1" addLabel="Crear un canal" unread={sum(channels)}>
        {channels.map((c) => <Row key={c.id} ch={c} s={s} on={here("/canal/" + c.id)} />)}
        <li><a href="/canales" className="cn-row cn-more" aria-current={pathname === "/canales" ? "page" : undefined}><span className="cn-icon" aria-hidden="true"><Plus size={14} /></span><span className="cn-name">{channels.length ? "Explorar canales" : "Explorar o crear canales"}</span></a></li>
      </Group>
      <Group id="directos" label="Mensajes directos" add="/canales?mensaje=1" addLabel="Nuevo mensaje directo" unread={sum(direct)}>
        {direct.length ? direct.map((c) => <Row key={c.id} ch={c} s={s} on={here("/canal/" + c.id)} />) : <li className="cn-empty">Escribe a alguien desde «Personas» o con el «+».</li>}
      </Group>
    </div>
  );
}
