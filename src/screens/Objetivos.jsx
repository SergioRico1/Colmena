import React, { useMemo, useState } from "react";
import { css } from "../design/css/Misiones.js";
import Sidebar from "../components/Sidebar.jsx";
import { useStore, useResource, useAction } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import GoalCard from "../components/goals/GoalCard.jsx";
import GoalForm from "../components/goals/GoalForm.jsx";
import GoalProposals from "../components/goals/GoalProposals.jsx";
import { FlagIcon, PlusIcon, ViewSwitch, chip, emptyText, honeyBtn } from "../components/goals/shared.jsx";
import { SkeletonCard } from "../components/Skeleton.jsx";

// 06b · Misiones › Objetivos — what the person wants to achieve, split into milestones.
// New design in the language of Misiones (cards, chips, view switch); data from GET /api/goals.
const FILTERS = [["active", "En marcha"], ["paused", "En pausa"], ["done", "Conseguidos"]];
const EXAMPLES = ["Abrir la tienda online antes de Navidad", "Reducir los gastos fijos un 10 %", "Tener lista la auditoría de marzo"];

export default function Objetivos({ query = {} }) {
  const { bots, suggestions, ready } = useStore();
  const { data, error, loading } = useResource("/goals");
  const goals = data || [];
  const proposals = suggestions.filter((s) => s.kind === "goal");
  const [filter, setFilter] = useState("active");
  const [form, setForm] = useState(query.nuevo === "1" ? { title: "" } : null);
  const create = useAction();

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([id]) => [id, goals.filter((g) => g.status === id).length])), [goals]);
  const shown = goals.filter((g) => g.status === filter);
  const empty = !loading && !error && goals.length === 0;

  const submit = async (values) => {
    const goal = await create.act(() => post("/goals", values));
    if (goal?.id) navigate(`/objetivos/${encodeURIComponent(goal.id)}`);
  };
  const openForm = (title = "") => {
    create.setError(null);
    setForm({ title });
  };

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" active="misiones" />
        <main style={{ flex: "999 1 560px", minWidth: "0", padding: "28px clamp(16px, 3vw, 36px) 48px", display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: "0", font: "800 36px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Objetivos"}</h1>
              <p style={{ margin: "0", fontSize: "15px", color: "#4A4F5C" }}>{"Lo que quieres conseguir, partido en hitos. Cada misión empuja uno."}</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <ViewSwitch current="objetivos" />
              <button type="button" onClick={() => openForm("")} style={honeyBtn}>
                <PlusIcon />
                {"Nuevo objetivo"}
              </button>
            </div>
          </div>

          {form ? <GoalForm key={form.title} initial={form} busy={create.busy} error={create.error} onSubmit={submit} onCancel={() => setForm(null)} /> : null}

          <GoalProposals suggestions={proposals} bots={bots} />

          {empty && !form ? (
            <section aria-labelledby="sin-objetivos" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "28px", padding: "32px clamp(20px, 4vw, 44px)", background: "transparent", border: "1.5px dashed #A9AEBB", borderRadius: "18px" }}>
              <div aria-hidden="true" style={{ position: "relative", width: "120px", height: "112px", flex: "none" }}>
                <span style={{ position: "absolute", left: "0", top: "18px", width: "76px", height: "76px", background: "#FFC93C", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" }} />
                <span style={{ position: "absolute", left: "52px", top: "0", width: "52px", height: "52px", background: "#12131A", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", display: "grid", placeItems: "center", color: "#FFC93C" }}><FlagIcon size={20} /></span>
                <span style={{ position: "absolute", left: "62px", top: "62px", width: "46px", height: "46px", display: "grid", placeItems: "center", background: "#12131A", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" }}>
                  <span style={{ width: "40px", height: "40px", background: "#FFFFFF", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" }} />
                </span>
              </div>
              <div style={{ flex: "1 1 340px", display: "flex", flexDirection: "column", gap: "12px", maxWidth: "620px" }}>
                <h2 id="sin-objetivos" style={{ margin: "0", font: "800 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>{"Aún no tienes objetivos"}</h2>
                <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.5", color: "#4A4F5C" }}>{"Un objetivo es algo que quieres conseguir en unas semanas. Atlas lo parte en hitos con fecha y cada misión que lances empuja uno. Así ves de un vistazo cuánto falta."}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {EXAMPLES.map((e) => (
                    <button key={e} type="button" onClick={() => openForm(e)} style={{ minHeight: "36px", padding: "6px 12px", background: "transparent", border: "1px dashed #A9AEBB", borderRadius: "18px", cursor: "pointer", fontSize: "13px", textAlign: "left" }}>{e}</button>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", paddingTop: "4px" }}>
                  <button type="button" onClick={() => openForm("")} style={honeyBtn}><PlusIcon />{"Crear objetivo"}</button>
                </div>
              </div>
            </section>
          ) : null}

          {!empty ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                {FILTERS.map(([id, text]) => (
                  <button key={id} type="button" aria-pressed={filter === id ? "true" : "false"} onClick={() => setFilter(id)} style={chip(filter === id)}>
                    {counts[id] ? `${text} · ${counts[id]}` : text}
                  </button>
                ))}
                <span style={{ flex: "1" }} />
                <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{"Ordenados por el próximo hito"}</span>
              </div>
              {error ? <p role="alert" style={{ ...emptyText, color: "#B4372A", fontWeight: "600" }}>{`No se pudieron cargar los objetivos: ${error}`}</p> : null}
              {loading && !data ? <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}><SkeletonCard /><SkeletonCard /></div> : null}
              {data && !shown.length ? (
                <p style={{ ...emptyText, padding: "16px 20px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px" }}>
                  {filter === "active" ? "No hay objetivos en marcha. " : filter === "paused" ? "Ningún objetivo está en pausa." : "Aún no has conseguido ningún objetivo. Llegará."}
                  {filter === "active" ? <button type="button" onClick={() => openForm("")} style={{ padding: "0", background: "transparent", border: "0", cursor: "pointer", fontWeight: "600", fontSize: "14px", color: "#1F4FD1" }}>{"Crear objetivo"}</button> : null}
                </p>
              ) : null}
              {shown.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "16px", alignItems: "start" }}>
                  {shown.map((g) => <GoalCard key={g.id} goal={g} bots={bots} />)}
                </div>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
    </>
  );
}
