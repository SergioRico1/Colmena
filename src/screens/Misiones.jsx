import React, { useEffect, useMemo, useState } from "react";
import { BotPresence } from "../components/v2/Presence.jsx";
import { css } from "../design/css/Misiones.js";
import Shell from "../components/v2/Shell.jsx";
import { useStore, useAction } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { avatarStyle, initial, botById } from "../lib/bots.js";
import { roomUrl, missionUrl, time } from "../lib/format.js";
import { SkeletonCard } from "../components/Skeleton.jsx";
import Recap from "../components/home/Recap.jsx";

// 06 · Misiones — board / list / calendar of every mission (conversations excluded).
const WAITING = ["waiting", "awaiting_choice", "awaiting_plan", "paused", "blocked"];
const RUNNING = ["queued", "planning", "running"];
const DONE = ["completed", "cancelled"];
const RESUMABLE = ["paused", "blocked"];
const MODE_LABEL = { equipo: "equipo", debate: "debate", solo: "un bot" };
const TRIGGER_FREQ = { dia: "cada día", semana: "cada semana", vez: "una vez", correo: "al llegar un correo", archivo: "al subir un archivo", evento: "antes de un evento", sala: "al escribir en una sala", hoja: "al cambiar una hoja" };

// Templates from the mockup → draft handed to Inicio via sessionStorage 'colmena:draft' { text, mode }.
const TEMPLATES = [
  { title: "Informe para dirección", desc: "Datos, comparativa, diapositivas y resumen. 4 bots.", mode: "equipo", text: "Prepara un informe para dirección sobre [tema]: datos, comparativa, diapositivas y un resumen ejecutivo." },
  { title: "Revisar un contrato", desc: "Cláusulas a vigilar y fechas clave. 1 bot.", mode: "solo", text: "Revisa este contrato y dime qué cláusulas hay que vigilar y cuáles son las fechas clave." },
  { title: "Tres ideas de diseño", desc: "En modo debate: proponen, se critican y eliges.", mode: "debate", text: "Propón tres ideas de diseño para [qué], critícalas entre vosotros y déjame elegir." },
  { title: "Automatizar una tarea repetida", desc: "Un bot de código la convierte en script y la prueba.", mode: "solo", text: "Convierte en un script esta tarea que repito a menudo y pruébalo: [describe la tarea]." },
];

const isWaiting = (m) => WAITING.includes(m.status) || (!DONE.includes(m.status) && (m.pendingCount > 0 || m.questionCount > 0));
const columnOf = (m) => (DONE.includes(m.status) ? "done" : isWaiting(m) ? "wait" : "run");
const dueSort = (a, b) => {
  const da = a.dueAt ? Date.parse(a.dueAt) : Infinity;
  const db = b.dueAt ? Date.parse(b.dueAt) : Infinity;
  if (da !== db) return da - db;
  return Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0);
};

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** «Hoy 17:00», «Ayer», «Jue 12:30», «12 oct» — the mockup's compact date. */
function when(value, withTime = true) {
  if (!value) return "";
  const d = new Date(value);
  const now = new Date();
  const day = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const hhmm = withTime ? " " + time(value) : "";
  if (sameDay(d, now)) return "Hoy" + hhmm;
  if (sameDay(d, day(-1))) return "Ayer" + hhmm;
  if (sameDay(d, day(1))) return "Mañana" + hhmm;
  if (Math.abs(d - now) < 6 * 864e5) {
    const w = d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
    return w.charAt(0).toUpperCase() + w.slice(1) + hhmm;
  }
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
}

function names(list) {
  const n = list.map((b) => b.name);
  if (n.length <= 1) return n[0] || "";
  return n.slice(0, -1).join(", ") + " y " + n[n.length - 1];
}

function waitText(m) {
  if (m.status === "paused") return m.activityLine || "En pausa · arrástrala a «En marcha» para reanudarla";
  if (m.status === "blocked") return m.error || m.activityLine || "Bloqueada · arrástrala a «En marcha» para reintentar";
  if (m.activityLine) return m.activityLine;
  if (m.status === "awaiting_plan") return "Atlas espera que apruebes el plan";
  if (m.status === "awaiting_choice") return "Elige una de las propuestas";
  if (m.questionCount > 0) return m.questionCount === 1 ? "Tiene una pregunta para ti" : `Tiene ${m.questionCount} preguntas para ti`;
  if (m.pendingCount > 0) return m.pendingCount === 1 ? "Una cosa espera tu OK" : `${m.pendingCount} cosas esperan tu OK`;
  return m.statusLabel || "Te espera";
}

function Avatars({ bots, size = 24 }) {
  return (
    <span aria-hidden="true" style={{ display: "flex" }}>
      {bots.map((b, i) => {
        const font = b.shape === "diamond" ? 9 : i === 0 ? 11 : 10;
        const first = i === 0;
        return (
          <BotPresence key={b.id} bot={b} size={size} style={{ marginLeft: "-4px" }} />
        );
      })}
    </span>
  );
}

function Progress({ m }) {
  const total = m.progress?.total || 0;
  if (total < 2) return null;
  const done = Math.min(m.progress?.done || 0, total);
  const segs = Array.from({ length: total }, (_, i) => {
    if (i < done) return { height: "6px", borderRadius: "3px", background: "#12131A" };
    if (i === done) return isWaiting(m) ? { height: "6px", borderRadius: "3px", background: "#FFC93C", outline: "1.5px solid #12131A", outlineOffset: "-1.5px" } : { height: "6px", borderRadius: "3px", background: "repeating-linear-gradient(135deg, #12131A 0 4px, #8C91A0 4px 8px)" };
    return { height: "6px", borderRadius: "3px", background: "rgba(18,19,26,.1)" };
  });
  return (
    <span style={{ display: "grid", gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))`, gap: "4px" }} aria-label={`${done} de ${total} pasos ${done === 1 ? "hecho" : "hechos"}`}>
      {segs.map((s, i) => <span key={i} className="c-seg-fill" style={s} />)}
    </span>
  );
}

const emptyText = { margin: "0", padding: "8px 6px", fontSize: "14px", lineHeight: "1.45", color: "#5C606C" };
const chip = (on) => (on
  ? { height: "38px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "19px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }
  : { height: "38px", padding: "0 14px", background: "#FFFFFF", border: "0", borderRadius: "19px", cursor: "pointer", fontSize: "14px" });
const viewBtn = (on) => (on
  ? { height: "38px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }
  : { height: "38px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "14px" });

const VIEWS = ["tablero", "lista", "calendario"];

export default function Misiones({ query = {} }) {
  const { missions, automations, bots, ready } = useStore();
  const [view, setView] = useState(() => (VIEWS.includes(query.vista) ? query.vista : "tablero"));
  useEffect(() => {
    if (VIEWS.includes(query.vista)) setView(query.vista);
  }, [query.vista]);
  const [filter, setFilter] = useState(() => (query.guardadas ? "guardadas" : "todas"));
  useEffect(() => { if (query.guardadas) setFilter("guardadas"); }, [query.guardadas]);
  const [botId, setBotId] = useState(null);
  const [botMenu, setBotMenu] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(false);
  const [resumeMenu, setResumeMenu] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const { act, busy, error } = useAction();

  const filtered = useMemo(() => missions
    .filter((m) => !m.conversation)
    // Snoozed and archived rooms only under «Pospuestas y archivadas».
    .filter((m) => (filter === "guardadas") === !!(m.archived || (m.snoozedUntil && Date.parse(m.snoozedUntil) > Date.now())))
    .filter((m) => (filter === "mias" ? !m.automationId : filter === "bot" && botId ? [...(m.botIds || []), ...(m.chosenBotIds || [])].includes(botId) : true))
    .sort(dueSort), [missions, filter, botId]);
  const wait = filtered.filter((m) => columnOf(m) === "wait");
  const run = filtered.filter((m) => columnOf(m) === "run");
  const done = filtered.filter((m) => columnOf(m) === "done").sort((a, b) => Date.parse(b.completedAt || b.updatedAt || 0) - Date.parse(a.completedAt || a.updatedAt || 0));
  const scheduled = automations
    .filter((a) => a.enabled && (filter !== "bot" || !botId || a.botId === botId))
    .sort((a, b) => (a.nextRun ? Date.parse(a.nextRun) : Infinity) - (b.nextRun ? Date.parse(b.nextRun) : Infinity));
  const resumable = filtered.filter((m) => RESUMABLE.includes(m.status));
  const botsOf = (m) => (m.botIds || []).map((id) => botById(bots, id)).filter(Boolean);
  const pickedBot = botId ? botById(bots, botId) : null;

  const resume = (id) => act(() => post(`/missions/${id}/control`, { action: "resume" })).then(() => setResumeMenu(false));
  const startTemplate = (tpl) => {
    sessionStorage.setItem("colmena:draft", JSON.stringify({ text: tpl.text, mode: tpl.mode }));
    navigate(`/?modo=${tpl.mode}`);
  };

  // ── cards (exact markup of each column in the mockup) ──
  const waitCard = (m) => {
    const canDrag = RESUMABLE.includes(m.status);
    return (
      <a key={m.id} href={roomUrl(m)} draggable={canDrag ? "true" : "false"}
        onDragStart={canDrag ? (e) => { e.dataTransfer.setData("text/colmena-mission", m.id); e.dataTransfer.effectAllowed = "move"; setDragging(m.id); } : (e) => e.preventDefault()}
        onDragEnd={() => { setDragging(null); setOver(false); }}
        style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px", background: "#FFFFFF", border: "0", borderRadius: "14px", ...(canDrag ? { cursor: "grab" } : {}), ...(dragging === m.id ? { opacity: "0.5" } : {}) }}>
        <span style={{ fontSize: "12px", color: "#5C606C" }}>{`# ${m.room || "sin sala"} · ${MODE_LABEL[m.mode] || m.mode}`}</span>
        <strong style={{ font: "600 17px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{m.title}</strong>
        <span style={{ fontSize: "14px", lineHeight: "1.4", padding: "8px 10px", background: "#FFF4D1", borderRadius: "8px" }}>{waitText(m)}</span>
        <Recap m={m} lines={3} />
        {m.mode !== "debate" ? <Progress m={m} /> : null}
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Avatars bots={botsOf(m)} />
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{when(m.dueAt || m.updatedAt)}</span>
        </span>
      </a>
    );
  };
  const runCard = (m) => {
    const total = m.progress?.total || 0;
    const pct = total ? Math.round(((m.progress?.done || 0) / total) * 100) : 0;
    return (
      <a key={m.id} href={roomUrl(m)} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px", background: "#FFFFFF", border: "0", borderRadius: "14px" }}>
        <span style={{ fontSize: "12px", color: "#5C606C" }}>{`# ${m.room || "sin sala"} · ${MODE_LABEL[m.mode] || m.mode}`}</span>
        <strong style={{ font: "600 17px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{m.title}</strong>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}>
          <span style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: "#0B8A5F", boxShadow: "0 0 0 4px #D6F0E4" }} />
          {m.activityLine || m.statusLabel || "En marcha"}
        </span>
        {total ? (
          <span style={{ height: "6px", borderRadius: "3px", background: "rgba(18,19,26,.1)", overflow: "hidden" }} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={m.progress?.done || 0} aria-label={`${m.progress?.done || 0} de ${total} pasos`}>
            <span style={{ display: "block", width: pct + "%", height: "100%", background: "#12131A" }} />
          </span>
        ) : null}
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Avatars bots={botsOf(m)} />
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{when(m.dueAt || m.updatedAt)}</span>
        </span>
      </a>
    );
  };
  const scheduledCard = (a) => {
    const bot = botById(bots, a.botId);
    return (
      <a key={a.id} href={`/automatizaciones?id=${encodeURIComponent(a.id)}`} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", background: "#FFFFFF", border: "0", borderRadius: "14px" }}>
        <span style={{ fontSize: "12px", color: "#5C606C" }}>{`Automatización · ${TRIGGER_FREQ[a.trigger?.type] || "programada"}`}</span>
        <strong style={{ font: "600 16px/1.25 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{a.name}</strong>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {bot ? <BotPresence bot={bot} size={24} /> : <span />}
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{a.nextRun ? when(a.nextRun) : a.trigger?.sentence ? "Al ocurrir" : ""}</span>
        </span>
      </a>
    );
  };
  const doneCard = (m) => (
    <a key={m.id} href={missionUrl(m)} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px", background: "#FFFFFF", border: "0", borderRadius: "14px", opacity: "0.85" }}>
      <strong style={{ fontSize: "15px", lineHeight: "1.3" }}>{m.title}</strong>
      <Recap m={m} lines={3} />
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px", color: "#5C606C" }}>
        <span>{names(botsOf(m).filter((b) => b.id !== "atlas" || (m.botIds || []).length === 1)) || names(botsOf(m))}{m.status === "cancelled" ? " · cancelada" : ""}</span>
        <span style={{ fontFamily: "'Geist Mono', monospace" }}>{when(m.completedAt || m.updatedAt, sameDay(new Date(m.completedAt || m.updatedAt), new Date()))}</span>
      </span>
    </a>
  );

  const dropZone = (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <button type="button" aria-expanded={resumeMenu ? "true" : "false"} aria-describedby="resume-help"
        onClick={() => setResumeMenu((o) => !o)}
        onDragOver={(e) => { if (dragging || e.dataTransfer.types.includes("text/colmena-mission")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/colmena-mission") || dragging; setOver(false); setDragging(null); if (id) resume(id); }}
        style={{ minHeight: "52px", background: over ? "#FFF4D1" : "transparent", border: over ? "1.5px dashed #12131A" : "1.5px dashed #A9AEBB", borderRadius: "14px", cursor: "pointer", fontSize: "14px", color: over ? "#12131A" : "#5C606C", fontWeight: over ? "600" : "400" }}>
        {busy ? "Reanudando…" : over ? "Suelta para reanudar" : "Arrastra aquí para reanudar una pausada"}
      </button>
      <span id="resume-help" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Pulsa para elegir una misión en pausa y reanudarla sin arrastrar."}</span>
      {resumeMenu ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", background: "#FFFFFF", border: "0", borderRadius: "14px" }}>
          {resumable.length === 0 ? <p style={emptyText}>{"No hay ninguna misión en pausa ni bloqueada."}</p> : resumable.map((m) => (
            <button key={m.id} type="button" onClick={() => resume(m.id)} disabled={busy} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minHeight: "44px", padding: "0 12px", background: "#F6F6F3", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "14px", textAlign: "left" }}>
              <span style={{ minWidth: "0" }}>{m.title}</span>
              <strong style={{ flex: "none", fontSize: "13px" }}>{"Reanudar"}</strong>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <span role="alert" style={{ fontSize: "13px", fontWeight: "600", color: "#B4372A", padding: "0 6px" }}>{error}</span> : null}
    </div>
  );

  const visibleDone = showAllDone ? done : done.slice(0, 6);

  const board = (
    <div style={{ overflowX: "auto", paddingBottom: "8px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(260px, 1fr))", gap: "16px", minWidth: "1080px", alignItems: "start" }}>
        <section aria-labelledby="col1" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px", background: "#FFF4D1", border: "0", borderRadius: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px" }}>
            <h2 id="col1" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", font: "600 16px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}><span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#C98A00" }} />{"Te esperan"}</h2>
            <span style={{ font: "600 13px/1 'Geist Mono', monospace" }}>{wait.length}</span>
          </div>
          {wait.length ? wait.map(waitCard) : (ready ? <p style={emptyText}>{"Nada te espera. Todo sigue su curso."}</p> : <SkeletonCard />)}
        </section>
        <section aria-labelledby="col2" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px", background: "#EBEBE6", borderRadius: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px" }}>
            <h2 id="col2" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", font: "600 16px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}><span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#0B8A5F" }} />{"En marcha"}</h2>
            <span style={{ font: "600 13px/1 'Geist Mono', monospace" }}>{run.length}</span>
          </div>
          {run.length ? run.map(runCard) : <p style={emptyText}>{"Ningún bot trabaja en una misión ahora mismo."}</p>}
          {dropZone}
        </section>
        <section aria-labelledby="col3" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px", background: "#EBEBE6", borderRadius: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px" }}>
            <h2 id="col3" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", font: "600 16px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
              {"Programadas"}
            </h2>
            <span style={{ font: "600 13px/1 'Geist Mono', monospace" }}>{scheduled.length}</span>
          </div>
          {scheduled.length ? scheduled.map(scheduledCard) : <p style={emptyText}>{"No hay nada programado. "}<a href="/automatizaciones" style={{ fontWeight: "600", color: "#1F4FD1" }}>{"Crear una automatización"}</a></p>}
        </section>
        <section aria-labelledby="col4" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px", background: "#EBEBE6", borderRadius: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px" }}>
            <h2 id="col4" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", font: "600 16px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
              {"Terminadas"}
            </h2>
            <span style={{ font: "600 13px/1 'Geist Mono', monospace" }}>{done.length}</span>
          </div>
          {done.length ? visibleDone.map(doneCard) : <p style={emptyText}>{"Aún no ha terminado ninguna misión."}</p>}
          {done.length > 6 ? <button type="button" onClick={() => setShowAllDone((v) => !v)} style={{ padding: "6px", background: "transparent", border: "0", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1F4FD1", textAlign: "left" }}>{showAllDone ? "Ver solo las últimas" : `Ver las ${done.length - 6} anteriores`}</button> : null}
          <a href="/archivo" style={{ padding: "6px", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{"Ver lo que han hecho en el Archivo"}</a>
        </section>
      </div>
    </div>
  );

  // ── list view (same row language as «Últimas veces») ──
  const stateCell = (m) => {
    const c = columnOf(m);
    if (c === "wait") return <span style={{ padding: "3px 8px", background: "#FFF4D1", borderRadius: "6px", fontWeight: "600", fontSize: "13px" }}>{m.statusLabel || "Te espera"}</span>;
    if (c === "run") return <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#0B8A5F", boxShadow: "0 0 0 4px #D6F0E4" }} />{m.statusLabel || "En marcha"}</span>;
    return <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: m.status === "cancelled" ? "#5C606C" : "#0B6B4A", fontWeight: "600" }}>{m.status === "cancelled" ? null : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>}{m.statusLabel || (m.status === "cancelled" ? "Cancelada" : "Terminada")}</span>;
  };
  const listRows = [...wait, ...run, ...done];
  const list = (
    <section aria-label="Lista de misiones" style={{ background: "#FFFFFF", border: "0", borderRadius: "18px", padding: "6px 20px", overflowX: "auto" }}>
      {listRows.length === 0 ? <p style={{ ...emptyText, padding: "16px 0" }}>{ready ? "Aún no hay misiones. Pide algo desde Inicio o empieza con una plantilla." : "Cargando…"}</p> : null}
      {listRows.map((m, i) => (
        <div key={m.id} style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 150px 110px 90px 120px", alignItems: "center", gap: "12px", minHeight: "58px", padding: "8px 0", ...(i ? { borderTop: "1px solid rgba(18,19,26,.06)" } : {}), fontSize: "14px", minWidth: "760px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
            <a href={roomUrl(m)} style={{ fontWeight: "600", fontSize: "15px" }}>{m.title}</a>
            <span style={{ fontSize: "12px", color: "#5C606C" }}>{`# ${m.room || "sin sala"} · ${MODE_LABEL[m.mode] || m.mode}`}</span>
            <Recap m={m} lines={2} retry style={{ marginTop: "2px" }} />
          </span>
          {stateCell(m)}
          <Avatars bots={botsOf(m)} />
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{when(m.dueAt || m.completedAt || m.updatedAt)}</span>
          <a href={missionUrl(m)} style={{ fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{"Línea de tiempo"}</a>
        </div>
      ))}
    </section>
  );

  // ── calendar view (month grid) ──
  const calendar = (() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // Monday first
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const items = [
      ...filtered.map((m) => ({ key: "m" + m.id, at: m.dueAt || (DONE.includes(m.status) ? m.completedAt : null) || m.createdAt, kind: columnOf(m), title: m.title, href: columnOf(m) === "done" ? missionUrl(m) : roomUrl(m) })),
      ...scheduled.filter((a) => a.nextRun).map((a) => ({ key: "a" + a.id, at: a.nextRun, kind: "auto", title: a.name, href: `/automatizaciones?id=${encodeURIComponent(a.id)}` })),
    ].filter((x) => x.at);
    const itemStyle = {
      wait: { background: "#FFF4D1", border: "1.5px solid #12131A", fontWeight: "600" },
      run: { background: "#FFFFFF", border: "0" },
      auto: { background: "#EBEBE6", border: "1px solid #EBEBE6" },
      done: { background: "#FFFFFF", border: "0", opacity: "0.7" },
    };
    const today = new Date();
    const monthRaw = first.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    const monthLabel = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
    return (
      <section aria-label="Calendario de misiones" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div role="group" aria-label="Mes" style={{ display: "flex", gap: "4px", padding: "4px", background: "#FFFFFF", border: "0", borderRadius: "12px" }}>
            <button type="button" aria-label="Mes anterior" onClick={() => setMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1))} style={viewBtn(false)}>{"‹"}</button>
            <button type="button" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }} style={viewBtn(false)}>{"Hoy"}</button>
            <button type="button" aria-label="Mes siguiente" onClick={() => setMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1))} style={viewBtn(false)}>{"›"}</button>
          </div>
          <h2 style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{monthLabel}</h2>
        </div>
        <div style={{ overflowX: "auto", paddingBottom: "8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(120px, 1fr))", gap: "8px", minWidth: "880px" }}>
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <span key={d} style={{ padding: "0 6px", font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{d}</span>)}
            {cells.map((d) => {
              const inMonth = d.getMonth() === first.getMonth();
              const isToday = sameDay(d, today);
              const dayItems = items.filter((x) => sameDay(new Date(x.at), d));
              return (
                <div key={d.toISOString()} style={{ minHeight: "112px", padding: "8px", display: "flex", flexDirection: "column", gap: "4px", background: inMonth ? "#FFFFFF" : "#EBEBE6", border: isToday ? "2px solid #12131A" : "1px solid rgba(18,19,26,.1)", borderRadius: "12px", opacity: inMonth ? "1" : "0.7" }}>
                  <span style={{ font: `${isToday ? "700" : "500"} 12px/1 'Geist Mono', monospace`, color: isToday ? "#12131A" : "#6B6F7A" }}>{d.getDate()}</span>
                  {dayItems.map((x) => (
                    <a key={x.key} href={x.href} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 6px", borderRadius: "7px", fontSize: "12px", lineHeight: "1.3", ...itemStyle[x.kind] }}>
                      {x.kind === "run" ? <span style={{ width: "6px", height: "6px", flex: "none", borderRadius: "50%", background: "#0B8A5F" }} /> : null}
                      {x.kind === "auto" ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg> : null}
                      <span style={{ minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${time(x.at)} ${x.title}`}</span>
                    </a>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  })();

  return (
    <Shell active="hoy" extraCss={css}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
        <a href="C:/Program Files/Git/" onClick={(e) => { e.preventDefault(); navigate("C:/Program Files/Git/"); }} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", margin: "32px clamp(20px, 4vw, 48px) 0", padding: "0 14px 0 10px", alignSelf: "flex-start", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", fontWeight: "500", color: "#12131A" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          Hoy
        </a>
        <main style={{ flex: "999 1 560px", minWidth: "0", padding: "28px clamp(16px, 3vw, 36px) 48px", display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: "0", font: "600 36px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", letterSpacing: "-0.02em" }}>{"Misiones"}</h1>
              <p style={{ margin: "0", fontSize: "15px", color: "#5C606C" }}>{"Todos los encargos de todas las salas, en un mismo sitio."}</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <div role="group" aria-label="Vista" style={{ display: "flex", gap: "4px", padding: "4px", background: "#FFFFFF", border: "0", borderRadius: "12px" }}>
                {[["tablero", "Tablero"], ["lista", "Lista"], ["calendario", "Calendario"]].map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={view === id ? "true" : "false"} onClick={() => setView(id)} style={viewBtn(view === id)}>{label}</button>
                ))}
                {/* Objetivos con hitos (/objetivos) vive aquí como una vista más de Misiones. */}
                <button type="button" aria-pressed="false" onClick={() => navigate("/objetivos")} style={viewBtn(false)}>{"Objetivos"}</button>
              </div>
              <button type="button" onClick={() => navigate("/?modo=equipo")} style={{ display: "flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 22px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "15px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                {"Nueva misión"}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <button type="button" aria-pressed={filter === "todas" ? "true" : "false"} onClick={() => { setFilter("todas"); setBotMenu(false); }} style={chip(filter === "todas")}>{"Todas"}</button>
            <button type="button" aria-pressed={filter === "mias" ? "true" : "false"} onClick={() => { setFilter("mias"); setBotMenu(false); }} style={chip(filter === "mias")}>{"Encargadas por mí"}</button>
            {missions.some((m) => !m.conversation && (m.archived || (m.snoozedUntil && Date.parse(m.snoozedUntil) > Date.now()))) || filter === "guardadas"
              ? <button type="button" aria-pressed={filter === "guardadas" ? "true" : "false"} onClick={() => { setFilter("guardadas"); setBotMenu(false); }} style={chip(filter === "guardadas")}>{"Pospuestas y archivadas"}</button>
              : null}
            <span style={{ position: "relative" }}>
              <button type="button" aria-pressed={filter === "bot" ? "true" : "false"} aria-haspopup="listbox" aria-expanded={botMenu ? "true" : "false"} onClick={() => setBotMenu((o) => !o)} style={chip(filter === "bot")}>
                {filter === "bot" && pickedBot ? `Con ${pickedBot.name}` : "Con un bot concreto"}
              </button>
              {botMenu ? (
                <>
                  <button type="button" aria-label="Cerrar el menú" onClick={() => setBotMenu(false)} style={{ position: "fixed", inset: "0", zIndex: "15", background: "rgba(18,19,26,0.06)", border: "0", cursor: "default" }} />
                  <div role="listbox" aria-label="Elige un bot" style={{ position: "absolute", left: "0", top: "calc(100% + 8px)", zIndex: "22", width: "min(300px, 82vw)", background: "#FFFFFF", border: "0", borderRadius: "16px", boxShadow: "0 18px 40px rgba(18,19,26,.22)", padding: "8px", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {bots.filter((b) => b.enabled !== false).map((b) => {
                      const on = filter === "bot" && botId === b.id;
                      return (
                        <button key={b.id} type="button" role="option" aria-selected={on ? "true" : "false"} onClick={() => { setBotId(b.id); setFilter("bot"); setBotMenu(false); }} style={{ width: "100%", display: "grid", gridTemplateColumns: "34px 1fr auto", gap: "10px", alignItems: "center", minHeight: "48px", padding: "6px 10px", textAlign: "left", border: "0", borderRadius: "10px", background: on ? "#FFF4D1" : "#FFFFFF", cursor: "pointer" }}>
                          <BotPresence bot={b} size={28} />
                          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ fontSize: "14px" }}>{b.name}</strong><span style={{ fontSize: "12px", color: "#5C606C" }}>{b.role}</span></span>
                          {on ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#12131A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg> : <span />}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </span>
            <span style={{ flex: "1" }} />
            <span style={{ fontSize: "13px", color: "#5C606C" }}>{view === "calendario" ? "Por fecha de entrega" : "Ordenadas por fecha de entrega"}</span>
          </div>
          {view === "tablero" ? board : view === "lista" ? list : calendar}
          <section aria-labelledby="plantillas" style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "8px" }}>
            <h2 id="plantillas" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Empezar desde una plantilla"}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "12px" }}>
              {TEMPLATES.map((tpl) => (
                <button key={tpl.title} type="button" onClick={() => startTemplate(tpl)} style={{ padding: "16px", textAlign: "left", background: "#FFFFFF", border: "0", borderRadius: "26px", cursor: "pointer", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <strong style={{ fontSize: "15px" }}>{tpl.title}</strong>
                  <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#5C606C" }}>{tpl.desc}</span>
                </button>
              ))}
            </div>
          </section>
        </main>
      </div>
    </Shell>
  );
}
