import React from "react";
import { BotPresence } from "../v2/Presence.jsx";
import { navigate } from "../../lib/router.jsx";
import { avatarStyle, initial } from "../../lib/bots.js";

// Shared pieces of «Objetivos» (Misiones › Objetivos): same visual language as Misiones/Misión.

export const STATUS_LABEL = { active: "En marcha", paused: "En pausa", done: "Conseguido" };
export const MISSION_DONE = ["completed"];
export const MISSION_WAIT = ["waiting", "awaiting_choice", "awaiting_plan", "paused", "blocked"];

export const mono = { font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" };
export const emptyText = { margin: "0", padding: "8px 6px", fontSize: "14px", lineHeight: "1.45", color: "#5C606C" };
export const card = { background: "#FFFFFF", border: "0", borderRadius: "18px" };
/** Something that waits for the person (Atlas's proposals): ink border + honey shadow. */
export const waitsForYou = { background: "#FFFFFF", border: "0", borderRadius: "26px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)" };
export const honeyBtn = { display: "flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 22px", background: "#12131A", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "15px", color: "#FFFFFF" };
export const darkBtn = { display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "12px", cursor: "pointer", fontWeight: "600", fontSize: "14px" };
export const outlineBtn = { display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 16px", background: "#FFFFFF", color: "#12131A", border: "1px solid #12131A", borderRadius: "12px", cursor: "pointer", fontWeight: "600", fontSize: "14px" };
export const smallBtn = { display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 12px", background: "#FFFFFF", color: "#12131A", border: "0", borderRadius: "9px", cursor: "pointer", fontWeight: "600", fontSize: "13px" };
export const textBtn = { height: "36px", padding: "0 10px", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", color: "#3D404A" };
export const field = { width: "100%", minHeight: "44px", padding: "10px 12px", background: "#FFFFFF", border: "0", borderRadius: "10px", fontSize: "15px", outlineColor: "#12131A" };
export const label = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600", color: "#3D404A" };
export const chip = (on) => (on
  ? { height: "38px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "19px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }
  : { height: "38px", padding: "0 14px", background: "#FFFFFF", border: "0", borderRadius: "19px", cursor: "pointer", fontSize: "14px" });
export const viewBtn = (on) => (on
  ? { height: "38px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }
  : { height: "38px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "14px" });
export const errorText = { fontSize: "13px", fontWeight: "600", color: "#B4372A" };

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** «Hoy», «Mañana», «Jue», «12 oct», «12 oct 2027» — the compact date of Misiones (no time: goals are by day). */
export function dueLabel(value) {
  if (!value) return "";
  const d = new Date(value);
  const now = new Date();
  const day = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  if (sameDay(d, now)) return "Hoy";
  if (sameDay(d, day(-1))) return "Ayer";
  if (sameDay(d, day(1))) return "Mañana";
  if (d > now && d - now < 6 * 864e5) {
    const w = d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  const opts = { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) };
  return d.toLocaleDateString("es-ES", opts).replace(".", "");
}
/** Date inside a sentence: «hoy», «mañana», «ayer», «el miércoles», «el 4 dic». */
export function dueInText(value) {
  if (!value) return "";
  const d = new Date(value);
  const now = new Date();
  const day = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  if (sameDay(d, now)) return "hoy";
  if (sameDay(d, day(1))) return "mañana";
  if (sameDay(d, day(-1))) return "ayer";
  if (d > now && d - now < 6 * 864e5) return "el " + d.toLocaleDateString("es-ES", { weekday: "long" });
  return "el " + dueLabel(value);
}
/** ISO → 'YYYY-MM-DD' in local time for <input type="date">. */
export function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const isOverdue = (m) => !m.done && !!m.dueAt && Date.parse(m.dueAt) < Date.now();
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function progressLine(p) {
  if (!p) return "";
  const parts = [p.milestonesTotal ? `${p.milestonesDone} de ${plural(p.milestonesTotal, "hito", "hitos")}` : "Sin hitos todavía"];
  if (p.missionsTotal) parts.push(`${p.missionsDone} de ${plural(p.missionsTotal, "misión terminada", "misiones terminadas")}`);
  return parts.join(" · ");
}

export function BotAvatar({ bot, size = 24 }) {
  if (!bot) return null;
  const font = bot.shape === "diamond" ? Math.round(size * 0.38) : Math.round(size * 0.44);
  return (
    <BotPresence bot={bot} size={size} />
  );
}

/** Segmented bar: one segment per milestone (black = done, honey = overdue, grey = pending). */
export function MilestoneBar({ milestones = [], height = 6 }) {
  const total = milestones.length;
  if (!total) return <span style={{ display: "block", height: height + "px", borderRadius: height / 2 + "px", background: "rgba(18,19,26,.1)" }} aria-label="Sin hitos todavía" />;
  const done = milestones.filter((m) => m.done).length;
  if (total > 14) {
    const pct = Math.round((done / total) * 100);
    return (
      <span role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`${done} de ${total} hitos hechos`} style={{ display: "block", height: height + "px", borderRadius: height / 2 + "px", background: "rgba(18,19,26,.1)", overflow: "hidden" }}>
        <span style={{ display: "block", width: pct + "%", height: "100%", background: "#12131A" }} />
      </span>
    );
  }
  return (
    <span style={{ display: "grid", gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))`, gap: "4px" }} role="img" aria-label={`${done} de ${total} ${total === 1 ? "hito hecho" : "hitos hechos"}`}>
      {milestones.map((m) => (
        <span key={m.id} style={m.done
          ? { height: height + "px", borderRadius: height / 2 + "px", background: "#12131A" }
          : isOverdue(m) ? { height: height + "px", borderRadius: height / 2 + "px", background: "#FFC93C", outline: "1.5px solid #12131A", outlineOffset: "-1.5px" }
            : { height: height + "px", borderRadius: height / 2 + "px", background: "rgba(18,19,26,.1)" }} />
      ))}
    </span>
  );
}

export function Spinner() {
  return <span aria-hidden="true" style={{ width: "14px", height: "14px", flex: "none", border: "2.5px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "colmena-spin .8s linear infinite" }} />;
}

export function SparkIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18.4 5.6l-2.1 2.1M21 12h-3M9 17h6M10 21h4M12 8a4 4 0 0 0-2 7.5V17h4v-1.5A4 4 0 0 0 12 8z" /></svg>;
}
export function CheckIcon({ size = 14, width = 2.6 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>;
}
export function FlagIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>;
}
export function PlusIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}
export function ClockIcon({ size = 12 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
}

/** View switch shared with Misiones (Tablero / Lista / Calendario / Objetivos). */
export const VIEWS = [["tablero", "Tablero"], ["lista", "Lista"], ["calendario", "Calendario"], ["objetivos", "Objetivos"]];
export function ViewSwitch({ current = "objetivos", onPick }) {
  const pick = (id) => {
    if (onPick && id !== "objetivos") return onPick(id);
    navigate(id === "objetivos" ? "/objetivos" : id === "tablero" ? "/misiones" : `/misiones?vista=${id}`);
  };
  return (
    <div role="group" aria-label="Vista" style={{ display: "flex", gap: "4px", padding: "4px", background: "#FFFFFF", border: "0", borderRadius: "12px" }}>
      {VIEWS.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={current === id ? "true" : "false"} onClick={() => pick(id)} style={viewBtn(current === id)}>{text}</button>
      ))}
    </div>
  );
}

/**
 * «Lanzar misión para este hito»: hands a draft to Inicio (sessionStorage 'colmena:draft' {text, mode})
 * and remembers the target milestone ('colmena:goal' {goalId, milestoneId}) so the mission is linked on creation.
 */
export function launchMission(goal, milestone) {
  const why = (goal.why || "").trim().replace(/[.\s]+$/, "");
  const text = `${milestone.title.trim().replace(/[.\s]+$/, "")}. Es un hito del objetivo «${goal.title}»${why ? `: ${why.charAt(0).toLowerCase() + why.slice(1)}` : ""}.`;
  try {
    sessionStorage.setItem("colmena:draft", JSON.stringify({ text, mode: "equipo" }));
    sessionStorage.setItem("colmena:goal", JSON.stringify({ goalId: goal.id, milestoneId: milestone.id }));
  } catch {}
  navigate("/?modo=equipo");
}
