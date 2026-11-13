import { useEffect, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import SkeletonList from "../components/v2/Skeleton.jsx";
import TrabajoHeader, { BotDot, trabajoMain } from "../components/v3/TrabajoHeader.jsx";
import { useResource, useStore } from "../lib/store.jsx";
import { del, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { useExpert } from "../lib/expert.js";
import { findBot } from "../components/room/common.jsx";
import { formatTokens } from "../components/settings/format.jsx";
import { later, useHidden } from "../lib/undoToast.js";
import { useDialogFocus } from "../lib/useDialogFocus.js";

// Colmena 3 · Trabajo › Objetivos (design/V3Objetivos.dc.html): what you want to achieve over
// weeks or months. On the left your goals with a ring of progress; on the right the chosen
// one: why, spend, its milestones (tap the ring to mark one done, add one), the milestones
// Atlas proposes (choose which stay), the tasks that push it, pause and «conseguido».
// ?nuevo=1 (or ?nuevo=<text> from a chat's «+») opens «Nuevo objetivo».
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "sin fecha");
const longDate = (iso) => (iso ? "hasta el " + new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "sin fecha");
const MISSION_DONE = new Set(["completed"]);
const RUNNING = new Set(["queued", "planning", "running", "waiting", "awaiting_plan", "awaiting_choice", "paused", "blocked"]);
const STALE_MS = 6 * 864e5;
const go = (href) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(href); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function ObjetivosV2({ params = {}, query = {} }) {
  const { bots, missions, run: storeRun } = useStore();
  const [expert] = useExpert();
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
  useEffect(() => { if (query.nuevo !== undefined) setCreating(true); }, [query.nuevo]);
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
  const live = (m) => missions.find((x) => x.id === m.id) || m;
  const nRun = linked.filter((m) => RUNNING.has(live(m).status)).length;
  const nFinished = linked.filter((m) => MISSION_DONE.has(live(m).status)).length;
  const nRules = new Set(ms.flatMap((m) => (m.automations || []).map((a) => a.id))).size;
  const owner = findBot(bots, g?.ownerBotId || "atlas");
  const budget = g?.budget || {};
  const pick1 = (id) => { setSel(id); navigate(`/trabajo/objetivos/${id}`, { replace: true }); };
  const metaOf = (x) => {
    if (x.status === "done") return ["Conseguido", "#0B6B4A"];
    if (x.status === "paused") return ["En pausa", "#5C606C"];
    const parts = [`${x.progress?.milestonesDone ?? (x.milestones || []).filter((m) => m.done).length} de ${x.progress?.milestonesTotal ?? (x.milestones || []).length} hitos`];
    if (x.overdueCount) return [parts.concat(plural(x.overdueCount, "con retraso", "con retraso")).join(" · "), "#8A5A00"];
    const quiet = Date.now() - Date.parse(x.lastProgressAt || x.updatedAt || 0);
    if (quiet > STALE_MS) return [parts.concat(`sin avance en ${Math.round(quiet / 864e5)} días`).join(" · "), "#8A5A00"];
    return [parts.concat(x.next?.title ? "ahora: " + x.next.title.toLowerCase() : "va bien").join(" · "), "#5C606C"];
  };
  const spent = budget.tokens ? `${formatTokens(budget.used)} de ${formatTokens(budget.tokens)} tokens` + (budget.limited ? " · agotado: las tareas esperan" : "") : `${formatTokens(budget.used || 0)} tokens, sin límite`;
  const tasksChip = [nRun ? plural(nRun, "tarea en marcha", "tareas en marcha") : null, nFinished ? plural(nFinished, "hecha", "hechas") : null, nRules ? plural(nRules, "rutina", "rutinas") : null].filter(Boolean).join(" · ") || "Sin tareas todavía";

  return (
    <Shell active="trabajo">
      <main style={trabajoMain()}>
        <TrabajoHeader tab="objetivos" action={{ label: "Nuevo objetivo", onClick: () => setCreating(true) }} />
        <p style={{ margin: 0, maxWidth: "760px", fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-2)" }}>{`Lo que quieres conseguir en semanas o meses. ${owner?.name || "Atlas"} lo parte en hitos, engancha las tareas que lo empujan y te avisa si algo se atasca.`}</p>

        {list.loading && !goals.length ? <SkeletonList rows={3} /> : null}
        {!list.loading && !goals.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "20px", padding: "26px 28px", background: "var(--c-card)", borderRadius: "var(--r-2xl)" }}>
            <BotPresence bot={owner || { shape: "hex", color: "#12131A" }} size={44} />
            <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <strong style={{ font: "600 var(--t-heading)/1.1 'Bricolage Grotesque', sans-serif" }}>Aún no tienes objetivos</strong>
              <span style={{ fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-2)" }}>{`Escribe algo que quieras conseguir en semanas, como «Lanzar la tienda online en marzo». ${owner?.name || "Atlas"} te propondrá los hitos.`}</span>
            </div>
            <button type="button" onClick={() => setCreating(true)} style={{ height: "40px", padding: "0 18px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: 600, cursor: "pointer" }}>Nuevo objetivo</button>
          </div>
        ) : null}

        {g ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
            <div role="listbox" aria-label="Objetivos" style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
              {goals.map((x) => {
                const on = x.id === g.id;
                const p = x.status === "done" ? 100 : x.progress?.percent ?? 0;
                const [meta, ink] = metaOf(x);
                return (
                  <button key={x.id} type="button" role="option" aria-selected={on} onClick={() => pick1(x.id)} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px", border: `2px solid ${on ? "var(--c-text)" : "transparent"}`, borderRadius: "var(--r-xl)", background: "var(--c-card)", textAlign: "left", cursor: "pointer", opacity: x.status === "paused" ? 0.7 : 1 }}>
                    <span aria-hidden="true" style={{ flex: "none", width: "52px", height: "52px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: `conic-gradient(${x.status === "done" ? "#0B6B4A" : "#12131A"} ${p * 3.6}deg, #EEEEEA 0)` }}>
                      <span style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "var(--c-card)", fontSize: "var(--t-meta)", fontWeight: 600 }}>{p + "%"}</span>
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                      <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{x.title}</span>
                      <span style={{ fontSize: "var(--t-meta)", color: ink }}>{meta}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <section aria-label="Detalle del objetivo" style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "18px", padding: "26px 28px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", animation: "fade .3s ease-out" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>
                {owner ? <BotDot bot={owner} size={16} /> : null}
                {`Coordina ${owner?.name || "Atlas"} · ${longDate(g.dueAt)}`}
                {expert ? <span style={{ font: "400 var(--t-caption)/1 'Geist Mono', monospace" }}>{`${g.id.slice(0, 8)} · ${g.status}`}</span> : null}
              </div>
              <h2 style={{ margin: 0, font: "600 var(--t-display-s)/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>{g.title}</h2>
              {g.why ? <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-2)" }}><strong style={{ color: "var(--c-text)", fontWeight: 600 }}>Por qué:</strong> {g.why}</p> : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                <span title={budget.tokens ? `${budget.percent ?? 0} % del presupuesto` : undefined} style={{ height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-chip)", color: "var(--c-text)", fontWeight: budget.limited ? 600 : 400, fontSize: "var(--t-ui)" }}>{"Gasto: " + spent}</span>
                <span style={{ height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-chip)", fontSize: "var(--t-ui)" }}>{tasksChip}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h3 style={{ margin: 0, display: "flex", justifyContent: "space-between", fontSize: "var(--t-ui)", fontWeight: 600 }}>Hitos<span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{ms.length ? `${nDone} de ${ms.length} hechos` : ""}</span></h3>
                {ms.map((m) => {
                  const work = (m.missions || [])[0];
                  const who = work ? findBot(bots, work.botIds?.[0])?.name : null;
                  const now = !m.done && g.next?.id === m.id;
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "52px", padding: "8px 14px", borderRadius: "var(--r-lg)", background: "var(--c-hover)", animation: "fade .3s ease-out" }}>
                      <button type="button" role="checkbox" aria-checked={m.done} aria-label={(m.done ? "Desmarcar: " : "Marcar como hecho: ") + m.title} disabled={busy} onClick={() => run(() => patch(`/goals/${g.id}/milestones/${m.id}`, { done: !m.done }))}
                        style={{ flex: "none", width: "22px", height: "22px", padding: 0, display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", border: `2px solid ${m.done ? "#0B6B4A" : now ? "var(--c-accent-ink)" : "rgba(18,19,26,.25)"}`, background: m.done ? "#0B6B4A" : "transparent", color: "#FFFFFF", fontSize: "var(--t-micro)", fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>{m.done ? "✓" : ""}</button>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>{m.title}</span>
                        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{work ? <a href={`/encargo/${work.id}`} onClick={go(`/encargo/${work.id}`)} style={{ color: "var(--c-text-3)" }}>{`${who ? who + " · " : ""}${work.title}`}</a> : (m.automations || [])[0] ? `Rutina: ${(m.automations || [])[0].name}` : "Sin tarea todavía"}</span>
                      </span>
                      <span style={{ flex: "none", fontSize: "var(--t-meta)", color: m.overdue ? "var(--c-error)" : "var(--c-text-2)" }}>{m.done ? shortDate(m.doneAt || m.dueAt) : m.overdue ? "con retraso" : shortDate(m.dueAt)}</span>
                    </div>
                  );
                })}
                <form className="c-ring" onSubmit={(e) => { e.preventDefault(); const t = newMs.trim(); if (t) run(() => post(`/goals/${g.id}/milestones`, { title: t })).then((r) => r && setNewMs("")); }} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 14px", borderRadius: "var(--r-lg)", border: "1px solid rgb(var(--c-ink-rgb) / .1)" }}>
                  <label style={{ flex: 1, display: "flex" }}>
                    <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Nuevo hito</span>
                    <input className="c-bare" type="text" value={newMs} onChange={(e) => setNewMs(e.target.value)} maxLength={200} placeholder="Añade un hito, por ejemplo «Elegir la plataforma»" style={{ flex: 1, minWidth: 0, height: "40px", border: 0, background: "transparent", fontSize: "var(--t-body)" }} />
                  </label>
                  <button type="submit" disabled={busy || !newMs.trim()} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", cursor: newMs.trim() ? "pointer" : "default", fontSize: "var(--t-ui)", fontWeight: 600, background: newMs.trim() ? "var(--c-btn)" : "rgb(var(--c-ink-rgb) / .08)", color: newMs.trim() ? "var(--c-btn-text)" : "#8A8D96" }}>Añadir</button>
                </form>
                {!draft.length && g.status !== "done" ? (
                  <button type="button" disabled={busy} onClick={() => run(() => post(`/goals/${g.id}/plan`, {}))} style={{ alignSelf: "flex-start", padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-accent-ink)" }}>{busy ? `${owner?.name || "Atlas"} está pensando los hitos…` : `Pedir a ${owner?.name || "Atlas"} que proponga hitos`}</button>
                ) : null}
              </div>

              {draft.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "var(--r-xl)", border: "1.5px dashed rgb(var(--c-ink-rgb) / .18)", animation: "rise .35s ease-out" }}>
                  <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{`${owner?.name || "Atlas"} propone ${draft.length === 1 ? "un hito más. ¿Se queda?" : (draft.length === 2 ? "dos" : draft.length) + " hitos más. ¿Se quedan?"}`}</span>
                  {draft.map((p, i) => (
                    <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "var(--t-ui)", lineHeight: 1.45, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!chosen[i]} onChange={() => setPick(chosen.map((v, j) => (j === i ? !v : v)))} style={{ width: "18px", height: "18px", margin: "2px 0 0", accentColor: "var(--c-text)" }} />
                      <span><strong style={{ fontWeight: 600 }}>{p.title}</strong>{` · ${shortDate(p.dueAt)}`}{p.why ? <><br /><span style={{ color: "var(--c-text-3)" }}>{p.why}</span></> : null}</span>
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button type="button" disabled={busy || !nPick} onClick={() => run(() => post(`/goals/${g.id}/plan/accept`, { indexes: chosen.map((v, i) => (v ? i : -1)).filter((i) => i >= 0) }))} style={{ height: "38px", padding: "0 16px", border: 0, borderRadius: "var(--r-pill)", background: nPick ? "var(--c-btn)" : "rgb(var(--c-ink-rgb) / .08)", color: nPick ? "var(--c-btn-text)" : "#8A8D96", fontSize: "var(--t-ui)", fontWeight: 600, cursor: nPick ? "pointer" : "default" }}>Añadir los marcados</button>
                    <button type="button" disabled={busy} onClick={() => later({ id: "goalplan:" + g.id, keys: ["goalplan:" + g.id], text: "Propuesta descartada", error: "No se pudo descartar", run: () => run(() => del(`/goals/${g.id}/plan`)) })} style={{ height: "38px", padding: "0 12px", border: 0, background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text-2)", cursor: "pointer" }}>Ninguno</button>
                  </div>
                </div>
              ) : null}

              {linked.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h3 style={{ margin: 0, fontSize: "var(--t-ui)", fontWeight: 600 }}>Tareas que lo empujan</h3>
                  {linked.map((m) => {
                    const x = live(m);
                    const team = (x.botIds || []).map((b) => findBot(bots, b)).filter(Boolean).slice(0, 4);
                    const running = x.status === "running";
                    return (
                      <a key={m.id} href={`/encargo/${m.id}`} onClick={go(`/encargo/${m.id}`)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", padding: "6px 14px", borderRadius: "var(--r-md)", background: "var(--c-hover)", color: "var(--c-text)" }}>
                        <span style={{ display: "flex", gap: "4px" }}>{(team.length ? team : [owner]).filter(Boolean).map((b) => <BotDot key={b.id} bot={b} size={14} work={running} />)}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: "var(--t-ui)", fontWeight: 500 }}>{m.title}</span>
                        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{MISSION_DONE.has(x.status) ? "hecha" : running ? "en marcha" : (x.statusLabel || "").toLowerCase()}</span>
                      </a>
                    );
                  })}
                </div>
              ) : null}
              {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</p> : null}

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", paddingTop: "6px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .07)" }}>
                <span style={{ flex: "1 1 240px", paddingTop: "8px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`${owner?.name || "Atlas"} te avisa si un hito vence o si pasan 7 días sin avance.`}</span>
                {g.status === "done" ? null : (
                  <button type="button" disabled={busy} onClick={() => run(() => patch(`/goals/${g.id}`, { status: g.status === "paused" ? "active" : "paused" }))} style={{ marginTop: "8px", height: "40px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-ui)", cursor: "pointer" }}>{g.status === "paused" ? "Reanudar" : "Pausar"}</button>
                )}
                <button type="button" disabled={busy} onClick={() => run(() => patch(`/goals/${g.id}`, { status: g.status === "done" ? "active" : "done" }))}
                  style={{ marginTop: "8px", height: "40px", padding: "0 16px", border: 0, borderRadius: "var(--r-pill)", fontSize: "var(--t-ui)", fontWeight: 600, cursor: "pointer", ...(g.status === "done" ? { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" } : { background: "var(--c-btn)", color: "var(--c-btn-text)" }) }}>
                  {g.status === "done" ? "Conseguido ✓ · reabrir" : allDone ? "Todos los hitos hechos · marcar como conseguido" : "Marcar como conseguido"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
      {creating ? <NewGoal initialTitle={query.nuevo && query.nuevo !== "1" ? query.nuevo : ""} ownerName={owner?.name || "Atlas"} onClose={() => { setCreating(false); if (query.nuevo !== undefined) navigate("/trabajo/objetivos", { replace: true }); }} onCreated={(x) => { setCreating(false); pick1(x.id); storeRun(() => post(`/goals/${x.id}/plan`, {})).catch(() => {}); }} /> : null}
    </Shell>
  );
}

/** «Nuevo objetivo»: what you want, why, and by when. Atlas proposes the milestones after. */
function NewGoal({ onClose, onCreated, initialTitle = "", ownerName = "Atlas" }) {
  const { run } = useStore();
  const [title, setTitle] = useState(initialTitle);
  const [why, setWhy] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useDialogFocus({ onEscape: onClose });
  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setError("Escribe qué quieres conseguir.");
    setBusy(true);
    try { onCreated(await run(() => post("/goals", { title: title.trim(), why: why.trim(), ...(due ? { dueAt: new Date(due + "T18:00:00").toISOString() } : {}) }))); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  const field = { width: "100%", height: "46px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .1)", borderRadius: "var(--r-md)", background: "var(--c-card)", fontSize: "var(--t-body)", boxSizing: "border-box" };
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "64px 20px", background: "rgba(18,19,26,.28)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)", animation: "fade .2s ease-out" }}>
      <form ref={box} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="ng-t" style={{ width: "min(560px, 100%)", display: "flex", flexDirection: "column", gap: "14px", padding: "26px 28px", background: "var(--c-card)", borderRadius: "var(--r-2xl)", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 2px 6px rgba(18,19,26,.06)", animation: "sheet .4s cubic-bezier(.2,.8,.2,1)" }}>
        <h2 id="ng-t" style={{ margin: 0, font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>Nuevo objetivo</h2>
        <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{`Algo que quieres conseguir en semanas o meses. ${ownerName} lo partirá en hitos.`}</p>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-text-2)" }}>Qué quieres conseguir<input className="c-quiet" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Lanzar la tienda online en marzo" style={field} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-text-2)" }}>Por qué te importa<input className="c-quiet" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="El 40 % de los clientes pregunta si puede comprar desde casa" style={field} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-text-2)" }}>Para cuándo (opcional)<input className="c-quiet" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={field} /></label>
        {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</span> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
          <button type="button" onClick={onClose} style={{ height: "44px", padding: "0 18px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", cursor: "pointer", fontSize: "var(--t-body)" }}>Cancelar</button>
          <button type="submit" disabled={busy} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: "pointer", fontSize: "var(--t-body)", fontWeight: 600 }}>{busy ? "Creando…" : `Crear y pedir hitos a ${ownerName}`}</button>
        </div>
      </form>
    </div>
  );
}
