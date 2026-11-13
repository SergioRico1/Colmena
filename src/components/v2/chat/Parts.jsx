import { STATE_WORDS, srOnly } from "../../../lib/alt.js";
import { useState } from "react";
import { Check, Checks, ChevronRight, Copy, Download, Eye, Pencil, RotateCw, ThumbsDown, ThumbsUp, Wrench } from "../../Icon.js";
import BotFace from "../../BotFace.jsx";
import { useOpenBot } from "../../room/Author.jsx";
import "../../../styles/conversation.css";
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
import { BranchPicker } from "./Versions.jsx";
import WorkLog, { CommandOutput, durationText } from "./WorkLog.jsx";
import { turnSummary, workSummary } from "../../../lib/worklog.js";
import { useExpert } from "../../../lib/expert.js";
import { useStore } from "../../../lib/store.jsx";
import { dragOutProps, workFileUrl } from "../../../lib/dragOut.js";

// Colmena 3 conversation pieces (design/V3Chat.dc.html, V3ChatExperto.dc.html): your message
// as a soft bubble on the right; the bot's answer under its shape, name and time, in 15.5 px;
// the work as a white card «Hecho en N pasos»; the actions always under the answer (copy, do
// it again, edit your request, useful / not useful, versions). Expert mode adds the model,
// tokens, cache and time under each answer — it never moves anything.
// The tile of a file kind, from the theme's tokens (light and dark): red for PDF and slides,
// green for sheets, blue for documents, neutral for the rest.
const EXT = { PDF: ["var(--c-error-soft)", "var(--c-error)"], XLS: ["var(--c-ok-soft)", "var(--c-ok-ink)"], CSV: ["var(--c-ok-soft)", "var(--c-ok-ink)"], DOC: ["var(--c-accent-soft)", "var(--c-accent-ink)"], PPT: ["var(--c-error-soft)", "var(--c-error)"], WEB: ["var(--c-sunken)", "var(--c-text-2)"] };
export const extTint = (ext) => EXT[ext] || ["var(--c-sunken)", "var(--c-text-2)"];
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
    <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
      <span style={{ flex: "1", height: "1px", background: "rgb(var(--c-ink-rgb) / .08)" }} />
      {`${day} · ${clock(at)}`}
      <span style={{ flex: "1", height: "1px", background: "rgb(var(--c-ink-rgb) / .08)" }} />
    </div>
  );
}

/**
 * Your message (Colmena 4: design/v4 › .mine): on the right in the soft «mine» bubble, its time
 * and a tick under it (two and «Visto» once the bot has answered after it: `seen`).
 */
export function UserBubble({ message, seen = false, children }) {
  return (
    <div data-message-id={message.optimistic ? undefined : message.id} aria-busy={message.optimistic ? "true" : undefined}
      style={{ alignSelf: "flex-end", maxWidth: "min(62%, 560px)", display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end", opacity: message.optimistic ? 0.75 : 1, transition: "opacity .2s ease" }}>
      <div className="v4-bubble" style={{ maxWidth: "100%" }}>
        <UserText text={message.text} size={15} messageId={message.optimistic ? null : message.id} />
      </div>
      <span className="v4-mine-meta" style={{ marginTop: 0 }}>
        {message.at ? <time dateTime={message.at}>{clock(message.at)}</time> : null}
        {message.optimistic ? <span>{"Enviando…"}</span> : seen ? <><Checks size={15} aria-hidden="true" /><span>{"Visto"}</span></> : message.at && !message.failed ? <Check size={14} aria-label="Enviado" /> : null}
      </span>
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
    <span {...(missionId ? dragOutProps(workFileUrl(missionId, name)) : {})} style={{ display: "inline-flex", alignItems: "center", gap: "8px", maxWidth: "100%", height: "30px", padding: "0 12px 0 6px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid rgb(var(--c-ink-rgb) / .08)", fontSize: "var(--t-meta)" }}>
      <span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: bg, color: fg, fontSize: "var(--t-micro)", fontWeight: 700 }}>{ext}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </span>
  );
}

/**
 * Over each answer (design/v4 › .msg): the bot's 32 px face, its name, its role as a tag and the
 * time. The face and the name open its profile where the screen offers one.
 */
export function AnswerHead({ bot, at = null, note = null, state = "rest" }) {
  const open = useOpenBot();
  const author = { kind: "bot", botId: bot?.id, id: bot?.id, name: bot?.name, owner: { you: true } };
  const face = <BotFace bot={bot} size={32} state={state} decorative />;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
      {open ? <button type="button" className="v4-face-btn" onClick={() => open(author)} aria-label={`Ver el perfil de ${bot?.name || "este bot"}`} title={`Ver el perfil de ${bot?.name || "este bot"}`}>{face}</button> : face}
      <span className="v4-head" style={{ margin: 0 }}>
        {open ? <button type="button" className="n" onClick={() => open(author)}>{bot?.name || "Bot"}</button> : <span className="n">{bot?.name || "Bot"}</span>}
        <span style={srOnly}>{", bot" + (STATE_WORDS[state] ? ", " + STATE_WORDS[state] : "")}</span>
        {bot?.role ? <span className="v4-tag">{bot.role}</span> : null}
        {note ? <span className="of">{note}</span> : null}
        <time dateTime={at || undefined}>{at ? clock(at) : "ahora"}</time>
      </span>
    </div>
  );
}

/** What the bot already did for this answer: the «Hecho en N pasos» card (WorkLog.jsx). */
export function DoneSteps({ tools = [], bots = [], stepId = null, seconds = null, fold = false }) {
  return <WorkLog tools={tools} bots={bots} stepId={stepId} seconds={seconds} fold={fold} />;
}

const ANSWER = { fontSize: "var(--t-body)", lineHeight: "1.55", color: "var(--c-text-2)", maxWidth: "72ch" };
const secondsOf = (message, step) => message?.summary?.seconds ?? (step?.startedAt && step?.completedAt ? (Date.parse(step.completedAt) - Date.parse(step.startedAt)) / 1000 : null);

/**
 * What the bot said while it worked, as Claude Desktop shows it: plain answer text, each
 * line with what it did right after it. A finished turn folds to one line — «Usó 4
 * herramientas · 12 min» (worklog.js turnSummary), or «Cómo lo hizo» when it only spoke — so
 * long chats stay short; a lone quick read that only fed the answer shows nothing, and a
 * call that failed keeps it open. A turn still running is never folded.
 */
export function WorkTrail({ step, bots = [], running = false, ticks = true, seconds = null }) {
  const lines = step?.progress || [];
  const turn = running || step?.status === "running" ? null : turnSummary(step?.tools || [], seconds);
  const [open, setOpen] = useState(() => !!turn?.failed);
  if (!lines.length || turn?.quiet) return null;
  const groups = trailGroups(lines, step?.tools || []);
  // Without tools, a few lines of what it said stay as they are.
  const folds = !running && (!!turn || lines.length > 3);
  const folded = folds && !open;
  // Unfolded, the whole work reads as one line: «Ha leído 5 correos y editado 2 archivos».
  const summary = workSummary(step?.tools || []);
  const [title, ...rest] = turn ? turn.text.split(" · ") : ["Cómo lo hizo", summary ? summary.text : `${lines.length} pasos`];
  const toggle = folds ? (
    <button type="button" className="rm-focus" data-work-fold="" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} title={open ? "Ocultar cómo lo hizo" : "Ver cómo lo hizo"}
      className="v4-work" style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
      <Wrench size={16} style={{ flex: "none", color: "var(--c-text-3)" }} />
      <span style={{ flex: "1", minWidth: 0 }}>{title}</span>{rest.length ? <span className="tm">{rest.join(" · ")}</span> : null}
      <ChevronRight size={14} aria-hidden="true" style={{ flex: "none", color: "var(--c-text-3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s ease" }} />
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
    <div data-message-id={message.id} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "8px" }}>
      {head ? <AnswerHead bot={bot} at={message.at} /> : null}
      {/* The answer sits in the text column, beside the face (design/v4 › .msg). */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingLeft: "44px", marginTop: head ? "-14px" : 0 }}>
        {message.text ? <Markdown text={message.text} size={15} style={ANSWER} /> : null}
        {!trail ? null : step?.progress?.length ? <WorkTrail step={step} bots={bots} seconds={secondsOf(message, step)} /> : <DoneSteps tools={step?.tools || []} bots={bots} stepId={step?.id} seconds={secondsOf(message, step)} fold={step?.status !== "running"} />}
        {children}
      </div>
    </div>
  );
}

const ICON = { width: "34px", height: "34px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-2)", cursor: "pointer" };
const Glyph = ({ icon: Glyph16, active = false }) => <Glyph16 size={16} active={active} />;
const ACTION_ICONS = { copy: Copy, again: RotateCw, edit: Pencil, up: ThumbsUp, down: ThumbsDown };

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
  const pressed = (on) => (on ? { background: "var(--c-chip)", color: "var(--c-text)" } : {});
  return (
    <div role="toolbar" aria-label="Acciones del mensaje" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px", color: "var(--c-text-2)", marginTop: "-4px" }}>
      <ListenButton text={message.text} bot={bot} compact style={{ ...ICON, width: "34px", height: "34px" }} />
      <button type="button" className="rm-focus" aria-label={copied ? "Copiado" : "Copiar"} title={copied ? "Copiado" : "Copiar"} onClick={async () => { await copyText(plain(message.text)); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{ ...ICON, ...(copied ? { color: "var(--c-ok-ink)" } : {}) }}><Glyph icon={copied ? "m5 12 5 5 9-10" : ACTION_ICONS.copy} /></button>
      {onRetry ? <button type="button" className="rm-focus" aria-label="Volver a hacer" title="Volver a hacer" onClick={onRetry} style={ICON}><Glyph icon={ACTION_ICONS.again} /></button> : null}
      {onEditAsk ? <button type="button" className="rm-focus" aria-label="Editar mi petición" title="Editar mi petición" onClick={onEditAsk} style={ICON}><Glyph icon={ACTION_ICONS.edit} /></button> : null}
      <button type="button" className="rm-focus" aria-label="Útil" title="Útil" aria-pressed={mine("👍") ? "true" : "false"} onClick={() => toggle("👍")} style={{ ...ICON, ...pressed(mine("👍")) }}><Glyph icon={ACTION_ICONS.up} /></button>
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button type="button" className="rm-focus" aria-label="No me sirve" title={down && downSummary(down) ? "No me sirve: " + downSummary(down) : "No me sirve"} aria-pressed={down ? "true" : "false"} aria-expanded={why ? "true" : "false"} aria-haspopup="dialog" onClick={onDown} style={{ ...ICON, ...pressed(!!down) }}><Glyph icon={ACTION_ICONS.down} /></button>
        {down && downSummary(down) && !why ? <button type="button" className="rm-focus" onClick={() => setWhy(true)} title={down.note || undefined} style={{ height: "28px", padding: "0 8px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text-3)", fontSize: "var(--t-meta)", cursor: "pointer" }}>{downSummary(down)}</button> : null}
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
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", font: "400 var(--t-caption)/1.4 'Geist Mono', monospace", color: "var(--c-text-3)" }}>
      {parts.map((p) => <span key={p}>{p}</span>)}
      <a href="/actividad" style={{ fontFamily: "'Geist', sans-serif", fontSize: "var(--t-meta)" }}>{"Ver en Actividad"}</a>
    </div>
  );
}

/** A deliverable (V3Chat): its kind on a tile, title, «Documento · 1 página · versión 2» and «Abrir»; an image shows itself. */
export function DeliverableV2({ artifact, onOpen, extra = null }) {
  const isImage = artifact?.format === "png" || artifact?.kind === "design";
  const pages = artifact?.pages ? (artifact.pages === 1 ? "1 página" : `${artifact.pages} páginas`) : null;
  const ext = isImage ? "IMG" : extOf(artifact?.file || artifact?.path || (artifact?.format ? "x." + artifact.format : "x.docx"));
  const [bg, fg] = isImage ? ["var(--c-accent-soft)", "var(--c-accent-ink)"] : extTint(ext);
  return (
    <article style={{ alignSelf: "flex-start", width: "min(100%, 540px)", display: "flex", flexDirection: "column", gap: "10px", padding: "10px 10px 10px 12px", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-raised)", boxSizing: "border-box", animation: "rise .5s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span aria-hidden="true" style={{ flex: "none", width: "40px", height: "40px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: bg, color: fg, fontSize: "var(--t-micro)", fontWeight: 700 }}>{ext}</span>
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span {...(artifact?.id && (artifact.file || artifact.workFile || isImage) ? dragOutProps(`/api/artifacts/${encodeURIComponent(artifact.id)}/file`) : {})} style={{ fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text)", overflowWrap: "anywhere" }}>{artifact?.title || "Entregable"}</span>
          <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{[artifactMeta(artifact), pages].filter(Boolean).join(" · ")}</span>
        </div>
        {extra}
        <button type="button" className="v4-btn" onClick={onOpen}><Eye size={15} />{"Abrir"}</button>
        <a className="v4-btn" href={`/api/artifacts/${encodeURIComponent(artifact?.id)}/download`} download aria-label={"Descargar " + (artifact?.title || "el entregable")} title="Descargar"><Download size={15} />{"Descargar"}</a>
      </div>
      {artifact?.summary ? <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{artifact.summary}</span> : null}
      {isImage && artifact?.id ? <img src={`/api/artifacts/${encodeURIComponent(artifact.id)}/file`} alt="" data-lightbox="" data-name={(artifact.title || "imagen") + ".png"} style={{ width: "100%", maxHeight: "320px", borderRadius: "var(--r-lg)", objectFit: "cover", cursor: "zoom-in", animation: "develop 1.2s ease-out both" }} /> : null}
    </article>
  );
}

const shimmerText = { alignSelf: "flex-start", fontSize: "var(--t-body)", fontWeight: "500", background: "linear-gradient(90deg, var(--c-text-3) 0%, var(--c-text-3) 35%, var(--c-text) 50%, var(--c-text-3) 65%, var(--c-text-3) 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" };

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
  const color = bot?.color || "var(--c-accent)";
  // The answer as it is written looks like the answer it becomes: same text, same place.
  if (live?.text) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {head ? <AnswerHead bot={bot} state="work" /> : null}
        <LiveMarkdown text={live.text} size={16} style={ANSWER} caret streamKey={step?.id || live.stepId} />
      </div>
    );
  }
  if (image) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .4s ease-out" }}>
        <div style={{ position: "relative", height: "300px", borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--c-sunken)" }}>
          <div aria-hidden="true" style={{ position: "absolute", inset: "0", animation: "develop 4s ease-out both", background: `radial-gradient(circle at 72% 30%, var(--c-accent-soft) 0 13%, transparent 13.5%), radial-gradient(120% 70% at 20% 110%, ${color} 0 48%, transparent 48.5%), radial-gradient(120% 80% at 90% 120%, var(--c-accent) 0 45%, transparent 45.5%), linear-gradient(180deg, var(--c-sunken), var(--c-accent-soft))` }} />
          <span role="status" style={{ position: "absolute", left: "20px", bottom: "18px", padding: "8px 14px", borderRadius: "var(--r-pill)", background: "color-mix(in oklab, var(--c-raised) 85%, transparent)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", fontSize: "var(--t-meta)", fontWeight: "500" }}>{"Revelando la imagen…"}</span>
        </div>
        {image.card?.prompt ? <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{image.card.prompt}</span> : null}
      </div>
    );
  }
  if (command && command.status === "running") return <RunningCommand command={command} stepId={step?.id} narration={narration} bots={bots} />;
  if (reads.length && running.some((t) => ["file", "web", "pdf_fields", "folder"].includes(t.card?.type))) {
    return (
      <div style={{ display: "flex", flexDirection: "column", padding: "8px 20px", background: "var(--c-card)", borderRadius: "var(--r-2xl)", animation: "fade .4s ease-out" }}>
        {reads.slice(-6).map((t, i, list) => {
          const name = t.card.name || t.card.title || t.card.domain || t.card.path || "Documento";
          const ext = t.card.type === "web" ? "WEB" : extOf(name);
          const [bg, fg] = extTint(ext);
          const done = t.status === "done";
          const pages = t.card.pages ? (t.card.pages === 1 ? "1 página" : `${t.card.pages} páginas`) : t.card.domain || "leído";
          return (
            <div key={t.id || i} style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "58px", borderBottom: i < list.length - 1 ? "1px solid rgb(var(--c-ink-rgb) / .06)" : "0", opacity: done || t.status === "running" ? 1 : 0.4, transition: "opacity .4s ease" }}>
              <span aria-hidden="true" style={{ width: "34px", height: "34px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", font: "600 var(--t-micro)/1 'Geist Mono', monospace", background: bg, color: fg }}>{ext}</span>
              <span style={{ flex: "1", minWidth: 0, fontSize: "var(--t-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
              {t.status === "running" ? <span aria-label="Leyendo" style={{ width: "16px", height: "16px", flex: "none", borderRadius: "var(--r-circle)", border: `2px solid color-mix(in oklab, ${color} 25%, transparent)`, borderTopColor: color, animation: "spin .8s linear infinite" }} /> : null}
              {done ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-ok-ink)", animation: "fade .3s ease-out" }}>{pages}</span> : null}
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
          {narration ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{narration}</span> : null}
        </span>
        {onStop ? <button type="button" className="chat-stop" onClick={onStop} title="Parar (Esc)" style={{ flex: "none", height: "30px", padding: "0 12px", border: "0", borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text-3)", fontSize: "var(--t-meta)", fontWeight: 500, cursor: "pointer" }}>{"Parar"}</button> : null}
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
      <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{narration || headline(command, bots)}</span>
      <div style={{ padding: "14px 16px", background: "var(--c-sunken)", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", display: "flex", flexDirection: "column", gap: "10px", font: "400 var(--t-meta)/1.6 'Geist Mono', monospace", color: "var(--c-text)", overflow: "hidden" }}>
        <span style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <span style={{ flex: "1", minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.command || c.program || "…"}{shown ? null : <span aria-hidden="true" style={{ display: "inline-block", width: "8px", height: "17px", marginLeft: "6px", verticalAlign: "-3px", background: "var(--c-text)", animation: "caret 1s steps(1) infinite" }} />}</span>
          <button type="button" className="rm-focus" aria-expanded={shown ? "true" : "false"} onClick={() => setShown((v) => !v)}
            style={{ flex: "none", height: "30px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .08)", color: "var(--c-text)", cursor: "pointer", font: "600 var(--t-caption)/1 'Geist', sans-serif" }}>{shown ? "Ocultar la salida" : "Ver la salida"}</button>
        </span>
        {shown ? <CommandOutput stepId={stepId} callId={command.id} running /> : null}
      </div>
    </div>
  );
}

export { BotPresence };
