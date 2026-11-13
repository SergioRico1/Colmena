import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWarmOnType } from "../lib/warm.js";
import { FileText, FolderOpen, Globe, MessageCircleQuestion, SquareTerminal } from "lucide-react";
import VoiceCall from "../components/v2/chat/VoiceCall.jsx";
import Shell from "../components/v2/Shell.jsx";
import Announcer from "../components/Announcer.jsx";
import { useAnnouncer } from "../lib/useAnnouncer.js";
import { leaveComposer } from "../lib/messageKeys.js";
import { whenLabel } from "../components/v2/chat/ConvList.jsx";
import NewRoomSheet from "../components/v3/team/NewRoomSheet.jsx";
import ChatsHome from "../components/v2/chat/ChatsHome.jsx";
import Composer from "../components/v2/chat/Composer.jsx";
import PlusMenu, { chosenChips, turnBody } from "../components/v2/chat/PlusMenu.jsx";
import { AnswerActions, AnswerHead, AttachmentChip, BotAnswer, DeliverableV2, TimeMark, UsageLine, UserBubble, WorkNow, WorkTrail, kTokens } from "../components/v2/chat/Parts.jsx";
import { BotMark } from "../components/v2/chat/Mark.jsx";
import Inspector from "../components/v2/chat/Inspector.jsx";
import { useExpert } from "../lib/expert.js";
import { DeckCard, isDeck } from "../components/v2/SlideDeck.jsx";
import { DocCard, SheetCard, isWordDoc, isWorkbook } from "../components/v2/OfficeFiles.jsx";
import { NeedCard, NeedGroupCard } from "../components/v2/NeedCard.jsx";
import { groupApprovals } from "../lib/approvalGroups.js";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useFileDrop } from "../lib/useFileDrop.js";
import { focusBox, shouldRefocus } from "../lib/composition.js";
import Timeline, { useStableRows } from "../components/v2/chat/Timeline.jsx";
import { promise as toastWork } from "../lib/undoToast.js";
import StoppedCard from "../components/v2/chat/StoppedCard.jsx";
import { CompletionNote } from "../components/v3/dia/Completion.jsx";
import NowBar from "../components/v2/chat/NowBar.jsx";
import Receipt from "../components/v2/chat/Receipt.jsx";
import { receiptKey, receiptOf } from "../lib/receipts.js";
import { landingRow, underWay } from "../lib/landingRow.js";
import FollowUps from "../components/v2/chat/FollowUps.jsx";
import { BranchPicker, EditButton, EditMessage } from "../components/v2/chat/Versions.jsx";
import { forgetOlder } from "../lib/history.js";
import { rememberPrompt, saveDraft, stashPrompt, unstash, useDraftOffer, useInputHistory, useStash } from "../lib/composer.js";
import DraftOffer from "../components/v2/chat/DraftOffer.jsx";
import Stash from "../components/v2/chat/Stash.jsx";
import { markLive } from "../components/room/LiveMarkdown.jsx";
import { useSlowPhase, verbLabel } from "../components/room/working.js";
import { failSent, showSent, unshowSent, useAction, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { olderOf, threadOf } from "../lib/threads.js";
import { pickFiles, post } from "../lib/api.js";
import { NoteLink, findBot } from "../components/room/common.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { useMentions } from "../components/room/Mentions.jsx";
import { plain } from "../components/room/Markdown.jsx";
import QuestionCard from "../components/room/QuestionCard.jsx";
import ArtifactPanel from "../components/room/ArtifactPanel.jsx";
import SecretPrompt, { SecretLine } from "../components/room/SecretPrompt.jsx";
import SourceChips, { CitationContext } from "../components/v2/chat/SourceChips.jsx";
import { citationMap, collectSources } from "../lib/citations.js";
import SideDock from "../components/room/SideDock.jsx";
import ConversationMap from "../components/v2/chat/ConversationMap.jsx";
import FilesPanel, { FileView, fileIcon } from "../components/room/FilesPanel.jsx";
import { comboLabel, useDock, usePanelShortcuts } from "../lib/useDock.js";
import { useRevealMessage } from "../lib/reveal.js";
import { FailedLine } from "../components/room/RoomParts.jsx";
import MessageQueue, { useConversationQueue } from "../components/room/MessageQueue.jsx";
import BtwNotes, { useBtw } from "../components/v2/BtwNotes.jsx";
import AsidePanel, { askAsideAbout } from "../components/room/AsidePanel.jsx";
import SelectionPopup, { asQuote, quoteInto } from "../components/room/SelectionPopup.jsx";
import BrowserLive from "../components/computer/BrowserLive.jsx";
import TerminalPanel, { commandsOf } from "../components/computer/TerminalPanel.jsx";
import ChatBlock from "../components/blocks/ChatBlock.jsx";
import { useAutoPreview } from "../lib/autoPreview.js";
import { exportConversation } from "../lib/exportConversation.jsx";
import { LimitBanner } from "../components/v2/LimitNotice.jsx";
import UndoChanges from "../components/v2/chat/UndoChanges.jsx";
import ChangedFiles, { TurnFileLinks, useOpenFileRequests } from "../components/v2/chat/ChangedFiles.jsx";

// Colmena 2.0 · 23 «Conversación con un bot» (design/V2Conversacion.dc.html). On the left all
// conversations; on the right the bot as a presence that breathes while it works, its work
// shown as it happens, and the capsule to write or dictate. A conversation is a mission with
// conversation:true (as before): the queue, drafts, quotes and side panel work as in v1.
const STARTERS = [
  [/coordin/i, ["Organiza mi semana con lo que tengo pendiente", "Reparte esta tarea entre el equipo", "Resume en qué está cada bot"]],
  [/investig|research/i, ["Busca qué ha cambiado esta semana en mi sector", "Compara tres opciones y dime cuál elegirías", "Resume este documento"]],
  [/dato|finanz|contab/i, ["Revisa este Excel y dime qué no cuadra", "Calcula cuánto gastamos al mes en proveedores", "Prepara la previsión del trimestre"]],
  [/dise/i, ["Propón tres ideas de portada", "Dibuja un esquema del proceso", "Revisa este diseño"]],
  [/redac|comunic|escrit/i, ["Redacta un correo para un cliente que se retrasa", "Mejora este texto", "Resume esta reunión en cinco puntos"]],
  [/c[oó]dig|program|desarroll/i, ["Revisa este script", "Automatiza esta tarea repetitiva", "Explícame este código"]],
];
const startersFor = (bot) => (STARTERS.find(([re]) => re.test(`${bot?.role || ""} ${bot?.instructions || ""}`))?.[1]) || ["Ayúdame con una tarea de hoy", "Resume este documento", "Prepara un borrador"];
// Where an answer comes from (citations.js): chips under it and its links as inline citations.
// The same objects while the message and its step do not change, so the row does not repaint.
const NO_SOURCES = { sources: undefined, citations: undefined };
const sourceCache = new WeakMap();
function sourcesFor(m, step) {
  if (!m.text) return NO_SOURCES;
  const hit = sourceCache.get(m);
  if (hit && hit.step === step) return hit.value;
  // A notice (watch.mjs) is about its own mails only, never a step that happened before it.
  const sources = collectSources({ text: m.text, tools: m.watch || m.sources?.length ? [] : step?.tools || [], mails: m.sources || [] });
  const value = sources.length ? { sources, citations: citationMap(sources) } : NO_SOURCES;
  sourceCache.set(m, { step, value });
  return value;
}
function stepFor(message, steps) {
  if (message.stepId) return steps.find((s) => s.id === message.stepId) || null;
  const at = Date.parse(message.at || 0);
  const own = steps.filter((s) => s.botId === message.botId && (!s.startedAt || Date.parse(s.startedAt) <= at + 1000));
  return own[own.length - 1] || null;
}
// A first guess of each row's height (Timeline measures the real one as it shows it).
const estimateRow = (row) => ({ head: row?.newChat ? 420 : 40, user: 96, answer: 360, question: 220, note: 30, now: 140, trail: 120, need: 220, needs: 260, error: 90, browser: 320 }[row?.kind] ?? 120);
// «Nuevos» (Timeline.jsx, src/lib/unseen.js): what counts as a new message when it arrives
// while you are not looking at the end — answers, questions and what needs you; never yours.
const unseenOf = (row) => (row.kind === "user" ? "own" : ["answer", "question", "secret", "need", "needs"].includes(row.kind) ? "new" : null);
const WHILE_WORKING_KEY = "colmena:while-working";
// «/» in the composer (V3Chat «Comandos»): only what this chat really does.
const SLASH = [
  { cmd: "/btw", desc: "Preguntar al margen sin pararle", insert: "/btw " },
  { cmd: "/aparte", desc: "Preguntar aparte, en el panel" },
  { cmd: "/archivos", desc: "Ver los archivos de la conversación" },
  { cmd: "/exportar", desc: "Exportar la conversación a Word" },
  { cmd: "/privado", desc: "Seguir sin que {bot} aprenda nada" },
];

/** While the bot works: what Intro does with what you write («Cuando acabe» or «Pasárselo ya»). */
function WhileWorking({ value, onChange, botName = "el bot", typing }) {
  const options = [["after", "Cuando acabe", `Espera en la cola y sale cuando ${botName} acabe`], ["steer", "Pasárselo ya", `${botName} lo lee en su siguiente paso, sin parar`]];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", fontSize: "var(--t-caption)", color: "#6B6F7A", animation: "fade .2s ease-out" }}>
      <span role="radiogroup" aria-label="Lo que escribas mientras trabaja" style={{ display: "inline-flex", padding: "3px", borderRadius: "var(--r-pill)", background: "rgba(18,19,26,.06)" }}>
        {options.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id ? "true" : "false"} title={hint} onClick={() => onChange(id)}
            style={{ height: "28px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: value === id ? "#FFFFFF" : "transparent", boxShadow: value === id ? "0 1px 2px rgba(18,19,26,.12)" : "none", color: value === id ? "#12131A" : "#5C606C", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, transition: "background .15s ease, color .15s ease" }}>{label}</button>
        ))}
      </span>
      <span>{typing ? `Intro: ${value === "steer" ? "se lo pasas ya" : "a la cola"} · Ctrl+Intro: ${value === "steer" ? "a la cola" : "se lo pasas ya"} · Esc lo para` : "Esc lo para"}</span>
    </div>
  );
}
const pill = { display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 16px", border: 0, borderRadius: "var(--r-pill)", background: "rgba(18,19,26,.06)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer", color: "#12131A" };

/** A deliverable in the chat: a presentation, a Word document or a workbook shows itself; anything else is a card. */
function FileCard({ artifact, onOpen }) {
  if (isDeck(artifact)) return <DeckCard artifact={artifact} onOpen={onOpen} />;
  if (isWordDoc(artifact)) return <DocCard artifact={artifact} onOpen={onOpen} />;
  if (isWorkbook(artifact)) return <SheetCard artifact={artifact} onOpen={onOpen} />;
  return <DeliverableV2 artifact={artifact} onOpen={onOpen} />;
}

export default function Conversacion({ params = {}, query = {} }) {
  const { bots, missions, ready, run } = useStore();
  // «Chats» (design/V3Chats.dc.html): every conversation, by kind and by time.
  if (!params.bot) return <Shell active="chats"><ChatsHome /></Shell>;
  return <Chat botId={params.bot} query={query} bots={bots} missions={missions} ready={ready} run={run} />;
}

function Chat({ botId, query, bots, missions, ready, run }) {
  const { settings } = useStore();
  const bot = findBot(bots, botId);
  const known = bots.some((b) => b.id === botId);
  // /chat/<bot> is the bot's single chat (threads.js); ?c= opens a private or an older one,
  // ?nuevo=incognito starts a private chat.
  const privateNew = query?.nuevo === "incognito";
  const thread = threadOf(missions, botId);
  const c = query?.c || (privateNew ? null : thread?.id || null);
  const older = c && thread && c === thread.id ? olderOf(missions, botId, thread.id) : [];
  const isOlder = !!c && !!thread && c !== thread.id && !missions.find((m) => m.id === c)?.incognito;
  const room = useRoom(c);
  // The messages are a virtual list (Timeline.jsx): it follows the end while you are there
  // and offers «Ir al final» when you are not.
  const timeline = useRef(null);
  const follow = useMemo(() => ({ toEnd: () => timeline.current?.toEnd() }), []);
  const locate = useCallback((id) => timeline.current?.locate(id) ?? false, []);
  const railLocate = useMemo(() => ({ at: (id) => timeline.current?.rail.at(id) ?? null, jump: (id) => timeline.current?.rail.jump(id) }), []);
  const { mission, messages, steps, artifacts, approvals, pending, live, activity } = room;
  const dock = useDock(c ? "chat:" + c : null);
  const activeTab = dock.open ? dock.tabs.find((t) => t.id === dock.active) : null;
  const panelId = activeTab?.kind === "doc" ? activeTab.artifactId : null;
  const openDoc = (id) => dock.open({ id: "doc:" + id, kind: "doc", artifactId: id });
  const toggleDoc = (id) => (dock.isVisible("doc:" + id) ? dock.close("doc:" + id) : openDoc(id));
  const [text, setText] = useState("");
  useWarmOnType(c, text);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  // «+»: what the bot should use for the next message (tools, apps, «Pensar a fondo»).
  const [plusOpen, setPlusOpen] = useState(false);
  const [chosen, setChosen] = useState([]);
  const toggleChosen = (key) => setChosen((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const [moreOpen, setMoreOpen] = useState(false);
  const [roomSheet, setRoomSheet] = useState(false);
  const [talking, setTalking] = useState(false); // «Hablar»: the voice panel over this chat
  useEffect(() => setTalking(false), [c]);
  // Expert mode (design/V3ChatExperto.dc.html): model and context in the header, the Inspector
  // beside the chat (Ctrl I) and the composer's chips in Geist Mono.
  const [expert] = useExpert();
  const [inspector, setInspector] = useState(() => { try { return localStorage.getItem("colmena:inspector") !== "0"; } catch { return true; } });
  const toggleInspector = () => setInspector((v) => { try { localStorage.setItem("colmena:inspector", v ? "0" : "1"); } catch {} return !v; });
  usePanelShortcuts([{ combo: "mod+i", run: toggleInspector }], expert);
  const [slashOpen, setSlashOpen] = useState(false);
  const send = useAction();
  const control = useAction();
  const inputRef = useRef(null);
  const mentions = useMentions({ value: text, setValue: setText, bots: bots.filter((b) => b.enabled !== false && b.id !== botId), inputRef, sources: { missionId: c || null } });
  const [incognito, setIncognito] = useState(privateNew);
  const [showOlder, setShowOlder] = useState(false);
  // The message of yours being written again (Versions.jsx), and the spots with versions.
  const [editing, setEditing] = useState(null);
  const branches = room.branches;
  useEffect(() => { setIncognito(privateNew); setMoreOpen(false); setShowOlder(false); setEditing(null); }, [c, botId, privateNew]);
  const privateChat = c ? !!mission?.incognito : incognito;
  // A draft left here is offered, not poured into the box (DraftOffer.jsx).
  const draft = useDraftOffer(privateChat ? null : "chat:" + (c || botId), text, setText, { label: bot?.name ? `Para ${bot.name}` : null });
  // ↑ in the empty box: what you sent here before, even beyond the loaded page (not in private chats).
  const promptKey = privateChat ? null : "chat:" + (c || botId);
  const historyKey = useInputHistory(messages, text, setText, promptKey);
  // Ctrl+S: what you are writing waits under the box for later (Stash.jsx).
  const stash = useStash();
  const [stashed, setStashed] = useState(false);
  useEffect(() => { if (!stashed) return undefined; const t = setTimeout(() => setStashed(false), 1800); return () => clearTimeout(t); }, [stashed]);
  const stashNow = () => { if (stashPrompt(text, { from: c || botId, label: bot?.name ? `Para ${bot.name}` : null })) { setText(""); setStashed(true); } };
  const restoreStash = (entry) => {
    if (text.trim()) stashPrompt(text, { from: c || botId, label: bot?.name ? `Para ${bot.name}` : null });
    unstash(entry.id);
    setText(entry.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  markLive(live.map((l) => l.stepId));
  const memberIds = c ? (mission?.botIds || [botId]) : [botId];
  const mentionedIds = (body) => bots.filter((b) => b.id !== botId && new RegExp(`(^|\\s)@${b.name}(?![\\p{L}\\d])`, "u").test(body)).map((b) => b.id);
  const turn = !!c && !!mission && (["running", "planning", "queued"].includes(mission.status) || live.length > 0);
  // A turn starts: back to the box only if you were still in this chat (assistant-ui
  // focusOnRunStart), never pulling focus from another panel or window.
  const chatRoot = useRef(null);
  const wasTurn = useRef(turn);
  useEffect(() => {
    if (turn && !wasTurn.current && shouldRefocus(document.activeElement, chatRoot.current, inputRef.current, document.body) && document.hasFocus()) focusBox(inputRef.current);
    wasTurn.current = turn;
  }, [turn]);
  // What you write while it works waits in the queue (server/queue.mjs) or goes to it at once:
  // you choose which («Cuando acabe» · «Pasárselo ya»); Ctrl+Intro does the other one.
  const queue = useConversationQueue({ key: c });
  const [whileWorking, setWhileWorking] = useState(() => { try { return localStorage.getItem(WHILE_WORKING_KEY) === "steer" ? "steer" : "after"; } catch { return "after"; } });
  const chooseWhileWorking = (v) => { setWhileWorking(v); try { localStorage.setItem(WHILE_WORKING_KEY, v); } catch {} };
  const stopTurn = () => { queue.pause(); control.act(() => post(`/missions/${c}/control`, { action: "pause" })); };
  const resumeMission = () => control.act(() => post(`/missions/${c}/control`, { action: "resume" }));
  const deliver = async (body, sent = [], mode = null, extra = {}) => {
    const path = `/missions/${c}`;
    const temp = showSent(path, body, sent);
    follow.toEnd();
    try {
      for (const extra of mentionedIds(body).filter((id) => !memberIds.includes(id))) await post(`/missions/${c}/members`, { botId: extra });
      await post(`/missions/${c}/messages`, { text: body, ...(sent.length ? { attachments: sent } : {}), ...(mode ? { mode } : {}), ...extra });
    } catch (error) {
      if (sent.length || extra.refs?.length) { unshowSent(path, temp); setText(body); setFiles(sent); throw error; }
      failSent(path, temp, error.message);
    }
  };
  const resend = (m) => { unshowSent(`/missions/${c}`, m.id); send.act(() => deliver(m.text)); };
  // «/btw …»: a side question while it works; never a message nor a queued one (BtwNotes.jsx).
  const btw = useBtw(c ? `/missions/${c}/btw` : null);
  // After sending, the box keeps the focus without moving the page (preventScroll).
  const refocus = () => requestAnimationFrame(() => focusBox(inputRef.current));
  const submit = (e, { now: sayNow = false } = {}) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || (send.busy && !c)) return;
    refocus();
    if (btw.intercept(body)) { setText(""); return; }
    const steer = c && turn && (whileWorking === "steer") !== !!sayNow;
    rememberPrompt(promptKey, body);
    if (c && !files.length && !chosen.length && !mentions.refs.length && !steer && (turn || send.busy || queue.pending.length)) {
      setText("");
      void (async () => {
        for (const extra of mentionedIds(body).filter((id) => !memberIds.includes(id))) await post(`/missions/${c}/members`, { botId: extra }).catch(() => {});
        await queue.enqueue(body);
      })();
      return;
    }
    const extra = { ...turnBody(chosen), ...mentions.refsBody() };
    const picked = mentions.refs;
    mentions.clearRefs();
    // What you pointed at with «@» comes back to the box if the message does not go.
    send.act(async () => {
      try {
        if (!c) {
          const created = await post("/missions", { prompt: body, mode: "solo", botIds: [botId], conversation: true, attachments: files, ...(incognito ? { incognito: true } : {}), ...extra });
          for (const extra of mentionedIds(body)) await post(`/missions/${created.id}/members`, { botId: extra });
          setText("");
          setFiles([]);
          setChosen([]);
          navigate(created.incognito ? `/chat/${botId}?c=${created.id}` : `/chat/${botId}`, { replace: true });
          return;
        }
        const sent = files;
        setText("");
        setFiles([]);
        setChosen([]);
        await deliver(body, sent, steer ? "steer" : null, extra);
      } catch (error) {
        mentions.restoreRefs(picked);
        throw error;
      }
    });
  };
  const retry = (userText) => send.act(() => post(`/missions/${c}/messages`, { text: userText }));
  const addFiles = useCallback((picked) => { setFileError(null); setFiles((prev) => [...prev, ...picked].slice(0, 5)); }, []);
  const drop = useFileDrop(addFiles, setFileError, { pasteCards: true });
  const attach = async () => { setFileError(null); try { addFiles(await pickFiles()); } catch (err) { setFileError(err.message); } };
  // Follow-up suggestions (runtime suggestNext): 2 or 3 under the latest answer, only for that
  // answer of the version you see; Tab in the empty box takes the first.
  const lastAnswerId = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant" && (!messages[i].kind || messages[i].kind === "message") && messages[i].text) return messages[i].id; return null; })();
  const followUps = c && !turn && !isOlder && mission?.suggestionsFor && mission.suggestionsFor === lastAnswerId ? mission?.suggestions || [] : [];
  const suggestions = text.trim() ? [] : followUps;
  const onKeyDown = (e) => {
    // Keys of an input method composing a word (accents, kana…) are the IME's, Enter included.
    if (mentions.composing(e)) return;
    if (mentions.handleKey(e)) return;
    if (!text.trim() && btw.handleKey(e)) return;
    if (historyKey(e)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); stashNow(); return; }
    if (e.key === "Tab" && !e.shiftKey && !text && suggestions.length) { e.preventDefault(); setText(suggestions[0]); return; }
    if (e.key === "Escape" && slashOpen) { e.preventDefault(); setSlashOpen(false); return; }
    if (e.key === "Escape" && turn && !text.trim()) { e.preventDefault(); stopTurn(); return; }
    // Any other Esc leaves the box for the messages (lib/messageKeys.js).
    if (leaveComposer(e)) return;
    if (e.key === "Enter" && !e.shiftKey && SLASH.some((x) => x.cmd === text.trim() && !x.insert)) { e.preventDefault(); runSlash(text.trim()); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (e.repeat) return; submit(e, { now: e.ctrlKey || e.metaKey }); }
  };
  const FILES_TAB = { id: "archivos", kind: "archivos" };
  const ASIDE_TAB = { id: "aparte", kind: "aparte" };
  // As the macOS app of OpenClaw: the bot's browser and its commands, beside the chat.
  const BROWSER_TAB = { id: "navegador", kind: "navegador" };
  const TERMINAL_TAB = { id: "terminal", kind: "terminal" };
  usePanelShortcuts([{ combo: "mod+shift+b", run: () => dock.toggle(FILES_TAB) }, { combo: "mod+shift+s", run: () => dock.toggle(ASIDE_TAB) }], !!c);
  useEffect(() => {
    const onQuote = (e) => {
      if (!c || e.detail?.missionId !== c) return;
      setText((t) => asQuote(e.detail.text) + t);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("colmena:quote", onQuote);
    return () => window.removeEventListener("colmena:quote", onQuote);
  }, [c]);
  const scope = useRef(null);
  const scroller = useRef(null);
  // The map of the conversation goes to any message of yours, loading earlier pages if needed.
  const [jumpTo, setJumpTo] = useState(null);
  useRevealMessage(jumpTo || query?.m || null, { ready: !!c && !room.loading && !!mission, olderCount: room.olderCount, showOlder: room.showOlder, locate });
  const turnOf = useMemo(() => {
    const owner = new Map();
    let turn = null;
    for (const m of messages) { if (m.role === "user" && !m.replyTo) turn = m.id; if (turn) owner.set(m.id, turn); }
    return owner;
  }, [messages]);
  const ownerOf = useCallback((id) => turnOf.get(id) || null, [turnOf]);
  const mapJump = useCallback((id) => { if (turnOf.has(id)) railLocate.jump(id); else setJumpTo(id); }, [turnOf, railLocate]);
  const headPhase = useSlowPhase(activity.find((a) => a.botId)?.verb || null);
  const workVersion = steps.reduce((n, s) => n + (s.activity?.length || 0), 0) + artifacts.length + messages.length;
  // A web page a bot just made opens in «Vista previa» beside the chat (OpenClaw's Canvas).
  useAutoPreview(c, artifacts, (wf) => dock.open({ id: "file:" + wf, kind: "file", path: wf, name: wf.split("/").pop(), type: "code" }));
  // A file named in an answer or in «Archivos cambiados» opens beside the chat.
  useOpenFileRequests(c, (f) => dock.open({ id: "file:" + f.path, kind: "file", path: f.path, name: f.name, type: f.type }));
  const now = activity.find((a) => a.botId) || null;
  const runningStep = steps.find((s) => s.status === "running") || null;
  // New answers and «te espera», said once to a screen reader (lib/useAnnouncer.js): a message
  // is said when it is finished (never as it is written), and never what you wrote yourself.
  const writing = live.map((l) => l.stepId).join(",");
  const spokenRows = useMemo(() => {
    const busy = new Set(writing ? writing.split(",") : []);
    return messages.map((m) => ({
      id: m.id, name: m.role === "assistant" ? findBot(bots, m.botId || botId)?.name || "" : "", text: m.text || m.title || "",
      skip: m.role !== "assistant" || !!m.optimistic || m.kind === "progress" || m.kind === "secret", done: !(m.stepId && busy.has(m.stepId)),
    }));
  }, [messages, bots, botId, writing]);
  const waitingNow = useMemo(() => pending.map((a) => ({ id: a.id, name: findBot(bots, a.botId || botId)?.name || "", kind: a.kind })), [pending, bots, botId]);
  const said = useAnnouncer({ scope: c || "nuevo:" + botId, ready: !room.loading, items: spokenRows, waiting: waitingNow });
  const needs = pending.filter((a) => a.kind !== "secret" && !(a.kind === "question" && messages.some((m) => m.approvalId === a.id)));
  const lastAssistant = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant" && messages[i].text && !["question", "activity", "deliverable"].includes(messages[i].kind)) return i; return -1; })();
  const lastMessage = messages[messages.length - 1];
  const awaitingReply = turn && !live.length && (!lastMessage || lastMessage.role === "user" || runningStep);
  // The timeline rows (Timeline.jsx): plain records, built only from what each row shows, so a
  // bot streaming its answer repaints the live row alone and the rest stay as they are.
  const missionCard = useMemo(() => mission, [mission?.id, mission?.conversation, mission?.room, mission?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  // Something waits for your OK: what you wrote meanwhile is held behind it.
  const held = needs.some((a) => a.kind !== "question");
  const olderKey = older.map((m) => m.id + ":" + (m.updatedAt || "")).join(",");
  const headRow = useMemo(() => ({ key: "head", kind: "head", newChat: !c, opening: !!c && room.loading, older, showOlder, incognito, isOlder, bot }), [c, room.loading, olderKey, showOlder, incognito, isOlder, bot]); // eslint-disable-line react-hooks/exhaustive-deps
  // Restore points of the turns that changed files (server/checkpoints.mjs), oldest first.
  const checkpointsKey = (mission?.checkpoints || []).map((cp) => cp.id + ":" + (cp.restoredAt || "") + ":" + cp.total).join(",");
  const checkpoints = useMemo(() => (Array.isArray(mission?.checkpoints) ? mission.checkpoints : []), [checkpointsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const messageRows = useMemo(() => {
    const rows = [];
    const firstAnswer = new Map(); // stepId → index of its first answer
    messages.forEach((x, i) => { if (x.role === "assistant" && x.stepId && !firstAnswer.has(x.stepId)) firstAnswer.set(x.stepId, i); });
    let prevUser = null;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const key = m.id || "i" + i;
      const mark = !prev || (m.at && prev.at && Date.parse(m.at) - Date.parse(prev.at) > 30 * 60e3) ? m.at || null : null;
      if (m.role === "user") {
        // Your message: «Editar» opens another version from here (branches), «‹ 1/3 ›» moves between them.
        const editable = !!c && !turn && !isOlder && !m.optimistic && !m.failed;
        // Sent while the bot worked: whether it waits for a pause, was read, or waits for your OK (receipts.js).
        const receipt = receiptKey(receiptOf(m, { steps, working: turn, held }));
        rows.push({ key, kind: "user", m, mark, branch: branches[m.id] || null, editable, editing: editing === m.id, canRestore: editing === m.id && checkpoints.some((cp) => String(cp.at || "") >= String(m.at || "")), receipt });
        prevUser = m;
        continue;
      }
      if (m.kind === "secret") { rows.push({ key, kind: "secret", m, mark, approval: approvals.find((a) => a.id === m.approvalId) || null }); continue; }
      if (m.kind === "block") { rows.push({ key, kind: "block", m, mark }); continue; } // a live block (server/blocks.mjs)
      if (m.role === "system" || m.kind === "activity") { rows.push({ key, kind: "note", m, mark }); continue; }
      if (m.kind === "question") {
        const a = approvals.find((x) => x.id === m.approvalId) || null;
        rows.push({ key, kind: "question", m, mark, a, bot: findBot(bots, m.botId || botId), mission: a?.status === "pending" ? missionCard : null });
        continue;
      }
      if (m.kind === "deliverable" && prev && prev.role === "assistant" && prev.botId === m.botId && prev.kind !== "question") continue;
      const more = [];
      for (let j = i + 1; j < messages.length && messages[j].kind === "deliverable" && messages[j].botId === m.botId; j++) more.push(messages[j]);
      // A notice of what arrived (it carries its sources) is not the answer of any step.
      const step = m.sources?.length && !m.stepId ? null : stepFor(m, steps);
      // The trail of what it said while working goes once, above the step's first answer
      // (while the step still runs it is shown above its live work instead).
      const firstOfStep = !!step && firstAnswer.get(step.id) === i && step.status !== "running";
      rows.push({
        key, ids: more.length ? [key, ...more.map((d) => d.id)] : undefined, kind: "answer", m, mark, step,
        author: findBot(bots, m.botId || botId),
        artifact: m.artifactId ? artifacts.find((a) => a.id === m.artifactId) || { id: m.artifactId, title: "Entregable" } : null,
        more: more.length ? more.map((d) => artifacts.find((x) => x.id === d.artifactId) || { id: d.artifactId, title: d.text || "Entregable" }) : undefined,
        trail: !step?.progress?.length || firstOfStep,
        // «Otra respuesta» is a sibling version of this answer (branches), «‹ 1/3 ›» under it.
        regenerate: !!prevUser && !!c && !turn && !isOlder && m.kind !== "deliverable",
        askId: prevUser && !prevUser.optimistic && !prevUser.failed ? prevUser.id : null,
        ...sourcesFor(m, step),
        branch: branches[m.id] || null,
      });
    }
    // «Deshacer cambios» goes under the last answer of each turn that changed files.
    if (checkpoints.length) {
      const byStep = new Map(checkpoints.map((cp, i) => [cp.stepId, { cp, later: checkpoints.length - i - 1 }]));
      for (let i = rows.length - 1; i >= 0; i--) {
        const found = rows[i].kind === "answer" && rows[i].step ? byStep.get(rows[i].step.id) : null;
        if (!found) continue;
        byStep.delete(rows[i].step.id);
        rows[i] = { ...rows[i], undo: found.cp, undoLater: found.later, working: turn };
      }
    }
    return rows;
  }, [messages, steps, artifacts, approvals, bots, botId, lastAssistant, turn, missionCard, checkpoints, branches, editing, isOlder, held]); // eslint-disable-line react-hooks/exhaustive-deps
  const showBrowser = !!mission && !!now && !dock.isVisible("navegador") && ["navegando", "rellenando un formulario", "usando el ordenador", "ejecutando una tarea"].includes(now.verb);
  const tailRows = useMemo(() => {
    const rows = [];
    for (const l of live) {
      const s = steps.find((x) => x.id === l.stepId);
      // The bot's name heads its turn: over what it said while working, else over «ahora».
      const bot = findBot(bots, l.botId || botId);
      if (s?.progress?.length) rows.push({ key: "trail-" + l.stepId, kind: "trail", step: s, bot });
      rows.push({ key: "live-" + l.stepId, kind: "now", step: s, live: l, bot, head: !s?.progress?.length });
    }
    if (awaitingReply && !live.length) {
      const bot = findBot(bots, now?.botId || botId);
      if (runningStep?.progress?.length) rows.push({ key: "trail-" + runningStep.id, kind: "trail", step: runningStep, bot });
      rows.push({ key: "await", kind: "now", step: runningStep, bot, head: !runningStep?.progress?.length, narration: runningStep?.progress?.length ? null : runningStep?.narration?.text || null });
    }
    for (const e of groupApprovals(needs.filter((a) => a.kind !== "question"))) rows.push(e.type === "group" ? { key: "needs-" + e.id, kind: "needs", group: e, bot: findBot(bots, e.botId), mission: missionCard } : { key: "need-" + e.a.id, kind: "need", a: e.a, bot: findBot(bots, e.a.botId), mission: missionCard });
    // Paused by a usage limit: its banner; a turn that stopped before its answer: «Se paró».
    if (mission?.limited) rows.push({ key: "error", kind: "error", limited: true, error: null, mission, name: bot?.name });
    else if (mission?.stopped && !turn) rows.push({ key: "stopped", kind: "stopped", stopped: mission.stopped, status: mission.status, name: bot?.name });
    else if (mission?.error) rows.push({ key: "error", kind: "error", limited: false, error: mission.error, mission: null, name: bot?.name });
    // A visible end when the work finishes while you are here (lib/completion.js); it shows nothing otherwise.
    if (mission?.status === "completed" && !turn && !isOlder) rows.push({ key: "done", kind: "done", missionId: mission.id });
    if (followUps.length) rows.push({ key: "follow", kind: "follow", list: followUps });
    if (showBrowser) rows.push({ key: "browser", kind: "browser", missionId: mission.id, bot: findBot(bots, now.botId), verb: now.verb, active: mission.status === "running" });
    return rows;
  }, [live, steps, bots, botId, awaitingReply, runningStep, now?.botId, now?.verb, needs.map((a) => a.id).join(","), missionCard, mission?.limited, mission?.error, mission?.limited ? mission : null, mission?.stopped?.at, mission?.stopped?.why, turn, showBrowser, mission?.status, bot?.name, followUps.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  // What comes before the chat (older chats, «Conversación anterior») shows once you reach its
  // start: while pages remain, the oldest message is the first row (the anchor when one loads).
  // Versions of the conversation (server/branches.mjs): another version brings other messages,
  // so the older pages cached for this chat go and the timeline follows the new end.
  const versions = (url, body) => run(async () => { const r = await post(url, body); forgetOlder(c); return r; }).then((r) => { follow.toEnd(); return r; });
  const rows = useStableRows([...(room.olderCount > 0 ? [] : [headRow]), ...messageRows, ...tailRows]);
  // Long answers open at their first line (followScroll.js landing, landingRow.js): the row
  // whose start stays in view is the latest answer that came while you had this chat open.
  const opened = useRef(null);
  if (!opened.current || opened.current.c !== c) opened.current = { c, openedAt: Date.now(), under: null };
  if (opened.current.under === null && c && mission && !room.loading) opened.current.under = underWay(live);
  const land = landingRow(rows, opened.current);
  // A row repaints only when its record changes: what it calls is read here, always current.
  const acts = useRef(null);
  acts.current = { resend, retry, toggleDoc, stop: () => stopTurn(), control: (action, reason) => run(() => post(`/missions/${c}/control`, { action, ...(reason ? { reason } : {}) })), stopWhy: (text) => post(`/missions/${c}/stop-reason`, { text }), edit: setEditing, sendEdit: (messageId, text, restore) => versions(`/missions/${c}/edit`, { messageId, text, ...(restore ? { restore: true } : {}) }).then(() => setEditing(null)), regenerate: (messageId) => versions(`/missions/${c}/regenerate`, { messageId }), version: (messageId) => versions(`/missions/${c}/branch`, { messageId }) };
  const renderRow = (row) => {
    const body = rowBody(row);
    return row.mark ? <><TimeMark at={row.mark} />{body}</> : body;
  };
  const rowBody = (row) => {
    const m = row.m;
    switch (row.kind) {
      case "head": return (<>
        {row.newChat ? (
          <div style={{ padding: "40px 0 8px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "16px" }}>
            <BotMark bot={bot} size={48} />
            <h2 style={{ margin: "0", font: "600 var(--t-display-s)/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.035em" }}>{`Habla con ${bot?.name || ""}`}</h2>
            <p style={{ margin: "0", maxWidth: "560px", fontSize: "var(--t-read)", lineHeight: "1.55", color: "#4A4D57" }}>{bot?.instructions ? bot.instructions.split(/(?<=\.)\s/)[0] : bot?.role}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {startersFor(bot).map((idea) => <button key={idea} type="button" onClick={() => { setText(idea); requestAnimationFrame(() => inputRef.current?.focus()); }} style={{ height: "36px", padding: "0 14px", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.1)", borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-ui)", color: "#12131A" }}>{idea}</button>)}
            </div>
            <button type="button" role="switch" aria-checked={row.incognito ? "true" : "false"} onClick={() => setIncognito((v) => { if (!v) saveDraft("chat:" + botId, ""); return !v; })}
              style={{ display: "flex", alignItems: "center", gap: "10px", height: "40px", padding: "0 16px 0 8px", border: 0, borderRadius: "var(--r-pill)", background: row.incognito ? "#12131A" : "#EBEBE6", color: row.incognito ? "#FFFFFF" : "#12131A", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 500 }}>
              <span aria-hidden="true" style={{ width: "34px", height: "22px", borderRadius: "var(--r-pill)", background: row.incognito ? "#FFFFFF" : "#C9CBD1", position: "relative", transition: "background .15s ease" }}><span style={{ position: "absolute", top: "3px", left: row.incognito ? "15px" : "3px", width: "16px", height: "16px", borderRadius: "var(--r-circle)", background: row.incognito ? "#12131A" : "#FFFFFF", transition: "left .15s ease" }} /></span>
              {"De incógnito: no guarda nada y se borra en 24 horas"}
            </button>
          </div>
        ) : null}
        {row.opening ? <span style={{ color: "#6B6F7A" }}>{"Abriendo la conversación…"}</span> : null}
        {row.older.length ? (
          <div style={{ alignSelf: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <button type="button" aria-expanded={row.showOlder ? "true" : "false"} onClick={() => setShowOlder((v) => !v)} style={{ ...pill, height: "34px", fontSize: "var(--t-meta)" }}>
              {row.showOlder ? "Ocultar conversaciones anteriores" : `Conversaciones anteriores con ${bot?.name || "este bot"} · ${row.older.length}`}
            </button>
            {row.showOlder ? (
              <div style={{ width: "min(520px, 100%)", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-xl)", background: "#FFFFFF", animation: "rise .25s ease-out" }}>
                {row.older.slice(0, 40).map((o) => (
                  <a key={o.id} href={`/chat/${botId}?c=${o.id}`} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", padding: "0 12px", borderRadius: "var(--r-lg)", fontSize: "var(--t-ui)", color: "#12131A", textDecoration: "none" }}>
                    <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</span>
                    <span style={{ fontSize: "var(--t-caption)", color: "#6B6F7A" }}>{whenLabel(o.updatedAt || o.createdAt)}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {row.isOlder ? (
          <p role="note" style={{ margin: 0, alignSelf: "center", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "10px", padding: "10px 16px", borderRadius: "var(--r-pill)", background: "rgba(18,19,26,.05)", fontSize: "var(--t-ui)", color: "#3D404A" }}>
            {`Conversación anterior con ${bot?.name || "este bot"}`}
            <a href={`/chat/${botId}`} style={{ fontWeight: 600, color: "#12131A", textDecoration: "underline" }}>{"Volver al chat"}</a>
          </p>
        ) : null}
      </>);
      case "user": {
        // What you attached (never the files the bots made in the mission folder).
        const attachments = m.attachments || [];
        return (
          row.editing ? <EditMessage text={m.text} canRestore={row.canRestore} onCancel={() => acts.current.edit(null)} onSend={(text, restore) => acts.current.sendEdit(m.id, text, restore)} /> : (
          <UserBubble message={m}>
            {attachments.length ? <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "6px" }}>{attachments.map((f, i) => <AttachmentChip key={i} name={f.name || String(f)} missionId={c} />)}</span> : null}
            {m.failed ? <FailedLine error={m.failed} onRetry={() => acts.current.resend(m)} onDiscard={() => unshowSent(`/missions/${c}`, m.id)} /> : null}
            {row.receipt ? <Receipt receipt={row.receipt} bots={bots} /> : null}
            {row.editable || row.branch ? (
              <span style={{ display: "flex", alignItems: "center", gap: "2px", color: "#5C606C" }}>
                <BranchPicker branch={row.branch} disabled={!row.editable} onShow={(id) => acts.current.version(id)} align="flex-end" />
                {row.editable ? <EditButton onClick={() => acts.current.edit(m.id)} /> : null}
              </span>
            ) : null}
          </UserBubble>)
        );
      }
      case "secret": return <SecretLine message={m} approval={row.approval} bots={bots} />;
      case "note": return <p style={{ margin: "0", textAlign: "center", fontSize: "var(--t-meta)", color: "#6B6F7A" }}>{plain(m.text)}<NoteLink link={m.link} /></p>;
      case "block": return <ChatBlock message={m} />;
      case "question": return row.a?.status === "pending"
        ? <NeedCard a={row.a} bot={row.bot} mission={row.mission} inline />
        : <QuestionCard approval={row.a} text={m.text} bots={bots} variant="chat" />;
      case "answer": return (
        // V3Chat: head, work, text; then the deliverable, the sources, the actions (and the
        // versions); expert mode adds the usage line. «Archivos cambiados» and «Deshacer cambios» last.
        <TurnFileLinks missionId={row.undo ? c : null} cp={row.undo || null}>
        <article style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <CitationContext.Provider value={row.citations}>
            <BotAnswer message={m} bot={row.author} step={row.step} bots={bots} trail={row.trail} />
          </CitationContext.Provider>
          {row.artifact ? <FileCard artifact={row.artifact} onOpen={() => acts.current.toggleDoc(row.artifact.id)} /> : null}
          {(row.more || []).map((a) => <FileCard key={a.id} artifact={a} onOpen={() => acts.current.toggleDoc(a.id)} />)}
          <SourceChips sources={row.sources} />
          <AnswerActions message={m} bot={row.author} onRetry={row.regenerate ? () => acts.current.regenerate(m.id) : null} onEditAsk={row.regenerate && row.askId ? () => acts.current.edit(row.askId) : null}
            branch={row.branch} versionDisabled={turn} onVersion={(id) => acts.current.version(id)} />
          <UsageLine message={m} step={row.step} />
          {row.undo ? <ChangedFiles cp={row.undo} missionId={c} /> : null}
          {row.undo ? <UndoChanges cp={row.undo} missionId={c} bot={row.author} working={row.working} later={row.undoLater} /> : null}
        </article>
        </TurnFileLinks>
      );
      case "trail": return <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}><AnswerHead bot={row.bot} state="work" /><WorkTrail step={row.step} bots={bots} running /></div>;
      case "now": return <WorkNow step={row.step} live={row.live} bot={row.bot} bots={bots} head={row.head} narration={row.narration} onStop={() => acts.current.stop()} />;
      case "need": return <NeedCard a={row.a} bot={row.bot} mission={row.mission} inline />;
      case "needs": return <NeedGroupCard group={row.group} bot={row.bot} mission={row.mission} inline />;
      case "done": return <CompletionNote missionId={row.missionId} />;
      case "follow": return <FollowUps list={row.list} onPick={(t) => { setText(t); requestAnimationFrame(() => focusBox(inputRef.current)); }} />;
      case "stopped": return <StoppedCard stopped={row.stopped} botName={row.name} onContinue={(why) => acts.current.control(row.status === "blocked" ? "retry" : "resume", why)} onDiscard={(why) => acts.current.control("discard", why)} onReason={(why) => acts.current.stopWhy(why)} />;
      case "error": return row.limited ? <LimitBanner mission={row.mission} botName={row.name} /> : <p role="alert" style={{ margin: 0, padding: "16px 18px", background: "#FBE7DF", borderRadius: "var(--r-xl)", fontSize: "var(--t-body)", lineHeight: "1.5" }}><strong>{`${row.name} no puede seguir: `}</strong>{row.error}</p>;
      case "browser": return <BrowserLive missionId={row.missionId} bot={row.bot} verb={row.verb} missionActive={row.active} />;
      default: return null;
    }
  };
  const dockTabs = dock.tabs.map((t) => {
    if (t.kind === "doc") { const a = artifacts.find((x) => x.id === t.artifactId); return { ...t, label: a?.title || "Entregable", icon: <FileText size={15} strokeWidth={2.2} aria-hidden="true" />, render: () => <ArtifactPanel bare artifactId={t.artifactId} bots={bots} variant="chat" /> }; }
    if (t.kind === "aparte") return { ...t, label: "Preguntar aparte", icon: <MessageCircleQuestion size={15} strokeWidth={2.2} aria-hidden="true" />, title: "Preguntar aparte · " + comboLabel("mod+shift+s"), render: () => (mission ? <AsidePanel mission={mission} /> : null) };
    if (t.kind === "archivos") return { ...t, label: "Archivos", icon: <FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />, title: "Archivos · " + comboLabel("mod+shift+b"), render: () => <FilesPanel missionId={c} version={workVersion} onOpen={(f) => dock.open({ id: "file:" + f.path, kind: "file", path: f.path, name: f.name, type: f.type })} /> };
    if (t.kind === "file") return { ...t, label: t.name || t.path, icon: fileIcon(t.type), title: t.path, render: () => <FileView missionId={c} path={t.path} version={workVersion} /> };
    if (t.kind === "navegador") return { ...t, label: "Navegador", icon: <Globe size={15} strokeWidth={2.2} aria-hidden="true" />, render: () => (c ? <div style={{ padding: "12px 14px" }}><BrowserLive missionId={c} bot={findBot(bots, now?.botId || botId)} verb={now?.verb || null} missionActive={mission?.status === "running"} /></div> : null) };
    if (t.kind === "terminal") return { ...t, label: "Terminal", icon: <SquareTerminal size={15} strokeWidth={2.2} aria-hidden="true" />, badge: commandsOf(steps).length || null, render: () => <TerminalPanel steps={steps} bots={bots} missionId={c} onOpenBrowser={() => dock.open(BROWSER_TAB)} /> };
    return null;
  }).filter(Boolean);
  const dockAddable = [
    { key: "aparte", label: "Preguntar aparte", icon: <MessageCircleQuestion size={15} strokeWidth={2.2} aria-hidden="true" />, combo: "mod+shift+s", tab: ASIDE_TAB },
    { key: "archivos", label: "Archivos", icon: <FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />, combo: "mod+shift+b", tab: FILES_TAB },
    { key: "navegador", label: "Navegador", icon: <Globe size={15} strokeWidth={2.2} aria-hidden="true" />, tab: BROWSER_TAB },
    { key: "terminal", label: "Terminal", icon: <SquareTerminal size={15} strokeWidth={2.2} aria-hidden="true" />, tab: TERMINAL_TAB },
  ].filter((a) => !dock.tabs.some((t) => t.id === a.tab.id));

  const runSlash = (cmd) => {
    const s = SLASH.find((x) => x.cmd === cmd);
    setSlashOpen(false);
    if (!s) return;
    if (s.insert) { setText(s.insert); requestAnimationFrame(() => focusBox(inputRef.current)); return; }
    setText("");
    if (cmd === "/aparte" && c) dock.open(ASIDE_TAB);
    else if (cmd === "/archivos" && c) dock.open(FILES_TAB);
    else if (cmd === "/exportar" && c) toastWork(() => exportConversation(c, "word", { bots }), { loading: "Exportando la conversación a Word…", success: "Conversación exportada a Word", error: "No se pudo exportar" }).catch(() => {});
    else if (cmd === "/privado") navigate(`/chat/${botId}?nuevo=incognito`);
  };

  if (ready && !known) {
    return (
      <Shell active="chats" scroll={false}>
        <section style={{ height: "100%", display: "grid", placeItems: "center", padding: "40px", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <strong style={{ font: "600 var(--t-heading)/1.1 'Bricolage Grotesque', sans-serif" }}>{"Este bot ya no está en tu equipo"}</strong>
            <span style={{ fontSize: "var(--t-body)", color: "#4A4D57" }}>{"Sus conversaciones siguen en Chats."}</span>
            <a href="/chats" style={{ height: "44px", display: "flex", alignItems: "center", padding: "0 20px", borderRadius: "var(--r-pill)", background: "#12131A", color: "#FFFFFF", fontWeight: 600 }}>{"Ir a Chats"}</a>
          </div>
        </section>
      </Shell>
    );
  }

  const state = pending.length ? "wait" : turn ? "work" : "rest";
  // «Tus novedades» (server/watch.mjs) is never «terminado»: it keeps watching.
  const asks = pending.length || (!turn && mission?.watchAsks > 0);
  // A bot's single chat never «ends»: at rest it shows the bot's role.
  const done = mission?.status === "completed" && !mission?.watch && !mission?.thread;
  const status = asks ? (pending.length ? "te necesita" : "espera tu respuesta") : turn ? (runningStep?.narration?.text || (now?.verb ? verbLabel(headPhase) + (now.detail ? " · " + now.detail : "") : "pensando")) : mission?.watch ? "atento a lo nuevo en tus apps" : done ? "terminado" : "";
  const statusColor = asks ? "#8A5A00" : done ? "#0B6B4A" : "#5C606C";
  // Expert: the engine and how hard it thinks, what is in its context, the session.
  const model = settings?.model || null;
  const thinking = chosen.includes("deep") ? "a fondo" : bot?.thinking || "equilibrado";
  const contextTokens = messages.reduce((n, m) => n + Math.ceil(String(m.text || "").length / 4), 0);
  const lastUsage = [...messages].reverse().find((m) => m.summary?.tokens)?.summary || null;
  const toolCount = Object.values(bot?.tools || {}).filter((v) => v && v !== "none").length;
  const chip = { height: "30px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: "var(--r-pill)", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.08)", font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "#12131A", whiteSpace: "nowrap" };
  const outline = { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "var(--r-pill)", background: "transparent", color: "#12131A", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer" };
  const tool = { height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "var(--r-pill)", background: "#F6F6F3", cursor: "pointer", whiteSpace: "nowrap", ...(expert ? { height: "30px", padding: "0 9px", font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "#12131A" } : { fontSize: "var(--t-meta)", color: "#3D404A" }) };
  const ghostKey = (on) => ({ width: "36px", height: "36px", padding: 0, border: 0, borderRadius: "var(--r-md)", background: on ? "#F1F1EC" : "transparent", color: "#4A4D57", fontSize: "var(--t-read)", fontWeight: 600, cursor: "pointer" });
  const caret = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
  const toggleDeep = () => toggleChosen("deep");
  const insertMention = () => { setText((t) => t + (t && !/\s$/.test(t) ? " @" : "@")); requestAnimationFrame(() => focusBox(inputRef.current)); };
  // «/»: what you can ask for in a word (only what this chat really does).
  const slashShown = (slashOpen || /^\/[a-záéíóú]*$/i.test(text)) && !plusOpen;
  const slashList = SLASH.filter((s) => !text.startsWith("/") || s.cmd.startsWith(text.trim().toLowerCase()) || text === "/");
  const slashMenu = slashShown && slashList.length ? (
    <div role="menu" aria-label="Comandos" style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", zIndex: 20, width: "min(360px, 100%)", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-lg)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "rise .15s ease-out" }}>
      <span style={{ padding: "6px 10px", fontSize: "var(--t-caption)", fontWeight: 600, color: "#5C606C" }}>{"Comandos"}</span>
      {slashList.map((s) => (
        <button key={s.cmd} type="button" role="menuitem" onClick={() => runSlash(s.cmd)} style={{ minHeight: "42px", display: "flex", alignItems: "center", gap: "12px", padding: "0 10px", border: 0, borderRadius: "var(--r-md)", background: "transparent", textAlign: "left", cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F6F3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
          <span style={{ width: "74px", font: "500 var(--t-meta)/1 'Geist Mono', monospace" }}>{s.cmd}</span>
          <span style={{ fontSize: "var(--t-ui)", color: "#4A4D57" }}>{s.desc.replace("{bot}", bot?.name || "el bot")}</span>
        </button>
      ))}
    </div>
  ) : null;
  const composerTools = expert ? <>
    <a href="/ajustes/ia" title="Modelo con el que piensa el equipo" style={{ ...tool, textDecoration: "none" }}>{(model || "modelo") + " ▾"}</a>
    <button type="button" onClick={toggleDeep} aria-pressed={chosen.includes("deep") ? "true" : "false"} title="Pensar a fondo en el próximo mensaje" style={tool}>{`esfuerzo: ${thinking} ▾`}</button>
    <button type="button" onClick={() => setPlusOpen((v) => !v)} title="Herramientas y apps para el próximo mensaje" style={tool}>{`herramientas: ${toolCount + chosen.filter((k) => k !== "deep").length} ▾`}</button>
    {c ? <button type="button" onClick={() => chooseWhileWorking(whileWorking === "steer" ? "after" : "steer")} title="Lo que escribas mientras trabaja" style={tool}>{`mientras trabaja: ${whileWorking === "steer" ? "reorienta" : "a la cola"} ▾`}</button> : null}
  </> : <>
    <button type="button" aria-label="Mencionar" title="Mencionar a otro bot (@)" onClick={insertMention} style={ghostKey(false)}>{"@"}</button>
    <button type="button" aria-label="Comandos" aria-pressed={slashOpen ? "true" : "false"} title="Comandos (/)" onClick={() => setSlashOpen((v) => !v)} style={ghostKey(slashOpen)}>{"/"}</button>
    <button type="button" onClick={toggleDeep} aria-pressed={chosen.includes("deep") ? "true" : "false"} title={chosen.includes("deep") ? "Pensará a fondo en el próximo mensaje" : "Pensar a fondo en el próximo mensaje"} style={{ ...tool, marginLeft: "4px" }}>{`Piensa: ${thinking}`}{caret}</button>
  </>;
  const moreItems = [
    c && !isOlder ? ["Hablar en voz alta", () => setTalking(true)] : null,
    [`Sobre ${bot?.name || "el bot"}`, () => navigate(`/equipo/${botId}`)],
    c ? ["Archivos de la conversación", () => dock.toggle(FILES_TAB)] : null,
    c ? ["Preguntar aparte", () => dock.toggle(ASIDE_TAB)] : null,
    c ? ["Exportar a Word", () => toastWork(() => exportConversation(c, "word", { bots }), { loading: "Exportando la conversación a Word…", success: "Conversación exportada a Word", error: "No se pudo exportar" })] : null,
    c ? ["Exportar a Markdown", () => toastWork(() => exportConversation(c, "markdown", { bots }), { loading: "Exportando la conversación…", success: "Conversación exportada a Markdown", error: "No se pudo exportar" })] : null,
    c ? ["Copiar como Markdown", () => exportConversation(c, "copy", { bots })] : null,
    ["Chat de incógnito", () => navigate(`/chat/${botId}?nuevo=incognito`)],
  ].filter(Boolean);

  return (
    <InteractiveContext.Provider value={{ send: c ? (t) => post(`/missions/${c}/messages`, { text: t }) : null }}>
      <Shell active="chats" scroll={false}>
        <div style={{ display: "flex", height: "100%", alignItems: "stretch" }}>
          <section ref={chatRoot} aria-label={`Conversación con ${bot?.name || ""}`} style={{ position: "relative", flex: "999 1 520px", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
            <Announcer text={said} />
            {talking && c ? <VoiceCall bot={bot} missionId={c} onClose={() => setTalking(false)} /> : null}
            <header style={{ position: "relative", zIndex: 3, flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: expert ? "10px" : "12px", padding: expert ? "14px 24px" : "16px 28px", background: "rgba(245,245,242,.92)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
              <BotMark bot={bot} size={expert ? 28 : 30} state={state} />
              <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px", marginRight: "auto" }}>
                <h1 style={{ margin: 0, fontSize: "var(--t-read)", fontWeight: 600, lineHeight: 1.2 }}><a href={`/equipo/${botId}`} style={{ color: "#12131A" }}>{bot?.name}</a></h1>
                {expert ? (
                  <span style={{ font: "400 var(--t-caption)/1.2 'Geist Mono', monospace", color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c ? [`chat ${c.slice(-4)}`, `sesión ${botId}:${c.slice(-4)}`, lastUsage?.cachedPercent != null ? `caché ${lastUsage.cachedPercent} %` : null, status || null].filter(Boolean).join(" · ") : "chat nuevo · sin sesión"}</span>
                ) : (
                  <span style={{ fontSize: "var(--t-meta)", color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot?.role}{status ? <span style={{ color: statusColor, transition: "color .3s ease" }}>{(bot?.role ? " · " : "") + status}</span> : null}</span>
                )}
              </div>
              {expert ? <>
                {model ? <span title="Modelo y esfuerzo" style={chip}>{`${model} · ${thinking}`}</span> : null}
                <span title="Contexto estimado de esta conversación" style={chip}>
                  <span aria-hidden="true" style={{ position: "relative", width: "44px", height: "6px", borderRadius: "var(--r-xs)", background: "#EEEEEA", overflow: "hidden" }}><span style={{ position: "absolute", inset: "0 auto 0 0", width: Math.min(100, Math.round((contextTokens / 128000) * 100)) + "%", minWidth: contextTokens ? "3px" : 0, background: "#12131A" }} /></span>
                  {"≈ " + kTokens(contextTokens)}
                </span>
                <button type="button" aria-pressed={inspector ? "true" : "false"} onClick={toggleInspector} style={{ height: "30px", padding: "0 12px", border: inspector ? 0 : "1px solid rgba(18,19,26,.12)", borderRadius: "var(--r-pill)", background: inspector ? "#12131A" : "#FFFFFF", color: inspector ? "#FFFFFF" : "#12131A", fontSize: "var(--t-meta)", fontWeight: 600, cursor: "pointer" }}>{"Inspector · Ctrl I"}</button>
              </> : null}
              <button type="button" onClick={() => setRoomSheet(true)} style={outline}>{"Llevar a una sala"}</button>
              <span style={{ position: "relative" }}>
                <button type="button" aria-haspopup="menu" aria-expanded={moreOpen ? "true" : "false"} aria-label="Más opciones" onClick={() => setMoreOpen((v) => !v)} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "var(--r-md)", background: moreOpen ? "#EBEBE6" : "transparent", color: "#4A4D57", cursor: "pointer" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg>
                </button>
                {moreOpen ? (
                  <div role="menu" onMouseLeave={() => setMoreOpen(false)} style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, width: "240px", padding: "6px", borderRadius: "var(--r-lg)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "rise .15s ease-out", display: "flex", flexDirection: "column" }}>
                    {moreItems.map(([label, fn]) => (
                      <button key={label} type="button" role="menuitem" onClick={() => { setMoreOpen(false); Promise.resolve(fn()).catch(() => {}); }} style={{ height: "38px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "var(--t-ui)", color: "#12131A" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F6F3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{label}</button>
                    ))}
                  </div>
                ) : null}
              </span>
            </header>
            {mission?.incognito ? <p role="note" style={{ flex: "none", margin: 0, padding: "10px 28px", background: "#12131A", color: "#FFFFFF", fontSize: "var(--t-meta)" }}>{`De incógnito: ${bot?.name || "el bot"} no guarda nada de esta conversación y se borra en 24 horas.`}</p> : null}
            <div style={{ flex: "1", minHeight: 0, display: "flex" }}>
              {c ? <SelectionPopup scope={scope} onQuote={(t) => quoteInto(c, t)} onAsk={(t) => { askAsideAbout(c, t); dock.open(ASIDE_TAB); }} /> : null}
              <Timeline key={c || "nuevo:" + botId} listKey={c || "nuevo:" + botId} handle={timeline} rows={rows} renderRow={renderRow} estimate={estimateRow}
                hasOlder={room.olderCount > 0} loadingOlder={room.loadingOlder} olderError={room.olderError} onReachTop={room.showOlder} landKey={land?.key || null} landTurn={land?.turn || null} unseenOf={unseenOf}
                scrollerRef={scroller} contentRef={scope} style={{ WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 28px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 28px)" }} />
            </div>
            {c ? <ConversationMap missionId={c} version={messages.length + ":" + (messages[messages.length - 1]?.id || "")} scroller={scroller} ownerOf={ownerOf} onJump={mapJump} /> : null}
            {/* An older chat is read-only: you keep talking in the bot's single chat. */}
            {isOlder ? null : (
            <Composer v3 value={text} onChange={(v) => { setText(v); if (slashOpen) setSlashOpen(false); }} onKeyDown={onKeyDown} onSubmit={submit} inputRef={inputRef} inputProps={mentions.inputProps} dictationScope={c || "nuevo:" + botId}
              menu={plusOpen ? <PlusMenu open onClose={() => { setPlusOpen(false); requestAnimationFrame(() => inputRef.current?.focus()); }} onFiles={attach} onCapture={(file) => addFiles([file])} onError={setFileError} chosen={chosen} onToggle={toggleChosen} text={text} botId={botId} /> : mentions.menu || slashMenu}
              attachOpen={plusOpen} mentionBots={bots} chips={[...mentions.chips, ...chosenChips(chosen).filter((ch) => ch.key !== "deep")]} onRemoveChip={(k) => (mentions.isRef(k) ? mentions.removeRef(k) : setChosen((list) => list.filter((x) => x !== k)))}
              label={`Responder a ${bot?.name || ""}`} placeholder={turn ? (whileWorking === "steer" ? `Sigue escribiendo: ${bot?.name || "el bot"} lo lee en su siguiente paso` : `Sigue escribiendo: se lo pasas cuando ${bot?.name || "termine"} acabe`) : `${c ? "Responder a" : "Escribe a"} ${bot?.name || ""}…  ${expert ? "@ menciona · / comandos · Mayús Intro nueva línea" : "@ para mencionar · / para comandos"}`}
              working={turn} onStop={stopTurn} files={files} onRemoveFile={(i) => setFiles(files.filter((_, j) => j !== i))} onInlinePasted={(i) => { const f = files[i]; setFiles(files.filter((_, j) => j !== i)); setText((t) => (t.trim() ? t.replace(/\s*$/, "\n\n") : "") + f.content); }}
              onAttach={() => { setSlashOpen(false); setPlusOpen((v) => !v); }} drop={drop} busy={send.busy} tools={composerTools}
              above={<>
                {c ? <NowBar missionId={c} active={turn} steps={steps} bots={bots} scroller={scroller} fallbackBotId={botId} onShow={follow.toEnd} onStop={stopTurn} /> : null}
                <DraftOffer offer={draft.offer} onRecover={() => { draft.recover(); requestAnimationFrame(() => focusBox(inputRef.current)); }} onLater={draft.later} onDiscard={draft.discard} />
                {pending.filter((a) => a.kind === "secret").map((a) => <SecretPrompt key={a.id} approval={a} bots={bots} />)}
                <BtwNotes btw={btw} botName={bot?.name} nameOf={(id) => findBot(bots, id)?.name} />
              </>}
              below={<>
                {send.error || fileError || control.error ? <p role="alert" style={{ margin: "8px 18px 0", fontSize: "var(--t-meta)", color: "#B4232A" }}>{send.error || fileError || control.error}</p> : null}
                {(turn && !expert) || stash.length || stashed ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", margin: "10px 6px 0" }}>
                    {turn && !expert ? <WhileWorking value={whileWorking} onChange={chooseWhileWorking} botName={bot?.name} typing={!!text.trim()} /> : null}
                    <span style={{ flex: "1" }} />
                    <Stash entries={stash} saved={stashed} onRestore={restoreStash} onDelete={(entry) => unstash(entry.id)} />
                  </div>
                ) : null}
                {c ? <MessageQueue queue={queue} botName={bot?.name} missionPaused={mission?.status === "paused" && !mission?.limited && !mission?.stopped} onResumeMission={resumeMission} resumeBusy={control.busy} working={turn} /> : null}
              </>} />
            )}
          </section>
          {c ? <SideDock dock={dock} tabs={dockTabs} addable={dockAddable} widthKey="chat" label="Panel de la conversación" tone="v3" /> : null}
          {expert && inspector ? <Inspector bot={bot} mission={mission} messages={messages} steps={steps} approvals={approvals} onClose={toggleInspector} /> : null}
        </div>
        {roomSheet ? <NewRoomSheet preset={[botId]} onClose={() => setRoomSheet(false)} /> : null}
      </Shell>
    </InteractiveContext.Provider>
  );
}
