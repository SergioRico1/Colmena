import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, Wrench } from "lucide-react";
import { workSteps, workSummary } from "../../../lib/worklog.js";
import { Detail, ICONS, Status, collapseRepeats, groupTools, headline } from "../../room/ToolCards.jsx";

// Colmena 2.0 work log (T3 Code WorkLog): what a bot did in a row of tool calls reads as one
// quiet line in plain words — «Ha leído 5 correos y editado 2 archivos». Unfolding it shows
// each step; unfolding a step shows its detail, and a command that is still running streams
// its output there (server/command-output.mjs), only while that row is open.

const LINE = { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", minHeight: "28px", padding: "0 10px 0 0", border: 0, borderRadius: "999px", background: "transparent", fontSize: "14px", lineHeight: "1.4", color: "#5C606C", textAlign: "left" };
const MONO = { font: "400 12.5px/1.55 'Geist Mono', monospace" };

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
      style={{ ...MONO, margin: 0, maxHeight: "240px", overflow: "auto", padding: "12px 14px", borderRadius: "14px", background: "#12131A", color: "#E6E7EC", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {text || <span style={{ color: "#8A8D96" }}>{live ? "Aún no ha escrito nada." : "No escribió nada."}</span>}
      {live ? <span aria-hidden="true" style={{ display: "inline-block", width: "7px", height: "14px", marginLeft: "2px", verticalAlign: "-2px", background: "#FFC93C", animation: "caret 1s steps(1) infinite" }} /> : null}
    </pre>
  );
}

function WorkStep({ tool, bots, stepId, onOpenArtifact }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[tool.card?.type] || Wrench;
  const command = tool.card?.type === "command";
  const detail = open ? <Detail tool={tool} bots={bots} onOpenArtifact={onOpenArtifact} liveOutput={command && tool.status === "running" ? <CommandOutput stepId={stepId} callId={tool.id} running /> : null} /> : null;
  return (
    <li data-tool={tool.name} data-status={tool.status} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <button type="button" className="rm-focus" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "34px", padding: "4px 8px", border: 0, borderRadius: "12px", background: open ? "rgba(18,19,26,.04)" : "transparent", cursor: "pointer", textAlign: "left", fontSize: "14px", color: "#2B2D36", transition: "background .15s ease" }}>
        <Icon size={15} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: tool.status === "error" ? "#B4372A" : "#5C606C" }} />
        <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {headline(tool, bots)}
          {tool.times > 1 ? <span style={{ marginLeft: "6px", font: "600 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{"×" + tool.times}</span> : null}
        </span>
        <Status tool={tool} />
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#8A8D96", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      </button>
      {open ? <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 8px 6px 33px", animation: "fade .2s ease-out" }}>{detail}</div> : null}
    </li>
  );
}

/**
 * The work of a step (or of one line of its trail) as one line that unfolds. Renders nothing
 * until something is done. `stepId` lets a running command stream its output.
 */
export default function WorkLog({ tools = [], bots = [], stepId = null, onOpenArtifact = null }) {
  const [open, setOpen] = useState(false);
  const summary = workSummary(tools);
  if (!summary) return null;
  const steps = collapseRepeats(groupTools(workSteps(tools)));
  const bad = summary.failed && !summary.steps;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", animation: "fade .4s ease-out", minWidth: 0 }}>
      <button type="button" className="rm-focus" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} title={open ? "Ocultar los pasos" : `Ver los ${steps.length} pasos`} style={{ ...LINE, cursor: "pointer" }}>
        {bad ? <CircleAlert size={14} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none", color: "#B4372A" }} /> : <Check size={14} strokeWidth={2.8} aria-hidden="true" style={{ flex: "none", color: "#0B8A5F" }} />}
        <span style={{ minWidth: 0 }}>{summary.text}</span>
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      </button>
      {open ? (
        <ol aria-label="Pasos" style={{ margin: 0, padding: "6px", listStyle: "none", display: "flex", flexDirection: "column", gap: "2px", borderRadius: "18px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.06)", animation: "rise .25s ease-out" }}>
          {steps.map((t, i) => <WorkStep key={t.id || i} tool={t} bots={bots} stepId={stepId} onOpenArtifact={onOpenArtifact} />)}
        </ol>
      ) : null}
    </div>
  );
}
