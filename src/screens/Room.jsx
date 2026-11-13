import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Archive, CheckSquare, DoorOpen, FileText, FolderOpen, Globe, Hash, ListChecks, Lock, LockSimple, MessageSquareReply, MessagesSquare, PanelRight, Pencil, Search, SquareTerminal, UserPlus, Users, UsersThree, Ellipsis } from "../components/Icon.js";
import Shell from "../components/v2/Shell.jsx";
import NowBar from "../components/v2/chat/NowBar.jsx";
import BotFace from "../components/BotFace.jsx";
import { get, patch, post } from "../lib/api.js";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useFollow } from "../lib/useStickToBottom.js";
import { comboLabel, useDock, usePanelShortcuts } from "../lib/useDock.js";
import { useRevealMessage } from "../lib/reveal.js";
import { useResource, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { findBot } from "../components/room/common.jsx";
import { MenuButton } from "../components/Menu.js";
import { roomSnoozeChoices } from "../lib/snooze.js";
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
import { BotNames, HandoffLine, OpenBot, PersonAvatar, StatusLine } from "../components/room/Author.jsx";
import MemberPanel from "../components/room/MemberPanel.jsx";
import InviteSheet from "../components/people/InviteSheet.jsx";
import RoomAddRequests from "../components/room/RoomAddRequests.jsx";
import RoomAsks from "../components/room/RoomAsks.jsx";
import RowBoundary from "../components/RowBoundary.jsx";
import PeopleMessage from "../components/v2/people/PeopleMessage.jsx";
import PeerMine, { isPlainMine } from "../components/room/PeerMine.jsx";
import PeopleThread from "../components/v2/people/ThreadPanel.jsx";
import ShareSearch from "../components/v2/people/ShareSearch.jsx";
import { FileViewer } from "../components/v2/people/PeerFiles.jsx";
import { LimitBanner } from "../components/v2/LimitNotice.jsx";
import { RELAY_LABEL, editMessage, fileBase64, unsendMessage } from "../lib/peers.js";
import { isHidden, later, reversible, useToasts } from "../lib/undoToast.js";
import { isTask, roomLinks } from "../lib/rooms.js";
import { waitingBy, waitingOf } from "../components/v2/needs.js";
import { botNameLabels, firstName, initialsOf, listNames } from "../lib/identity.js";
import { ONLY_ME, ONLY_ME_HINT, askWaiting, authorOf, authorView, headerBots, itemType, liveLines, onlyMe, roomEmpty, memberPanel, roomPlace, stackLabel, thinkingLeft, withoutRepeats } from "../lib/roomView.js";
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
const outline = { height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer" };
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
  const [searching, setSearching] = useState(false);
  const [viewing, setViewing] = useState(null); // a shared file open in the viewer
  const [sending, setSending] = useState(EMPTY); // names of files being sealed and sent
  const [error, setError] = useState(null);
  const [wantAside, setWantAside] = useState(false); // «Solo para mí» asked before the room had its sala here
  const closeViewer = useCallback(() => setViewing(null), []);
  // The right panel's two tabs: the bot you opened from a face or a name, and «Miembros».
  const [profile, setProfile] = useState(null); // {id, owner: address | null, name}
  const [panelTab, setPanelTab] = useState("miembros");
  useEffect(() => { setError(null); setSearching(false); setRenaming(null); setSheet(null); setProfile(null); setPanelTab("miembros"); }, [roomId]);

  const { mission, steps: missionSteps, thread, artifacts, approvals, live, activity, memberIds } = room;
  // What someone asked one of your bots here is decided on its own card (RoomAsks), once.
  const asks = view?.asks || EMPTY;
  // Its approval reaches the state before the room view is read again: never drawn from there too.
  const pending = useMemo(() => (room.pending.some((a) => a.roomRequest) ? room.pending.filter((a) => !a.roomRequest) : room.pending), [room.pending]);
  // A «please add» for this room arrives through the one list of what waits (server/waiting.mjs).
  const requestKey = [...(store.approvals || EMPTY).filter((a) => a.roomRequest && (a.roomId === roomId || a.roomRequest.roomId === roomId)).map((a) => a.id + ":" + a.status), ...(store.waiting || EMPTY).filter((w) => w.kind === "roomadd" && w.roomId === roomId).map((w) => w.id)].join(",");
  useEffect(() => { if (shared && requestKey) refreshView(); }, [shared, requestKey, refreshView]);
  const [sharedOut, setSharedOut] = useState({}); // artifact id → "busy" | "done"
  const shareArtifact = async (artifact) => {
    setSharedOut((x) => ({ ...x, [artifact.id]: "busy" }));
    try { await post(`/rooms/${encodeURIComponent(roomId)}/share`, { artifactId: artifact.id }); setSharedOut((x) => ({ ...x, [artifact.id]: "done" })); tl.reload(); }
    catch (e) { setError(e.message); setSharedOut((x) => ({ ...x, [artifact.id]: undefined })); }
  };
  const shareSlot = (artifact) => (
    <button type="button" disabled={!!sharedOut[artifact.id]} onClick={() => shareArtifact(artifact)} title="Las personas de la sala podrán abrirlo. Sale cifrado de tu ordenador."
      style={{ alignSelf: "flex-start", minHeight: "32px", padding: "0 12px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-meta)", fontWeight: 500, cursor: sharedOut[artifact.id] ? "default" : "pointer" }}>
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
  useEffect(() => { if (wantAside && mission) { setWantAside(false); dock.open(TABS.aparte); } }, [wantAside, mission]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // «Te espera» from the one list of what waits for you (server/waiting.mjs), like the sidebar and
  // Equipo: a bot with something waiting anywhere says so here too; a room-level plan or choice
  // names no bot.
  const waitingBots = useMemo(() => [...waitingBy(waitingOf(store)).bots.keys()], [store.waiting, store.approvals, store.missions]); // eslint-disable-line react-hooks/exhaustive-deps
  const panel = useMemo(() => memberPanel(shown, {
    working: bots.filter(working).map((b) => b.id), waiting: [...waitingBots, ...asks.filter((a) => a.state === "asked").map((a) => a.bot?.id)], activity: shown?.activity || EMPTY,
    selfColor: store.settings?.botLooks?.family?.tint || null,
  }), [shown, bots, activity, live, waitingBots, asks, store.settings?.botLooks?.family?.tint]); // eslint-disable-line react-hooks/exhaustive-deps
  // A name two visible bots share reads «Vera · de Lucía» in every author line (identity.js).
  const botNames = useMemo(() => botNameLabels(shown?.bots || EMPTY), [shown]);
  const title = shown?.title || mission?.room || mission?.title || "sala";
  // A task's conversation («Hablar con el equipo» on its page: ?conversacion=1) is not a room:
  // it says so, and leads back to the task (it is never listed in Salas).
  const taskTalk = query?.conversacion && mission && isTask(missions.find((m) => m.id === missionId) || mission) ? { title: mission.title || title } : null;
  const place = roomPlace(shown, teams);
  const subtitle = [place.text, place.private ? place.hint : shown?.general ? "todo el equipo" : null, mission?.statusLabel].filter(Boolean).join(" · ");
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
        {/* Yours, plain: on the right in the bubble (room/PeerMine.jsx); the rest as everyone's rows. */}
        {isPlainMine(m) ? <PeerMine m={m} botOf={botOf} shared={sameName} lastSeen={m.id === lastSeenMine} continued={continued} onReact={react} onRetry={retry} onEdit={edit} onDelete={remove} onThread={m.local || gone ? null : openThread} onError={setError} />
          : <PeopleMessage m={m} dm={false} botOf={botOf} shared={sameName} lastSeen={m.id === lastSeenMine} continued={continued} onMeeting={tl.reload}
            onReact={react} onRetry={retry} onEdit={edit} onDelete={remove} onThread={m.local || gone ? null : openThread} onOpenFile={setViewing} onError={setError} />}
        {/* What waits for you is decided on its one card, pinned over the composer (always in view):
            no second honey line here. A screen reader is told by the announcer and the card. */}
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
    if (t.kind === "aparte") return { label: ONLY_ME, icon: <Lock {...I} />, title: ONLY_ME + " · " + comboLabel(SHORTCUTS.aparte), render: () => <><p role="note" style={{ margin: "14px 20px 0", padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--c-hover)", fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-2)" }}>{ONLY_ME + ": " + ONLY_ME_HINT.charAt(0).toLowerCase() + ONLY_ME_HINT.slice(1) + " No entra en la conversación de la sala."}</p><AsidePanel mission={mission} /></> };
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
  const addableTabs = [["reglas", "Bots y reglas", <Users {...I} />], ["aparte", ONLY_ME, <Lock {...I} />], ["archivos", "Archivos", <FolderOpen {...I} />], ["progreso", "Progreso", <ListChecks {...I} />], ["hilo", "Entre bots", <MessagesSquare {...I} />], ["navegador", "Navegador", <Globe {...I} />], ["terminal", "Terminal", <SquareTerminal {...I} />]]
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
    try { await run(() => post(path + "/leave")); navigate("/chats"); } catch (err) { setError(err.message); }
  };
  // «Posponer»: the room leaves the sidebar until then (unless something waits for you there).
  const snoozePath = view ? path : missionId ? `/missions/${encodeURIComponent(missionId)}` : null;
  const snoozedUntil = view?.snoozedUntil || mission?.snoozedUntil || null;
  const snoozed = !!snoozedUntil && Date.parse(snoozedUntil) > Date.now();
  const snooze = async (choice) => {
    try {
      await run(() => patch(snoozePath, { snooze: choice.id }));
      reversible({ text: `Sala pospuesta · ${choice.label.toLowerCase()}`, undo: () => run(() => patch(snoozePath, { snoozedUntil: null })) });
      refreshView();
    } catch (err) { setError(err.message); }
  };
  const wake = async () => { try { await run(() => patch(snoozePath, { snoozedUntil: null })); refreshView(); } catch (err) { setError(err.message); } };

  // The room's «…» (distilled from eleven flat words, 2026-11-13): what the room is (its name,
  // rules, files), what the side panel shows (checkable, with each one's shortcut: the panels
  // are the dock's tabs, so they live together in one submenu instead of five loose rows),
  // where it goes (posponer, Trabajo), and leaving it last. «Solo para mí» is the composer's
  // chip and «Línea de tiempo» the header's «ver la tarea»: not repeated here.
  const panelItem = (key, label, icon, meta = null) => ({ label, icon, checked: dock.isVisible(key), shortcut: SHORTCUTS[key], meta, onSelect: () => dock.toggle(TABS[key]) });
  const canMove = mission && !shared && !mission.conversation && !isTask(missions.find((x) => x.id === missionId) || mission);
  const menu = () => [
    { group: null, items: [
      shown?.mine && !shown?.general ? { label: "Cambiar el nombre", icon: Pencil, onSelect: () => setRenaming(title) } : null,
      mission ? { label: "Reglas de la sala", icon: Users, hint: "Qué bots están y cómo trabajan aquí", onSelect: () => dock.open(TABS.reglas) } : null,
      mission ? { label: "Archivos de la sala", icon: FolderOpen, meta: fileCount ? String(fileCount) : null, onSelect: () => dock.open(TABS.archivos) } : null,
    ] },
    { group: null, items: [
      { label: "Panel lateral", icon: PanelRight, subLabel: "Qué muestra el panel lateral", items: [
        { label: "Miembros", icon: UsersThree, checked: panelOpen, onSelect: () => (panelOpen ? setMembersOpen(false) : showMembers()) },
        ...(mission ? [
          panelItem("progreso", "Progreso", ListChecks),
          panelItem("hilo", "Entre bots", MessagesSquare),
          panelItem("navegador", "Navegador", Globe),
          panelItem("terminal", "Terminal", SquareTerminal),
        ] : []),
      ] },
    ] },
    { group: null, items: [
      snoozePath && !gone ? (snoozed
        ? { label: "Mostrar ya en la barra", icon: AlarmClock, hint: "Pospuesta hasta " + new Date(snoozedUntil).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" }), onSelect: wake }
        : { label: "Posponer", icon: AlarmClock, subLabel: "Posponer la sala", items: roomSnoozeChoices().map((c) => ({ label: c.label, meta: c.hint, onSelect: () => snooze(c) })) }) : null,
      canMove ? { label: "Mover a Trabajo", icon: CheckSquare, hint: "Pasa a ser una tarea con plan y entrega", onSelect: toWork } : null,
      view ? { label: "Archivar la sala", icon: Archive, onSelect: archive } : null,
    ] },
    shared && !view?.general && !gone ? (view?.mine
      ? { label: "Cerrar la sala para todos", icon: DoorOpen, danger: true, onSelect: leave, confirm: { title: "¿Cerrar la sala para todos?", text: "Tú la creaste: si sales, se cierra para todos. Cada persona conserva lo que ya tiene.", action: "Cerrar para todos" } }
      : { label: "Salir de la sala", icon: DoorOpen, danger: true, onSelect: leave, confirm: { title: `¿Salir de #${title}?`, text: "Dejarás de recibir lo que se escriba aquí. Lo que ya escribiste sigue en la sala de los demás.", action: "Salir" } }) : null,
  ];

  // One control in every room: «Solo para mí» (lib/roomView.js › onlyMe). It opens the aside
  // (asked of your own bots, never sent to anyone); where your bots never worked, the room's
  // sala is made on this computer first.
  const only = onlyMe({ mission, shared, gone });
  const toggleAside = async () => {
    if (mission) return dock.toggle(TABS.aparte);
    try { await post(`/rooms/${encodeURIComponent(roomId)}/aside`); setWantAside(true); refreshView(); } catch (err) { setError(err.message); }
    return undefined;
  };
  // The composer's chip says it (RoomComposer › AddressChip): «Toda la sala», a bot, «Solo para mí».
  const audience = { on: !!aside, toggle: toggleAside, label: only.label, hint: only.hint, available: only.available };

  // ---- the right panel: «Miembros», or the bot you opened from its face or name
  const panelOpen = membersOpen && !dockShown && !threadId;
  const showMembers = () => { if (dockShown) dock.setOpen(false); setMembersOpen(true); setPanelTab("miembros"); };
  const openBot = (author) => {
    const id = typeof author?.botId === "object" && author.botId ? author.botId.bot : author?.botId || author?.id;
    if (!id) return;
    const owner = author.owner?.you ? null : author.owner?.address || (typeof author?.botId === "object" ? author.botId?.owner : null) || null;
    setProfile({ id, owner, name: author.name || null });
    setPanelTab("perfil");
    if (dockShown) dock.setOpen(false);
    setMembersOpen(true);
  };

  // People typing and other people's bots thinking; files on their way; what went wrong.
  const above = shared && (tl.typing.length || thinking.length || sending.length || error) ? (
    <p role="status" style={{ margin: "0 0 8px", minHeight: "18px", display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
      {tl.typing.length ? <span>{listNames(tl.typing.map(firstName)) + (tl.typing.length > 1 ? " están escribiendo…" : " está escribiendo…")}</span> : null}
      {thinking.length ? <span>{listNames(thinking) + (thinking.length > 1 ? " están pensando…" : " está pensando…")}</span> : null}
      {sending.length ? <span>{"Cifrando y enviando " + listNames(sending) + "…"}</span> : null}
      {error ? <span role="alert" style={{ color: "var(--c-error)" }}>{error}</span> : null}
    </p>
  ) : null;
  const ready2 = !!shown;
  const stackPeople = panel.people.slice(0, 4), stackBots = headerBots(panel);
  const counts = [panel.people.length === 1 ? "1 persona" : `${panel.people.length} personas`, panel.botCount === 1 ? "1 bot" : `${panel.botCount} bots`].join(" · ");
  const send = (text) => (shared ? post(`${path}/messages`, { text }).then(() => tl.reload()) : post(`/missions/${missionId}/messages`, { text }));

  return (
    <InteractiveContext.Provider value={{ send: mission ? send : null }}>
      <BotNames.Provider value={botNames}>
      <OpenBot.Provider value={openBot}>
      <Shell active="chats" scroll={false} background="var(--c-app)">
        <div style={{ position: "relative", display: "flex", height: "100%", alignItems: "stretch" }}>
          <main aria-label={taskTalk ? "Conversación de la tarea " + taskTalk.title : "Sala " + title} style={{ flex: "999 1 520px", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
            <Announcer text={news} />
            {ready2 ? (
              <>
                <header style={{ position: "relative", zIndex: 5, flex: "none", background: "var(--c-app)", borderBottom: "1px solid var(--c-line)", WebkitAppRegion: "drag" }}>
                  <div style={{ minHeight: "56px", display: "flex", alignItems: "center", gap: "12px", padding: "0 12px 0 24px" }}>
                    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: "12px", marginRight: "auto", WebkitAppRegion: "no-drag" }}>
                      {renaming !== null ? (
                        <form onSubmit={saveName} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <label style={{ flex: 1, minWidth: 0, display: "flex" }}>
                            <span style={hidden}>{"Nombre de la sala"}</span>
                            <input className="c-quiet" autoFocus value={renaming} maxLength={60} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setRenaming(null); } }}
                              style={{ flex: 1, minWidth: 0, height: "34px", padding: "0 10px", border: "1px solid rgb(var(--c-ink-rgb) / .2)", borderRadius: "var(--r-md)", background: "var(--c-card)", fontSize: "var(--t-body)", fontWeight: 600 }} />
                          </label>
                          <button type="submit" style={{ ...outline, height: "34px", background: "var(--c-btn)", borderColor: "var(--c-text)", color: "var(--c-btn-text)" }}>{"Guardar"}</button>
                          <button type="button" onClick={() => setRenaming(null)} style={{ ...outline, height: "34px" }}>{"Cancelar"}</button>
                        </form>
                      ) : <h1 style={{ margin: 0, flex: "none", maxWidth: "50%", display: "flex", alignItems: "center", gap: "6px", font: "600 var(--t-lead)/1.2 'Geist', sans-serif", letterSpacing: "-0.01em", overflow: "hidden", whiteSpace: "nowrap" }}>
                        {taskTalk ? null : place.private ? <LockSimple size={19} style={{ flex: "none", color: "var(--c-text-3)" }} aria-label="Privada" /> : <Hash size={19} style={{ flex: "none", color: "var(--c-text-3)" }} />}
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{taskTalk ? `Conversación de la tarea «${taskTalk.title}»` : title}</span>
                      </h1>}
                      {renaming !== null ? null : (
                        <span style={{ flex: "1 1 auto", minWidth: 0, paddingLeft: "12px", borderLeft: "1px solid var(--c-line)", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
                          {/* Up to two lines, the whole of it on hover and to a screen reader (it is all in the page). */}
                          <span title={subtitle} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 }}>
                            {taskTalk ? <>{"Lo que habláis tú y los bots sobre esta tarea · "}<a href={`/encargo/${encodeURIComponent(missionId)}`}>{"volver a la tarea"}</a></> : <>
                              {subtitle}
                              {mission ? <>{" · "}<a href={`/encargo/${missionId}`}>{"ver la tarea"}</a></> : null}
                            </>}
                          </span>
                        </span>
                      )}
                    </div>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px", WebkitAppRegion: "no-drag" }}>
                      {/* A debate waiting for your choice is decided from the banner below: one action, one honey element. */}
                      {mission?.mode === "debate" && mission.status !== "awaiting_choice" ? <a href={`/debate/${missionId}`} className="v4-btn" style={{ marginRight: "6px" }}>{"Ver las propuestas"}</a> : null}
                      {/* «Invitar», where a team chat has it: beside who is here. */}
                      {view && !gone && !guest && !taskTalk ? <button type="button" className="v4-btn" onClick={() => setSheet("invitar")} style={{ marginRight: "4px" }}><UserPlus size={16} />{"Invitar"}</button> : null}
                      {/* Who is here (design/v4 › .stack): it opens «Miembros». */}
                      <button type="button" className="v4-stack" aria-label={stackLabel(panel) + ". Ver los miembros"} title="Ver los miembros" onClick={() => showMembers()}>
                        <span aria-hidden="true" style={{ display: "flex" }}>
                          {stackPeople.map((p, i) => <span key={p.address || i} style={{ marginLeft: i ? "-6px" : 0, borderRadius: "var(--r-circle)", boxShadow: "0 0 0 2px var(--c-app)" }}><PersonAvatar person={p} size={24} /></span>)}
                          {stackBots.slice(0, 3).map((b) => <span key={(b.mine ? "" : "o:" + (b.owner?.address || "")) + b.id} style={{ marginLeft: "4px", display: "grid" }}><BotFace bot={b} size={24} owner={b.mine ? null : b.owner} state={b.state === "working" || b.state === "thinking" ? "work" : "rest"} decorative /></span>)}
                        </span>
                        <span aria-hidden="true" style={{ whiteSpace: "nowrap" }}>{counts}</span>
                      </button>
                      {shared ? <button type="button" className="v4-ib" aria-label="Buscar en la sala" title="Buscar en la sala" aria-pressed={searching} onClick={() => setSearching((v) => !v)}><Search size={18} /></button> : null}
                      <button type="button" className="v4-ib" aria-label={panelOpen ? "Ocultar el panel lateral" : "Ver el panel lateral"} title={panelOpen ? "Ocultar el panel lateral" : "Ver el panel lateral"} aria-pressed={panelOpen} aria-controls="sala-miembros"
                        onClick={() => { if (dockShown) { dock.setOpen(false); setMembersOpen(true); } else setMembersOpen(!membersOpen); }}><PanelRight size={18} active={panelOpen} /></button>
                      <MenuButton label={"Más opciones de #" + title} menuLabel="Más opciones de la sala" items={menu} className="v4-ib"><Ellipsis size={18} /></MenuButton>
                    </span>
                  </div>
                  {searching && shared ? <ShareSearch shareId={shareId} onClose={() => setSearching(false)} /> : null}
                </header>
                {/* One honey card per thing that waits: the band only says what is not already drawn below (a row of the conversation or the card over the composer). */}
                {mission ? <BlockerBand mission={mission} pending={pending.filter((a) => a.kind === "question" && !rows.some((m) => m.approvalId === a.id))} bots={bots} /> : null}
                {mission ? <StuckBand mission={mission} bots={bots} /> : null}
                {shared && relay !== "online" ? (
                  <p role="status" style={{ flex: "none", margin: 0, padding: "10px 26px", background: "var(--c-chip)", color: "var(--c-text-2)", fontSize: "var(--t-ui)" }}>
                    {relay === "off" ? "Falta activar el buzón cifrado por el que viajan los mensajes: Ajustes › Contactos y equipos." : (RELAY_LABEL[relay] || "Sin conexión con el buzón") + ". Lo que escribas saldrá en cuanto vuelva."}
                  </p>
                ) : null}
                {gone ? <p role="status" style={{ flex: "none", margin: 0, padding: "10px 26px", background: "var(--c-chip)", color: "var(--c-text-2)", fontSize: "var(--t-ui)" }}>{view.removed ? "Ya no estás en esta sala. Puedes leer lo que tenías." : "Saliste de esta sala. Puedes leer lo que tenías."}</p> : null}
                <div style={{ flex: "1", minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div ref={(el) => { follow.ref(el); scroller.current = el; }} {...messageListProps("Mensajes de la sala")} style={{ flex: "1", minHeight: "0", overflowY: "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column" }}>
                    {/* role="log" as in a chat (Timeline.jsx), private or with people; new rows are spoken by the Announcer. */}
                    <div ref={scope} role="log" aria-live="off" style={{ width: "100%", maxWidth: "1040px", margin: "auto 0 0", padding: "8px 24px 16px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2px" }}>
                      {mission ? <SelectionPopup scope={scope} askLabel={ONLY_ME} onQuote={(t) => quoteInto(missionId, t)} onAsk={(t) => { askAsideAbout(missionId, t); dock.open(TABS.aparte); }} /> : null}
                      {mission ? <CatchUp count={since} mission={mission} pending={pending} id={missionId} /> : null}
                      {shared ? (tl.more ? <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 12px" }}><button type="button" onClick={olderPage} style={{ ...outline, height: "34px", fontSize: "var(--t-meta)", fontWeight: 600 }}>{"Ver mensajes anteriores"}</button></div> : null) : <OlderMessages count={room.olderCount} onShow={room.showOlder} />}
                      {loaded && !rows.length ? (() => {
                        const empty = roomEmpty(shown, { teamName: shown?.teamId ? place.text : null });
                        return (
                          <div style={{ alignSelf: "center", maxWidth: "520px", margin: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
                            <strong style={{ font: "600 var(--t-heading)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", textWrap: "balance" }}>{empty.title}</strong>
                            <span style={{ fontSize: "var(--t-body)", lineHeight: 1.55, color: "var(--c-text-2)" }}>{empty.text}</span>
                            {empty.action === "invite" && !gone && !guest ? <button type="button" onClick={() => setSheet("invitar")} style={{ ...outline, marginTop: "6px", background: "var(--c-btn)", borderColor: "var(--c-text)", color: "var(--c-btn-text)" }}>{empty.actionLabel}</button> : null}
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
                  <div style={{ width: "100%", maxWidth: "1040px", padding: "0 24px", boxSizing: "border-box" }}>
                    {mission ? <NowBar missionId={missionId} active={["running", "planning"].includes(mission.status) && (activity.length > 0 || live.length > 0)} steps={steps} bots={bots} scroller={scroller} selector="[data-live-turn], [data-room-end]"
                      onShow={follow.toEnd} onStop={() => { post(`/missions/${missionId}/control`, { action: "pause" }).catch(() => {}); }} style={{ margin: "0 0 6px" }} /> : null}
                    {shared && view?.requests?.length ? <RoomAddRequests roomId={roomId} title={title} requests={view.requests} onDecided={refreshView} /> : null}
                    {shared ? <RoomAsks roomId={roomId} asks={asks} onDecided={refreshView} /> : null}
                    <RoomComposer mission={mission} bots={bots} memberIds={shared ? myBots.map((b) => b.id) : memberIds} typing={typing} messages={missionRows} below={follow.below} onJump={follow.toEnd} onSent={follow.toEnd}
                      secrets={pending.filter((a) => a.kind === "secret")} approvals={pending.filter((a) => a.kind !== "secret" && a.kind !== "question" && !rows.some((m) => m.approvalId === a.id))}
                      aside={audience}
                      shared={shared ? { roomId, view: guest ? { ...view, bots: [] } : view, onTyping: tl.typingNow, onSent: () => { tl.reload(); follow.toEnd(); }, onFiles: gone ? null : attach, disabled: gone || !view, above } : null}
                      placeholder={gone ? "Ya no estás en esta sala" : shared ? `Mensaje en #${title} · @ para nombrar a una persona o a un bot` : `Mensaje en #${title} · @ para pedir algo a un bot`} />
                    
                  </div>
                </div>
              </>
            ) : null}
          </main>
          {ready2 && mission && dockShown ? <SideDock dock={dockView} tabs={tabs} addable={addableTabs} widthKey="sala" label="Panel de la sala" tone="v3" /> : null}
          {ready2 && panelOpen ? (
            <MemberPanel view={shown} panel={panel} mission={mission} addable={addableBots} fileCount={fileCount} onRules={mission ? () => dock.open(TABS.reglas) : null} onFiles={mission ? () => dock.open(TABS.archivos) : null}
              onInvite={!gone && !guest ? () => setSheet("invitar") : null} profile={profile} tab={panelTab} onTab={setPanelTab} onOpenBot={(b) => { setProfile(b); setPanelTab("perfil"); }} />
          ) : null}
          {viewing ? <FileViewer file={viewing} onClose={closeViewer} /> : null}
          {sheet === "invitar" && shown ? <InviteSheet context={{ kind: "room", room: shown }} onClose={() => setSheet(null)} onChanged={refreshView} /> : null}
          {threadId && view ? <PeopleThread key={threadId} shareId={shareId} rootId={threadId} dm={false} botOf={botOf} shared={sameName} revealId={query?.m || null} onClose={closeThread} onDelete={remove} onError={setError}
            composer={{ others, mentionable: guest ? EMPTY : mentionable, mineEnabled: guest ? EMPTY : bots.filter((b) => b.enabled !== false), me: peers?.me?.address || null, disabled: gone, onTyping: tl.typingNow }} /> : null}
        </div>
      </Shell>
      </OpenBot.Provider>
      </BotNames.Provider>
    </InteractiveContext.Provider>
  );
}
