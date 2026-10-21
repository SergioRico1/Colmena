import React, { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, Lightbulb } from "lucide-react";
import { css } from "../design/css/Mision.js";
import Sidebar from "../components/Sidebar.jsx";
import { useStore, useResource, useAction } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { avatarStyle, initial, botById } from "../lib/bots.js";
import { roomUrl, time } from "../lib/format.js";
import QuickQuestion from "../components/interaction/QuickQuestion.jsx";
import ForgetButton from "../components/interaction/Forget.jsx";

// 07 · Misión: línea de tiempo — rows per bot, bars placed on a time grid computed
// from steps[].startedAt/completedAt, handoffs from thread[], deliverables from artifacts[].
const ACTIVE = ["queued", "planning", "awaiting_plan", "running", "waiting", "awaiting_choice", "blocked"];
const WAITING_MISSION = ["waiting", "awaiting_choice", "awaiting_plan"];
const KIND_LABEL = { document: "Documento", table: "Tabla", slides: "Presentación", design: "Diseño", code: "Código", sheet: "Hoja" };
const TICKS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]; // minutes between labelled marks
const SUBS = 4; // grid columns per labelled mark (as in the mockup: 4 × 15 min per hour)

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function when(value) {
  if (!value) return "";
  const d = new Date(value);
  const now = new Date();
  if (sameDay(d, now)) return time(value);
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yest)) return "ayer " + time(value);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") + " " + time(value);
}
const names = (list) => (list.length <= 1 ? list[0] || "" : list.slice(0, -1).join(", ") + " y " + list[list.length - 1]);

function stepState(step, pendingBots) {
  const st = step.status;
  if (["completed", "done"].includes(st)) return "done";
  if (["failed", "error"].includes(st)) return "failed";
  if (["cancelled", "skipped"].includes(st)) return "skipped";
  if (["waiting", "awaiting", "question", "awaiting_user", "needs_approval"].includes(st)) return "you";
  if (pendingBots.has(step.botId) && step.startedAt) return "you";
  if (["running", "working", "active"].includes(st)) return "running";
  if (step.startedAt) return "other"; // started but held: blocked / paused / waiting for another bot
  return "pending";
}

/** Builds the time grid (start, end, columns) and places every bar. */
function buildTimeline(mission, approvals, nowMs) {
  const steps = mission.steps || [];
  const active = ACTIVE.includes(mission.status);
  const pending = approvals.filter((a) => a.missionId === mission.id && a.status === "pending");
  const pendingBots = new Set(pending.map((a) => a.botId));
  const durations = steps.filter((s) => s.startedAt && s.completedAt).map((s) => Date.parse(s.completedAt) - Date.parse(s.startedAt)).sort((a, b) => a - b);
  const est = Math.min(60 * 60e3, Math.max(60e3, durations.length ? durations[Math.floor(durations.length / 2)] : 5 * 60e3));

  const order = [];
  for (const s of steps) {
    const id = s.botId || "atlas";
    if (!order.includes(id)) order.push(id);
  }
  const rows = order.map((botId) => {
    const own = steps.filter((s) => (s.botId || "atlas") === botId);
    const bars = [];
    let cursor = 0;
    for (const s of own) {
      const state = stepState(s, pendingBots);
      if (!s.startedAt) continue;
      const start = Date.parse(s.startedAt);
      let end = s.completedAt ? Date.parse(s.completedAt) : active || state === "you" ? nowMs : Date.parse(mission.updatedAt || s.startedAt);
      if (end < start) end = start;
      const approval = state === "you" ? pending.find((a) => a.botId === botId) : null;
      bars.push({ step: s, state, start, end, since: approval?.createdAt || s.startedAt });
      cursor = Math.max(cursor, end);
    }
    for (const s of own) {
      if (s.startedAt) continue;
      const state = stepState(s, pendingBots);
      const start = Math.max(cursor, active ? nowMs : cursor || nowMs);
      bars.push({ step: s, state, start, end: start + est, projected: true });
      cursor = start + est;
    }
    return { botId, bars, lastEnd: cursor };
  });

  const all = rows.flatMap((r) => r.bars);
  let minT = all.length ? Math.min(...all.map((b) => b.start)) : nowMs;
  let maxT = all.length ? Math.max(...all.map((b) => b.end)) : nowMs + est;
  if (active) { minT = Math.min(minT, nowMs); maxT = Math.max(maxT, nowMs); }
  if (all.some((b) => b.projected)) maxT += (maxT - minT) * 0.12; // room to start projected steps after «Ahora»
  const rangeMin = Math.max(1, (maxT - minT) / 60e3);
  const tick = TICKS.find((t) => rangeMin / t <= 5) || 1440;
  const tickMs = tick * 60e3;
  // Floor on local wall-clock so hour marks land on :00.
  const offset = new Date(minT).getTimezoneOffset() * 60e3;
  const startT = Math.floor((minT - offset) / tickMs) * tickMs + offset;
  let endT = Math.ceil((maxT - offset) / tickMs) * tickMs + offset;
  if (endT <= maxT) endT += tickMs;
  if ((endT - startT) / tickMs < 3) endT = startT + 3 * tickMs;
  const nTicks = Math.round((endT - startT) / tickMs);
  const cols = nTicks * SUBS;
  const subMs = tickMs / SUBS;
  // Rounded boundaries so consecutive steps sit side by side without overlapping;
  // projected (not started) steps always begin after the «Ahora» marker.
  const nowCol = active ? Math.ceil((nowMs - startT) / subMs) : 0;
  const place = (start, end, projected) => {
    let col = Math.min(cols - 1, Math.max(0, Math.round((start - startT) / subMs)));
    let endCol = Math.max(col + 1, Math.round((end - startT) / subMs));
    if (projected && col < nowCol) { endCol += nowCol - col; col = nowCol; }
    col = Math.min(cols - 1, col);
    const span = Math.max(1, Math.min(cols - col, endCol - col));
    return { col: col + 2, span };
  };
  for (const r of rows) for (const b of r.bars) Object.assign(b, place(b.start, b.end, b.projected));
  for (const r of rows) r.lastCol = r.bars.length ? Math.max(...r.bars.map((b) => b.col + b.span)) : 2;
  const labels = Array.from({ length: nTicks }, (_, i) => ({ col: 2 + i * SUBS, label: tick >= 1440 ? new Date(startT + i * tickMs).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : time(new Date(startT + i * tickMs).toISOString()) }));
  const nowFrac = (nowMs - startT) / (endT - startT);
  return { rows, cols, nTicks, labels, nowFrac: active && nowFrac >= 0 && nowFrac <= 1 ? nowFrac : null, pendingBots };
}

const tint = (color) => `color-mix(in srgb, ${color || "#C9CCD6"} 16%, #FFFFFF)`;

function Bar({ b, bot, liveDetail }) {
  const base = { gridRow: "1", gridColumn: `${b.col} / span ${b.span}`, margin: "0 3px", minHeight: "44px", padding: b.span < 2 ? "6px 8px" : "6px 10px", borderRadius: "10px", fontSize: "13px", lineHeight: "1.25", display: "flex", alignItems: "center", minWidth: "0", overflow: "hidden" };
  const range = `${time(new Date(b.start).toISOString())}–${time(new Date(b.end).toISOString())}`;
  const title = b.step.title || "Paso";
  const tip = `${title} · ${range}`;
  if (b.state === "you") {
    return (
      <div title={tip} style={{ ...base, background: "#FFC93C", border: "2px solid #12131A", fontWeight: "600", gap: "6px", zIndex: "3" }}>
        <CircleAlert size={15} strokeWidth={2.4} aria-hidden="true" />
        {`Te espera desde ${time(b.since)}`}
      </div>
    );
  }
  if (b.state === "running") {
    return (
      <div title={tip} style={{ ...base, background: "#FFFFFF", border: "2px solid #12131A", fontWeight: "600", gap: "8px", zIndex: "3" }}>
        <span style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: "#0B8A5F", boxShadow: "0 0 0 4px #D6F0E4" }} />
        {liveDetail ? `${title} · ${liveDetail}` : title}
      </div>
    );
  }
  if (b.state === "other") return <div title={tip} style={{ ...base, background: "repeating-linear-gradient(135deg, #DCE0E8 0 6px, #F7F8FA 6px 12px)", color: "#2B2D36" }}>{title}</div>;
  if (b.state === "pending" || b.state === "skipped") return <div title={`${title} · ${b.state === "skipped" ? "cancelado" : "pendiente"}`} style={{ ...base, border: "1.5px dashed #8C91A0", color: "#4A4F5C", ...(b.state === "skipped" ? { textDecoration: "line-through" } : {}) }}>{title}</div>;
  if (b.state === "failed") return <div title={tip} style={{ ...base, background: tint(bot?.color), color: "#B4372A", fontWeight: "600" }}>{`${title} · falló`}</div>;
  return <div title={tip} style={{ ...base, background: tint(bot?.color) }}>{title}</div>;
}

export default function Mision({ params, query }) {
  const id = params.id;
  const { bots, approvals, automations, activity, settings } = useStore();
  const { data: m, error, loading } = useResource("/missions/" + encodeURIComponent(id));
  const [nowMs, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const away = (e) => { if (!e.target.closest?.("[data-mision-more]") && !e.target.closest?.("[role=dialog]")) setMoreOpen(false); };
    const key = (e) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [moreOpen]);
  const { data: learnState, setData: setLearnState } = useResource("/missions/" + encodeURIComponent(id) + "/learn");
  const learnAction = useAction();
  const [learned, setLearned] = useState(null);
  const tab = query?.tab === "entregables" ? "entregables" : "timeline";
  const learnNow = async () => {
    setLearned(null);
    setLearnState((s) => ({ ...(s || {}), learningStatus: "running" }));
    const result = await learnAction.act(() => post("/missions/" + encodeURIComponent(id) + "/learn"));
    if (result) setLearned(result);
  };
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const share = async () => {
    try {
      const m0 = m || {};
      const files = (m0.artifacts || []).map((a) => "- " + (a.title || "Entregable")).join("\n");
      const text = [`# ${m0.title || "Misión"}`, m0.room ? `Sala #${m0.room}` : "", m0.result ? "\n" + m0.result : "", files ? "\n## Entregables\n" + files : ""].filter(Boolean).join("\n");
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("error");
    }
    setTimeout(() => setCopied(false), 2500);
  };

  const shell = (content) => (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" active="misiones" />
        <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column" }}>{content}</main>
      </div>
    </>
  );

  if (!m) {
    return shell(
      <div style={{ padding: "28px clamp(16px, 3vw, 36px) 56px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ margin: "0", font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}><a href="/misiones" style={{ color: "#555A68" }}>{"Misiones"}</a></p>
        {error ? (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "20px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px" }}>
            <strong style={{ font: "700 20px/1.1 'Bricolage Grotesque', sans-serif" }}>{"No se pudo abrir esta misión"}</strong>
            <span style={{ fontSize: "14px", color: "#B4372A", fontWeight: "600" }}>{error}</span>
            <a href="/misiones" style={{ fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{"Volver a Misiones"}</a>
          </div>
        ) : <p style={{ margin: "0", fontSize: "15px", color: "#4A4F5C" }}>{loading ? "Cargando la misión…" : "Esta misión no existe."}</p>}
      </div>,
    );
  }

  const tl = buildTimeline(m, approvals, nowMs);
  const bot = (bid) => (bid === "user" ? { name: "Tú" } : botById(bots, bid) || { id: bid, name: bid });
  const rowsBy = (state) => tl.rows.filter((r) => r.bars.some((b) => b.state === state)).map((r) => bot(r.botId).name);
  const artifacts = m.artifacts || [];
  const thread = [...(m.thread || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const missionWaits = WAITING_MISSION.includes(m.status) || m.pendingCount > 0;

  const headline = (() => {
    const you = rowsBy("you");
    if (you.length) return `Ahora mismo el cuello de botella eres tú: ${names(you)} ${you.length > 1 ? "esperan" : "espera"} tu respuesta.`;
    if (m.status === "awaiting_plan") return "Ahora mismo el cuello de botella eres tú: Atlas espera que apruebes el plan.";
    if (m.status === "awaiting_choice") return "Ahora mismo el cuello de botella eres tú: las propuestas están listas para que elijas.";
    if (missionWaits) return `Ahora mismo el cuello de botella eres tú: ${m.activityLine || "hay algo pendiente de tu OK"}.`;
    if (m.status === "paused") return "La misión está en pausa. Todo lo hecho se conserva.";
    if (m.status === "blocked") return `La misión está bloqueada${m.error ? `: ${m.error}` : "."}`;
    if (m.status === "completed") return `Terminada ${when(m.completedAt)}. ${tl.rows.length === 1 ? "Un bot ha trabajado en ella." : `${tl.rows.length} bots han trabajado en ella.`}`;
    if (m.status === "cancelled") return "La misión se canceló. Lo que ya estaba hecho se conserva.";
    const running = rowsBy("running");
    const other = rowsBy("other");
    if (running.length) return `Trabajan ahora ${names(running)}${other.length ? `; ${names(other)} ${other.length > 1 ? "esperan" : "espera"} a otro bot` : ""}.`;
    return m.activityLine || "Atlas está preparando el plan; la línea de tiempo aparecerá en cuanto empiecen.";
  })();

  const pendingDeliverables = (m.steps || []).filter((s) => ["synthesis", "solo"].includes(s.kind) && !["completed", "done", "cancelled", "skipped"].includes(s.status));
  const deliverables = (
    <section aria-labelledby="entregables" style={{ flex: tab === "entregables" ? "1 1 100%" : "1 1 380px", minWidth: "0", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 id="entregables" style={{ margin: "0 0 4px", font: "700 20px/1.1 'Bricolage Grotesque', sans-serif" }}>{"Entregables"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "12px" }}>
        {artifacts.map((a) => (
          <a key={a.id} href={`/api/artifacts/${encodeURIComponent(a.id)}/download`} download aria-label={`Descargar ${a.title}`} style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ font: "500 12px/1 'Geist Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", color: "#555A68" }}>{`${KIND_LABEL[a.kind] || "Archivo"} · ${bot(a.botId).name}`}</span>
            <strong style={{ fontSize: "15px" }}>{a.title}</strong>
            {a.status === "final" ? (
              <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}>
                <Check size={14} strokeWidth={2.6} aria-hidden="true" />
                {"Listo"}{a.format ? ` · .${a.format}` : ""}
              </span>
            ) : <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{a.status === "en curso" ? "En curso" : `Borrador${a.version > 1 ? ` · versión ${a.version}` : ""}`}</span>}
          </a>
        ))}
        {pendingDeliverables.map((s) => (
          <div key={s.id} style={{ background: "transparent", border: "1.5px dashed #A9AEBB", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ font: "500 12px/1 'Geist Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", color: "#555A68" }}>{`Entrega · ${bot(s.botId || "atlas").name}`}</span>
            <strong style={{ fontSize: "15px" }}>{s.title}</strong>
            <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{s.startedAt ? "En curso" : "Pendiente"}</span>
          </div>
        ))}
        {artifacts.length + pendingDeliverables.length === 0 ? (
          <div style={{ background: "transparent", border: "1.5px dashed #A9AEBB", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <strong style={{ fontSize: "15px" }}>{"Aún no hay entregables"}</strong>
            <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{"Aparecerán aquí, y en la Biblioteca, en cuanto los bots terminen."}</span>
          </div>
        ) : null}
      </div>
    </section>
  );

  const nextAuto = (bid) => {
    const today = new Date(nowMs);
    return automations.filter((a) => a.botId === bid && a.enabled && a.nextRun && sameDay(new Date(a.nextRun), today) && Date.parse(a.nextRun) > nowMs).sort((a, b) => Date.parse(a.nextRun) - Date.parse(b.nextRun))[0];
  };
  const active = ACTIVE.includes(m.status);
  const gridCols = `168px repeat(${tl.cols}, minmax(0, 1fr))`;
  const majorPct = (100 / tl.nTicks).toFixed(4);
  const minorPct = (100 / tl.cols).toFixed(4);

  return shell(
    <>
      <header style={{ padding: "18px clamp(16px, 3vw, 36px) 0", background: "#FFFFFF", borderBottom: "1px solid #DCE0E8", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
            <p style={{ margin: "0", font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>
              <a href="/misiones" style={{ color: "#555A68" }}>{"Misiones"}</a>
              {" / "}
              <a href={roomUrl(m)} style={{ color: "#555A68" }}>{m.room ? "#" + m.room : "Sala"}</a>
            </p>
            <h1 style={{ margin: "0", font: "800 30px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{m.title}</h1>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
            {m.status === "completed" && m.completedAt ? <span style={{ font: "500 14px/1 'Geist Mono', monospace", color: "#555A68" }}>{`Entregada ${when(m.completedAt)}`}</span>
              : m.dueAt ? <span style={{ font: "500 14px/1 'Geist Mono', monospace", color: "#555A68" }}>{`Entrega prevista ${when(m.dueAt)}`}</span> : null}
            <QuickQuestion mission={m} bots={bots} buttonStyle={{ height: "44px", padding: "0 16px", borderRadius: "12px", fontWeight: "600" }} />
            <span data-mision-more="" style={{ position: "relative", display: "flex" }}>
              <button type="button" aria-haspopup="menu" aria-expanded={moreOpen ? "true" : "false"} onClick={() => setMoreOpen(!moreOpen)} title="Aprendizaje de los bots" style={{ display: "flex", alignItems: "center", gap: "6px", height: "44px", padding: "0 14px", background: "#FFFFFF", color: "#12131A", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>
                {"Más"}
                <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" style={{ transform: moreOpen ? "rotate(180deg)" : "none" }} />
              </button>
              {moreOpen ? (
                <div role="menu" aria-label="Más acciones" style={{ position: "absolute", right: "0", top: "calc(100% + 6px)", zIndex: 20, minWidth: "280px", padding: "6px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", boxShadow: "0 14px 36px -10px rgba(18,19,26,0.32)", display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ padding: "6px 12px 4px", font: "500 11px/1.2 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{"Aprendizaje"}</span>
                  {(() => {
                    const running = learnAction.busy || learnState?.learningStatus === "running";
                    const busyMission = ["queued", "running", "planning"].includes(m.status);
                    const off = settings.learning === false;
                    const title = off ? "El aprendizaje está desactivado en Ajustes › Espacio" : busyMission ? "Podrás pedirlo cuando la misión termine" : "Los bots revisan esta misión y proponen recuerdos y mejoras de sus habilidades";
                    return (
                      <button type="button" onClick={() => { if (!busyMission && !off) learnNow(); }} aria-disabled={running || busyMission || off ? "true" : undefined} disabled={running} title={title} role="menuitem" style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", padding: "0 12px", background: "transparent", color: "#12131A", border: "0", borderRadius: "8px", cursor: running ? "wait" : busyMission || off ? "not-allowed" : "pointer", fontSize: "14px", textAlign: "left", opacity: busyMission || off ? 0.55 : 1 }}>
                        {running ? <span aria-hidden="true" style={{ width: "14px", height: "14px", border: "2.5px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "colmena-spin .8s linear infinite" }} /> : <Lightbulb size={15} strokeWidth={2} aria-hidden="true" />}
                        {running ? "Aprendiendo…" : "Aprende de esta misión"}
                      </button>
                    );
                  })()}
                  {["queued", "running", "planning"].includes(m.status) ? null : <ForgetButton missionId={m.id} title={m.title} variant="menu" />}
                </div>
              ) : null}
            </span>
            <button type="button" onClick={share} aria-live="polite" style={{ height: "44px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "12px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>
              {copied === "ok" ? "Resumen copiado" : copied === "error" ? "No se pudo copiar" : "Copiar resumen"}
            </button>
          </div>
        </div>
        {(() => {
          const summary = learned || (learnState?.learningStatus === "completed" ? learnState.learning : null);
          const failed = learnAction.error || (learnState?.learningStatus === "failed" ? learnState.learningError : null);
          if (failed) return <p role="alert" style={{ margin: "0", padding: "10px 14px", background: "#FDE8E8", border: "1px solid #F3B4B4", borderRadius: "12px", fontSize: "14px", color: "#8A1C1C" }}>{`No se pudo aprender de esta misión: ${failed}`}</p>;
          if (!summary) return null;
          const memories = Array.isArray(summary.memories) ? summary.memories.length : summary.memories || 0;
          const parts = [];
          if (summary.skill) parts.push(`${summary.skill.status === "active" ? "ha mejorado" : "propone"} la habilidad «${summary.skill.name}»${summary.skill.status === "pending" ? " (revísala en la Bandeja)" : ""}`);
          if (memories) parts.push(memories === 1 ? "ha guardado 1 recuerdo por revisar" : `ha guardado ${memories} recuerdos por revisar`);
          if (summary.soul) parts.push("propone un cambio en su personalidad");
          const text = summary.status === "skipped" ? "No había nada nuevo que aprender." : parts.length ? "Aprendido: " + parts.join(", ") + "." : "Revisada: no había nada nuevo que guardar.";
          return <p role="status" style={{ margin: "0", padding: "10px 14px", background: "#E1F4EC", border: "1px solid #A8DCC5", borderRadius: "12px", fontSize: "14px", color: "#0B5E41" }}>{text}</p>;
        })()}
        <div role="tablist" aria-label="Vistas de la sala" style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          <a href={roomUrl(m)} role="tab" aria-selected="false" style={{ display: "flex", alignItems: "center", height: "44px", padding: "0 14px", borderBottom: "3px solid transparent", color: "#555A68", fontSize: "14px" }}>{"Conversación"}</a>
          <a href={`/misiones/${encodeURIComponent(id)}`} role="tab" aria-selected={tab === "timeline" ? "true" : "false"} style={tab === "timeline" ? { display: "flex", alignItems: "center", height: "44px", padding: "0 14px", borderBottom: "3px solid #12131A", fontWeight: "600", fontSize: "14px" } : { display: "flex", alignItems: "center", height: "44px", padding: "0 14px", borderBottom: "3px solid transparent", color: "#555A68", fontSize: "14px" }}>{"Línea de tiempo"}</a>
          <a href={`/misiones/${encodeURIComponent(id)}?tab=entregables`} role="tab" aria-selected={tab === "entregables" ? "true" : "false"} style={tab === "entregables" ? { display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", borderBottom: "3px solid #12131A", fontWeight: "600", fontSize: "14px" } : { display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", borderBottom: "3px solid transparent", color: "#555A68", fontSize: "14px" }}>
            {"Entregables"}
            <span style={{ font: "500 12px/1 'Geist Mono', monospace", padding: "3px 6px", background: "#EEF0F4", borderRadius: "6px" }}>{artifacts.length}</span>
          </a>
        </div>
      </header>
      <div style={{ padding: "28px clamp(16px, 3vw, 36px) 56px", display: "flex", flexDirection: "column", gap: "28px" }}>
        {tab === "entregables" ? <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>{deliverables}</div> : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "640px" }}>
                <h2 style={{ margin: "0", font: "800 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>{"Quién hace qué, y quién espera a quién"}</h2>
                <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.5", color: "#4A4F5C" }}>{headline}</p>
              </div>
              <ul aria-label="Leyenda" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexWrap: "wrap", gap: "14px", fontSize: "13px" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: "26px", height: "14px", borderRadius: "4px", background: "#D6DAE3" }} />{"Hecho"}</li>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: "26px", height: "14px", borderRadius: "4px", background: "#FFFFFF", border: "2px solid #12131A" }} />{"En curso"}</li>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: "26px", height: "14px", borderRadius: "4px", background: "repeating-linear-gradient(135deg, #DCE0E8 0 4px, #F7F8FA 4px 8px)" }} />{"Espera a otro bot"}</li>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: "26px", height: "14px", borderRadius: "4px", background: "#FFC93C", border: "2px solid #12131A" }} />{"Te espera"}</li>
                <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: "26px", height: "14px", borderRadius: "4px", border: "1.5px dashed #8C91A0" }} />{"Pendiente"}</li>
              </ul>
            </div>
            <section aria-label="Línea de tiempo por bot" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", overflowX: "auto" }}>
              <div style={{ position: "relative", minWidth: "980px", padding: "8px 0 12px" }}>
                <div aria-hidden="true" style={{ position: "absolute", left: "168px", right: "0", top: "0", bottom: "0", backgroundImage: `repeating-linear-gradient(to right, #C9CED8 0 1px, transparent 1px ${majorPct}%), repeating-linear-gradient(to right, #EEF0F4 0 1px, transparent 1px ${minorPct}%)` }} />
                {tl.nowFrac !== null ? (
                  <div aria-hidden="true" style={{ position: "absolute", top: "0", bottom: "0", left: `calc(168px + (100% - 168px) * ${tl.nowFrac.toFixed(4)})`, width: "2px", background: "#12131A", zIndex: "2" }}>
                    <span style={{ position: "absolute", top: "8px", ...(tl.nowFrac > 0.85 ? { right: "6px" } : { left: "6px" }), whiteSpace: "nowrap", padding: "4px 8px", background: "#12131A", color: "#FFFFFF", borderRadius: "6px", font: "600 12px/1 'Geist Mono', monospace" }}>{`Ahora ${time(new Date(nowMs).toISOString())}`}</span>
                  </div>
                ) : null}
                <div style={{ position: "relative", display: "grid", gridTemplateColumns: gridCols, height: "44px", alignItems: "end", paddingBottom: "6px", font: "500 12px/1 'Geist Mono', monospace", color: "#555A68" }}>
                  <span />
                  {tl.labels.map((l) => <span key={l.col} style={{ gridColumn: `${l.col} / span ${Math.min(SUBS, tl.cols + 2 - l.col)}`, paddingLeft: "6px" }}>{l.label}</span>)}
                </div>
                {tl.rows.length === 0 ? (
                  <div style={{ position: "relative", display: "grid", gridTemplateColumns: gridCols, alignItems: "center", minHeight: "68px", borderTop: "1px solid #E6E8EE" }}>
                    <span />
                    <div style={{ gridRow: "1", gridColumn: `2 / span ${tl.cols}`, margin: "0 3px", fontSize: "13px", color: "#555A68", paddingLeft: "10px" }}>{m.status === "cancelled" ? "La misión se canceló antes de empezar." : "Atlas está preparando el plan. Los bots aparecerán aquí en cuanto empiecen."}</div>
                  </div>
                ) : null}
                {tl.rows.map((r) => {
                  const b = botById(bots, r.botId) || { id: r.botId, name: r.botId, color: "#C9CCD6", shape: "circle" };
                  const busy = r.bars.some((x) => ["running", "you", "other", "pending"].includes(x.state));
                  const live = activity[r.botId]?.mission === m.id ? activity[r.botId]?.detail : null;
                  const auto = !busy && active ? nextAuto(r.botId) : null;
                  const freeCol = Math.max(r.lastCol, tl.nowFrac !== null ? 2 + Math.ceil(tl.nowFrac * tl.cols) : r.lastCol);
                  return (
                    <div key={r.botId} style={{ position: "relative", display: "grid", gridTemplateColumns: gridCols, alignItems: "center", minHeight: "68px", borderTop: "1px solid #E6E8EE" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 16px", minWidth: "0" }}>
                        <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", ...avatarStyle(b, 30), font: `800 ${b.shape === "diamond" ? 12 : 13}px/1 'Bricolage Grotesque', sans-serif` }}>{initial(b)}</span>
                        <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                          <strong style={{ fontSize: "14px" }}>{b.name}</strong>
                          <span style={{ fontSize: "12px", color: "#555A68", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.role || ""}</span>
                        </span>
                      </div>
                      {r.bars.map((bar) => <Bar key={bar.step.id} b={bar} bot={b} liveDetail={bar.state === "running" ? live : null} />)}
                      {!busy && active && freeCol < tl.cols + 2 ? (
                        <div style={{ gridRow: "1", gridColumn: `${freeCol} / ${tl.cols + 2}`, margin: "0 3px", fontSize: "13px", color: "#555A68", paddingLeft: "10px" }}>
                          {auto ? `Libre · vuelve a las ${time(auto.nextRun)} a ${auto.name.charAt(0).toLowerCase() + auto.name.slice(1)}` : b.status === "trabaja" ? "Libre aquí · trabaja en otra misión" : "Libre"}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
              <section aria-labelledby="traspasos" style={{ flex: "1 1 380px", minWidth: "0", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <h2 id="traspasos" style={{ margin: "0 0 10px", font: "700 20px/1.1 'Bricolage Grotesque', sans-serif" }}>{"Traspasos"}</h2>
                {thread.length === 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: "12px", padding: "12px 0", borderTop: "1px solid #E6E8EE", fontSize: "14px", lineHeight: "1.45", color: "#4A4F5C" }}>
                    <span />
                    <span>{"Todavía no se han pasado nada entre ellos."}</span>
                  </div>
                ) : null}
                {thread.map((h, i) => {
                  const from = bot(h.from).name;
                  const to = h.to ? bot(h.to).name : null;
                  const forYou = h.to === "user" && missionWaits && i === thread.map((x) => x.to).lastIndexOf("user");
                  if (forYou) {
                    return (
                      <div key={h.id} style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: "12px", padding: "12px", margin: "4px -12px", borderRadius: "12px", background: "#FFF4D1", fontSize: "14px", lineHeight: "1.45" }}>
                        <span style={{ font: "500 13px/20px 'Geist Mono', monospace", color: "#4A4F5C" }}>{time(h.at)}</span>
                        <span>
                          <strong>{`${from} → Tú`}</strong>
                          <br />
                          {h.text + " "}
                          <a href={roomUrl(m)} style={{ fontWeight: "600", textDecoration: "underline" }}>{"Responder"}</a>
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={h.id} style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: "12px", padding: "12px 0", borderTop: "1px solid #E6E8EE", fontSize: "14px", lineHeight: "1.45" }}>
                      <span style={{ font: "500 13px/20px 'Geist Mono', monospace", color: "#555A68" }}>{time(h.at)}</span>
                      <span>
                        <strong>{to ? `${from} → ${to}` : from}</strong>
                        <br />
                        {h.text}
                      </span>
                    </div>
                  );
                })}
              </section>
              {deliverables}
            </div>
          </>
        )}
      </div>
    </>,
  );
}
