import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, FolderOpen, Globe, ListChecks, MessageCircleQuestion, MessageSquareReply, MessagesSquare, SquareTerminal, Users } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import Composer from "../components/v2/chat/Composer.jsx";
import { BotMark, PersonMark } from "../components/v2/chat/Mark.jsx";
import { patch, post } from "../lib/api.js";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useFollow } from "../lib/useStickToBottom.js";
import { comboLabel, useDock, usePanelShortcuts } from "../lib/useDock.js";
import { useRevealMessage } from "../lib/reveal.js";
import { useAction, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { findBot } from "../components/room/common.jsx";
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
import { LimitBanner } from "../components/v2/LimitNotice.jsx";
import NotFound from "./NotFound.jsx";

// Colmena 2.0 · 24 «Sala» (design/V2Sala.dc.html): the room in the conversations column;
// «Mientras no estabas» when you come back; bots as presences in the header (they breathe
// while they work); «Bots y reglas» and «Archivos» open on the right. People, guests and
// invitations come with multi-user rooms (next phase): today a room is you and your bots.
const I = { size: 15, strokeWidth: 2.2, "aria-hidden": "true" };
const BROWSING = ["navegando", "rellenando un formulario", "usando el ordenador", "ejecutando una tarea"];
const SHORTCUTS = { aparte: "mod+shift+s", archivos: "mod+shift+b", progreso: "mod+alt+shift+e", hilo: "mod+alt+shift+j", navegador: "mod+alt+shift+u", terminal: "mod+alt+shift+t", reglas: "mod+alt+shift+r" };
const TABS = Object.fromEntries(["hilo", "progreso", "archivos", "navegador", "terminal", "aparte", "reglas"].map((k) => [k, { id: k, kind: k }]));
const QUEUE = [["steer", "cambian de rumbo enseguida"], ["followup", "te contestan al terminar su paso"], ["collect", "lo juntan todo y te contestan al acabar"], ["interrupt", "paran y te atienden"]];
const popover = { position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, width: "260px", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "14px", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "rise .15s ease-out" };
const menuItem = { minHeight: "38px", display: "flex", alignItems: "center", gap: "10px", padding: "0 12px", border: 0, borderRadius: "9px", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "14px", color: "#12131A" };

export default function SalaV2({ params = {}, query = {} }) {
  if (params.id === "nueva") return <NewRoom query={query} />;
  return <Room id={params.id} query={query} />;
}

/** «Mientras no estabas»: what happened since your last visit (the room's recap), once. */
function useSince(id, messages) {
  const key = "colmena:seen:" + id;
  const [since] = useState(() => { try { return localStorage.getItem(key); } catch { return null; } });
  useEffect(() => () => { try { localStorage.setItem(key, new Date().toISOString()); } catch {} }, [key]);
  useEffect(() => {
    const mark = () => { try { localStorage.setItem(key, new Date().toISOString()); } catch {} };
    window.addEventListener("beforeunload", mark);
    return () => window.removeEventListener("beforeunload", mark);
  }, [key]);
  return since ? messages.filter((m) => m.role !== "user" && m.at && Date.parse(m.at) > Date.parse(since)).length : 0;
}

/** «Mientras no estabas» (V3Sala): what happened since your last visit, in ink, once. */
function CatchUp({ count, mission, pending, id }) {
  const sentences = String(mission?.recap?.text || "").match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) || [];
  if (count < 2 || !sentences.length) return null;
  const need = pending.filter((a) => a.status === "pending");
  const vote = mission?.mode === "debate" && mission?.status === "awaiting_choice";
  return (
    <section aria-label="Mientras no estabas" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px", padding: "18px 20px", borderRadius: "20px", background: "#12131A", color: "#FFFFFF", animation: "rise .4s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <span aria-hidden="true" style={{ width: "18px", height: "18px", background: "#FFFFFF", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" }} />
        <span style={{ fontSize: "14.5px", fontWeight: 600 }}>{"Mientras no estabas"}</span>
        <span style={{ fontSize: "13px", color: "#C9CBD3" }}>{`${count} mensajes${need.length ? ` · ${need.length} te ${need.length === 1 ? "necesita" : "necesitan"}` : ""}`}</span>
        <span style={{ flex: "1" }} />
        {vote ? <a href={`/debate/${id}`} style={{ height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "#FFC93C", color: "#12131A", fontSize: "13px", fontWeight: 600 }}>{"Ir a la votación"}</a> : null}
      </div>
      <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px", lineHeight: "1.5", color: "#E6E7EC" }}>
        {sentences.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}
        {need.length ? <li>{"Te toca: " + need[0].title.charAt(0).toLowerCase() + need[0].title.slice(1) + "."}</li> : null}
      </ul>
    </section>
  );
}

/** Who is here and how the room works (V3Sala, on the right while no panel is open). */
function RoomAside({ mission, bots, memberIds, working, pending, fileCount, userName, onRules, onFiles }) {
  const { act, busy } = useAction();
  const inRoom = memberIds.map((id) => findBot(bots, id)).filter(Boolean);
  const others = bots.filter((b) => b.enabled !== false && !memberIds.includes(b.id));
  const note = (b) => (working(b) ? "trabajando" : pending.some((a) => a.botId === b.id && a.status === "pending") ? "te espera" : b.id === "atlas" ? "coordina" : "libre");
  const queue = QUEUE.find(([v]) => v === (mission.queueMode || "steer"))?.[1] || QUEUE[0][1];
  const rules = [
    ["Si escribes mientras trabajan", queue.charAt(0).toUpperCase() + queue.slice(1)],
    ["Para enviar algo fuera o gastar dinero", mission.safety === "avisar" ? "Te avisan antes y esperan tu OK" : "Siempre esperan tu OK"],
    ["Resumen al volver", "Si al volver hay dos mensajes nuevos o más"],
  ];
  const head = { margin: "0 0 4px", fontSize: "13px", fontWeight: 600, color: "#5C606C" };
  return (
    <aside aria-label="Miembros y reglas" style={{ flex: "1 1 300px", maxWidth: "360px", minWidth: "280px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px", padding: "20px", background: "#FFFFFF", borderLeft: "1px solid rgba(18,19,26,.07)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h2 style={head}>{"Personas · 1"}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "36px" }}><PersonMark me size={26} /><span style={{ flex: "1", fontSize: "14px" }}>{userName || "Tú"}</span><span style={{ fontSize: "12.5px", color: "#5C606C" }}>{"creaste la sala"}</span></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h2 style={head}>{`Bots · ${inRoom.length}`}</h2>
        {inRoom.map((b) => (
          <a key={b.id} href={`/equipo/${b.id}`} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", color: "#12131A" }}>
            <BotMark bot={b} size={20} state={working(b) ? "work" : "rest"} />
            <span style={{ flex: "1", fontSize: "14px" }}>{b.name}</span>
            <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{note(b)}</span>
          </a>
        ))}
        {others.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingTop: "4px" }}>
            {others.map((b) => (
              <button key={b.id} type="button" disabled={busy} onClick={() => act(() => post(`/missions/${mission.id}/members`, { botId: b.id }))} title={`Añadir a ${b.name} a la sala`} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px 0 8px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "12.5px", color: "#3D404A" }}>
                <BotMark bot={b} size={12} />{"+ " + b.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "16px", background: "#F6F6F3" }}>
        <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{"Reglas de esta sala"}</h2>
        {rules.map(([k, v]) => <div key={k} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "13.5px", lineHeight: "1.45" }}><span style={{ color: "#5C606C" }}>{k}</span><span style={{ fontWeight: 500 }}>{v}</span></div>)}
        <button type="button" onClick={onRules} style={{ alignSelf: "flex-start", height: "34px", padding: "0 12px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "999px", background: "#FFFFFF", fontSize: "13px", cursor: "pointer" }}>{"Cambiar reglas"}</button>
      </div>
      <button type="button" onClick={onFiles} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "44px", padding: "0 14px", borderRadius: "12px", border: "1px solid rgba(18,19,26,.1)", background: "transparent", color: "#12131A", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}>{"Archivos de la sala"}<span style={{ color: "#5C606C" }}>{fileCount}</span></button>
    </aside>
  );
}

/** «Bots y reglas»: who is in the room and how it works, as sentences you change by tapping. */
function RulesPanel({ mission, bots, memberIds }) {
  const { act, busy, error } = useAction();
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState(false);
  const inRoom = memberIds.map((id) => findBot(bots, id)).filter(Boolean);
  const others = bots.filter((b) => b.enabled !== false && !memberIds.includes(b.id));
  const mode = mission.queueMode || "steer";
  const rules = [
    { id: "queue", pre: "Si escribes mientras trabajan, ", options: QUEUE, value: mode, post: ".", save: (v) => patch(`/missions/${mission.id}`, { queueMode: v }) },
  ];
  const choose = async (rule, v) => { setOpen(null); const ok = await act(() => rule.save(v)); if (ok !== undefined) { setSaved(true); setTimeout(() => setSaved(false), 2500); } };
  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "22px" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <span style={{ fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{`Bots en la sala · ${inRoom.length}`}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {inRoom.map((b) => (
            <a key={b.id} href={`/colmena/${b.id}`} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px 0 10px", borderRadius: "999px", background: "#F6F6F3", fontSize: "14px", fontWeight: "600" }}>
              <BotMark bot={b} size={18} />{b.name}
            </a>
          ))}
        </div>
        {others.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {others.map((b) => (
              <button key={b.id} type="button" disabled={busy} onClick={() => act(() => post(`/missions/${mission.id}/members`, { botId: b.id }))} style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 12px 0 8px", border: 0, borderRadius: "999px", background: "transparent", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)", cursor: "pointer", fontSize: "13px", color: "#3D404A" }}>
                <BotMark bot={b} size={14} />{"+ " + b.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <span style={{ fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Cómo funciona esta sala · toca lo subrayado para elegir"}</span>
        {rules.map((r) => {
          const current = r.options.find(([v]) => v === r.value)?.[1] || r.options[0][1];
          return (
            <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <p style={{ margin: 0, fontSize: "17px", lineHeight: "1.55" }}>
                {r.pre}
                <button type="button" aria-expanded={open === r.id ? "true" : "false"} onClick={() => setOpen(open === r.id ? null : r.id)} style={{ padding: "0 4px", border: 0, borderRadius: "6px", background: open === r.id ? "rgba(255,201,60,.25)" : "transparent", cursor: "pointer", font: "inherit", fontWeight: 600, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "4px" }}>{current}</button>
                {r.post}
              </p>
              {open === r.id ? (
                <div role="listbox" style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "4px", borderRadius: "16px", background: "#F2F2EE", animation: "rise .2s ease-out" }}>
                  {r.options.map(([v, label]) => {
                    const on = v === r.value;
                    return (
                      <button key={v} type="button" role="option" aria-selected={on ? "true" : "false"} onClick={() => choose(r, v)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", padding: "0 12px", border: 0, borderRadius: "12px", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none", cursor: "pointer", textAlign: "left", fontSize: "14px" }}>
                        <span aria-hidden="true" style={{ width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? "#12131A" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                        </span>
                        {label.charAt(0).toUpperCase() + label.slice(1)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        <p style={{ margin: 0, fontSize: "17px", lineHeight: "1.55", color: "#3D404A" }}>{mission.safety === "avisar" ? "Para enviar algo fuera o gastar dinero, te avisan antes y esperan tu OK." : "Para enviar algo fuera o gastar dinero, siempre esperan tu OK."}</p>
        {saved ? <span role="status" style={{ fontSize: "14px", color: "#0B6B4A" }}>{"Guardado. Atlas lo tendrá en cuenta desde ahora."}</span> : null}
        {error ? <span role="alert" style={{ fontSize: "14px", color: "#B4372A" }}>{error}</span> : null}
      </section>
    </div>
  );
}

function Room({ id, query }) {
  const { bots, ready, settings, run } = useStore();
  const [menu, setMenu] = useState(null); // «invitar» | «mas»
  const room = useRoom(id);
  const follow = useFollow(id);
  const scope = useRef(null);
  const scroller = useRef(null);
  useRevealMessage(query?.m || null, { ready: !room.loading && !!room.mission, olderCount: room.olderCount, showOlder: room.showOlder });
  const { mission, messages, steps, thread, artifacts, approvals, pending, live, activity, memberIds } = room;
  const since = useSince(id, messages);
  const dock = useDock(id, { transient: (t) => t.kind === "navegador" });
  const progress = mission?.progress || { done: steps.filter((s) => ["completed", "done"].includes(s.status)).length, total: steps.filter((s) => s.kind !== "plan").length };
  const typing = mission ? typingInfo({ mission, activity, live, bots, steps }) : null;
  useEffect(() => { if (query?.panel && TABS[query.panel]) dock.open(TABS[query.panel]); }, [query?.panel]); // eslint-disable-line react-hooks/exhaustive-deps
  const browsing = activity.find((a) => BROWSING.includes(a.verb));
  const dismissed = useRef(false);
  useEffect(() => { dismissed.current = false; }, [id]);
  useEffect(() => { if (browsing && !dismissed.current && !dock.tabs.some((t) => t.kind === "navegador")) dock.open(TABS.navegador); }, [!!browsing]); // eslint-disable-line react-hooks/exhaustive-deps
  const dockView = { ...dock, close: (tabId) => { if (tabId === "navegador") dismissed.current = true; dock.close(tabId); } };
  const openDoc = (artifactId) => { const tabId = "doc:" + artifactId; if (dock.isVisible(tabId)) return dock.close(tabId); dock.open({ id: tabId, kind: "doc", artifactId }); };
  const openReplies = (msgId) => { const tabId = "respuestas:" + msgId; if (dock.isVisible(tabId)) return dock.close(tabId); dock.open({ id: tabId, kind: "respuestas", parentId: msgId }); };
  const openFile = (f) => dock.open({ id: "file:" + f.path, kind: "file", path: f.path, name: f.name, type: f.type });
  usePanelShortcuts(Object.entries(SHORTCUTS).map(([key, combo]) => ({ combo, run: () => dock.toggle(TABS[key]) })), !!mission);
  const workVersion = useMemo(() => steps.reduce((n, s) => n + (s.activity?.length || 0), 0) + artifacts.length + messages.length, [steps, artifacts, messages]);
  // A web page a bot just made opens in «Vista previa» beside the room (OpenClaw's Canvas).
  useAutoPreview(id, artifacts, (wf) => dock.open({ id: "file:" + wf, kind: "file", path: wf, name: wf.split("/").pop(), type: "code" }));
  // A file named in an answer or in «Archivos cambiados» opens beside the room.
  useOpenFileRequests(id, openFile);
  const resolve = (t) => {
    if (t.kind === "reglas") return { label: "Bots y reglas", icon: <Users {...I} />, title: "Bots y reglas · " + comboLabel(SHORTCUTS.reglas), render: () => <RulesPanel mission={mission} bots={bots} memberIds={memberIds} /> };
    if (t.kind === "aparte") return { label: "Preguntar aparte", icon: <MessageCircleQuestion {...I} />, title: "Preguntar aparte · " + comboLabel(SHORTCUTS.aparte), render: () => <AsidePanel mission={mission} /> };
    if (t.kind === "hilo") return { label: "Entre bots", icon: <MessagesSquare {...I} />, badge: thread.length || null, render: () => <ThreadPanel bare mission={mission} thread={thread} bots={bots} /> };
    if (t.kind === "progreso") return { label: "Progreso", icon: <ListChecks {...I} />, badge: `${progress.done || 0}/${progress.total || 0}`, render: () => <ProgressPanel bare mission={mission} steps={steps} pending={pending} activity={activity} bots={bots} /> };
    if (t.kind === "archivos") return { label: "Archivos de la sala", icon: <FolderOpen {...I} />, render: () => <FilesPanel missionId={id} onOpen={openFile} version={workVersion} /> };
    if (t.kind === "file") return { label: t.name || t.path, icon: fileIcon(t.type), title: t.path, render: () => <FileView missionId={id} path={t.path} version={workVersion} /> };
    if (t.kind === "doc") { const a = artifacts.find((x) => x.id === t.artifactId); return { label: a?.title || "Entregable", icon: <FileText {...I} />, render: () => <ArtifactPanel bare artifactId={t.artifactId} bots={bots} variant="room" /> }; }
    if (t.kind === "respuestas") return { label: "Respuestas", icon: <MessageSquareReply {...I} />, badge: messages.filter((m) => m.replyTo === t.parentId).length || null, render: () => <RepliesPanel bare mission={mission} messages={messages} steps={steps} bots={bots} parentId={t.parentId} /> };
    if (t.kind === "navegador") { const who = browsing ? findBot(bots, browsing.botId) : null; return { label: "Navegador", icon: <Globe {...I} />, render: () => <div style={{ padding: "12px 14px" }}><BrowserLive missionId={id} bot={who} verb={browsing?.verb || null} missionActive={mission?.status === "running"} /></div> }; }
    if (t.kind === "terminal") return { label: "Terminal", icon: <SquareTerminal {...I} />, badge: commandsOf(steps).length || null, title: "Terminal · " + comboLabel(SHORTCUTS.terminal), render: () => <TerminalPanel steps={steps} bots={bots} missionId={mission?.id || null} onOpenBrowser={() => dock.open(TABS.navegador)} /> };
    return null;
  };
  const tabs = mission ? dock.tabs.map((t) => { const r = resolve(t); return r ? { ...t, ...r } : null; }).filter(Boolean) : [];
  const addable = [["reglas", "Bots y reglas", <Users {...I} />], ["aparte", "Preguntar aparte", <MessageCircleQuestion {...I} />], ["archivos", "Archivos", <FolderOpen {...I} />], ["progreso", "Progreso", <ListChecks {...I} />], ["hilo", "Entre bots", <MessagesSquare {...I} />], ["navegador", "Navegador", <Globe {...I} />], ["terminal", "Terminal", <SquareTerminal {...I} />]]
    .map(([key, label, icon]) => ({ key, label, icon, combo: SHORTCUTS[key], tab: TABS[key] })).filter((a) => !dock.tabs.some((t) => t.id === a.tab.id));

  if (ready && !room.loading && !mission) return <NotFound active="chats" title="Esta sala ya no está" text="Puede que alguien la borrara o que se archivara. No se ha perdido nada de lo tuyo." />;
  const members = memberIds.map((b) => findBot(bots, b)).filter(Boolean);
  const working = (b) => activity.some((a) => a.botId === b.id) || live.some((l) => l.botId === b.id);
  const fileCount = artifacts.length + (mission?.files || []).length;
  const aside = dock.isVisible("aparte");
  // A panel open on the right replaces «Miembros y reglas»; closing it brings them back.
  const dockShown = tabs.length > 0 && !!dock.active && dock.isVisible(dock.active);
  const more = [
    ["Bots y reglas", () => dock.toggle(TABS.reglas)],
    ["Archivos de la sala", () => dock.toggle(TABS.archivos)],
    ["Preguntar aparte", () => dock.toggle(TABS.aparte)],
    ["Progreso", () => dock.toggle(TABS.progreso)],
    ["Entre bots", () => dock.toggle(TABS.hilo)],
    ["Navegador", () => dock.toggle(TABS.navegador)],
    ["Terminal", () => dock.toggle(TABS.terminal)],
    ["Línea de tiempo", () => navigate(`/encargo/${id}`)],
  ];
  const others = bots.filter((b) => b.enabled !== false && !memberIds.includes(b.id));
  const audience = (
    <div role="radiogroup" aria-label="Quién lo ve" style={{ display: "inline-flex", padding: "3px", gap: "2px", borderRadius: "999px", background: "#F1F1EC" }}>
      {[["sala", "Toda la sala", !aside], ["yo", "Solo yo y un bot", aside]].map(([key, label, on]) => (
        <button key={key} type="button" role="radio" aria-checked={on ? "true" : "false"} title={key === "yo" ? "Pregunta a un bot sin que la sala lo vea (Preguntar aparte)" : "Lo leen todos los de la sala"}
          onClick={() => { if (key === "yo" ? !aside : aside) dock.toggle(TABS.aparte); }}
          style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none", fontSize: "13px", fontWeight: 500, color: "#12131A", cursor: "pointer" }}>{label}</button>
      ))}
    </div>
  );
  return (
    <InteractiveContext.Provider value={{ send: mission ? (text) => post(`/missions/${id}/messages`, { text }) : null }}>
      <Shell active="chats" scroll={false}>
        <div style={{ display: "flex", height: "100%", alignItems: "stretch" }}>
          <section aria-label={mission ? "Sala " + (mission.room || mission.title) : "Sala"} style={{ flex: "999 1 520px", minWidth: "0", height: "100%", display: "flex", flexDirection: "column" }}>
            {mission ? (
              <>
                <header style={{ position: "relative", zIndex: 3, flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "14px 26px", background: "rgba(245,245,242,.92)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
                  <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", marginRight: "auto" }}>
                    <h1 style={{ margin: 0, fontSize: "17px", fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"# " + (mission.room || mission.title)}</h1>
                    <span style={{ fontSize: "13px", color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[mission.title, mission.statusLabel].filter(Boolean).join(" · ")}{" · "}<a href={`/encargo/${id}`}>{"ver la tarea"}</a></span>
                  </div>
                  <span aria-label={`Tú y ${members.length === 1 ? "1 bot" : members.length + " bots"}`} style={{ display: "flex", alignItems: "center" }}>
                    <PersonMark me size={28} ring="#F5F5F2" />
                    <span aria-hidden="true" style={{ display: "flex", alignItems: "center", marginLeft: "4px" }}>{members.slice(0, 4).map((b) => <span key={b.id} style={{ width: "26px", height: "28px", display: "grid", placeItems: "center" }}><BotMark bot={b} size={18} state={working(b) ? "work" : "rest"} /></span>)}</span>
                    <span style={{ marginLeft: "4px", fontSize: "13px", color: "#4A4D57" }}>{members.length === 1 ? "1 bot" : `${members.length} bots`}</span>
                  </span>
                  {mission.mode === "debate" ? <a href={`/debate/${id}`} style={{ height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", color: "#12131A", fontSize: "13.5px", fontWeight: 500 }}>{"Elegir propuesta"}</a> : null}
                  <span style={{ position: "relative" }}>
                    <button type="button" aria-haspopup="menu" aria-expanded={menu === "invitar" ? "true" : "false"} onClick={() => setMenu(menu === "invitar" ? null : "invitar")} style={{ height: "36px", padding: "0 14px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: "#FFFFFF", fontSize: "13.5px", fontWeight: 500, cursor: "pointer" }}>{"Invitar"}</button>
                    {menu === "invitar" ? (
                      <div role="menu" aria-label="Invitar a la sala" onMouseLeave={() => setMenu(null)} style={popover}>
                        <span style={{ padding: "6px 10px", fontSize: "12px", fontWeight: 600, color: "#5C606C" }}>{others.length ? "Añadir un bot a la sala" : "Todos tus bots están ya aquí"}</span>
                        {others.map((b) => <button key={b.id} type="button" role="menuitem" onClick={() => { setMenu(null); run(() => post(`/missions/${id}/members`, { botId: b.id })).catch(() => {}); }} style={menuItem}><BotMark bot={b} size={16} />{b.name}<span style={{ marginLeft: "auto", fontSize: "12.5px", color: "#5C606C" }}>{b.role}</span></button>)}
                        <a href="/equipo" role="menuitem" style={{ ...menuItem, color: "#1F4FD1" }}>{"Personas: invítalas desde Equipo"}</a>
                      </div>
                    ) : null}
                  </span>
                  <span style={{ position: "relative" }}>
                    <button type="button" aria-label="Más opciones" aria-haspopup="menu" aria-expanded={menu === "mas" ? "true" : "false"} onClick={() => setMenu(menu === "mas" ? null : "mas")} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "10px", background: menu === "mas" ? "#EBEBE6" : "transparent", color: "#4A4D57", cursor: "pointer" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg>
                    </button>
                    {menu === "mas" ? (
                      <div role="menu" onMouseLeave={() => setMenu(null)} style={popover}>
                        {more.map(([label, fn]) => <button key={label} type="button" role="menuitem" onClick={() => { setMenu(null); fn(); }} style={menuItem}>{label}</button>)}
                      </div>
                    ) : null}
                  </span>
                </header>
                <BlockerBand mission={mission} pending={pending.filter((a) => !messages.some((m) => m.approvalId === a.id))} bots={bots} />
                <StuckBand mission={mission} bots={bots} />
                <div style={{ flex: "1", minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div ref={(el) => { follow.ref(el); scroller.current = el; }} style={{ flex: "1", minHeight: "0", overflowY: "auto", overscrollBehavior: "contain", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 28px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 28px)", display: "flex", flexDirection: "column" }}>
                    <div ref={scope} style={{ width: "100%", maxWidth: "860px", margin: "auto auto 0", padding: "20px 26px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <SelectionPopup scope={scope} onQuote={(t) => quoteInto(id, t)} onAsk={(t) => { askAsideAbout(id, t); dock.open(TABS.aparte); }} />
                      <CatchUp count={since} mission={mission} pending={pending} id={id} />
                      <OlderMessages count={room.olderCount} onShow={room.showOlder} />
                      <RoomMessages mission={mission} messages={withOrphanQuestions(room.spoken || messages, pending)} thread={thread} bots={bots} approvals={approvals} artifacts={artifacts} steps={steps} onOpenArtifact={openDoc} openArtifactId={null} showThread={false} onOpenReplies={openReplies} />
                      {mission?.limited ? <LimitBanner mission={mission} botName={mission.limited.botIds?.length === 1 ? findBot(bots, mission.limited.botIds[0])?.name : null} /> : null}
                    </div>
                  </div>
                  <PositionRail scroller={scroller} items={railItems(messages, (b) => findBot(bots, b || "atlas").name)} version={messages.length} />
                  <div style={{ width: "100%", maxWidth: "860px", margin: "0 auto", padding: "0 10px" }}>
                    <RoomComposer mission={mission} bots={bots} memberIds={memberIds} typing={typing} messages={messages} below={follow.below} onJump={follow.toEnd} onSent={follow.toEnd} secrets={pending.filter((a) => a.kind === "secret")} approvals={pending.filter((a) => a.kind !== "secret" && a.kind !== "question" && !messages.some((m) => m.approvalId === a.id))}
                      tools={audience} placeholder={`Mensaje en #${mission.room || mission.title} · @ para pedir algo a un bot`} />
                  </div>
                </div>
              </>
            ) : null}
          </section>
          {mission && dockShown ? <SideDock dock={dockView} tabs={tabs} addable={addable} widthKey="sala" label="Panel de la sala" tone="v3" /> : null}
          {mission && !dockShown ? <RoomAside mission={mission} bots={bots} memberIds={memberIds} working={working} pending={pending} fileCount={fileCount} userName={settings?.userName} onRules={() => dock.open(TABS.reglas)} onFiles={() => dock.open(TABS.archivos)} /> : null}
        </div>
      </Shell>
    </InteractiveContext.Provider>
  );
}

/** A room chosen in «Nueva sala»: its name and bots, waiting for the first message. */
function NewRoom({ query }) {
  const { bots, run } = useStore();
  const ids = String(query.bots || "").split(",").filter((b) => bots.some((x) => x.id === b));
  const name = String(query.nombre || "").slice(0, 60) || "sala";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const members = ids.map((b) => findBot(bots, b));
  const submit = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const created = await run(() => post("/missions", { prompt: text.trim(), title: name, mode: "equipo", botIds: ids.filter((b) => b !== "atlas"), safety: "preguntar" }));
      const m = created?.mission || created;
      if (m?.id) { await patch(`/missions/${m.id}`, { room: name }).catch(() => {}); navigate(`/sala/${m.id}`, { replace: true }); }
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Shell active="chats" scroll={false}>
      <div style={{ display: "flex", height: "100%" }}>
        <section style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header style={{ flex: "none", display: "flex", flexDirection: "column", gap: "2px", padding: "14px 26px", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
            <h1 style={{ margin: 0, fontSize: "17px", fontWeight: 600, lineHeight: 1.2 }}>{"# " + name}</h1>
            <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Sala nueva · empieza con tu primer mensaje"}</span>
          </header>
          <div style={{ flex: "1", display: "flex", flexDirection: "column", justifyContent: "flex-end", width: "100%", maxWidth: "840px", margin: "0 auto", padding: "22px clamp(20px, 4vw, 44px)", gap: "16px" }}>
            <span style={{ display: "flex", gap: "10px" }}>{members.map((b) => <BotMark key={b.id} bot={b} size={34} />)}</span>
            <strong style={{ font: "600 30px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{`Sala con ${members.map((b) => b.name).join(", ").replace(/, ([^,]*)$/, " y $1")}`}</strong>
            <span style={{ fontSize: "16px", lineHeight: "1.5", color: "#5C606C" }}>{"Escribe qué necesitáis. Atlas reparte el trabajo y todos lo veis aquí."}</span>
            {error ? <span role="alert" style={{ color: "#B4372A" }}>{error}</span> : null}
          </div>
          <Composer value={text} onChange={setText} onSubmit={submit} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} label="Primer mensaje de la sala" placeholder={`Mensaje en #${name} · qué necesitáis`} busy={busy} v3 />
        </section>
      </div>
    </Shell>
  );
}
