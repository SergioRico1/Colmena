import { useClickAway } from "../lib/useClickAway.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, LayoutGrid } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { botAlt } from "../lib/alt.js";
import { needsOf } from "../components/v2/needs.js";
import { ApprovalNeed, ChoiceNeed, ErrandNeed, GroupNeed, SnoozedNeeds, WatchNeed, recentlyDone } from "../components/v3/dia/Needs.jsx";
import NeedRows from "../components/v3/dia/NeedRows.jsx";
import { CompletionCards } from "../components/v3/dia/Completion.jsx";
import { needEntries } from "../components/v3/dia/needRows.js";
import { Shape, sectionTitle, srOnly } from "../components/v3/dia/parts.jsx";
import { routeOf } from "../components/v3/dia/route.js";
import { useResource, useStore } from "../lib/store.jsx";
import { pickFiles, post } from "../lib/api.js";
import { greeting, needsYou, time } from "../lib/format.js";
import { reversible } from "../lib/undoToast.js";
import { navigate } from "../lib/router.jsx";
import { NoAccountNotice } from "../components/v3/States.jsx";
import { askBox } from "../lib/aiAccount.js";
import { draftText } from "../lib/onboarding.js";
import { PlanLimitNotice } from "../components/v2/LimitNotice.jsx";
import { scrollBehavior } from "../lib/motion.js";
import { pauseLine } from "../lib/pauseReason.js";

// Colmena 3 · Inicio does one thing: one sentence says how many things need you, then they
// come first as compact rows in honey (the oldest first; three on screen, «Ver las N» for the
// rest; a row opens its full card in place), then a box asks your team for anything (Atlas
// decides who does it, or you pick the bot), then what is under way beside today's timeline.
// «Pausar a todo el equipo» stays at hand. The panel of live blocks has its own page (/panel,
// «Panel» in the header) and the weekly card lives in Actividad.
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
const ts = (x) => Date.parse(x || 0) || 0;

export default function Hoy({ query = {} }) {
  const store = useStore();
  // Links of v1 (/bandeja?aprobacion=…) open that request in Revisar.
  useEffect(() => { if (query.aprobacion) navigate(`/revisar/${encodeURIComponent(query.aprobacion)}`, { replace: true }); }, [query.aprobacion]);
  const { bots, missions, approvals, automations = [], settings = {}, paused, blocks = [] } = store;
  const goals = useResource("/goals").data;
  const needs = needsOf(store);
  const { asks, snoozed, items } = needs;
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
      if (draft) { setAsk(draftText(draft)); sessionStorage.removeItem("colmena:draft"); }
    } catch {}
  }, []);
  useClickAway(!!menu, (target) => target.closest?.("[data-route-menu]"), () => setMenu(false));

  // Without an AI account the box does not invite a request nobody can do (lib/aiAccount.js).
  const box = askBox(store);
  const send = async () => {
    const prompt = ask.trim();
    if (!prompt || busy || box.blocked) return;
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

  // Everything that needs you, the oldest first, as rows; requests of the same kind in a row
  // from one bot share a row and a card («Aprobar todas»). A row opens its full card in place.
  const settled = recentlyDone().filter((d) => !asks.some((a) => a.id === d.approval.id));
  const entries = needEntries(needs);
  const cardOf = (e) => {
    const mission = missions.find((m) => m.id === e.missionId);
    if (e.type === "group") return <GroupNeed group={e.group} wide bot={botOf(e.botId)} mission={mission} />;
    if (e.type === "approval") return <ApprovalNeed a={e.a} wide bot={botOf(e.botId)} mission={mission} />;
    if (e.type === "note") return <WatchNeed n={e.note} wide bot={botOf(e.botId)} />;
    if (e.type === "choice") return <ChoiceNeed m={e.mission} wide bots={bots} />;
    return <ErrandNeed item={e.item} wide bot={botOf(e.botId)} />;
  };
  // The one count of what waits for you (server/waiting.mjs): every request counts, also inside a shared row.
  const n = items.length;

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
      <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "36px clamp(20px, 4vw, 52px) 72px", display: "flex", flexDirection: "column", gap: "36px" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "rise .5s ease-out" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span style={{ fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>{capital(now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }))}</span>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            {/* The live blocks you pinned have their own page; here it is one click away. */}
            <a href="/panel" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate("/panel"); }} style={{ height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: "var(--r-pill)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .14)", fontSize: "var(--t-ui)", fontWeight: "500", color: "var(--c-text-2)" }}>
              <LayoutGrid size={14} strokeWidth={2.1} aria-hidden="true" />{"Panel"}{blocks.length ? <span style={{ color: "var(--c-text-3)", fontVariantNumeric: "tabular-nums" }}>{blocks.length}</span> : null}
            </a>
            <button type="button" onClick={togglePause} style={{ height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "0", borderRadius: "var(--r-pill)", background: "transparent", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .14)", fontSize: "var(--t-ui)", fontWeight: "500", color: "var(--c-text-2)", cursor: "pointer" }}>
              {paused
                ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>{"Reanudar al equipo"}</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>{"Pausar a todo el equipo"}</>}
            </button>
            </span>
          </div>
          <h1 style={{ margin: "0", maxWidth: "900px", font: "600 clamp(var(--t-display-s), 3.75vw, var(--t-display-l))/1.02 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em", textWrap: "balance" }}>
            {hello + " "}<span style={{ color: "var(--c-display-soft)" }}>{(COUNT[n] || `${n} cosas te necesitan`) + (paused ? "; el equipo está en pausa." : "; lo demás va solo.")}</span>
          </h1>
        </header>

        {/* System notices, in neutral: «Sin cuenta de IA» and the plan limit are not on the list of what waits for you. Both hide themselves. */}
        <NoAccountNotice />
        <PlanLimitNotice />

        <section aria-labelledby="need-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h2 id="need-t" style={sectionTitle}>{"Te necesitan"}</h2>
            {n ? <span style={{ minWidth: "24px", height: "24px", padding: "0 7px", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-honey)", color: "var(--c-honey-ink)", fontSize: "var(--t-meta)", fontWeight: "600" }}>{n}</span> : null}
            <span style={{ marginLeft: "auto", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{n > 1 ? "Lo más antiguo, primero" : n ? "" : "Al día"}</span>
          </div>
          {!n && !settled.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: "18px", padding: "20px 22px", background: "var(--c-card)", borderRadius: "var(--r-xl)", animation: "rise .4s ease-out" }}>
              <span style={{ animation: "drift 5s ease-in-out infinite" }}><BotPresence bot={botOf("atlas") || { shape: "hex", color: "#12131A" }} size={36} state="rest" /></span>
              <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <strong style={{ fontSize: "var(--t-read)", fontWeight: "600" }}>{"Nada te espera."}</strong>
                <span style={{ fontSize: "var(--t-body)", color: "var(--c-text-2)" }}>{"Tu equipo sigue trabajando. Solo te avisaremos si hace falta."}</span>
              </span>
            </div>
          ) : null}
          {entries.length ? <NeedRows entries={entries} card={cardOf} botOf={botOf} roomOf={(id) => { const m = (missions || []).find((x) => x.id === id); return m ? m.room || m.title || "" : ""; }} /> : null}
          {settled.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: "14px", alignItems: "start" }}>
              {settled.map((d) => <ApprovalNeed key={"done" + d.approval.id} a={d.approval} bot={botOf(d.approval.botId)} mission={missions.find((m) => m.id === d.approval.missionId)} settled={d.text} />)}
            </div>
          ) : null}
          {/* What you put off with «Recordar después»: out of the count, one click away. */}
          <SnoozedNeeds items={snoozed} bots={bots} />
        </section>

        {/* What finished while you were here: what it delivered, how long it took, «Abrir». */}
        <CompletionCards />

        <section id="pedir" aria-label="Pedir algo" style={{ scrollMarginTop: "40px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="c-ring" style={{ background: "var(--c-card)", borderRadius: "var(--r-2xl)", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 28px 64px -34px rgba(18,19,26,.35)", padding: "8px 8px 0 22px" }}>
            <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <label style={{ flex: "1", display: "flex" }}>
                <span style={srOnly}>{"Pide algo a tu equipo"}</span>
                <input className="c-bare" ref={input} type="text" value={ask} onChange={(e) => { setAsk(e.target.value); setSent(null); setError(null); }} placeholder={box.placeholder} disabled={box.blocked} aria-describedby={box.blocked ? "pedir-sin-cuenta" : undefined} maxLength={4000}
                  style={{ flex: "1", minWidth: "0", height: "60px", border: "0", background: "transparent", fontSize: "var(--t-title)", letterSpacing: "-0.01em" }} />
              </label>
              <button type="submit" aria-label="Enviar" disabled={busy || !ask.trim() || box.blocked} style={{ width: "46px", height: "46px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "var(--r-circle)", background: box.blocked ? "#C9CBD1" : "var(--c-btn)", color: "var(--c-btn-text)", cursor: ask.trim() && !box.blocked ? "pointer" : "default", opacity: ask.trim() || busy ? 1 : 0.9 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
              </button>
            </form>
            {box.blocked ? (
              <p id="pedir-sin-cuenta" style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "12px 8px 14px 0", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>
                <span style={{ flex: "1 1 320px" }}>{box.note}</span>
                {/* The notice above carries the main button: here it is the quiet way to the same place. */}
                <a href={box.action.href} style={{ flex: "none", height: "36px", padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .18)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 600, textDecoration: "none" }}>{box.action.label}</a>
              </p>
            ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "10px 8px 12px 0", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
              <span data-route-menu="" style={{ position: "relative" }}>
                <button type="button" aria-haspopup="menu" aria-expanded={menu ? "true" : "false"} onClick={() => setMenu(!menu)} style={{ height: "32px", padding: "0 12px 0 10px", display: "inline-flex", alignItems: "center", gap: "8px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-sunken)", fontSize: "var(--t-ui)", color: "var(--c-text-2)", cursor: "pointer" }}>
                  <Shape bot={route.bot} size={14} />
                  <span role="status">{route.text}</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {menu ? (
                  <div role="menu" aria-label="Quién lo hace" style={{ position: "absolute", zIndex: 20, top: "38px", left: "0", minWidth: "260px", display: "flex", flexDirection: "column", gap: "2px", padding: "6px", borderRadius: "var(--r-lg)", background: "var(--c-card)", boxShadow: "0 2px 6px rgba(18,19,26,.08), 0 24px 48px -20px rgba(18,19,26,.4)", animation: "fade .15s ease-out" }}>
                    {[team.find((b) => b.id === "atlas"), ...team.filter((b) => b.id !== "atlas")].filter(Boolean).map((b) => {
                      const on = b.id === "atlas" ? !picked : picked?.id === b.id;
                      return (
                        <button key={b.id} type="button" role="menuitemradio" aria-checked={on ? "true" : "false"} onClick={() => { setPicked(b.id === "atlas" ? null : b); setMenu(false); input.current?.focus(); }}
                          className="v3-hover" style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", padding: "0 10px", border: "0", borderRadius: "var(--r-md)", background: on ? "var(--c-chip)" : "transparent", textAlign: "left", cursor: "pointer", fontSize: "var(--t-ui)", color: "var(--c-text)" }}>
                          <Shape bot={b} size={14} />
                          <span style={{ flex: "1" }}>{b.id === "atlas" ? `${b.name} decide quién lo hace` : b.name}</span>
                          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{b.id === "atlas" ? "" : b.role}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </span>
              <button type="button" onClick={attach} style={{ height: "32px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "6px", border: "0", borderRadius: "var(--r-pill)", background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text-2)", cursor: "pointer" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="m20 11.5-8.2 8.2a5 5 0 0 1-7-7l8.5-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>{"Adjuntar"}
              </button>
              {files.map((f, i) => (
                <span key={f.name + i} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "28px", padding: "0 4px 0 10px", borderRadius: "var(--r-pill)", background: "var(--c-sunken)", fontSize: "var(--t-meta)", color: "var(--c-text)" }}>
                  {f.name}
                  <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "transparent", cursor: "pointer", color: "var(--c-text-3)" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </span>
              ))}
              <span style={{ marginLeft: "auto" }}>{"Intro para enviar"}</span>
            </div>
            )}
          </div>
          {sent ? <p role="status" style={{ margin: "0", padding: "0 22px", fontSize: "var(--t-body)", color: "var(--c-ok-ink)", animation: "rise .35s ease-out" }}>{sent}</p> : null}
          {error ? <p role="alert" style={{ margin: "0", padding: "0 22px", fontSize: "var(--t-body)", color: "var(--c-error)" }}>{error}</p> : null}
          <div style={{ display: box.blocked ? "none" : "flex", flexWrap: "wrap", gap: "8px", padding: "0 6px" }}>
            {IDEAS.map((label) => (
              <button key={label} type="button" onClick={() => { setAsk(label); setSent(null); input.current?.focus(); }} style={{ height: "34px", padding: "0 14px", background: "transparent", border: "0", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{label}</button>
            ))}
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(400px, 100%), 1fr))", gap: "40px 28px", alignItems: "start" }}>
          <section aria-labelledby="run-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
              <h2 id="run-t" style={sectionTitle}>{"En marcha"}</h2>
              <a href="/trabajo" style={{ fontSize: "var(--t-ui)", fontWeight: "500", color: "var(--c-accent-ink)" }}>{"Todo el trabajo"}</a>
            </div>
            {running.length ? (
              <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "var(--c-card)" }}>
                {running.map((m, i) => {
                  const p = pct(m);
                  const lead = botOf(m.botIds?.[0]) || botOf("atlas");
                  const waits = needsYou(m);
                  const moving = ["running", "queued", "planning"].includes(m.status);
                  return (
                    <a key={m.id} href={`/encargo/${m.id}`} style={{ display: "flex", gap: "14px", padding: "16px 18px", borderTop: i ? "1px solid rgb(var(--c-ink-rgb) / .06)" : "0", color: "var(--c-text)" }}>
                      <span aria-hidden="true" style={{ flex: "none", width: "24px", height: "24px", margin: "-2px -4px 0", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", boxShadow: waits ? "inset 0 0 0 2px #FFC93C" : "none" }}>
                        <Shape bot={lead} size={14} anim={moving && !waits} />
                      </span>
                      <span style={srOnly}>{botAlt(lead, { state: waits ? "wait" : moving ? "work" : null }) + ": "}</span>
                      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                          <span style={{ flex: "1", minWidth: 0, fontSize: "var(--t-body)", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                          {m.dueAt ? <span style={{ flex: "none", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{dueLabel(m.dueAt)}</span> : null}
                        </span>
                        <span style={{ fontSize: "var(--t-ui)", color: waits ? "var(--c-honey-text)" : "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.status === "paused" ? pauseLine(m, { botName: lead?.name }) : m.narration?.text || m.activityLine || m.statusLabel}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span aria-hidden="true" style={{ position: "relative", flex: "1", height: "4px", borderRadius: "var(--r-xs)", background: "var(--c-chip)", overflow: "hidden" }}>
                            <span style={{ position: "absolute", inset: "0 auto 0 0", width: (p ?? 4) + "%", borderRadius: "var(--r-xs)", background: "#12131A", transition: "width .4s ease" }} />
                          </span>
                          <span style={{ width: "34px", textAlign: "right", fontSize: "var(--t-meta)", color: "var(--c-text-3)", fontVariantNumeric: "tabular-nums" }}>{p != null ? p + "%" : ""}</span>
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p style={{ margin: 0, padding: "18px", background: "var(--c-card)", borderRadius: "var(--r-xl)", fontSize: "var(--t-body)", color: "var(--c-text-2)" }}>{"Nada en marcha ahora mismo. Pide algo arriba y lo verás aquí mientras se hace."}</p>
            )}
          </section>

          <section aria-labelledby="today-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
              <h2 id="today-t" style={sectionTitle}>{"Hoy"}</h2>
              <a href="/actividad" style={{ fontSize: "var(--t-ui)", fontWeight: "500", color: "var(--c-accent-ink)" }}>{"Toda la actividad"}</a>
            </div>
            <ol style={{ margin: "0", padding: "8px 0", listStyle: "none", display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "var(--c-card)" }}>
              {timeline.done.map((d) => <Moment key={d.key} item={d} done />)}
              {!timeline.done.length ? <li style={{ padding: "9px 18px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Aún no ha terminado nada hoy."}</li> : null}
              <li aria-label={`Ahora, ${time(now)}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 18px" }}>
                <span style={{ height: "22px", padding: "0 9px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-caption)", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{"Ahora · " + time(now)}</span>
                <span style={{ flex: "1", height: "1px", background: "rgb(var(--c-ink-rgb) / .14)" }} />
              </li>
              {timeline.later.map((d) => <Moment key={d.key} item={d} />)}
              {!timeline.later.length ? <li style={{ padding: "9px 18px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Nada programado para hoy ni mañana."}</li> : null}
            </ol>
          </section>
        </div>

      </main>
    </Shell>
  );
}

/** One line of «Hoy»: ✓ what finished, ○ what comes. */
function Moment({ item, done = false }) {
  const text = <span style={{ color: done ? "var(--c-text-2)" : "var(--c-text)" }}>{item.text}</span>;
  return (
    <li style={{ display: "flex", alignItems: "baseline", gap: "12px", padding: "9px 18px", fontSize: "var(--t-ui)", lineHeight: "1.45" }}>
      <span style={{ flex: "none", width: "66px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: "var(--c-text-3)" }}>{when(item.at)}</span>
      <span aria-hidden="true" style={{ flex: "none", alignSelf: "center", width: "14px", height: "14px", display: "grid", placeItems: "center", color: done ? "var(--c-ok-ink)" : "var(--c-placeholder)" }}>{done ? <Check size={14} strokeWidth={2.8} /> : <Circle size={11} strokeWidth={2.8} />}</span>
      {item.href ? <a href={item.href} className="c-hit" style={{ color: "inherit", minWidth: 0 }}>{text}</a> : text}
    </li>
  );
}
