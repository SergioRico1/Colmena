import React, { useState } from "react";
import { post, patch, del } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { roomUrl } from "../../lib/format.js";
import {
  CheckIcon, ClockIcon, MISSION_DONE, MISSION_WAIT, dueLabel, errorText, field, isOverdue, launchMission, smallBtn, textBtn, toDateInput, Spinner,
} from "./shared.jsx";

function MissionDot({ status }) {
  if (MISSION_DONE.includes(status)) return <span style={{ display: "flex", color: "#0B6B4A" }}><CheckIcon size={13} /></span>;
  if (MISSION_WAIT.includes(status)) return <span style={{ width: "8px", height: "8px", flex: "none", borderRadius: "2px", background: status === "blocked" ? "#E5484D" : "#FFC93C", outline: "1.5px solid #12131A", outlineOffset: "-1.5px" }} />;
  if (status === "cancelled") return <span style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", border: "1.5px solid #8C91A0" }} />;
  return <span style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: "#0B8A5F", boxShadow: "0 0 0 4px #D6F0E4" }} />;
}

/** One milestone of the checklist: tick, date, linked missions/automations and its actions. */
export default function MilestoneRow({ goal, milestone: m, first, isNext = false, missions, automations }) {
  const { act, busy, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [due, setDue] = useState(toDateInput(m.dueAt));
  const [confirm, setConfirm] = useState(false);
  const [linking, setLinking] = useState(false);
  const [pick, setPick] = useState("");
  const base = `/goals/${encodeURIComponent(goal.id)}/milestones/${encodeURIComponent(m.id)}`;
  const overdue = isOverdue(m);
  const closed = goal.status === "done";

  const toggle = () => act(() => patch(base, { done: !m.done }));
  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await act(() => patch(base, { title: title.trim(), dueAt: due || null }));
    if (ok) setEditing(false);
  };
  const remove = () => act(() => del(base));
  const link = async (e) => {
    e.preventDefault();
    if (!pick) return;
    const [kind, value] = [pick.slice(0, 1), pick.slice(2)];
    const ok = await act(() => post(`/goals/${encodeURIComponent(goal.id)}/link`, { [kind === "m" ? "missionId" : "automationId"]: value, milestoneId: m.id }));
    if (ok) {
      setLinking(false);
      setPick("");
    }
  };
  const unlink = (body) => act(() => post(`/goals/${encodeURIComponent(goal.id)}/link`, { ...body, milestoneId: m.id, unlink: true }));

  // Fresher mission data from the global store (status line), falling back to the detail payload.
  const linked = m.missions.map((x) => ({ ...x, ...(missions.find((s) => s.id === x.id) || {}) }));
  const autos = m.automations.map((x) => ({ ...x, ...(automations.find((s) => s.id === x.id) || {}) }));
  const candidatesM = missions.filter((x) => !x.conversation && x.status !== "cancelled" && !m.missionIds.includes(x.id))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)).slice(0, 40);
  const candidatesA = automations.filter((x) => !m.automationIds.includes(x.id));

  return (
    <li style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) auto", gap: "14px", alignItems: "start", padding: "16px 0", ...(first ? {} : { borderTop: "1px solid rgba(18,19,26,.06)" }) }}>
      <button type="button" role="checkbox" aria-checked={m.done ? "true" : "false"} aria-label={m.done ? `Marcar «${m.title}» como pendiente` : `Marcar «${m.title}» como hecho`} disabled={busy || closed} onClick={toggle}
        style={{ width: "28px", height: "28px", marginTop: "1px", display: "grid", placeItems: "center", padding: "0", background: m.done ? "#12131A" : "#FFFFFF", color: "#FFFFFF", border: "0", borderRadius: "8px", cursor: closed ? "default" : "pointer" }}>
        {m.done ? <CheckIcon size={15} width={3} /> : null}
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" }}>
        {editing ? (
          <form onSubmit={save} aria-label="Editar el hito" style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} aria-label="Título del hito" autoFocus style={{ ...field, flex: "3 1 240px", minHeight: "40px" }} />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fecha del hito" style={{ ...field, flex: "1 1 150px", minHeight: "40px" }} />
            <button type="submit" disabled={busy || !title.trim()} style={{ ...smallBtn, background: "#12131A", color: "#FFFFFF", border: "0", height: "40px" }}>{"Guardar"}</button>
            <button type="button" onClick={() => { setEditing(false); setTitle(m.title); setDue(toDateInput(m.dueAt)); }} style={textBtn}>{"Cancelar"}</button>
          </form>
        ) : (
          <span style={{ fontSize: "15px", fontWeight: "600", lineHeight: "1.4", ...(m.done ? { color: "#5C606C", textDecoration: "line-through", textDecorationColor: "#8C91A0" } : {}) }}>{m.title}</span>
        )}

        {linked.length || m.automations.length ? (
          <ul aria-label="Enlazado a este hito" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
            {linked.map((x) => (
              <li key={x.id} style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "6px 6px 6px 12px", background: "#F6F6F3", borderRadius: "10px", fontSize: "13px" }}>
                <MissionDot status={x.status} />
                <a href={roomUrl(x)} style={{ flex: "1", minWidth: "0", display: "flex", flexWrap: "wrap", gap: "4px 8px", alignItems: "baseline" }}>
                  <strong style={{ fontSize: "14px" }}>{x.title}</strong>
                  <span style={{ color: "#5C606C" }}>{x.activityLine && !MISSION_DONE.includes(x.status) ? x.activityLine : x.statusLabel}</span>
                </a>
                <a href={roomUrl(x)} style={{ flex: "none", fontSize: "13px", fontWeight: "600", color: "#1F4FD1", padding: "0 6px" }}>{"Ir a la sala"}</a>
                {!closed ? <button type="button" disabled={busy} onClick={() => unlink({ missionId: x.id })} aria-label={`Desenlazar «${x.title}» de este hito`} title="Desenlazar" style={{ ...textBtn, width: "32px", height: "32px", padding: "0", fontSize: "16px", color: "#5C606C" }}>{"×"}</button> : null}
              </li>
            ))}
            {autos.map((a) => (
              <li key={a.id} style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", padding: "6px 6px 6px 12px", background: "#E4E7ED", borderRadius: "10px", fontSize: "13px" }}>
                <ClockIcon />
                <a href={`/automatizaciones?id=${encodeURIComponent(a.id)}`} style={{ flex: "1", minWidth: "0", display: "flex", flexWrap: "wrap", gap: "4px 8px", alignItems: "baseline" }}>
                  <strong style={{ fontSize: "14px" }}>{a.name}</strong>
                  <span style={{ color: "#5C606C" }}>{a.enabled === false ? "En pausa" : a.subtitle || (a.sentence ? "Cuando " + a.sentence : "Automatización")}</span>
                </a>
                {!closed ? <button type="button" disabled={busy} onClick={() => unlink({ automationId: a.id })} aria-label={`Desenlazar «${a.name}» de este hito`} title="Desenlazar" style={{ ...textBtn, width: "32px", height: "32px", padding: "0", fontSize: "16px", color: "#5C606C" }}>{"×"}</button> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {linking ? (
          <form onSubmit={link} aria-label="Enlazar a este hito" style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Misión o automatización" autoFocus style={{ ...field, flex: "1 1 260px", minHeight: "40px", cursor: "pointer" }}>
              <option value="">{candidatesM.length + candidatesA.length ? "Elige una misión o automatización…" : "No hay nada más que enlazar"}</option>
              {candidatesM.length ? <optgroup label="Misiones">{candidatesM.map((x) => <option key={x.id} value={"m:" + x.id}>{x.title}</option>)}</optgroup> : null}
              {candidatesA.length ? <optgroup label="Automatizaciones">{candidatesA.map((x) => <option key={x.id} value={"a:" + x.id}>{x.name}</option>)}</optgroup> : null}
            </select>
            <button type="submit" disabled={busy || !pick} style={{ ...smallBtn, background: "#12131A", color: "#FFFFFF", border: "0", height: "40px" }}>{"Enlazar"}</button>
            <button type="button" onClick={() => { setLinking(false); setPick(""); }} style={textBtn}>{"Cancelar"}</button>
          </form>
        ) : null}

        {confirm ? (
          <div role="alertdialog" aria-label="Quitar el hito" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "10px 12px", background: "#FDE8E8", border: "1px solid #F3B4B4", borderRadius: "10px", fontSize: "14px" }}>
            <span style={{ flex: "1 1 220px" }}>{linked.length || m.automations.length ? "¿Quitar este hito? Lo enlazado se conserva, solo deja de contar aquí." : "¿Quitar este hito?"}</span>
            <button type="button" disabled={busy} onClick={remove} style={{ ...smallBtn, background: "#B4372A", color: "#FFFFFF", border: "0" }}>{"Sí, quitar"}</button>
            <button type="button" onClick={() => setConfirm(false)} style={textBtn}>{"Cancelar"}</button>
          </div>
        ) : null}

        {!editing && !linking && !confirm && !closed ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            {!m.done ? (
              <button type="button" onClick={() => launchMission(goal, m)} style={isNext ? { ...smallBtn, background: "#12131A", color: "#FFFFFF", border: "0" } : smallBtn}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                {"Lanzar misión para este hito"}
              </button>
            ) : null}
            <button type="button" onClick={() => setLinking(true)} style={isNext ? smallBtn : textBtn}>{"Enlazar existente"}</button>
            <button type="button" onClick={() => setEditing(true)} style={textBtn}>{"Editar"}</button>
            <button type="button" onClick={() => setConfirm(true)} style={{ ...textBtn, color: "#B4372A" }}>{"Quitar"}</button>
            {busy ? <span style={{ display: "flex", color: "#5C606C" }}><Spinner /></span> : null}
          </div>
        ) : null}
        {error ? <span role="alert" style={errorText}>{error}</span> : null}
      </div>
      <span style={{ paddingTop: "6px", whiteSpace: "nowrap" }}>
        {m.done ? (
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#0B6B4A" }}>{m.doneAt ? `Hecho ${dueLabel(m.doneAt).toLowerCase() === "hoy" ? "hoy" : dueLabel(m.doneAt)}` : "Hecho"}</span>
        ) : overdue ? (
          <span style={{ padding: "3px 8px", background: "#FFF4D1", borderRadius: "6px", fontWeight: "600", fontSize: "12px", fontFamily: "'Geist Mono', monospace" }}>{`Vencido · ${dueLabel(m.dueAt)}`}</span>
        ) : m.dueAt ? (
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{dueLabel(m.dueAt)}</span>
        ) : (
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#8C91A0" }}>{"Sin fecha"}</span>
        )}
      </span>
    </li>
  );
}
