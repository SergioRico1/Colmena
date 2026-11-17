// «Pedir a Nora»: a channel's message handed to a bot (dragged onto it in the sidebar, or from the
// message's menu). The bot is named in the message's thread with what you want, so it works there
// with the thread for context and everyone sees it (server/cloud/channel-bots.mjs).
import { useEffect, useState } from "react";
import { navigate } from "../lib/router.jsx";
import { chat } from "./api.js";
import { onAskBot } from "./askBot.js";
import "./botcard.css";
import { encode, plain } from "./format.jsx";
import { nameOf, useChat } from "./store.js";
import { Dialog, LiveBotFace, botNow, useLiveBot } from "./ui.jsx";

/** Mounted by the open conversation: shows the dialog when a message is handed to a bot. */
export function AskBotHost({ channel }) {
  const [ask, setAsk] = useState(null); // {botId, message}
  useEffect(() => onAskBot((d) => { if (d.message.channel) setAsk(d); }), []);
  if (!ask) return null;
  return <AskBotDialog key={ask.message.id + (ask.botId || "")} botId={ask.botId} message={ask.message} here={channel} onClose={() => setAsk(null)} />;
}

function BotChoice({ b, chosen, onPick }) {
  const now = botNow(useLiveBot(b.id));
  return (
    <button type="button" className={"ab-bot" + (chosen ? " is-on" : "")} aria-pressed={chosen} onClick={onPick}>
      <LiveBotFace id={b.id} size={28} />
      <span className="ab-bot-name">{b.name}</span>
      <span className={"cp-bot-now is-" + now.key}>{now.word}</span>
    </button>
  );
}

export function AskBotDialog({ botId, message: m, here, onClose }) {
  const s = useChat();
  const [bot, setBot] = useState(botId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const b = bot ? s.bots?.get(bot) : null;
  const guest = s.me?.role === "guest";
  const bots = [...(s.bots?.values() || [])].filter((x) => x.id !== "bot:colmena").sort((x, y) => x.name.localeCompare(y.name, "es"));
  const closed = b && Array.isArray(b.talkTo) && b.talkTo.length > 0 && !b.talkTo.includes(s.me?.id) && b.createdBy !== s.me?.id;
  const send = async () => {
    if (!b || busy) return;
    setBusy(true); setError(null);
    const want = text.trim() || "Ocúpate de esto, por favor.";
    const thread = m.threadId || m.id;
    try {
      await chat.post(`/channels/${m.channel}/messages`, { text: "<@" + b.id + "> " + encode(want), thread });
      onClose();
      navigate(`/canal/${m.channel}?hilo=${thread}`, { replace: m.channel === here });
    } catch (e) { setError(e.message); setBusy(false); }
  };
  // The words only: the marks of bold, italic and strike go (format.jsx).
  const quote = plain(m.text || "").replace(/(^|[\s(])([*_~])([^*_~\n]+)\2(?=[\s).,;:!?]|$)/g, "$1$3") || (m.files?.length ? m.files.join(", ") : "");
  return (
    <Dialog title={b ? "Pedir a " + b.name : "Pedírselo a un bot"} onClose={onClose} width={460}
      footer={<><button type="button" className="ch-btn" onClick={onClose}>Cancelar</button><button type="button" className="ch-btn is-primary" onClick={send} disabled={!b || busy || guest || closed}>{busy ? "Enviando…" : "Pedírselo"}</button></>}>
      <div className="ab">
        <blockquote className="ab-quote"><b>{nameOf(m.author, s)}</b><span>{quote.length > 280 ? quote.slice(0, 280) + "…" : quote}</span></blockquote>
        {!botId ? (
          <div className="ab-bots" role="group" aria-label="Elige un bot">
            {bots.map((x) => <BotChoice key={x.id} b={x} chosen={bot === x.id} onPick={() => setBot(x.id)} />)}
          </div>
        ) : null}
        <label className="ab-label" htmlFor="ab-text">Qué quieres que haga</label>
        <textarea id="ab-text" className="ab-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ocúpate de esto, por favor." autoFocus={!!botId}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
        <p className="ab-note">{guest ? "Como invitado no puedes pedir trabajo a los bots." : closed ? b.name + " no habla contigo: pídeselo a quien lo creó." : b ? b.name + " lo verá en el hilo del mensaje, y su respuesta también." : "Elige el bot que quieres que se ocupe."}</p>
        {error ? <p className="ch-error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}
