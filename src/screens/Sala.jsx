import { useEffect, useMemo, useRef } from "react";
import { FileText, FolderOpen, Globe, ListChecks, MessageCircleQuestion, MessageSquareReply, MessagesSquare } from "lucide-react";
import { post } from "../lib/api.js";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useFollow } from "../lib/useStickToBottom.js";
import { comboLabel, useDock, usePanelShortcuts } from "../lib/useDock.js";
import { useRevealMessage } from "../lib/reveal.js";
import { css } from "../design/css/Sala.js";
import Sidebar from "../components/Sidebar.jsx";
import { useStore } from "../lib/store.jsx";
import { findBot, roomCss, StateCard } from "../components/room/common.jsx";
import { useRoom } from "../components/room/useRoom.js";
import ArtifactPanel from "../components/room/ArtifactPanel.jsx";
import SideDock from "../components/room/SideDock.jsx";
import PositionRail, { railItems } from "../components/room/PositionRail.jsx";
import FilesPanel, { FileView, fileIcon } from "../components/room/FilesPanel.jsx";
import BrowserLive from "../components/computer/BrowserLive.jsx";
import AsidePanel, { askAsideAbout } from "../components/room/AsidePanel.jsx";
import SelectionPopup, { quoteInto } from "../components/room/SelectionPopup.jsx";
import {
  BlockerBand, StuckBand, MembersButton, PauseButton, ResumeLink, RepliesPanel, ProgressPanel, RoomComposer, RoomMessages, RoomTitle,
  ThreadPanel, coordinatorName, typingInfo, withOrphanQuestions, OlderMessages } from "../components/room/RoomParts.jsx";

// Sala de equipo — design/Sala.dc.html. The right-hand side is one panel with tabs (OpenClaw
// unified side panel): the bots' thread, progress, files (each file in its own tab),
// deliverables, a message's replies and the live browser while a bot browses.
const I = { size: 15, strokeWidth: 2.2, "aria-hidden": "true" };
const BROWSING = ["navegando", "rellenando un formulario", "usando el ordenador", "ejecutando una tarea"];
const SHORTCUTS = { aparte: "mod+shift+s", archivos: "mod+shift+b", progreso: "mod+alt+shift+e", hilo: "mod+alt+shift+j", navegador: "mod+alt+shift+u" };
const TABS = {
  hilo: { id: "hilo", kind: "hilo" },
  progreso: { id: "progreso", kind: "progreso" },
  archivos: { id: "archivos", kind: "archivos" },
  navegador: { id: "navegador", kind: "navegador" },
  aparte: { id: "aparte", kind: "aparte" },
};

export default function Sala({ params, query }) {
  const id = params.id;
  const { bots } = useStore();
  const room = useRoom(id);
  const follow = useFollow(id);
  const scope = useRef(null);
  const scroller = useRef(null);
  useRevealMessage(query?.m || null, { ready: !room.loading && !!room.mission, olderCount: room.olderCount, showOlder: room.showOlder });
  const { mission, messages, steps, thread, artifacts, approvals, pending, live, activity, memberIds } = room;
  const dock = useDock(id, { transient: (t) => t.kind === "navegador" });
  const progress = mission?.progress || { done: steps.filter((s) => ["completed", "done"].includes(s.status)).length, total: steps.filter((s) => s.kind !== "plan").length };
  const typing = mission ? typingInfo({ mission, activity, live, bots, steps }) : null;

  // First visit to a room: its thread opens if there is one (afterwards, your choice stays).
  useEffect(() => {
    if (dock.fresh && thread.length) dock.open(TABS.hilo);
  }, [dock.fresh, thread.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Links such as /sala/x?panel=progreso open that tab.
  useEffect(() => {
    if (query?.panel && TABS[query.panel]) dock.open(TABS[query.panel]);
  }, [query?.panel]); // eslint-disable-line react-hooks/exhaustive-deps
  // While a bot browses, its live view comes in as a tab, unless you closed it in this room.
  const browsing = activity.find((a) => BROWSING.includes(a.verb));
  const dismissed = useRef(false);
  useEffect(() => { dismissed.current = false; }, [id]);
  useEffect(() => {
    if (browsing && !dismissed.current && !dock.tabs.some((t) => t.kind === "navegador")) dock.open(TABS.navegador);
  }, [!!browsing]); // eslint-disable-line react-hooks/exhaustive-deps
  const dockView = { ...dock, close: (tabId) => { if (tabId === "navegador") dismissed.current = true; dock.close(tabId); } };

  const openDoc = (artifactId) => {
    const tabId = "doc:" + artifactId;
    if (dock.isVisible(tabId)) return dock.close(tabId);
    dock.open({ id: tabId, kind: "doc", artifactId });
  };
  const openReplies = (msgId) => {
    const tabId = "respuestas:" + msgId;
    if (dock.isVisible(tabId)) return dock.close(tabId);
    dock.open({ id: tabId, kind: "respuestas", parentId: msgId });
  };
  const openFile = (f) => dock.open({ id: "file:" + f.path, kind: "file", path: f.path, name: f.name, type: f.type });
  usePanelShortcuts(Object.entries(SHORTCUTS).map(([key, combo]) => ({ combo, run: () => dock.toggle(TABS[key]) })), !!mission);
  // The files list follows what the bots do (a file written, a deliverable saved).
  const workVersion = useMemo(() => steps.reduce((n, s) => n + (s.activity?.length || 0), 0) + artifacts.length + messages.length, [steps, artifacts, messages]);

  const resolve = (t) => {
    if (t.kind === "aparte") return { label: "Preguntar aparte", icon: <MessageCircleQuestion {...I} />, title: "Preguntar aparte, sin interrumpir · " + comboLabel(SHORTCUTS.aparte), render: () => <AsidePanel mission={mission} /> };
    if (t.kind === "hilo") return { label: "Hilo entre bots", icon: <MessagesSquare {...I} />, badge: thread.length || null, title: "Hilo entre bots · " + comboLabel(SHORTCUTS.hilo), render: () => <ThreadPanel bare mission={mission} thread={thread} bots={bots} /> };
    if (t.kind === "progreso") return { label: "Progreso", icon: <ListChecks {...I} />, badge: `${progress.done || 0}/${progress.total || 0}`, title: "Progreso · " + comboLabel(SHORTCUTS.progreso), render: () => <ProgressPanel bare mission={mission} steps={steps} pending={pending} activity={activity} bots={bots} /> };
    if (t.kind === "archivos") return { label: "Archivos", icon: <FolderOpen {...I} />, title: "Archivos · " + comboLabel(SHORTCUTS.archivos), render: () => <FilesPanel missionId={id} onOpen={openFile} version={workVersion} /> };
    if (t.kind === "file") return { label: t.name || t.path, icon: fileIcon(t.type), title: t.path, render: () => <FileView missionId={id} path={t.path} /> };
    if (t.kind === "doc") {
      const a = artifacts.find((x) => x.id === t.artifactId);
      return { label: a?.title || "Entregable", icon: <FileText {...I} />, render: () => <ArtifactPanel bare artifactId={t.artifactId} bots={bots} variant="room" /> };
    }
    if (t.kind === "respuestas") return { label: "Respuestas", icon: <MessageSquareReply {...I} />, badge: messages.filter((m) => m.replyTo === t.parentId).length || null, render: () => <RepliesPanel bare mission={mission} messages={messages} steps={steps} bots={bots} parentId={t.parentId} /> };
    if (t.kind === "navegador") {
      const who = browsing ? findBot(bots, browsing.botId) : null;
      return { label: "Navegador", icon: <Globe {...I} />, title: "Navegador en vivo · " + comboLabel(SHORTCUTS.navegador), render: () => <div style={{ padding: "12px 14px" }}><BrowserLive missionId={id} bot={who} verb={browsing?.verb || null} missionActive={mission?.status === "running"} /></div> };
    }
    return null;
  };
  const tabs = mission ? dock.tabs.map((t) => { const r = resolve(t); return r ? { ...t, ...r } : null; }).filter(Boolean) : [];
  const addable = [
    { key: "aparte", label: "Preguntar aparte", icon: <MessageCircleQuestion {...I} />, combo: SHORTCUTS.aparte, tab: TABS.aparte },
    { key: "archivos", label: "Archivos", icon: <FolderOpen {...I} />, combo: SHORTCUTS.archivos, tab: TABS.archivos },
    { key: "progreso", label: "Progreso", icon: <ListChecks {...I} />, combo: SHORTCUTS.progreso, tab: TABS.progreso },
    { key: "hilo", label: "Hilo entre bots", icon: <MessagesSquare {...I} />, combo: SHORTCUTS.hilo, tab: TABS.hilo },
    { key: "navegador", label: "Navegador en vivo", icon: <Globe {...I} />, combo: SHORTCUTS.navegador, tab: TABS.navegador },
  ].filter((a) => !dock.tabs.some((t) => t.id === a.tab.id));
  const expanded = dock.expanded && dock.open && tabs.length > 0;
  const headBtn = (pressed) => ({ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 12px", background: pressed ? "#12131A" : "#FFFFFF", color: pressed ? "#FFFFFF" : "#12131A", border: "1px solid " + (pressed ? "#12131A" : "#DCE0E8"), borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600" });

  let body;
  if (room.loading) body = <StateCard title="Abriendo la sala…" />;
  else if (!mission) body = <StateCard tone="error" title="No encuentro esta sala" text={room.error || "Puede que se haya borrado o que el enlace no sea correcto."} href="/" cta="Volver al inicio" />;

  return (
    <>
      <style>{css + roomCss}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#FFFFFF" }}>
        <Sidebar variant="compact" activeRoom={id} />
        <main className="colmena-chat" style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column" }}>
          {body || (
            <>
              <header style={{ minHeight: "68px", padding: "10px clamp(16px, 3vw, 28px)", borderBottom: "1px solid #DCE0E8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <RoomTitle mission={mission} subtitle={`${mission.title || mission.prompt || ""} · coordina ${coordinatorName(bots)}`} />
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                  {mission.mode === "debate" ? (
                    <a href={`/sala/${id}/debate`} style={{ display: "flex", alignItems: "center", height: "40px", padding: "0 14px", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px" }}>{"Ver el debate"}</a>
                  ) : null}
                  <button type="button" className="rm-focus" aria-pressed={dock.isVisible("aparte") ? "true" : "false"} title={"Pregunta sin interrumpir a nadie · " + comboLabel(SHORTCUTS.aparte)} onClick={() => dock.toggle(TABS.aparte)} style={headBtn(dock.isVisible("aparte"))}>
                    <MessageCircleQuestion {...I} size={16} />{"Preguntar aparte"}
                  </button>
                  <MembersButton memberIds={memberIds} bots={bots} />
                  <button type="button" className="rm-focus" aria-pressed={dock.isVisible("archivos") ? "true" : "false"} title={"Archivos de la sala · " + comboLabel(SHORTCUTS.archivos)} onClick={() => dock.toggle(TABS.archivos)} style={headBtn(dock.isVisible("archivos"))}>
                    <FolderOpen {...I} />{"Archivos"}
                  </button>
                  <button type="button" className="rm-focus" aria-pressed={dock.isVisible("progreso") ? "true" : "false"} title={"Progreso · " + comboLabel(SHORTCUTS.progreso)} onClick={() => dock.toggle(TABS.progreso)} style={headBtn(dock.isVisible("progreso"))}>
                    {"Progreso"}
                    <span style={{ font: "500 12px/1 'Geist Mono', monospace" }}>{`${progress.done || 0}/${progress.total || 0}`}</span>
                  </button>
                  {!dock.open && dock.tabs.length ? (
                    <button type="button" className="rm-focus" onClick={() => dock.setOpen(true)} title="Volver a mostrar el panel lateral" style={headBtn(false)}>{`Panel · ${dock.tabs.length}`}</button>
                  ) : null}
                  <PauseButton mission={mission} />
                </div>
              </header>
              <BlockerBand mission={mission} pending={pending} bots={bots} />
              <StuckBand mission={mission} bots={bots} />
              <div className="colmena-chat-body" style={{ flex: "1", display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
                <section ref={(el) => { follow.ref(el); scroller.current = el; }} aria-label="Mensajes de la sala" hidden={expanded} style={{ flex: "999 1 460px", minWidth: "0", display: expanded ? "none" : "flex", flexDirection: "column", order: 1 }}>
                  <div ref={scope} style={{ flex: "1", padding: "20px clamp(16px, 3vw, 28px) 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <SelectionPopup scope={scope} onQuote={(t) => quoteInto(id, t)} onAsk={(t) => { askAsideAbout(id, t); dock.open(TABS.aparte); }} />
                    {messages.length === 0 ? (
                      <p style={{ margin: "0", padding: "24px 0", fontSize: "15px", lineHeight: "1.55", color: "#4A4F5C" }}>
                        {mission.status === "queued" || mission.status === "planning"
                          ? `${coordinatorName(bots)} está leyendo el encargo y preparando el reparto.`
                          : mission.error
                            ? "La sala se detuvo antes de que nadie escribiera."
                            : "Aún no hay mensajes en esta sala. Escribe abajo para empezar."}
                      </p>
                    ) : null}
                    <OlderMessages count={room.olderCount} onShow={room.showOlder} />
                    <InteractiveContext.Provider value={{ send: (text) => post(`/missions/${id}/messages`, { text }) }}><RoomMessages
                      mission={mission}
                      messages={withOrphanQuestions(messages, pending)}
                      thread={thread}
                      bots={bots}
                      approvals={approvals}
                      artifacts={artifacts}
                      steps={steps}
                      onOpenArtifact={openDoc}
                      openArtifactId={(dock.open && dock.tabs.find((t) => t.id === dock.active && t.kind === "doc")?.artifactId) || null}
                      threadOpen={dock.isVisible("hilo")}
                      onToggleThread={() => dock.toggle(TABS.hilo)}
                      onOpenReplies={openReplies}
                      openRepliesId={(dock.open && dock.tabs.find((t) => t.id === dock.active && t.kind === "respuestas")?.parentId) || null}
                    /></InteractiveContext.Provider>
                    {mission.error ? (
                      <p role="alert" style={{ margin: "8px 0 0 52px", padding: "12px 14px", background: "#FBE7DF", border: "1.5px solid #B4372A", borderRadius: "12px", fontSize: "14px", lineHeight: "1.5" }}>
                        <strong>{"Se ha detenido: "}</strong>{mission.error}
                        {["paused", "failed", "waiting"].includes(mission.status) ? <> {" "}<ResumeLink mission={mission} /></> : null}
                      </p>
                    ) : null}
                  </div>
                  <PositionRail scroller={scroller} items={railItems(messages, (b) => findBot(bots, b || "atlas").name)} version={messages.length} />
                  <RoomComposer mission={mission} bots={bots} memberIds={memberIds} typing={typing} messages={messages} onSent={follow.toEnd} below={follow.below} onJump={follow.toEnd} secrets={pending.filter((a) => a.kind === "secret")} approvals={pending} />
                </section>
                <SideDock dock={dockView} tabs={tabs} addable={addable} widthKey="room" label="Panel de la sala" />
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
