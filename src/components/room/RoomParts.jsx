import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useWarmOnType } from "../../lib/warm.js";
import { shapeOf } from "../v2/Presence.jsx";
import { ArrowDown, ArrowRight, ArrowUp, Ban, Brain, CircleAlert, CirclePause, FileText, GitBranch, LoaderCircle, Sparkles, Check, ChevronDown, Hourglass, MessageSquareReply, Pause, PenLine, Play, Plus, RotateCcw, Undo2, Wrench, X } from "lucide-react";
import { InteractiveContext } from "./Interactive.jsx";
import { freshness } from "../../lib/motion.js";
import { ReactTools, ReactionRow, useReactions } from "./Reactions.jsx";
import { useFileDrop, dropOverlay } from "../../lib/useFileDrop.js";
import { post, patch, pickFiles } from "../../lib/api.js";
import { failSent, showSent, unshowSent, useAction, useStore } from "../../lib/store.jsx";
import { useDraft, useInputHistory } from "../../lib/composer.js";
import LiveMarkdown, { markLive, wasLive } from "./LiveMarkdown.jsx";
import { usePhrase, useSlowPhase, verbLabel } from "./working.js";
import SecretPrompt, { SecretLine } from "./SecretPrompt.jsx";
import InlineApprovals from "./InlineApprovals.jsx";
import Sources from "./Sources.jsx";
import { asQuote, UserText } from "./SelectionPopup.jsx";
import { usePanelWidth } from "../../lib/usePanelWidth.jsx";
import { ago, roomUrl, time } from "../../lib/format.js";
import { navigate } from "../../lib/router.jsx";
import { BotAvatar, UserAvatar, FileChip, ErrorLine, Dots, MentionText, dayLabel, findBot, useDismiss, popoverStyle, popoverItem } from "./common.jsx";
import PastedCard from "./PastedCard.jsx";
import Markdown, { plain } from "./Markdown.jsx";
import QuestionCard from "./QuestionCard.jsx";
import DeliverableCard from "./DeliverableCard.jsx";
import ActivityLog, { PLUMBING } from "./ActivityLog.jsx";
import PlusMenu, { chosenChips, turnBody } from "../v2/chat/PlusMenu.jsx";
import { MentionMirror, MentionPill, findMentions } from "../v2/MentionPill.jsx";
import WorkingDots from "./Dots.jsx";
import { useMentions } from "./Mentions.jsx";
import { ACTIVE_STEP, BLOCKED_STEP, DONE_STEP } from "./useRoom.js";
import { ListenButton, MicButton, appendDictation } from "../interaction/Voice.jsx";
import UndoChanges from "../v2/chat/UndoChanges.jsx";

// Pieces shared by Sala (design/Sala.dc.html) and En directo (design/EnVivo.dc.html).

const TAG = { font: "600 10px/1 'Geist Mono', monospace", padding: "3px 5px", background: "#EEF0F4", borderRadius: "4px", color: "#4A4F5C", letterSpacing: "0.04em" };

/* ───────────── header ───────────── */

export function PauseButton({ mission }) {
  const { act, busy, error } = useAction();
  const paused = mission?.status === "paused";
  const finished = ["completed", "cancelled"].includes(mission?.status);
  if (!mission || finished) return null;
  return (
    <span style={{ position: "relative", display: "flex" }}>
      <button
        type="button"
        className="rm-focus"
        aria-label={paused ? "Reanudar a todos los bots de la sala" : "Pausar a todos los bots de la sala"}
        title={error || (paused ? "Reanudar: los bots siguen donde lo dejaron" : "Pausar: los bots paran y no se pierde nada")}
        disabled={busy}
        onClick={() => act(() => post(`/missions/${mission.id}/control`, { action: paused ? "resume" : "pause" }))}
        style={{ height: "40px", display: "flex", alignItems: "center", gap: "8px", padding: "0 12px", background: paused ? "#FFF4D1" : "#FFFFFF", border: paused ? "1.5px solid #12131A" : "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontWeight: "600", fontSize: "14px", color: "#12131A" }}
      >
        {paused ? (
          <Play size={15} strokeWidth={2.4} aria-hidden="true" />
        ) : (
          <Pause size={15} strokeWidth={2.4} aria-hidden="true" />
        )}
        <span aria-hidden="true">{paused ? "Reanudar" : "Pausar"}</span>
      </button>
      {error ? <ErrorLine style={{ position: "absolute", top: "calc(100% + 6px)", right: "0", width: "max-content", maxWidth: "280px", padding: "6px 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "8px", zIndex: "5" }}>{error}</ErrorLine> : null}
    </span>
  );
}

/** «Continuar» next to a stopped room's notice: resumes from the last saved step. */
export function ResumeLink({ mission }) {
  const { act, busy, error } = useAction();
  return (
    <>
      <button type="button" className="rm-focus" disabled={busy} onClick={() => act(() => post(`/missions/${mission.id}/control`, { action: "resume" }))}
        style={{ marginLeft: "6px", height: "32px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", verticalAlign: "middle" }}>
        {busy ? "Continuando…" : "Continuar"}
      </button>
      {error ? <span style={{ display: "block", marginTop: "6px", fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{error}</span> : null}
    </>
  );
}

export function RoomTitle({ mission, subtitle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
      <h1 style={{ margin: "0", font: "700 21px/1.1 'Bricolage Grotesque', sans-serif", overflowWrap: "anywhere" }}>
        <span style={{ color: "#8C91A0" }}>{"#"}</span>
        {" " + (mission?.room || "sala")}
      </h1>
      <p style={{ margin: "0", fontSize: "13px", color: "#555A68" }}>{subtitle}</p>
    </div>
  );
}

export function coordinatorName(bots) {
  return findBot(bots, "atlas")?.name || "Atlas";
}

/** «Miembros: tú y 5 bots» button with a members popover. */
export function MembersButton({ memberIds, bots }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const members = memberIds.map((id) => findBot(bots, id));
  return (
    <span ref={ref} style={{ position: "relative", display: "flex" }}>
      <button type="button" className="rm-focus" aria-label={`Miembros: tú y ${members.length} ${members.length === 1 ? "bot" : "bots"}`} aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 10px 0 6px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer" }}>
        <span aria-hidden="true" style={{ display: "flex" }}>
          {members.slice(0, 3).map((b, i) => <BotAvatar key={b.id} bot={b} size={26} ring={i > 0} style={i > 0 ? { marginLeft: "-5px" } : undefined} />)}
        </span>
        <span style={{ font: "600 13px/1 'Geist Mono', monospace" }}>{members.length + 1}</span>
      </button>
      {open ? (
        <div role="menu" aria-label="Miembros de la sala" style={{ ...popoverStyle, right: "0", top: "calc(100% + 6px)" }}>
          <div style={{ ...popoverItem, cursor: "default" }}>
            <UserAvatar size={24} />
            <strong>{"Tú"}</strong>
          </div>
          {members.map((b) => (
            <a key={b.id} role="menuitem" href={`/colmena/${b.id}`} className="rm-item" style={{ ...popoverItem }}>
              <BotAvatar bot={b} size={24} />
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "14px" }}>{b.name}</strong>
                <span style={{ fontSize: "12px", color: "#555A68" }}>{[b.role, b.statusLabel].filter(Boolean).join(" · ")}</span>
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/* ───────────── «Lo que te bloquea, siempre arriba» ───────────── */

/**
 * «Nora lleva 3 min sin avanzar»: a working room that has gone quiet (server mission.quiet)
 * offers to retry from the last saved step or to pause, instead of an endless «pensando».
 */
export function StuckBand({ mission, bots }) {
  const [now, setNow] = useState(() => Date.now());
  const { act, busy, error } = useAction();
  const quiet = mission?.quiet;
  useEffect(() => {
    if (!quiet) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [quiet]);
  if (!quiet || !["running", "planning", "queued"].includes(mission.status)) return null;
  const bot = quiet.botId ? findBot(bots, quiet.botId) : null;
  const minutes = Math.max(2, Math.round((now - Date.parse(quiet.since)) / 60000));
  const doing = quiet.verb ? quiet.verb + (quiet.detail ? " · " + quiet.detail : "") : null;
  const control = (action) => act(() => post(`/missions/${mission.id}/control`, { action }));
  const btn = { display: "inline-flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 12px", borderRadius: "9px", cursor: "pointer", fontWeight: "600", fontSize: "13px" };
  return (
    <div role="status" className="c-band" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "10px clamp(16px, 3vw, 28px)", background: "#F7F8FA", borderBottom: "1px solid #E6E8EE", fontSize: "14px" }}>
      {bot?.id === "atlas" ? <BotAvatar bot={bot} size={26} mood="plano" /> : <Hourglass size={18} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#4A4F5C" }} />}
      <span style={{ flex: "1 1 280px" }}>
        <strong>{(bot ? bot.name : "El equipo") + " lleva " + minutes + " min sin avanzar."}</strong>
        {" " + (doing ? "Lo último: " + doing + ". " : "") + "Puede ser una web lenta o que se haya atascado."}
        {error ? <span style={{ color: "#B4372A" }}>{" " + error}</span> : null}
      </span>
      <button type="button" className="rm-focus" disabled={busy} onClick={() => control("retry")} style={{ ...btn, background: "#12131A", color: "#FFFFFF", border: "0" }}>
        <RotateCcw size={14} strokeWidth={2.4} aria-hidden="true" />Reintentar
      </button>
      <button type="button" className="rm-focus" disabled={busy} onClick={() => control("pause")} style={{ ...btn, background: "transparent", color: "#12131A", border: "1px solid #DCE0E8" }}>
        <Pause size={14} strokeWidth={2.4} aria-hidden="true" />Pausar
      </button>
    </div>
  );
}

export function BlockerBand({ mission, pending, bots }) {
  const debate = mission?.mode === "debate" && mission?.status === "awaiting_choice";
  // Questions block the team first, then the plan; sends and permissions after.
  const rank = (a) => ({ question: 0, plan: 1 })[a.kind] ?? 2;
  const first = [...pending].sort((a, b) => rank(a) - rank(b))[0];
  if (!first && !debate) return null;
  const bot = findBot(bots, first?.botId || "atlas");
  let text;
  let href;
  let scrollTo = null;
  if (first) {
    text = first.kind === "question" ? first.summary || first.title : first.title || first.summary;
    if (first.kind === "question") scrollTo = "pregunta";
    else if (first.kind === "plan") scrollTo = "plan";
    else if (["permission", "write", "memory", "secret"].includes(first.kind) && !first.redLine) scrollTo = (first.kind === "secret" ? "clave-" : "aprobacion-") + first.id;
    href = scrollTo ? `#${scrollTo}` : `/revisar/${encodeURIComponent(first.id)}`;
  } else {
    text = "elige entre las propuestas del debate.";
    href = `/debate/${mission.id}`;
  }
  const more = pending.length > 1 ? ` · ${pending.length - 1} más en Hoy` : "";
  const onClick = scrollTo
    ? (e) => {
        const target = document.getElementById(scrollTo);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.querySelector("input, button")?.focus({ preventScroll: true });
      }
    : undefined;
  return (
    <a href={href} onClick={onClick} className="c-band" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "10px clamp(16px, 3vw, 28px)", background: "#FFF4D1", borderBottom: "1px solid #F2D27A", fontSize: "14px" }}>
      <BotAvatar bot={bot} size={22} mood="duda" />
      <span style={{ flex: "1 1 280px" }}>
        <strong>{`${bot.name} te espera:`}</strong>
        {" " + (text || "") + more}
      </span>
      <span style={{ display: "flex", alignItems: "center", height: "34px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", borderRadius: "999px", fontWeight: "600", fontSize: "13px" }}>{"Responder"}</span>
    </a>
  );
}

/* ───────────── messages ───────────── */

/** «para Tomás y Nora» from a message's `to` (bot ids; «user» is you). */
function toLabel(to, bots) {
  const list = (Array.isArray(to) ? to : to ? [to] : []).map((id) => (id === "user" ? "ti" : findBot(bots, id)?.name)).filter(Boolean);
  return list.length ? list.join(" y ") : null;
}

// Colmena 2.0 (design/V2Sala.dc.html): «Atlas · para Marta · 09:06»; no «BOT» labels.
function Head({ name, at, to = null }) {
  return (
    <span style={{ fontSize: "14px", lineHeight: "1.3", marginBottom: "-2px" }}>
      <strong style={{ fontWeight: "600" }}>{name}</strong>
      {" "}<span style={{ color: "#6B6F7A" }}>{[to ? "para " + to : null, at ? time(at) : null].filter(Boolean).map((x) => "· " + x).join(" ")}</span>
    </span>
  );
}

/** Slack-style hover toolbar: shown when the pointer (or keyboard focus) is on the message. */
function Actions({ children }) {
  return <span className="msg-actions" role="toolbar" aria-label="Acciones del mensaje">{children}</span>;
}

/** A row in the conversation: hover highlight; a continued message (same author, minutes
 *  later) has no avatar or header, only its time in the gutter on hover. */
function MessageRow({ id, messageId = null, avatar, continued, at, padding, children, actions, mine = false, entering = false, sending = false }) {
  return (
    <div id={id} data-message-id={messageId || undefined} className={"msg-row" + (mine ? " msg-row--mine" : "") + (entering ? " c-enter" : "")} aria-busy={sending ? "true" : undefined} style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", padding: padding || (continued ? "2px 16px" : "8px 16px"), margin: "0 -16px", opacity: sending ? 0.65 : 1, transition: "opacity .2s ease" }}>
      {continued ? <span className="msg-gutter-time" aria-hidden="true">{at ? time(at) : ""}</span> : avatar}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>{children}</div>
      {actions ? <Actions>{actions}</Actions> : null}
    </div>
  );
}

const REPLY_ICON = <MessageSquareReply size={16} strokeWidth={2} aria-hidden="true" />;

/** «Responder en un hilo» (Slack-style): opens the message's thread on the right. */
function ReplyButton({ onClick }) {
  if (!onClick) return null;
  return (
    <button type="button" className="rm-focus" onClick={onClick} aria-label="Responder en un hilo" title="Responder en un hilo"
      style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#4A4F5C" }}>
      {REPLY_ICON}
    </button>
  );
}

/** «Duplicar desde aquí»: a new room with the conversation up to this message (the original stays as it is). */
function ForkButton({ message }) {
  const { run } = useStore();
  const [busy, setBusy] = useState(false);
  if (!message?.missionId || !message.id || message.optimistic || message.failed) return null;
  const fork = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const copy = await run(() => post("/missions/" + encodeURIComponent(message.missionId) + "/fork", { messageId: message.id }));
      navigate(roomUrl(copy));
    } catch {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="rm-focus" onClick={fork} disabled={busy} aria-label="Duplicar desde aquí" title="Duplicar desde aquí: una sala nueva con la conversación hasta este mensaje"
      style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: busy ? "default" : "pointer", color: "#4A4F5C", opacity: busy ? 0.5 : 1 }}>
      <GitBranch size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/** «3 respuestas · 10:42» under a message that has a thread. */
function RepliesLink({ replies, bots, onOpen, pressed }) {
  if (!replies?.length) return null;
  const last = replies[replies.length - 1];
  const who = [...new Set(replies.map((r) => (r.role === "user" ? "user" : r.botId || "atlas")))].slice(0, 3);
  return (
    <button type="button" className="rm-focus" onClick={onOpen} aria-pressed={pressed ? "true" : "false"}
      style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", minHeight: "32px", padding: "2px 10px 2px 4px", background: pressed ? "#EEF0F4" : "transparent", border: "1px solid " + (pressed ? "#DCE0E8" : "transparent"), borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>
      <span style={{ display: "flex" }}>{who.map((w) => (w === "user" ? <UserAvatar key="u" size={22} /> : <BotAvatar key={w} bot={findBot(bots, w)} size={22} />))}</span>
      <strong style={{ color: "#1F4FD1" }}>{replies.length === 1 ? "1 respuesta" : replies.length + " respuestas"}</strong>
      {last?.at ? <span style={{ color: "#555A68" }}>{"última a las " + time(last.at)}</span> : null}
    </button>
  );
}

export function DaySeparator({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "4px 0 12px", fontSize: "12px", fontWeight: "600", color: "#555A68" }}>
      <span style={{ flex: "1", height: "1px", background: "#E6E8EE" }} />
      <span style={{ padding: "4px 12px", border: "1px solid #E6E8EE", borderRadius: "12px" }}>{label}</span>
      <span style={{ flex: "1", height: "1px", background: "#E6E8EE" }} />
    </div>
  );
}

/** Reintentar / Descartar for a message of yours that did not reach the room. */
function useResend(message) {
  const path = "/missions/" + message.missionId;
  return {
    retry: async () => {
      unshowSent(path, message.id);
      const temp = showSent(path, message.text);
      try {
        await post(path + "/messages", { text: message.text });
      } catch (error) {
        failSent(path, temp, error.message);
      }
    },
    discard: () => unshowSent(path, message.id),
  };
}

/** «No se envió · Reintentar · Descartar» under a message that did not reach the room. */
export function FailedLine({ error, onRetry, onDiscard }) {
  return (
    <span role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", fontSize: "13px", color: "#B4372A" }}>
      <CircleAlert size={14} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none" }} />
      <strong>{"No se envió"}</strong>
      <span style={{ color: "#4A4F5C" }}>{error}</span>
      <button type="button" className="rm-focus" onClick={onRetry} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "26px", padding: "0 8px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "7px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
        <RotateCcw size={12} strokeWidth={2.4} aria-hidden="true" />Reintentar
      </button>
      <button type="button" className="rm-focus" onClick={onDiscard} style={{ height: "26px", padding: "0 8px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "7px", cursor: "pointer", fontSize: "12px", fontWeight: "600", color: "#12131A" }}>Descartar</button>
    </span>
  );
}

export function UserMessage({ message, padding = null, replies = null, bots = [], onReply = null, repliesOpen = false, continued = false, entering = false }) {
  const [reactions, react] = useReactions(message);
  const resend = useResend(message);
  return (
    <MessageRow mine messageId={message.optimistic ? null : message.id} sending={!!message.optimistic} entering={entering} avatar={<UserAvatar size={40} />} continued={continued} at={message.at} padding={padding} actions={<><ReactTools list={reactions} toggle={react} /><ReplyButton onClick={onReply} /><ForkButton message={message} /></>}>
      {continued ? null : <Head name="Tú" at={message.at} />}
      <UserText text={message.text} />
      {message.failed ? <FailedLine error={message.failed} onRetry={resend.retry} onDiscard={resend.discard} /> : null}
      {(message.attachments || []).map((f, i) => <FileChip key={i} file={f} />)}
      <ReactionRow list={reactions} toggle={react} bots={bots} id={message.id} />
      <RepliesLink replies={replies} bots={bots} onOpen={onReply} pressed={repliesOpen} />
    </MessageRow>
  );
}

/** Short title of an assignment (new plans carry one; older ones use the first sentence). */
function planTitle(a) {
  if (a.title) return plain(a.title);
  const first = plain(a.task).split(/(?<=[.:;])\s/)[0];
  return first.length > 90 ? first.slice(0, 88).replace(/\s+\S*$/, "") + "…" : first;
}

/** Groups the assignments in phases following `after` (who needs whose result). */
function planPhases(assignments) {
  const level = new Map();
  const phases = [];
  assignments.forEach((a, i) => {
    const deps = (a.after || []).filter((b) => level.has(b));
    const l = deps.length ? Math.max(...deps.map((b) => level.get(b))) + 1 : 0;
    level.set(a.botId, l);
    (phases[l] ||= []).push({ ...a, index: i, deps });
  });
  return phases.filter(Boolean);
}

const names = (list) => (list.length > 1 ? list.slice(0, -1).join(", ") + " y " + list.at(-1) : list[0] || "");

function PlanPhases({ assignments, bots, pending }) {
  const [open, setOpen] = useState({});
  const phases = planPhases(assignments);
  return (
    <div style={{ maxWidth: "640px", background: "#FFFFFF", border: "0", borderRadius: "24px", boxShadow: pending ? "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)" : "0 1px 2px rgba(18,19,26,.05), 0 16px 40px -22px rgba(18,19,26,.16)", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "12px 16px", background: "#F7F8FA", borderBottom: "1px solid #E6E8EE" }}>
        <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{`Plan del equipo · ${assignments.length} ${assignments.length === 1 ? "tarea" : "tareas"}`}</span>
        <span style={{ fontSize: "12px", color: "#555A68" }}>{phases.length > 1 ? `${phases.length} fases, en orden` : "Todos a la vez"}</span>
      </div>
      <ol style={{ margin: "0", padding: "6px 16px 10px", listStyle: "none", display: "flex", flexDirection: "column" }}>
        {phases.map((phase, p) => {
          const waitFor = [...new Set(phase.flatMap((a) => a.deps))].map((b) => findBot(bots, b).name);
          return (
            <li key={p} style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "10px 0", borderTop: p ? "1px solid #E6E8EE" : "0" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", fontWeight: "600", color: "#4A4F5C" }}>
                <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", font: "600 11px/1 'Geist Mono', monospace" }}>{p + 1}</span>
                {waitFor.length ? `Cuando ${waitFor.length > 1 ? "terminen" : "termine"} ${names(waitFor)}` : "Empieza ya"}
              </span>
              {phase.map((a) => {
                const bot = findBot(bots, a.botId);
                const title = planTitle(a);
                const detail = String(a.task || "").trim();
                const showDetail = detail && plain(detail) !== title;
                const isOpen = !!open[a.index];
                return (
                  <div key={a.index} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "10px", padding: "8px 0 4px 32px" }}>
                    <BotAvatar bot={bot} size={28} />
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
                      <span style={{ fontSize: "15px", lineHeight: "1.4" }}><strong>{bot.name}</strong><span style={{ color: "#555A68" }}>{" · "}</span><span style={{ fontWeight: "600" }}>{title}</span></span>
                      {a.deliverable ? (
                        <span style={{ display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>
                          <FileText size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />
                          <span><strong style={{ fontWeight: "600", color: "#2B2D36" }}>{"Entrega: "}</strong>{plain(a.deliverable)}</span>
                        </span>
                      ) : null}
                      {a.avoid ? (
                        <span style={{ display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>
                          <Ban size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />
                          <span><strong style={{ fontWeight: "600", color: "#2B2D36" }}>{"No hace: "}</strong>{plain(a.avoid)}</span>
                        </span>
                      ) : null}
                      {showDetail ? (
                        <>
                          <button type="button" className="rm-focus" aria-expanded={isOpen ? "true" : "false"} onClick={() => setOpen({ ...open, [a.index]: !isOpen })} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "4px", padding: "2px 0", background: "transparent", border: "0", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>
                            {isOpen ? "Ocultar detalle" : "Ver detalle"}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ transform: isOpen ? "rotate(180deg)" : "none" }}><path d="m6 9 6 6 6-6" /></svg>
                          </button>
                          {isOpen ? <Markdown text={detail} size={14} style={{ padding: "10px 12px", background: "#F7F8FA", borderRadius: "10px", color: "#2B2D36" }} /> : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PlanBlock({ mission, message, bots }) {
  const { act, busy, error } = useAction();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  const plan = message.plan || {};
  const assignments = plan.assignments || [];
  const pendingPlan = !plan.approved && mission?.status === "awaiting_plan";
  // A plan that started on its own (the default): while the team works you can stop it
  // or change it; what you write reaches the bots at their next step.
  const live = plan.approved && plan.auto && mission && !["completed", "cancelled", "failed"].includes(mission.status);
  const paused = mission?.status === "paused";
  const decide = (decision) =>
    act(async () => {
      await post(`/missions/${mission.id}/plan`, decision === "changes" ? { decision, note: note.trim() } : { decision });
      setChanging(false);
      setNote("");
    });
  const steer = () =>
    act(async () => {
      await post(`/missions/${mission.id}/messages`, { text: note.trim(), mode: "steer" });
      setChanging(false);
      setNote("");
    });
  const control = (action) => act(() => post(`/missions/${mission.id}/control`, { action }));
  const pill = { minHeight: "36px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 14px", background: "rgba(18,19,26,.06)", color: "#12131A", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "13px" };
  const changeForm = (onSend, placeholder) => (
    <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) onSend(); }} style={{ maxWidth: "560px" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 12px", background: "#FFFFFF", border: "1.5px solid #A9AEBB", borderRadius: "12px" }}>
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Qué cambiarías del plan"}</span>
        <input type="text" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} style={{ flex: "1", minWidth: "0", height: "40px", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
        <button type="submit" aria-label="Enviar cambios" disabled={busy || !note.trim()} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer" }}>
          <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </label>
    </form>
  );
  return (
    <>
      {assignments.length ? <PlanPhases assignments={assignments} bots={bots} pending={pendingPlan} /> : null}
      {live ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "36px", padding: "0 4px 0 2px", fontSize: "13px", color: "#4A4F5C" }}>
              <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: paused ? "#A9AEBB" : "#0B8A5F", animation: paused ? "none" : "breathe 1.4s ease-in-out infinite" }} />
              {paused ? "En pausa" : "En marcha · puedes pararlo o cambiarlo"}
            </span>
            <button type="button" className="rm-focus" disabled={busy} onClick={() => control(paused ? "resume" : "pause")} style={pill}>
              {paused ? <Play size={14} strokeWidth={2.4} aria-hidden="true" /> : <Pause size={14} strokeWidth={2.4} aria-hidden="true" />}
              {paused ? "Seguir" : "Parar"}
            </button>
            <button type="button" className="rm-focus" aria-expanded={changing ? "true" : "false"} disabled={busy} onClick={() => setChanging(!changing)} style={pill}>
              <PenLine size={14} strokeWidth={2.4} aria-hidden="true" />
              {"Cambiar"}
            </button>
          </div>
          {changing ? changeForm(steer, "¿Qué cambias? Lo leen en su siguiente paso") : null}
          <ErrorLine>{error}</ErrorLine>
        </div>
      ) : plan.approved && plan.auto ? null : plan.approved ? (
        <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px", background: "#E1F4EC", border: "1px solid #9ED4BC", borderRadius: "15px", fontSize: "13px", fontWeight: "600", color: "#0B5A3E" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
          {"Aprobado por ti"}
        </span>
      ) : pendingPlan ? (
        <div id="plan" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved")} style={{ minHeight: "46px", padding: "0 22px", background: "#FFC93C", color: "#12131A", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "15px" }}>{"Aprobar plan"}</button>
            <button type="button" className="rm-focus" aria-expanded={changing ? "true" : "false"} disabled={busy} onClick={() => setChanging(!changing)} style={{ minHeight: "46px", padding: "0 20px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>{"Pedir cambios"}</button>
          </div>
          {changing ? changeForm(() => decide("changes"), "¿Qué cambiarías del reparto?") : null}
          <ErrorLine>{error}</ErrorLine>
        </div>
      ) : null}
    </>
  );
}

/** «12 respuestas entre bots · Última hace 10 min» + summary. Opens the thread panel. */
export function ThreadSummary({ thread, summary, bots, pressed, onClick }) {
  if (!thread.length) return null;
  const last = thread[thread.length - 1];
  const people = [];
  for (let i = thread.length - 1; i >= 0 && people.length < 3; i--) {
    const from = thread[i].from;
    if (from && from !== "user" && !people.includes(from)) people.push(from);
  }
  const lastAgo = ago(last.at);
  return (
    <button type="button" className="rm-focus" onClick={onClick} aria-pressed={pressed ? "true" : "false"} style={{ alignSelf: "stretch", maxWidth: "560px", display: "flex", flexDirection: "column", gap: "6px", padding: "10px 12px", background: pressed ? "#E7EEFF" : "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ display: "flex" }}>
          {people.map((id, i) => <BotAvatar key={id} bot={findBot(bots, id)} size={22} ring={i > 0} style={i > 0 ? { marginLeft: "-4px", font: "800 10px/1 'Bricolage Grotesque', sans-serif" } : { font: "800 10px/1 'Bricolage Grotesque', sans-serif" }} />)}
        </span>
        <strong style={{ fontSize: "14px", color: "#1F4FD1" }}>{`${thread.length} ${thread.length === 1 ? "respuesta" : "respuestas"} entre bots`}</strong>
        {lastAgo ? <span style={{ fontSize: "13px", color: "#555A68" }}>{lastAgo === "ahora" ? "Última ahora mismo" : `Última ${lastAgo}`}</span> : null}
      </span>
      <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#2B2D36" }}>{plain(summary || last.text)}</span>
    </button>
  );
}

function BotMessage({ mission, message, bots, approvals, artifacts, steps = [], onOpenArtifact, openArtifactId, threadSlot, questionAnchor, padding = null, extraArtifacts = [], replies = null, onReply = null, repliesOpen = false, continued = false, entering = false }) {
  const bot = findBot(bots, message.botId || "atlas");
  const kind = message.kind || "message";
  const approval = message.approvalId ? approvals.find((a) => a.id === message.approvalId) : null;
  const artifact = message.artifactId ? artifacts.find((a) => a.id === message.artifactId) || { id: message.artifactId, title: "Entregable" } : null;
  const isQuestion = kind === "question";
  // One card per tool the bot used for this answer (steps[].tools), behind the activity pill.
  const step = kind === "message" && message.stepId ? steps.find((s) => s.id === message.stepId) : null;
  const [reactions, react] = useReactions(message);
  // Atlas's face: «duda» while his question or plan waits for you, «feliz» on the final delivery.
  const mood = (isQuestion && approval?.status === "pending") || (kind === "plan" && mission?.status === "awaiting_plan") ? "duda" : message.phase === "synthesis" ? "feliz" : null;
  return (
    <MessageRow id={isQuestion && questionAnchor ? "pregunta" : undefined} messageId={message.id} entering={entering} avatar={<BotAvatar bot={bot} size={40} mood={mood} />} continued={continued} at={message.at} padding={padding} actions={isQuestion ? null : <><ReactTools list={reactions} toggle={react} />{kind !== "plan" && message.text ? <><ReplyButton onClick={onReply} /><ListenButton text={message.text} bot={bot} compact style={{ width: "30px", height: "30px", color: "#4A4F5C" }} /><ForkButton message={message} /></> : null}</>}>
      {continued ? null : <Head name={bot.name} at={message.at} to={toLabel(message.to, bots)} />}
        {step?.tools?.length && (!message.part || message.summary) ? <ActivityLog bot={findBot(bots, message.botId)} summary={message.summary} activity={step.activity || []} tools={step.tools} bots={bots} onOpenArtifact={onOpenArtifact} /> : null}
        {isQuestion ? (
          <QuestionCard approval={approval} text={message.text} bots={bots} variant="room" />
        ) : message.text ? (
          <Markdown text={message.text} size={16} />
        ) : null}
        {step?.tools?.length && message.text ? <Sources text={message.text} tools={step.tools} /> : null}
        {kind === "plan" ? <PlanBlock mission={mission} message={message} bots={bots} /> : null}
        {artifact ? <DeliverableCard artifact={artifact} variant="room" pressed={openArtifactId === artifact.id} onOpen={() => onOpenArtifact(artifact.id)} /> : null}
        {extraArtifacts.filter(Boolean).map((aid) => {
          const extra = artifacts.find((a) => a.id === aid) || { id: aid, title: "Entregable" };
          return <DeliverableCard key={aid} artifact={extra} variant="room" pressed={openArtifactId === aid} onOpen={() => onOpenArtifact(aid)} />;
        })}
        <ReactionRow list={reactions} toggle={react} bots={bots} id={message.id} />
        <RepliesLink replies={replies} bots={bots} onOpen={onReply} pressed={repliesOpen} />
        {threadSlot}
    </MessageRow>
  );
}

/**
 * One live card per bot at work (OpenClaw progress drafts): its steps so far — ✓ done,
 * ! failed, spinning the one in progress — in the place where its answer will appear.
 * When the step ends, the answer replaces it.
 */
const LIVE_SHOWN = 5;
/** Steps worth showing: tool calls and searches, each once, with what they touched. */
export function realActions(activity = []) {
  return (activity || []).filter((e) => e && (e.tool || e.callId) && !PLUMBING.has(e.tool) && (e.detail || e.label || (e.text && e.text !== e.verb)));
}
const cap = (t) => { const x = String(t || ""); return x ? x[0].toUpperCase() + x.slice(1) : x; };
function LiveTurnCard({ step, bot }) {
  // Only what the bot really did (a page read, a document saved…), never its passing states
  // («pensando», «escribiendo»): the typing line under the room already says those.
  const { live } = useStore();
  const text = live?.[step.id]?.text || "";
  const log = realActions(step.activity);
  // Long work: the bot's own line («Ya tengo dos tarifas…») or, after 30 s, a hive phrase.
  const phrase = usePhrase(step.startedAt, !step.narration?.text && log.length > 0, step.id);
  // What it said while working is already in the room as its messages: no repeat here.
  const note = step.progress?.length ? null : step.narration?.text || phrase;
  if (!log.length && !text.trim()) return null;
  if (!log.length) {
    // Only writing: its words as they come, where the answer will stay.
    return (
      <MessageRow avatar={<BotAvatar bot={bot} size={40} mood="pensando" />} at={null}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", lineHeight: "1.25", marginBottom: "-4px" }}>
          <strong style={{ fontSize: "15px" }}>{bot.name}</strong>
          <span style={TAG}>{"BOT"}</span>
          <span style={{ fontSize: "12px", color: "#555A68" }}>{"escribiendo…"}</span>
        </div>
        <div aria-live="polite"><LiveMarkdown text={text} size={15} caret /></div>
      </MessageRow>
    );
  }
  const shown = log.slice(-LIVE_SHOWN);
  const fresh = freshness("live:" + step.id, shown.flatMap((e, i) => [(e.callId || i) + "", (e.callId || i) + ":" + e.status]));
  const earlier = log.length - shown.length;
  const row = { display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", lineHeight: "1.45", color: "#2B2D36" };
  const spin = <WorkingDots style={{ flex: "none", marginTop: "4px", color: "#12131A" }} />;
  return (
    <MessageRow avatar={<BotAvatar bot={bot} size={40} mood="pensando" />} at={null}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", lineHeight: "1.25", marginBottom: "-4px" }}>
        <strong style={{ fontSize: "15px" }}>{bot.name}</strong>
        <span style={TAG}>{"BOT"}</span>
        <span style={{ fontSize: "12px", color: "#555A68" }}>{"trabajando…"}</span>
      </div>
      <div role="status" aria-live="polite" aria-label={bot.name + " está trabajando"} style={{ alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: "4px", padding: "10px 12px", background: "#F7F8FA", border: "1px solid #E6E8EE", borderRadius: "12px", minWidth: "min(360px, 100%)", maxWidth: "100%" }}>
        {step.kind === "work" && step.title ? <span style={{ fontSize: "13px", fontWeight: "600", color: "#12131A" }}>{plain(step.title).replace(new RegExp("^" + bot.name + ": "), "")}</span> : null}
        {earlier > 0 ? <span style={{ fontSize: "12px", color: "#555A68" }}>{earlier === 1 ? "1 paso antes" : earlier + " pasos antes"}</span> : null}
        {note ? <span key={note} className="c-phrase" style={{ fontSize: "13px", lineHeight: "1.45", color: step.narration?.text ? "#12131A" : "#6B7080", fontStyle: step.narration?.text ? "normal" : "italic" }}>{note}</span> : null}
        {shown.map((e, i) => (
          <span key={e.callId || i} className={fresh((e.callId || i) + "") ? "c-enter" : undefined} style={row}>
            {e.status === "running" ? spin : (
              <span key={e.status} className={fresh((e.callId || i) + ":" + e.status) ? "c-pop" : undefined} style={{ display: "inline-flex", flex: "none", marginTop: "2px" }}>
                {e.status === "error"
                  ? <CircleAlert size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: "#B4372A" }} />
                  : <Check size={14} strokeWidth={2.6} aria-hidden="true" style={{ color: "#0B8A5F" }} />}
              </span>
            )}
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{cap(e.label || e.text || e.verb)}</span>
          </span>
        ))}
      </div>
      {text.trim() ? <div aria-live="polite"><LiveMarkdown text={text} size={15} caret /></div> : null}
    </MessageRow>
  );
}

const WHY_LABEL = { mensaje: "Dijiste", correccion: "Corregiste en otra tarea", rechazo: "Paraste una acción", hilo: "En el hilo", plan: "En el plan", recibo: "Al trabajar" };

/** «Aprendido: …» — a bot changed its memory or a skill on its own; «Por qué» shows what justifies it, «Deshacer» puts it back. */
function LearnedLine({ message, bot, entering = false }) {
  const { act, busy, error } = useAction();
  const [undone, setUndone] = useState(null);
  const [why, setWhy] = useState(false);
  const done = undone || message.learned?.undone;
  const Icon = message.learned?.type === "skill" ? Wrench : Brain;
  const text = undone?.text || message.text;
  const reasons = message.learned?.why || [];
  const link = { display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 4px", height: "24px", background: "transparent", border: "0", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" };
  return (
    <div className={entering ? "c-enter c-flash" : undefined}>
    <p style={{ margin: "0", padding: "6px 0 6px 52px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#555A68" }} />
      {bot ? <strong style={{ color: "#12131A" }}>{bot.name}</strong> : null}
      <span style={done ? { textDecoration: "line-through", color: "#555A68" } : null}>{text.replace(/^Deshecho: /, "")}</span>
      {message.at ? <span style={{ color: "#555A68" }}>{"· " + time(message.at)}</span> : null}
      {reasons.length ? (
        <button type="button" className="rm-focus" aria-expanded={why} onClick={() => setWhy((x) => !x)} style={{ ...link, color: "#4A4F5C" }}>
          <ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" style={{ transition: "transform .2s ease", transform: why ? "rotate(180deg)" : "none" }} />Por qué
        </button>
      ) : null}
      {done ? <span style={{ color: "#555A68" }}>· deshecho</span> : (
        <button type="button" className="rm-focus" disabled={busy} onClick={() => act(async () => setUndone(await post("/messages/" + message.id + "/undo")))}
          style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 4px", height: "24px", background: "transparent", border: "0", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>
          <Undo2 size={13} strokeWidth={2.4} aria-hidden="true" />Deshacer
        </button>
      )}
      {error ? <span style={{ color: "#B4372A" }}>{error}</span> : null}
    </p>
    {why ? (
      <ul style={{ margin: "0 0 6px 52px", padding: "10px 14px", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", borderRadius: "12px", background: "rgba(18,19,26,.04)", fontSize: "13px", lineHeight: "1.5", color: "#3D404A", animation: "rise .25s ease-out" }}>
        {reasons.map((w, i) => (
          <li key={i}><span style={{ color: "#6B6F7A" }}>{(WHY_LABEL[w.type] || "Visto") + ": "}</span>{"«" + w.quote + "»"}</li>
        ))}
      </ul>
    ) : null}
    </div>
  );
}

/** «Colmena ha frenado a…» — two bots (or a room automation) were answering each other without end. */
function GuardLine({ message, entering = false }) {
  const Icon = message.kind === "fork" ? GitBranch : CirclePause;
  return (
    <p role="status" className={entering ? "c-enter" : undefined} style={{ margin: "0", padding: "6px 0 6px 52px", display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", marginTop: "2px", color: "#555A68" }} />
      <span>{message.text}{message.at ? <span style={{ color: "#555A68" }}>{" · " + time(message.at)}</span> : null}</span>
    </p>
  );
}

/** The room conversation: day separators, Tú / bot messages, plan, questions and deliverables. */
/** One line per run of actions; «Ver las N» unfolds them. The bot's name is not repeated. */
function ActivityLine({ run, bot }) {
  const [open, setOpen] = useState(false);
  const text = (m) => {
    const t = plain(m.text || "");
    return bot && t.startsWith(bot.name + " ") ? t.slice(bot.name.length + 1) : t;
  };
  const last = run[run.length - 1];
  const line = { margin: "0", padding: "4px 0 4px 52px", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" };
  if (run.length === 1) {
    return (
      <p style={{ ...line, padding: "6px 0 6px 52px" }}>
        {bot ? <strong style={{ color: "#12131A" }}>{bot.name + " "}</strong> : null}
        {text(last)}
        {last.at ? <span style={{ color: "#555A68" }}>{" · " + time(last.at)}</span> : null}
      </p>
    );
  }
  return (
    <div style={{ padding: "4px 0" }}>
      <p style={line}>
        {bot ? <strong style={{ color: "#12131A" }}>{bot.name + " "}</strong> : null}
        {`hizo ${run.length} acciones · la última: ${text(last)}`}
        {last.at ? <span style={{ color: "#555A68" }}>{" · " + time(last.at)}</span> : null}
        {" "}
        <button type="button" className="rm-focus" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)} style={{ padding: "0", background: "transparent", border: "0", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{open ? "Ocultar" : `Ver las ${run.length}`}</button>
      </p>
      {open ? (
        <ol style={{ margin: "4px 0 0", padding: "0 0 0 70px", display: "flex", flexDirection: "column", gap: "2px", fontSize: "13px", color: "#4A4F5C" }}>
          {run.map((m, k) => <li key={m.id || k}>{text(m)}{m.at ? <span style={{ color: "#555A68" }}>{" · " + time(m.at)}</span> : null}</li>)}
        </ol>
      ) : null}
    </div>
  );
}

export function RoomMessages({ mission, messages, thread, bots, approvals, artifacts, steps = [], onOpenArtifact, openArtifactId, threadOpen, onToggleThread, skip, padding, days = true, showThread = true, onOpenReplies = null, openRepliesId = null }) {
  const repliesOf = new Map();
  for (const m of messages) if (m.replyTo) repliesOf.set(m.replyTo, [...(repliesOf.get(m.replyTo) || []), m]);
  const visible = messages.filter((m) => !m.replyTo && !(skip && skip(m)));
  const fresh = freshness("room:" + (mission?.id || ""), visible.map((m) => m.id));
  // A message whose words were already on screen (live text, a part said) does not rise in.
  const isNew = (id) => fresh(id) && !wasLive(visible.find((m) => m.id === id)?.stepId);
  const { live } = useStore();
  markLive(Object.keys(live || {}));
  // Interactive answers know what you replied after them (to show «Respondiste: …»).
  const interactive = useContext(InteractiveContext);
  const repliedAfter = (i) => visible.slice(i + 1).filter((x) => x.role === "user").map((x) => String(x.text || ""));
  // Slack grouping: the same author again within 5 minutes → no avatar or name again.
  const author = (m) => (m.role === "user" ? "user" : m.role === "assistant" ? "bot:" + (m.botId || "atlas") : null);
  // What a bot says while working groups with its answer, as consecutive messages do.
  const plainKind = (m) => ["message", "progress"].includes(m.kind || "message");
  const continuedAt = (i) => {
    const m = visible[i], prev = visible[i - 1];
    if (!prev || !author(m) || author(prev) !== author(m) || !plainKind(prev) || !plainKind(m) || !m.at || !prev.at) return false;
    if (repliesOf.get(prev.id)?.length) return false;
    return Date.parse(m.at) - Date.parse(prev.at) < 5 * 60e3 && new Date(m.at).toDateString() === new Date(prev.at).toDateString();
  };
  const threadProps = (m) => (onOpenReplies && m.id ? { replies: repliesOf.get(m.id) || null, onReply: () => onOpenReplies(m.id), repliesOpen: openRepliesId === m.id } : {});
  const planIndex = (() => {
    for (let i = visible.length - 1; i >= 0; i--) if (visible[i].kind === "plan") return i;
    return -1;
  })();
  const firstPendingQuestion = visible.find((m) => m.kind === "question" && approvals.find((a) => a.id === m.approvalId)?.status === "pending");
  const threadButton = <ThreadSummary thread={thread} summary={mission?.threadSummary} bots={bots} pressed={threadOpen} onClick={onToggleThread} />;
  // «Deshacer cambios» after the last message of each turn that changed files.
  const undoAt = new Map(); // index → { cp, later }
  const points = Array.isArray(mission?.checkpoints) ? mission.checkpoints : [];
  if (points.length) {
    const byStep = new Map(points.map((cp, i) => [cp.stepId, { cp, later: points.length - i - 1 }]));
    for (let i = visible.length - 1; i >= 0; i--) {
      const found = visible[i].role === "assistant" && visible[i].stepId ? byStep.get(visible[i].stepId) : null;
      if (!found) continue;
      byStep.delete(visible[i].stepId);
      undoAt.set(i, found);
    }
  }
  const undoChip = (i, m) => {
    const u = undoAt.get(i);
    return u ? (
      <div key={"undo-" + u.cp.id} style={{ padding: "2px 0 8px 52px", display: "flex", flexDirection: "column" }}>
        <UndoChanges cp={u.cp} missionId={mission.id} bot={findBot(bots, m.botId || u.cp.botId)} working={["running", "planning", "queued"].includes(mission?.status)} later={u.later} />
      </div>
    ) : null;
  };
  const out = [];
  let lastDay = null;
  visible.forEach((m, i) => {
    const day = m.at ? new Date(m.at).toDateString() : lastDay;
    if (days && day && day !== lastDay) {
      out.push(<DaySeparator key={`d-${day}-${i}`} label={dayLabel(m.at)} />);
      lastDay = day;
    }
    if (m.role === "user") out.push(<UserMessage key={m.id || i} message={m} padding={padding} bots={bots} continued={continuedAt(i)} entering={isNew(m.id) && !m.settled} {...threadProps(m)} />);
    else if (m.kind === "guard" || m.kind === "fork") out.push(<GuardLine key={m.id || i} message={m} entering={isNew(m.id)} />);
    else if (m.kind === "secret") out.push(<SecretLine key={m.id || i} message={m} approval={approvals.find((a) => a.id === m.approvalId)} bots={bots} />);
    else if (m.kind === "learned") out.push(<LearnedLine key={m.id || i} message={m} bot={m.botId ? findBot(bots, m.botId) : null} entering={isNew(m.id)} />);
    else if (m.role === "system" || m.kind === "activity") {
      // Consecutive actions of the same bot (browser clicks, reads…) fold into one line.
      const prevItem = visible[i - 1];
      const isActivity = (x) => x && !["learned", "guard", "fork"].includes(x.kind) && (x.role === "system" || x.kind === "activity");
      if (isActivity(prevItem) && prevItem.botId && prevItem.botId === m.botId) return;
      const run = [m];
      for (let j = i + 1; j < visible.length && isActivity(visible[j]) && m.botId && visible[j].botId === m.botId; j++) run.push(visible[j]);
      out.push(<ActivityLine key={m.id || i} run={run} bot={m.botId ? findBot(bots, m.botId) : null} />);
    } else {
      // A deliverable right after the same bot's answer belongs to that answer.
      const prev = visible[i - 1];
      if (m.kind === "deliverable" && prev && prev.role === "assistant" && prev.botId === m.botId && !["question", "plan"].includes(prev.kind)) {
        // Shown with the answer before it: the turn's «Deshacer cambios» goes right after that.
        if (undoAt.has(i)) out.push(undoChip(i, m));
        return;
      }
      const extraArtifacts = [];
      for (let j = i + 1; j < visible.length && visible[j].kind === "deliverable" && visible[j].botId === m.botId; j++) extraArtifacts.push(visible[j].artifactId);
      out.push(
        <InteractiveContext.Provider key={m.id || i} value={{ ...interactive, after: repliedAfter(i), botName: findBot(bots, m.botId || "atlas").name, entering: isNew(m.id) }}>
        <BotMessage
          key={m.id || i}
          extraArtifacts={m.kind === "deliverable" ? extraArtifacts : ["question", "plan"].includes(m.kind) ? [] : extraArtifacts}
          mission={mission}
          message={m}
          bots={bots}
          approvals={approvals}
          artifacts={artifacts}
          steps={steps}
          onOpenArtifact={onOpenArtifact}
          openArtifactId={openArtifactId}
          questionAnchor={m === firstPendingQuestion}
          threadSlot={showThread && i === planIndex ? threadButton : null}
          padding={padding}
          continued={continuedAt(i)}
          entering={isNew(m.id)}
          {...(["message", "deliverable"].includes(m.kind || "message") ? threadProps(m) : {})}
        />
        </InteractiveContext.Provider>,
      );
      if (undoAt.has(i)) out.push(undoChip(i, m));
    }
  });
  if (showThread && planIndex === -1 && thread.length) {
    out.push(<div key="thread" style={{ padding: "6px 0 6px 52px", display: "flex" }}>{threadButton}</div>);
  }
  // The bots at work, each in the place its answer will take.
  for (const s of steps.filter((x) => x.status === "running" && !x.stalled && !x.replyTo))
    out.push(<LiveTurnCard key={"live-" + s.id} step={s} bot={findBot(bots, s.botId || "atlas")} />);
  return out;
}

/** Adds pending questions that have no message in the room yet, so they always get their highlighted card. */
export function withOrphanQuestions(messages, pending) {
  const orphans = pending
    .filter((a) => a.kind === "question" && !messages.some((m) => m.approvalId === a.id))
    .map((a) => ({ id: `ap-${a.id}`, role: "assistant", botId: a.botId, kind: "question", approvalId: a.id, at: a.createdAt, text: a.summary || a.title }));
  return orphans.length ? [...messages, ...orphans] : messages;
}

/* ───────────── typing line + composer ───────────── */

/** «Mensajes nuevos ↓» over the composer while you read further up (OpenClaw new-messages pill). */
export function NewBelow({ show, onClick }) {
  if (!show) return null;
  return (
    <button type="button" className="rm-focus c-new-below" onClick={onClick}
      style={{ position: "absolute", left: "50%", top: "-46px", transform: "translateX(-50%)", zIndex: 4, display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "17px", boxShadow: "0 8px 20px -10px rgba(18,19,26,.6)", cursor: "pointer", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" }}>
      <ArrowDown size={15} strokeWidth={2.4} aria-hidden="true" />{"Mensajes nuevos"}
    </button>
  );
}

/**
 * «Sugerencias»: up to three replies the cheapest model proposes after a bot answers. A click
 * (or Tab in the empty box) fills the box; nothing is sent by itself.
 */
export function Suggestions({ list, onPick }) {
  if (!list?.length) return null;
  return (
    <div role="group" aria-label="Respuestas sugeridas" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", margin: "0 0 8px" }}>
      <Sparkles size={14} strokeWidth={2.2} aria-hidden="true" style={{ color: "#555A68" }} />
      {list.map((t, i) => (
        <button key={i} type="button" className="rm-focus" onClick={() => onPick(t)} title={i === 0 ? "Tab para usarla" : undefined}
          style={{ height: "30px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "15px", cursor: "pointer", fontSize: "13px", color: "#2B2D36", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** What a message written while the bots work does (server QUEUE_MODES), in plain words. */
const QUEUE_OPTIONS = [
  { id: "steer", label: "les reorienta", detail: "Lo leen en su siguiente paso y rehacen lo que haga falta." },
  { id: "followup", label: "espera a que acaben", detail: "Te responden al terminar, mensaje a mensaje." },
  { id: "collect", label: "se junta", detail: "Todo lo que escribas se responde junto al terminar." },
  { id: "interrupt", label: "les interrumpe", detail: "Paran lo que hacen y te atienden ya." },
];
const WORKING = ["running", "planning", "queued"];

/** «Si escribes ahora, tu mensaje les reorienta ▾» — only while they work; saved per room. */
export function QueueModeHint({ mission }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  if (!mission || !WORKING.includes(mission.status)) return null;
  const current = QUEUE_OPTIONS.find((o) => o.id === (local || mission.queueMode)) || QUEUE_OPTIONS[0];
  const pick = (id) => {
    setLocal(id);
    setOpen(false);
    patch("/missions/" + mission.id, { queueMode: id }).catch(() => setLocal(null));
  };
  return (
    <span ref={ref} style={{ position: "relative", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "#4A4F5C" }}>
      {"Si escribes ahora, tu mensaje"}
      <button type="button" className="rm-focus" aria-haspopup="menu" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)} title={current.detail}
        style={{ display: "inline-flex", alignItems: "center", gap: "2px", height: "26px", padding: "0 6px", background: open ? "#EEF0F4" : "transparent", border: "0", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#12131A" }}>
        {current.label}<ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open ? (
        <span role="menu" aria-label="Qué hace tu mensaje mientras trabajan" style={{ ...popoverStyle, bottom: "calc(100% + 6px)", right: "0", minWidth: "300px" }}>
          {QUEUE_OPTIONS.map((o) => (
            <button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === current.id ? "true" : "false"} className="rm-focus" onClick={() => pick(o.id)}
              style={{ ...popoverItem, alignItems: "flex-start", background: o.id === current.id ? "#EEF0F4" : "transparent" }}>
              <span style={{ width: "16px", flex: "none", paddingTop: "2px" }}>{o.id === current.id ? <Check size={15} strokeWidth={2.4} aria-hidden="true" /> : null}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "14px", color: "#12131A" }}>{o.label[0].toUpperCase() + o.label.slice(1)}</strong>
                <span style={{ fontSize: "13px", color: "#555A68", lineHeight: "1.4" }}>{o.detail}</span>
              </span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function typingInfo({ mission, activity, live, bots, steps = [] }) {
  const running = ["running", "planning"].includes(mission?.status);
  const first = activity[0] || (live[0] ? { botId: live[0].botId, verb: "escribiendo" } : null);
  if (first) {
    const bot = findBot(bots, first.botId);
    // The bot's own line, when the narrator wrote one («Ya tengo dos tarifas…»).
    const narration = steps.find((s) => s.status === "running" && s.botId === first.botId)?.narration?.text || null;
    return { bot, name: bot.name, verb: first.verb || "trabajando", detail: first.detail || "", narration, rest: ` está ${first.verb || "trabajando"}${first.detail ? " · " + first.detail : ""}`, count: new Set([...activity.map((a) => a.botId), ...live.map((l) => l.botId)]).size };
  }
  if (running && mission?.activityLine) {
    const bot = bots.find((b) => mission.activityLine.startsWith(b.name + " "));
    return bot ? { bot, name: bot.name, rest: mission.activityLine.slice(bot.name.length), count: 1 } : { name: "", rest: mission.activityLine, count: 1 };
  }
  return null;
}

/** Composer of the room. variant "sala" (textarea + adjuntar + @) or "live" (single line, En directo). */
/** What a message sent now does while they work (the send button says it). */
const SEND_LABEL = { steer: "Reconducir", followup: "En cola", collect: "En cola", interrupt: "Interrumpir" };

export function RoomComposer({ mission, bots, memberIds, variant = "sala", typing, workingCount, onSent = null, messages = [], below = false, onJump = null, secrets = [], approvals = [] }) {
  const [text, setText] = useState("");
  useWarmOnType(mission?.id, text);
  // «Nora está preparando el contexto» only when it lasts; her own line when she wrote one.
  const phase = useSlowPhase(typing?.verb || null);
  const typingLine = typing
    ? typing.narration ? "· " + typing.narration : typing.verb ? `está ${verbLabel(phase).toLowerCase()}${typing.detail ? " · " + typing.detail : ""}` : typing.rest
    : "";
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  // «+»: files, and what the bots should use for this message (PlusMenu).
  const [plusOpen, setPlusOpen] = useState(false);
  const mirror = useRef(null);
  const pills = findMentions(text, bots).length > 0;
  const [chosen, setChosen] = useState([]);
  const toggleChosen = (key) => setChosen((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const { act, busy, error } = useAction();
  const inputRef = useRef(null);
  const ordered = [...memberIds.map((id) => findBot(bots, id)), ...bots.filter((b) => b.enabled !== false && !memberIds.includes(b.id))];
  const mentions = useMentions({ value: text, setValue: setText, bots: ordered, inputRef });
  const room = mission?.room || "sala";

  const [launched, setLaunched] = useState(0);
  // What you were writing in this room comes back; ↑ brings back what you sent before.
  useDraft(variant === "sala" && mission?.id ? "room:" + mission.id : null, text, setText);
  const historyKey = useInputHistory(messages, text, setText);
  const working = WORKING.includes(mission?.status);
  const roomMode = mission?.queueMode || "steer";
  // Ctrl+Enter: this one message with the other mode (reorient ⇄ wait for them).
  const otherMode = roomMode === "steer" ? "followup" : "steer";
  const send = async (e, { other = false } = {}) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setLaunched((n) => n + 1);
    // Shown at once and the box is free again. If it fails it stays, marked «No se envió»
    // with Reintentar (with attachments, they go back to the box).
    const sent = files;
    const path = `/missions/${mission.id}`;
    const temp = showSent(path, body, sent);
    const extra = turnBody(chosen);
    setText("");
    setFiles([]);
    setChosen([]);
    onSent?.();
    await act(async () => {
      try {
        await post(path + "/messages", { text: body, ...(sent.length ? { attachments: sent } : {}), ...(other && working ? { mode: otherMode } : {}), ...extra });
      } catch (error) {
        if (!sent.length) return failSent(path, temp, error.message);
        unshowSent(path, temp);
        setText(body);
        setFiles(sent);
        throw error;
      }
    });
  };
  const stopAll = () => act(() => post(`/missions/${mission.id}/control`, { action: "pause" }));
  useEffect(() => {
    const onQuote = (e) => {
      if (e.detail?.missionId !== mission?.id) return;
      setText((t) => asQuote(e.detail.text) + t);
      requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    };
    window.addEventListener("colmena:quote", onQuote);
    return () => window.removeEventListener("colmena:quote", onQuote);
  }, [mission?.id]);
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
  const suggestions = !text.trim() && !WORKING.includes(mission?.status) ? mission?.suggestions || [] : [];
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
    // Esc in an empty box pauses the bots at work (nothing is lost; «Reanudar» goes on).
    if (e.key === "Escape" && working && !text.trim()) {
      e.preventDefault();
      stopAll();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (e.repeat) return; // holding Enter never sends twice
      send(e, { other: e.ctrlKey || e.metaKey });
    }
  };

  if (variant === "live") {
    return (
      <form onSubmit={send} style={{ position: "sticky", bottom: "0", padding: "4px clamp(16px, 3vw, 28px) 20px", background: "#FFFFFF" }}>
        <p style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#4A4F5C" }}>
          <Dots name="dots" />
          {`${workingCount} ${workingCount === 1 ? "bot trabajando" : "bots trabajando"}`}
          <QueueModeHint mission={mission} />
        </p>
        <div style={{ position: "relative", border: "2px solid #12131A", borderRadius: "18px", padding: "12px 12px 12px 16px", display: "flex", alignItems: "center", gap: "8px" }}>
          {mentions.menu}
          <label style={{ flex: "1", display: "flex" }}>
            <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Mensaje a la sala"}</span>
            <input ref={inputRef} type="text" placeholder={`Mensaje a #${room}`} {...mentions.inputProps} onKeyDown={onKeyDown} style={{ flex: "1", minWidth: "0", height: "40px", border: "0", outline: "none", background: "transparent", fontSize: "15px" }} />
          </label>
          <MicButton onText={appendDictation(setText)} />
          <button type="submit" aria-label="Enviar" title="Enviar (Enter)" disabled={busy} className="c-press" style={{ width: "48px", height: "44px", display: "grid", placeItems: "center", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "10px", cursor: "pointer" }}>
            <span key={launched} className={launched ? "c-launch" : undefined} style={{ display: "grid" }}><ArrowUp size={17} strokeWidth={2.4} aria-hidden="true" /></span>
          </button>
        </div>
        <ErrorLine style={{ marginTop: "8px" }}>{error}</ErrorLine>
      </form>
    );
  }

  return (
    <form onSubmit={send} {...drop.props} style={{ position: "sticky", bottom: "0", padding: "4px clamp(16px, 3vw, 28px) 20px", background: "transparent" }}>
      <NewBelow show={below} onClick={onJump} />
      {secrets.map((a) => <SecretPrompt key={a.id} approval={a} bots={bots} />)}
      <InlineApprovals approvals={approvals} bots={bots} />
      <Suggestions list={suggestions} onPick={pickSuggestion} />
      {typing || WORKING.includes(mission?.status) ? (
        <div style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#5C606C", minHeight: "26px" }}>
          {typing ? (
            <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              {/* V2Sala: a bot at work is its own small shape, breathing (dots are for people typing). */}
              {typing.bot ? <span aria-hidden="true" style={{ width: "9px", height: "9px", flex: "none", background: typing.bot.color || "#5C606C", clipPath: shapeOf(typing.bot).clip, borderRadius: shapeOf(typing.bot).radius, animation: "breathe 1.4s ease-in-out infinite" }} /> : <Dots />}
              {typing.name ? <span>{typing.name}</span> : null}
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{typingLine}</span>
            </span>
          ) : null}
          <QueueModeHint mission={mission} />
        </div>
      ) : null}
      <div style={{ position: "relative", background: "#FFFFFF", borderRadius: "28px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 50px -24px rgba(18,19,26,.35)", padding: "10px 10px 10px 20px", display: "flex", flexDirection: "column", gap: "6px" }}>{drop.dragging ? <div aria-hidden="true" style={{ ...dropOverlay, borderRadius: "28px" }}>Suelta aquí para adjuntar</div> : null}
        {plusOpen ? <PlusMenu open onClose={() => { setPlusOpen(false); requestAnimationFrame(() => inputRef.current?.focus()); }} onFiles={attach} onCapture={(file) => addFiles([file])} onError={setFileError} chosen={chosen} onToggle={toggleChosen} text={text} botId={memberIds?.length === 1 ? memberIds[0] : null} /> : mentions.menu}
        {chosen.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {chosenChips(chosen).map((ch) => (
              <span key={ch.key} className="c-pop" style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "30px", padding: "0 4px 0 12px", borderRadius: "999px", background: "rgba(18,19,26,.06)", fontSize: "13px", fontWeight: 600 }}>
                {ch.label}
                <button type="button" onClick={() => setChosen((list) => list.filter((k) => k !== ch.key))} aria-label={"Quitar " + ch.label} style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>
                  <X size={12} strokeWidth={2.6} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {files.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {files.map((f, i) => <span key={f.name + ":" + i} className="c-pop" style={{ display: "inline-flex", maxWidth: "100%" }}>{f.pasted ? <PastedCard file={f} onInline={() => inlinePasted(i)} onRemove={() => setFiles(files.filter((_, j) => j !== i))} /> : <FileChip file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />}</span>)}
          </div>
        ) : null}
        <label style={{ display: "flex", position: "relative", minWidth: 0 }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Mensaje a la sala"}</span>
          {/* «@Vera» as a pill while you write (MentionMirror behind the textarea). */}
          {pills ? <MentionMirror ref={mirror} value={text} bots={bots} style={{ padding: "8px 0 4px", fontSize: "16px", lineHeight: "1.5" }} /> : null}
          <textarea ref={inputRef} rows="1" placeholder={`Mensaje a #${room}`} {...mentions.inputProps} onKeyDown={onKeyDown}
            onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
            style={{ position: "relative", flex: "1", resize: "none", border: "0", outline: "none", fontSize: "16px", lineHeight: "1.5", padding: "8px 0 4px", background: "transparent", fieldSizing: "content", maxHeight: "200px", ...(pills ? { color: "transparent", caretColor: "#12131A" } : {}) }} />
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button type="button" className="rm-focus" data-plus-toggle="" aria-label="Añadir" aria-haspopup="menu" aria-expanded={plusOpen ? "true" : "false"} title="Añadir archivos, herramientas o apps" onClick={() => setPlusOpen((v) => !v)} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: plusOpen ? "#12131A" : "rgba(18,19,26,.05)", border: "0", borderRadius: "50%", cursor: "pointer", color: plusOpen ? "#FFFFFF" : "#3D404A", transition: "background .2s ease, color .2s ease" }}>
            <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <MicButton onText={appendDictation(setText)} size={40} style={{ borderRadius: "50%", background: "rgba(18,19,26,.05)", color: "#3D404A" }} />
          <button type="button" className="rm-focus" aria-label="Mencionar a un bot" title="Mencionar a un bot (@)" onClick={mentions.start} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "rgba(18,19,26,.05)", border: "0", borderRadius: "50%", cursor: "pointer", font: "600 17px/1 'Geist', sans-serif", color: "#3D404A" }}>{"@"}</button>
          <span style={{ flex: "1", textAlign: "right", fontSize: "12px", color: "#555A68", paddingRight: "4px" }}>
            {text.trim()
              ? working ? `Intro: ${SEND_LABEL[roomMode].toLowerCase()} · Ctrl+Intro: ${SEND_LABEL[otherMode].toLowerCase()}` : "Enter para enviar · Mayús+Enter, nueva línea"
              : working ? "Esc para pausarlos" : ""}
          </span>
          <button type="submit" aria-label={working ? SEND_LABEL[roomMode] : "Enviar"} title={working ? SEND_LABEL[roomMode] + " (Intro)" : "Enviar (Enter)"} disabled={busy} className="c-press" style={{ minWidth: "46px", height: "46px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: working ? "0 16px" : "0", background: text.trim() ? "#12131A" : "#C9CBD1", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "13px", transition: "background .2s ease" }}>
            <span key={launched} className={launched ? "c-launch" : undefined} style={{ display: "grid" }}><ArrowUp size={17} strokeWidth={2.4} aria-hidden="true" /></span>
            {working ? SEND_LABEL[roomMode] : null}
          </button>
        </div>
      </div>
      <ErrorLine style={{ marginTop: "8px" }}>{error || fileError}</ErrorLine>
    </form>
  );
}

/* ───────────── side panels ───────────── */

/** A side panel on its own (an <aside> with its edge) or as a tab of the SideDock («bare»). */
function PanelFrame({ bare, label, style, children }) {
  if (bare) return <div aria-label={label} style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", minHeight: "100%" }}>{children}</div>;
  return <aside aria-label={label} className="c-panel" style={style}>{children}</aside>;
}

function PanelHead({ title, sub, onClose, closeLabel }) {
  return (
    <div style={{ minHeight: "60px", padding: "8px 10px 8px 20px", borderBottom: "1px solid #E6E8EE", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
      {sub ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <strong style={{ font: "700 17px/1.1 'Bricolage Grotesque', sans-serif" }}>{title}</strong>
          <span style={{ fontSize: "12px", color: "#555A68" }}>{sub}</span>
        </div>
      ) : (
        <strong style={{ font: "700 17px/1.1 'Bricolage Grotesque', sans-serif" }}>{title}</strong>
      )}
      <button type="button" className="rm-focus" aria-label={closeLabel} onClick={onClose} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer" }}>
        <X size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}

/** «Hilo entre bots» panel + «Corrígeles o dales una pista…». */
/** A message's thread (Slack «Respuestas»): the message, its replies and a reply box. */
export function RepliesPanel({ mission, messages, steps = [], bots, parentId, onClose, bare = false }) {
  const resize = usePanelWidth("room");
  const { live } = useStore();
  const [text, setText] = useState("");
  const { act, busy, error } = useAction();
  const parent = messages.find((m) => m.id === parentId);
  const replies = messages.filter((m) => m.replyTo === parentId);
  const writing = steps.filter((s) => s.replyTo === parentId && !["completed", "failed"].includes(s.status));
  const streaming = writing.map((s) => ({ step: s, text: live?.[s.id]?.text || "" }));
  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    await act(async () => {
      await post(`/missions/${mission.id}/messages`, { text: body, replyTo: parentId });
      setText("");
    });
  };
  const row = (m) => {
    const user = m.role === "user";
    const bot = user ? null : findBot(bots, m.botId || "atlas");
    return (
      <div key={m.id} style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: "10px" }}>
        {user ? <UserAvatar size={30} /> : <BotAvatar bot={bot} size={30} />}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
          <span style={{ fontSize: "13px" }}><strong>{user ? "Tú" : bot.name}</strong>{" "}<span style={{ color: "#555A68" }}>{m.at ? time(m.at) : ""}</span></span>
          {user ? <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>{m.text}</p> : <Markdown text={m.text} size={14} mentions={bots.map((b) => b.name)} />}
        </div>
      </div>
    );
  };
  return (
    <PanelFrame bare={bare} label="Hilo de un mensaje" style={{ ...{ flex: "1 1 380px", minWidth: "0", background: "#F7F8FA", borderLeft: "1px solid #DCE0E8", display: "flex", flexDirection: "column" }, ...resize.style }}>
      {bare ? null : resize.handle}
      {bare ? null : <PanelHead title="Hilo" sub={`# ${mission?.room || "sala"}`} onClose={onClose} closeLabel="Cerrar el hilo" />}
      <div style={{ flex: "1", minHeight: "0", overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {parent ? row(parent) : <p style={{ margin: 0, fontSize: "14px", color: "#4A4F5C" }}>Este mensaje ya no está.</p>}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12px", color: "#555A68" }}>
          <span>{replies.length ? (replies.length === 1 ? "1 respuesta" : replies.length + " respuestas") : "Aún sin respuestas"}</span>
          <span style={{ flex: "1", height: "1px", background: "#DCE0E8" }} />
        </div>
        {replies.map(row)}
        {streaming.map(({ step, text: t }) => {
          const bot = findBot(bots, step.botId);
          return (
            <div key={step.id} style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: "10px" }}>
              <BotAvatar bot={bot} size={30} />
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "13px" }}><strong>{bot.name}</strong>{" "}<span style={{ color: "#555A68" }}>{step.status === "running" ? "escribiendo…" : "responderá aquí en cuanto pueda"}</span></span>
                {t ? <Markdown text={t} size={14} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} style={{ padding: "12px 16px 20px", borderTop: "1px solid #E6E8EE", display: "flex", flexDirection: "column", gap: "8px", background: "#F7F8FA" }}>
        <label style={{ display: "flex", alignItems: "flex-end", gap: "8px", padding: "6px 6px 6px 12px", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "14px" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Responder en el hilo"}</span>
          <textarea rows="2" value={text} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e); }} placeholder="Responder en el hilo…" style={{ flex: "1", minWidth: "0", resize: "none", border: "0", outline: "none", fontSize: "14px", lineHeight: "1.5", background: "transparent", padding: "4px 0" }} />
          <button type="submit" aria-label="Responder" disabled={busy || !text.trim()} style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "10px", cursor: "pointer", opacity: busy || !text.trim() ? 0.55 : 1 }}>
            <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </label>
        {error ? <ErrorLine>{error}</ErrorLine> : <span style={{ fontSize: "12px", color: "#555A68" }}>{"La respuesta se queda en este hilo; no interrumpe la sala."}</span>}
      </form>
    </PanelFrame>
  );
}

export function ThreadPanel({ mission, thread, bots, onClose, bare = false }) {
  const resize = usePanelWidth("room");
  const [all, setAll] = useState(false);
  const [text, setText] = useState("");
  const { act, busy, error } = useAction();
  const shown = all ? thread : thread.slice(-5);
  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    await act(async () => {
      await post(`/missions/${mission.id}/thread`, { text: body });
      setText("");
    });
  };
  return (
    <PanelFrame bare={bare} label="Hilo entre bots" style={{ ...{ flex: "1 1 360px", minWidth: "0", background: "#F7F8FA", borderLeft: "1px solid #DCE0E8", display: "flex", flexDirection: "column" }, ...resize.style }}>
      {bare ? null : resize.handle}
      <div style={bare ? { display: "flex", flexDirection: "column", flex: "1 1 auto" } : { position: "sticky", top: "0", maxHeight: "100vh", overflowY: "auto", display: "flex", flexDirection: "column", flex: "0 1 auto" }}>
      {bare ? null : <PanelHead title="Hilo entre bots" sub={`# ${mission?.room || "sala"}`} onClose={onClose} closeLabel="Cerrar hilo" />}
      <div style={{ flex: "1", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12px", color: "#555A68" }}>
          <span>
            {thread.length === 0
              ? "Aún no han hablado entre ellos"
              : thread.length > 5 && !all
                ? `${thread.length} respuestas · se muestran las 5 últimas`
                : `${thread.length} ${thread.length === 1 ? "respuesta" : "respuestas"}`}
          </span>
          <span style={{ flex: "1", height: "1px", background: "#DCE0E8" }} />
          {thread.length > 5 ? (
            <button type="button" className="rm-focus" onClick={() => setAll(!all)} style={{ padding: "0", background: "transparent", border: "0", cursor: "pointer", fontSize: "12px", fontWeight: "600", color: "#1F4FD1" }}>{all ? "Ver las últimas" : "Ver todas"}</button>
          ) : null}
        </div>
        {shown.map((t, i) => {
          const user = t.from === "user";
          const bot = user ? null : findBot(bots, t.from);
          const to = t.to ? findBot(bots, t.to) : null;
          const body = to && !String(t.text || "").includes("@" + to.name) ? `@${to.name} ${t.text}` : t.text;
          return (
            <div key={t.id || i} style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: "10px" }}>
              {user ? <UserAvatar size={30} /> : <BotAvatar bot={bot} size={30} />}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
                <span style={{ fontSize: "13px" }}>
                  <strong>{user ? "Tú" : bot.name}</strong>
                  {" "}
                  <span style={{ color: "#555A68" }}>{time(t.at)}</span>
                </span>
                <Markdown text={body} size={14} mentions={bots.map((b) => b.name)} />
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} style={{ padding: "12px 16px 20px", borderTop: "1px solid #E6E8EE", display: "flex", flexDirection: "column", gap: "8px", position: "sticky", bottom: "0", background: "#F7F8FA" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 12px", background: "#FFFFFF", border: "1.5px solid #A9AEBB", borderRadius: "12px" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Responder en el hilo"}</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Corrígeles o dales una pista…" style={{ flex: "1", minWidth: "0", height: "40px", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
          <button type="submit" aria-label="Enviar al hilo" disabled={busy} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer" }}>
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </label>
        {error ? <ErrorLine>{error}</ErrorLine> : <span style={{ fontSize: "12px", color: "#555A68" }}>{"Los bots leen el hilo y ajustan su trabajo."}</span>}
      </form>
      </div>
    </PanelFrame>
  );
}

/** Progress panel: one row per step and its state (Sala mockup «Progreso»). */
export function ProgressPanel({ mission, steps, pending, activity, bots, onClose, bare = false }) {
  const resize = usePanelWidth("room");
  const work = steps.filter((s) => s.kind !== "plan");
  const waitingBots = new Set(pending.map((a) => a.botId));
  return (
    <PanelFrame bare={bare} label="Progreso de la sala" style={{ ...{ flex: "1 1 360px", minWidth: "0", background: "#F7F8FA", borderLeft: "1px solid #DCE0E8", display: "flex", flexDirection: "column" }, ...resize.style }}>
      {bare ? null : resize.handle}
      <div style={bare ? { display: "flex", flexDirection: "column", flex: "1 1 auto" } : { position: "sticky", top: "0", maxHeight: "100vh", overflowY: "auto", display: "flex", flexDirection: "column", flex: "0 1 auto" }}>
      {bare ? null : <PanelHead title="Progreso" onClose={onClose} closeLabel="Cerrar progreso" />}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {work.length === 0 ? (
          <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C" }}>{`${coordinatorName(bots)} aún no ha repartido el trabajo.`}</p>
        ) : null}
        {work.map((s) => {
          const bot = findBot(bots, s.botId);
          const avatar = <BotAvatar bot={bot} size={24} />;
          const title = <span style={{ flex: "1", minWidth: "0" }}>{s.title || bot.name}</span>;
          if (s.status === "waiting" || (waitingBots.has(s.botId) && !DONE_STEP.has(s.status))) {
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 12px", background: "#FFF4D1", border: "2px solid #12131A", borderRadius: "12px", fontSize: "14px" }}>
                {avatar}{title}<strong style={{ fontSize: "13px" }}>{"Te espera"}</strong>
              </div>
            );
          }
          if (DONE_STEP.has(s.status)) {
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "12px", fontSize: "14px" }}>
                {avatar}{title}
                <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}>
                  <Check size={14} strokeWidth={2.6} aria-hidden="true" />
                  {"Hecho"}
                </span>
              </div>
            );
          }
          if (BLOCKED_STEP.has(s.status)) {
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 12px", background: "#FBE7DF", border: "1.5px solid #B4372A", borderRadius: "12px", fontSize: "14px" }}>
                {avatar}{title}<strong style={{ fontSize: "13px", color: "#B4372A" }}>{"Bloqueado"}</strong>
              </div>
            );
          }
          if (ACTIVE_STEP.has(s.status)) {
            const now = activity.find((a) => a.botId === s.botId);
            const lastStepActivity = (s.activity || [])[s.activity?.length - 1];
            const detail = now?.detail || now?.verb || lastStepActivity?.text || "En marcha";
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "12px", fontSize: "14px" }}>
                {avatar}{title}<span style={{ fontSize: "13px", color: "#4A4F5C", textAlign: "right", maxWidth: "45%" }}>{detail}</span>
              </div>
            );
          }
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "0 12px", border: "1px dashed #A9AEBB", borderRadius: "12px", fontSize: "14px" }}>
              {avatar}{title}<span style={{ fontSize: "13px", color: "#4A4F5C" }}>{"Pendiente"}</span>
            </div>
          );
        })}
        <a href={`/misiones/${mission.id}`} style={{ marginTop: "8px", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{"Ver la línea de tiempo completa"}</a>
      </div>
      </div>
    </PanelFrame>
  );
}

/** «Ver 240 mensajes anteriores»: loads the rest of a long room and keeps your reading place. */
export function OlderMessages({ count, onShow }) {
  const [busy, setBusy] = useState(false);
  if (!count) return null;
  const show = async () => {
    if (busy) return;
    setBusy(true);
    const root = document.scrollingElement || document.documentElement;
    const before = root.scrollHeight;
    try {
      await onShow();
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollBy(0, root.scrollHeight - before)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 12px" }}>
      <button type="button" className="rm-focus" onClick={show} disabled={busy} aria-busy={busy ? "true" : undefined}
        style={{ height: "34px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "17px", cursor: busy ? "wait" : "pointer", fontSize: "13px", fontWeight: "600", color: "#2B2D36" }}>
        {busy ? "Cargando…" : count === 1 ? "Ver el mensaje anterior" : `Ver mensajes anteriores · quedan ${count.toLocaleString("es-ES")}`}
      </button>
    </div>
  );
}
