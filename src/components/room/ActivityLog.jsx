import { useState } from "react";
import { Check, ChevronDown, ChevronUp, CircleAlert } from "lucide-react";
import { plural } from "../../lib/format.js";
import { seconds } from "./common.jsx";
import ToolCards, { toolsLabel } from "./ToolCards.jsx";
import WorkingDots, { useHeld } from "./Dots.jsx";
import { shapeOf } from "../v2/Presence.jsx";
import { usePhrase } from "./working.js";

import { PLUMBING, workSummary } from "../../lib/worklog.js";

// How the bot finds its way (which accounts, which tools, its own notes): not steps for you.
export { PLUMBING };
const isPlumbing = (x) => PLUMBING.has(x?.tool || x?.name);

/** Label for the «Leyó 2 documentos · 40 s» pill. Null when there is nothing to show. */
export function activityLabel(summary, activity = [], tools = []) {
  const parts = [];
  // In plain words when it can («Ha leído 2 documentos y buscado en la web»).
  const fromTools = tools.length ? workSummary(tools)?.text || toolsLabel(tools) : null;
  const reads = summary?.reads ?? activity.filter((a) => a.verb === "leyendo").length;
  if (fromTools) parts.push(fromTools);
  else if (reads) parts.push(`Leyó ${plural(reads, "documento", "documentos")}`);
  else {
    // Real actions only: «pensando» / «escribiendo» are states, not steps.
    const steps = activity.filter((a) => a.tool || a.callId).length;
    if (steps) parts.push(plural(steps, "paso", "pasos"));
  }
  let secs = summary?.seconds;
  if (secs == null && activity.length > 1) secs = (Date.parse(activity[activity.length - 1].at) - Date.parse(activity[0].at)) / 1000;
  if (secs != null && !Number.isNaN(secs)) parts.push("hecho en " + seconds(secs));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Collapsible activity of a step (Chat mockup, Logic.toggleLog). When the step has tool calls
 * (steps[].tools) the list shows one card per tool; otherwise the plain activity lines.
 */
export default function ActivityLog({ bot = null, summary, activity: allActivity = [], tools: allTools = [], bots = [], onOpenArtifact, running = false, defaultOpen = false, status = null, startedAt = null, narration = null, seed = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const activity = allActivity.filter((a) => !isPlumbing(a));
  const tools = allTools.filter((t) => !isPlumbing(t));
  // While it works: one line with what it is doing now and how many steps so far (no clock:
  // time spent waiting for your OK is not work). Afterwards: the summary with its time.
  const steps = tools.length || activity.filter((a) => a.tool || a.callId).length;
  const held = useHeld(status, 1200);
  // Long work: the bot's own line when the narrator wrote one, else a hive phrase after 30 s.
  const phrase = usePhrase(startedAt, running && !narration, seed);
  const now = narration || held;
  const label = running && status ? now + (steps ? " · " + plural(steps, "paso", "pasos") : "") + (phrase && steps ? " · " + phrase : "") : activityLabel(summary, activity, tools);
  // What the turn cost (OpenClaw /usage): only inside the unfolded list, never in the way.
  const cost = summary?.tokens
    ? "Gastó " + summary.tokens.toLocaleString("es-ES") + " tokens" + (summary.calls > 1 ? " en " + summary.calls + " llamadas" : "") + (summary.cachedPercent ? " · " + summary.cachedPercent + " % reaprovechado de la caché" : "")
    : null;
  // Only the bot finding its way, or just seconds: nothing worth a pill.
  // Finished without real steps (it only thought and wrote): no pill at all.
  if (!label || (!running && !steps)) return null;
  const busy = running || tools.some((t) => t.status === "running");
  const failed = !busy && tools.length > 0 && tools.every((t) => t.status === "error");
  const canOpen = steps > 0;
  // V2Sala: a bot at work is its own small shape, breathing; the dots are for people typing.
  const icon = busy ? (
    bot ? <span aria-hidden="true" style={{ width: "9px", height: "9px", flex: "none", background: bot.color || "#5C606C", clipPath: shapeOf(bot).clip, borderRadius: shapeOf(bot).radius, animation: "breathe 1.4s ease-in-out infinite" }} /> : <WorkingDots />
  ) : failed ? (
    <CircleAlert size={14} strokeWidth={2.4} aria-hidden="true" style={{ color: "#B4372A" }} />
  ) : (
    <Check size={14} strokeWidth={2.4} aria-hidden="true" />
  );
  // As in OpenClaw: no pill. While it only thinks or writes, just the breathing dots; when it
  // does something, a quiet line beside them; afterwards, the same quiet summary.
  const line = { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", minHeight: "24px", padding: "0", background: "transparent", border: "0", fontSize: "13px", color: "#5C606C" };
  const quiet = running && !steps && !narration && /^(pensando|escribiendo|programando)$/i.test(String(held || "").trim());
  if (quiet) return <span role="status" aria-label={held || "Trabajando"} style={line}>{icon}{phrase ? <span key={phrase} className="c-phrase">{phrase}</span> : null}</span>;
  if (!canOpen) {
    return (
      <span role={running ? "status" : undefined} style={line}>
        {icon}
        {label}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className="rm-focus"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen(!open)}
        style={{ ...line, cursor: "pointer", borderRadius: "6px" }}
      >
        {icon}
        {label}
        {open ? <ChevronUp size={13} strokeWidth={2.2} aria-hidden="true" /> : <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" />}
      </button>
      {open ? (
        tools.length ? (
          <ToolCards tools={tools} bots={bots} onOpenArtifact={onOpenArtifact} />
        ) : (
          <ol style={{ margin: "0", padding: "12px 16px", listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "12px", fontSize: "14px", color: "#2B2D36" }}>
            {activity.map((a, i) => (
              <li key={i} style={{ display: "flex", gap: "10px" }}>
                <span style={{ font: "500 12px/20px 'Geist Mono', monospace", color: "#555A68", width: "20px", flex: "none" }}>{i + 1}</span>
                {a.text || a.verb}
              </li>
            ))}
          </ol>
        )
      ) : null}
      {open && cost ? <span style={{ fontSize: "12px", color: "#555A68" }}>{cost}</span> : null}
    </>
  );
}
