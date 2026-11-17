// A bot's card beside the conversation (a click on a bot's face, name or @mention in a channel):
// who it is, what it is doing right now, who may talk to it (its maker or an admin edits it),
// who is responsible for it, what it thinks with and how much of the plan is left, and a box to
// write to it without leaving the channel. Its banner is Colmena's pixels settling into the comb,
// in the bot's own colour (src/components/Hive.jsx).
import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Check, Flag, Hourglass, X } from "../components/Icon.js";
import BotFace from "../components/BotFace.jsx";
import { PixelBanner } from "../components/Hive.jsx";
import { useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { chat } from "./api.js";
import { nameOf, useChat } from "./store.js";
import { Avatar, botNow } from "./ui.jsx";
import { placeStyle, usePopover } from "./popover.js";
import "./botcard.css";

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");
const windowLabel = (min) => (!min ? "" : min >= 10000 ? "semana" : min >= 1440 ? Math.round(min / 1440) + " d" : Math.round(min / 60) + " h");

/** What it is doing now, in a line and its detail. */
function nowOf(live) {
  if (!live) return { line: "Libre", sub: "Esperando a que alguien le pida algo" };
  if (live.limited) return { line: "Esperando a que se renueve el plan", sub: (live.limited.label ? live.limited.label + " · " : "") + (live.limited.resumeAt || live.limited.resetsAt ? "vuelve a las " + hm(live.limited.resumeAt || live.limited.resetsAt) : "vuelve en cuanto se renueve"), wait: true };
  if (live.status === "pausado") return { line: "En pausa", sub: "No trabaja hasta que lo reanudes" };
  if (live.status === "espera") return { line: "Esperando una respuesta", sub: "Algo de su trabajo espera a una persona" };
  if (live.status === "trabaja" || live.busy) return { line: "Trabajando" + (live.activity?.verb ? " · " + live.activity.verb : ""), sub: live.activity?.detail || "En una conversación" };
  return { line: "Libre", sub: "Esperando a que alguien le pida algo" };
}

export default function BotCard({ id, anchor, onClose }) {
  const s = useChat();
  const store = useStore();
  const bot = s.bots?.get(id) || { id, botId: String(id).slice(4), name: "Bot" };
  const live = (store.bots || []).find((b) => b.id === bot.botId) || null;
  const me = s.me;
  const admin = ["owner", "admin"].includes(me?.role);
  const mayEdit = me?.role !== "guest" && (admin || bot.createdBy === me?.id);
  const talk = bot.talkTo || null;
  const youMay = !talk || talk.includes(me?.id) || bot.createdBy === me?.id;
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState(talk || []);
  const [everyone, setEveryone] = useState(!talk);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const { box, place } = usePopover(anchor, onClose, { again: editing });

  const saveTalk = async () => {
    setError(null);
    try { await chat.put(`/bots/${encodeURIComponent(bot.botId)}/talk`, { people: everyone ? [] : chosen }); setEditing(false); }
    catch (e) { setError(e.message); }
  };
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    try { await post("/missions", { prompt: t, mode: "solo", botIds: [bot.botId], conversation: true }); setText(""); setSent(true); }
    catch (e) { setError(e.message); }
  };

  const status = nowOf(live);
  const coordinator = bot.botId === "atlas" || /coordin/i.test(bot.role || bot.title || "");
  const plan = store.planLimits || null;
  const windows = ["primary", "secondary"].map((k) => plan?.[k]).filter((w) => w && Number.isFinite(w.usedPercent));
  const people = [...s.people.values()].filter((p) => !p.deactivated).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const online = !live?.limited && live?.status !== "pausado";

  return createPortal(
    <div ref={box} className="bc" role="dialog" aria-label={"Ficha de " + bot.name} style={placeStyle(place)}>
      <div className="bc-banner">
        <PixelBanner color={bot.color || "#7c8cff"} seed={bot.botId} height={84} />
        <button type="button" className="bc-close" onClick={onClose} aria-label="Cerrar la ficha"><X size={16} /></button>
      </div>
      <div className="bc-face">
        <BotFace bot={{ ...bot, id: bot.botId }} size={72} mood={botNow(live).mood} decorative alive />
        <span className={"bc-dot" + (online ? " is-on" : "")} aria-hidden="true" />
      </div>
      <div className="bc-body">
        <div className="bc-name">{bot.name}{live?.limited ? <span title="Esperando a que se renueve el plan" aria-label="Esperando al plan"> ⏳</span> : null}</div>
        <div className="bc-sub">{"@" + bot.botId + " · Bot" + (bot.title ? " · " + bot.title : "")}</div>
        {coordinator ? <span className="bc-chip"><Flag size={14} aria-hidden="true" /> Coordina el equipo</span> : null}

        <div className={"bc-now" + (status.wait ? " is-wait" : "")}>
          {status.wait ? <Hourglass size={18} aria-hidden="true" /> : <span className={"bc-pulse" + (live?.status === "trabaja" || live?.busy ? " is-on" : "")} aria-hidden="true" />}
          <span><b>{status.line}</b><small>{status.sub}</small></span>
        </div>

        <div className="bc-row">
          <span className="bc-label">Quién puede hablarle</span>
          {mayEdit && !editing ? <button type="button" className="bc-link" onClick={() => { setEditing(true); setChosen(talk || []); setEveryone(!talk); }}>Editar</button> : null}
        </div>
        {editing ? (
          <div className="bc-edit">
            <label className="bc-check"><input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> Todo el equipo</label>
            <label className="bc-check"><input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> Solo estas personas</label>
            {!everyone ? (
              <ul className="bc-people">
                {people.map((p) => (
                  <li key={p.id}><label className="bc-check"><input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} /><Avatar id={p.id} size={20} presence={false} />{p.name}{p.id === me?.id ? " (tú)" : ""}</label></li>
                ))}
              </ul>
            ) : null}
            <div className="bc-actions">
              <button type="button" className="ch-btn" onClick={() => setEditing(false)}>Cancelar</button>
              <button type="button" className="ch-btn is-primary" onClick={saveTalk} disabled={!everyone && !chosen.length}><Check size={14} /> Guardar</button>
            </div>
          </div>
        ) : (
          <div className="bc-who">{talk ? <><span className="bc-faces">{talk.slice(0, 4).map((p) => <Avatar key={p} id={p} size={20} presence={false} />)}</span>{talk.map((p) => nameOf(p, s)).join(", ")}</> : "Todo el equipo"}</div>
        )}

        <dl className="bc-facts">
          <div><dt>Responsable</dt><dd>{bot.createdBy ? nameOf(bot.createdBy, s) : "Colmena (viene con la empresa)"}</dd></div>
          <div><dt>Piensa con</dt><dd>{store.ai?.mine === false ? "Tu cuenta de IA · sin conectar" : "Tu cuenta de IA" + (live?.modelPin ? " · " + live.modelPin : "")}</dd></div>
        </dl>
        {windows.length ? (
          <div className="bc-plan" aria-label="Uso de tu plan">
            <span className="bc-plan-text">{windows.map((w) => windowLabel(w.windowMinutes) + " " + w.usedPercent + " %").join(" · ")}</span>
            <span className="bc-bars">{windows.map((w, i) => <span key={i} className={"bc-bar" + (w.usedPercent >= 90 ? " is-full" : "")}><span style={{ transform: `scaleX(${w.usedPercent / 100})` }} /></span>)}</span>
          </div>
        ) : null}
        {live?.limited ? <p className="bc-limit">{"En el límite" + (live.limited.resumeAt || live.limited.resetsAt ? " hasta las " + hm(live.limited.resumeAt || live.limited.resetsAt) : "")}</p> : null}

        {me?.role === "guest" ? null : youMay ? (
          sent ? (
            <p className="bc-sent">Enviado. <a href={"/chat/" + encodeURIComponent(bot.botId)} onClick={(e) => { e.preventDefault(); onClose(); navigate("/chat/" + encodeURIComponent(bot.botId)); }}>Abrir el chat con {bot.name}</a></p>
          ) : (
            <div className="bc-send">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder={"Mensaje para " + bot.name} aria-label={"Mensaje para " + bot.name} />
              <button type="button" onClick={send} disabled={!text.trim()} aria-label="Enviar"><ArrowUp size={16} weight="bold" /></button>
            </div>
          )
        ) : <p className="bc-note">{bot.name} no habla contigo: pídeselo a quien lo creó.</p>}
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
        <a className="bc-more" href={"/equipo/" + encodeURIComponent(bot.botId)} onClick={(e) => { e.preventDefault(); onClose(); navigate("/equipo/" + encodeURIComponent(bot.botId)); }}>Ver su página completa</a>
      </div>
    </div>,
    document.body,
  );
}
