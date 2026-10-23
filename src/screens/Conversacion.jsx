import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWarmOnType } from "../lib/warm.js";
import { FileText, FolderOpen, Globe, MessageCircleQuestion, SquareTerminal } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import ConvList, { NewConversation, whenLabel } from "../components/v2/chat/ConvList.jsx";
import Composer from "../components/v2/chat/Composer.jsx";
import PlusMenu, { chosenChips, turnBody } from "../components/v2/chat/PlusMenu.jsx";
import { BotAnswer, DeliverableV2, TimeMark, UserBubble, WorkNow, WorkTrail } from "../components/v2/chat/Parts.jsx";
import { DeckCard, isDeck } from "../components/v2/SlideDeck.jsx";
import { DocCard, SheetCard, isWordDoc, isWorkbook } from "../components/v2/OfficeFiles.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { NeedCard } from "../components/v2/NeedCard.jsx";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useFileDrop } from "../lib/useFileDrop.js";
import Timeline, { useStableRows } from "../components/v2/chat/Timeline.jsx";
import { rememberPrompt, saveDraft, stashPrompt, unstash, useDraft, useInputHistory, useStash } from "../lib/composer.js";
import Stash from "../components/v2/chat/Stash.jsx";
import { markLive } from "../components/room/LiveMarkdown.jsx";
import { useSlowPhase, verbLabel } from "../components/room/working.js";
import { failSent, showSent, unshowSent, useAction, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { olderOf, threadOf } from "../lib/threads.js";
import { pickFiles, post } from "../lib/api.js";
import { findBot } from "../components/room/common.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { useMentions } from "../components/room/Mentions.jsx";
import { plain } from "../components/room/Markdown.jsx";
import QuestionCard from "../components/room/QuestionCard.jsx";
import ArtifactPanel from "../components/room/ArtifactPanel.jsx";
import SecretPrompt, { SecretLine } from "../components/room/SecretPrompt.jsx";
import Sources from "../components/room/Sources.jsx";
import SideDock from "../components/room/SideDock.jsx";
import PositionRail, { railItems } from "../components/room/PositionRail.jsx";
import FilesPanel, { FileView, fileIcon } from "../components/room/FilesPanel.jsx";
import { comboLabel, useDock, usePanelShortcuts } from "../lib/useDock.js";
import { useRevealMessage } from "../lib/reveal.js";
import { FailedLine, NewBelow, Suggestions } from "../components/room/RoomParts.jsx";
import MessageQueue, { useConversationQueue } from "../components/room/MessageQueue.jsx";
import BtwNotes, { useBtw } from "../components/v2/BtwNotes.jsx";
import AsidePanel, { askAsideAbout } from "../components/room/AsidePanel.jsx";
import SelectionPopup, { asQuote, quoteInto } from "../components/room/SelectionPopup.jsx";
import BrowserLive from "../components/computer/BrowserLive.jsx";
import TerminalPanel, { commandsOf } from "../components/computer/TerminalPanel.jsx";
import { useAutoPreview } from "../lib/autoPreview.js";
import { exportConversation } from "../lib/exportConversation.jsx";
import { LimitBanner } from "../components/v2/LimitNotice.jsx";
import UndoChanges from "../components/v2/chat/UndoChanges.jsx";

// Colmena 2.0 · 23 «Conversación con un bot» (design/V2Conversacion.dc.html). On the left all
// conversations; on the right the bot as a presence that breathes while it works, its work
// shown as it happens, and the capsule to write or dictate. A conversation is a mission with
// conversation:true (as before): the queue, drafts, quotes and side panel work as in v1.
const STARTERS = [
  [/coordin/i, ["Organiza mi semana con lo que tengo pendiente", "Reparte este encargo entre el equipo", "Resume en qué está cada bot"]],
  [/investig|research/i, ["Busca qué ha cambiado esta semana en mi sector", "Compara tres opciones y dime cuál elegirías", "Resume este documento"]],
  [/dato|finanz|contab/i, ["Revisa este Excel y dime qué no cuadra", "Calcula cuánto gastamos al mes en proveedores", "Prepara la previsión del trimestre"]],
  [/dise/i, ["Propón tres ideas de portada", "Dibuja un esquema del proceso", "Revisa este diseño"]],
  [/redac|comunic|escrit/i, ["Redacta un correo para un cliente que se retrasa", "Mejora este texto", "Resume esta reunión en cinco puntos"]],
  [/c[oó]dig|program|desarroll/i, ["Revisa este script", "Automatiza esta tarea repetitiva", "Explícame este código"]],
];
const startersFor = (bot) => (STARTERS.find(([re]) => re.test(`${bot?.role || ""} ${bot?.instructions || ""}`))?.[1]) || ["Ayúdame con una tarea de hoy", "Resume este documento", "Prepara un borrador"];
function stepFor(message, steps) {
  if (message.stepId) return steps.find((s) => s.id === message.stepId) || null;
  const at = Date.parse(message.at || 0);
  const own = steps.filter((s) => s.botId === message.botId && (!s.startedAt || Date.parse(s.startedAt) <= at + 1000));
  return own[own.length - 1] || null;
}
// A first guess of each row's height (Timeline measures the real one as it shows it).
const estimateRow = (row) => ({ head: row?.newChat ? 420 : 40, user: 96, answer: 360, question: 220, note: 30, now: 140, trail: 120, need: 220, error: 90, browser: 320 }[row?.kind] ?? 120);
const WHILE_WORKING_KEY = "colmena:while-working";

/** While the bot works: what Intro does with what you write («Cuando acabe» or «Pasárselo ya»). */
function WhileWorking({ value, onChange, botName = "el bot", typing }) {
  const options = [["after", "Cuando acabe", `Espera en la cola y sale cuando ${botName} acabe`], ["steer", "Pasárselo ya", `${botName} lo lee en su siguiente paso, sin parar`]];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", fontSize: "12px", color: "#6B6F7A", animation: "fade .2s ease-out" }}>
      <span role="radiogroup" aria-label="Lo que escribas mientras trabaja" style={{ display: "inline-flex", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.06)" }}>
        {options.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id ? "true" : "false"} title={hint} onClick={() => onChange(id)}
            style={{ height: "28px", padding: "0 12px", border: 0, borderRadius: "999px", background: value === id ? "#FFFFFF" : "transparent", boxShadow: value === id ? "0 1px 2px rgba(18,19,26,.12)" : "none", color: value === id ? "#12131A" : "#5C606C", cursor: "pointer", fontSize: "13px", fontWeight: 600, transition: "background .15s ease, color .15s ease" }}>{label}</button>
        ))}
      </span>
      <span>{typing ? `Intro: ${value === "steer" ? "se lo pasas ya" : "a la cola"} · Ctrl+Intro: ${value === "steer" ? "a la cola" : "se lo pasas ya"} · Esc lo para` : "Esc lo para"}</span>
    </div>
  );
}
const pill = { display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", fontSize: "14px", fontWeight: "500", cursor: "pointer", color: "#12131A" };

/** A deliverable in the chat: a presentation, a Word document or a workbook shows itself; anything else is a card. */
function FileCard({ artifact, onOpen }) {
  if (isDeck(artifact)) return <DeckCard artifact={artifact} onOpen={onOpen} />;
  if (isWordDoc(artifact)) return <DocCard artifact={artifact} onOpen={onOpen} />;
  if (isWorkbook(artifact)) return <SheetCard artifact={artifact} onOpen={onOpen} />;
  return <DeliverableV2 artifact={artifact} onOpen={onOpen} />;
}

export default function Conversacion({ params = {}, query = {} }) {
  const { bots, missions, ready, run } = useStore();
  const latest = useMemo(() => missions.filter((m) => m.conversation && !m.archived).sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))[0] || null, [missions]);
  // «Chats» in the rail: the last one you had, or the list alone.
  useEffect(() => {
    if (!params.bot && latest) navigate(`/chat/${latest.botIds?.[0]}?c=${latest.id}`, { replace: true });
  }, [params.bot, latest]);
  if (!params.bot) {
    return (
      <Shell active="conversaciones" scroll={false}>
        <div style={{ display: "flex", height: "100%" }}>
          <ConvList current={null} />
          <section style={{ flex: "1", display: "grid", placeItems: "center", padding: "40px" }}>
            {ready && !latest ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", textAlign: "center", maxWidth: "420px" }}>
                <BotPresence bot={{ shape: "hex", color: "#FFC93C" }} size={56} state="rest" />
                <strong style={{ font: "600 24px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Aún no hay chats"}</strong>
                <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#5C606C" }}>{"Habla con un bot a solas o junta a varios en una sala."}</span>
                <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("colmena:new-conversation"))} style={{ height: "46px", padding: "0 22px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "15px", fontWeight: "600", cursor: "pointer" }}>{"Nueva conversación"}</button>
              </div>
            ) : null}
          </section>
        </div>
      </Shell>
    );
  }
  return <Chat botId={params.bot} query={query} bots={bots} missions={missions} ready={ready} run={run} />;
}

function Chat({ botId, query, bots, missions, ready, run }) {
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
  // The messages are a virtual list (Timeline.jsx): it follows the end, and says when
  // something new arrived below while you read further up.
  const timeline = useRef(null);
  const [below, setBelow] = useState(false);
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
  const send = useAction();
  const control = useAction();
  const inputRef = useRef(null);
  const mentions = useMentions({ value: text, setValue: setText, bots: bots.filter((b) => b.enabled !== false && b.id !== botId), inputRef });
  const [incognito, setIncognito] = useState(privateNew);
  const [showOlder, setShowOlder] = useState(false);
  useEffect(() => { setIncognito(privateNew); setMoreOpen(false); setShowOlder(false); setBelow(false); }, [c, botId, privateNew]);
  const privateChat = c ? !!mission?.incognito : incognito;
  useDraft(privateChat ? null : "chat:" + (c || botId), text, setText);
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
      if (sent.length) { unshowSent(path, temp); setText(body); setFiles(sent); throw error; }
      failSent(path, temp, error.message);
    }
  };
  const resend = (m) => { unshowSent(`/missions/${c}`, m.id); send.act(() => deliver(m.text)); };
  // «/btw …»: a side question while it works; never a message nor a queued one (BtwNotes.jsx).
  const btw = useBtw(c ? `/missions/${c}/btw` : null);
  const submit = (e, { now: sayNow = false } = {}) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || (send.busy && !c)) return;
    if (btw.intercept(body)) { setText(""); return; }
    const steer = c && turn && (whileWorking === "steer") !== !!sayNow;
    rememberPrompt(promptKey, body);
    if (c && !files.length && !chosen.length && !steer && (turn || send.busy || queue.pending.length)) {
      setText("");
      void (async () => {
        for (const extra of mentionedIds(body).filter((id) => !memberIds.includes(id))) await post(`/missions/${c}/members`, { botId: extra }).catch(() => {});
        await queue.enqueue(body);
      })();
      return;
    }
    const extra = turnBody(chosen);
    send.act(async () => {
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
    });
  };
  const retry = (userText) => send.act(() => post(`/missions/${c}/messages`, { text: userText }));
  const addFiles = useCallback((picked) => { setFileError(null); setFiles((prev) => [...prev, ...picked].slice(0, 5)); }, []);
  const drop = useFileDrop(addFiles, setFileError, { pasteCards: true });
  const attach = async () => { setFileError(null); try { addFiles(await pickFiles()); } catch (err) { setFileError(err.message); } };
  const suggestions = c && !text.trim() && !turn ? mission?.suggestions || [] : [];
  const onKeyDown = (e) => {
    if (mentions.handleKey(e)) return;
    if (!text.trim() && btw.handleKey(e)) return;
    if (historyKey(e)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); stashNow(); return; }
    if (e.key === "Tab" && !e.shiftKey && !text && suggestions.length) { e.preventDefault(); setText(suggestions[0]); return; }
    if (e.key === "Escape" && turn && !text.trim()) { e.preventDefault(); stopTurn(); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (e.repeat) return; submit(e, { now: e.ctrlKey || e.metaKey }); }
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
  useRevealMessage(query?.m || null, { ready: !!c && !room.loading && !!mission, olderCount: room.olderCount, showOlder: room.showOlder, locate });
  const headPhase = useSlowPhase(activity.find((a) => a.botId)?.verb || null);
  const workVersion = steps.reduce((n, s) => n + (s.activity?.length || 0), 0) + artifacts.length + messages.length;
  // A web page a bot just made opens in «Vista previa» beside the chat (OpenClaw's Canvas).
  useAutoPreview(c, artifacts, (wf) => dock.open({ id: "file:" + wf, kind: "file", path: wf, name: wf.split("/").pop(), type: "code" }));
  const now = activity.find((a) => a.botId) || null;
  const runningStep = steps.find((s) => s.status === "running") || null;
  const needs = pending.filter((a) => a.kind !== "secret" && !(a.kind === "question" && messages.some((m) => m.approvalId === a.id)));
  const lastAssistant = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant" && messages[i].text && !["question", "activity", "deliverable"].includes(messages[i].kind)) return i; return -1; })();
  const lastMessage = messages[messages.length - 1];
  const awaitingReply = turn && !live.length && (!lastMessage || lastMessage.role === "user" || runningStep);
  // The timeline rows (Timeline.jsx): plain records, built only from what each row shows, so a
  // bot streaming its answer repaints the live row alone and the rest stay as they are.
  const missionCard = useMemo(() => mission, [mission?.id, mission?.conversation, mission?.room, mission?.title]); // eslint-disable-line react-hooks/exhaustive-deps
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
      if (m.role === "user") { rows.push({ key, kind: "user", m, mark }); prevUser = m; continue; }
      if (m.kind === "secret") { rows.push({ key, kind: "secret", m, mark, approval: approvals.find((a) => a.id === m.approvalId) || null }); continue; }
      if (m.role === "system" || m.kind === "activity") { rows.push({ key, kind: "note", m, mark }); continue; }
      if (m.kind === "question") {
        const a = approvals.find((x) => x.id === m.approvalId) || null;
        rows.push({ key, kind: "question", m, mark, a, bot: findBot(bots, m.botId || botId), mission: a?.status === "pending" ? missionCard : null });
        continue;
      }
      if (m.kind === "deliverable" && prev && prev.role === "assistant" && prev.botId === m.botId && prev.kind !== "question") continue;
      const more = [];
      for (let j = i + 1; j < messages.length && messages[j].kind === "deliverable" && messages[j].botId === m.botId; j++) more.push(messages[j]);
      const step = stepFor(m, steps);
      // The trail of what it said while working goes once, above the step's first answer
      // (while the step still runs it is shown above its live work instead).
      const firstOfStep = !!step && firstAnswer.get(step.id) === i && step.status !== "running";
      rows.push({
        key, ids: more.length ? [key, ...more.map((d) => d.id)] : undefined, kind: "answer", m, mark, step,
        author: findBot(bots, m.botId || botId),
        artifact: m.artifactId ? artifacts.find((a) => a.id === m.artifactId) || { id: m.artifactId, title: "Entregable" } : null,
        more: more.length ? more.map((d) => artifacts.find((x) => x.id === d.artifactId) || { id: d.artifactId, title: d.text || "Entregable" }) : undefined,
        trail: !step?.progress?.length || firstOfStep,
        retryText: prevUser && i === lastAssistant && !turn ? prevUser.text : null,
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
  }, [messages, steps, artifacts, approvals, bots, botId, lastAssistant, turn, missionCard, checkpoints]);
  const showBrowser = !!mission && !!now && !dock.isVisible("navegador") && ["navegando", "rellenando un formulario", "usando el ordenador", "ejecutando una tarea"].includes(now.verb);
  const tailRows = useMemo(() => {
    const rows = [];
    for (const l of live) {
      const s = steps.find((x) => x.id === l.stepId);
      if (s?.progress?.length) rows.push({ key: "trail-" + l.stepId, kind: "trail", step: s });
      rows.push({ key: "live-" + l.stepId, kind: "now", step: s, live: l, bot: findBot(bots, l.botId || botId) });
    }
    if (awaitingReply && !live.length) {
      if (runningStep?.progress?.length) rows.push({ key: "trail-" + runningStep.id, kind: "trail", step: runningStep });
      rows.push({ key: "await", kind: "now", step: runningStep, bot: findBot(bots, now?.botId || botId), narration: runningStep?.progress?.length ? null : runningStep?.narration?.text || null });
    }
    for (const a of needs) if (a.kind !== "question") rows.push({ key: "need-" + a.id, kind: "need", a, bot: findBot(bots, a.botId), mission: missionCard });
    if (mission?.limited || mission?.error) rows.push({ key: "error", kind: "error", limited: !!mission.limited, error: mission.error || null, mission, name: bot?.name });
    if (showBrowser) rows.push({ key: "browser", kind: "browser", missionId: mission.id, bot: findBot(bots, now.botId), verb: now.verb, active: mission.status === "running" });
    return rows;
  }, [live, steps, bots, botId, awaitingReply, runningStep, now?.botId, now?.verb, needs.map((a) => a.id).join(","), missionCard, mission?.limited, mission?.error, mission?.limited ? mission : null, showBrowser, mission?.status, bot?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  // What comes before the chat (older chats, «Conversación anterior») shows once you reach its
  // start: while pages remain, the oldest message is the first row (the anchor when one loads).
  const rows = useStableRows([...(room.olderCount > 0 ? [] : [headRow]), ...messageRows, ...tailRows]);
  // A row repaints only when its record changes: what it calls is read here, always current.
  const acts = useRef(null);
  acts.current = { resend, retry, toggleDoc };
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
            <BotPresence bot={bot} size={64} state="rest" />
            <h2 style={{ margin: "0", font: "600 34px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.035em" }}>{`Habla con ${bot?.name || ""}`}</h2>
            <p style={{ margin: "0", maxWidth: "560px", fontSize: "17px", lineHeight: "1.6", color: "#3D404A" }}>{bot?.instructions ? bot.instructions.split(/(?<=\.)\s/)[0] : bot?.role}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {startersFor(bot).map((idea) => <button key={idea} type="button" onClick={() => { setText(idea); requestAnimationFrame(() => inputRef.current?.focus()); }} style={{ height: "38px", padding: "0 16px", background: "transparent", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", cursor: "pointer", fontSize: "14px", color: "#3D404A" }}>{idea}</button>)}
            </div>
            <button type="button" role="switch" aria-checked={row.incognito ? "true" : "false"} onClick={() => setIncognito((v) => { if (!v) saveDraft("chat:" + botId, ""); return !v; })}
              style={{ display: "flex", alignItems: "center", gap: "10px", height: "40px", padding: "0 16px 0 8px", border: 0, borderRadius: "999px", background: row.incognito ? "#12131A" : "rgba(18,19,26,.06)", color: row.incognito ? "#FFFFFF" : "#12131A", cursor: "pointer", fontSize: "14px", fontWeight: 500 }}>
              <span aria-hidden="true" style={{ width: "34px", height: "22px", borderRadius: "11px", background: row.incognito ? "#FFC93C" : "#C9CBD1", position: "relative", transition: "background .15s ease" }}><span style={{ position: "absolute", top: "3px", left: row.incognito ? "15px" : "3px", width: "16px", height: "16px", borderRadius: "50%", background: "#FFFFFF", transition: "left .15s ease" }} /></span>
              {"De incógnito: no guarda nada y se borra en 24 horas"}
            </button>
          </div>
        ) : null}
        {row.opening ? <span style={{ color: "#6B6F7A" }}>{"Abriendo la conversación…"}</span> : null}
        {row.older.length ? (
          <div style={{ alignSelf: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <button type="button" aria-expanded={row.showOlder ? "true" : "false"} onClick={() => setShowOlder((v) => !v)} style={{ ...pill, height: "34px", fontSize: "13px" }}>
              {row.showOlder ? "Ocultar conversaciones anteriores" : `Conversaciones anteriores con ${bot?.name || "este bot"} · ${row.older.length}`}
            </button>
            {row.showOlder ? (
              <div style={{ width: "min(520px, 100%)", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "20px", background: "#FFFFFF", animation: "rise .25s ease-out" }}>
                {row.older.slice(0, 40).map((o) => (
                  <a key={o.id} href={`/chat/${botId}?c=${o.id}`} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", padding: "0 12px", borderRadius: "14px", fontSize: "14px", color: "#12131A", textDecoration: "none" }}>
                    <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</span>
                    <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{whenLabel(o.updatedAt || o.createdAt)}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {row.isOlder ? (
          <p role="note" style={{ margin: 0, alignSelf: "center", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "10px", padding: "10px 16px", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", color: "#3D404A" }}>
            {`Conversación anterior con ${bot?.name || "este bot"}`}
            <a href={`/chat/${botId}`} style={{ fontWeight: 600, color: "#12131A", textDecoration: "underline" }}>{"Volver al chat"}</a>
          </p>
        ) : null}
      </>);
      case "user": {
        // What you attached (never the files the bots made in the mission folder).
        const attachments = m.attachments || [];
        return (
          <UserBubble message={m}>
            {attachments.length ? <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{attachments.map((f) => f.name || f).join(" · ")}</span> : null}
            {m.failed ? <FailedLine error={m.failed} onRetry={() => acts.current.resend(m)} onDiscard={() => unshowSent(`/missions/${c}`, m.id)} /> : null}
          </UserBubble>
        );
      }
      case "secret": return <SecretLine message={m} approval={row.approval} bots={bots} />;
      case "note": return <p style={{ margin: "0", textAlign: "center", fontSize: "13px", color: "#6B6F7A" }}>{plain(m.text)}</p>;
      case "question": return row.a?.status === "pending"
        ? <NeedCard a={row.a} bot={row.bot} mission={row.mission} inline />
        : <QuestionCard approval={row.a} text={m.text} bots={bots} variant="chat" />;
      case "answer": return (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {row.author && row.author.id !== botId ? <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}><BotPresence bot={row.author} size={18} state="rest" /><strong style={{ fontWeight: 600 }}>{row.author.name}</strong></span> : null}
          <BotAnswer message={m} bot={row.author} step={row.step} bots={bots} trail={row.trail} onRetry={row.retryText ? () => acts.current.retry(row.retryText) : null}>
            {m.text && row.step?.tools?.length ? <Sources text={m.text} tools={row.step.tools} /> : null}
          </BotAnswer>
          {row.artifact ? <FileCard artifact={row.artifact} onOpen={() => acts.current.toggleDoc(row.artifact.id)} /> : null}
          {(row.more || []).map((a) => <FileCard key={a.id} artifact={a} onOpen={() => acts.current.toggleDoc(a.id)} />)}
          {row.undo ? <UndoChanges cp={row.undo} missionId={c} bot={row.author} working={row.working} later={row.undoLater} /> : null}
        </div>
      );
      case "trail": return <WorkTrail step={row.step} bots={bots} running />;
      case "now": return <WorkNow step={row.step} live={row.live} bot={row.bot} bots={bots} narration={row.narration} />;
      case "need": return <NeedCard a={row.a} bot={row.bot} mission={row.mission} inline />;
      case "error": return row.limited ? <LimitBanner mission={row.mission} botName={row.name} /> : <p role="alert" style={{ margin: 0, padding: "16px 18px", background: "#FBE7DF", borderRadius: "20px", fontSize: "15px", lineHeight: "1.5" }}><strong>{`${row.name} no puede seguir: `}</strong>{row.error}</p>;
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

  if (ready && !known) {
    return (
      <Shell active="conversaciones" scroll={false}>
        <div style={{ display: "flex", height: "100%" }}>
          <ConvList current={null} />
          <section style={{ flex: "1", display: "grid", placeItems: "center", padding: "40px", textAlign: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
              <strong style={{ font: "600 24px/1.1 'Bricolage Grotesque', sans-serif" }}>{"Este bot ya no está en tu colmena"}</strong>
              <a href="/colmena" style={{ height: "46px", display: "flex", alignItems: "center", padding: "0 22px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontWeight: 600 }}>{"Ver tu colmena"}</a>
            </div>
          </section>
        </div>
      </Shell>
    );
  }

  const state = pending.length ? "wait" : turn ? "work" : "rest";
  const color = bot?.color || "#7B4DFF";
  // «Tus novedades» (server/watch.mjs) is never «terminado»: it keeps watching.
  const asks = pending.length || (!turn && mission?.watchAsks > 0);
  // A bot's single chat never «ends»: at rest it shows the bot's role.
  const done = mission?.status === "completed" && !mission?.watch && !mission?.thread;
  const status = asks ? (pending.length ? "Te necesita" : "Espera tu respuesta") : turn ? (runningStep?.narration?.text || (now?.verb ? verbLabel(headPhase) + (now.detail ? " · " + now.detail : "") : "Pensando")) : mission?.watch ? "Atento a lo nuevo en tus apps" : done ? "Terminado" : bot?.role || "";
  const statusColor = asks ? "#8A5A00" : turn ? "#5C606C" : done ? "#0B6B4A" : "#5C606C";
  const line = asks ? "#FFC93C" : turn ? color + "1F" : done ? "#0B8A5F" : "rgba(18,19,26,.06)";

  return (
    <InteractiveContext.Provider value={{ send: c ? (t) => post(`/missions/${c}/messages`, { text: t }) : null }}>
      <Shell active="conversaciones" scroll={false}>
        <div style={{ display: "flex", height: "100%", alignItems: "stretch" }}>
          <ConvList current={c} />
          <section aria-label={`Conversación con ${bot?.name || ""}`} style={{ flex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
            <header style={{ flex: "none", background: "#F5F5F2" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px", padding: "22px clamp(20px, 4vw, 44px) 18px" }}>
                <span style={{ transition: "filter .4s ease" }}><BotPresence bot={bot} size={44} state={state} /></span>
                <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
                  <h1 style={{ margin: "0", font: "600 24px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em" }}>{bot?.name}</h1>
                  <span role="status" style={{ fontSize: "14px", color: statusColor, transition: "color .3s ease", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
                </div>
                <a href={`/colmena/${botId}`} style={pill}>{`Sobre ${bot?.name || "el bot"}`}</a>
                <button type="button" onClick={() => setRoomSheet(true)} style={pill}>{"Llevar a una sala"}</button>
                {c ? (
                  <span style={{ position: "relative" }}>
                    <button type="button" aria-haspopup="menu" aria-expanded={moreOpen ? "true" : "false"} aria-label="Más opciones" onClick={() => setMoreOpen((v) => !v)} style={{ ...pill, width: "40px", padding: 0, justifyContent: "center", fontWeight: 700 }}>{"···"}</button>
                    {moreOpen ? (
                      <div role="menu" onMouseLeave={() => setMoreOpen(false)} style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 30, width: "250px", padding: "6px", borderRadius: "18px", background: "#FFFFFF", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35), 0 0 0 1px rgba(18,19,26,.06)", animation: "rise .2s ease-out", display: "flex", flexDirection: "column" }}>
                        {[["Archivos de la conversación", () => dock.toggle(FILES_TAB)], ["Preguntar aparte", () => dock.toggle(ASIDE_TAB)], ["Exportar a Word", () => exportConversation(c, "word", { bots })], ["Exportar a Markdown", () => exportConversation(c, "markdown", { bots })], ["Copiar como Markdown", () => exportConversation(c, "copy", { bots })], ["Chat de incógnito", () => navigate(`/chat/${botId}?nuevo=incognito`)]].map(([label, fn]) => (
                          <button key={label} type="button" role="menuitem" onClick={() => { setMoreOpen(false); Promise.resolve(fn()).catch(() => {}); }} style={{ minHeight: "44px", padding: "0 12px", border: 0, borderRadius: "12px", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "14px" }}>{label}</button>
                        ))}
                      </div>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <div aria-hidden="true" style={{ position: "relative", height: "2px", overflow: "hidden", background: "rgba(18,19,26,.06)" }}>
                <span style={{ position: "absolute", inset: "0", transition: "background .4s ease", background: line }} />
                {turn ? <span style={{ position: "absolute", top: "0", bottom: "0", width: "35%", background: `linear-gradient(90deg, transparent, ${color}, transparent)`, animation: "sweep 1.8s ease-in-out infinite" }} /> : null}
              </div>
            </header>
            {mission?.incognito ? <p role="note" style={{ margin: 0, padding: "10px clamp(20px, 4vw, 44px)", background: "#12131A", color: "#FFFFFF", fontSize: "13px" }}>{`De incógnito: ${bot?.name || "el bot"} no guarda nada de esta conversación y se borra en 24 horas.`}</p> : null}
            <div style={{ flex: "1", minHeight: 0, display: "flex" }}>
              {c ? <SelectionPopup scope={scope} onQuote={(t) => quoteInto(c, t)} onAsk={(t) => { askAsideAbout(c, t); dock.open(ASIDE_TAB); }} /> : null}
              <Timeline key={c || "nuevo:" + botId} listKey={c || "nuevo:" + botId} handle={timeline} rows={rows} renderRow={renderRow} estimate={estimateRow}
                hasOlder={room.olderCount > 0} loadingOlder={room.loadingOlder} olderError={room.olderError} onReachTop={room.showOlder} onBelow={setBelow}
                scrollerRef={scroller} contentRef={scope} style={{ WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 40px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 40px)" }} />
              {c ? <SideDock dock={dock} tabs={dockTabs} addable={dockAddable} widthKey="chat" label="Panel de la conversación" /> : null}
            </div>
            {c ? <PositionRail scroller={scroller} items={railItems(messages, (b) => findBot(bots, b || botId).name)} version={messages.length} locate={railLocate} /> : null}
            {/* An older chat is read-only: you keep talking in the bot's single chat. */}
            {isOlder ? null : (
            <Composer value={text} onChange={setText} onKeyDown={onKeyDown} onSubmit={submit} inputRef={inputRef} inputProps={mentions.inputProps} menu={plusOpen ? <PlusMenu open onClose={() => { setPlusOpen(false); requestAnimationFrame(() => inputRef.current?.focus()); }} onFiles={attach} onCapture={(file) => addFiles([file])} onError={setFileError} chosen={chosen} onToggle={toggleChosen} text={text} botId={botId} /> : mentions.menu}
              attachOpen={plusOpen} mentionBots={bots} chips={chosenChips(chosen)} onRemoveChip={(k) => setChosen((list) => list.filter((x) => x !== k))}
              label={`Responder a ${bot?.name || ""}`} placeholder={turn ? (whileWorking === "steer" ? `Sigue escribiendo: ${bot?.name || "el bot"} lo lee en su siguiente paso` : `Sigue escribiendo: se lo pasas cuando ${bot?.name || "termine"} acabe`) : `${c ? "Responde a" : "Escribe a"} ${bot?.name || ""}…`}
              working={turn} onStop={stopTurn} files={files} onRemoveFile={(i) => setFiles(files.filter((_, j) => j !== i))} onInlinePasted={(i) => { const f = files[i]; setFiles(files.filter((_, j) => j !== i)); setText((t) => (t.trim() ? t.replace(/\s*$/, "\n\n") : "") + f.content); }}
              onAttach={() => setPlusOpen((v) => !v)} drop={drop} busy={send.busy}
              above={<>
                <NewBelow show={below} onClick={follow.toEnd} />
                {pending.filter((a) => a.kind === "secret").map((a) => <SecretPrompt key={a.id} approval={a} bots={bots} />)}
                <BtwNotes btw={btw} botName={bot?.name} nameOf={(id) => findBot(bots, id)?.name} />
                <Suggestions list={suggestions} onPick={(t) => { setText(t); requestAnimationFrame(() => inputRef.current?.focus()); }} />
              </>}
              below={<>
                {send.error || fileError || control.error ? <p role="alert" style={{ margin: "8px 18px 0", fontSize: "13px", color: "#B4372A" }}>{send.error || fileError || control.error}</p> : null}
                {turn || stash.length || stashed ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", margin: "10px 6px 0" }}>
                    {turn ? <WhileWorking value={whileWorking} onChange={chooseWhileWorking} botName={bot?.name} typing={!!text.trim()} /> : null}
                    <span style={{ flex: "1" }} />
                    <Stash entries={stash} saved={stashed} onRestore={restoreStash} onDelete={(entry) => unstash(entry.id)} />
                  </div>
                ) : null}
                {c ? <MessageQueue queue={queue} botName={bot?.name} missionPaused={mission?.status === "paused" && !mission?.limited} onResumeMission={resumeMission} resumeBusy={control.busy} working={turn} /> : null}
              </>} />
            )}
          </section>
        </div>
        {roomSheet ? <NewConversation preset={[botId]} onClose={() => setRoomSheet(false)} /> : null}
      </Shell>
    </InteractiveContext.Provider>
  );
}
