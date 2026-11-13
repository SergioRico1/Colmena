import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "../../Icon.js";
import { turnSummary, workSteps, workSummary } from "../../../lib/worklog.js";
import { Detail, Status, collapseRepeats, groupTools, headline } from "../../room/ToolCards.jsx";
import { useExpert } from "../../../lib/expert.js";
import RowBoundary from "../../RowBoundary.jsx";

// Colmena 3 work log (design/V3Chat.dc.html, V3ChatExperto.dc.html): what a bot did reads as a
// white card «✓ Hecho en 4 pasos · Ha leído 5 correos · 2 min 14 s» with the steps in plain
// words under it; in expert mode the same card lists each call with its name and arguments
// (read_file(…)) and unfolds what it gave back — detail is added, nothing moves. A command
// still running streams its output there (server/command-output.mjs), only while it is open.
// A finished turn folds to one line, «Usó 4 herramientas · 12 min» (`fold`, worklog.js
// turnSummary): today's steps are one click away, a lone quick read that only fed the answer
// shows no line at all, and a call that failed keeps it open («1 no salió»).

const MONO = { font: "400 var(--t-meta)/1.55 'Geist Mono', monospace" };

/** The live output of one running command; null (nothing asked) unless it is mounted. */
export function CommandOutput({ stepId, callId, running, fallback = null }) {
  const [text, setText] = useState(running ? "" : fallback || "");
  const [live, setLive] = useState(!!running);
  const box = useRef(null);
  const atEdge = useRef(true);
  useEffect(() => {
    if (!running || !stepId || !callId || typeof EventSource !== "function") return undefined;
    const source = new EventSource(`/api/commands/output?step=${encodeURIComponent(stepId)}&call=${encodeURIComponent(callId)}`);
    source.onmessage = (m) => {
      let f;
      try { f = JSON.parse(m.data); } catch { return; }
      if (f.type === "replace") setText(f.text || "");
      else if (f.type === "append") setText((t) => (t + (f.text || "")).slice(-16000));
      else if (f.type === "done") { setLive(false); source.close(); }
    };
    source.onerror = () => { setLive(false); source.close(); };
    return () => source.close();
  }, [running, stepId, callId]);
  // Each new piece keeps you at the end while you are there (T3 WorkLogDetails followLive).
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atEdge.current) el.scrollTop = el.scrollHeight;
  });
  if (!text && !live && !running) return null;
  return (
    <pre ref={box} onScroll={(e) => { const el = e.currentTarget; atEdge.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 4; }}
      aria-live={live ? "polite" : undefined} aria-label="Salida del programa"
      style={{ ...MONO, margin: 0, maxHeight: "240px", overflow: "auto", padding: "12px 14px", borderRadius: "var(--r-lg)", background: "#12131A", color: "#E6E7EC", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {text || <span style={{ color: "#8A8D96" }}>{live ? "Aún no ha escrito nada." : "No escribió nada."}</span>}
      {live ? <span aria-hidden="true" style={{ display: "inline-block", width: "7px", height: "14px", marginLeft: "2px", verticalAlign: "-2px", background: "var(--c-honey)", color: "var(--c-honey-ink)", animation: "caret 1s steps(1) infinite" }} /> : null}
    </pre>
  );
}

const MONO_ROW = { font: "500 var(--t-meta)/1.3 'Geist Mono', monospace" };
const TICK = { flex: "none", width: "20px", height: "20px", marginTop: "1px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "var(--c-ok-soft)", color: "var(--c-ok-ink)", fontSize: "var(--t-micro)", fontWeight: 700 };

/** «2 min 14 s» / «40 s». */
export function durationText(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return "";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}
// The main argument of a call, as a developer would write it: read_file("informe_q3.docx").
const ARG_KEYS = ["command", "query", "path", "url", "name", "title", "question", "prompt", "domain", "to", "subject"];
export function callOf(tool) {
  const c = tool.card || {};
  const key = ARG_KEYS.find((k) => c[k] != null && c[k] !== "");
  const arg = key ? String(c[key]).replace(/\s+/g, " ") : "";
  const name = tool.name || c.tool || c.type || "tool";
  return `${name}(${arg ? JSON.stringify(arg.length > 80 ? arg.slice(0, 79) + "…" : arg) : ""})`;
}
function metaOf(tool) {
  const c = tool.card || {};
  const parts = [];
  if (tool.times > 1) parts.push("×" + tool.times);
  if (c.ms != null) parts.push(String((c.ms / 1000).toFixed(1)).replace(".", ",") + " s");
  if (c.count != null) parts.push(c.count === 1 ? "1 resultado" : `${c.count} resultados`);
  if (c.pages != null) parts.push(`${c.pages} pág.`);
  if (c.exitCode != null) parts.push("exit " + c.exitCode);
  return parts.join(" · ");
}
// What the call took and gave back, for the dark box under an expert row.
function outputOf(tool) {
  const c = tool.card || {};
  if (c.output) return String(c.output);
  const rest = Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== "type" && v != null && v !== ""));
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "";
}

// One step that fails to draw becomes a muted pill; the rest of the log stays (RowBoundary.jsx).
const STEP_FAILED = "No se ha podido mostrar este paso";

/** A step in plain words (simple mode): a green tick, what it did, its detail on click. */
function WorkStep({ tool, bots, stepId, onOpenArtifact }) {
  const [open, setOpen] = useState(false);
  const command = tool.card?.type === "command";
  const bad = tool.status === "error";
  const running = tool.status === "running";
  return (
    <li data-tool={tool.name} data-status={tool.status} style={{ display: "flex", flexDirection: "column", gap: "6px", paddingTop: "10px" }}>
      <button type="button" className="rm-focus" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", gap: "12px", padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "var(--t-ui)", lineHeight: "1.45", color: "var(--c-text)" }}>
        <span aria-hidden="true" style={{ ...TICK, ...(bad ? { background: "var(--c-error-soft)", color: "var(--c-error)" } : running ? { background: "var(--c-chip)", color: "var(--c-accent-ink)" } : {}) }}>{bad ? "!" : running ? "·" : "✓"}</span>
        <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span>{headline(tool, bots)}{tool.times > 1 ? <span style={{ marginLeft: "6px", font: "600 var(--t-caption)/1 'Geist Mono', monospace", color: "var(--c-text-3)" }}>{"×" + tool.times}</span> : null}</span>
          {running || bad ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}><Status tool={tool} /></span> : null}
        </span>
      </button>
      {open ? <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 0 4px 32px", fontSize: "var(--t-meta)", color: "var(--c-text-3)", animation: "fade .2s ease-out" }}><Detail tool={tool} bots={bots} onOpenArtifact={onOpenArtifact} liveOutput={command && running ? <CommandOutput stepId={stepId} callId={tool.id} running /> : null} /></div> : null}
    </li>
  );
}

/** A call as a developer reads it (expert mode): name(arguments), what it gave back, unfolding. */
function ToolRow({ tool, stepId, first }) {
  const [open, setOpen] = useState(false);
  const bad = tool.status === "error";
  const running = tool.status === "running";
  const out = open ? outputOf(tool) : "";
  return (
    <div data-tool={tool.name} data-status={tool.status} style={{ display: "flex", flexDirection: "column", borderTop: first ? "0" : "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
      <button type="button" className="rm-focus" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} style={{ minHeight: "42px", display: "flex", alignItems: "center", gap: "10px", padding: "0 14px", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}>
        <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: bad ? "var(--c-error-soft)" : running ? "var(--c-chip)" : "var(--c-ok-soft)", color: bad ? "var(--c-error)" : running ? "var(--c-accent-ink)" : "var(--c-ok-ink)", fontSize: "var(--t-micro)", fontWeight: 700 }}>{bad ? "!" : running ? "·" : "✓"}</span>
        <span style={{ flex: "1", minWidth: 0, ...MONO_ROW, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{callOf(tool)}</span>
        <span style={{ flex: "none", font: "400 var(--t-caption)/1 'Geist Mono', monospace", color: bad ? "var(--c-error)" : "var(--c-text-3)" }}>{bad ? "error" : running ? "en curso" : metaOf(tool)}</span>
      </button>
      {open ? (
        tool.card?.type === "command" && running
          ? <div style={{ margin: "0 14px 12px 42px" }}><CommandOutput stepId={stepId} callId={tool.id} running /></div>
          : <pre style={{ margin: "0 14px 12px 42px", padding: "10px 12px", borderRadius: "var(--r-md)", background: "#12131A", color: "#E6E7EC", font: "400 var(--t-caption)/1.6 'Geist Mono', monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "260px", overflow: "auto" }}>{(bad && tool.error ? tool.error + "\n" : "") + (out || "Sin salida.")}</pre>
      ) : null}
    </div>
  );
}

/**
 * The work of a step (or of one line of its trail) as a card that unfolds. Renders nothing
 * until something is done. `stepId` lets a running command stream its output; `seconds`
 * (the turn's time) goes in its title. `fold`: the work of a finished turn, as one line.
 */
export default function WorkLog({ tools = [], bots = [], stepId = null, onOpenArtifact = null, seconds = null, fold = false }) {
  const [expert] = useExpert();
  const turn = fold ? turnSummary(tools, seconds) : null;
  // What did not work stays in sight: a folded turn with a failed call opens unfolded.
  const [open, setOpen] = useState(() => !!turn?.failed);
  const summary = workSummary(tools);
  if (!summary || turn?.quiet) return null;
  const steps = collapseRepeats(groupTools(workSteps(tools)));
  const rows = () => steps.map((t, i) => <RowBoundary key={t.id || i} label={STEP_FAILED} resetKey={t.status}><ToolRow tool={t} stepId={stepId} first={i === 0} /></RowBoundary>);
  if (expert && !turn) {
    return (
      <div role="group" aria-label="Herramientas" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid rgb(var(--c-ink-rgb) / .07)", overflow: "hidden", animation: "fade .4s ease-out", minWidth: 0 }}>
        {rows()}
      </div>
    );
  }
  const bad = summary.failed && !summary.steps;
  const time = durationText(seconds);
  // Folded: «Usó 4 herramientas» and, in grey, how long it took and what did not work.
  const [title, ...rest] = turn ? turn.text.split(" · ") : [bad ? "No salió" : steps.length === 1 ? "Hecho en 1 paso" : `Hecho en ${steps.length} pasos`, summary.text, ...(time ? [time] : [])];
  return (
    <div data-work-fold={turn ? "" : undefined} style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid rgb(var(--c-ink-rgb) / .07)", animation: "fade .4s ease-out", minWidth: 0 }}>
      <button type="button" className="rm-focus" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} title={open ? "Ocultar los pasos" : steps.length === 1 ? "Ver el paso" : `Ver los ${steps.length} pasos`}
        style={{ minHeight: "46px", display: "flex", alignItems: "center", gap: "10px", padding: "8px 16px", border: 0, background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "var(--t-ui)", color: "var(--c-text)" }}>
        <span aria-hidden="true" style={{ color: bad ? "var(--c-error)" : "var(--c-ok-ink)", fontWeight: 600 }}>{bad ? "!" : "✓"}</span>
        <span style={{ flex: "1", minWidth: 0 }}>
          <strong style={{ fontWeight: 600 }}>{title}</strong>
          {rest.length ? <span style={{ color: "var(--c-text-3)" }}>{" · " + rest.join(" · ")}</span> : null}
        </span>
        <ChevronDown size={14} color="#4A4D57" style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      </button>
      {open && turn && summary.text ? <p style={{ margin: 0, padding: "10px 16px 0", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)", fontSize: "var(--t-ui)", lineHeight: "1.45", color: "var(--c-text-3)" }}>{summary.text}</p> : null}
      {open && expert ? <div role="group" aria-label="Herramientas" style={{ display: "flex", flexDirection: "column", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)", animation: "rise .25s ease-out" }}>{rows()}</div> : null}
      {open && !expert ? (
        <ol aria-label="Pasos" style={{ margin: 0, padding: "0 16px 14px", listStyle: "none", display: "flex", flexDirection: "column", borderTop: turn && summary.text ? 0 : "1px solid rgb(var(--c-ink-rgb) / .06)", animation: "rise .25s ease-out" }}>
          {steps.map((t, i) => <RowBoundary key={t.id || i} label={STEP_FAILED} resetKey={t.status}><WorkStep tool={t} bots={bots} stepId={stepId} onOpenArtifact={onOpenArtifact} /></RowBoundary>)}
        </ol>
      ) : null}
    </div>
  );
}
