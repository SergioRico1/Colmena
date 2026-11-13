import Select from "../components/Select.jsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { Shape, sectionTitle } from "../components/v3/dia/parts.jsx";
import { FILTERS, STATUS, filterRows, hrefOf, logCsv, logRows, since } from "../components/v3/dia/activityLog.js";
import { needsOf } from "../components/v2/needs.js";
import { sidebarModel } from "../lib/sidebar.js";
import WeekDigest from "../components/v3/dia/WeekDigest.jsx";
import { useResource, useStore } from "../lib/store.jsx";
import { useActivityMap } from "../lib/liveStore.js";
import { download, post } from "../lib/api.js";
import { time } from "../lib/format.js";
import { reversible } from "../lib/undoToast.js";
import { useExpert } from "../lib/expert.js";
import { formatTokens } from "../components/settings/format.jsx";

// Colmena 3 · Actividad (design/V3Actividad.dc.html): what each bot is doing now (with
// «Pausar»), what today cost and what waits for your OK, and the log of everything they did,
// with filters. Expert mode adds the technical line of each step (tool, detail, error), the
// steps and tokens of the day, a filter per bot, a longer range and «Exportar registro».
// The log is built from the steps of the rooms and chats touched in the range
// (GET /api/missions/:id, the same resource the rooms use) and the requests in the state.
const OPEN = new Set(["running", "queued", "planning", "waiting", "awaiting_plan", "awaiting_choice", "blocked", "paused"]);
const RANGES = [["hoy", "Hoy"], ["7", "Últimos 7 días"], ["30", "Últimos 30 días"]];
const MAX_FEEDS = 24;
const ts = (x) => Date.parse(x || 0) || 0;
const startOf = (range) => { const d = new Date(); d.setHours(0, 0, 0, 0); if (range !== "hoy") d.setDate(d.getDate() - (Number(range) - 1)); return d.getTime(); };
const dayLabel = (iso) => { const d = new Date(iso); const diff = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 864e5); return diff === 0 ? "Hoy" : diff === 1 ? "Ayer" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }); };
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Loads one room's or chat's detail (cached and refreshed like everywhere else) and hands it up. */
function Feed({ id, onData }) {
  const { data } = useResource("/missions/" + id);
  useEffect(() => { if (data) onData(id, data); }, [id, data, onData]);
  return null;
}

export default function Actividad() {
  const store = useStore();
  const { bots, missions, approvals, paused, usage = {} } = store;
  // «hace 2 min» of a bot without a step comes from its latest frame: the whole map, as it moves.
  const activity = useActivityMap();
  const [expert, setExpert] = useExpert();
  const [filter, setFilter] = useState("todo");
  const [botFilter, setBotFilter] = useState(null);
  const [range, setRange] = useState("hoy");
  const [shown, setShown] = useState(15);
  const [details, setDetails] = useState({});
  const [error, setError] = useState(null);
  const onData = useCallback((id, d) => setDetails((all) => (all[id] === d ? all : { ...all, [id]: d })), []);
  const today = useResource("/usage/overview?days=1").data;
  const goals = useResource("/goals").data;
  const from = startOf(range);
  const botOf = (id) => bots.find((b) => b.id === id) || null;

  // The rooms and chats touched in the range, and every one still open, most recent first.
  const feeds = useMemo(() => missions
    .filter((m) => !m.incognito && (OPEN.has(m.status) || ts(m.updatedAt || m.completedAt || m.createdAt) >= from || approvals.some((a) => a.missionId === m.id && ts(a.createdAt) >= from)))
    .sort((a, b) => ts(b.updatedAt || b.completedAt || b.createdAt) - ts(a.updatedAt || a.completedAt || a.createdAt))
    .slice(0, MAX_FEEDS).map((m) => m.id), [missions, approvals, from]);
  const rows = useMemo(() => logRows({ details: feeds.map((id) => details[id]).filter(Boolean), approvals, from }), [feeds, details, approvals, from]);
  const visible = filterRows(rows, filter, expert ? botFilter : null);
  const list = expert ? visible : visible.slice(0, shown);

  // Who works and what waits for you come from the same model as the sidebar (lib/sidebar.js):
  // «Ahora» here and the sidebar's foot can never say different things.
  const model = sidebarModel(store);
  const states = new Map(model.bots.map((r) => [r.id, r]));
  const { asks } = needsOf(store);
  const waiting = model.waitingCount;
  // «Ahora»: who works (and on what), who waits for you and who is stuck.
  const now = (() => {
    const out = [];
    for (const b of bots.filter((x) => x.enabled !== false)) {
      const live = activity[b.id];
      const row = states.get(b.id);
      if (row?.state === "working") {
        let step = null, mission = null;
        for (const id of feeds) {
          const s = (details[id]?.steps || []).find((x) => x.botId === b.id && x.status === "running");
          if (s) { step = s; mission = details[id]; break; }
        }
        mission = mission || missions.find((m) => m.id === (live?.mission || b.activity?.missionId)) || null;
        const verb = live?.verb || b.activity?.verb;
        const detail = live?.detail || b.activity?.detail;
        out.push({ bot: b, state: "work", time: step?.startedAt ? since(step.startedAt) : live?.at ? since(new Date(live.at).toISOString()) : "ahora", doing: step?.narration?.text || (verb ? capital(verb) + (detail ? " " + detail : "") : step?.title || "Trabajando"), mission });
      } else if (row?.waiting > 0) {
        const a = asks.filter((x) => x.botId === b.id).sort((x, y) => ts(x.createdAt) - ts(y.createdAt))[0];
        const mission = missions.find((m) => m.id === a?.missionId) || null;
        out.push({ bot: b, state: "wait", time: "te espera", doing: a ? a.title : "Espera tu respuesta", mission, href: !a ? hrefOf(mission) : a.kind === "plan" ? `/sala/${a.missionId}#plan` : a.kind === "question" ? hrefOf(mission) : `/revisar/${a.id}` });
      } else if (b.status === "bloqueado") {
        const mission = missions.find((m) => m.botIds?.includes(b.id) && m.status === "blocked") || null;
        out.push({ bot: b, state: "stuck", time: "atascado", doing: mission?.error || mission?.activityLine || "No puede seguir", mission, href: hrefOf(mission) });
      } else if (b.status === "limitado" && b.limited) {
        out.push({ bot: b, state: "rest", time: "en pausa", doing: `Espera a que se renueve ${b.limited.label || "el plan de su IA"}`, mission: null });
      }
    }
    const order = { work: 0, wait: 1, stuck: 2, rest: 3 };
    return out.sort((x, y) => order[x.state] - order[y.state]);
  })();

  const pauseMission = async (m) => {
    setError(null);
    try {
      await store.run(() => post(`/missions/${m.id}/control`, { action: "pause" }));
      reversible({ id: "pause:" + m.id, text: `«${m.title}» en pausa`, undo: () => store.run(() => post(`/missions/${m.id}/control`, { action: "resume" })) });
    } catch (e) { setError(e.message); }
  };
  const togglePause = async () => {
    const was = !!paused;
    setError(null);
    try {
      await store.run(() => post("/control", { action: was ? "resume-all" : "pause-all" }));
      reversible({ id: "pause-all", text: was ? "El equipo sigue" : "Equipo en pausa", undo: () => store.run(() => post("/control", { action: was ? "pause-all" : "resume-all" })) });
    } catch (e) { setError(e.message); }
  };
  const exportLog = () => download(`registro-colmena-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + logCsv(visible, bots), "text/csv;charset=utf-8");

  // The day in numbers.
  const firstExpiry = asks.map((a) => a.expiresAt).filter(Boolean).sort()[0];
  const waitNote = firstExpiry ? `caduca ${new Date(firstExpiry).toDateString() === new Date().toDateString() ? "hoy" : new Date(firstExpiry).toLocaleDateString("es-ES", { weekday: "long" })} ${time(firstExpiry)}` : waiting ? "lo más antiguo, primero en Inicio" : "nada pendiente";
  const todayRows = rows.filter((r) => ts(r.at) >= startOf("hoy"));
  const doneToday = todayRows.filter((r) => r.s === "ok");
  const tasksToday = new Set(doneToday.map((r) => r.missionId)).size;
  // Colmena counts tokens, not euros: expert mode says «tk», simple mode the share of the limit.
  const month = expert
    ? { label: "Este mes", value: formatTokens(usage.monthTokens || 0) + " tk", note: usage.limitTokens ? `de ${formatTokens(usage.limitTokens)} de límite · ${usage.percent} %` : "sin límite de gasto" }
    : { label: "Este mes", value: usage.limitTokens ? `${usage.percent} %` : formatTokens(usage.monthTokens || 0) + " tokens", note: usage.limitTokens ? "del límite del mes" : "sin límite de gasto" };
  const waitStat = { label: "Te necesitan", value: String(waiting), note: waitNote, honey: waiting > 0, href: "/" };
  const total = today?.total || {};
  const stats = expert ? [
    { label: "Pasos hoy", value: String(todayRows.length), note: `${todayRows.filter((r) => r.s === "err").length} errores · ${todayRows.filter((r) => r.s === "unk").length} sin confirmar` },
    { label: "Gasto hoy", value: formatTokens(total.tokens || 0) + " tk", note: `${total.calls || 0} llamadas${total.cachePercent != null ? ` · caché ${total.cachePercent} %` : ""}` },
    month, waitStat,
  ] : [
    { label: "Hecho hoy", value: doneToday.length === 1 ? "1 cosa" : `${doneToday.length} cosas`, note: tasksToday === 1 ? "en 1 tarea" : `en ${tasksToday} tareas` },
    month, waitStat,
  ];

  const chip = (on) => ({ height: "34px", padding: "0 13px", display: "inline-flex", alignItems: "center", gap: "7px", border: "0", borderRadius: "var(--r-pill)", background: on ? "var(--c-btn)" : "var(--c-card)", color: on ? "var(--c-btn-text)" : "var(--c-text-2)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" });
  const team = bots.filter((b) => b.enabled !== false);
  let lastDay = null;

  return (
    <Shell active="actividad">
      {feeds.map((id) => <Feed key={id} id={id} onData={onData} />)}
      <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "44px clamp(20px, 4vw, 52px) 72px", display: "flex", flexDirection: "column", gap: "32px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h1 style={{ margin: "0", font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{"Actividad"}</h1>
            <p style={{ margin: "0", fontSize: "var(--t-read)", color: "var(--c-text-2)" }}>{"Qué hace cada bot ahora, qué ha hecho y lo que ha costado. Todo queda registrado."}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {expert ? <button type="button" onClick={exportLog} disabled={!visible.length} style={{ height: "42px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-body)", fontWeight: "500", cursor: visible.length ? "pointer" : "default" }}>{"Exportar registro"}</button> : null}
            <button type="button" onClick={togglePause} style={{ height: "42px", padding: "0 18px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: "600", cursor: "pointer" }}>{paused ? "Reanudar al equipo" : "Pausar a todo el equipo"}</button>
          </div>
        </header>
        {error ? <p role="alert" style={{ margin: "-16px 0 0", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</p> : null}

        <section aria-labelledby="now-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h2 id="now-t" style={sectionTitle}>{"Ahora"}</h2>
          {now.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "10px" }}>
              {now.map((x) => {
                const work = x.state === "work";
                const ring = x.state === "wait" ? "0 0 0 1.5px #FFC93C" : x.state === "stuck" ? "0 0 0 1.5px #B4232A" : "none";
                return (
                  <article key={x.bot.id} aria-label={`${x.bot.name}: ${x.doing}`} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)", boxShadow: ring }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Shape bot={x.bot} size={20} anim={work} />
                      <span style={{ flex: "1", fontSize: "var(--t-body)", fontWeight: "600" }}>{x.bot.name}</span>
                      <span style={{ fontSize: "var(--t-meta)", color: x.state === "stuck" ? "var(--c-error)" : "var(--c-text-3)", fontVariantNumeric: "tabular-nums" }}>{x.time}</span>
                    </div>
                    <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.4", color: "var(--c-text-2)", minHeight: "40px", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{x.doing}</span>
                    <span aria-hidden="true" style={{ position: "relative", height: "2px", borderRadius: "var(--r-xs)", background: "var(--c-chip)", overflow: "hidden" }}>
                      <span style={{ position: "absolute", top: "0", bottom: "0", width: "40%", background: x.bot.color || "#C9CBD3", animation: work ? "sweep 1.8s ease-in-out infinite" : "none" }} />
                    </span>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "var(--t-meta)" }}>
                      {x.mission ? <a href={hrefOf(x.mission)} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--c-accent-ink)" }}>{x.mission.title || x.mission.room}</a> : <span />}
                      {work && x.mission && ["running", "queued", "planning"].includes(x.mission.status)
                        ? <button type="button" onClick={() => pauseMission(x.mission)} style={{ flex: "none", height: "30px", padding: "0 10px", border: "1px solid rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-pill)", background: "transparent", fontSize: "var(--t-meta)", cursor: "pointer" }}>{"Pausar"}</button>
                        : x.href ? <a href={x.href} style={{ flex: "none", height: "30px", padding: "0 10px", display: "inline-flex", alignItems: "center", border: "1px solid rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-pill)", fontSize: "var(--t-meta)", color: "var(--c-text)" }}>{x.state === "wait" ? "Responder" : "Ver"}</a> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: "0", padding: "16px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)", fontSize: "var(--t-body)", color: "var(--c-text-2)" }}>{paused ? "El equipo está en pausa. Nadie trabaja hasta que lo reanudes." : "Nadie está trabajando ahora mismo. Lo que pidas aparecerá aquí mientras se hace."}</p>
          )}
          {/* The same line as the sidebar's foot, in words: who works and how many things wait. */}
          <p role="status" style={{ margin: "0", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{model.summary.text}</p>
        </section>

        <section aria-label="Resumen de hoy" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "10px" }}>
          {stats.map((s) => {
            // «Te necesitan» opens Inicio, where each of those things is answered.
            const Box = s.href ? "a" : "div";
            return (
              <Box key={s.label} href={s.href} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "16px 18px", borderRadius: "var(--r-xl)", background: s.honey ? "var(--c-honey)" : "var(--c-card)", color: s.honey ? "var(--c-honey-ink)" : "var(--c-text)" }}>
                <span style={{ fontSize: "var(--t-meta)", opacity: ".8" }}>{s.label}</span>
                <span style={{ font: "600 var(--t-headline)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{s.value}</span>
                <span style={{ fontSize: "var(--t-meta)", opacity: ".8" }}>{s.note}</span>
              </Box>
            );
          })}
        </section>

        {/* What the week was, once per week («Leído»): it lived at the foot of Inicio. */}
        <WeekDigest missions={missions} approvals={approvals} skills={store.skills} usage={usage} bots={bots} goals={goals} artifacts={store.artifacts} />

        <section aria-labelledby="log-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
            <h2 id="log-t" style={{ ...sectionTitle, margin: "0 12px 0 0" }}>{"Registro"}</h2>
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id ? "true" : "false"} onClick={() => { setFilter(id); setShown(15); }} style={chip(filter === id)}>{label}</button>
            ))}
            <span style={{ flex: "1" }} />
            <button type="button" role="switch" aria-checked={expert ? "true" : "false"} onClick={() => setExpert(!expert)} title="El mismo interruptor que el de la barra lateral" style={{ height: "36px", display: "inline-flex", alignItems: "center", gap: "10px", padding: "0 4px 0 10px", border: "0", borderRadius: "var(--r-pill)", background: "transparent", fontSize: "var(--t-ui)", fontWeight: "500", color: "var(--c-text-2)", cursor: "pointer" }}>
              {"Modo experto"}
              <span aria-hidden="true" style={{ position: "relative", width: "34px", height: "20px", borderRadius: "var(--r-pill)", background: expert ? "#12131A" : "#8A8D96", transition: "background .2s ease" }}><span style={{ position: "absolute", top: "2px", left: expert ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "var(--r-circle)", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)", transition: "left .2s ease" }} /></span>
            </button>
          </div>
          {expert ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
              <div role="group" aria-label="Qué bot" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                <button type="button" aria-pressed={!botFilter ? "true" : "false"} onClick={() => setBotFilter(null)} style={{ ...chip(!botFilter), height: "30px", fontSize: "var(--t-meta)" }}>{"Todos los bots"}</button>
                {team.map((b) => (
                  <button key={b.id} type="button" aria-pressed={botFilter === b.id ? "true" : "false"} onClick={() => setBotFilter(botFilter === b.id ? null : b.id)} style={{ ...chip(botFilter === b.id), height: "30px", fontSize: "var(--t-meta)", padding: "0 11px 0 9px" }}>
                    <Shape bot={b} size={12} />{b.name}
                  </button>
                ))}
              </div>
              <span style={{ flex: "1" }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
                {"Desde"}
                <Select label="Desde" value={range} onChange={(e) => setRange(e.target.value)} style={{ height: "30px", padding: "0 8px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-md)", background: "var(--c-card)", fontSize: "var(--t-meta)" }} options={RANGES} />
              </label>
            </div>
          ) : null}

          {list.length ? (
            <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-2xl)", background: "var(--c-card)", overflow: "hidden" }}>
              {list.map((r, i) => {
                const b = botOf(r.botId);
                const st = STATUS[r.s] || STATUS.unk;
                const day = range !== "hoy" ? new Date(r.at).toDateString() : null;
                const head = day && day !== lastDay ? (lastDay = day, dayLabel(r.at)) : null;
                return (
                  <div key={r.id}>
                    {head ? <div style={{ padding: "12px 20px 6px", borderTop: i ? "1px solid rgb(var(--c-ink-rgb) / .06)" : "0", fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-text-3)" }}>{capital(head)}</div> : null}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", padding: "12px 20px", borderTop: i || head ? "1px solid rgb(var(--c-ink-rgb) / .06)" : "0" }}>
                      <span style={{ flex: "none", width: "44px", paddingTop: "1px", fontSize: "var(--t-meta)", color: "var(--c-text-3)", fontVariantNumeric: "tabular-nums" }}>{new Date(r.at).toDateString() === new Date().toDateString() || range !== "hoy" ? time(r.at) : new Date(r.at).toLocaleDateString("es-ES", { day: "numeric", month: "numeric" })}</span>
                      <Shape bot={b} size={16} style={{ marginTop: "2px" }} />
                      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
                        <span style={{ fontSize: "var(--t-body)", lineHeight: "1.4" }}>
                          <strong style={{ fontWeight: "600" }}>{b?.name || "Un bot"}</strong>{" " + r.text + " "}
                          {r.where ? <span style={{ color: "var(--c-text-3)" }}>{"· "}{r.href ? <a href={r.href} style={{ color: "inherit" }}>{r.where}</a> : r.where}</span> : null}
                        </span>
                        {expert && r.tool ? <span style={{ font: "400 var(--t-caption)/1.5 'Geist Mono', monospace", color: "var(--c-text-2)", overflowWrap: "anywhere" }}>{r.tool}</span> : null}
                      </span>
                      <span style={{ flex: "none", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: st.bg, color: st.ink, fontSize: "var(--t-caption)", fontWeight: "600" }}>{st.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "18px 20px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", fontSize: "var(--t-body)", color: "var(--c-text-2)" }}>
              <span style={{ flex: "1" }}>{feeds.some((id) => !details[id]) ? "Cargando el registro…" : range === "hoy" ? "Hoy todavía no hay nada en el registro." : "No hay nada en el registro de estos días."}</span>
              {range === "hoy" && !feeds.some((id) => !details[id]) ? <button type="button" onClick={() => setRange("7")} style={{ height: "36px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-ui)", cursor: "pointer" }}>{"Ver los últimos 7 días"}</button> : null}
            </div>
          )}
          {!expert && visible.length > list.length ? (
            <button type="button" onClick={() => setShown(shown + 30)} style={{ alignSelf: "flex-start", height: "38px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" }}>{`Ver ${Math.min(30, visible.length - list.length)} más`}</button>
          ) : null}
          {!expert && list.length ? (
            <button type="button" onClick={() => { setRange(range === "hoy" ? "7" : "hoy"); setShown(15); }} style={{ alignSelf: "flex-start", height: "32px", padding: "0 2px", border: "0", background: "transparent", fontSize: "var(--t-ui)", fontWeight: "500", color: "var(--c-accent-ink)", cursor: "pointer" }}>{range === "hoy" ? "Ver los últimos 7 días" : "Ver solo hoy"}</button>
          ) : null}
        </section>
      </main>
    </Shell>
  );
}
