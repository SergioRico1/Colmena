import React, { useState } from "react";
import { css } from "../design/css/Mision.js";
import Sidebar from "../components/Sidebar.jsx";
import { useStore, useResource, useAction } from "../lib/store.jsx";
import { post, patch, del } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { botById } from "../lib/bots.js";
import GoalForm from "../components/goals/GoalForm.jsx";
import MilestoneRow from "../components/goals/MilestoneRow.jsx";
import PlanDraft from "../components/goals/PlanDraft.jsx";
import {
  BotAvatar, CheckIcon, MilestoneBar, STATUS_LABEL, SparkIcon, Spinner, darkBtn, dueInText, errorText, field, mono, outlineBtn, plural, progressLine, smallBtn, textBtn,
} from "../components/goals/shared.jsx";

// 07b · Objetivo — milestones checklist with dates, linked missions (status + room) and Atlas's proposal.
const fmt = (n) => Number(n || 0).toLocaleString("es-ES");

/**
 * «Presupuesto»: how much this goal may spend (tokens of your ChatGPT plan, OpenClaw /goal
 * budget). The missions and automations linked to it add what they spend; once it runs out
 * they pause until you raise it.
 */
function GoalBudget({ goal, path }) {
  const b = goal.budget || { tokens: null, used: 0, percent: null, limited: false };
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(b.tokens ? String(b.tokens) : "200000");
  const save = useAction();
  const apply = async (tokens) => {
    const ok = await save.act(() => patch(path, { budgetTokens: tokens }));
    if (ok) setEditing(false);
  };
  return (
    <section aria-labelledby="presupuesto" style={{ background: "#FFFFFF", border: "1px solid " + (b.limited ? "#F2D27A" : "#DCE0E8"), borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 id="presupuesto" style={{ margin: "0", ...mono }}>{"Presupuesto"}</h2>
      {b.tokens ? (
        <>
          <span style={{ fontSize: "15px", lineHeight: "1.45" }}><strong>{fmt(b.used)}</strong>{" de " + fmt(b.tokens) + " tokens · " + (b.percent ?? 0) + " %"}</span>
          <span aria-hidden="true" style={{ height: "8px", borderRadius: "4px", background: "#EEF0F4", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: Math.min(100, b.percent || 0) + "%", background: b.limited ? "#E5484D" : (b.percent || 0) >= 80 ? "#FFC93C" : "#12131A" }} />
          </span>
          {b.limited ? <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.45", color: "#8A3A00" }}>{"Agotado: sus misiones están en pausa hasta que lo subas."}</p> : null}
        </>
      ) : (
        <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.45", color: "#4A4F5C" }}>{"Sin límite de gasto. " + (b.used ? "Lleva " + fmt(b.used) + " tokens." : "")}</p>
      )}
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); const n = Math.round(Number(String(value).replace(/\D/g, ""))); if (n >= 1000) apply(n); }} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Presupuesto en tokens" style={{ ...field, flex: "1 1 140px" }} />
          <button type="submit" disabled={save.busy} style={smallBtn}>{"Guardar"}</button>
          <button type="button" onClick={() => setEditing(false)} style={textBtn}>{"Cancelar"}</button>
          <span style={{ flexBasis: "100%", fontSize: "12px", lineHeight: "1.45", color: "#555A68" }}>{"Orientativo: una respuesta sencilla gasta unos 20.000 tokens; una investigación con muchas webs, 500.000 o más."}</span>
        </form>
      ) : (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" onClick={() => setEditing(true)} style={smallBtn}>{b.tokens ? (b.limited ? "Subir presupuesto" : "Cambiar") : "Poner un presupuesto"}</button>
          {b.tokens ? <button type="button" disabled={save.busy} onClick={() => apply(null)} style={textBtn}>{"Quitar"}</button> : null}
        </span>
      )}
      {save.error ? <span role="alert" style={errorText}>{save.error}</span> : null}
    </section>
  );
}

export default function Objetivo({ params }) {
  const id = params.id;
  const path = "/goals/" + encodeURIComponent(id);
  const { bots, missions, automations } = useStore();
  const { data: g, error, loading } = useResource(path);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const edit = useAction();
  const status = useAction();
  const remove = useAction();
  const add = useAction();
  const plan = useAction();

  const shell = (content) => (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" active="misiones" />
        <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column" }}>{content}</main>
      </div>
    </>
  );
  const crumbs = (
    <p style={{ margin: "0", ...mono }}>
      <a href="/misiones" style={{ color: "#555A68" }}>{"Misiones"}</a>
      {" / "}
      <a href="/objetivos" style={{ color: "#555A68" }}>{"Objetivos"}</a>
    </p>
  );

  if (!g) {
    return shell(
      <div style={{ padding: "28px clamp(16px, 3vw, 36px) 56px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {crumbs}
        {error ? (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "20px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px" }}>
            <strong style={{ font: "700 20px/1.1 'Bricolage Grotesque', sans-serif" }}>{"No se pudo abrir este objetivo"}</strong>
            <span style={{ fontSize: "14px", color: "#B4372A", fontWeight: "600" }}>{error}</span>
            <a href="/objetivos" style={{ fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{"Volver a Objetivos"}</a>
          </div>
        ) : <p style={{ margin: "0", fontSize: "15px", color: "#4A4F5C" }}>{loading ? "Cargando el objetivo…" : "Este objetivo no existe."}</p>}
      </div>,
    );
  }

  const owner = botById(bots, g.ownerBotId) || botById(bots, "atlas");
  const atlas = botById(bots, "atlas") || owner;
  const p = g.progress;
  const done = g.status === "done";
  const allDone = p.milestonesTotal > 0 && p.milestonesDone === p.milestonesTotal;

  const save = async (values) => {
    const ok = await edit.act(() => patch(path, values));
    if (ok) setEditing(false);
  };
  const setStatus = (value) => status.act(() => patch(path, { status: value }));
  const destroy = async () => {
    const ok = await remove.act(() => del(path));
    if (ok) navigate("/objetivos", { replace: true });
  };
  const addMilestone = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const ok = await add.act(() => post(path + "/milestones", { title: newTitle.trim(), dueAt: newDue || null }));
    if (ok) {
      setNewTitle("");
      setNewDue("");
    }
  };
  const askAtlas = () => plan.act(() => post(path + "/plan"));
  const linkedCount = g.milestones.reduce((n, m) => n + m.missions.length + m.automations.length, 0);

  const headline = (() => {
    if (done) return `Conseguido${g.doneAt ? ` ${dueInText(g.doneAt)}` : ""}. Todo lo hecho se conserva.`;
    if (g.status === "paused") return "En pausa. Nadie te recordará nada de este objetivo hasta que lo reanudes.";
    if (!p.milestonesTotal) return g.planDraft ? "Atlas ha propuesto unos hitos: elige cuáles se quedan." : "Aún no tiene hitos. Escribe el primero o pide a Atlas que los proponga.";
    if (allDone) return "Todos los hitos están hechos. ¿Lo das por conseguido?";
    const overdue = g.milestones.filter((m) => m.overdue);
    if (overdue.length) return overdue.length === 1 ? `El hito «${overdue[0].title}» está vencido. Lanza una misión o cambia su fecha.` : `${overdue.length} hitos están vencidos. Lanza una misión o cambia sus fechas.`;
    return g.next ? `Próximo hito: «${g.next.title}»${g.next.dueAt ? `, para ${dueInText(g.next.dueAt)}` : ""}.` : "";
  })();

  return shell(
    <>
      <header style={{ padding: "18px clamp(16px, 3vw, 36px) 20px", background: "#FFFFFF", borderBottom: "1px solid #DCE0E8", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
            {crumbs}
            <h1 style={{ margin: "0", font: "800 30px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{g.title}</h1>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
            {done ? (
              <span style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", background: "#E1F4EC", borderRadius: "8px", fontSize: "13px", fontWeight: "600", color: "#0B5E41" }}><CheckIcon />{"Conseguido"}</span>
            ) : g.dueAt ? <span style={{ font: "500 14px/1 'Geist Mono', monospace", color: "#555A68" }}>{`Para ${dueInText(g.dueAt)}`}</span> : null}
            {!editing ? <button type="button" onClick={() => { edit.setError(null); setEditing(true); setConfirmDelete(false); }} style={outlineBtn}>{"Editar"}</button> : null}
            {g.status === "active" ? <button type="button" disabled={status.busy} onClick={() => setStatus("paused")} style={outlineBtn}>{"Pausar"}</button> : null}
            {g.status !== "active" ? <button type="button" disabled={status.busy} onClick={() => setStatus("active")} style={outlineBtn}>{done ? "Reabrir" : "Reanudar"}</button> : null}
            {!done ? <button type="button" disabled={status.busy} onClick={() => setStatus("done")} style={allDone ? darkBtn : outlineBtn}><CheckIcon />{"Marcar como conseguido"}</button> : null}
            <button type="button" onClick={() => { setConfirmDelete(true); setEditing(false); }} style={{ ...textBtn, height: "44px", fontSize: "14px", color: "#B4372A", fontWeight: "600" }}>{"Borrar"}</button>
          </div>
        </div>
        {status.error ? <span role="alert" style={errorText}>{status.error}</span> : null}
        {confirmDelete ? (
          <div role="alertdialog" aria-labelledby="borrar-objetivo" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "12px 14px", background: "#FDE8E8", border: "1px solid #F3B4B4", borderRadius: "12px", fontSize: "14px", color: "#12131A" }}>
            <span id="borrar-objetivo" style={{ flex: "1 1 280px", lineHeight: "1.45" }}>
              <strong>{`¿Borrar «${g.title}»?`}</strong>
              {` Se quitarán ${plural(p.milestonesTotal, "hito", "hitos")}.${linkedCount ? " Las misiones y automatizaciones enlazadas se conservan." : ""}`}
            </span>
            <button type="button" disabled={remove.busy} onClick={destroy} style={{ ...smallBtn, height: "40px", background: "#B4372A", color: "#FFFFFF", border: "0" }}>{remove.busy ? "Borrando…" : "Sí, borrar"}</button>
            <button type="button" onClick={() => setConfirmDelete(false)} style={textBtn}>{"Cancelar"}</button>
            {remove.error ? <span role="alert" style={{ ...errorText, flexBasis: "100%" }}>{remove.error}</span> : null}
          </div>
        ) : null}
        {editing ? <GoalForm mode="edit" initial={g} busy={edit.busy} error={edit.error} onSubmit={save} onCancel={() => setEditing(false)} /> : null}
      </header>

      <div style={{ padding: "28px clamp(16px, 3vw, 36px) 56px", display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
        <div style={{ flex: "2 1 520px", minWidth: "0", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "620px" }}>
              <h2 style={{ margin: "0", display: "flex", alignItems: "baseline", gap: "10px", font: "800 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>
                {"Hitos"}
                <span style={{ font: "600 14px/1 'Geist Mono', monospace", color: "#555A68", letterSpacing: "0" }}>{`${p.milestonesDone}/${p.milestonesTotal}`}</span>
              </h2>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.5", color: "#4A4F5C" }}>{headline}</p>
            </div>
            {!done && !g.planDraft ? (
              <button type="button" disabled={plan.busy} onClick={askAtlas} style={{ ...outlineBtn, cursor: plan.busy ? "wait" : "pointer" }}>
                {plan.busy ? <Spinner /> : <SparkIcon />}
                {plan.busy ? "Atlas está pensando…" : p.milestonesTotal ? "Pedir a Atlas más hitos" : "Pedir a Atlas que proponga los hitos"}
              </button>
            ) : null}
          </div>
          {plan.error ? (
            <p role="alert" style={{ margin: "0", padding: "10px 14px", background: "#FDE8E8", border: "1px solid #F3B4B4", borderRadius: "12px", fontSize: "14px", color: "#8A1C1C" }}>
              {plan.error}
              {/cuenta de IA/i.test(plan.error) ? <>{" "}<a href="/ajustes/ia" style={{ fontWeight: "600", color: "#8A1C1C", textDecoration: "underline" }}>{"Abrir Cuentas de IA"}</a></> : null}
            </p>
          ) : null}

          {g.planDraft && !done ? <PlanDraft goal={g} atlas={atlas} onAgain={askAtlas} againBusy={plan.busy} /> : null}

          <section aria-label="Lista de hitos" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "4px 20px 16px" }}>
            {g.milestones.length ? (
              <ol style={{ margin: "0", padding: "0", listStyle: "none" }}>
                {g.milestones.map((m, i) => <MilestoneRow key={m.id} goal={g} milestone={m} first={i === 0} isNext={g.next?.id === m.id} missions={missions} automations={automations} />)}
              </ol>
            ) : (
              <p style={{ ...emptyStyle }}>{g.planDraft ? "Todavía no hay hitos. También puedes escribirlos tú aquí abajo." : "Todavía no hay hitos. Escribe el primero aquí abajo; si pides a Atlas que los proponga, tú decides cuáles se quedan."}</p>
            )}
            {!done ? (
              <form onSubmit={addMilestone} aria-label="Añadir un hito" style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", paddingTop: "14px", borderTop: g.milestones.length ? "1px solid #E6E8EE" : "0" }}>
                <input value={newTitle} maxLength={140} onChange={(e) => setNewTitle(e.target.value)} aria-label="Nuevo hito" placeholder="Añade un hito, por ejemplo «Elegir la plataforma»" style={{ ...field, flex: "3 1 260px" }} />
                <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} aria-label="Fecha del nuevo hito" style={{ ...field, flex: "1 1 150px" }} />
                <button type="submit" disabled={add.busy || !newTitle.trim()} style={{ ...darkBtn, opacity: newTitle.trim() ? "1" : "0.55" }}>{add.busy ? "Añadiendo…" : "Añadir hito"}</button>
                {add.error ? <span role="alert" style={{ ...errorText, flexBasis: "100%" }}>{add.error}</span> : null}
              </form>
            ) : null}
          </section>
        </div>

        <aside style={{ flex: "1 1 300px", minWidth: "0", display: "flex", flexDirection: "column", gap: "16px" }}>
          <section aria-labelledby="progreso" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h2 id="progreso" style={{ margin: "0", ...mono }}>{"Progreso"}</h2>
            <span style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <strong style={{ font: "800 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{`${p.percent ?? 0} %`}</strong>
              <span style={{ fontSize: "14px", color: "#4A4F5C" }}>{p.percent === null ? "aún sin hitos" : "de los hitos"}</span>
            </span>
            <MilestoneBar milestones={g.milestones} height={8} />
            <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#2B2D36" }}>{progressLine(p)}</span>
            {allDone && !done ? (
              <button type="button" disabled={status.busy} onClick={() => setStatus("done")} style={{ ...darkBtn, justifyContent: "center" }}><CheckIcon />{"Marcar como conseguido"}</button>
            ) : null}
          </section>
          <GoalBudget goal={g} path={path} />
          <section aria-labelledby="porque" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h2 id="porque" style={{ margin: "0", ...mono }}>{"Por qué"}</h2>
            {g.why ? <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.5" }}>{g.why}</p> : (
              <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.45", color: "#4A4F5C" }}>
                {"Aún no lo has contado. "}
                <button type="button" onClick={() => setEditing(true)} style={{ padding: "0", background: "transparent", border: "0", cursor: "pointer", fontWeight: "600", fontSize: "14px", color: "#1F4FD1" }}>{"Añadir el porqué"}</button>
              </p>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: "10px", paddingTop: "12px", borderTop: "1px solid #E6E8EE" }}>
              <BotAvatar bot={owner} size={30} />
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "14px" }}>{owner ? `Coordina ${owner.name}` : "Sin coordinador"}</strong>
                <span style={{ fontSize: "12px", color: "#555A68" }}>{owner?.id === "atlas" ? "Te avisa en su ronda si un hito vence o no hay avance en 7 días" : owner?.role || ""}</span>
              </span>
            </span>
            <span style={{ fontSize: "12px", color: "#555A68" }}>{`Estado: ${STATUS_LABEL[g.status] || g.status}`}</span>
          </section>
        </aside>
      </div>
    </>,
  );
}

const emptyStyle = { margin: "0", padding: "16px 0 4px", fontSize: "14px", lineHeight: "1.45", color: "#4A4F5C" };
