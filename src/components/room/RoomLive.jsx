// Pieces of a desktop room (src/screens/Room.jsx) that the channels of hosted Colmena have too
// (docs/CLOUD.md › bots in channels): who is typing with their faces, the last 24 hours as a little
// comb, the search of a private room, a person's quick card and «Pedir a <bot>» for a message
// dragged onto a bot of the sidebar (src/chat/askBot.js).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatCircleText, Search, X } from "../Icon.js";
import BotFace from "../BotFace.jsx";
import { PixelBanner, PulseComb } from "../Hive.jsx";
import { PersonAvatar } from "./Author.jsx";
import { familyInk } from "../../lib/personColor.js";
import { personTint } from "../../lib/identity.js";
import { post } from "../../lib/api.js";
import { navigate } from "../../lib/router.jsx";
import { NOW_TONE, botNow } from "../../lib/botNow.js";
import { useStore } from "../../lib/store.jsx";
import { placeStyle, usePopover } from "../../chat/popover.js";
import { onAskBot } from "../../chat/askBot.js";
import "../../chat/chat.css";
import "../../chat/botcard.css";

/** «Ana está escribiendo · Vera está pensando…» as a pill with their faces. */
export function TypingPill({ people = [], bots = [], extra = null }) {
  if (!people.length && !bots.length && !extra) return null;
  const list = (names) => (names.length > 2 ? names.slice(0, 2).join(", ") + " y " + (names.length - 2) + " más" : names.join(" y "));
  const faces = [...people.map((p) => ({ kind: "p", p })), ...bots.map((b) => ({ kind: "b", b }))].slice(0, 3);
  return (
    <div className="ty" role="status" style={{ position: "static", margin: "0 0 8px", maxWidth: "100%" }}>
      <span className="ty-dots" aria-hidden="true"><i /><i /><i /></span>
      {faces.length ? <span className="ty-faces" aria-hidden="true">{faces.map((f, i) => (f.kind === "p" ? <PersonAvatar key={i} person={f.p} size={20} ring="var(--c-raised)" /> : <BotFace key={i} bot={f.b} size={20} state="work" decorative alive />))}</span> : null}
      <span className="ty-text">
        {people.length ? <span><b>{list(people.map((p) => p.name.split(" ")[0]))}</b>{people.length === 1 ? " está escribiendo" : " están escribiendo"}</span> : null}
        {bots.length ? <span>{people.length ? " · " : ""}<b>{list(bots.map((b) => b.name))}</b>{bots.length === 1 ? " está pensando" : " están pensando"}</span> : null}
        {people.length || bots.length ? "…" : null}
        {extra ? <span>{people.length || bots.length ? " · " : ""}{extra}</span> : null}
      </span>
    </div>
  );
}

/** The last 24 hours of a room in twelve cells of two hours (components/Hive.jsx › PulseComb). */
export function pulseOf(rows, now = Date.now()) {
  const from = now - 24 * 3600000;
  const counts = Array(12).fill(0);
  for (const m of rows || []) {
    const at = Date.parse(m.at || m.createdAt || "") || (typeof m.at === "number" ? m.at : 0);
    if (!at || at < from || at > now || m.local || m.kind === "progress") continue;
    counts[Math.min(11, Math.floor((at - from) / 7200000))]++;
  }
  return { from, counts };
}
export function RoomPulse({ rows }) {
  // Moves on by itself every few minutes, so an idle room's comb empties as the hours pass.
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 5 * 60000); return () => clearInterval(t); }, []);
  const pulse = useMemo(() => pulseOf(rows), [rows, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return <PulseComb pulse={pulse} className="r-hide-phone" />;
}

const plainOf = (m) => String(m.text || "").replace(/\s+/g, " ").trim();
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The search of a private room: the messages here with these words (newest first); a click goes to it. */
export function RoomSearch({ rows, nameOf, onClose }) {
  const [q, setQ] = useState("");
  const box = useRef(null);
  useEffect(() => { box.current?.focus(); }, []);
  const term = fold(q.trim());
  const hits = term ? [...(rows || [])].filter((m) => !m.local && m.text && fold(plainOf(m)).includes(term)).reverse().slice(0, 40) : null;
  const go = (m) => {
    const el = document.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("is-highlight");
    setTimeout(() => el.classList.remove("is-highlight"), 1800);
  };
  return (
    <div style={{ padding: "0 24px 12px", WebkitAppRegion: "no-drag" }}>
      <label className="cs-box" style={{ margin: "0 0 6px" }}>
        <Search size={16} aria-hidden="true" />
        <span className="cs-chip">en esta sala</span>
        <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} placeholder="Buscar en los mensajes" aria-label="Buscar en esta sala" />
        <button type="button" className="v4-ib" onClick={onClose} aria-label="Cerrar la búsqueda"><X size={16} /></button>
      </label>
      {hits === null ? null : !hits.length ? <p className="cs-empty">Nada con esas palabras en esta sala.</p> : (
        <ul className="cs-list" style={{ maxHeight: "40vh", padding: 0 }}>
          {hits.map((m) => (
            <li key={m.id}>
              <button type="button" className="cs-item" onClick={() => go(m)}>
                <span className="cs-head"><b>{nameOf(m)}</b>{m.at ? new Date(m.at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                <span className="cs-text">{plainOf(m).slice(0, 300)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A person's quick card in a room: their pixels, whether they are here, «Mensaje» opens your chat with them. */
export function PersonQuickCard({ person: p, anchor, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { box, place } = usePopover(anchor, onClose, { width: 300 });
  const message = async () => {
    setBusy(true); setError(null);
    try { const out = await post(`/peers/dm/${encodeURIComponent(p.address)}`); const id = out?.share?.id || out?.id; onClose(); if (id) navigate(`/con/${encodeURIComponent(id)}`); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  const role = p.role === "owner" ? "Creó la sala" : p.role === "guest" ? "Invitada" : null;
  return createPortal(
    <div ref={box} className="bc pc" role="dialog" aria-label={"Ficha de " + p.name} style={placeStyle(place)}>
      <div className="bc-banner"><PixelBanner color={familyInk(p.color || personTint(p.name))} seed={p.address || p.name} height={64} /><button type="button" className="bc-close" onClick={onClose} aria-label="Cerrar la ficha"><X size={16} /></button></div>
      <div className="bc-face pc-face"><PersonAvatar person={p} size={64} ring="var(--c-raised)" presence={p.you ? null : p.presence === "online" ? "online" : "offline"} /></div>
      <div className="bc-body">
        <div className="bc-name">{p.name}{p.you ? <span className="pc-you"> (tú)</span> : null}</div>
        <dl className="pc-facts">
          <div><dt>Estado</dt><dd><span className={"pc-dot" + (p.you || p.presence === "online" ? " is-on" : "")} aria-hidden="true" />{p.you || p.presence === "online" ? "Conectada" : "Desconectada"}</dd></div>
          {role ? <div><dt>Aquí</dt><dd>{role}</dd></div> : null}
        </dl>
        {p.you || !p.address ? null : <div className="pc-actions"><button type="button" className="ch-btn is-primary" disabled={busy} onClick={message}><ChatCircleText size={16} />{busy ? "Abriendo…" : "Mensaje"}</button></div>}
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * «Pedir a Nora» in a room: a message dragged onto one of your bots (or «Pedírselo a un bot…»).
 * `bots`: your bots in this room; `send(bot, text)` writes «@Nora …» in the room.
 */
export function AskBotHere({ roomKey, bots, send }) {
  const [ask, setAsk] = useState(null);
  useEffect(() => onAskBot((d) => { if (!d.message.channel && (!d.message.room || d.message.room === roomKey)) setAsk(d); }), [roomKey]);
  if (!ask) return null;
  return <AskBotSheet key={ask.message.id + (ask.botId || "")} botId={ask.botId ? String(ask.botId).replace(/^bot:/, "") : null} message={ask.message} bots={bots} send={send} onClose={() => setAsk(null)} />;
}

function AskBotSheet({ botId, message: m, bots, send, onClose }) {
  const store = useStore();
  const all = store.bots || [];
  const [chosen, setChosen] = useState(botId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const bot = chosen ? bots.find((b) => b.id === chosen) || null : null;
  const outside = chosen && !bot ? all.find((b) => b.id === chosen) : null;
  const go = async () => {
    if (!bot || busy) return;
    setBusy(true); setError(null);
    const quote = String(m.text || "").split("\n").map((l) => "> " + l).join("\n");
    try { await send(bot, (text.trim() || "Ocúpate de esto, por favor.") + "\n\n" + (m.author ? "> " + m.author + ":\n" : "") + quote); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="ch-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={bot ? "Pedir a " + bot.name : "Pedírselo a un bot"} className="ch-dialog" style={{ width: "460px" }}>
        <div className="ch-dialog-head"><h2 className="ch-dialog-title">{bot ? "Pedir a " + bot.name : outside ? "Pedir a " + outside.name : "Pedírselo a un bot"}</h2><button type="button" className="ch-iconbtn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="ch-dialog-body">
          <div className="ab">
            <blockquote className="ab-quote">{m.author ? <b>{m.author}</b> : null}<span>{String(m.text || "").slice(0, 280)}</span></blockquote>
            {!botId ? (
              <div className="ab-bots" role="group" aria-label="Elige un bot">
                {bots.map((b) => { const now = botNow(all.find((x) => x.id === b.id) || b); const tone = NOW_TONE[now.key]; return (
                  <button key={b.id} type="button" className={"ab-bot" + (chosen === b.id ? " is-on" : "")} aria-pressed={chosen === b.id} onClick={() => setChosen(b.id)}>
                    <BotFace bot={b} size={28} mood={now.mood} decorative alive /><span className="ab-bot-name">{b.name}</span><span style={{ fontSize: "var(--t-caption)", color: tone.ink }}>{now.word}</span>
                  </button>
                ); })}
              </div>
            ) : null}
            <label className="ab-label" htmlFor="ab-local">Qué quieres que haga</label>
            <textarea id="ab-local" className="ab-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ocúpate de esto, por favor." autoFocus={!!botId} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } }} />
            <p className="ab-note">{outside ? outside.name + " no está en esta sala: añádelo desde Miembros, o suéltalo en una sala donde esté." : bot ? bot.name + " lo verá aquí, con el mensaje citado." : "Elige el bot que quieres que se ocupe."}</p>
            {error ? <p className="ch-error" role="alert">{error}</p> : null}
          </div>
        </div>
        <div className="ch-dialog-foot"><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="button" className="ch-btn is-primary" onClick={go} disabled={!bot || busy}>{busy ? "Enviando…" : "Pedírselo"}</button></div>
      </div>
    </div>
  );
}
