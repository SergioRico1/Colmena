import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { needsOf } from "../components/v2/needs.js";
import { ApprovalNeed, ChoiceNeed, ErrandNeed, GroupNeed, SnoozedNeeds, WatchNeed, recentlyDone } from "../components/v3/dia/Needs.jsx";
import { groupApprovals } from "../lib/approvalGroups.js";
import { Shape, sectionTitle, srOnly } from "../components/v3/dia/parts.jsx";
import { routeOf } from "../components/v3/dia/route.js";
import { useResource, useStore } from "../lib/store.jsx";
import { pickFiles, post } from "../lib/api.js";
import { greeting, needsYou, time } from "../lib/format.js";
import { reversible } from "../lib/undoToast.js";
import { formatTokens } from "../components/settings/format.jsx";
import { navigate } from "../lib/router.jsx";
import { NoAccountNotice } from "../components/v3/States.jsx";
import { PlanLimitNotice } from "../components/v2/LimitNotice.jsx";
import { scrollBehavior } from "../lib/motion.js";
import { pauseLine } from "../lib/pauseReason.js";
import Panel from "../components/blocks/Panel.jsx";

// Colmena 3 · Inicio (design/V3Inicio.dc.html): one sentence says how many things need you, a
// box asks your team for anything (Atlas decides who does it, or you pick the bot), then what
// needs you in honey (the oldest first, the first one larger), what is under way and today's
// timeline: what finished, «Ahora» and what comes later. «Pausar a todo el equipo» stays at hand.
const COUNT = ["Nada te necesita", "Una cosa te necesita", "Dos cosas te necesitan", "Tres cosas te necesitan", "Cuatro cosas te necesitan", "Cinco cosas te necesitan", "Seis cosas te necesitan", "Siete cosas te necesitan", "Ocho cosas te necesitan", "Nueve cosas te necesitan", "Diez cosas te necesitan"];
const WORKING = new Set(["running", "queued", "planning", "waiting", "awaiting_plan", "awaiting_choice", "blocked", "paused"]);
const IDEAS = ["Prepárame la reunión de mañana", "Resume mis correos de hoy", "Prepara mi semana", "Compara las ventas con el mes pasado"];

const pct = (m) => (m.progress?.total ? Math.round((100 * (m.progress.done || 0)) / m.progress.total) : null);
const dayDiff = (iso) => Math.round((new Date(new Date(iso).toDateString()) - new Date(new Date().toDateString())) / 864e5);
const dueLabel = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const days = dayDiff(iso);
  if (days === 0) return "hoy " + time(iso);
  if (days === 1) return "mañana " + time(iso);
  if (days > 1 && days < 7) return d.toLocaleDateString("es-ES", { weekday: "long" }) + " " + time(iso);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};
// «08:02» today, «jue 10:00» another day.
const when = (iso) => (dayDiff(iso) === 0 ? time(iso) : new Date(iso).toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "") + " " + time(iso));
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const firstSentence = (t) => (t ? (String(t).match(/^[^.!?\n]+[.!?]?/) || [""])[0].replace(/[.]$/, "").trim() : "");
const weekKey = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };
const ts = (x) => Date.parse(x || 0) || 0;

export default function Hoy({ query = {} }) {
  const store = useStore();
  // Links of v1 (/bandeja?aprobacion=…) open that request in Revisar.
  useEffect(() => { if (query.aprobacion) navigate(`/revisar/${encodeURIComponent(query.aprobacion)}`, { replace: true }); }, [query.aprobacion]);
  const { bots, missions, approvals, automations = [], skills, usage, settings = {}, paused } = store;
  const goals = useResource("/goals").data;
  const { asks, choices, notes, errands, snoozed, items } = needsOf(store);
  const [ask, setAsk] = useState("");
  const [files, setFiles] = useState([]);
  const [picked, setPicked] = useState(null); // a bot chosen by hand in «… decide quién lo hace»
  const [menu, setMenu] = useState(false);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const team = bots.filter((b) => b.enabled !== false);
  const route = routeOf(ask, bots, picked);
  const botOf = (id) => bots.find((b) => b.id === id) || null;

  // «Pedir» from elsewhere (an old /#pedir link or the colmena:ask event): here, with the box focused.
  useEffect(() => {
    const focus = () => requestAnimationFrame(() => { input.current?.focus(); input.current?.scrollIntoView({ block: "center", behavior: scrollBehavior() }); });
    if (location.hash === "#pedir") focus();
    window.addEventListener("colmena:ask", focus);
    return () => window.removeEventListener("colmena:ask", focus);
  }, []);
  // An unsent first request from the welcome (colmena:draft) waits in the box, once.
  useEffect(() => {
    try {
      const draft = sessionStorage.getItem("colmena:draft");
      if (draft) { setAsk(draft); sessionStorage.removeItem("colmena:draft"); }
    } catch {}
  }, []);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !e.target.closest?.("[data-route-menu]")) setMenu(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [menu]);

  const send = async () => {
    const prompt = ask.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = route.solo
        ? { prompt, mode: "solo", botIds: [route.bot.id], safety: "preguntar", attachments: files }
        : { prompt, mode: "equipo", botIds: route.ids || [], safety: "preguntar", attachments: files };
      await store.run(() => post("/missions", body));
      setSent(`${route.bot.name} lo tiene. Lo verás en «En marcha».`);
      setAsk("");
      setFiles([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const attach = async () => {
    try { const more = await pickFiles(); setFiles((f) => [...f, ...more].slice(0, 5)); } catch (e) { setError(e.message); }
  };
  const togglePause = async () => {
    const was = !!paused;
    try {
      await store.run(() => post("/control", { action: was ? "resume-all" : "pause-all" }));
      reversible({ id: "pause-all", text: was ? "El equipo sigue" : "Equipo en pausa", undo: () => store.run(() => post("/control", { action: was ? "pause-all" : "resume-all" })) });
    } catch (e) { setError(e.message); }
  };

  // Everything that needs you, the oldest first; the first card is the large one.
  const settled = recentlyDone().filter((d) => !asks.some((a) => a.id === d.approval.id));
  const needs = [
    // Requests of the same kind in a row from one bot share a card («Aprobar todas»).
    ...groupApprovals([...asks].sort((a, b) => ts(a.createdAt) - ts(b.createdAt))).map((e) => (e.type === "group"
      ? { key: e.id, at: e.items[0].createdAt, el: (wide) => <GroupNeed key={e.id} group={e} wide={wide} bot={botOf(e.botId)} mission={missions.find((m) => m.id === e.missionId)} /> }
      : { key: e.a.id, at: e.a.createdAt, el: (wide) => <ApprovalNeed key={e.a.id} a={e.a} wide={wide} bot={botOf(e.a.botId)} mission={missions.find((m) => m.id === e.a.missionId)} /> })),
    ...notes.map((x) => ({ key: x.id, at: x.createdAt, el: (wide) => <WatchNeed key={x.id} n={x} wide={wide} bot={botOf(x.botId)} /> })),
    ...choices.map((m) => ({ key: m.id, at: m.updatedAt || m.createdAt, el: (wide) => <ChoiceNeed key={m.id} m={m} wide={wide} bots={bots} /> })),
    ...errands.map((x) => ({ key: x.id, at: x.at, el: (wide) => <ErrandNeed key={x.id} item={x} wide={wide} bot={botOf(x.botId)} /> })),
  ].sort((a, b) => ts(a.at) - ts(b.at));
  // The one count of what waits for you (server/waiting.mjs): every request counts, also inside a shared card.
  const n = items.length;
  const [first, ...rest] = needs;

  const running = missions.filter((m) => !m.conversation && !m.archived && WORKING.has(m.status))
    .sort((a, b) => Number(needsYou(b)) - Number(needsYou(a)) || ts(b.updatedAt || b.createdAt) - ts(a.updatedAt || a.createdAt))
    .slice(0, 6);

  // «Hoy»: what finished today, «Ahora» and what comes later today and the next two days.
  const timeline = useMemo(() => {
    const today = new Date().toDateString();
    const isToday = (iso) => iso && new Date(iso).toDateString() === today;
    const doneItems = [];
    for (const m of missions) {
      if (m.status !== "completed" || m.watch || !isToday(m.completedAt)) continue;
      const b = botOf(m.botIds?.[0]) || botOf("atlas");
      doneItems.push({ key: "m" + m.id, at: m.completedAt, text: firstSentence(m.recap?.text) || `${b?.name || "Tu equipo"} terminó «${m.title}»`, href: m.conversation ? `/chat/${m.botIds?.[0]}?c=${m.id}` : `/encargo/${m.id}` });
    }
    for (const a of approvals) {
      if (a.decidedBy !== "tú" || !isToday(a.decidedAt) || !["approved", "answered"].includes(a.status)) continue;
      doneItems.push({ key: "a" + a.id, at: a.decidedAt, text: `${a.status === "answered" ? "Respondiste" : "Aprobaste"}: ${a.title}` });
    }
    const horizon = Date.now() + 2.5 * 864e5;
    const laterItems = [];
    for (const r of automations) {
      if (!r.enabled || !r.nextRun || ts(r.nextRun) < Date.now() || ts(r.nextRun) > horizon) continue;
      const b = botOf(r.botId);
      laterItems.push({ key: "r" + r.id, at: r.nextRun, text: (b ? b.name + ": " : "") + (r.name || r.prompt), href: "/trabajo/rutinas" });
    }
    for (const m of missions) {
      if (!m.dueAt || m.status === "completed" || m.archived || ts(m.dueAt) < Date.now() || ts(m.dueAt) > horizon) continue;
      laterItems.push({ key: "d" + m.id, at: m.dueAt, text: `Se entrega «${m.title}»`, href: `/encargo/${m.id}` });
    }
    for (const g of Array.isArray(goals) ? goals : []) {
      const due = g.next?.dueAt;
      if (!due || ts(due) < Date.now() || ts(due) > horizon) continue;
      laterItems.push({ key: "g" + g.id, at: due, text: `Hito del objetivo «${g.title}»`, href: `/trabajo/objetivos/${g.id}` });
    }
    return {
      done: doneItems.sort((a, b) => ts(a.at) - ts(b.at)).slice(-6),
      later: laterItems.sort((a, b) => ts(a.at) - ts(b.at)).slice(0, 4),
    };
  }, [missions, approvals, automations, goals, bots]); // eslint-disable-line react-hooks/exhaustive-deps

  // The name you gave in the welcome; the placeholder «Tu cuenta» is not a name.
  const name = /^t[uú](\s+cuenta)?$/i.test(String(settings.userName || "").trim()) ? "" : String(settings.userName || "").trim().split(/\s+/)[0];
  const hello = greeting().replace(/\.$/, "") + (name ? `, ${name}.` : ".");
  const now = new Date();

  return (
    <Shell active="inicio">
      <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "40px clamp(20px, 4vw, 52px) 72px", display: "flex", flexDirection: "column", gap: "44px" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "rise .5s ease-out" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span style={{ fontSize: "15px", color: "#5C606C" }}>{capital(now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }))}</span>
            <button type="button" onClick={togglePause} style={{ height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "0", borderRadius: "999px", background: "transparent", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.14)", fontSize: "13.5px", fontWeight: "500", color: "#3D404A", cursor: "pointer" }}>
              {paused
                ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>{"Reanudar al equipo"}</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>{"Pausar a todo el equipo"}</>}
            </button>
          </div>
          <h1 style={{ margin: "0", maxWidth: "900px", font: "600 clamp(40px, 4.8vw, 64px)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em", textWrap: "balance" }}>
            {hello + " "}<span style={{ color: "#8A8D96" }}>{(COUNT[n] || `${n} cosas te necesitan`) + (paused ? "; el equipo está en pausa." : "; lo demás va solo.")}</span>
          </h1>
        </header>

        {/* «Sin cuenta de IA» is the only app-level «te necesita»; the plan limit says the bots go on with the backup. Both hide themselves. */}
        <NoAccountNotice />
        <PlanLimitNotice />

        <section id="pedir" aria-label="Pedir algo" style={{ scrollMarginTop: "40px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="c-ring" style={{ background: "#FFFFFF", borderRadius: "24px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 28px 64px -34px rgba(18,19,26,.35)", padding: "8px 8px 0 22px" }}>
            <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <label style={{ flex: "1", display: "flex" }}>
                <span style={srOnly}>{"Pide algo a tu equipo"}</span>
                <input className="c-bare" ref={input} type="text" value={ask} onChange={(e) => { setAsk(e.target.value); setSent(null); setError(null); }} placeholder="Pide algo a tu equipo…" maxLength={4000}
                  style={{ flex: "1", minWidth: "0", height: "60px", border: "0", background: "transparent", fontSize: "19px", letterSpacing: "-0.01em" }} />
              </label>
              <button type="submit" aria-label="Enviar" disabled={busy || !ask.trim()} style={{ width: "46px", height: "46px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", cursor: ask.trim() ? "pointer" : "default", opacity: ask.trim() || busy ? 1 : 0.9 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
              </button>
            </form>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "10px 8px 12px 0", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "13px", color: "#5C606C" }}>
              <span data-route-menu="" style={{ position: "relative" }}>
                <button type="button" aria-haspopup="menu" aria-expanded={menu ? "true" : "false"} onClick={() => setMenu(!menu)} style={{ height: "32px", padding: "0 12px 0 10px", display: "inline-flex", alignItems: "center", gap: "8px", border: "0", borderRadius: "999px", background: "#F3F3EF", fontSize: "13.5px", color: "#3D404A", cursor: "pointer" }}>
                  <Shape bot={route.bot} size={14} />
                  <span role="status">{route.text}</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {menu ? (
                  <div role="menu" aria-label="Quién lo hace" style={{ position: "absolute", zIndex: 20, top: "38px", left: "0", minWidth: "260px", display: "flex", flexDirection: "column", gap: "2px", padding: "6px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 2px 6px rgba(18,19,26,.08), 0 24px 48px -20px rgba(18,19,26,.4)", animation: "fade .15s ease-out" }}>
                    {[team.find((b) => b.id === "atlas"), ...team.filter((b) => b.id !== "atlas")].filter(Boolean).map((b) => {
                      const on = b.id === "atlas" ? !picked : picked?.id === b.id;
                      return (
                        <button key={b.id} type="button" role="menuitemradio" aria-checked={on ? "true" : "false"} onClick={() => { setPicked(b.id === "atlas" ? null : b); setMenu(false); input.current?.focus(); }}
                          className="v3-hover" style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", padding: "0 10px", border: "0", borderRadius: "10px", background: on ? "#F1F1EC" : "transparent", textAlign: "left", cursor: "pointer", fontSize: "14px", color: "#12131A" }}>
                          <Shape bot={b} size={14} />
                          <span style={{ flex: "1" }}>{b.id === "atlas" ? `${b.name} decide quién lo hace` : b.name}</span>
                          <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{b.id === "atlas" ? "" : b.role}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </span>
              <button type="button" onClick={attach} style={{ height: "32px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "6px", border: "0", borderRadius: "999px", background: "transparent", fontSize: "13.5px", color: "#3D404A", cursor: "pointer" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="m20 11.5-8.2 8.2a5 5 0 0 1-7-7l8.5-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>{"Adjuntar"}
              </button>
              {files.map((f, i) => (
                <span key={f.name + i} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "28px", padding: "0 4px 0 10px", borderRadius: "999px", background: "#F3F3EF", fontSize: "13px", color: "#12131A" }}>
                  {f.name}
                  <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </span>
              ))}
              <span style={{ marginLeft: "auto" }}>{"Intro para enviar"}</span>
            </div>
          </div>
          {sent ? <p role="status" style={{ margin: "0", padding: "0 22px", fontSize: "14.5px", color: "#0B6B4A", animation: "rise .35s ease-out" }}>{sent}</p> : null}
          {error ? <p role="alert" style={{ margin: "0", padding: "0 22px", fontSize: "14.5px", color: "#B4232A" }}>{error}</p> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "0 6px" }}>
            {IDEAS.map((label) => (
              <button key={label} type="button" onClick={() => { setAsk(label); setSent(null); input.current?.focus(); }} style={{ height: "34px", padding: "0 14px", background: "transparent", border: "0", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)", borderRadius: "999px", cursor: "pointer", fontSize: "13.5px", color: "#3D404A" }}>{label}</button>
            ))}
          </div>
        </section>

        <section aria-labelledby="need-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h2 id="need-t" style={sectionTitle}>{"Te necesitan"}</h2>
            {n ? <span style={{ minWidth: "24px", height: "24px", padding: "0 7px", display: "grid", placeItems: "center", borderRadius: "12px", background: "#FFC93C", fontSize: "12.5px", fontWeight: "600" }}>{n}</span> : null}
            <span style={{ marginLeft: "auto", fontSize: "13.5px", color: "#5C606C" }}>{n > 1 ? "Lo más antiguo, primero" : n ? "" : "Al día"}</span>
          </div>
          {!n && !settled.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: "18px", padding: "20px 22px", background: "#FFFFFF", borderRadius: "20px", animation: "rise .4s ease-out" }}>
              <span style={{ animation: "drift 5s ease-in-out infinite" }}><BotPresence bot={botOf("atlas") || { shape: "hex", color: "#12131A" }} size={36} state="rest" /></span>
              <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <strong style={{ fontSize: "16.5px", fontWeight: "600" }}>{"Nada te espera."}</strong>
                <span style={{ fontSize: "14.5px", color: "#4A4D57" }}>{"Tu equipo sigue trabajando. Solo te avisaremos si hace falta."}</span>
              </span>
            </div>
          ) : null}
          {first ? first.el(true) : null}
          {rest.length || settled.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: "14px", alignItems: "start" }}>
              {rest.map((x) => x.el(false))}
              {settled.map((d) => <ApprovalNeed key={"done" + d.approval.id} a={d.approval} bot={botOf(d.approval.botId)} mission={missions.find((m) => m.id === d.approval.missionId)} settled={d.text} />)}
            </div>
          ) : null}
          {/* What you put off with «Recordar después»: out of the count, one click away. */}
          <SnoozedNeeds items={snoozed} bots={bots} />
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(400px, 100%), 1fr))", gap: "40px 28px", alignItems: "start" }}>
          <section aria-labelledby="run-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
              <h2 id="run-t" style={sectionTitle}>{"En marcha"}</h2>
              <a href="/trabajo" style={{ fontSize: "14px", fontWeight: "500", color: "#1F4FD1" }}>{"Todo el trabajo"}</a>
            </div>
            {running.length ? (
              <div style={{ display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF" }}>
                {running.map((m, i) => {
                  const p = pct(m);
                  const lead = botOf(m.botIds?.[0]) || botOf("atlas");
                  const waits = needsYou(m);
                  const moving = ["running", "queued", "planning"].includes(m.status);
                  return (
                    <a key={m.id} href={`/encargo/${m.id}`} style={{ display: "flex", gap: "14px", padding: "16px 18px", borderTop: i ? "1px solid rgba(18,19,26,.06)" : "0", color: "#12131A" }}>
                      <span aria-hidden="true" style={{ flex: "none", width: "24px", height: "24px", margin: "-2px -4px 0", display: "grid", placeItems: "center", borderRadius: "50%", boxShadow: waits ? "inset 0 0 0 2px #FFC93C" : "none" }}>
                        <Shape bot={lead} size={14} anim={moving && !waits} />
                      </span>
                      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                          <span style={{ flex: "1", minWidth: 0, fontSize: "15px", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                          {m.dueAt ? <span style={{ flex: "none", fontSize: "12.5px", color: "#5C606C" }}>{dueLabel(m.dueAt)}</span> : null}
                        </span>
                        <span style={{ fontSize: "13.5px", color: waits ? "#8A5A00" : "#4A4D57", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.status === "paused" ? pauseLine(m, { botName: lead?.name }) : m.narration?.text || m.activityLine || m.statusLabel}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span aria-hidden="true" style={{ position: "relative", flex: "1", height: "4px", borderRadius: "2px", background: "#ECECE7", overflow: "hidden" }}>
                            <span style={{ position: "absolute", inset: "0 auto 0 0", width: (p ?? 4) + "%", borderRadius: "2px", background: "#12131A", transition: "width .4s ease" }} />
                          </span>
                          <span style={{ width: "34px", textAlign: "right", fontSize: "12.5px", color: "#5C606C", fontVariantNumeric: "tabular-nums" }}>{p != null ? p + "%" : ""}</span>
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p style={{ margin: 0, padding: "18px", background: "#FFFFFF", borderRadius: "20px", fontSize: "14.5px", color: "#4A4D57" }}>{"Nada en marcha ahora mismo. Pide algo arriba y lo verás aquí mientras se hace."}</p>
            )}
          </section>

          <section aria-labelledby="today-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
              <h2 id="today-t" style={sectionTitle}>{"Hoy"}</h2>
              <a href="/actividad" style={{ fontSize: "14px", fontWeight: "500", color: "#1F4FD1" }}>{"Toda la actividad"}</a>
            </div>
            <ol style={{ margin: "0", padding: "8px 0", listStyle: "none", display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF" }}>
              {timeline.done.map((d) => <Moment key={d.key} item={d} done />)}
              {!timeline.done.length ? <li style={{ padding: "9px 18px", fontSize: "14px", color: "#5C606C" }}>{"Aún no ha terminado nada hoy."}</li> : null}
              <li aria-label={`Ahora, ${time(now)}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 18px" }}>
                <span style={{ height: "22px", padding: "0 9px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "11.5px", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{"Ahora · " + time(now)}</span>
                <span style={{ flex: "1", height: "1px", background: "rgba(18,19,26,.14)" }} />
              </li>
              {timeline.later.map((d) => <Moment key={d.key} item={d} />)}
              {!timeline.later.length ? <li style={{ padding: "9px 18px", fontSize: "14px", color: "#5C606C" }}>{"Nada programado para hoy ni mañana."}</li> : null}
            </ol>
          </section>
        </div>

        <WeekDigest missions={missions} approvals={approvals} skills={skills} usage={usage} bots={bots} goals={goals} />
        <Panel />
      </main>
    </Shell>
  );
}

/** One line of «Hoy»: ✓ what finished, ○ what comes. */
function Moment({ item, done = false }) {
  const text = <span style={{ color: done ? "#3D404A" : "#12131A" }}>{item.text}</span>;
  return (
    <li style={{ display: "flex", alignItems: "baseline", gap: "12px", padding: "9px 18px", fontSize: "14px", lineHeight: "1.45" }}>
      <span style={{ flex: "none", width: "66px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: "#5C606C" }}>{when(item.at)}</span>
      <span aria-hidden="true" style={{ flex: "none", width: "14px", color: done ? "#0B6B4A" : "#8A8D96", fontWeight: "700" }}>{done ? "✓" : "○"}</span>
      {item.href ? <a href={item.href} style={{ color: "inherit", minWidth: 0 }}>{text}</a> : text}
    </li>
  );
}

/** «Tu semana con la colmena»: on a new week, what happened and what comes, once («Leído»). */
function WeekDigest({ missions, approvals, skills, usage, bots, goals }) {
  const key = "colmena:digest:" + weekKey();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const from = new Date(); from.setDate(from.getDate() - 7);
  const week = useMemo(() => {
    const since = from.getTime();
    const done = missions.filter((m) => !m.conversation && m.status === "completed" && ts(m.completedAt) > since);
    const approved = approvals.filter((a) => a.decidedBy === "tú" && ts(a.decidedAt) > since);
    const pendingSkills = (skills || []).filter((s) => s.status === "pending");
    const happened = done.filter((m) => m.recap?.text).slice(0, 3).map((m) => firstSentence(m.recap.text) + ".");
    const soon = [];
    for (const g of Array.isArray(goals) ? goals : []) if (g.next?.dueAt && ts(g.next.dueAt) - Date.now() < 21 * 864e5 && ts(g.next.dueAt) > Date.now()) soon.push(`El objetivo «${g.title}» tiene un hito el ${new Date(g.next.dueAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}.`);
    const awaiting = missions.filter((m) => m.status === "awaiting_choice").length;
    if (awaiting) happened.push(awaiting === 1 ? "Hay una propuesta esperando tu decisión." : `Hay ${awaiting} propuestas esperando tu decisión.`);
    return { done: done.length, approved: approved.length, skills: pendingSkills.length, happened: happened.slice(0, 3), soon: soon.slice(0, 3) };
  }, [missions, approvals, skills, goals]); // eslint-disable-line react-hooks/exhaustive-deps
  if (dismissed || (!week.done && !week.approved && !week.skills)) return null;
  const to = new Date(); to.setDate(to.getDate() - 1);
  const range = `Del ${from.getDate()} al ${to.getDate()} de ${to.toLocaleDateString("es-ES", { month: "long" })}`;
  const spend = usage?.percent != null ? { n: usage.percent + " %", label: "del gasto del mes" } : { n: formatTokens(usage?.monthTokens || 0), label: "tokens este mes" };
  const atlas = bots.find((b) => b.id === "atlas") || { shape: "hex", color: "#12131A" };
  const stat = (value, label) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "14px 16px", borderRadius: "16px", background: "rgba(255,255,255,.08)" }}>
      <span style={{ font: "600 28px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{value}</span>
      <span style={{ fontSize: "13px", color: "#B8BBC4" }}>{label}</span>
    </div>
  );
  const list = (head, items) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontSize: "13px", fontWeight: "500", color: "#B8BBC4" }}>{head}</span>
      <ul style={{ margin: "0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14.5px", lineHeight: "1.5", color: "#E6E7EC" }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
  const pill = { display: "inline-flex", alignItems: "center", height: "40px", padding: "0 16px", borderRadius: "999px", fontSize: "14px", fontWeight: "600" };
  return (
    <section aria-labelledby="wk-t" style={{ display: "flex", flexDirection: "column", gap: "18px", padding: "24px 28px", borderRadius: "26px", background: "#12131A", color: "#FFFFFF", animation: "rise .5s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <BotPresence bot={atlas} size={26} state="rest" />
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <h2 id="wk-t" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Tu semana con el equipo"}</h2>
            <span style={{ fontSize: "13px", color: "#B8BBC4" }}>{range + " · te lo resume " + (atlas.name || "Atlas")}</span>
          </div>
        </div>
        <button type="button" onClick={() => { try { localStorage.setItem(key, "1"); } catch {} setDismissed(true); }} style={{ ...pill, border: "0", background: "rgba(255,255,255,.1)", color: "#FFFFFF", cursor: "pointer" }}>{"Leído"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
        {stat(week.done, week.done === 1 ? "tarea terminada" : "tareas terminadas")}
        {stat(week.approved, week.approved === 1 ? "cosa aprobaste tú" : "cosas aprobaste tú")}
        {stat(week.skills, week.skills === 1 ? "habilidad nueva por revisar" : "habilidades nuevas por revisar")}
        {stat(spend.n, spend.label)}
      </div>
      {week.happened.length || week.soon.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "18px" }}>
          {week.happened.length ? list("Lo que ha pasado", week.happened) : null}
          {week.soon.length ? list("Lo que viene", week.soon) : null}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {week.skills ? <a href="/biblioteca/habilidades" style={{ ...pill, background: "#FFFFFF", color: "#12131A" }}>{"Revisar las habilidades"}</a> : null}
        <a href="/trabajo/objetivos" style={{ ...pill, background: "rgba(255,255,255,.1)", color: "#FFFFFF" }}>{"Ver objetivos"}</a>
      </div>
    </section>
  );
}
