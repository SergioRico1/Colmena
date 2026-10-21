import React from "react";
import { botById } from "../../lib/bots.js";
import { BotAvatar, CheckIcon, MilestoneBar, STATUS_LABEL, dueInText, dueLabel, mono, progressLine } from "./shared.jsx";

/** Card of the goals list: title, why, owner, progress by milestones, next milestone and date. */
export default function GoalCard({ goal, bots }) {
  const owner = botById(bots, goal.ownerBotId) || botById(bots, "atlas");
  const done = goal.status === "done";
  const paused = goal.status === "paused";
  const next = goal.next;
  const allDone = goal.progress.milestonesTotal > 0 && goal.progress.milestonesDone === goal.progress.milestonesTotal;
  return (
    <a href={`/objetivos/${encodeURIComponent(goal.id)}`} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "18px", background: "#FFFFFF", border: "0", borderRadius: "26px", ...(paused || done ? { opacity: "0.85" } : {}) }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minHeight: "22px" }}>
        <span style={mono}>{`Objetivo · ${STATUS_LABEL[goal.status] || "En marcha"}`}</span>
        {done ? (
          <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}><CheckIcon />{"Conseguido"}</span>
        ) : goal.overdueCount ? (
          <span style={{ padding: "3px 8px", background: "#FFF4D1", borderRadius: "6px", fontWeight: "600", fontSize: "13px" }}>{goal.overdueCount === 1 ? "1 hito vencido" : `${goal.overdueCount} hitos vencidos`}</span>
        ) : goal.hasDraft ? (
          <span style={{ padding: "3px 8px", background: "#FFF4D1", borderRadius: "6px", fontWeight: "600", fontSize: "13px" }}>{"Atlas propone hitos"}</span>
        ) : null}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <strong style={{ font: "600 20px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", letterSpacing: "-0.01em" }}>{goal.title}</strong>
        {goal.why ? <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#5C606C", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{goal.why}</span> : null}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <MilestoneBar milestones={goal.milestones} />
        <span style={{ fontSize: "13px", color: "#5C606C" }}>{progressLine(goal.progress)}</span>
      </span>
      {next ? (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 12px", background: next.overdue ? "#FFF4D1" : "#F6F6F3", borderRadius: "10px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
            <span style={{ ...mono, fontSize: "11px" }}>{"Próximo hito"}</span>
            <span style={{ fontSize: "14px", fontWeight: "600", lineHeight: "1.3" }}>{next.title}</span>
          </span>
          {next.dueAt ? <span style={{ flex: "none", font: "500 12px/1 'Geist Mono', monospace", color: next.overdue ? "#12131A" : "#5C606C", fontWeight: next.overdue ? "700" : "500" }}>{next.overdue ? `Vencido · ${dueLabel(next.dueAt)}` : dueLabel(next.dueAt)}</span> : null}
        </span>
      ) : (
        <span style={{ padding: "10px 12px", background: "#F6F6F3", borderRadius: "10px", fontSize: "13px", lineHeight: "1.4", color: "#5C606C" }}>
          {allDone ? (done ? "Todos los hitos hechos." : "Todos los hitos hechos. ¿Lo das por conseguido?") : "Aún no tiene hitos. Ábrelo y pide a Atlas que los proponga."}
        </span>
      )}
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#3D404A" }}>
          <BotAvatar bot={owner} size={24} />
          {owner ? `Coordina ${owner.name}` : ""}
        </span>
        <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{goal.dueAt ? `Para ${dueInText(goal.dueAt)}` : "Sin fecha"}</span>
      </span>
    </a>
  );
}
