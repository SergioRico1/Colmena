import { useEffect, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import SkeletonList from "../components/v2/Skeleton.jsx";
import { useResource, useStore } from "../lib/store.jsx";
import { del, patch, post } from "../lib/api.js";
import { findBot } from "../components/room/common.jsx";
import { formatTokens } from "../components/settings/format.jsx";
import { later, useHidden } from "../lib/undoToast.js";

// Colmena 2.0 · 32 «Objetivos» (design/V2Objetivos.dc.html): what you want to achieve over
// weeks. On the left your goals with a ring of progress; on the right the chosen one: why,
// budget, its milestones (tick to mark done, add one), Atlas's proposed milestones (choose
// which stay) and the work that pushes it.
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "sin fecha");
const longDate = (iso) => (iso ? "antes del " + new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "sin fecha");
const MISSION_DONE = new Set(["completed"]);
const box = (on) => ({ width: "26px", height: "26px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", cursor: "pointer", transition: "all .2s ease", background: on ? "#12131A" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.25)" });

export default function ObjetivosV2({ params = {}, query = {} }) {
  const { bots, missions, run: storeRun } = useStore();
  const list = useResource("/goals");
  const goals = Array.isArray(list.data) ? list.data : [];
  const [sel, setSel] = useState(params.id || query.id || null);
  useEffect(() => { if (params.id) setSel(params.id); }, [params.id]);
  const current = goals.find((g) => g.id === sel) || goals.find((g) => g.status !== "done") || goals[0] || null;
  const goal = useResource(current ? `/goals/${current.id}` : null);
  const g = goal.data && goal.data.id === current?.id ? goal.data : current;
  const [newMs, setNewMs] = useState("");
  const [pick, setPick] = useState(null);
  // «Objetivo» from a chat's «+»: the form opens with what you wrote.
  const [creating, setCreating] = useState(query.nuevo !== undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setPick(null); setNewMs(""); setError(null); }, [g?.id]);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { const r = await storeRun(fn); if (r?.id && r.id === g?.id) goal.setData(r); return r ?? true; }
    catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  };
  const draftHidden = useHidden("goalplan");
  const draft = g && !draftHidden(g.id) ? g.planDraft?.milestones || [] : [];
  const chosen = pick ?? draft.map(() => true);
  const nPick = chosen.filter(Boolean).length;
  const ms = g?.milestones || [];
  const nDone = ms.filter((m) => m.done).length;
  const allDone = ms.length > 0 && nDone === ms.length;
  const linked = g ? [...new Map(ms.flatMap((m) => m.missions || []).map((m) => [m.id, m])).values()] : [];
  const owner = findBot(bots, g?.ownerBotId || "atlas");
  const budget = g?.budget || {};

  return (
    <Shell active="hoy">
      <main style={{ maxWidth: "1240px", margin: "0 auto", padding: "56px clamp(20px, 4vw, 48px) 40px", display: "flex", flexDirection: "column", gap: "34px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <a href="/" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 14px 0 10px", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", fontWeight: "500" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              {"Hoy"}
            </a>
            <h1 style={{ margin: "0", font: "600 clamp(48px, 7vw, 84px)/0.95 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>{"Objetivos"}</h1>
            <p style={{ margin: "0", maxWidth: "620px", fontSize: "17px", lineHeight: "1.5", color: "#5C606C" }}>{"Lo que quieres conseguir a largo plazo. Atlas lo parte en hitos, conecta los encargos y te avisa si algo se atasca."}</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} style={{ display: "flex", alignItems: "center", gap: "10px", height: "52px", padding: "0 24px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {"Nuevo objetivo"}
          </button>
        </header>

        {list.loading && !goals.length ? <SkeletonList rows={3} /> : null}
        {!list.loading && !goals.length ? (
          <div style={{ display: "flex", alignItems: "center", gap: "24px", padding: "34px", background: "#FFFFFF", borderRadius: "30px" }}>
            <BotPresence bot={owner || { shape: "hex", color: "#FFC93C" }} size={56} />
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <strong style={{ font: "600 24px/1.1 'Bricolage Grotesque', sans-serif" }}>{"Aún no tienes objetivos"}</strong>
              <span style={{ fontSize: "16px", lineHeight: "1.5", color: "#5C606C" }}>{"Escribe algo que quieras conseguir en semanas, como «Lanzar la tienda online en marzo». Atlas te propondrá los hitos."}</span>
            </div>
          </div>
        ) : null}

        {g ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
            <div role="listbox" aria-label="Tus objetivos" style={{ flex: "1 1 320px", minWidth: "0", display: "flex", flexDirection: "column", gap: "10px" }}>
              {goals.map((x) => {
                const on = x.id === g.id;
                const p = x.status === "done" ? 100 : x.progress?.percent ?? 0;
                return (
                  <button key={x.id} type="button" role="option" aria-selected={on ? "true" : "false"} onClick={() => setSel(x.id)}
                    style={{ display: "flex", alignItems: "center", gap: "18px", padding: "20px", border: "0", borderRadius: "26px", cursor: "pointer", textAlign: "left", transition: "box-shadow .25s ease", background: "#FFFFFF", boxShadow: on ? "0 0 0 2px #12131A, 0 20px 40px -24px rgba(18,19,26,.4)" : "0 1px 2px rgba(18,19,26,.05), 0 12px 30px -22px rgba(18,19,26,.25)", opacity: x.status === "paused" ? 0.7 : 1 }}>
                    <span aria-hidden="true" style={{ position: "relative", width: "58px", height: "58px", flex: "none", borderRadius: "50%", background: `conic-gradient(${x.status === "done" ? "#0B8A5F" : "#12131A"} ${p * 3.6}deg, rgba(18,19,26,.08) 0)` }}>
                      <span style={{ position: "absolute", inset: "7px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#FFFFFF", font: "600 14px/1 'Geist', sans-serif" }}>{p + "%"}</span>
                    </span>
                    <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
                      <strong style={{ font: "600 19px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>{x.title}</strong>
                      <span style={{ fontSize: "13px", color: x.status === "done" ? "#0B6B4A" : x.overdueCount ? "#8A5A00" : "#6B6F7A" }}>
                        {x.status === "done" ? "Conseguido" : x.status === "paused" ? "En pausa" : `${x.milestones?.length || 0} hitos · ${longDate(x.dueAt)}${x.overdueCount ? ` · ${x.overdueCount} con retraso` : ""}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <section aria-labelledby="goal-t" style={{ flex: "2 1 560px", minWidth: "0", background: "#FFFFFF", borderRadius: "34px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 30px 70px -36px rgba(18,19,26,.35)", overflow: "hidden", animation: "fade .3s ease-out" }}>
              <div style={{ padding: "32px 34px 26px", display: "flex", flexDirection: "column", gap: "14px", background: "linear-gradient(180deg, rgba(255,201,60,.12), rgba(255,255,255,0))" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "#5C606C" }}>
                  <BotPresence bot={owner} size={22} />
                  {`Coordina ${owner?.name || "Atlas"} · ${longDate(g.dueAt)}`}
                </span>
                <h2 id="goal-t" style={{ margin: "0", font: "600 clamp(30px, 3.4vw, 42px)/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{g.title}</h2>
                {g.why ? <p style={{ margin: "0", fontSize: "16px", lineHeight: "1.55", color: "#3D404A" }}><span style={{ color: "#6B6F7A" }}>{"Por qué:"}</span>{" " + g.why}</p> : null}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "6px" }}>
                  <span style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#5C606C" }}>
                    <span>{"Presupuesto · " + (budget.tokens ? `${formatTokens(budget.used)} de ${formatTokens(budget.tokens)} tokens` : "sin límite de gasto")}</span>
                    <span>{budget.tokens ? (budget.limited ? "agotado: los encargos esperan" : `${budget.percent} %`) : `${formatTokens(budget.used || 0)} tokens usados`}</span>
                  </span>
                  <span style={{ height: "6px", borderRadius: "3px", background: "rgba(18,19,26,.08)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", borderRadius: "3px", background: budget.limited ? "#FFC93C" : "#12131A", transformOrigin: "left", animation: "grow .8s cubic-bezier(.2,.8,.2,1)", width: (budget.percent ?? 0) + "%" }} />
                  </span>
                </div>
              </div>
              <div style={{ padding: "6px 34px 30px", display: "flex", flexDirection: "column", gap: "26px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: "6px" }}>
                    <h3 style={{ margin: "0", font: "600 22px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Hitos"}</h3>
                    <span style={{ fontSize: "14px", color: "#6B6F7A" }}>{`${nDone} de ${ms.length} hechos`}</span>
                  </div>
                  {ms.map((m) => {
                    const work = (m.missions || [])[0];
                    const who = work ? findBot(bots, work.botIds?.[0])?.name : null;
                    return (
                      <div key={m.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: "14px", alignItems: "center", minHeight: "60px", borderBottom: "1px solid rgba(18,19,26,.06)", animation: "fade .3s ease-out" }}>
                        <button type="button" role="checkbox" aria-checked={m.done ? "true" : "false"} aria-label={(m.done ? "Desmarcar: " : "Marcar como hecho: ") + m.title} disabled={busy} onClick={() => run(() => patch(`/goals/${g.id}/milestones/${m.id}`, { done: !m.done }))} style={box(m.done)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: m.done ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                        </button>
                        <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                          <span style={{ fontSize: "16px", fontWeight: "500", textDecoration: m.done ? "line-through" : "none", color: m.done ? "#8A8D96" : "#12131A" }}>{m.title}</span>
                          <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{work ? `${who ? who + " · " : ""}${work.title}` : (m.automations || [])[0] ? `Rutina: ${(m.automations || [])[0].name}` : "Sin encargo todavía"}</span>
                        </span>
                        <span style={{ fontSize: "13px", fontWeight: "500", color: m.overdue ? "#8A5A00" : m.done ? "#8A8D96" : "#3D404A" }}>{m.done ? "hecho" : m.overdue ? "con retraso" : shortDate(m.dueAt)}</span>
                      </div>
                    );
                  })}
                  <form onSubmit={(e) => { e.preventDefault(); const t = newMs.trim(); if (t) run(() => post(`/goals/${g.id}/milestones`, { title: t })).then((r) => r && setNewMs("")); }} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", padding: "6px 6px 6px 18px", borderRadius: "18px", background: "#F4F4F0" }}>
                    <label style={{ flex: "1", display: "flex" }}>
                      <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Nuevo hito"}</span>
                      <input type="text" value={newMs} onChange={(e) => setNewMs(e.target.value)} maxLength={200} placeholder="Añade un hito, por ejemplo «Elegir la plataforma»" style={{ flex: "1", minWidth: "0", height: "44px", border: "0", outline: "none", background: "transparent", fontSize: "15px" }} />
                    </label>
                    <button type="submit" disabled={busy} style={{ height: "40px", padding: "0 16px", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600", background: newMs.trim() ? "#12131A" : "rgba(18,19,26,.08)", color: newMs.trim() ? "#FFFFFF" : "#8A8D96" }}>{"Añadir"}</button>
                  </form>
                  {!draft.length && g.status !== "done" ? (
                    <button type="button" disabled={busy} onClick={() => run(() => post(`/goals/${g.id}/plan`, {}))} style={{ alignSelf: "flex-start", marginTop: "8px", padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{busy ? "Atlas está pensando los hitos…" : `Pedir a ${owner?.name || "Atlas"} que proponga hitos`}</button>
                  ) : null}
                </div>

                {draft.length ? (
                  <div style={{ padding: "22px", borderRadius: "26px", display: "flex", flexDirection: "column", gap: "14px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.14)", animation: "rise .35s ease-out" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <BotPresence bot={owner} size={28} state="wait" />
                      <span style={{ flex: "1", fontSize: "15px", lineHeight: "1.45" }}><strong style={{ fontWeight: "600" }}>{`${owner?.name || "Atlas"} ha propuesto unos hitos.`}</strong>{" Elige cuáles se quedan."}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {draft.map((p, i) => {
                        const on = chosen[i];
                        return (
                          <button key={i} type="button" role="checkbox" aria-checked={on ? "true" : "false"} onClick={() => setPick(chosen.map((v, j) => (j === i ? !v : v)))} style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "54px", padding: "6px 14px", border: "0", borderRadius: "16px", cursor: "pointer", textAlign: "left", background: on ? "#FFFFFF" : "transparent" }}>
                            <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "7px", background: on ? "#12131A" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.25)" }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                            </span>
                            <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                              <strong style={{ fontSize: "15px", fontWeight: "600" }}>{p.title}</strong>
                              {p.why ? <span style={{ fontSize: "13px", color: "#5C606C" }}>{p.why}</span> : null}
                            </span>
                            <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{shortDate(p.dueAt)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
                      <button type="button" disabled={busy} onClick={() => later({ id: "goalplan:" + g.id, keys: ["goalplan:" + g.id], text: "Propuesta descartada", error: "No se pudo descartar", run: () => run(() => del(`/goals/${g.id}/plan`)) })} style={{ height: "44px", padding: "0 18px", border: "0", borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>{"Ninguno"}</button>
                      <button type="button" disabled={busy || !nPick} onClick={() => run(() => post(`/goals/${g.id}/plan/accept`, { indexes: chosen.map((v, i) => (v ? i : -1)).filter((i) => i >= 0) }))} style={{ height: "44px", padding: "0 20px", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600", background: nPick ? "#12131A" : "rgba(18,19,26,.08)", color: nPick ? "#FFFFFF" : "#8A8D96" }}>{nPick ? (nPick === 1 ? "Añadir 1 hito" : `Añadir ${nPick} hitos`) : "Añadir"}</button>
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <h3 style={{ margin: "0", font: "600 22px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Encargos que lo empujan"}</h3>
                  {linked.length ? linked.map((m) => {
                    const team = (m.botIds || []).map((b) => findBot(bots, b)).filter(Boolean).slice(0, 3);
                    const live = missions.find((x) => x.id === m.id) || m;
                    return (
                      <a key={m.id} href={`/encargo/${m.id}`} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", borderRadius: "18px", background: "#F6F6F3" }}>
                        <span style={{ display: "flex", gap: "3px" }}>{(team.length ? team : [findBot(bots, "atlas")]).map((b) => <BotPresence key={b.id} bot={b} size={18} state={live.status === "running" ? "work" : "rest"} />)}</span>
                        <span style={{ flex: "1", fontSize: "15px", fontWeight: "500" }}>{m.title}</span>
                        <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{MISSION_DONE.has(live.status) ? "hecho" : live.status === "running" ? "en marcha" : (live.statusLabel || "").toLowerCase()}</span>
                      </a>
                    );
                  }) : <span style={{ fontSize: "14px", color: "#6B6F7A" }}>{"Aún no hay encargos para este objetivo. Pide algo en Hoy y menciónalo, o Atlas lo propondrá en su ronda."}</span>}
                  <p style={{ margin: "0", fontSize: "13px", lineHeight: "1.5", color: "#6B6F7A" }}>{`${owner?.name || "Atlas"} te avisa en su ronda si un hito vence o si no hay avance en 7 días.`}</p>
                </div>
                {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4372A" }}>{error}</p> : null}
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "10px", paddingTop: "6px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                  {g.status === "done" ? <span /> : (
                    <button type="button" disabled={busy} onClick={() => run(() => patch(`/goals/${g.id}`, { status: g.status === "paused" ? "active" : "paused" }))} style={{ height: "44px", padding: "0 16px", border: "0", borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#5C606C" }}>{g.status === "paused" ? "Reanudar objetivo" : "Pausar objetivo"}</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => run(() => patch(`/goals/${g.id}`, { status: g.status === "done" ? "active" : "done" }))}
                    style={{ height: "44px", padding: "0 20px", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600", ...(g.status === "done" ? { background: "#E1F4EC", color: "#0B5A3E" } : allDone ? { background: "#FFC93C", color: "#12131A" } : { background: "rgba(18,19,26,.06)", color: "#12131A" }) }}>
                    {g.status === "done" ? "Conseguido ✓" : allDone ? "Todos los hitos hechos · ¿Conseguido?" : "Marcar como conseguido"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </main>
      {creating ? <NewGoal initialTitle={query.nuevo || ""} onClose={() => setCreating(false)} onCreated={(x) => { setCreating(false); setSel(x.id); storeRun(() => post(`/goals/${x.id}/plan`, {})).catch(() => {}); }} /> : null}
    </Shell>
  );
}

/** «Nuevo objetivo»: what you want, why, and by when. Atlas proposes the milestones after. */
function NewGoal({ onClose, onCreated, initialTitle = "" }) {
  const { run } = useStore();
  const [title, setTitle] = useState(initialTitle);
  const [why, setWhy] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setError("Escribe qué quieres conseguir.");
    setBusy(true);
    try { onCreated(await run(() => post("/goals", { title: title.trim(), why: why.trim(), ...(due ? { dueAt: new Date(due + "T18:00:00").toISOString() } : {}) }))); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  const field = { width: "100%", height: "52px", padding: "0 18px", border: "0", borderRadius: "16px", outline: "none", background: "#F6F6F3", fontSize: "16px", boxSizing: "border-box" };
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "64px 20px", background: "rgba(18,19,26,.28)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)", animation: "fade .2s ease-out" }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="ng-t" style={{ width: "min(560px, 100%)", display: "flex", flexDirection: "column", gap: "16px", padding: "28px", background: "#FFFFFF", borderRadius: "32px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 2px 6px rgba(18,19,26,.06)", animation: "sheet .4s cubic-bezier(.2,.8,.2,1)" }}>
        <h2 id="ng-t" style={{ margin: 0, font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.035em" }}>{"Nuevo objetivo"}</h2>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", color: "#5C606C" }}>{"Qué quieres conseguir"}<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Lanzar la tienda online en marzo" style={field} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", color: "#5C606C" }}>{"Por qué te importa"}<input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="El 40 % de los clientes pregunta si puede comprar desde casa" style={field} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", color: "#5C606C" }}>{"Para cuándo (opcional)"}<input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={field} /></label>
        {error ? <span role="alert" style={{ fontSize: "14px", color: "#B4372A" }}>{error}</span> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button type="button" onClick={onClose} style={{ height: "50px", padding: "0 20px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>{"Cancelar"}</button>
          <button type="submit" disabled={busy} style={{ height: "50px", padding: "0 26px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>{busy ? "Creando…" : "Crear y pedir hitos a Atlas"}</button>
        </div>
      </form>
    </div>
  );
}
