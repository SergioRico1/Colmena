import { useEffect, useState } from "react";
import { CircleHelp } from "lucide-react";
import { InteractiveContext } from "../components/room/Interactive.jsx";
import { useStickToBottom } from "../lib/useStickToBottom.js";
import BrowserLive from "../components/computer/BrowserLive.jsx";
const COMPUTER_VERBS = new Set(["navegando", "rellenando un formulario", "usando el ordenador", "ejecutando una tarea"]);
import { css } from "../design/css/EnVivo.js";
import Sidebar from "../components/Sidebar.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { post } from "../lib/api.js";
import { words } from "../lib/format.js";
import { BotAvatar, ErrorLine, StateCard, findBot, roomCss } from "../components/room/common.jsx";
import { useRoom, ACTIVE_STEP, isRunning } from "../components/room/useRoom.js";
import ArtifactPanel, { svgSrc } from "../components/room/ArtifactPanel.jsx";
import StatesLegend from "../components/room/StatesLegend.jsx";
import VerbIcon, { VERB_3RD, VERB_LABEL, normalizeVerb } from "../components/room/VerbIcon.jsx";
import { PauseButton, RepliesPanel, StuckBand, RoomComposer, RoomMessages, RoomTitle, coordinatorName, withOrphanQuestions } from "../components/room/RoomParts.jsx";
import QuickQuestion from "../components/interaction/QuickQuestion.jsx";

// En directo — design/EnVivo.dc.html

const CARD = { margin: "6px 0", border: "1px solid #DCE0E8", borderRadius: "18px", overflow: "hidden", background: "#FFFFFF" };
const CARD_HEAD = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: "1px solid #E6E8EE" };
const VERB_CHIP = { display: "flex", alignItems: "center", gap: "8px", height: "28px", padding: "0 10px", background: "#EEF0F4", borderRadius: "14px", fontSize: "13px", fontWeight: "600" };
const BTN_DARK = { height: "40px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: "600" };
const BTN_LIGHT = { height: "40px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "13px" };

/** «Más cercano», «Más corto», «Dar indicaciones» → POST /missions/:id/thread. */
function useHint(missionId) {
  const { act, busy, error } = useAction();
  const [sent, setSent] = useState(null);
  const send = (text, label) =>
    act(async () => {
      await post(`/missions/${missionId}/thread`, { text });
      setSent(label);
      setTimeout(() => setSent(null), 2400);
    });
  return { send, busy, error, sent };
}

function HintNote({ hint }) {
  if (hint.error) return <ErrorLine style={{ flexBasis: "100%" }}>{hint.error}</ErrorLine>;
  if (hint.sent) return <span role="status" style={{ alignSelf: "center", fontSize: "13px", color: "#0B6B4A" }}>{`«${hint.sent}» enviado al hilo`}</span>;
  return null;
}

function HintForm({ bot, hint, onDone }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await hint.send(`@${bot.name} ${text.trim()}`, "Indicación");
        setText("");
        onDone();
      }}
      style={{ flexBasis: "100%" }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 12px", background: "#FFFFFF", border: "1.5px solid #A9AEBB", borderRadius: "12px" }}>
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{`Indicaciones para ${bot.name}`}</span>
        <input type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`Dile a ${bot.name} qué cambiar…`} style={{ flex: "1", minWidth: "0", height: "40px", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
        <button type="submit" aria-label="Enviar indicaciones" disabled={hint.busy} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </label>
    </form>
  );
}

function stripMd(text) {
  return String(text || "")
    .replace(/```[\s\S]*?(```|$)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function WritingCard({ worker, missionId, onOpen }) {
  const hint = useHint(missionId);
  const { bot, step, text } = worker;
  const lines = String(text || "").split("\n");
  const headings = lines.map((l) => /^#{1,3}\s+(.+)/.exec(l)?.[1]).filter(Boolean);
  const headline = headings[0] || null;
  const bodyText = stripMd(headline ? text.replace(/^#{1,3}\s+.+$/m, "") : text);
  const tail = bodyText.length > 700 ? "…" + bodyText.slice(-700) : bodyText;
  const sections = headings.slice(1);
  return (
    <article style={CARD}>
      <div style={CARD_HEAD}>
        <BotAvatar bot={bot} size={32} />
        <strong style={{ fontSize: "15px" }}>{bot.name}</strong>
        <span style={VERB_CHIP}><VerbIcon verb="escribiendo" size="card" />{"Escribiendo"}</span>
        <span style={{ flex: "1" }} />
        <span style={{ font: "500 13px/1 'Geist Mono', monospace", color: "#4A4F5C" }}>{`${words(text)} palabras`}</span>
      </div>
      <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: "12px", background: "#FCFCFD" }}>
        <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{step?.title || "Texto en directo"}</span>
        {headline ? <h3 style={{ margin: "0", font: "800 30px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{headline}</h3> : null}
        <p aria-live="off" style={{ margin: "0", fontSize: "17px", lineHeight: "1.6", color: "#2B2D36", minHeight: "82px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {tail || (text ? "" : "Empezando a escribir")}
          <span aria-hidden="true" style={{ display: "inline-block", width: "2px", height: "1.1em", marginLeft: "2px", verticalAlign: "text-bottom", background: bot.color || "#7B4DFF", animation: "blink 1s steps(1) infinite" }} />
        </p>
        {sections.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "13px" }}>
            {sections.map((s, i) => (i < sections.length - 1 ? (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: "5px", height: "30px", padding: "0 10px", background: "#12131A", color: "#FFFFFF", borderRadius: "15px" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                {s}
              </span>
            ) : (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: "5px", height: "30px", padding: "0 10px", border: "1.5px solid #12131A", borderRadius: "15px", fontWeight: "600" }}>{s + "…"}</span>
            )))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 16px", borderTop: "1px solid #E6E8EE" }}>
        <button type="button" className="rm-focus" onClick={onOpen} style={BTN_DARK}>{"Abrir el documento"}</button>
        <button type="button" className="rm-focus" disabled={hint.busy} onClick={() => hint.send(`@${bot.name} Hazlo más cercano.`, "Más cercano")} style={BTN_LIGHT}>{"Más cercano"}</button>
        <button type="button" className="rm-focus" disabled={hint.busy} onClick={() => hint.send(`@${bot.name} Hazlo más corto.`, "Más corto")} style={BTN_LIGHT}>{"Más corto"}</button>
        <HintNote hint={hint} />
      </div>
    </article>
  );
}

function codeLines(text) {
  const src = String(text || "");
  const fence = /```([\w+-]*)\n([\s\S]*?)(```|$)/.exec(src);
  const body = fence ? fence[2] : src;
  return { lang: fence?.[1] || "", lines: body.replace(/\n$/, "").split("\n") };
}
function lineColor(line) {
  const t = line.trim();
  if (/^(\/\/|#|--|\/\*|\*)/.test(t)) return "#7FD1AE";
  if (/^<\/?[\w!]/.test(t) || /^(import|export|from|def|class|function|const|let|return|if|for|while)\b/.test(t)) return "#FF9F5A";
  return "#E6E8EE";
}

function ActivitySteps({ activity, fallback }) {
  const items = activity.length ? activity : [{ text: fallback }];
  return (
    <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", font: "400 13px/1.4 'Geist Mono', monospace" }}>
      {items.slice(-6).map((a, i, all) => (i < all.length - 1 ? (
        <li key={i} style={{ display: "flex", gap: "8px" }}><span style={{ color: "#0B6B4A" }}>{"✓"}</span>{a.text || a.verb}</li>
      ) : (
        <li key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span aria-hidden="true" style={{ width: "12px", height: "12px", flex: "none", borderRadius: "50%", border: "2px solid #DCE0E8", borderTopColor: "#12131A", animation: "spin .8s linear infinite" }} />
          {a.text || a.verb}
        </li>
      )))}
    </ul>
  );
}

function CodeCard({ worker, onOpen }) {
  const { bot, step, text } = worker;
  const { lang, lines } = codeLines(text);
  const start = Math.max(0, lines.length - 14);
  const shown = text ? lines.slice(start) : [];
  return (
    <article style={CARD}>
      <div style={CARD_HEAD}>
        <BotAvatar bot={bot} size={32} />
        <strong style={{ fontSize: "15px" }}>{bot.name}</strong>
        <span style={VERB_CHIP}><VerbIcon verb="programando" size="card" />{"Programando"}</span>
        <span style={{ flex: "1" }} />
        <span style={{ font: "500 13px/1 'Geist Mono', monospace" }}><span style={{ color: "#0B6B4A" }}>{"+" + (text ? lines.length : 0)}</span></span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "3 1 380px", minWidth: "0", background: "#12131A", color: "#E6E8EE", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: "2px", padding: "8px 10px 0", font: "500 12px/1 'Geist Mono', monospace" }}>
            <span style={{ padding: "8px 12px", background: "#1D1F27", borderRadius: "8px 8px 0 0", color: "#FFFFFF" }}>{(step?.title || "código") + (lang ? ` · ${lang}` : "")}</span>
          </div>
          <div style={{ padding: "14px 0 16px", background: "#1D1F27", minHeight: "236px", font: "400 13px/1.75 'Geist Mono', monospace", overflowX: "auto" }}>
            {shown.map((l, i) => (
              <div key={start + i} style={{ display: "flex", whiteSpace: "pre", paddingRight: "16px" }}>
                <span style={{ width: "40px", flex: "none", textAlign: "right", paddingRight: "14px", color: "#6B7080" }}>{start + i + 1}</span>
                <span style={{ color: lineColor(l) }}>{l}</span>
                {i === shown.length - 1 ? <span aria-hidden="true" style={{ display: "inline-block", width: "8px", height: "16px", margin: "3px 0 0 2px", background: "#FFC93C", animation: "blink 1s steps(1) infinite" }} /> : null}
              </div>
            ))}
            {!shown.length ? (
              <div style={{ display: "flex", paddingLeft: "40px" }}><span aria-hidden="true" style={{ display: "inline-block", width: "8px", height: "16px", margin: "3px 0 0 2px", background: "#FFC93C", animation: "blink 1s steps(1) infinite" }} /></div>
            ) : null}
          </div>
        </div>
        <div style={{ flex: "2 1 240px", padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <strong style={{ fontSize: "14px" }}>{"Pasos"}</strong>
          <ActivitySteps activity={step?.activity || []} fallback="Escribiendo el código" />
          <button type="button" className="rm-focus" onClick={onOpen} style={{ marginTop: "auto", alignSelf: "flex-start", ...BTN_LIGHT }}>{"Ver vista previa"}</button>
        </div>
      </div>
    </article>
  );
}

function ImageCard({ worker, missionId, onOpen, svg }) {
  const hint = useHint(missionId);
  const [giving, setGiving] = useState(false);
  const { bot, step } = worker;
  const activity = step?.activity || [];
  const phases = activity.length ? activity : [{ text: "Preparando la imagen" }];
  const ready = Boolean(svg);
  return (
    <article style={CARD}>
      <div style={CARD_HEAD}>
        <BotAvatar bot={bot} size={32} />
        <strong style={{ fontSize: "15px" }}>{bot.name}</strong>
        <span style={VERB_CHIP}><VerbIcon verb="creando imagen" size="card" />{ready ? "Imagen lista" : "Creando imagen"}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "18px", padding: "16px" }}>
        <div role="img" aria-label={ready ? `Imagen de ${bot.name}` : "Imagen generándose"} style={{ flex: "1 1 300px", position: "relative", aspectRatio: "16 / 10", borderRadius: "12px", overflow: "hidden", background: "#FFE6F1" }}>
          {ready ? <img src={svgSrc(svg)} alt="" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain" }} /> : null}
          {!ready ? (
            <>
              <span aria-hidden="true" style={{ position: "absolute", inset: "0", background: "linear-gradient(100deg, transparent 30%, rgba(255,255,255,.55) 50%, transparent 70%)", animation: "shimmer 1.8s ease-in-out infinite" }} />
              <span aria-hidden="true" style={{ position: "absolute", left: "0", right: "0", height: "25%", background: "linear-gradient(transparent, rgba(255,255,255,.35), transparent)", animation: "scan 2.4s linear infinite" }} />
            </>
          ) : null}
        </div>
        <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <ol style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" }}>
            {phases.map((p, i) => {
              const current = !ready && i === phases.length - 1;
              return (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: current ? "700" : "500", color: "#12131A" }}>
                  {current ? (
                    <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", borderRadius: "50%", border: "3px solid #DCE0E8", borderTopColor: "#12131A", animation: "spin .8s linear infinite" }} />
                  ) : (
                    <span style={{ width: "20px", height: "20px", flex: "none", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", display: "grid", placeItems: "center" }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                    </span>
                  )}
                  {p.text || p.verb}
                </li>
              );
            })}
          </ol>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "auto" }}>
            {onOpen ? <button type="button" className="rm-focus" onClick={onOpen} style={BTN_DARK}>{"Abrir el documento"}</button> : null}
            <button type="button" className="rm-focus" aria-expanded={giving ? "true" : "false"} onClick={() => setGiving(!giving)} style={BTN_LIGHT}>{"Dar indicaciones"}</button>
            {giving ? <HintForm bot={bot} hint={hint} onDone={() => setGiving(false)} /> : null}
            <HintNote hint={hint} />
          </div>
        </div>
      </div>
    </article>
  );
}

function SmallCard({ worker }) {
  const { bot, step, verb, detail } = worker;
  const last = (step?.activity || [])[step?.activity?.length - 1];
  const sub = last?.text || (detail ? step?.title : null) || VERB_LABEL[verb];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", border: "1px solid #DCE0E8", borderRadius: "14px" }}>
      <BotAvatar bot={bot} size={32} />
      <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ fontSize: "14px" }}>
          <strong>{bot.name}</strong>
          {" " + VERB_3RD[verb] + (detail ? " " + detail : step?.title ? " · " + step.title : "")}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#4A4F5C" }}>
          <VerbIcon verb={verb} size="card" />
          {sub}
        </span>
      </div>
    </div>
  );
}

export default function EnVivo({ params }) {
  const id = params.id;
  const { bots } = useStore();
  const room = useRoom(id);
  const messagesRef = useStickToBottom(id);
  const { mission, messages, steps, thread, artifacts, approvals, pending, live, activity, memberIds } = room;
  const [panel, setPanel] = useState(null); // { artifactId } | { stepId }

  // Who is doing what right now: running steps + live activity + live text.
  const running = steps.filter((s) => ACTIVE_STEP.has(s.status));
  const byBot = new Map();
  const touch = (botId, patch) => {
    if (!botId) return;
    byBot.set(botId, { botId, ...(byBot.get(botId) || {}), ...patch });
  };
  running.forEach((s) => {
    const last = (s.activity || [])[s.activity?.length - 1];
    touch(s.botId, { step: s, verb: last?.verb });
  });
  live.forEach((l) => touch(l.botId, { liveStepId: l.stepId, text: l.text, verb: byBot.get(l.botId)?.verb || "escribiendo" }));
  activity.forEach((a) => touch(a.botId, { verb: a.verb, detail: a.detail }));
  const workers = [...byBot.values()].map((w) => {
    const verb = normalizeVerb(w.verb || (w.text ? "escribiendo" : "pensando"));
    const step = w.step || steps.find((s) => s.id === w.liveStepId) || null;
    const text = w.text ?? live.find((l) => l.stepId === step?.id)?.text ?? "";
    return { ...w, verb, step, text, bot: findBot(bots, w.botId) };
  });
  if (!workers.length && isRunning(mission)) workers.push({ botId: "atlas", verb: "pensando", bot: findBot(bots, "atlas"), step: null, text: "" });
  const asking = pending.filter((a) => a.kind === "question");

  const nothingRunning = mission && !workers.length && !isRunning(mission);
  useEffect(() => {
    if (nothingRunning) navigate(`/sala/${id}`, { replace: true });
  }, [nothingRunning, id]);

  const pendingQuestionIds = new Set(asking.map((a) => a.id));
  const isPendingQuestion = (m) => m.kind === "question" && pendingQuestionIds.has(m.approvalId);
  const questions = withOrphanQuestions(messages, pending).filter(isPendingQuestion);

  const lastThread = thread[thread.length - 1];
  const talking = lastThread && lastThread.from !== "user" && Date.now() - Date.parse(lastThread.at || 0) < 10 * 60 * 1000 ? lastThread : null;

  const artifactFor = (w) => artifacts.filter((a) => a.botId === w.botId && (!w.step?.id || !a.stepId || a.stepId === w.step.id)).slice(-1)[0] || null;
  const openFor = (w) => () => {
    const artifact = artifactFor(w);
    setPanel(artifact ? { artifactId: artifact.id } : { stepId: w.step?.id || w.liveStepId, botId: w.botId, title: w.step?.title || `Texto de ${w.bot.name}` });
  };
  const panelLive = panel?.stepId ? { title: panel.title, botId: panel.botId, text: live.find((l) => l.stepId === panel.stepId)?.text || workers.find((w) => w.botId === panel.botId)?.text || steps.find((s) => s.id === panel.stepId)?.text || "" } : null;

  let body = null;
  if (room.loading) body = <StateCard title="Conectando con la sala…" />;
  else if (!mission) body = <StateCard tone="error" title="No encuentro esta sala" text={room.error || "Puede que se haya borrado o que el enlace no sea correcto."} href="/" cta="Volver al inicio" />;

  const browsing = workers.filter((w) => COMPUTER_VERBS.has(w.verb));
  const big = workers.filter((w) => ["escribiendo", "programando", "creando imagen"].includes(w.verb));
  const small = workers.filter((w) => !big.includes(w) && !browsing.includes(w));

  return (
    <>
      <style>{css + roomCss}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" activeRoom={id} />
        <main className="colmena-chat" style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
          {body || (
            <>
              <header style={{ minHeight: "68px", padding: "10px clamp(16px, 3vw, 28px)", borderBottom: "1px solid #DCE0E8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <RoomTitle mission={mission} subtitle={`${mission.title || mission.prompt || ""} · coordina ${coordinatorName(bots)}`} />
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                  {mission.mode === "debate" ? (
                    <a href={`/sala/${id}/debate`} style={{ display: "flex", alignItems: "center", height: "40px", padding: "0 14px", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px" }}>{"Ver el debate"}</a>
                  ) : null}
                  <QuickQuestion mission={mission} bots={bots} />
                  <PauseButton mission={mission} />
                </div>
              </header>
              <StuckBand mission={mission} bots={bots} />
              <div aria-label="Qué está haciendo cada bot ahora" role="status" style={{ padding: "10px clamp(16px, 3vw, 28px)", background: "#F7F8FA", borderBottom: "1px solid #E6E8EE", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "6px", font: "600 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#4A4F5C" }}>
                  <span style={{ position: "relative", width: "8px", height: "8px" }}>
                    <span style={{ position: "absolute", inset: "0", borderRadius: "50%", background: "#0B8A5F" }} />
                    <span style={{ position: "absolute", inset: "0", borderRadius: "50%", background: "#0B8A5F", animation: "live 1.6s ease-out infinite" }} />
                  </span>
                  {mission.status === "paused" ? "En pausa" : "En directo"}
                </span>
                <button type="button" className="rm-focus" onClick={() => setPanel(panel?.legend ? null : { legend: true })} aria-pressed={panel?.legend ? "true" : "false"} title="Qué significa cada estado"
                  style={{ order: 99, marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 10px", background: panel?.legend ? "#EEF0F4" : "transparent", border: "1px solid " + (panel?.legend ? "#DCE0E8" : "transparent"), borderRadius: "10px", cursor: "pointer", fontSize: "13px", color: "#4A4F5C" }}>
                  <CircleHelp size={15} strokeWidth={2} aria-hidden="true" />{"Qué significa cada estado"}
                </button>
                {workers.map((w) => (
                  <span key={w.botId} style={{ display: "flex", alignItems: "center", gap: "8px", height: "36px", padding: "0 12px 0 5px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", fontSize: "13px" }}>
                    <BotAvatar bot={w.bot} size={26} />
                    <strong>{w.bot.name}</strong>
                    {" " + w.verb}
                    <VerbIcon verb={w.verb} size="chip" />
                  </span>
                ))}
                {asking.map((a) => {
                  const bot = findBot(bots, a.botId);
                  return (
                    <a key={a.id} href="#pregunta" onClick={(e) => { const t = document.getElementById("pregunta"); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: "smooth", block: "center" }); t.querySelector("button")?.focus({ preventScroll: true }); } }} style={{ display: "flex", alignItems: "center", gap: "8px", height: "36px", padding: "0 12px 0 5px", background: "#FFF4D1", border: "1.5px solid #12131A", borderRadius: "18px", fontSize: "13px" }}>
                      <BotAvatar bot={bot} size={26} />
                      <strong>{bot.name}</strong>
                      {" te pregunta"}
                      <VerbIcon verb="pregunta" />
                    </a>
                  );
                })}
              </div>
              <div className="colmena-chat-body" style={{ flex: "1", display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
                <section ref={messagesRef} aria-label="Mensajes de la sala" style={{ flex: "999 1 520px", minWidth: "0", display: "flex", flexDirection: "column" }}>
                  <div style={{ flex: "1", padding: "20px clamp(16px, 3vw, 28px) 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <InteractiveContext.Provider value={{ send: (text) => post(`/missions/${id}/messages`, { text }) }}><RoomMessages
                      mission={mission}
                      messages={messages}
                      thread={thread}
                      bots={bots}
                      approvals={approvals}
                      artifacts={artifacts}
                      steps={steps}
                      onOpenArtifact={(artifactId) => setPanel({ artifactId })}
                      onOpenReplies={(repliesId) => setPanel(panel?.repliesId === repliesId ? null : { repliesId })}
                      openRepliesId={panel?.repliesId || null}
                      openArtifactId={panel?.artifactId}
                      threadOpen={false}
                      onToggleThread={() => navigate(`/sala/${id}?panel=hilo`)}
                      skip={isPendingQuestion}
                    /></InteractiveContext.Provider>
                    {browsing.map((w) => <BrowserLive key={"nav-" + w.botId} missionId={id} bot={w.bot || bots.find((b) => b.id === w.botId)} verb={w.verb} missionActive={mission?.status === "running"} />)}
                    {big.map((w) => {
                      if (w.verb === "programando") return <CodeCard key={w.botId} worker={w} onOpen={openFor(w)} />;
                      if (w.verb === "creando imagen") {
                        const art = artifactFor(w);
                        const svgLive = /<svg[\s\S]*<\/svg>/i.exec(w.text || "")?.[0];
                        return <ImageCard key={w.botId} worker={w} missionId={id} svg={svgLive || null} onOpen={art || w.text ? openFor(w) : null} />;
                      }
                      return <WritingCard key={w.botId} worker={w} missionId={id} onOpen={openFor(w)} />;
                    })}
                    {small.length ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: "10px", margin: "6px 0" }}>
                        {small.map((w) => <SmallCard key={w.botId} worker={w} />)}
                      </div>
                    ) : null}
                    {talking ? (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "6px 0 6px 52px", fontSize: "13px", color: "#4A4F5C" }}>
                        <span aria-hidden="true" style={{ position: "relative", width: "30px", height: "12px" }}>
                          <span style={{ position: "absolute", left: "0", top: "2px", width: "8px", height: "8px", borderRadius: "50%", background: findBot(bots, talking.from).color || "#2F6BFF", animation: "pass 1.4s ease-in-out infinite" }} />
                          <span style={{ position: "absolute", right: "0", top: "2px", width: "8px", height: "8px", borderRadius: "2px", background: (talking.to && findBot(bots, talking.to).color) || "#8C91A0", animation: "passback 1.4s ease-in-out infinite" }} />
                        </span>
                        <span style={{ flex: "1 1 240px" }}>
                          <strong style={{ color: "#12131A" }}>{talking.to ? `${findBot(bots, talking.from).name} y ${findBot(bots, talking.to).name}` : findBot(bots, talking.from).name}</strong>
                          {(talking.to ? " están hablando: " : " habla con el equipo: ") + talking.text}
                        </span>
                        <a href={`/sala/${id}?panel=hilo`} style={{ fontWeight: "600", color: "#1F4FD1" }}>{"Ver hilo"}</a>
                      </div>
                    ) : null}
                    {questions.length ? (
                      <InteractiveContext.Provider value={{ send: (text) => post(`/missions/${id}/messages`, { text }) }}><RoomMessages
                        mission={mission}
                        messages={questions}
                        thread={thread}
                        bots={bots}
                        approvals={approvals}
                        artifacts={artifacts}
                        steps={steps}
                        onOpenArtifact={(artifactId) => setPanel({ artifactId })}
                      onOpenReplies={(repliesId) => setPanel(panel?.repliesId === repliesId ? null : { repliesId })}
                      openRepliesId={panel?.repliesId || null}
                        days={false}
                        showThread={false}
                      /></InteractiveContext.Provider>
                    ) : null}
                  </div>
                  <RoomComposer mission={mission} bots={bots} memberIds={memberIds} variant="live" workingCount={workers.length} />
                </section>
                {panel?.repliesId ? (
                  <RepliesPanel key={panel.repliesId} mission={mission} messages={messages} steps={steps} bots={bots} parentId={panel.repliesId} onClose={() => setPanel(null)} />
                ) : panel?.artifactId ? (
                  <ArtifactPanel key={panel.artifactId} artifactId={panel.artifactId} bots={bots} variant="room" onClose={() => setPanel(null)} />
                ) : panelLive ? (
                  <ArtifactPanel key={panel.stepId || "live"} live={panelLive} bots={bots} variant="room" onClose={() => setPanel(null)} />
                ) : panel?.legend ? (
                  <StatesLegend onClose={() => setPanel(null)} />
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
