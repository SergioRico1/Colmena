// «Personas» (/personas): the company's directory in team messaging (docs/CLOUD.md › Phase 2).
// Everyone in the workspace with their presence, status, title and local time; a profile panel
// (?p=<id>, or ?p=yo for your own, editable) with «Enviar mensaje»; and a group message with up
// to 8 others. Data: useChat() (src/chat/store.js), kept live by the socket's chat.* frames.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BellSlash, ChatCircleText, Search, Pencil, UsersThree, X } from "../components/Icon.js";
import { navigate } from "../lib/router.jsx";
import { chat } from "../chat/api.js";
import { upsertChannel, useChat } from "../chat/store.js";
import { Avatar, ChatPage, Empty, ROLE_LABEL, localTimeOf, whenOf } from "../chat/ui.jsx";
import ProfileEditor from "../chat/ProfileEditor.jsx";
import "../chat/people.css";

const GROUP_MAX = 8; // others besides you (server/cloud/chat.mjs › CHAT_LIMITS.groupMax)
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const byName = (a, b) => (a.name || "").localeCompare(b.name || "", "es", { sensitivity: "base" });
const cityOf = (tz) => (tz && tz !== "UTC" ? tz.split("/").pop().replace(/_/g, " ") : tz || "");

/** The clock moves: local times re-render each half minute. */
function useMinute() {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
}

/** How to name someone in a search filter (server/cloud/chat.mjs › findPerson). */
const handleOf = (p) => (p.email ? p.email : (p.name || "").replace(/\s+/g, ""));

function Chips({ p, presence }) {
  return (
    <>
      {p.role === "owner" || p.role === "admin" || p.role === "guest" ? <span className="ch-chip">{ROLE_LABEL[p.role]}</span> : null}
      {p.deactivated ? <span className="ch-chip">Desactivada</span> : null}
      {!p.deactivated && (p.away || presence === "away") ? <span className="ch-chip">Ausente</span> : null}
      {!p.deactivated && p.dnd ? <span className="ch-chip"><BellSlash size={12} />No molestar</span> : null}
    </>
  );
}

function Status({ status }) {
  if (!status || (!status.emoji && !status.text)) return null;
  return (
    <span className="pp-status">
      {status.emoji ? <span className="pp-status-emoji" aria-hidden="true">{status.emoji}</span> : null}
      <span className="ch-ellipsis">{status.text || ""}</span>
    </span>
  );
}

export default function Personas({ query = {} }) {
  const s = useChat();
  useMinute();
  const me = s.me;
  const [filter, setFilter] = useState("");
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const open = query.p || null;
  const panelRef = useRef(null);

  const everyone = useMemo(() => [...s.people.values()], [s.people]);
  const others = useMemo(() => {
    const f = fold(filter.trim());
    const match = (p) => !f || [p.name, p.email, p.title].some((v) => fold(v).includes(f));
    const list = everyone.filter((p) => p.id !== me?.id && match(p));
    return { active: list.filter((p) => !p.deactivated).sort(byName), off: list.filter((p) => p.deactivated).sort(byName) };
  }, [everyone, filter, me?.id]);
  const total = everyone.filter((p) => !p.deactivated).length;
  const online = everyone.filter((p) => !p.deactivated && s.presence.get(p.id) === "active").length;

  const show = (id) => navigate("/personas" + (id ? "?p=" + encodeURIComponent(id) : ""), { replace: !!open && !!id });
  const close = () => navigate("/personas");
  const person = open === "yo" ? null : open ? s.people.get(open) || null : null;

  // Escape closes the panel; the panel takes focus when it opens.
  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus({ preventScroll: true });
    const key = (e) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".ch-scrim,[role=listbox]")) close(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  async function message(ids) {
    setBusy(true);
    setError(null);
    try {
      const view = await chat.post("/dm", { people: ids });
      upsertChannel(view);
      navigate("/canal/" + view.id);
    } catch (e) {
      setError(e.message || "No se pudo abrir la conversación.");
      setBusy(false);
    }
  }

  const togglePick = (id) => {
    setError(null);
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= GROUP_MAX ? list : [...list, id]));
  };
  const stopPicking = () => { setPicking(false); setPicked([]); setError(null); };

  const header = (
    <>
      <button type="button" className={"ch-btn" + (picking ? " is-on" : "")} aria-pressed={picking} onClick={() => (picking ? stopPicking() : setPicking(true))}>
        <UsersThree size={16} /><span className="r-hide-phone">Mensaje en grupo</span><span className="pp-phone-only">Grupo</span>
      </button>
      <button type="button" className="ch-btn" onClick={() => show("yo")}>
        <Pencil size={16} /><span className="r-hide-phone">Editar tu perfil</span><span className="pp-phone-only">Tu perfil</span>
      </button>
    </>
  );

  const row = (p) => {
    const presence = s.presence.get(p.id);
    const local = p.tz ? localTimeOf(p.tz) : null;
    const meta = [p.title, local ? local + " hora local" : null].filter(Boolean).join(" · ");
    const isPicked = picked.includes(p.id);
    const full = picking && !isPicked && picked.length >= GROUP_MAX;
    const body = (
      <>
        <Avatar id={p.id} size={36} />
        <span className="pp-main">
          <span className="pp-name-line">
            <span className="pp-name ch-ellipsis">{p.name}</span>
            <Chips p={p} presence={presence} />
          </span>
          {p.status ? <Status status={p.status} /> : null}
          {meta ? <span className="pp-meta">{meta}</span> : null}
        </span>
      </>
    );
    if (picking) {
      return (
        <li key={p.id} className={"pp-item" + (p.deactivated ? " is-off" : "")}>
          <label className={"pp-row" + (isPicked ? " is-picked" : "")} aria-disabled={p.deactivated || full || undefined}>
            <input type="checkbox" className="pp-pick" checked={isPicked} disabled={p.deactivated || full} onChange={() => togglePick(p.id)} aria-label={"Elegir a " + p.name} />
            {body}
          </label>
        </li>
      );
    }
    return (
      <li key={p.id} className={"pp-item" + (p.deactivated ? " is-off" : "")}>
        <button type="button" className="pp-row" aria-current={open === p.id ? "true" : undefined} onClick={() => show(p.id)}>{body}</button>
      </li>
    );
  };

  const meView = me ? s.people.get(me.id) || { id: me.id, name: me.name, ...(me.profile || {}) } : null;
  const loading = !s.ready && !s.error;

  return (
    <ChatPage title="Personas" sub={s.ready ? `${total} ${total === 1 ? "persona" : "personas"} · ${online} ${online === 1 ? "conectada" : "conectadas"}` : null} actions={s.ready ? header : null} scroll={false} active="personas">
      <div className="pp-split">
        <section className="pp-listcol" aria-label="Directorio">
          <div className="pp-list-inner">
            {s.error ? <p className="ch-error">{s.error}</p> : null}
            {loading ? <p className="ch-hint" role="status">Cargando personas…</p> : null}
            {s.ready ? (
              <>
                {meView && !picking ? (
                  <button type="button" className="pp-me" aria-current={open === "yo" ? "true" : undefined} onClick={() => show("yo")}>
                    <Avatar id={meView.id} size={40} />
                    <span className="pp-main">
                      <span className="pp-name-line"><span className="pp-name ch-ellipsis">{meView.name}</span><span className="pp-you">(tú)</span><Chips p={meView} presence={s.presence.get(meView.id)} /></span>
                      {meView.status ? <Status status={meView.status} /> : <span className="pp-meta">Sin estado: dile al equipo qué estás haciendo.</span>}
                    </span>
                    <span className="pp-me-edit"><Pencil size={16} />Editar</span>
                  </button>
                ) : null}

                <div className="pp-filter">
                  <Search size={16} aria-hidden="true" />
                  <input className="ch-input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por nombre, correo o cargo" aria-label="Filtrar personas" />
                </div>

                {picking ? (
                  <p className="ch-hint pp-pick-hint">Elige hasta {GROUP_MAX} personas para escribirles a la vez.</p>
                ) : null}

                {others.active.length ? <ul className="pp-list">{others.active.map(row)}</ul> : null}
                {others.off.length ? (
                  <>
                    <h2 className="ch-section-title pp-off-title">Desactivadas <span className="pp-count">{others.off.length}</span></h2>
                    <ul className="pp-list">{others.off.map(row)}</ul>
                  </>
                ) : null}
                {!others.active.length && !others.off.length ? (
                  filter.trim()
                    ? <Empty title="Nadie coincide">Prueba con otra parte del nombre, el correo o el cargo.</Empty>
                    : <Empty title="Aún estás solo aquí">Cuando invites a tu equipo a la empresa, aparecerán aquí.</Empty>
                ) : null}
              </>
            ) : null}
          </div>

          {picking ? (
            <div className="pp-pickbar" role="region" aria-label="Mensaje en grupo">
              <span className="pp-pickbar-count" aria-live="polite">{picked.length ? `${picked.length} de ${GROUP_MAX} elegidas` : "Nadie elegido"}</span>
              {error ? <span className="pp-pickbar-error" role="alert">{error}</span> : null}
              <button type="button" className="ch-btn" onClick={stopPicking}>Cancelar</button>
              <button type="button" className="ch-btn is-primary" disabled={!picked.length || busy} onClick={() => message(picked)}>
                <ChatCircleText size={16} />{busy ? "Abriendo…" : picked.length > 1 ? "Escribir al grupo" : "Escribir"}
              </button>
            </div>
          ) : null}
        </section>

        {open ? (
          <aside className="pp-panel" ref={panelRef} tabIndex={-1} aria-label={open === "yo" ? "Tu perfil" : "Perfil"}>
            <div className="pp-panel-head">
              <button type="button" className="ch-iconbtn pp-back" onClick={close} aria-label="Volver a Personas"><ArrowLeft size={18} /></button>
              <h2 className="pp-panel-title">{open === "yo" ? "Tu perfil" : "Perfil"}</h2>
              <button type="button" className="ch-iconbtn pp-close" onClick={close} aria-label="Cerrar"><X size={18} /></button>
            </div>
            <div className="pp-panel-body">
              {open === "yo" ? (
                s.ready ? <ProfileEditor /> : null
              ) : person ? (
                <Profile p={person} you={person.id === me?.id} busy={busy} error={picking ? null : error} onMessage={() => message([person.id])} onEdit={() => show("yo")} />
              ) : s.ready ? (
                <Empty title="No está en la empresa">Puede que la hayan quitado del espacio.</Empty>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </ChatPage>
  );
}

function Profile({ p, you, busy, error, onMessage, onEdit }) {
  const s = useChat();
  const presence = s.presence.get(p.id);
  const local = p.tz ? localTimeOf(p.tz) : null;
  const state = p.deactivated ? "Desactivada" : presence === "active" ? "Conectada" : presence === "away" ? "Ausente" : "Desconectada";
  return (
    <div className="pp-profile">
      <div className="pp-profile-top">
        <Avatar id={p.id} size={72} />
        <h3 className="pp-profile-name">{p.name}{you ? <span className="pp-you"> (tú)</span> : null}</h3>
        {p.title ? <p className="pp-profile-title">{p.title}</p> : null}
        {p.status ? <Status status={p.status} /> : null}
        <div className="pp-chips"><Chips p={p} presence={presence} /></div>
      </div>

      <div className="ch-row-actions pp-profile-actions">
        {you ? (
          <button type="button" className="ch-btn is-primary" onClick={onEdit}><Pencil size={16} />Editar tu perfil</button>
        ) : (
          <button type="button" className="ch-btn is-primary" disabled={p.deactivated || busy} onClick={onMessage}><ChatCircleText size={16} />{busy ? "Abriendo…" : "Enviar mensaje"}</button>
        )}
        <a className="ch-btn" href={"/buscar?q=" + encodeURIComponent("from:@" + handleOf(p))}><Search size={16} />{you ? "Tus mensajes" : "Sus mensajes"}</a>
      </div>
      {error ? <p className="ch-error">{error}</p> : null}

      <dl className="pp-facts">
        <div><dt>Estado</dt><dd>{state}{!p.deactivated && p.dnd ? (p.dndUntil ? " · no molestar hasta " + whenOf(p.dndUntil) : " · no molestar") : ""}</dd></div>
        {local ? <div><dt>Hora local</dt><dd>{local}{cityOf(p.tz) ? " · " + cityOf(p.tz) : ""}</dd></div> : null}
        {p.email ? <div><dt>Correo</dt><dd><a className="ch-link" href={"mailto:" + p.email}>{p.email}</a></dd></div> : null}
        <div><dt>Rol</dt><dd>{ROLE_LABEL[p.role] || "Miembro"}</dd></div>
      </dl>
    </div>
  );
}
