import { MenuButton } from "../components/Menu.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, LayoutGrid, Play, Pause, ArrowUp, ChevronDown, Paperclip, X } from "../components/Icon.js";
import BotFace from "../components/BotFace.jsx";
import Shell from "../components/v2/Shell.jsx";
import { botAlt } from "../lib/alt.js";
import { needsOf } from "../components/v2/needs.js";
import { ApprovalNeed, ChoiceNeed, DelegatedNeed, ErrandNeed, GroupNeed, SnoozedNeeds, WatchNeed, recentlyDone } from "../components/v3/dia/Needs.jsx";
import NeedRows from "../components/v3/dia/NeedRows.jsx";
import { CompletionCards } from "../components/v3/dia/Completion.jsx";
import { needEntries } from "../components/v3/dia/needRows.js";
import { Shape, srOnly } from "../components/v3/dia/parts.jsx";
import SetupCard from "../components/v3/dia/Setup.jsx";
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
import { C, line } from "../lib/theme.js";
import { B, CARD, H1, H2, SEC, COUNT, MORE, SIDE_H, ONE, TRACK, WAIT_COUNT, fill } from "../lib/ui4.js";
import { setupSteps } from "../lib/setupSteps.js";
import { aiConnected } from "../lib/aiAccount.js";
import { elapsed, workingNow } from "../lib/workingNow.js";

// Colmena 4 · Inicio (design/v4 proto-inicio): a short greeting and one line (the date, how many
// things wait for you, how many bots work), «Para empezar · N de 4» while setup is incomplete,
// then what needs you as rows on one honey ground (the oldest first; three on screen, «Ver las
// N» for the rest; a row opens its full card in place), the box that asks your team for
// anything (Atlas decides who does it, or you pick the bot), and what is under way. The side
// column says who works right now and what happened today. «Pausar a todo el equipo» and the
// panel of live blocks (/panel) stay at hand in the header.
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
    if (e.type === "delegated") return <DelegatedNeed ask={(store.approvalAsks || []).find((x) => x.id === e.key) || e.item.ask} wide />;
    return <ErrandNeed item={e.item} wide bot={botOf(e.botId)} />;
  };
  // Other people's asks that closed in the last two hours: how they ended, then they go.
  const closedAsks = (store.approvalAsks || []).filter((x) => x.state !== "asked" && x.closedAt && Date.now() - ts(x.closedAt) < 2 * 3600e3);
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
  const hello = greeting().replace(/\.$/, "") + (name ? `, ${name}` : "");
  const now = new Date();
  const working = workingNow(store);
  // «Conecta tu IA» lives in «Para empezar» while the card shows; a failed sign-in still has its notice.
  const setup = setupSteps(store);
  const aiInCard = setup.show && !aiConnected(store) && !store.authError;
  const line1 = [
    capital(now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })),
    n ? <b key="n" style={{ fontWeight: 600, color: C.text }}>{n === 1 ? "1 cosa te espera" : `${n} cosas te esperan`}</b> : "Nada te espera",
    paused ? "el equipo está en pausa" : working.length ? (working.length === 1 ? "1 bot trabajando" : `${working.length} bots trabajando`) : null,
  ].filter(Boolean);

  return (
    <Shell active="inicio" background="var(--c-app)">
      <main style={{ maxWidth: "1180px", margin: "0 auto", padding: "28px clamp(20px, 3.4vw, 40px) 56px", display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "32px 40px" }}>
        <div style={{ flex: "1 1 560px", minWidth: 0, maxWidth: "760px", display: "flex", flexDirection: "column", gap: "28px" }}>
          <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "12px 16px" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0 }}>
              <h1 style={H1}>{hello}</h1>
              <p style={{ margin: "6px 0 0", fontSize: "var(--t-ui)", color: C.text3 }}>
                {line1.map((part, i) => <span key={i}>{i ? " · " : ""}{part}</span>)}
              </p>
            </div>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
              {/* The live blocks you pinned have their own page; here it is one click away. */}
              <a href="/panel" className="u4-ghost" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate("/panel"); }} style={B.ghost}>
                <LayoutGrid size={16} aria-hidden="true" />{"Panel"}{blocks.length ? <span style={{ color: C.text3, fontVariantNumeric: "tabular-nums" }}>{blocks.length}</span> : null}
              </a>
              <button type="button" className="u4-ghost" onClick={togglePause} style={B.ghost}>
                {paused ? <><Play size={16} aria-hidden="true" />{"Reanudar al equipo"}</> : <><Pause size={16} aria-hidden="true" />{"Pausar a todo el equipo"}</>}
              </button>
            </span>
          </header>

          {/* System notices, in neutral: «Sin cuenta de IA» and the plan limit are not on the list of what waits for you. Both hide themselves. */}
          {aiInCard ? null : <NoAccountNotice />}
          <PlanLimitNotice />
          <SetupCard state={store} />

          <section aria-labelledby="need-t">
            <div style={SEC}>
              <h2 id="need-t" style={H2}>{"Te necesitan"}</h2>
              {n ? <span style={WAIT_COUNT}>{n}</span> : null}
              {n > 1 ? <span style={{ ...COUNT, marginLeft: "auto" }}>{"Lo más antiguo, primero"}</span> : null}
            </div>
            {!n && !settled.length ? (
              <div style={{ ...CARD, display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px" }}>
                <BotFace bot={botOf("atlas") || { id: "atlas", shape: "hex", role: "Coordinador" }} size={32} state="rest" decorative />
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{"Nada te espera"}</strong>
                  <span style={{ fontSize: "var(--t-meta)", color: C.text3 }}>{"Tu equipo sigue trabajando. Solo te avisaremos si hace falta."}</span>
                </span>
              </div>
            ) : null}
            {entries.length ? <NeedRows entries={entries} card={cardOf} botOf={botOf} roomOf={(id) => { const m = (missions || []).find((x) => x.id === id); return m ? m.room || m.title || "" : ""; }} /> : null}
            {settled.length || closedAsks.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "12px", alignItems: "start", marginTop: "12px" }}>
                {settled.map((d) => <ApprovalNeed key={"done" + d.approval.id} a={d.approval} bot={botOf(d.approval.botId)} mission={missions.find((m) => m.id === d.approval.missionId)} settled={d.text} />)}
                {closedAsks.map((x) => <DelegatedNeed key={"ask" + x.id} ask={x} />)}
              </div>
            ) : null}
            {/* What you put off with «Recordar después»: out of the count, one click away. */}
            <SnoozedNeeds items={snoozed} bots={bots} />
          </section>

          {/* What finished while you were here: what it delivered, how long it took, «Abrir». */}
          <CompletionCards />

          <section id="pedir" aria-label="Pedir algo" style={{ scrollMarginTop: "40px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="c-ring" style={{ ...CARD, padding: "6px 6px 0 16px", boxShadow: C.shadowLift }}>
              <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <label style={{ flex: "1", display: "flex" }}>
                  <span style={srOnly}>{"Pide algo a tu equipo"}</span>
                  <input className="c-bare" ref={input} type="text" value={ask} onChange={(e) => { setAsk(e.target.value); setSent(null); setError(null); }} placeholder={box.placeholder} disabled={box.blocked} aria-describedby={box.blocked ? "pedir-sin-cuenta" : undefined} maxLength={4000}
                    style={{ flex: "1", minWidth: "0", height: "48px", border: "0", background: "transparent", fontSize: "var(--t-read)", color: C.text }} />
                </label>
                <button type="submit" aria-label="Enviar" disabled={busy || !ask.trim() || box.blocked} style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "var(--r-sm)", background: ask.trim() && !box.blocked ? C.btn : C.chip, color: ask.trim() && !box.blocked ? C.btnText : C.text4, cursor: ask.trim() && !box.blocked ? "pointer" : "default", transition: "background .15s ease" }}>
                  <ArrowUp size={18} weight="bold" />
                </button>
              </form>
              {box.blocked ? (
                <p id="pedir-sin-cuenta" style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "10px 10px 12px 0", borderTop: line(), fontSize: "var(--t-meta)", lineHeight: 1.5, color: C.text2 }}>
                  <span style={{ flex: "1 1 320px" }}>{box.note}</span>
                  {/* «Para empezar» or the notice above carries the main button: here it is the quiet way to the same place. */}
                  <a href={box.action.href} className="u4-sec" style={{ ...B.secondary, flex: "none" }}>{box.action.label}</a>
                </p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "6px 6px 8px 0", borderTop: line(), fontSize: "var(--t-meta)", color: C.text3 }}>
                  {/* Who does it: a choice of one, radio items of the app's one menu (components/Menu.js). */}
                  <MenuButton menuLabel="Quién lo hace" placement="bottom-start" className="u4-sec" showTitle={false} openStyle={{ borderColor: C.lineStrong }} style={{ ...B.secondary, gap: "8px", fontWeight: 500, background: C.sunken, borderColor: C.line }}
                    items={() => {
                      const pickBot = (b) => () => { setPicked(b.id === "atlas" ? null : b); requestAnimationFrame(() => input.current?.focus()); };
                      const atlas = team.find((b) => b.id === "atlas");
                      return [
                        atlas ? { label: `${atlas.name} decide quién lo hace`, icon: <Shape bot={atlas} size={20} />, radio: "who", checked: !picked, onSelect: pickBot(atlas) } : null,
                        { group: "O uno en concreto", items: team.filter((b) => b.id !== "atlas").map((b) => ({ label: b.name, icon: <Shape bot={b} size={20} />, meta: b.role || null, radio: "who", checked: picked?.id === b.id, onSelect: pickBot(b) })) },
                      ];
                    }}>
                    <Shape bot={route.bot} size={20} />
                    <span role="status">{route.text}</span>
                    <ChevronDown size={12} weight="bold" />
                  </MenuButton>
                  <button type="button" onClick={attach} className="u4-ghost" style={{ ...B.ghost, fontWeight: 500 }}>
                    <Paperclip size={16} />{"Adjuntar"}
                  </button>
                  {files.map((f, i) => (
                    <span key={f.name + i} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "28px", padding: "0 4px 0 10px", borderRadius: "var(--r-sm)", border: line(), background: C.sunken, fontSize: "var(--t-meta)", color: C.text }}>
                      {f.name}
                      <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="c-hit" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-xs)", background: "transparent", cursor: "pointer", color: C.text3 }}>
                        <X size={12} weight="bold" />
                      </button>
                    </span>
                  ))}
                  <span style={{ marginLeft: "auto", fontSize: "var(--t-caption)", color: C.text4 }}>{"Intro para enviar"}</span>
                </div>
              )}
            </div>
            {sent ? <p role="status" style={{ margin: "0", padding: "0 4px", fontSize: "var(--t-ui)", color: C.okInk, animation: "rise .35s ease-out" }}>{sent}</p> : null}
            {error ? <p role="alert" style={{ margin: "0", padding: "0 4px", fontSize: "var(--t-ui)", color: C.error }}>{error}</p> : null}
            <div style={{ display: box.blocked ? "none" : "flex", flexWrap: "wrap", gap: "6px" }}>
              {IDEAS.map((label) => (
                <button key={label} type="button" className="u4-sec" onClick={() => { setAsk(label); setSent(null); input.current?.focus(); }} style={{ ...B.secondary, fontWeight: 500, color: C.text2, borderColor: C.line }}>{label}</button>
              ))}
            </div>
          </section>

          <section aria-labelledby="run-t">
            <div style={SEC}>
              <h2 id="run-t" style={H2}>{"En marcha"}</h2>
              {running.length ? <span style={COUNT}>{running.length}</span> : null}
              <a href="/trabajo" style={MORE}>{"Ver Trabajo"}</a>
            </div>
            {running.length ? (
              <div style={CARD}>
                {running.map((m, i) => {
                  const p = pct(m);
                  const lead = botOf(m.botIds?.[0]) || botOf("atlas");
                  const waits = needsYou(m);
                  const moving = ["running", "queued", "planning"].includes(m.status);
                  const sub = [lead?.name, m.status === "paused" ? pauseLine(m, { botName: lead?.name }) : m.narration?.text || m.activityLine || m.statusLabel, m.dueAt ? dueLabel(m.dueAt) : null].filter(Boolean).join(" · ");
                  return (
                    <a key={m.id} href={`/encargo/${m.id}`} className="u4-row" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderTop: i ? line() : "0", color: C.text, borderRadius: i === 0 ? "var(--r-md) var(--r-md) 0 0" : i === running.length - 1 ? "0 0 var(--r-md) var(--r-md)" : 0 }}>
                      <BotFace bot={lead} size={32} state={waits ? "wait" : moving ? "work" : m.status === "paused" ? "pause" : "rest"} decorative />
                      <span style={srOnly}>{botAlt(lead, { state: waits ? "wait" : moving ? "work" : null }) + ": "}</span>
                      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "1px" }}>
                        <span style={{ ...ONE, fontSize: "var(--t-ui)", fontWeight: 500 }}>{m.title}</span>
                        <span style={{ ...ONE, fontSize: "var(--t-caption)", color: waits ? C.honeyText : C.text3, fontWeight: waits ? 600 : 400 }}>{waits ? "Te espera · " + sub : sub}</span>
                      </span>
                      <span aria-hidden="true" style={{ ...TRACK, flex: "none", width: "120px" }}><span style={fill(p)} /></span>
                      <span style={{ width: "34px", textAlign: "right", fontSize: "var(--t-caption)", color: C.text3, fontVariantNumeric: "tabular-nums" }}>{p != null ? p + "%" : ""}</span>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p style={{ ...CARD, margin: 0, padding: "14px 16px", fontSize: "var(--t-ui)", color: C.text3 }}>{"Nada en marcha ahora mismo. Pide algo arriba y lo verás aquí mientras se hace."}</p>
            )}
          </section>
        </div>

        <aside aria-label="Ahora y hoy" style={{ flex: "0 1 300px", minWidth: "260px", paddingTop: "6px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <section aria-labelledby="now-t">
            <h2 id="now-t" style={SIDE_H}>{"Trabajando ahora"}</h2>
            {working.length ? (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
                {working.slice(0, 6).map((w) => (
                  <li key={w.bot.id}>
                    <a href={w.href} className="u4-row" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 8px", margin: "0 -8px", borderRadius: "var(--r-sm)", color: C.text }}>
                      <BotFace bot={w.bot} size={24} state="work" decorative />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{w.bot.name}</span>
                        <span style={{ ...ONE, fontSize: "var(--t-caption)", color: C.text3 }}>{w.what}</span>
                      </span>
                      <span style={{ flex: "none", fontSize: "var(--t-caption)", color: C.text3, fontVariantNumeric: "tabular-nums" }}>{elapsed(w.since)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : <p style={{ margin: 0, fontSize: "var(--t-meta)", color: C.text3 }}>{paused ? "El equipo está en pausa." : "Nadie trabaja ahora mismo."}</p>}
          </section>

          <section aria-labelledby="today-t">
            <div style={{ ...SEC, margin: "0 0 4px" }}>
              <h2 id="today-t" style={{ ...SIDE_H, margin: 0 }}>{"Hoy"}</h2>
              <a href="/actividad" style={{ ...MORE, fontSize: "var(--t-caption)" }}>{"Toda la actividad"}</a>
            </div>
            <ol style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column" }}>
              {timeline.done.map((d) => <Moment key={d.key} item={d} done />)}
              {!timeline.done.length ? <li style={{ padding: "7px 0", fontSize: "var(--t-meta)", color: C.text3 }}>{"Aún no ha terminado nada hoy."}</li> : null}
              <li aria-label={`Ahora, ${time(now)}`} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0" }}>
                <span style={{ fontSize: "var(--t-caption)", fontWeight: 600, color: C.text, fontVariantNumeric: "tabular-nums" }}>{"Ahora · " + time(now)}</span>
                <span style={{ flex: "1", height: "1px", background: C.lineStrong }} />
              </li>
              {timeline.later.map((d) => <Moment key={d.key} item={d} />)}
              {!timeline.later.length ? <li style={{ padding: "7px 0", fontSize: "var(--t-meta)", color: C.text3 }}>{"Nada programado para hoy ni mañana."}</li> : null}
            </ol>
          </section>
        </aside>
      </main>
    </Shell>
  );
}

/** One line of «Hoy»: ✓ what finished, ○ what comes. */
function Moment({ item, done = false }) {
  const text = <span style={{ color: done ? C.text2 : C.text }}>{item.text}</span>;
  return (
    <li style={{ display: "flex", alignItems: "baseline", gap: "10px", padding: "7px 0", fontSize: "var(--t-meta)", lineHeight: "1.45" }}>
      <span aria-hidden="true" style={{ flex: "none", alignSelf: "center", width: "16px", height: "16px", display: "grid", placeItems: "center", color: done ? C.okInk : C.text4 }}>{done ? <Check size={16} weight="bold" /> : <Circle size={12} weight="bold" />}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{item.href ? <a href={item.href} className="c-hit" style={{ color: "inherit" }}>{text}</a> : text}</span>
      <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: "var(--t-caption)", fontVariantNumeric: "tabular-nums", color: C.text4 }}>{when(item.at)}</span>
    </li>
  );
}
