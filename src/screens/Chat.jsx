import { freshness } from "../lib/motion.js";
import { VenetianMask, FileDown, FileText, FolderOpen, MessageCircleQuestion, ArrowUp, PanelLeftClose, PanelLeftOpen, SquarePen, Bookmark, BookmarkCheck, Brain, Check, ChevronDown, ChevronUp, Copy, Ellipsis, Plus, RotateCcw, Square, UserPlus, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useFileDrop, dropOverlay } from "../lib/useFileDrop.js";
import { useFollow } from "../lib/useStickToBottom.js";
import { saveDraft, useDraft, useInputHistory } from "../lib/composer.js";
import LiveMarkdown, { markLive, wasLive } from "../components/room/LiveMarkdown.jsx";
import { useSlowPhase, verbLabel } from "../components/room/working.js";
import BrowserLive from "../components/computer/BrowserLive.jsx";
import { css } from "../design/css/Chat.js";
import Sidebar from "../components/Sidebar.jsx";
import { failSent, prefetch, showSent, unshowSent, useAction, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { patch, pickFiles, post } from "../lib/api.js";
import { dateTime, plural, shortDate } from "../lib/format.js";
import { BotAvatar, ErrorLine, FileCard, StateCard, UserAvatar, copyText, dayLabel, findBot, popoverItem, popoverStyle, roomCss, useDismiss } from "../components/room/common.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { useMentions } from "../components/room/Mentions.jsx";
import Markdown, { plain } from "../components/room/Markdown.jsx";
import ActivityLog from "../components/room/ActivityLog.jsx";
import { useCountdown } from "../components/room/Dots.jsx";
import DeliverableCard from "../components/room/DeliverableCard.jsx";
import QuestionCard from "../components/room/QuestionCard.jsx";
import ArtifactPanel from "../components/room/ArtifactPanel.jsx";
import SecretPrompt, { SecretLine } from "../components/room/SecretPrompt.jsx";
import Sources from "../components/room/Sources.jsx";
import { exportConversation } from "../lib/exportConversation.jsx";
import InlineApprovals, { ExpiryChip } from "../components/room/InlineApprovals.jsx";
import SideDock from "../components/room/SideDock.jsx";
import PastedCard from "../components/room/PastedCard.jsx";
import PositionRail, { railItems } from "../components/room/PositionRail.jsx";
import FilesPanel, { FileView, fileIcon } from "../components/room/FilesPanel.jsx";
import { comboLabel, useDock, usePanelShortcuts } from "../lib/useDock.js";
import { useRevealMessage } from "../lib/reveal.js";
import { BlockerBand, DaySeparator, FailedLine, NewBelow, OlderMessages, StuckBand, Suggestions } from "../components/room/RoomParts.jsx";
import MessageQueue, { useConversationQueue } from "../components/room/MessageQueue.jsx";
import AsidePanel, { askAsideAbout } from "../components/room/AsidePanel.jsx";
import SelectionPopup, { asQuote, quoteInto, UserText } from "../components/room/SelectionPopup.jsx";
import { ListenButton, MicButton, appendDictation } from "../components/interaction/Voice.jsx";

// Chat 1:1 — design/Chat.dc.html. A conversation is a mission with conversation:true and mode 'solo'.

const THINKING = [
  { id: "rapido", label: "Rápido", hint: "Responde enseguida, sin darle muchas vueltas" },
  { id: "equilibrado", label: "Equilibrado", hint: "Piensa lo justo para la mayoría de tareas" },
  { id: "profundo", label: "Profundo", hint: "Se toma su tiempo con lo difícil" },
];
const TOOL_NAMES = { correo: "Correo", calendario: "Calendario", carpeta: "Carpeta compartida", hojas: "Hojas de cálculo", chat: "Chat", erp: "ERP" };

function toolsLabel(bot, folders, connectors) {
  const names = [
    ...folders.filter((f) => (f.botIds || []).includes(bot.id)).map((f) => f.label || f.path),
    ...Object.entries(bot.tools || {})
      .filter(([, access]) => access && access !== "none")
      .map(([key]) => connectors.find((c) => c.id === key)?.name || TOOL_NAMES[key] || key),
  ].filter((v, i, all) => v && all.indexOf(v) === i);
  if (!names.length) return "Sin herramientas";
  return names.length > 3 ? `${names.slice(0, 2).join(", ")} y ${names.length - 2} más` : names.join(", ");
}

const ICON_BTN = { width: "34px", height: "34px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "inherit" };
const HEADER_BTN = { display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" };

function BotHead({ bot, at }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <BotAvatar bot={bot} size={28} />
      <strong style={{ fontSize: "15px" }}>{bot.name}</strong>
      {at ? <span style={{ fontSize: "12px", color: "#555A68" }}>{new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span> : null}
    </div>
  );
}

// Answer actions show on hover/focus (as in the rooms); the latest answer keeps them in view.
const CHAT_CSS = `
.chat-actions{opacity:0;transition:opacity .12s ease}
.chat-answer:hover .chat-actions,.chat-answer:focus-within .chat-actions,.chat-actions[data-pinned]{opacity:1}
.chat-actions button:hover{background:#EEF0F4 !important}
.chat-mine{background:#F4F5F8;border-radius:14px}
@media (hover:none){.chat-actions{opacity:1}}
`;

/** Copiar / Escuchar / Rehacer / Guardar en la memoria under each answer. */
function AnswerActions({ bot, message, onRetry, retryBusy, pinned = false }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const memory = useAction();
  const copy = async () => {
    await copyText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const remember = () =>
    memory.act(async () => {
      await post("/memories", { text: String(message.text || "").slice(0, 2000), botId: bot.id, scope: "bot" });
      setSaved(true);
    });
  return (
    <div className="chat-actions" {...(pinned || saved || copied ? { "data-pinned": "" } : {})} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px", marginTop: "-6px", color: "#555A68" }}>
      <button type="button" className="rm-focus" aria-label={copied ? "Respuesta copiada" : "Copiar respuesta"} title={copied ? "Copiada" : "Copiar"} onClick={copy} style={ICON_BTN}>
        {copied ? <span className="c-ok"><Check size={16} strokeWidth={2.6} color="#0B6B4A" aria-hidden="true" /></span> : <Copy size={16} strokeWidth={2} aria-hidden="true" />}
      </button>
      <ListenButton text={message.text} bot={bot} compact />
      {onRetry ? (
        <button type="button" className="rm-focus" aria-label="Rehacer respuesta" title="Rehacer" disabled={retryBusy} onClick={onRetry} style={ICON_BTN}>
          <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
      <button type="button" className="rm-focus" aria-label={saved ? `Guardada en la memoria de ${bot.name}` : `Guardar en la memoria de ${bot.name}`} title={saved ? "Guardada en la memoria" : "Guardar en la memoria"} disabled={memory.busy || saved} onClick={remember} style={ICON_BTN}>
        {saved ? <BookmarkCheck size={16} strokeWidth={2} aria-hidden="true" /> : <Bookmark size={16} strokeWidth={2} aria-hidden="true" />}
      </button>
      {saved ? <span style={{ fontSize: "12px", color: "#0B6B4A", paddingLeft: "4px" }}>{`En la memoria de ${bot.name}`}</span> : null}
      <ErrorLine style={{ paddingLeft: "6px" }}>{memory.error}</ErrorLine>
    </div>
  );
}

/** «Incógnito · se borra mañana a las 9:12»: what this private chat keeps (nothing). */
function IncognitoBand({ mission, bot }) {
  const end = mission.expiresAt ? new Date(mission.expiresAt) : null;
  const hours = end ? Math.max(0, Math.round((end - Date.now()) / 3600000)) : null;
  const at = end ? end.toLocaleString("es-ES", { weekday: "long", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div role="note" className="c-band" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px clamp(16px, 3vw, 32px)", background: "#12131A", color: "#FFFFFF", fontSize: "13px" }}>
      <VenetianMask size={16} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: "#FFC93C" }} />
      <span><strong>{"Incógnito. "}</strong>{`${bot?.name || "El bot"} no guarda nada de esta conversación en su memoria y se borra${end ? ` el ${at}${hours != null ? ` (en ${hours} h)` : ""}` : " en 24 horas"}, sin dejar copia.`}</span>
    </div>
  );
}

// Conversations of this bot by when they last moved: Hoy, Ayer, Últimos 7 días, Antes.
function bucketOf(at, now = new Date()) {
  const d = new Date(at || 0);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  return diff <= 0 ? "Hoy" : diff === 1 ? "Ayer" : diff < 7 ? "Últimos 7 días" : "Antes";
}

/** Left column: every conversation with this bot, newest first, and «Nueva» on top. */
function ChatHistory({ bot, botId, conversations, current }) {
  const groups = [];
  for (const m of conversations) {
    const label = bucketOf(m.updatedAt || m.createdAt);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(m);
  }
  return (
    <nav aria-label={`Conversaciones con ${bot?.name || ""}`} className="chat-history" style={{ flex: "0 0 260px", width: "260px", borderRight: "1px solid #E6E8EE", background: "#FFFFFF", display: "flex", flexDirection: "column", position: "sticky", top: 0, alignSelf: "flex-start", maxHeight: "calc(100vh - 73px)", overflowY: "auto" }}>
      <div style={{ padding: "14px 12px 6px" }}>
        <a href={`/chat/${botId}`} className="rm-item" style={{ display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 10px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", color: "#12131A", background: current ? "transparent" : "#FFF4D1" }}>
          <SquarePen size={16} strokeWidth={2} aria-hidden="true" />{"Nueva conversación"}
        </a>
      </div>
      {!conversations.length ? <p style={{ margin: "8px 22px", fontSize: "13px", lineHeight: "1.5", color: "#555A68" }}>{`Aquí verás tus conversaciones con ${bot?.name || "este bot"}.`}</p> : null}
      {groups.map((g) => (
        <div key={g.label} style={{ display: "flex", flexDirection: "column", padding: "6px 12px" }}>
          <span style={{ padding: "8px 10px 4px", font: "500 11px/1.2 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{g.label}</span>
          {g.items.map((m) => {
            const on = m.id === current;
            const busy = ["running", "queued", "planning"].includes(m.status);
            const waits = ["waiting", "awaiting_plan"].includes(m.status);
            return (
              <a key={m.id} href={`/chat/${botId}?c=${m.id}`} aria-current={on ? "page" : undefined} title={m.title || m.prompt} onMouseEnter={() => prefetch(`/missions/${m.id}`)} onFocus={() => prefetch(`/missions/${m.id}`)}
                className="rm-item" style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "36px", padding: "0 10px", borderRadius: "9px", fontSize: "14px", color: "#12131A", background: on ? "#EEF0F4" : "transparent", fontWeight: on ? "600" : "400" }}>
                {m.incognito ? <VenetianMask size={14} strokeWidth={2} aria-label="De incógnito" style={{ flex: "none", color: "#555A68" }} /> : null}
                <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title || m.prompt || "Conversación"}</span>
                {busy ? <span aria-label="Trabajando" style={{ width: "7px", height: "7px", flex: "none", borderRadius: "50%", background: "#0B8A5F" }} /> : waits ? <span aria-label="Te espera" style={{ width: "7px", height: "7px", flex: "none", borderRadius: "2px", background: "#FFC93C" }} /> : null}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * One live line while a bot works: what it is doing now and how many steps so far (unfold it
 * for the steps); during a retry, «Reintentando en 4 s (2/3)».
 */
function LiveLine({ step, now, fallback, bots, onOpenArtifact }) {
  const retry = step?.retrying;
  const left = useCountdown(retry ? Date.parse(retry.at) + (retry.wait || 0) : null);
  // «Preparando el contexto» / «Esperando al modelo» only when they last; else the dots.
  const phase = useSlowPhase(now?.verb || null);
  const status = retry
    ? (left ? `Reintentando en ${left} s` : "Reintentando") + (retry.attempt ? ` (${retry.attempt}/${retry.max})` : "")
    : now ? verbLabel(phase) + (now.detail ? " · " + now.detail : "") : fallback || "Pensando";
  return <ActivityLog activity={step?.activity || []} tools={step?.tools || []} bots={bots} running status={status} startedAt={step?.startedAt} narration={retry ? null : step?.narration?.text} seed={step?.id} onOpenArtifact={onOpenArtifact} />;
}

function stepFor(message, steps) {
  if (message.stepId) return steps.find((s) => s.id === message.stepId) || null;
  const at = Date.parse(message.at || 0);
  const own = steps.filter((s) => s.botId === message.botId && (!s.startedAt || Date.parse(s.startedAt) <= at + 1000));
  return own[own.length - 1] || null;
}

// «Ideas para empezar» in a new chat, by what the bot does (its role), in plain words.
const STARTERS = [
  [/coordin/i, ["Organiza mi semana con lo que tengo pendiente", "Reparte este encargo entre el equipo y dime quién hace qué", "Resume en qué está trabajando cada bot"]],
  [/investig|research/i, ["Busca qué ha cambiado esta semana en mi sector", "Compara tres opciones y dime cuál elegirías y por qué", "Resume este documento y dime lo importante"]],
  [/dato|finanz|contab/i, ["Revisa este Excel y dime qué no cuadra", "Calcula cuánto gastamos al mes en proveedores", "Prepara una tabla con la previsión del trimestre"]],
  [/dise/i, ["Propón tres ideas de portada para la campaña", "Dibuja un esquema del proceso en SVG", "Revisa este diseño y dime qué mejorarías"]],
  [/redac|comunic|escrit/i, ["Redacta un correo para un cliente que se retrasa en el pago", "Mejora este texto para que suene más cercano", "Resume esta reunión en cinco puntos"]],
  [/c[oó]dig|program|desarroll/i, ["Revisa este script y dime si tiene errores", "Automatiza esta tarea repetitiva con un script", "Explícame qué hace este código en palabras sencillas"]],
  [/legal|contrat/i, ["Revisa este contrato y dime qué cláusulas vigilar", "Avísame de las renovaciones de los próximos meses", "Compara esta oferta con el contrato actual"]],
];
function startersFor(bot) {
  const text = `${bot?.role || ""} ${bot?.instructions || ""}`;
  return (STARTERS.find(([re]) => re.test(text))?.[1]) || ["Ayúdame con una tarea de hoy", "Resume este documento", "Prepara un borrador para revisarlo juntos"];
}

export default function Chat({ params, query }) {
  const botId = params.bot;
  const { bots, missions, folders, connectors, ready, run } = useStore();
  const bot = findBot(bots, botId);
  const known = bots.some((b) => b.id === botId);
  const c = query?.c || null;
  const room = useRoom(c);
  const follow = useFollow(c || botId);
  const { mission, messages, steps, artifacts, approvals, pending, live, activity } = room;

  const conversations = useMemo(
    () => missions
      .filter((m) => (m.conversation || m.mode === "solo") && m.botIds?.[0] === botId)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)),
    [missions, botId],
  );

  // The side panel of this conversation: deliverables, files (each in its own tab).
  const dock = useDock(c ? "chat:" + c : null);
  const activeTab = dock.open ? dock.tabs.find((t) => t.id === dock.active) : null;
  const panelId = activeTab?.kind === "doc" ? activeTab.artifactId : null;
  const openDoc = (id) => dock.open({ id: "doc:" + id, kind: "doc", artifactId: id });
  const toggleDoc = (id) => (dock.isVisible("doc:" + id) ? dock.close("doc:" + id) : openDoc(id));
  const [convOpen, setConvOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const [draftMembers, setDraftMembers] = useState([]);
  const [text, setText] = useState("");
  const [launched, setLaunched] = useState(0);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const send = useAction();
  const members = useAction();
  const thinking = useAction();
  const control = useAction();
  // The history column: open by default on wide windows; your choice is remembered.
  const [historyOpen, setHistoryOpen] = useState(() => {
    try { const v = localStorage.getItem("colmena:chat-history"); if (v) return v === "1"; } catch {}
    return typeof window !== "undefined" && window.innerWidth >= 1200;
  });
  const toggleHistory = () => setHistoryOpen((v) => { try { localStorage.setItem("colmena:chat-history", v ? "0" : "1"); } catch {} return !v; });
  const inputRef = useRef(null);
  const convRef = useDismiss(convOpen, () => setConvOpen(false));
  const addRef = useDismiss(addOpen, () => setAddOpen(false));
  const thinkRef = useDismiss(thinkOpen, () => setThinkOpen(false));

  // Reset per-conversation view state when switching conversation or bot.
  useEffect(() => {
    setDraftMembers([]);
    setConvOpen(false);
  }, [c, botId]);

  const memberIds = c ? (mission?.botIds || [botId]) : [botId, ...draftMembers];
  const others = bots.filter((b) => b.enabled !== false && !memberIds.includes(b.id));
  const mentions = useMentions({ value: text, setValue: setText, bots: bots.filter((b) => b.enabled !== false && b.id !== botId), inputRef });

  // What you were writing here comes back; ↑ brings back what you sent before.
  // Incognito (OpenClaw): chosen before the first message; nothing of it is saved here.
  const [incognito, setIncognito] = useState(false);
  useEffect(() => { setIncognito(false); }, [c, botId]);
  const privateChat = c ? !!mission?.incognito : incognito;
  useDraft(privateChat ? null : "chat:" + (c || botId), text, setText);
  const toggleIncognito = () => setIncognito((v) => { if (!v) saveDraft("chat:" + botId, ""); return !v; });
  const historyKey = useInputHistory(messages, text, setText);
  markLive(live.map((l) => l.stepId));

  const mentionedIds = (body) => bots.filter((b) => b.id !== botId && new RegExp(`(^|\\s)@${b.name}(?![\\p{L}\\d])`, "u").test(body)).map((b) => b.id);

  // Visible queue: while the bot is in its turn you keep writing; each message goes out when the turn ends.
  const turn = !!c && !!mission && (["running", "planning", "queued"].includes(mission.status) || live.length > 0);
  const queue = useConversationQueue({
    key: c,
    working: turn,
    send: async (body) => {
      for (const extra of mentionedIds(body).filter((id) => !memberIds.includes(id))) await post(`/missions/${c}/members`, { botId: extra });
      await run(() => post(`/missions/${c}/messages`, { text: body }));
    },
  });
  const stopTurn = () => {
    queue.pause();
    control.act(() => post(`/missions/${c}/control`, { action: "pause" }));
  };
  const resumeMission = () => control.act(() => post(`/missions/${c}/control`, { action: "resume" }));

  // Shown at once and the box is free again; the saved message replaces it when it arrives.
  // If it fails it stays, marked «No se envió», with Reintentar (attachments go back to the box).
  const deliver = async (body, sent = [], mode = null) => {
    const path = `/missions/${c}`;
    const temp = showSent(path, body, sent);
    follow.toEnd();
    try {
      for (const extra of mentionedIds(body).filter((id) => !memberIds.includes(id))) await post(`/missions/${c}/members`, { botId: extra });
      await post(`/missions/${c}/messages`, { text: body, ...(sent.length ? { attachments: sent } : {}), ...(mode ? { mode } : {}) });
    } catch (error) {
      if (sent.length) {
        unshowSent(path, temp);
        setText(body);
        setFiles(sent);
        throw error;
      }
      failSent(path, temp, error.message);
    }
  };
  const resend = (m) => {
    unshowSent(`/missions/${c}`, m.id);
    send.act(() => deliver(m.text));
  };
  // Enter while it works: in the queue. Ctrl+Enter: said now, it reads it at its next step.
  const submit = (e, { now: sayNow = false } = {}) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || (send.busy && !c)) return;
    setLaunched((n) => n + 1);
    // While the previous one is still going out, this one waits its turn (never dropped).
    if (c && !files.length && !sayNow && (turn || send.busy || queue.pending.length || queue.running)) {
      queue.enqueue(body);
      setText("");
      return;
    }
    send.act(async () => {
      if (!c) {
        const created = await post("/missions", { prompt: body, mode: "solo", botIds: [botId], conversation: true, attachments: files, ...(incognito ? { incognito: true } : {}) });
        for (const extra of [...new Set([...draftMembers, ...mentionedIds(body)])]) await post(`/missions/${created.id}/members`, { botId: extra });
        setText("");
        setFiles([]);
        navigate(`/chat/${botId}?c=${created.id}`, { replace: true });
        return;
      }
      const sent = files;
      setText("");
      setFiles([]);
      await deliver(body, sent, sayNow && turn ? "steer" : null);
    });
  };
  const retry = (userText) => send.act(() => post(`/missions/${c}/messages`, { text: userText }));
  const addFiles = useCallback((picked) => { setFileError(null); setFiles((prev) => [...prev, ...picked].slice(0, 5)); }, []);
  const drop = useFileDrop(addFiles, setFileError, { pasteCards: true });
  const inlinePasted = (i) => {
    const f = files[i];
    setFiles(files.filter((_, j) => j !== i));
    setText((t) => (t.trim() ? t.replace(/\s*$/, "\n\n") : "") + f.content);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const attach = async () => {
    setFileError(null);
    try {
      const picked = await pickFiles();
      setFiles((prev) => [...prev, ...picked].slice(0, 5));
    } catch (err) {
      setFileError(err.message);
    }
  };
  const addMember = (id) => {
    setAddOpen(false);
    if (!c) return setDraftMembers((prev) => [...prev, id]);
    members.act(() => post(`/missions/${c}/members`, { botId: id }));
  };
  const setThinking = (value) => {
    setThinkOpen(false);
    thinking.act(() => patch(`/bots/${botId}`, { thinking: value }));
  };
  const suggestions = c && !text.trim() && !turn ? mission?.suggestions || [] : [];
  const pickSuggestion = (t) => {
    setText(t);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const onKeyDown = (e) => {
    if (mentions.handleKey(e)) return;
    if (historyKey(e)) return;
    if (e.key === "Tab" && !e.shiftKey && !text && suggestions.length) {
      e.preventDefault();
      pickSuggestion(suggestions[0]);
      return;
    }
    // Esc in an empty box stops the bot (OpenClaw); what you wrote is never lost.
    if (e.key === "Escape" && turn && !text.trim()) {
      e.preventDefault();
      stopTurn();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (e.repeat) return; // holding Enter never sends twice
      submit(e, { now: e.ctrlKey || e.metaKey });
    }
  };

  const headPhase = useSlowPhase(activity.find((a) => a.botId)?.verb || null);
  const FILES_TAB = { id: "archivos", kind: "archivos" };
  const ASIDE_TAB = { id: "aparte", kind: "aparte" };
  usePanelShortcuts([{ combo: "mod+shift+b", run: () => dock.toggle(FILES_TAB) }, { combo: "mod+shift+s", run: () => dock.toggle(ASIDE_TAB) }], !!c);
  // «Citar» from the selection toolbar: the passage goes into the box as a quote.
  useEffect(() => {
    const onQuote = (e) => {
      if (!c || e.detail?.missionId !== c) return;
      setText((t) => asQuote(e.detail.text) + t);
      requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    };
    window.addEventListener("colmena:quote", onQuote);
    return () => window.removeEventListener("colmena:quote", onQuote);
  }, [c]);
  const scope = useRef(null);
  const scroller = useRef(null);
  useRevealMessage(query?.m || null, { ready: !!c && !room.loading && !!mission, olderCount: room.olderCount, showOlder: room.showOlder });
  const workVersion = steps.reduce((n, s) => n + (s.activity?.length || 0), 0) + artifacts.length + messages.length;
  const dockTabs = dock.tabs.map((t) => {
    if (t.kind === "doc") {
      const a = artifacts.find((x) => x.id === t.artifactId);
      return { ...t, label: a?.title || "Entregable", icon: <FileText size={15} strokeWidth={2.2} aria-hidden="true" />, render: () => <ArtifactPanel bare artifactId={t.artifactId} bots={bots} variant="chat" /> };
    }
    if (t.kind === "aparte") return { ...t, label: "Preguntar aparte", icon: <MessageCircleQuestion size={15} strokeWidth={2.2} aria-hidden="true" />, title: "Preguntar aparte, sin interrumpir · " + comboLabel("mod+shift+s"), render: () => (mission ? <AsidePanel mission={mission} /> : null) };
    if (t.kind === "archivos") return { ...t, label: "Archivos", icon: <FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />, title: "Archivos · " + comboLabel("mod+shift+b"), render: () => <FilesPanel missionId={c} version={workVersion} onOpen={(f) => dock.open({ id: "file:" + f.path, kind: "file", path: f.path, name: f.name, type: f.type })} /> };
    if (t.kind === "file") return { ...t, label: t.name || t.path, icon: fileIcon(t.type), title: t.path, render: () => <FileView missionId={c} path={t.path} /> };
    return null;
  }).filter(Boolean);
  const dockAddable = [
    { key: "aparte", label: "Preguntar aparte", icon: <MessageCircleQuestion size={15} strokeWidth={2.2} aria-hidden="true" />, combo: "mod+shift+s", tab: ASIDE_TAB },
    { key: "archivos", label: "Archivos", icon: <FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />, combo: "mod+shift+b", tab: FILES_TAB },
  ].filter((a) => !dock.tabs.some((t) => t.id === a.tab.id));
  if (ready && !known) {
    return (
      <>
        <style>{css + roomCss}</style>
        <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#F7F8FA" }}>
          <Sidebar variant="compact" activeBot={botId} />
          <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column" }}>
            <StateCard tone="error" title="Este bot no está en tu equipo" text="Puede que lo hayas retirado o que el enlace no sea correcto." href="/equipo" cta="Ver tu equipo" />
          </main>
        </div>
      </>
    );
  }

  const title = c ? (mission?.title || mission?.prompt || "Conversación") : "Nueva conversación";
  const thinkingLabel = (THINKING.find((t) => t.id === bot?.thinking) || THINKING[1]).label;
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant" && messages[i].text && !["question", "activity", "deliverable"].includes(messages[i].kind)) return i;
    return -1;
  })();
  const lastMessage = messages[messages.length - 1];
  const working = mission && ["running", "planning", "queued"].includes(mission.status);
  const awaitingReply = working && !live.length && (!lastMessage || lastMessage.role === "user");
  const now = activity.find((a) => a.botId) || null;
  const runningStep = steps.find((s) => s.status === "running") || null;
  const extraMembers = memberIds.filter((id) => id !== botId).map((id) => findBot(bots, id));
  const tools = bot ? toolsLabel(bot, folders, connectors) : "";
  const firstUserIndex = messages.findIndex((m) => m.role === "user");
  // Messages that arrive while you look rise in; the history already there does not move.
  const isNew = freshness("chat:" + (c || botId), messages.map((m) => m.id));

  return (
    <InteractiveContext.Provider value={{ send: c ? (text) => post(`/missions/${c}/messages`, { text }) : null }}>
      <style>{css + roomCss + CHAT_CSS}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#F7F8FA" }}>
        <Sidebar variant="compact" activeBot={botId} />
        <main className="colmena-chat" style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column" }}>
          <header style={{ minHeight: "72px", padding: "12px clamp(16px, 3vw, 32px)", background: "#FFFFFF", borderBottom: "1px solid #DCE0E8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "0" }}>
              <button type="button" className="rm-focus chat-history-toggle" onClick={toggleHistory} aria-pressed={historyOpen ? "true" : "false"} aria-label={historyOpen ? "Ocultar el historial" : "Ver el historial de conversaciones"} title={historyOpen ? "Ocultar el historial" : "Historial de conversaciones"}
                style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", background: historyOpen ? "#EEF0F4" : "transparent", border: "0", borderRadius: "9px", cursor: "pointer", color: "#4A4F5C" }}>
                {historyOpen ? <PanelLeftClose size={18} strokeWidth={2} aria-hidden="true" /> : <PanelLeftOpen size={18} strokeWidth={2} aria-hidden="true" />}
              </button>
              <BotAvatar bot={bot} size={40} />
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h1 style={{ margin: "0", font: "700 20px/1 'Bricolage Grotesque', sans-serif" }}>{bot?.name}</h1>
                  <span style={{ fontSize: "13px", color: "#555A68" }}>{bot?.role}</span>
                </div>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, fontSize: "13px", color: "#2B2D36" }}>
                  <span aria-hidden="true" style={{ width: "7px", height: "7px", flex: "none", borderRadius: "50%", background: turn ? "#0B8A5F" : pending.length ? "#FFC93C" : "#C9CCD6", ...(turn ? { boxShadow: "0 0 0 3px #D6F0E4" } : {}) }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "min(46vw, 460px)" }}>
                    {turn ? (runningStep?.narration?.text || (now?.verb ? verbLabel(headPhase) + (now.detail ? " · " + now.detail : "") : "Trabajando")) : pending.length ? "Te espera" : c ? title : "Disponible"}
                  </span>
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              {c && mission ? (
                <button type="button" className="rm-focus" aria-pressed={dock.isVisible("aparte") ? "true" : "false"} title={"Pregunta sin interrumpir · " + comboLabel("mod+shift+s")} onClick={() => dock.toggle(ASIDE_TAB)}
                  style={{ ...HEADER_BTN, ...(dock.isVisible("aparte") ? { background: "#12131A", color: "#FFFFFF", borderColor: "#12131A" } : {}) }}>
                  <MessageCircleQuestion size={16} strokeWidth={2.2} aria-hidden="true" />{"Preguntar aparte"}
                </button>
              ) : null}
              {extraMembers.length ? (
                <span title={"También en la conversación: " + extraMembers.map((b) => b.name).join(", ")} style={{ display: "flex", alignItems: "center", paddingRight: "4px" }}>
                  {extraMembers.slice(0, 3).map((b, i) => <BotAvatar key={b.id} bot={b} size={24} ring={i > 0} style={i > 0 ? { marginLeft: "-6px" } : undefined} />)}
                </span>
              ) : null}
              {c ? (
                <button type="button" className="rm-focus" aria-pressed={dock.isVisible("archivos") ? "true" : "false"} title={"Archivos de la conversación · " + comboLabel("mod+shift+b")} onClick={() => dock.toggle(FILES_TAB)}
                  style={{ ...HEADER_BTN, ...(dock.isVisible("archivos") ? { background: "#12131A", color: "#FFFFFF", borderColor: "#12131A" } : {}) }}>
                  <FolderOpen size={16} strokeWidth={2.2} aria-hidden="true" />{"Archivos"}
                </button>
              ) : null}
              {c && !dock.open && dock.tabs.length ? <button type="button" className="rm-focus" onClick={() => dock.setOpen(true)} title="Volver a mostrar el panel lateral" style={HEADER_BTN}>{`Panel · ${dock.tabs.length}`}</button> : null}
              <button type="button" className="rm-focus" onClick={() => navigate(`/chat/${botId}`)} style={HEADER_BTN}>
                <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
                {"Nueva conversación"}
              </button>
              <span ref={addRef} style={{ position: "relative", display: "flex" }}>
                <button type="button" className="rm-focus" aria-haspopup="menu" aria-expanded={addOpen ? "true" : "false"} aria-label="Más opciones" title="Más opciones" disabled={members.busy} onClick={() => setAddOpen(!addOpen)} style={{ ...HEADER_BTN, width: "40px", padding: "0", justifyContent: "center" }}>
                  <Ellipsis size={18} strokeWidth={2.2} aria-hidden="true" />
                </button>
                {addOpen ? (
                  <div role="menu" aria-label="Opciones de la conversación" style={{ ...popoverStyle, right: "0", top: "calc(100% + 6px)", minWidth: "260px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px 4px", font: "500 11px/1.2 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}><UserPlus size={13} strokeWidth={2.2} aria-hidden="true" />{"Añadir a la conversación"}</span>
                    {others.length === 0 ? <p style={{ margin: "0", padding: "6px 10px 10px", fontSize: "14px", color: "#555A68" }}>{"Todo tu equipo ya está en la conversación."}</p> : null}
                    {others.map((b) => (
                      <button key={b.id} type="button" role="menuitem" className="rm-item" onClick={() => addMember(b.id)} style={popoverItem}>
                        <BotAvatar bot={b} size={24} />
                        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <strong style={{ fontSize: "14px" }}>{b.name}</strong>
                          <span style={{ fontSize: "12px", color: "#555A68" }}>{b.role}</span>
                        </span>
                      </button>
                    ))}
                    {c ? (
                      <>
                        <div role="separator" style={{ height: "1px", margin: "6px 4px", background: "#E6E8EE" }} />
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px 4px", font: "500 11px/1.2 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}><FileDown size={13} strokeWidth={2.2} aria-hidden="true" />{"Exportar la conversación"}</span>
                        {[["word", "Documento de Word", ".doc"], ["markdown", "Markdown", ".md"], ["copy", "Copiar como Markdown", ""]].map(([format, label, hint]) => (
                          <button key={format} type="button" role="menuitem" className="rm-item" onClick={() => { setAddOpen(false); exportConversation(c, format, { bots }).catch(() => {}); }} style={{ ...popoverItem, justifyContent: "space-between" }}>
                            <span style={{ fontSize: "14px" }}>{label}</span>{hint ? <span style={{ font: "500 11px/1 'Geist Mono', monospace", color: "#555A68" }}>{hint}</span> : null}
                          </button>
                        ))}
                      </>
                    ) : null}
                    <div role="separator" style={{ height: "1px", margin: "6px 4px", background: "#E6E8EE" }} />
                    <a role="menuitem" href={`/equipo/${botId}`} className="rm-item" onClick={() => setAddOpen(false)} style={{ ...popoverItem, color: "#12131A" }}>
                      <UserRound size={16} strokeWidth={2} aria-hidden="true" />
                      <span style={{ fontSize: "14px" }}>{`Ver el perfil de ${bot?.name || "este bot"}`}</span>
                    </a>
                  </div>
                ) : null}
              </span>
            </div>
            {members.error ? <ErrorLine style={{ flexBasis: "100%" }}>{members.error}</ErrorLine> : null}
          </header>
          {c && mission?.incognito ? <IncognitoBand mission={mission} bot={bot} /> : null}
          {c && mission ? <BlockerBand mission={mission} pending={pending.filter((a) => !messages.some((m) => m.approvalId === a.id))} bots={bots} /> : null}
          {c && mission ? <StuckBand mission={mission} bots={bots} /> : null}
          <div className="colmena-chat-body" style={{ flex: "1", display: "flex", alignItems: "stretch", minHeight: 0 }}>
            {historyOpen ? <ChatHistory bot={bot} botId={botId} conversations={conversations} current={c} /> : null}
            <section ref={(el) => { follow.ref(el); scroller.current = el; }} aria-label={`Conversación con ${bot?.name || ""}`} style={{ flex: "999 1 480px", minWidth: "0", display: "flex", flexDirection: "column" }}>
              <div ref={scope} style={{ flex: "1", width: "100%", maxWidth: "760px", margin: "0 auto", padding: "36px clamp(16px, 3vw, 32px) 24px", display: "flex", flexDirection: "column", gap: "30px" }}>
                {c ? <SelectionPopup scope={scope} onQuote={(t) => quoteInto(c, t)} onAsk={(t) => { askAsideAbout(c, t); dock.open(ASIDE_TAB); }} /> : null}
                {c && room.loading ? <p style={{ margin: "0", fontSize: "15px", color: "#555A68" }}>{"Abriendo la conversación…"}</p> : null}
                {c && !room.loading && !mission ? (
                  <div role="alert" style={{ background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "16px", boxShadow: "6px 6px 0 #FFC93C", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <strong style={{ font: "700 18px/1.2 'Bricolage Grotesque', sans-serif" }}>{"No encuentro esta conversación"}</strong>
                    <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#2B2D36" }}>{room.error || "Puede que se haya borrado."}</p>
                    <a href={`/chat/${botId}`} style={{ alignSelf: "flex-start", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{"Empezar una nueva"}</a>
                  </div>
                ) : null}
                {!c ? (
                  <div style={{ margin: "auto 0", padding: "40px 0 8px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "14px" }}>
                    <BotAvatar bot={bot} size={56} />
                    <h2 style={{ margin: "0", font: "700 30px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{`Nueva conversación con ${bot?.name || ""}`}</h2>
                    <p style={{ margin: "0", maxWidth: "560px", fontSize: "16px", lineHeight: "1.6", color: "#2B2D36" }}>
                      {bot?.instructions ? bot.instructions.split(/(?<=\.)\s/)[0] : bot?.role}
                    </p>
                    <div role="group" aria-label="Ideas para empezar" style={{ display: "flex", flexWrap: "wrap", gap: "8px", maxWidth: "720px" }}>
                      {startersFor(bot).map((idea) => (
                        <button key={idea} type="button" className="rm-focus" onClick={() => { setText(idea); requestAnimationFrame(() => inputRef.current?.focus()); }} style={{ minHeight: "40px", padding: "8px 14px", background: "#FFFFFF", border: "1px dashed #A9AEBB", borderRadius: "20px", cursor: "pointer", fontSize: "14px", textAlign: "left", color: "#12131A" }}>{idea}</button>
                      ))}
                    </div>
                    <p style={{ margin: "0", fontSize: "14px", color: "#555A68" }}>
                      {tools === "Sin herramientas" ? `${bot?.name} aún no tiene herramientas: trabaja con lo que le escribas o adjuntes con «+».` : `Puede usar: ${tools}. Adjunta archivos con «+».`}
                    </p>
                    <button type="button" role="switch" aria-checked={incognito ? "true" : "false"} className="rm-focus" onClick={toggleIncognito}
                      style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px 10px 10px", background: incognito ? "#12131A" : "#FFFFFF", color: incognito ? "#FFFFFF" : "#12131A", border: "1px solid " + (incognito ? "#12131A" : "#DCE0E8"), borderRadius: "14px", cursor: "pointer", textAlign: "left", maxWidth: "560px" }}>
                      <span aria-hidden="true" style={{ width: "40px", height: "24px", flex: "none", borderRadius: "12px", background: incognito ? "#FFC93C" : "#DCE0E8", position: "relative", transition: "background .15s ease" }}>
                        <span style={{ position: "absolute", top: "3px", left: incognito ? "19px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.35)", transition: "left .15s ease" }} />
                      </span>
                      <VenetianMask size={18} strokeWidth={2} aria-hidden="true" style={{ flex: "none" }} />
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <strong style={{ fontSize: "14px" }}>{"Conversación de incógnito"}</strong>
                        <span style={{ fontSize: "12px", lineHeight: "1.4", color: incognito ? "#C9CCD6" : "#555A68" }}>{`${bot?.name || "El bot"} no guarda nada en su memoria ni aprende de ella, y se borra a las 24 horas. Tu cuenta de IA sí procesa los mensajes.`}</span>
                      </span>
                    </button>
                  </div>
                ) : null}

                {c ? <OlderMessages count={room.olderCount} onShow={room.showOlder} /> : null}
                {messages.map((m, i) => {
                  const entering = isNew(m.id) && !m.settled && !wasLive(m.stepId);
                  // A day line when the date changes, as in the rooms.
                  const prevAt = messages[i - 1]?.at;
                  const day = m.at && (!prevAt || new Date(prevAt).toDateString() !== new Date(m.at).toDateString())
                    ? <DaySeparator key={"d" + (m.id || i)} label={dayLabel(m.at)} /> : null;
                  const withDay = (node) => (day ? [day, node] : node);
                  if (m.role === "user") {
                    const attachments = m.attachments?.length ? m.attachments : i === firstUserIndex ? mission?.files || [] : [];
                    // Your messages: on the left with a soft grey and «Tú», as in the rooms.
                    return withDay(
                      <article key={m.id || i} data-message-id={m.optimistic ? undefined : m.id} className={"chat-mine" + (entering ? " c-enter" : "")} aria-busy={m.optimistic ? "true" : undefined} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", margin: "0 -16px", opacity: m.optimistic ? 0.65 : 1, transition: "opacity .2s ease" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <UserAvatar size={28} />
                          <strong style={{ fontSize: "15px" }}>{"Tú"}</strong>
                          {m.at ? <span style={{ fontSize: "12px", color: "#555A68" }}>{new Date(m.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span> : null}
                        </div>
                        {attachments.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{attachments.map((f, j) => <FileCard key={j} file={f} />)}</div> : null}
                        <UserText text={m.text} size={16} />
                        {m.failed ? <FailedLine error={m.failed} onRetry={() => resend(m)} onDiscard={() => unshowSent(`/missions/${c}`, m.id)} /> : null}
                      </article>,
                    );
                  }
                  if (m.kind === "secret") return withDay(<SecretLine key={m.id || i} message={m} approval={approvals.find((a) => a.id === m.approvalId)} bots={bots} />);
                  if (m.role === "system" || m.kind === "activity") {
                    return withDay(<p key={m.id || i} style={{ margin: "0", textAlign: "center", fontSize: "13px", color: "#555A68" }}>{plain(m.text)}</p>);
                  }
                  const author = findBot(bots, m.botId || botId);
                  if (m.kind === "question") {
                    return withDay(
                      <article key={m.id || i} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <BotHead bot={author} at={m.at} />
                        <QuestionCard approval={approvals.find((a) => a.id === m.approvalId)} text={m.text} bots={bots} variant="chat" />
                      </article>,
                    );
                  }
                  // A deliverable right after the bot's answer belongs to that answer.
                  const prev = messages[i - 1];
                  if (m.kind === "deliverable" && prev && prev.role === "assistant" && prev.botId === m.botId && prev.kind !== "question") return null;
                  const extra = [];
                  for (let j = i + 1; j < messages.length && messages[j].kind === "deliverable" && messages[j].botId === m.botId; j++) extra.push(messages[j]);
                  const step = stepFor(m, steps);
                  const artifact = m.artifactId ? artifacts.find((a) => a.id === m.artifactId) || { id: m.artifactId, title: "Entregable" } : null;
                  let prevUser = null;
                  for (let j = i - 1; j >= 0; j--) if (messages[j].role === "user") { prevUser = messages[j]; break; }
                  // The same bot again within 5 minutes: no name and avatar again (Slack grouping).
                  const continued = !day && prev && prev.role === "assistant" && (prev.botId || botId) === (m.botId || botId) && !["question", "activity"].includes(prev.kind) && m.at && prev.at && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60e3;
                  return withDay(
                    <article key={m.id || i} data-message-id={m.id} className={"chat-answer" + (entering ? " c-enter" : "")} style={{ display: "flex", flexDirection: "column", gap: "14px", ...(continued ? { marginTop: "-16px" } : {}) }}>
                      {continued ? null : <BotHead bot={author} at={m.at} />}
                      <ActivityLog summary={m.summary} activity={step?.activity || []} tools={step?.tools || []} bots={bots} onOpenArtifact={toggleDoc} />
                      {m.text ? (
                        <InteractiveContext.Provider value={{ send: c ? (text) => post(`/missions/${c}/messages`, { text }) : null, after: messages.slice(i + 1).filter((x) => x.role === "user").map((x) => String(x.text || "")), botName: bots.find((b) => b.id === (m.botId || botId))?.name || bot?.name, entering }}>
                          <Markdown text={m.text} />
                        </InteractiveContext.Provider>
                      ) : null}
                      {m.text && step?.tools?.length ? <Sources text={m.text} tools={step.tools} /> : null}
                      {artifact ? <DeliverableCard artifact={artifact} variant="chat" pressed={panelId === artifact.id} onOpen={() => toggleDoc(artifact.id)} /> : null}
                      {extra.map((d) => {
                        const a = artifacts.find((x) => x.id === d.artifactId) || { id: d.artifactId, title: d.text || "Entregable" };
                        return <DeliverableCard key={d.id} artifact={a} variant="chat" pressed={panelId === a.id} onOpen={() => toggleDoc(a.id)} />;
                      })}
                      {m.text ? <AnswerActions bot={author} message={m} pinned={i === lastAssistantIndex && !turn} onRetry={prevUser && i === lastAssistantIndex ? () => retry(prevUser.text) : null} retryBusy={send.busy} /> : null}
                    </article>,
                  );
                })}

                {live.map((l) => {
                  const author = findBot(bots, l.botId || botId);
                  const liveStep = steps.find((s) => s.id === l.stepId);
                  return (
                    <article key={l.stepId} aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      <BotHead bot={author} />
                      {liveStep?.tools?.length ? <ActivityLog activity={liveStep.activity || []} tools={liveStep.tools} bots={bots} onOpenArtifact={openDoc} /> : null}
                      <LiveMarkdown text={l.text} caret />
                    </article>
                  );
                })}

                {awaitingReply ? (
                  <article role="status" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <BotHead bot={findBot(bots, now?.botId || botId)} />
                    <LiveLine step={steps.find((s) => s.status === "running")} now={now} fallback={mission?.activityLine} bots={bots} onOpenArtifact={openDoc} />
                  </article>
                ) : null}

                {mission?.error ? (
                  <div role="alert" style={{ padding: "12px 14px", background: "#FBE7DF", border: "1.5px solid #B4372A", borderRadius: "12px", fontSize: "14px", lineHeight: "1.5" }}>
                    <strong>{`${bot?.name} no puede seguir: `}</strong>{mission.error}
                  </div>
                ) : null}
                {mission && now && ["navegando", "rellenando un formulario", "usando el ordenador", "ejecutando una tarea"].includes(now.verb) ? (
                  <BrowserLive missionId={mission.id} bot={findBot(bots, now.botId)} verb={now.verb} missionActive={mission.status === "running"} />
                ) : null}
              </div>

              {c ? <PositionRail scroller={scroller} items={railItems(messages, (b) => findBot(bots, b || botId).name)} version={messages.length} /> : null}
              <form onSubmit={submit} {...drop.props} style={{ position: "sticky", bottom: "0", width: "100%", maxWidth: "760px", margin: "0 auto", padding: "8px clamp(16px, 3vw, 32px) 24px", background: "linear-gradient(to top, #F7F8FA 80%, rgba(247,248,250,0))" }}>
                <NewBelow show={follow.below} onClick={follow.toEnd} />
                {pending.filter((a) => a.kind === "secret").map((a) => <SecretPrompt key={a.id} approval={a} bots={bots} />)}
                <InlineApprovals approvals={pending.filter((a) => !messages.some((m) => m.approvalId === a.id && m.kind === "question"))} bots={bots} />
                <Suggestions list={suggestions} onPick={pickSuggestion} />
                {c ? <MessageQueue queue={queue} botName={bot?.name} missionPaused={mission?.status === "paused"} onResumeMission={resumeMission} resumeBusy={control.busy} working={turn} onSayNow={(body) => post(`/missions/${c}/thread`, { text: body })} /> : null}
                <div style={{ position: "relative", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "22px", padding: "14px 14px 12px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {drop.dragging ? <div aria-hidden="true" style={dropOverlay}>Suelta aquí para adjuntar</div> : null}
                  {mentions.menu}
                  {files.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {files.map((f, i) => <span key={f.name + ":" + i} className="c-pop" style={{ display: "inline-flex", maxWidth: "100%" }}>{f.pasted ? <PastedCard file={f} onInline={() => inlinePasted(i)} onRemove={() => setFiles(files.filter((_, j) => j !== i))} /> : <FileCard file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />}</span>)}
                    </div>
                  ) : null}
                  <label style={{ display: "flex" }}>
                    <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{`Mensaje para ${bot?.name || ""}`}</span>
                    <textarea ref={inputRef} rows="2" placeholder={turn ? `Puedes seguir escribiendo: se enviará cuando ${bot?.name || "termine"} acabe` : `${c ? "Responde a" : "Escribe a"} ${bot?.name || ""}… Escribe @ para traer a otro bot`} {...mentions.inputProps} onKeyDown={onKeyDown} style={{ flex: "1", resize: "none", border: "0", outline: "none", fontSize: "16px", lineHeight: "1.5", padding: "0", background: "transparent", fieldSizing: "content", minHeight: "48px", maxHeight: "240px" }} />
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                    <button type="button" className="rm-focus" aria-label="Adjuntar archivo" title="Adjuntar archivo" onClick={attach} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer" }}>
                      <Plus size={17} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                    <MicButton onText={appendDictation(setText)} bordered />
                    <span ref={thinkRef} style={{ position: "relative", display: "flex" }}>
                      <button type="button" className="rm-focus" aria-haspopup="listbox" aria-expanded={thinkOpen ? "true" : "false"} aria-label={`Forma de pensar: ${thinkingLabel}`} title="Cuánto piensa antes de responder" disabled={thinking.busy} onClick={() => setThinkOpen(!thinkOpen)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "40px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>
                        <Brain size={15} strokeWidth={2} aria-hidden="true" />{thinkingLabel}
                        {thinkOpen ? <ChevronUp size={13} strokeWidth={2.2} aria-hidden="true" /> : <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" />}
                      </button>
                      {thinkOpen ? (
                        <div role="listbox" aria-label="Forma de pensar" style={{ ...popoverStyle, left: "0", bottom: "calc(100% + 8px)" }}>
                          {THINKING.map((t) => {
                            const on = t.label === thinkingLabel;
                            return (
                              <button key={t.id} type="button" role="option" aria-selected={on ? "true" : "false"} className="rm-item" onClick={() => setThinking(t.id)} style={{ ...popoverItem, justifyContent: "space-between", background: on ? "#F7F8FA" : "transparent" }}>
                                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                  <strong style={{ fontSize: "14px" }}>{t.label}</strong>
                                  <span style={{ fontSize: "12px", color: "#555A68" }}>{t.hint}</span>
                                </span>
                                {on ? <Check size={14} strokeWidth={2.6} aria-hidden="true" style={{ flex: "none" }} /> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </span>
                    <span style={{ flex: "1" }} />
                    {turn ? (
                      <>
                        {text.trim() ? (
                          <button type="submit" className="rm-focus c-press" title="Intro: a la cola · Ctrl+Intro: se lo dices ya" style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", cursor: "pointer", fontWeight: "700", fontSize: "14px" }}>
                            <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />{"En cola"}
                          </button>
                        ) : null}
                        <button type="button" onClick={stopTurn} disabled={control.busy} aria-label={`Parar a ${bot?.name || "el bot"}`} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "2px solid #12131A", borderRadius: "12px", cursor: "pointer", fontWeight: "700", fontSize: "14px" }}>
                          <Square size={13} strokeWidth={0} fill="currentColor" aria-hidden="true" />
                          {"Parar"}
                        </button>
                      </>
                    ) : (
                      <button type="submit" aria-label="Enviar" disabled={send.busy} aria-busy={send.busy ? "true" : undefined} className="c-press" style={{ width: "48px", height: "44px", display: "grid", placeItems: "center", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", cursor: "pointer" }}>
                        <span key={launched} className={launched ? "c-launch" : undefined} style={{ display: "grid" }}><ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" /></span>
                      </button>
                    )}
                  </div>
                  {turn && text.trim() && !(send.error || fileError || thinking.error || control.error) ? (
                    <span style={{ fontSize: "12px", color: "#555A68" }}>{`Intro lo deja en la cola para cuando ${bot?.name || "termine"} acabe · Ctrl+Intro se lo dice ya · Esc lo para`}</span>
                  ) : null}
                  <ErrorLine>{send.error || fileError || thinking.error || control.error}</ErrorLine>
                </div>
              </form>
            </section>
            {c ? <SideDock dock={dock} tabs={dockTabs} addable={dockAddable} widthKey="chat" label="Panel de la conversación" /> : null}
          </div>
        </main>
      </div>
    </InteractiveContext.Provider>
  );
}
