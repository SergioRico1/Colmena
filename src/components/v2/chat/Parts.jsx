import { useState } from "react";
import { Check, ChevronDown, Copy, RotateCcw } from "lucide-react";
import { ListenButton } from "../../interaction/Voice.jsx";
import { trailGroups } from "../../../lib/trail.js";
import Markdown, { plain } from "../../room/Markdown.jsx";
import LiveMarkdown from "../../room/LiveMarkdown.jsx";
import { groupTools, headline } from "../../room/ToolCards.jsx";
import { artifactMeta } from "../../room/DeliverableCard.jsx";
import { UserText } from "../../room/SelectionPopup.jsx";
import { copyText } from "../../room/common.jsx";
import { BotPresence } from "../Presence.jsx";
import WorkLog, { CommandOutput } from "./WorkLog.jsx";
import { workSummary } from "../../../lib/worklog.js";

// Colmena 2.0 conversation pieces (design/V2Conversacion.dc.html): your message as a soft
// bubble on the right; the bot's answer as plain text at 17 px; the work shown while it
// happens (thinking, reading, calculating, writing, drawing); the deliverable card.
const EXT = { PDF: ["#FBE7DF", "#8E2A1F"], XLS: ["#E1F4EC", "#0B6B4A"], CSV: ["#E1F4EC", "#0B6B4A"], DOC: ["#DDE7FF", "#1F3F99"], PPT: ["#FFE6F1", "#9C1F5C"], WEB: ["#EEF0F4", "#3D404A"] };
export const extTint = (ext) => EXT[ext] || ["#EEF0F4", "#4A4F5C"];
export const extOf = (name) => {
  const e = (String(name || "").split(".").pop() || "").toLowerCase();
  return { pdf: "PDF", xlsx: "XLS", xls: "XLS", csv: "CSV", docx: "DOC", doc: "DOC", md: "DOC", txt: "DOC", pptx: "PPT" }[e] || e.slice(0, 3).toUpperCase() || "DOC";
};

/** «Hoy · 09:24» between groups of messages. */
export function TimeMark({ at }) {
  if (!at) return null;
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const yesterday = new Date(Date.now() - 864e5).toDateString() === d.toDateString();
  const day = today ? "Hoy" : yesterday ? "Ayer" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return <span style={{ alignSelf: "center", fontSize: "13px", color: "#6B6F7A" }}>{`${day} · ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`}</span>;
}

export function UserBubble({ message, children }) {
  return (
    <div data-message-id={message.optimistic ? undefined : message.id} aria-busy={message.optimistic ? "true" : undefined}
      style={{ alignSelf: "flex-end", maxWidth: "78%", display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end", opacity: message.optimistic ? 0.65 : 1, transition: "opacity .2s ease" }}>
      <div style={{ padding: "16px 20px", background: "#E8E8E2", borderRadius: "24px 24px 8px 24px", fontSize: "16px", lineHeight: "1.55", overflowWrap: "anywhere" }}>
        <UserText text={message.text} size={16} />
      </div>
      {children}
    </div>
  );
}

/** What the bot already did for this answer: one plain line that unfolds (WorkLog.jsx). */
export function DoneSteps({ tools = [], bots = [], stepId = null }) {
  return <WorkLog tools={tools} bots={bots} stepId={stepId} />;
}

const ANSWER = { fontSize: "17px", lineHeight: "1.65", color: "#1E2029" };

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
      style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "5px 12px 5px 10px", border: 0, borderRadius: "16px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#3D404A", textAlign: "left" }}>
      <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      {open ? "Ocultar cómo lo hizo" : summary ? `Cómo lo hizo · ${summary.text}` : `Cómo lo hizo · ${lines.length} pasos`}
    </button>
  ) : null;
  if (folded) return toggle;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {toggle}
      {groups.map(({ line, tools }, i) => (
        <div key={line.id || i} style={{ display: "flex", flexDirection: "column", gap: "6px", animation: running ? "rise .4s ease-out" : undefined }}>
          <Markdown text={line.text} size={16} style={ANSWER} />
          {ticks ? <DoneSteps tools={tools} bots={bots} stepId={step?.id} /> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The bot's answer: plain text at 17 px. Listen, copy and another answer live in a small
 * toolbar that shows on hover or focus (as Slack's message actions in the rooms).
 */
export function BotAnswer({ message, bot, step, bots, onRetry, trail = true, children }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="msg msg-row" data-message-id={message.id} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "10px", padding: "6px 0" }}>
      {message.text ? (
        <span className="msg-actions" role="toolbar" aria-label="Acciones de la respuesta" style={{ top: "-18px", right: "0" }}>
          <ListenButton text={message.text} bot={bot} compact style={{ width: "30px", height: "30px", color: "#4A4F5C" }} />
          <button type="button" className="rm-focus" onClick={async () => { await copyText(plain(message.text)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            aria-label={copied ? "Copiado" : "Copiar"} title={copied ? "Copiado" : "Copiar"} style={iconQuiet}>
            {copied ? <Check size={15} strokeWidth={2.4} aria-hidden="true" style={{ color: "#0B8A5F" }} /> : <Copy size={15} strokeWidth={2.2} aria-hidden="true" />}
          </button>
          {onRetry ? (
            <button type="button" className="rm-focus" onClick={onRetry} aria-label="Otra respuesta" title="Otra respuesta" style={iconQuiet}>
              <RotateCcw size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
      {!trail ? null : step?.progress?.length ? <WorkTrail step={step} bots={bots} /> : <DoneSteps tools={step?.tools || []} bots={bots} stepId={step?.id} />}
      {message.text ? <Markdown text={message.text} size={16} style={ANSWER} /> : null}
      {children}
    </div>
  );
}
const iconQuiet = { width: "30px", height: "30px", display: "grid", placeItems: "center", border: "0", borderRadius: "8px", background: "transparent", cursor: "pointer", color: "#4A4F5C" };

/** A deliverable: what it is, its title and «Abrir»; an image shows itself on the right. */
export function DeliverableV2({ artifact, onOpen, extra = null }) {
  const isImage = artifact?.format === "png" || artifact?.kind === "design";
  const pages = artifact?.pages ? (artifact.pages === 1 ? "1 página" : `${artifact.pages} páginas`) : null;
  return (
    <article style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) clamp(0px, 32%, 180px)", background: "#FFFFFF", borderRadius: "28px", overflow: "hidden", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 50px -28px rgba(18,19,26,.3)", animation: "rise .5s ease-out" }}>
      <div style={{ padding: "26px 28px", display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
        <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{[artifactMeta(artifact), pages].filter(Boolean).join(" · ")}</span>
        <strong style={{ font: "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>{artifact?.title || "Entregable"}</strong>
        {artifact?.summary ? <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#3D404A" }}>{artifact.summary}</span> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "4px" }}>
          <button type="button" onClick={onOpen} style={{ display: "flex", alignItems: "center", height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>{"Abrir"}</button>
          <a href={`/api/artifacts/${encodeURIComponent(artifact?.id)}/download`} download style={{ display: "flex", alignItems: "center", height: "42px", padding: "0 18px", borderRadius: "999px", background: "rgba(18,19,26,.06)", fontSize: "14px", fontWeight: "600" }}>{"Descargar"}</a>
          {extra}
        </div>
      </div>
      {isImage && artifact?.id ? (
        <img src={`/api/artifacts/${encodeURIComponent(artifact.id)}/file`} alt="" data-lightbox="" data-name={(artifact.title || "imagen") + ".png"} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in", animation: "develop 1.2s ease-out both" }} />
      ) : (
        <div aria-hidden="true" style={{ background: "radial-gradient(circle at 72% 30%, #FFC93C 0 13%, rgba(255,201,60,0) 13.5%), radial-gradient(120% 70% at 20% 110%, #7B4DFF 0 48%, rgba(123,77,255,0) 48.5%), radial-gradient(120% 80% at 90% 120%, #2F6BFF 0 45%, rgba(47,107,255,0) 45.5%), linear-gradient(180deg, #FFF4D1, #F5E9FF)" }} />
      )}
    </article>
  );
}

const shimmerText = { alignSelf: "flex-start", fontSize: "17px", fontWeight: "500", background: "linear-gradient(90deg, #8A8D96 0%, #8A8D96 35%, #12131A 50%, #8A8D96 65%, #8A8D96 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" };

/**
 * The work while it happens (idea 04: «nada de procesando»): what it reads (each file with a
 * spinner, then its pages), what it runs (a dark terminal), what it writes (the answer itself, with a
 * caret), what it draws (the picture developing); otherwise its own words about what it does.
 */
export function WorkNow({ step, live, bot, bots, narration }) {
  const tools = step?.tools || [];
  const running = tools.filter((t) => t.status === "running");
  const reads = groupTools(tools).filter((t) => ["file", "web", "pdf_fields", "folder"].includes(t.card?.type));
  const command = [...tools].reverse().find((t) => t.card?.type === "command" && (t.status === "running" || t === tools[tools.length - 1]));
  const image = running.find((t) => t.card?.type === "image");
  const color = bot?.color || "#7B4DFF";
  // The answer as it is written looks like the answer it becomes: same text, same place.
  if (live?.text) {
    return (
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", padding: "6px 0" }}>
        <LiveMarkdown text={live.text} size={16} style={ANSWER} caret />
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
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: "14px", animation: "fade .4s ease-out" }}>
      <span style={shimmerText}>{running.length ? <>{headline(running[running.length - 1], bots)}{"…"}</> : "Pensando cómo hacerlo…"}</span>
      {narration ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <span style={{ padding: "9px 14px", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", color: "#3D404A", animation: "rise .5s ease-out" }}>{narration}</span>
        </div>
      ) : null}
    </div>
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

/** «Hoy» between days in a room (a hairline on each side). */
export function DayLine({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "2px 0 12px", fontSize: "13px", color: "#6B6F7A" }}>
      <span style={{ flex: "1", height: "1px", background: "rgba(18,19,26,.08)" }} />
      {label}
      <span style={{ flex: "1", height: "1px", background: "rgba(18,19,26,.08)" }} />
    </div>
  );
}

export { BotPresence };
