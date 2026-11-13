import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FolderOpen, Globe, ListChecks, Lock, MessageCircleQuestion, MessageSquareReply, MessagesSquare, SquareTerminal, Users } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import NowBar from "../components/v2/chat/NowBar.jsx";
import { BotMark } from "../components/v2/chat/Mark.jsx";
import { get, patch, post } from "../lib/api.js";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useFollow } from "../lib/useStickToBottom.js";
import { comboLabel, useDock, usePanelShortcuts } from "../lib/useDock.js";
import { useRevealMessage } from "../lib/reveal.js";
import { useResource, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { findBot, useDismiss } from "../components/room/common.jsx";
import { useRoom } from "../components/room/useRoom.js";
import ArtifactPanel from "../components/room/ArtifactPanel.jsx";
import SideDock from "../components/room/SideDock.jsx";
import PositionRail, { railItems } from "../components/room/PositionRail.jsx";
import FilesPanel, { FileView, fileIcon } from "../components/room/FilesPanel.jsx";
import BrowserLive from "../components/computer/BrowserLive.jsx";
import TerminalPanel, { commandsOf } from "../components/computer/TerminalPanel.jsx";
import { useAutoPreview } from "../lib/autoPreview.js";
import { useOpenFileRequests } from "../components/v2/chat/ChangedFiles.jsx";
import AsidePanel, { askAsideAbout } from "../components/room/AsidePanel.jsx";
import SelectionPopup, { quoteInto } from "../components/room/SelectionPopup.jsx";
import { BlockerBand, StuckBand, RepliesPanel, ProgressPanel, RoomComposer, RoomMessages, ThreadPanel, typingInfo, withOrphanQuestions, OlderMessages } from "../components/room/RoomParts.jsx";
import { CatchUp, NewRoom, RulesPanel, useSince } from "../components/room/RoomExtras.jsx";
import { BotNames, HandoffLine, PersonAvatar, StatusLine } from "../components/room/Author.jsx";
import MemberPanel from "../components/room/MemberPanel.jsx";
import RoomInvite from "../components/room/RoomInvite.jsx";
import RoomAsks from "../components/room/RoomAsks.jsx";
import RowBoundary from "../components/RowBoundary.jsx";
import PeopleMessage from "../components/v2/people/PeopleMessage.jsx";
import PeopleThread from "../components/v2/people/ThreadPanel.jsx";
import ShareSearch from "../components/v2/people/ShareSearch.jsx";
import { FileViewer } from "../components/v2/people/PeerFiles.jsx";
import { LimitBanner } from "../components/v2/LimitNotice.jsx";
import { RELAY_LABEL, editMessage, fileBase64, unsendMessage } from "../lib/peers.js";
import { isHidden, later, reversible, useToasts } from "../lib/undoToast.js";
import { isTask, roomLinks } from "../lib/rooms.js";
import { botNameLabels, firstName, initialsOf, listNames } from "../lib/identity.js";
import { askWaiting, authorOf, authorView, headerBots, itemType, liveLines, roomEmpty, memberPanel, roomPlace, stackLabel, thinkingLeft, withoutRepeats } from "../lib/roomView.js";
import { useAnnouncer } from "../lib/useAnnouncer.js";
import { messageListProps } from "../lib/messageKeys.js";
import Announcer from "../components/Announcer.jsx";
import { useRoomTimeline } from "../lib/useRoomTimeline.js";
import { CompletionNote } from "../components/v3/dia/Completion.jsx";
import NotFound from "./NotFound.jsx";

// The one room screen (docs/PLAN-equipo-y-salas.md, scope 3; docs/CONTRACT.md §18): every room,
// private or with people, at /sala/:id. A room is the parent of a sala of your bots (a mission,
// on this computer) and of a conversation with people (a share, through the mailbox); it may
// have one or both. Your own bots keep everything a sala does (live text, tool cards, plan,
// questions, approvals, restore points, queue); the people keep everything a conversation does
// (delivery states, typing, presence, edits, reactions, threads, files, meetings, errands).
// A person is a circle with a name; a bot its shape, its role and whose it is (room/Author.jsx).
const I = { size: 15, strokeWidth: 2.2, "aria-hidden": "true" };
const BROWSING = ["navegando", "rellenando un formulario", "usando el ordenador", "ejecutando una tarea"];
const SHORTCUTS = { aparte: "mod+shift+s", archivos: "mod+shift+b", progreso: "mod+alt+shift+e", hilo: "mod+alt+shift+j", navegador: "mod+alt+shift+u", terminal: "mod+alt+shift+t", reglas: "mod+alt+shift+r" };
const TABS = Object.fromEntries(["hilo", "progreso", "archivos", "navegador", "terminal", "aparte", "reglas"].map((k) => [k, { id: k, kind: k }]));
const popover = { position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, width: "260px", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-lg)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "rise .15s ease-out" };
const menuItem = { minHeight: "38px", display: "flex", alignItems: "center", gap: "10px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "var(--t-ui)", color: "#12131A", width: "100%" };
const outline = { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "var(--r-pill)", background: "#FFFFFF", color: "#12131A", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer" };
const MEMBERS_KEY = "colmena:room-members";
const hidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };
const EMPTY = [];

export default function RoomScreen({ params = {}, query = {} }) {
  if (params.id === "nueva") return <NewRoom query={query} />;
  return <Room id={params.id} query={query} />;
}

/** The member panel stays as you left it (open by default), in every room. */
function useMembersOpen() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(MEMBERS_KEY) !== "0"; } catch { return true; } });
  const set = useCallback((v) => { setOpen(v); try { localStorage.setItem(MEMBERS_KEY, v ? "1" : "0"); } catch {} }, []);
  return [open, set];
}

/** A small menu under a header button: Escape or a click outside closes it; arrows move. */
function HeaderMenu({ label, button, items, style = null, children = null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  useEffect(() => { if (open) ref.current?.querySelector("[role=menuitem]")?.focus(); }, [open, ref]);
  const keys = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...e.currentTarget.querySelectorAll("[role=menuitem]")];
    list[(list.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
  };
  return (
    <span ref={ref} style={{ position: "relative" }}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} style={{ ...style, background: open ? "#EBEBE6" : style?.background }}>{button}</button>
      {open ? (
        <div role="menu" aria-label={label} onKeyDown={keys} style={popover}>
          {children}
          {items.map(([text, run, tone]) => <button key={text} type="button" role="menuitem" onClick={() => { setOpen(false); run(); }} style={{ ...menuItem, color: tone === "danger" ? "#B4372A" : "#12131A" }}>{text}</button>)}
        </div>
      ) : null}
    </span>
  );
}

function Room({ id, query }) {
  const store = useStore();
  const { bots, ready, run, peers, missions = EMPTY, teams = EMPTY } = store;
  useToasts(); // a message being deleted hides until its «Deshacer» runs out
  const path = id ? `/rooms/${encodeURIComponent(id)}` : null;
  const viewRes = useResource(path);
  const view = viewRes.data && viewRes.data.id ? viewRes.data : null;
  // Until the room answers, the state's list already says what it is made of.
  const listed = useMemo(() => (store.rooms || EMPTY).find((r) => r.id === id || r.missionId === id || r.shareId === id) || null, [store.rooms, id]);
  const links = view ? { id: view.id, missionId: view.missionId || null, shareId: view.shareId || null } : listed ? { id: listed.id, ...roomLinks(listed, missions) }
    // A task of Trabajo opened as a sala (an old link): it is not a room, its mission still shows.
    : { id, missionId: missions.some((m) => m.id === id) ? id : null, shareId: null };
  const { missionId, shareId } = links;
  const roomId = links.id;
  const shared = !!shareId;
  const refreshView = useCallback(() => { if (path) get(path).then((d) => viewRes.setData(d)).catch(() => {}); }, [path, viewRes.setData]); // eslint-disable-line react-hooks/exhaustive-deps

  // One address per room, so the sidebar's row is the open one however you got here: a room
  // with people at its own id, a private one at its sala's (the address it always had).
  const canonical = view ? (view.shareId ? view.id : view.missionId || view.id) : null;
  useEffect(() => {
    if (canonical && canonical !== id) navigate(`/sala/${encodeURIComponent(canonical)}${window.location.search || ""}`, { replace: true });
  }, [canonical, id]);
  // A task of Trabajo is not a room: /sala/<task> opens its page, unless its own page asked for
  // its conversation («Hablar con el equipo»: ?conversacion=1).
  const taskId = !view && !listed && !query?.conversacion && missions.some((m) => m.id === id && isTask(m) && !m.conversation) ? id : null;
  useEffect(() => { if (taskId) navigate(`/encargo/${encodeURIComponent(taskId)}`, { replace: true }); }, [taskId]);

  const room = useRoom(missionId);
  // Other owners' bots at work arrive live (`room-activity`): into the room view, no request.
  const tl = useRoomTimeline(roomId, shareId, (activity) => viewRes.setData((d) => (d && d.id ? { ...d, activity } : d)));
  const follow = useFollow(roomId);
  const scope = useRef(null);
  const scroller = useRef(null);
  const [membersOpen, setMembersOpen] = useMembersOpen();
  const [sheet, setSheet] = useState(null); // "invitar"
  const [renaming, setRenaming] = useState(null); // the title being typed
  const [leaving, setLeaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [viewing, setViewing] = useState(null); // a shared file open in the viewer
  const [sending, setSending] = useState(EMPTY); // names of files being sealed and sent
  const [error, setError] = useState(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  useEffect(() => { setError(null); setSearching(false); setLeaving(false); setRenaming(null); setSheet(null); }, [roomId]);

  const { mission, steps: missionSteps, thread, artifacts, approvals, live, activity, memberIds } = room;
  // What someone asked one of your bots here is decided on its own card (RoomAsks), once.
  const asks = view?.asks || EMPTY;
  // Its approval reaches the state before the room view is read again: never drawn from there too.
  const pending = useMemo(() => (room.pending.some((a) => a.roomRequest) ? room.pending.filter((a) => !a.roomRequest) : room.pending), [room.pending]);
  const requestKey = (store.approvals || EMPTY).filter((a) => a.roomRequest && (a.roomId === roomId || a.roomRequest.roomId === roomId)).map((a) => a.id + ":" + a.status).join(",");
  useEffect(() => { if (shared && requestKey) refreshView(); }, [shared, requestKey, refreshView]);
  const [sharedOut, setSharedOut] = useState({}); // artifact id → "busy" | "done"
  const shareArtifact = async (artifact) => {
    setSharedOut((x) => ({ ...x, [artifact.id]: "busy" }));
    try { await post(`/rooms/${encodeURIComponent(roomId)}/share`, { artifactId: artifact.id }); setSharedOut((x) => ({ ...x, [artifact.id]: "done" })); tl.reload(); }
    catch (e) { setError(e.message); setSharedOut((x) => ({ ...x, [artifact.id]: undefined })); }
  };
  const shareSlot = (artifact) => (
    <button type="button" disabled={!!sharedOut[artifact.id]} onClick={() => shareArtifact(artifact)} title="Las personas de la sala podrán abrirlo. Sale cifrado de tu ordenador."
      style={{ alignSelf: "flex-start", minHeight: "32px", padding: "0 12px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-pill)", background: "#FFFFFF", color: "#12131A", fontSize: "var(--t-meta)", fontWeight: 500, cursor: sharedOut[artifact.id] ? "default" : "pointer" }}>
      {sharedOut[artifact.id] === "done" ? "Compartido en la sala" : sharedOut[artifact.id] === "busy" ? "Compartiendo…" : "Compartir en la sala"}
    </button>
  );
  // The rows: a room with people reads the merged timeline; a private one, its sala.
  const rows = useMemo(() => {
    const base = shared ? withoutRepeats(tl.rows.filter((m) => itemType(m) && !isHidden("peermsg:" + m.id))) : room.spoken || room.messages;
    return withOrphanQuestions(base, pending);
  }, [shared, tl.rows, room.spoken, room.messages, pending]);
  const missionRows = useMemo(() => (shared ? rows.filter((m) => itemType(m) === "mission") : room.messages), [shared, rows, room.messages]);
  // Steps of older pages come with the timeline; the live ones (with what the bot said) with the sala.
  const steps = useMemo(() => {
    if (!shared) return missionSteps;
    const at = new Map(tl.steps.map((s) => [s.id, s]));
    for (const s of missionSteps) at.set(s.id, s);
    return [...at.values()];
  }, [shared, tl.steps, missionSteps]);

  const loaded = shared ? !tl.loading : !room.loading && (!!mission || !!view || !!viewRes.error);
  useRevealMessage(query?.hilo ? null : query?.m || null, { ready: loaded && (shared || !!mission), olderCount: shared ? (tl.more ? 1 : 0) : room.olderCount, showOlder: shared ? tl.older : room.showOlder });
  const since = useSince(roomId, missionRows);
  const dock = useDock(roomId, { transient: (t) => t.kind === "navegador" });
  const progress = mission?.progress || { done: steps.filter((s) => ["completed", "done"].includes(s.status)).length, total: steps.filter((s) => s.kind !== "plan").length };
  const typing = mission ? typingInfo({ mission, activity, live, bots, steps }) : null;
  useEffect(() => { if (query?.panel && TABS[query.panel]) dock.open(TABS[query.panel]); }, [query?.panel]); // eslint-disable-line react-hooks/exhaustive-deps
  const browsing = activity.find((a) => BROWSING.includes(a.verb));
  const dismissed = useRef(false);
  useEffect(() => { dismissed.current = false; }, [roomId]);
  useEffect(() => { if (browsing && !dismissed.current && !dock.tabs.some((t) => t.kind === "navegador")) dock.open(TABS.navegador); }, [!!browsing]); // eslint-disable-line react-hooks/exhaustive-deps
  const dockView = { ...dock, close: (tabId) => { if (tabId === "navegador") dismissed.current = true; dock.close(tabId); } };
  const openDoc = (artifactId) => { const tabId = "doc:" + artifactId; if (dock.isVisible(tabId)) return dock.close(tabId); dock.open({ id: tabId, kind: "doc", artifactId }); };
  const openReplies = (msgId) => { const tabId = "respuestas:" + msgId; if (dock.isVisible(tabId)) return dock.close(tabId); dock.open({ id: tabId, kind: "respuestas", parentId: msgId }); };
  const openFile = (f) => dock.open({ id: "file:" + f.path, kind: "file", path: f.path, name: f.name, type: f.type });
  usePanelShortcuts(Object.entries(SHORTCUTS).map(([key, combo]) => ({ combo, run: () => dock.toggle(TABS[key]) })), !!mission);
  const workVersion = useMemo(() => steps.reduce((n, s) => n + (s.activity?.length || 0), 0) + artifacts.length + missionRows.length, [steps, artifacts, missionRows]);
  // A web page a bot just made opens in «Vista previa» beside the room (OpenClaw's Canvas).
  useAutoPreview(missionId, artifacts, (wf) => dock.open({ id: "file:" + wf, kind: "file", path: wf, name: wf.split("/").pop(), type: "code" }));
  // A file named in an answer or in «Archivos cambiados» opens beside the room.
  useOpenFileRequests(missionId, openFile);

  // ---- who is here
  const working = (b) => activity.some((a) => a.botId === b.id) || live.some((l) => l.botId === b.id);
  const soloView = useMemo(() => (mission ? {
    id: roomId, title: mission.room || mission.title || "sala", private: true, mine: true, missionId, shareId: null,
    people: [{ address: peers?.me?.address || "me", name: store.settings?.userName || "Tú", role: "owner", presence: "online", you: true }],
    bots: [{ owner: { address: peers?.me?.address || "me", name: "Tú", you: true }, bots: memberIds.map((b) => findBot(bots, b)).filter(Boolean) }],
  } : null), [mission, roomId, missionId, memberIds, bots, peers, store.settings?.userName]);
  const shown = view || soloView;
  const panel = useMemo(() => memberPanel(shown, {
    working: bots.filter(working).map((b) => b.id), waiting: [...pending.map((a) => a.botId), ...asks.filter((a) => a.state === "asked").map((a) => a.bot?.id)], activity: shown?.activity || EMPTY,
  }), [shown, bots, activity, live, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  // A name two visible bots share reads «Vera · de Lucía» in every author line (identity.js).
  const botNames = useMemo(() => botNameLabels(shown?.bots || EMPTY), [shown]);
  const title = shown?.title || mission?.room || mission?.title || "sala";
  const place = roomPlace(shown, teams);
  const myBots = useMemo(() => (shown?.bots || EMPTY).filter((g) => g.owner?.you).flatMap((g) => g.bots), [shown]);
  const gone = !!(view?.left || view?.removed);
  const guest = !!view?.people?.find((p) => p.you && p.role === "guest");
  const relay = peers?.relay?.status || "off";

  // What other owners' bots are doing right now («Vera espera el OK de Sergio»): neutral lines.
  const liveNow = useMemo(() => (shared ? liveLines(view?.activity) : EMPTY), [shared, view?.activity]);
  // Your own bots at work show as a live turn of the sala: not again as «está pensando».
  // A sala you stopped keeps its turn open: its bots are not «pensando» either.
  const held = mission?.status === "paused";
  const mineBusy = useMemo(() => bots.filter((b) => held || activity.some((x) => x.botId === b.id) || live.some((l) => l.botId === b.id)).map((b) => b.name), [bots, activity, live, held]);
  const thinking = useMemo(() => thinkingLeft(tl.thinking, view?.activity || EMPTY, mineBusy), [tl.thinking, view?.activity, mineBusy]);

  // ---- the people's side: who «@» means, threads, files, edits
  const mentionable = useMemo(() => (view?.bots || EMPTY).flatMap((g) => g.bots.map((b) => ({ owner: g.owner.address, bot: b.id, name: b.name, role: b.role, color: b.color, shape: b.shape, mine: !!g.owner.you, note: g.owner.you ? "tu bot" : "de " + firstName(g.owner.name) }))), [view]);
  const botOf = useCallback((owner, bot) => mentionable.find((x) => x.owner === owner && x.bot === bot) || null, [mentionable]);
  const sameName = useCallback((name) => mentionable.filter((x) => x.name.toLowerCase() === String(name).toLowerCase()).length > 1, [mentionable]);
  const others = useMemo(() => (view?.people || EMPTY).filter((p) => !p.you).map((p) => ({ id: p.address, name: p.name, initials: initialsOf(p.name), online: p.presence === "online", status: "active" })), [view]);
  const threadId = shared ? query?.hilo || null : null;
  const here = `/sala/${encodeURIComponent(roomId)}`;
  const openThread = useCallback((m) => navigate(here + "?hilo=" + encodeURIComponent(m.id)), [here]);
  const closeThread = useCallback(() => navigate(here, { replace: true }), [here]);
  const peerDo = useCallback((fn) => async (...args) => { await fn(...args); await tl.reload(); }, [tl.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const react = useMemo(() => peerDo((messageId, emoji) => post(`/peers/messages/${encodeURIComponent(messageId)}/reactions`, { emoji })), [peerDo]);
  const retry = useMemo(() => peerDo((messageId) => post(`/peers/messages/${encodeURIComponent(messageId)}/retry`)), [peerDo]);
  const edit = useMemo(() => peerDo((messageId, text) => editMessage(messageId, text)), [peerDo]);
  // «Borrar para todos» waits for its «Deshacer» before anything leaves this computer.
  const remove = useCallback((m) => later({ id: "peermsg:" + m.id, keys: ["peermsg:" + m.id], text: "Mensaje borrado para todos", error: "No se pudo borrar", run: async () => { await unsendMessage(m.id); await tl.reload(); } }), [tl.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  // Files: each one sealed here and sent on its own; its row shows as soon as it is out.
  const attach = async (files) => {
    for (const file of files) {
      setSending((list) => [...list, file.name]);
      try { await post(`/peers/shares/${encodeURIComponent(shareId)}/files`, { name: file.name, content: await fileBase64(file) }); await tl.reload(); }
      catch (e) { setError(file.name + ": " + e.message); }
      finally { setSending((list) => list.filter((n) => n !== file.name)); }
    }
  };
  const lastSeenMine = useMemo(() => [...rows].reverse().find((m) => m.engine === "peer" && m.from === "me" && m.seenBy?.length)?.id || null, [rows]);
  const foreign = useCallback((m) => itemType(m) !== "mission", []);
  const renderForeign = (m, { continued }) => {
    const type = itemType(m);
    if (type === "status") return <StatusLine key={m.id} item={m} />;
    if (type === "handoff") return <HandoffLine key={m.id} item={m} />;
    if (type !== "peer") return null;
    const waits = askWaiting(m);
    return (
      <RowBoundary key={m.id} resetKey={m.id + ":" + (m.edited || "") + ":" + (m.status || "") + ":" + (waits ? "w" : "")}>
        <PeopleMessage m={m} dm={false} botOf={botOf} shared={sameName} lastSeen={m.id === lastSeenMine} continued={continued} onMeeting={tl.reload}
          onReact={react} onRetry={retry} onEdit={edit} onDelete={remove} onThread={m.local || gone ? null : openThread} onOpenFile={setViewing} onError={setError} />
        {/* It waits for you: a honey dot and where to decide (the card is over the composer). */}
        {waits ? (
          <a href={"#" + waits.anchor} onClick={(e) => { const card = document.getElementById(waits.anchor); if (!card) return; e.preventDefault(); card.scrollIntoView({ block: "nearest" }); card.querySelector("button")?.focus({ preventScroll: true }); }}
            style={{ alignSelf: "flex-start", margin: "0 0 4px 52px", display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "var(--t-meta)", fontWeight: 600, color: "#12131A", textDecoration: "none" }}>
            <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "var(--r-circle)", background: "#FFC93C", boxShadow: "0 0 0 1px rgba(18,19,26,.18)" }} />{waits.text + " · decidir"}
          </a>
        ) : null}
      </RowBoundary>
    );
  };

  // ---- seen: open, visible and at the end of the conversation
  const newest = rows.length ? rows[rows.length - 1].id : null;
  const marked = useRef(null);
  useEffect(() => { marked.current = null; }, [roomId]);
  useEffect(() => {
    if (!shown || !loaded || gone || follow.below) return undefined;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      const key = newest || "none";
      if (marked.current === key && !view?.unread) return;
      marked.current = key;
      post(`/rooms/${encodeURIComponent(roomId)}/seen`).catch(() => {});
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [roomId, newest, loaded, gone, follow.below, view?.unread, !!shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // Presence and roles change without a record on this computer: the room again now and then.
  useEffect(() => {
    if (!shared) return undefined;
    const t = setInterval(refreshView, 20000);
    return () => clearInterval(t);
  }, [shared, refreshView]);
  useEffect(() => { if (shared) refreshView(); }, [shared, tl.top.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // New rows and «te espera», said once to a screen reader (lib/useAnnouncer.js): only records
  // reach here, never text as it is written, and never what you wrote yourself.
  const spokenRows = useMemo(() => rows.map((m) => {
    const a = authorOf(m, bots);
    return { id: m.id, name: authorView(a).name, text: m.deleted ? "" : m.text || "", skip: !!m.optimistic || !!m.local || m.kind === "progress" || a.kind === "system" || (a.kind === "person" && a.you) };
  }), [rows, bots]);
  const waitingNow = useMemo(() => [
    ...pending.map((a) => ({ id: a.id, name: bots.find((b) => b.id === a.botId)?.name || "", kind: a.kind })),
    ...asks.filter((a) => a.state === "asked").map((a) => ({ id: "ask:" + a.id, name: a.bot?.name || "", kind: "ask" })),
  ], [pending, asks, bots]);
  const news = useAnnouncer({ scope: roomId, ready: loaded, items: spokenRows, waiting: waitingNow });
  // The page before: what you were reading stays where it was.
  const olderPage = async () => {
    const el = scroller.current, before = el ? el.scrollHeight - el.scrollTop : 0;
    try { await tl.older(); } catch (e) { setError(e.message); }
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  };

  // ---- panels on the right
  const resolve = (t) => {
    if (t.kind === "reglas") return { label: "Bots y reglas", icon: <Users {...I} />, title: "Bots y reglas · " + comboLabel(SHORTCUTS.reglas), render: () => <RulesPanel mission={mission} bots={bots} memberIds={memberIds} /> };
    if (t.kind === "aparte") return { label: "Preguntar aparte", icon: <MessageCircleQuestion {...I} />, title: "Preguntar aparte · " + comboLabel(SHORTCUTS.aparte), render: () => <>{shared ? <p role="note" style={{ margin: "14px 20px 0", padding: "10px 14px", borderRadius: "var(--r-md)", background: "#F6F6F3", fontSize: "var(--t-meta)", lineHeight: 1.5, color: "#3D404A" }}>{"Aparte, solo para ti: lo que preguntes aquí no se envía a nadie de la sala. Se queda en tu ordenador."}</p> : null}<AsidePanel mission={mission} /></> };
    if (t.kind === "hilo") return { label: "Entre bots", icon: <MessagesSquare {...I} />, badge: thread.length || null, render: () => <ThreadPanel bare mission={mission} thread={thread} bots={bots} /> };
    if (t.kind === "progreso") return { label: "Progreso", icon: <ListChecks {...I} />, badge: `${progress.done || 0}/${progress.total || 0}`, render: () => <ProgressPanel bare mission={mission} steps={steps} pending={pending} activity={activity} bots={bots} /> };
    if (t.kind === "archivos") return { label: "Archivos de la sala", icon: <FolderOpen {...I} />, render: () => <FilesPanel missionId={missionId} onOpen={openFile} version={workVersion} /> };
    if (t.kind === "file") return { label: t.name || t.path, icon: fileIcon(t.type), title: t.path, render: () => <FileView missionId={missionId} path={t.path} version={workVersion} /> };
    if (t.kind === "doc") { const a = artifacts.find((x) => x.id === t.artifactId); return { label: a?.title || "Entregable", icon: <FileText {...I} />, render: () => <ArtifactPanel bare artifactId={t.artifactId} bots={bots} variant="room" /> }; }
    if (t.kind === "respuestas") return { label: "Respuestas", icon: <MessageSquareReply {...I} />, badge: rows.filter((m) => m.replyTo === t.parentId).length || null, render: () => <RepliesPanel bare mission={mission} messages={rows} steps={steps} bots={bots} parentId={t.parentId} /> };
    if (t.kind === "navegador") { const who = browsing ? findBot(bots, browsing.botId) : null; return { label: "Navegador", icon: <Globe {...I} />, render: () => <div style={{ padding: "12px 14px" }}><BrowserLive missionId={missionId} bot={who} verb={browsing?.verb || null} missionActive={mission?.status === "running"} /></div> }; }
    if (t.kind === "terminal") return { label: "Terminal", icon: <SquareTerminal {...I} />, badge: commandsOf(steps).length || null, title: "Terminal · " + comboLabel(SHORTCUTS.terminal), render: () => <TerminalPanel steps={steps} bots={bots} missionId={mission?.id || null} onOpenBrowser={() => dock.open(TABS.navegador)} /> };
    return null;
  };
  const tabs = mission ? dock.tabs.map((t) => { const r = resolve(t); return r ? { ...t, ...r } : null; }).filter(Boolean) : [];
  const addableTabs = [["reglas", "Bots y reglas", <Users {...I} />], ["aparte", "Preguntar aparte", <MessageCircleQuestion {...I} />], ["archivos", "Archivos", <FolderOpen {...I} />], ["progreso", "Progreso", <ListChecks {...I} />], ["hilo", "Entre bots", <MessagesSquare {...I} />], ["navegador", "Navegador", <Globe {...I} />], ["terminal", "Terminal", <SquareTerminal {...I} />]]
    .map(([key, label, icon]) => ({ key, label, icon, combo: SHORTCUTS[key], tab: TABS[key] })).filter((a) => !dock.tabs.some((t) => t.id === a.tab.id));

  if (ready && viewRes.error && !view && !listed && !missionId && !viewRes.loading) return <NotFound active="chats" title="Esta sala ya no está" text="Puede que alguien la cerrara o que se archivara. No se ha perdido nada de lo tuyo." />;
  if (ready && !shared && !viewRes.loading && !room.loading && !mission && !view) return <NotFound active="chats" title="Esta sala ya no está" text="Puede que alguien la borrara o que se archivara. No se ha perdido nada de lo tuyo." />;

  const fileCount = artifacts.length + (mission?.files || []).length;
  const aside = dock.isVisible("aparte");
  // A panel open on the right replaces the members; closing it brings them back.
  const dockShown = tabs.length > 0 && !!dock.active && dock.isVisible(dock.active);
  const addableBots = shared ? EMPTY : bots.filter((b) => b.enabled !== false && !memberIds.includes(b.id) && !myBots.some((x) => x.id === b.id));

  // ---- header actions
  const saveName = async (e) => {
    e?.preventDefault();
    const name = String(renaming || "").trim();
    if (!name || name === title) { setRenaming(null); return; }
    try { viewRes.setData(await run(() => patch(path, { title: name }))); setRenaming(null); } catch (err) { setError(err.message); }
  };
  const archive = async () => {
    try {
      await run(() => patch(path, { archived: true }));
      reversible({ text: `Sala «${title}» archivada`, undo: () => run(() => patch(path, { archived: false })) });
      navigate("/chats");
    } catch (err) { setError(err.message); }
  };
  // «Mover a Trabajo»: a private room that is really a task (its way back is «Mover a Salas»).
  const toWork = async () => {
    try { await run(() => patch(`/missions/${encodeURIComponent(missionId)}`, { kind: "tarea" })); navigate(`/encargo/${encodeURIComponent(missionId)}`); } catch (err) { setError(err.message); }
  };
  const leave = async () => {
    try { await run(() => post(path + "/leave")); navigate("/chats"); } catch (err) { setError(err.message); setLeaving(false); }
  };
  const menu = [
    ...(shown?.mine && !shown?.general ? [["Cambiar el nombre", () => setRenaming(title)]] : []),
    ...(shared ? [["Buscar en la sala", () => setSearching(true)]] : []),
    ...(mission ? [
      ["Reglas de la sala", () => dock.toggle(TABS.reglas)],
      ["Archivos de la sala", () => dock.toggle(TABS.archivos)],
      [shared ? "Preguntar aparte (solo para ti)" : "Preguntar aparte", () => dock.toggle(TABS.aparte)],
      ["Progreso", () => dock.toggle(TABS.progreso)],
      ["Entre bots", () => dock.toggle(TABS.hilo)],
      ["Navegador", () => dock.toggle(TABS.navegador)],
      ["Terminal", () => dock.toggle(TABS.terminal)],
      ["Línea de tiempo", () => navigate(`/encargo/${missionId}`)],
    ] : []),
    ...(mission && !shared && !mission.conversation && !isTask(missions.find((x) => x.id === missionId) || mission) ? [["Mover a Trabajo", toWork]] : []),
    ...(view ? [["Archivar la sala", archive]] : []),
    ...(shared && !view?.general && !gone ? [[view?.mine ? "Cerrar la sala para todos" : "Salir de la sala", () => setLeaving(true), "danger"]] : []),
  ];

  const audience = mission && !shared ? (
    <div role="radiogroup" aria-label="Quién lo ve" style={{ display: "inline-flex", padding: "3px", gap: "2px", borderRadius: "var(--r-pill)", background: "#F1F1EC" }}>
      {[["sala", "Toda la sala", !aside], ["yo", "Solo yo y un bot", aside]].map(([key, label, on]) => (
        <button key={key} type="button" role="radio" aria-checked={on ? "true" : "false"} title={key === "yo" ? "Pregunta a un bot sin que la sala lo vea (Preguntar aparte)" : "Lo leen todos los de la sala"}
          onClick={() => { if (key === "yo" ? !aside : aside) dock.toggle(TABS.aparte); }}
          style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none", fontSize: "var(--t-meta)", fontWeight: 500, color: "#12131A", cursor: "pointer" }}>{label}</button>
      ))}
    </div>
  ) : mission && shared ? (
    // With colleagues in the room «Solo yo y un bot» is a private aside: never relayed.
    <button type="button" aria-pressed={aside ? "true" : "false"} onClick={() => dock.toggle(TABS.aparte)} title="Pregunta a uno de tus bots sin que la sala lo vea. No se envía a nadie."
      style={{ height: "36px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "6px", border: 0, borderRadius: "var(--r-pill)", background: aside ? "#12131A" : "#F1F1EC", color: aside ? "#FFFFFF" : "#12131A", fontSize: "var(--t-meta)", fontWeight: 500, cursor: "pointer" }}>
      <MessageCircleQuestion {...I} />{"Aparte, solo para ti"}
    </button>
  ) : null;

  // People typing and other people's bots thinking; files on their way; what went wrong.
  const above = shared && (tl.typing.length || thinking.length || sending.length || error) ? (
    <p role="status" style={{ margin: "0 0 8px", minHeight: "18px", display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: "var(--t-meta)", color: "#5C606C" }}>
      {tl.typing.length ? <span>{listNames(tl.typing.map(firstName)) + (tl.typing.length > 1 ? " están escribiendo…" : " está escribiendo…")}</span> : null}
      {thinking.length ? <span>{listNames(thinking) + (thinking.length > 1 ? " están pensando…" : " está pensando…")}</span> : null}
      {sending.length ? <span>{"Cifrando y enviando " + listNames(sending) + "…"}</span> : null}
      {error ? <span role="alert" style={{ color: "#B4372A" }}>{error}</span> : null}
    </p>
  ) : null;
  const ready2 = !!shown;
  const stackPeople = panel.people.slice(0, 4), stackBots = headerBots(panel);
  const counts = [panel.people.length === 1 ? "1 persona" : `${panel.people.length} personas`, panel.botCount === 1 ? "1 bot" : `${panel.botCount} bots`].join(" · ");
  const send = (text) => (shared ? post(`${path}/messages`, { text }).then(() => tl.reload()) : post(`/missions/${missionId}/messages`, { text }));

  return (
    <InteractiveContext.Provider value={{ send: mission ? send : null }}>
      <BotNames.Provider value={botNames}>
      <Shell active="chats" scroll={false}>
        <div style={{ position: "relative", display: "flex", height: "100%", alignItems: "stretch" }}>
          <main aria-label={"Sala " + title} style={{ flex: "999 1 520px", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
            <Announcer text={news} />
            {ready2 ? (
              <>
                <header style={{ position: "relative", zIndex: 5, flex: "none", background: "rgba(245,245,242,.92)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "14px 26px" }}>
                    <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", marginRight: "auto" }}>
                      {renaming !== null ? (
                        <form onSubmit={saveName} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <label style={{ flex: 1, minWidth: 0, display: "flex" }}>
                            <span style={hidden}>{"Nombre de la sala"}</span>
                            <input className="c-quiet" autoFocus value={renaming} maxLength={60} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setRenaming(null); } }}
                              style={{ flex: 1, minWidth: 0, height: "34px", padding: "0 10px", border: "1px solid rgba(18,19,26,.2)", borderRadius: "var(--r-md)", background: "#FFFFFF", fontSize: "var(--t-body)", fontWeight: 600 }} />
                          </label>
                          <button type="submit" style={{ ...outline, height: "34px", background: "#12131A", borderColor: "#12131A", color: "#FFFFFF" }}>{"Guardar"}</button>
                          <button type="button" onClick={() => setRenaming(null)} style={{ ...outline, height: "34px" }}>{"Cancelar"}</button>
                        </form>
                      ) : <h1 style={{ margin: 0, fontSize: "var(--t-lead)", fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"# " + title}</h1>}
                      <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: "#5C606C", minWidth: 0 }}>
                        {place.private ? <Lock size={12} strokeWidth={2.3} aria-hidden="true" style={{ flex: "none" }} /> : null}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {[place.text, place.private ? place.hint : shown.general ? "todo el equipo" : null, mission?.statusLabel].filter(Boolean).join(" · ")}
                          {mission ? <>{" · "}<a href={`/encargo/${missionId}`}>{"ver la tarea"}</a></> : null}
                        </span>
                      </span>
                    </div>
                    <span role="img" aria-label={stackLabel(panel)} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span aria-hidden="true" style={{ display: "flex" }}>{stackPeople.map((p, i) => <span key={p.address || i} style={{ marginLeft: i ? "-7px" : 0, borderRadius: "var(--r-circle)", boxShadow: "0 0 0 2px #F5F5F2" }}><PersonAvatar person={p} size={26} /></span>)}</span>
                      <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: "5px" }}>{stackBots.map((b) => <BotMark key={(b.mine ? "" : "o:" + (b.owner?.address || "")) + b.id} bot={b} size={18} owner={b.owner} ring="#F5F5F2" state={b.state === "working" || b.state === "thinking" ? "work" : "rest"} />)}</span>
                      <span aria-hidden="true" style={{ fontSize: "var(--t-meta)", color: "#4A4D57", whiteSpace: "nowrap" }}>{counts}</span>
                    </span>
                    {mission?.mode === "debate" ? <a href={`/debate/${missionId}`} style={{ ...outline, textDecoration: "none" }}>{"Elegir propuesta"}</a> : null}
                    {!gone && !guest ? <button type="button" onClick={() => setSheet("invitar")} style={outline}>{"Invitar"}</button> : null}
                    <button type="button" aria-label={membersOpen ? "Ocultar los miembros" : "Ver los miembros"} title={membersOpen ? "Ocultar los miembros" : "Ver los miembros"} aria-expanded={membersOpen && !dockShown ? "true" : "false"} aria-controls="sala-miembros"
                      onClick={() => { if (dockShown) { dock.setOpen(false); setMembersOpen(true); } else setMembersOpen(!membersOpen); }}
                      style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "var(--r-md)", background: membersOpen && !dockShown ? "#EBEBE6" : "transparent", color: "#4A4D57", cursor: "pointer" }}><Users size={17} strokeWidth={2.1} aria-hidden="true" /></button>
                    {menu.length ? <HeaderMenu label="Más opciones" items={menu} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "var(--r-md)", background: "transparent", color: "#4A4D57", cursor: "pointer" }}
                      button={<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg>} /> : null}
                  </div>
                  {searching && shared ? <ShareSearch shareId={shareId} onClose={() => setSearching(false)} /> : null}
                  {leaving ? (
                    <div role="alertdialog" aria-label="Salir de la sala" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "12px 26px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "var(--t-ui)" }}>
                      <span style={{ flex: "1 1 320px", lineHeight: 1.45 }}>{view?.mine ? "Tú creaste esta sala: si sales, se cierra para todos. Cada persona conserva lo que ya tiene." : "Dejarás de recibir lo que se escriba aquí. Lo que ya escribiste sigue en la sala de los demás."}</span>
                      <button type="button" autoFocus onClick={leave} style={{ ...outline, background: "#12131A", borderColor: "#12131A", color: "#FFFFFF" }}>{view?.mine ? "Cerrar para todos" : "Salir"}</button>
                      <button type="button" onClick={() => setLeaving(false)} style={outline}>{"Cancelar"}</button>
                    </div>
                  ) : null}
                </header>
                {/* One honey card per thing that waits: the band only says what is not already drawn below (a row of the conversation or the card over the composer). */}
                {mission ? <BlockerBand mission={mission} pending={pending.filter((a) => a.kind === "question" && !rows.some((m) => m.approvalId === a.id))} bots={bots} /> : null}
                {mission ? <StuckBand mission={mission} bots={bots} /> : null}
                {shared && relay !== "online" ? (
                  <p role="status" style={{ flex: "none", margin: 0, padding: "10px 26px", background: "#ECECE7", color: "#3D404A", fontSize: "var(--t-ui)" }}>
                    {relay === "off" ? "Falta conectar Colmena al buzón de mensajes: Ajustes › Personas." : (RELAY_LABEL[relay] || "Sin conexión con el buzón") + ". Lo que escribas saldrá en cuanto vuelva."}
                  </p>
                ) : null}
                {gone ? <p role="status" style={{ flex: "none", margin: 0, padding: "10px 26px", background: "#ECECE7", color: "#3D404A", fontSize: "var(--t-ui)" }}>{view.removed ? "Ya no estás en esta sala. Puedes leer lo que tenías." : "Saliste de esta sala. Puedes leer lo que tenías."}</p> : null}
                <div style={{ flex: "1", minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div ref={(el) => { follow.ref(el); scroller.current = el; }} {...messageListProps("Mensajes de la sala")} style={{ flex: "1", minHeight: "0", overflowY: "auto", overscrollBehavior: "contain", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 28px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 28px)", display: "flex", flexDirection: "column" }}>
                    <div ref={scope} style={{ width: "100%", maxWidth: "860px", margin: "auto auto 0", padding: "20px 26px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {mission ? <SelectionPopup scope={scope} onQuote={(t) => quoteInto(missionId, t)} onAsk={(t) => { askAsideAbout(missionId, t); dock.open(TABS.aparte); }} /> : null}
                      {mission ? <CatchUp count={since} mission={mission} pending={pending} id={missionId} /> : null}
                      {shared ? (tl.more ? <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 12px" }}><button type="button" onClick={olderPage} style={{ ...outline, height: "34px", fontSize: "var(--t-meta)", fontWeight: 600 }}>{"Ver mensajes anteriores"}</button></div> : null) : <OlderMessages count={room.olderCount} onShow={room.showOlder} />}
                      {loaded && !rows.length ? (() => {
                        const empty = roomEmpty(shown, { teamName: shown?.teamId ? place.text : null });
                        return (
                          <div style={{ alignSelf: "center", maxWidth: "520px", margin: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
                            <strong style={{ font: "600 var(--t-heading)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", textWrap: "balance" }}>{empty.title}</strong>
                            <span style={{ fontSize: "var(--t-body)", lineHeight: 1.55, color: "#4A4D57" }}>{empty.text}</span>
                            {empty.action === "invite" && !gone && !guest ? <button type="button" onClick={() => setSheet("invitar")} style={{ ...outline, marginTop: "6px", background: "#12131A", borderColor: "#12131A", color: "#FFFFFF" }}>{empty.actionLabel}</button> : null}
                          </div>
                        );
                      })() : null}
                      <RoomMessages mission={mission} messages={rows} thread={thread} bots={bots} approvals={approvals} artifacts={artifacts} steps={steps} onOpenArtifact={openDoc} openArtifactId={null} showThread={false} onOpenReplies={mission ? openReplies : null}
                        foreign={shared ? foreign : null} renderForeign={shared ? renderForeign : null} shareSlot={shared && !gone ? shareSlot : null} />
                      {/* A visible end when the sala finishes while you are here (lib/completion.js). */}
                      {mission ? <CompletionNote missionId={missionId} /> : null}
                      {liveNow.length ? <div role="group" aria-label="Bots de otras personas en esta sala" style={{ display: "flex", flexDirection: "column" }}>{liveNow.map((line) => <StatusLine key={line.id} item={line} />)}</div> : null}
                      {mission?.limited ? <LimitBanner mission={mission} botName={mission.limited.botIds?.length === 1 ? findBot(bots, mission.limited.botIds[0])?.name : null} /> : null}
                      {/* Where the bots' live work shows: «qué está haciendo ahora» appears when this is out of view. */}
                      <span aria-hidden="true" data-room-end="" style={{ display: "block", height: "1px", marginTop: "-1px" }} />
                    </div>
                  </div>
                  <PositionRail scroller={scroller} items={railItems(missionRows, (b) => findBot(bots, b || "atlas").name)} version={rows.length} />
                  <div style={{ width: "100%", maxWidth: "860px", margin: "0 auto", padding: "0 10px" }}>
                    {mission ? <NowBar missionId={missionId} active={["running", "planning"].includes(mission.status) && (activity.length > 0 || live.length > 0)} steps={steps} bots={bots} scroller={scroller} selector="[data-live-turn], [data-room-end]"
                      onShow={follow.toEnd} onStop={() => { post(`/missions/${missionId}/control`, { action: "pause" }).catch(() => {}); }} style={{ margin: "0 16px 6px" }} /> : null}
                    {shared ? <RoomAsks roomId={roomId} asks={asks} onDecided={refreshView} /> : null}
                    <RoomComposer mission={mission} bots={bots} memberIds={shared ? myBots.map((b) => b.id) : memberIds} typing={typing} messages={missionRows} below={follow.below} onJump={follow.toEnd} onSent={follow.toEnd}
                      secrets={pending.filter((a) => a.kind === "secret")} approvals={pending.filter((a) => a.kind !== "secret" && a.kind !== "question" && !rows.some((m) => m.approvalId === a.id))}
                      tools={audience}
                      shared={shared ? { roomId, view: guest ? { ...view, bots: [] } : view, onTyping: tl.typingNow, onSent: () => { tl.reload(); follow.toEnd(); }, onFiles: gone ? null : attach, disabled: gone || !view, above } : null}
                      placeholder={gone ? "Ya no estás en esta sala" : shared ? `Mensaje en #${title} · @ para nombrar a una persona o a un bot` : `Mensaje en #${title} · @ para pedir algo a un bot`} />
                    {shared && !gone && !guest && myBots.length ? <p style={{ margin: "-10px 0 12px", padding: "0 clamp(16px, 3vw, 28px)", fontSize: "var(--t-meta)", color: "#5C606C" }}>{"Tus bots trabajan en tu ordenador. A los demás solo les llega lo que contestan."}</p> : null}
                  </div>
                </div>
              </>
            ) : null}
          </main>
          {ready2 && mission && dockShown ? <SideDock dock={dockView} tabs={tabs} addable={addableTabs} widthKey="sala" label="Panel de la sala" tone="v3" /> : null}
          {ready2 && !dockShown && membersOpen && !threadId ? (
            <MemberPanel view={shown} panel={panel} mission={mission} addable={addableBots} fileCount={fileCount} onRules={mission ? () => dock.open(TABS.reglas) : null} onFiles={mission ? () => dock.open(TABS.archivos) : null}
              onInvite={!gone && !guest ? () => setSheet("invitar") : null} onChanged={refreshView} />
          ) : null}
          {viewing ? <FileViewer file={viewing} onClose={closeViewer} /> : null}
          {sheet === "invitar" && shown ? <RoomInvite view={shown} onClose={() => setSheet(null)} onChanged={refreshView} /> : null}
          {threadId && view ? <PeopleThread key={threadId} shareId={shareId} rootId={threadId} dm={false} botOf={botOf} shared={sameName} revealId={query?.m || null} onClose={closeThread} onDelete={remove} onError={setError}
            composer={{ others, mentionable: guest ? EMPTY : mentionable, mineEnabled: guest ? EMPTY : bots.filter((b) => b.enabled !== false), me: peers?.me?.address || null, disabled: gone, onTyping: tl.typingNow }} /> : null}
        </div>
      </Shell>
      </BotNames.Provider>
    </InteractiveContext.Provider>
  );
}
