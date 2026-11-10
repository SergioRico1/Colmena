import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ListenButton } from "../../interaction/Voice.jsx";
import { trailGroups } from "../../../lib/trail.js";
import Markdown, { plain } from "../../room/Markdown.jsx";
import LiveMarkdown from "../../room/LiveMarkdown.jsx";
import { groupTools, headline } from "../../room/ToolCards.jsx";
import { artifactMeta } from "../../room/DeliverableCard.jsx";
import { UserText } from "../../room/SelectionPopup.jsx";
import { RefChips } from "../../room/Mentions.jsx";
import { copyText } from "../../room/common.jsx";
import { DOWN, DownReasons, downSummary, myDown, useReactions } from "../../room/Reactions.jsx";
import { BotPresence } from "../Presence.jsx";
import { BotMark } from "./Mark.jsx";
import { BranchPicker } from "./Versions.jsx";
import WorkLog, { CommandOutput, durationText } from "./WorkLog.jsx";
import { workSummary } from "../../../lib/worklog.js";
import { useExpert } from "../../../lib/expert.js";
import { useStore } from "../../../lib/store.jsx";
import { dragOutProps, workFileUrl } from "../../../lib/dragOut.js";

// Colmena 3 conversation pieces (design/V3Chat.dc.html, V3ChatExperto.dc.html): your message
// as a soft bubble on the right; the bot's answer under its shape, name and time, in 15.5 px;
// the work as a white card «Hecho en N pasos»; the actions always under the answer (copy, do
// it again, edit your request, useful / not useful, versions). Expert mode adds the model,
// tokens, cache and time under each answer — it never moves anything.
const EXT = { PDF: ["#FBE9EA", "#B4232A"], XLS: ["#E3F4EC", "#0B6B4A"], CSV: ["#E3F4EC", "#0B6B4A"], DOC: ["#E3EBFF", "#1F4FD1"], PPT: ["#FFE9DC", "#C2410C"], WEB: ["#F1F1EC", "#3D404A"] };
export const extTint = (ext) => EXT[ext] || ["#F1F1EC", "#4A4D57"];
export const extOf = (name) => {
  const e = (String(name || "").split(".").pop() || "").toLowerCase();
  return { pdf: "PDF", xlsx: "XLS", xls: "XLS", csv: "CSV", docx: "DOC", doc: "DOC", md: "DOC", txt: "DOC", pptx: "PPT" }[e] || e.slice(0, 3).toUpperCase() || "DOC";
};
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");
/** 18.4k, 1.2k, 940. */
export const kTokens = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(n || 0)));

/** «Hoy · 09:24» between groups of messages, with a hairline on each side. */
export function TimeMark({ at }) {
  if (!at) return null;
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const yesterday = new Date(Date.now() - 864e5).toDateString() === d.toDateString();
  const day = today ? "Hoy" : yesterday ? "Ayer" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12.5px", color: "#5C606C" }}>
      <span style={{ flex: "1", height: "1px", background: "rgba(18,19,26,.08)" }} />
      {`${day} · ${clock(at)}`}
      <span style={{ flex: "1", height: "1px", background: "rgba(18,19,26,.08)" }} />
    </div>
  );
}

export function UserBubble({ message, children }) {
  return (
    <div data-message-id={message.optimistic ? undefined : message.id} aria-busy={message.optimistic ? "true" : undefined}
      style={{ alignSelf: "flex-end", maxWidth: "78%", display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end", opacity: message.optimistic ? 0.65 : 1, transition: "opacity .2s ease" }}>
      <div style={{ padding: "14px 18px", background: "#EBEBE6", borderRadius: "20px 20px 6px 20px", fontSize: "15.5px", lineHeight: "1.55", overflowWrap: "anywhere" }}>
        <UserText text={message.text} size={15.5} messageId={message.optimistic ? null : message.id} />
      </div>
      <RefChips refs={message.refs} />
      {children}
    </div>
  );
}

/** A file you attached, as the board draws it: a tinted tile with its kind and its name. */
export function AttachmentChip({ name, missionId = null }) {
  const ext = extOf(name);
  const [bg, fg] = extTint(ext);
  return (
    // Attachments live in the chat's folder under their name: in the desktop app they drag out.
    <span {...(missionId ? dragOutProps(workFileUrl(missionId, name)) : {})} style={{ display: "inline-flex", alignItems: "center", gap: "8px", maxWidth: "100%", height: "30px", padding: "0 12px 0 6px", borderRadius: "10px", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.08)", fontSize: "13px" }}>
      <span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "6px", background: bg, color: fg, fontSize: "9px", fontWeight: 700 }}>{ext}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </span>
  );
}

/** The bot's shape, its name and when it said it, over each answer. */
export function AnswerHead({ bot, at = null, note = null, state = "rest" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <BotMark bot={bot} size={20} state={state} />
      <span style={{ fontSize: "14.5px", fontWeight: 600 }}>{bot?.name || "Bot"}</span>
      <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{[note, at ? clock(at) : null].filter(Boolean).join(" · ") || "ahora"}</span>
    </div>
  );
}

/** What the bot already did for this answer: the «Hecho en N pasos» card (WorkLog.jsx). */
export function DoneSteps({ tools = [], bots = [], stepId = null, seconds = null }) {
  return <WorkLog tools={tools} bots={bots} stepId={stepId} seconds={seconds} />;
}

const ANSWER = { fontSize: "15.5px", lineHeight: "1.6", color: "#12131A" };
const secondsOf = (message, step) => message?.summary?.seconds ?? (step?.startedAt && step?.completedAt ? (Date.parse(step.completedAt) - Date.parse(step.startedAt)) / 1000 : null);

/**
 * What the bot said while it worked, as Claude Desktop shows it: plain answer text, each
 * line with what it did right after it. Finished work with more than three lines folds into
 * «Cómo lo hizo» (as Codex does), so long chats stay short.
 */
export function WorkTrail({ step, bots = [], running = false, ticks = true }) {
  const lines = step?.progress || [];
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  const groups = trailGroups(lines, step?.tools || []);
  const folded = !running && lines.length > 3 && !open;
  // Folded, the whole work reads as one line: «Ha leído 5 correos y editado 2 archivos».
  const summary = workSummary(step?.tools || []);
  const toggle = !running && lines.length > 3 ? (
    <button type="button" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)}
      style={{ alignSelf: "stretch", display: "flex", alignItems: "center", gap: "10px", minHeight: "46px", padding: "8px 16px", border: "1px solid rgba(18,19,26,.07)", borderRadius: "16px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", color: "#12131A", textAlign: "left" }}>
      <span aria-hidden="true" style={{ color: "#0B6B4A", fontWeight: 600 }}>{"✓"}</span>
      <span style={{ flex: "1", minWidth: 0 }}><strong style={{ fontWeight: 600 }}>{open ? "Ocultar cómo lo hizo" : "Cómo lo hizo"}</strong><span style={{ color: "#5C606C" }}>{open ? "" : " · " + (summary ? summary.text : `${lines.length} pasos`)}</span></span>
      <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#4A4D57", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
    </button>
  ) : null;
  if (folded) return toggle;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {toggle}
      {groups.map(({ line, tools }, i) => (
        <div key={line.id || i} style={{ display: "flex", flexDirection: "column", gap: "10px", animation: running ? "rise .4s ease-out" : undefined }}>
          <Markdown text={line.text} size={16} style={ANSWER} />
          {ticks ? <DoneSteps tools={tools} bots={bots} stepId={step?.id} /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The bot's answer: its head (shape, name, time), the work it did and the text. What you can
 * do with it goes under it, in AnswerActions (after the deliverables and the sources).
 */
export function BotAnswer({ message, bot, step, bots, trail = true, head = true, children }) {
  return (
    <div data-message-id={message.id} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "14px" }}>
      {head ? <AnswerHead bot={bot} at={message.at} /> : null}
      {!trail ? null : step?.progress?.length ? <WorkTrail step={step} bots={bots} /> : <DoneSteps tools={step?.tools || []} bots={bots} stepId={step?.id} seconds={secondsOf(message, step)} />}
      {message.text ? <Markdown text={message.text} size={16} style={ANSWER} /> : null}
      {children}
    </div>
  );
}

const ICON = { width: "34px", height: "34px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "9px", background: "transparent", color: "#4A4D57", cursor: "pointer" };
const Glyph = ({ d }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const ACTION_ICONS = {
  copy: "M8 8h11v12H8zM5 16V4h11",
  again: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.8 4.5v3.6h-3.6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  up: "M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7",
  down: "M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.7 4H17",
};

/**
 * Under an answer (V3Chat «Acciones del mensaje»): listen, copy, do it again, edit your
 * request, useful / not useful (a 👍 / 👎 the bots read on their next turn) and the versions.
 */
export function AnswerActions({ message, bot, onRetry = null, onEditAsk = null, branch = null, onVersion = null, versionDisabled = false }) {
  const [copied, setCopied] = useState(false);
  const [reactions, toggle, explain] = useReactions(message);
  const mine = (emoji) => reactions.some((r) => r.emoji === emoji && r.by === "user");
  // «No me sirve» asks why in a small popover (server/feedback.mjs); pressed again, it opens it to change or take it back.
  const [why, setWhy] = useState(false);
  const down = myDown(reactions);
  const onDown = () => {
    if (!down) void toggle(DOWN);
    setWhy((v) => !v || !down);
  };
  if (!message?.text) return branch ? <BranchPicker branch={branch} disabled={versionDisabled} onShow={onVersion} /> : null;
  const pressed = (on) => (on ? { background: "#F1F1EC", color: "#12131A" } : {});
  return (
    <div role="toolbar" aria-label="Acciones del mensaje" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px", color: "#4A4D57", marginTop: "-4px" }}>
      <ListenButton text={message.text} bot={bot} compact style={{ ...ICON, width: "34px", height: "34px" }} />
      <button type="button" className="rm-focus" aria-label={copied ? "Copiado" : "Copiar"} title={copied ? "Copiado" : "Copiar"} onClick={async () => { await copyText(plain(message.text)); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{ ...ICON, ...(copied ? { color: "#0B6B4A" } : {}) }}><Glyph d={copied ? "m5 12 5 5 9-10" : ACTION_ICONS.copy} /></button>
      {onRetry ? <button type="button" className="rm-focus" aria-label="Volver a hacer" title="Volver a hacer" onClick={onRetry} style={ICON}><Glyph d={ACTION_ICONS.again} /></button> : null}
      {onEditAsk ? <button type="button" className="rm-focus" aria-label="Editar mi petición" title="Editar mi petición" onClick={onEditAsk} style={ICON}><Glyph d={ACTION_ICONS.edit} /></button> : null}
      <button type="button" className="rm-focus" aria-label="Útil" title="Útil" aria-pressed={mine("👍") ? "true" : "false"} onClick={() => toggle("👍")} style={{ ...ICON, ...pressed(mine("👍")) }}><Glyph d={ACTION_ICONS.up} /></button>
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button type="button" className="rm-focus" aria-label="No me sirve" title={down && downSummary(down) ? "No me sirve: " + downSummary(down) : "No me sirve"} aria-pressed={down ? "true" : "false"} aria-expanded={why ? "true" : "false"} aria-haspopup="dialog" onClick={onDown} style={{ ...ICON, ...pressed(!!down) }}><Glyph d={ACTION_ICONS.down} /></button>
        {down && downSummary(down) && !why ? <button type="button" className="rm-focus" onClick={() => setWhy(true)} title={down.note || undefined} style={{ height: "28px", padding: "0 8px", border: 0, borderRadius: "8px", background: "transparent", color: "#5C606C", fontSize: "12.5px", cursor: "pointer" }}>{downSummary(down)}</button> : null}
        {why ? <DownReasons current={down} onSave={explain} onRemove={down ? () => toggle(DOWN) : null} onClose={() => setWhy(false)} /> : null}
      </span>
      {branch && branch.count > 1 ? <span style={{ marginLeft: "8px" }}><BranchPicker branch={branch} disabled={versionDisabled} onShow={onVersion} /></span> : null}
    </div>
  );
}

/** Expert mode, under each answer: model, tokens, cache and time, and «Ver en Actividad». */
export function UsageLine({ message, step = null }) {
  const [expert] = useExpert();
  const { settings = {} } = useStore() || {};
  if (!expert || !message?.text) return null;
  const s = message.summary || {};
  const time = durationText(secondsOf(message, step));
  const parts = [settings.model || null, s.tokens ? `${kTokens(s.tokens)} tokens` : null, s.calls ? `${s.calls} llamada${s.calls === 1 ? "" : "s"}` : null, s.cachedPercent != null ? `caché ${s.cachedPercent} %` : null, s.reads ? `${s.reads} lectura${s.reads === 1 ? "" : "s"}` : null, time || null].filter(Boolean);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", font: "400 12px/1.4 'Geist Mono', monospace", color: "#5C606C" }}>
      {parts.map((p) => <span key={p}>{p}</span>)}
      <a href="/actividad" style={{ fontFamily: "'Geist', sans-serif", fontSize: "12.5px" }}>{"Ver en Actividad"}</a>
    </div>
  );
}

/** A deliverable (V3Chat): its kind on a tile, title, «Documento · 1 página · versión 2» and «Abrir»; an image shows itself. */
export function DeliverableV2({ artifact, onOpen, extra = null }) {
  const isImage = artifact?.format === "png" || artifact?.kind === "design";
  const pages = artifact?.pages ? (artifact.pages === 1 ? "1 página" : `${artifact.pages} páginas`) : null;
  const ext = isImage ? "IMG" : extOf(artifact?.file || artifact?.path || (artifact?.format ? "x." + artifact.format : "x.docx"));
  const [bg, fg] = isImage ? ["#FFE6F1", "#9C1F5C"] : extTint(ext);
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px", borderRadius: "20px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 40px -30px rgba(18,19,26,.35)", animation: "rise .5s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span aria-hidden="true" style={{ flex: "none", width: "36px", height: "36px", display: "grid", placeItems: "center", borderRadius: "10px", background: bg, color: fg, fontSize: "10px", fontWeight: 700 }}>{ext}</span>
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span {...(artifact?.id && (artifact.file || artifact.workFile || isImage) ? dragOutProps(`/api/artifacts/${encodeURIComponent(artifact.id)}/file`) : {})} style={{ fontSize: "15.5px", fontWeight: 600, overflowWrap: "anywhere" }}>{artifact?.title || "Entregable"}</span>
          <span style={{ fontSize: "13px", color: "#5C606C" }}>{[artifactMeta(artifact), pages].filter(Boolean).join(" · ")}</span>
        </div>
        {extra}
        <a href={`/api/artifacts/${encodeURIComponent(artifact?.id)}/download`} download aria-label={"Descargar " + (artifact?.title || "el entregable")} title="Descargar" style={{ fontSize: "14px", fontWeight: 500, color: "#4A4D57" }}>{"Descargar"}</a>
        <button type="button" onClick={onOpen} style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 500, color: "#1F4FD1" }}>{"Abrir"}</button>
      </div>
      {artifact?.summary ? <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#4A4D57" }}>{artifact.summary}</span> : null}
      {isImage && artifact?.id ? <img src={`/api/artifacts/${encodeURIComponent(artifact.id)}/file`} alt="" data-lightbox="" data-name={(artifact.title || "imagen") + ".png"} style={{ width: "100%", maxHeight: "320px", borderRadius: "14px", objectFit: "cover", cursor: "zoom-in", animation: "develop 1.2s ease-out both" }} /> : null}
    </article>
  );
}

const shimmerText = { alignSelf: "flex-start", fontSize: "14.5px", fontWeight: "500", background: "linear-gradient(90deg, #6B6F7A 0%, #6B6F7A 35%, #12131A 50%, #6B6F7A 65%, #6B6F7A 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" };

/**
 * The work while it happens (idea 04: «nada de procesando»): what it reads (each file with a
 * spinner, then its pages), what it runs (a dark terminal), what it writes (the answer itself, with a
 * caret), what it draws (the picture developing); otherwise its own words about what it does.
 */
export function WorkNow({ step, live, bot, bots, narration, onStop = null, head = true }) {
  const tools = step?.tools || [];
  const running = tools.filter((t) => t.status === "running");
  const reads = groupTools(tools).filter((t) => ["file", "web", "pdf_fields", "folder"].includes(t.card?.type));
  const command = [...tools].reverse().find((t) => t.card?.type === "command" && (t.status === "running" || t === tools[tools.length - 1]));
  const image = running.find((t) => t.card?.type === "image");
  const color = bot?.color || "#7B4DFF";
  // The answer as it is written looks like the answer it becomes: same text, same place.
  if (live?.text) {
    return (
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {head ? <AnswerHead bot={bot} state="work" /> : null}
        <LiveMarkdown text={live.text} size={16} style={ANSWER} caret streamKey={step?.id || live.stepId} />
      </div>
    );
  }
  if (image) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .4s ease-out" }}>
        <div style={{ position: "relative", height: "300px", borderRadius: "26px", overflow: "hidden", background: "#EDE8FF" }}>
          <div aria-hidden="true" style={{ position: "absolute", inset: "0", animation: "develop 4s ease-out both", background: `radial-gradient(circle at 72% 30%, #FFC93C 0 13%, rgba(255,201,60,0) 13.5%), radial-gradient(120% 70% at 20% 110%, ${color} 0 48%, rgba(0,0,0,0) 48.5%), radial-gradient(120% 80% at 90% 120%, #2F6BFF 0 45%, rgba(47,107,255,0) 45.5%), linear-gradient(180deg, #FFF4D1, #F5E9FF)` }} />
          <span role="status" style={{ position: "absolute", left: "20px", bottom: "18px", padding: "8px 14px", borderRadius: "999px", background: "rgba(255,255,255,.8)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", fontSize: "13px", fontWeight: "500" }}>{"Revelando la imagen…"}</span>
        </div>
        {image.card?.prompt ? <span style={{ fontSize: "14px", color: "#5C606C" }}>{image.card.prompt}</span> : null}
      </div>
    );
  }
  if (command && command.status === "running") return <RunningCommand command={command} stepId={step?.id} narration={narration} bots={bots} />;
  if (reads.length && running.some((t) => ["file", "web", "pdf_fields", "folder"].includes(t.card?.type))) {
    return (
      <div style={{ display: "flex", flexDirection: "column", padding: "8px 20px", background: "#FFFFFF", borderRadius: "24px", animation: "fade .4s ease-out" }}>
        {reads.slice(-6).map((t, i, list) => {
          const name = t.card.name || t.card.title || t.card.domain || t.card.path || "Documento";
          const ext = t.card.type === "web" ? "WEB" : extOf(name);
          const [bg, fg] = extTint(ext);
          const done = t.status === "done";
          const pages = t.card.pages ? (t.card.pages === 1 ? "1 página" : `${t.card.pages} páginas`) : t.card.domain || "leído";
          return (
            <div key={t.id || i} style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "58px", borderBottom: i < list.length - 1 ? "1px solid rgba(18,19,26,.06)" : "0", opacity: done || t.status === "running" ? 1 : 0.4, transition: "opacity .4s ease" }}>
              <span aria-hidden="true" style={{ width: "34px", height: "34px", flex: "none", display: "grid", placeItems: "center", borderRadius: "10px", font: "600 9px/1 'Geist Mono', monospace", background: bg, color: fg }}>{ext}</span>
              <span style={{ flex: "1", minWidth: 0, fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
              {t.status === "running" ? <span aria-label="Leyendo" style={{ width: "16px", height: "16px", flex: "none", borderRadius: "50%", border: `2px solid ${color}40`, borderTopColor: color, animation: "spin .8s linear infinite" }} /> : null}
              {done ? <span style={{ fontSize: "13px", color: "#0B6B4A", animation: "fade .3s ease-out" }}>{pages}</span> : null}
            </div>
          );
        })}
      </div>
    );
  }
  // Thinking or using a tool: the shape breathing and one quiet shimmer line — «Pensando…», or
  // the tool at work — with the narration (if any) under it; «Parar» stays small at the side.
  return (
    <article role="status" style={{ display: "flex", flexDirection: "column", gap: "6px", animation: "fade .4s ease-out" }}>
      {head ? <AnswerHead bot={bot} state="work" /> : null}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "30px" }}>
        <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={shimmerText}>{running.length ? <>{headline(running[running.length - 1], bots)}{"…"}</> : "Pensando…"}</span>
          {narration ? <span style={{ fontSize: "13px", color: "#5C606C" }}>{narration}</span> : null}
        </span>
        {onStop ? <button type="button" className="chat-stop" onClick={onStop} title="Parar (Esc)" style={{ flex: "none", height: "30px", padding: "0 12px", border: "0", borderRadius: "999px", background: "transparent", color: "#5C606C", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>{"Parar"}</button> : null}
      </div>
    </article>
  );
}

/** A command at work: what it runs; its output only when you ask for it (it streams then). */
function RunningCommand({ command, stepId, narration, bots }) {
  const [shown, setShown] = useState(false);
  const c = command.card || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .4s ease-out" }}>
      <span style={{ fontSize: "14px", color: "#5C606C" }}>{narration || headline(command, bots)}</span>
      <div style={{ padding: "18px 20px", background: "#12131A", borderRadius: "22px", display: "flex", flexDirection: "column", gap: "10px", font: "400 14px/1.6 'Geist Mono', monospace", color: "#E6E7EC", overflow: "hidden" }}>
        <span style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <span style={{ flex: "1", minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.command || c.program || "…"}{shown ? null : <span aria-hidden="true" style={{ display: "inline-block", width: "8px", height: "17px", marginLeft: "6px", verticalAlign: "-3px", background: "#FFC93C", animation: "caret 1s steps(1) infinite" }} />}</span>
          <button type="button" className="rm-focus" aria-expanded={shown ? "true" : "false"} onClick={() => setShown((v) => !v)}
            style={{ flex: "none", height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "rgba(255,255,255,.1)", color: "#FFFFFF", cursor: "pointer", font: "600 12px/1 'Geist', sans-serif" }}>{shown ? "Ocultar la salida" : "Ver la salida"}</button>
        </span>
        {shown ? <CommandOutput stepId={stepId} callId={command.id} running /> : null}
      </div>
    </div>
  );
}

export { BotPresence };
