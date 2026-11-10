import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import TrabajoHeader, { BotDot, trabajoMain } from "../components/v3/TrabajoHeader.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { needsYou, roomUrl, time } from "../lib/format.js";
import { useExpert } from "../lib/expert.js";
import { scrollBehavior } from "../lib/motion.js";

// Colmena 3 · Trabajo › Tareas (design/V3Tareas.dc.html): everything the bots do once, as a
// board (what needs you → under way → stuck → done this week) or a list. Tasks are the
// missions that are not chats. «Nueva tarea» (and ?nueva=1, the sidebar's «Nuevo › Tarea»)
// opens a short sheet: what to do, who does it (or Atlas decides) and by when.

const RUNNING = new Set(["queued", "planning", "running", "paused"]);
const STUCK = new Set(["blocked", "failed"]);
const S = {
  wait: { status: "Te necesita", sBg: "#FFC93C", sInk: "#12131A" },
  run: { status: "En marcha", sBg: "#EEF0F4", sInk: "#1F4FD1" },
  pause: { status: "En pausa", sBg: "#F1F1EC", sInk: "#4A4D57" },
  stuck: { status: "Atascada", sBg: "#FBE9EA", sInk: "#B4232A" },
  done: { status: "Hecha", sBg: "#E3F4EC", sInk: "#0B6B4A" },
};
const VIEWS = [["board", "Tablero"], ["list", "Lista"]];
const ZERO_WIDTH = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };

const at = (m) => Date.parse(m.updatedAt || m.createdAt || 0) || 0;
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sameDay = (a, b) => a.toDateString() === b.toDateString();
/** Monday 00:00 of this week. */
function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
/** «hoy 17:00», «mañana», «martes 18:00», «12 nov» — the boards' short dates. */
function dayLabel(iso, withTime = true) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
  const t = withTime ? " " + time(iso) : "";
  if (days === 0) return "hoy" + t;
  if (days === -1) return "ayer" + t;
  if (days === 1) return "mañana" + t;
  if (Math.abs(days) < 7) return d.toLocaleDateString("es-ES", { weekday: "long" }) + t;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
}
function took(m) {
  const ms = Date.parse(m.completedAt || 0) - Date.parse(m.createdAt || 0);
  if (!(ms > 0)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return "menos de 1 min";
  if (min < 90) return min + " min";
  const h = Math.round(min / 60);
  return h < 36 ? h + " h" : Math.round(h / 24) + " días";
}
const columnOf = (m) => (m.status === "completed" ? "done" : STUCK.has(m.status) ? "stuck" : needsYou(m) || m.questionCount > 0 ? "wait" : RUNNING.has(m.status) ? "run" : "wait");

/** What it is doing now, in one sentence. */
function nowText(m, col) {
  if (col === "done") return m.recap?.text || m.activityLine || "Terminada";
  if (col === "stuck") return m.error || m.activityLine || "Se ha atascado. Mira qué pasa.";
  if (col === "wait") {
    if (m.status === "awaiting_plan") return "Atlas espera que apruebes el plan";
    if (m.status === "awaiting_choice") return "Hay propuestas listas: elige una";
    if (m.questionCount > 0) return m.questionCount === 1 ? "Tiene una pregunta para ti" : `Tiene ${m.questionCount} preguntas para ti`;
    if (m.pendingCount > 0) return m.pendingCount === 1 ? "Una cosa espera tu OK" : `${m.pendingCount} cosas esperan tu OK`;
    return m.activityLine || m.statusLabel || "Te espera";
  }
  if (m.status === "paused") return m.error || "En pausa. Seguirá donde lo dejó.";
  return m.narration?.text || m.activityLine || m.statusLabel || "En marcha";
}

export default function Tareas({ query = {} }) {
  const { missions = [], bots = [], ready } = useStore();
  const [expert] = useExpert();
  const [view, setView] = useState(() => (query.vista === "lista" ? "list" : "board"));
  const [q, setQ] = useState("");
  const [botId, setBotId] = useState(query.bot || null);
  const [menu, setMenu] = useState(false);
  const [kept, setKept] = useState(false);
  const [older, setOlder] = useState(false);
  const [creating, setCreating] = useState(query.nueva === "1");
  useEffect(() => { if (query.nueva === "1") setCreating(true); }, [query.nueva]);

  const team = bots.filter((b) => b.enabled !== false && !b.archived);
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const snoozed = (m) => m.archived || (m.snoozedUntil && Date.parse(m.snoozedUntil) > Date.now());
  const all = missions.filter((m) => !m.conversation && m.status !== "cancelled");
  const keptCount = all.filter(snoozed).length;
  const shown = useMemo(() => all
    .filter((m) => (kept ? snoozed(m) : !snoozed(m)))
    .filter((m) => !botId || [...(m.botIds || []), ...(m.chosenBotIds || [])].includes(botId))
    .filter((m) => !q.trim() || fold([m.title, m.room, m.prompt].join(" ")).includes(fold(q.trim())))
    .sort((a, b) => (Date.parse(a.dueAt || 0) || Infinity) - (Date.parse(b.dueAt || 0) || Infinity) || at(b) - at(a)), [missions, kept, botId, q]);

  const monday = weekStart();
  const item = (m) => {
    const col = columnOf(m);
    const total = m.progress?.total || 0;
    const pct = col === "done" ? 100 : total ? Math.round((100 * Math.min(m.progress.done || 0, total)) / total) : 0;
    const ids = [...new Set([...(m.botIds || []), ...(m.chosenBotIds || [])])];
    const list = (ids.length ? ids : ["atlas"]).map(botOf).filter(Boolean).slice(0, 5);
    const due = m.dueAt ? dayLabel(m.dueAt) : null;
    const meta = col === "done"
      ? [dayLabel(m.completedAt || m.updatedAt, sameDay(new Date(m.completedAt || m.updatedAt || 0), new Date())), took(m)].filter(Boolean).join(" · ")
      : [due || "sin fecha", m.room ? "#" + m.room : null, m.automationId ? "rutina" : null].filter(Boolean).join(" · ");
    const state = col === "run" && m.status === "paused" ? S.pause : S[col];
    return {
      m, col, ...state, pct: pct + "%", showBar: col !== "done" && total > 0,
      now: nowText(m, col), meta, due: col === "done" ? dayLabel(m.completedAt, false) : due || "—",
      bots: list.map((b) => ({ b, work: col === "run" && m.status !== "paused" && b.status === "trabaja" })),
      href: m.status === "awaiting_choice" ? roomUrl(m) : `/encargo/${m.id}`,
    };
  };
  const items = shown.map(item);
  const doneAll = items.filter((t) => t.col === "done").sort((a, b) => Date.parse(b.m.completedAt || 0) - Date.parse(a.m.completedAt || 0));
  const doneWeek = doneAll.filter((t) => Date.parse(t.m.completedAt || 0) >= +monday);
  const doneOlder = doneAll.filter((t) => !doneWeek.includes(t));
  const cols = [
    { id: "wait", title: "Te necesitan", bg: "#FFF1C7", badgeBg: "#FFC93C", items: items.filter((t) => t.col === "wait"), empty: "Nada te espera. Todo sigue su curso." },
    { id: "run", title: "En marcha", bg: "#EBEBE6", badgeBg: "#FFFFFF", items: items.filter((t) => t.col === "run"), empty: "Ningún bot está con una tarea ahora mismo." },
    { id: "stuck", title: "Atascadas", bg: "#EBEBE6", badgeBg: "#FFFFFF", items: items.filter((t) => t.col === "stuck"), empty: "Ninguna atascada." },
    { id: "done", title: "Hechas esta semana", bg: "#EBEBE6", badgeBg: "#FFFFFF", items: older ? [...doneWeek, ...doneOlder] : doneWeek, n: doneWeek.length, empty: "Esta semana aún no ha terminado ninguna." },
  ];
  const flat = [...cols[0].items, ...cols[1].items, ...cols[2].items, ...doneAll];
  const picked = botId ? botOf(botId) : null;
  const go = (href) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(href); };

  const card = (t) => (
    <a key={t.m.id} href={t.href} onClick={go(t.href)} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "16px", background: "#FFFFFF", color: "#12131A", boxShadow: "0 1px 2px rgba(18,19,26,.05)", opacity: t.col === "done" && !doneWeek.includes(t) ? 0.75 : 1 }}>
      <span style={{ fontSize: "15px", fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere" }}>{t.m.title}</span>
      <span style={{ fontSize: "13.5px", lineHeight: 1.4, color: "#4A4D57", display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.now}</span>
      {t.showBar ? (
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span aria-hidden="true" style={{ position: "relative", flex: 1, height: "4px", borderRadius: "2px", background: "#ECECE7", overflow: "hidden" }}><span style={{ position: "absolute", inset: "0 auto 0 0", width: t.pct, borderRadius: "2px", background: "#12131A" }} /></span>
          <span style={{ fontSize: "12px", color: "#5C606C", fontVariantNumeric: "tabular-nums" }}>{t.pct}</span>
        </span>
      ) : null}
      <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "#5C606C" }}>
        {t.bots.map(({ b, work }) => <BotDot key={b.id} bot={b} work={work} />)}
        <span style={{ marginLeft: "4px", minWidth: 0 }}>{t.meta}</span>
      </span>
      {expert ? <span style={{ font: "400 11.5px/1.3 'Geist Mono', monospace", color: "#5C606C" }}>{`${t.m.mode} · ${t.m.status}${t.m.progress?.total ? ` · ${t.m.progress.done || 0}/${t.m.progress.total} pasos` : ""}`}</span> : null}
    </a>
  );

  return (
    <Shell active="trabajo">
      <main style={trabajoMain("1180px")}>
        <TrabajoHeader tab="tareas" action={{ label: "Nueva tarea", onClick: () => setCreating(true) }} />

        {creating ? <NewTask team={team} onClose={() => { setCreating(false); if (query.nueva) navigate("/trabajo", { replace: true }); }} /> : null}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <label style={{ flex: "1 1 260px", display: "flex", alignItems: "center", gap: "10px", height: "40px", padding: "0 14px", borderRadius: "12px", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.08)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C606C" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2" /></svg>
            <span style={ZERO_WIDTH}>Buscar tareas</span>
            <input className="c-bare" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tareas" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "14.5px" }} />
          </label>
          <span style={{ position: "relative" }}>
            <button type="button" aria-haspopup="listbox" aria-expanded={menu} onClick={() => setMenu((o) => !o)} style={{ height: "40px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", cursor: "pointer" }}>
              {picked ? <><BotDot bot={picked} size={12} />{"Con " + picked.name}</> : kept ? "Pospuestas y archivadas" : "Todos los bots"}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {menu ? (
              <>
                <button type="button" aria-label="Cerrar el menú" onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 15, background: "transparent", border: 0, cursor: "default" }} />
                <div role="listbox" aria-label="Filtrar por bot" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 22, width: "min(280px, 82vw)", padding: "6px", display: "flex", flexDirection: "column", gap: "2px", background: "#FFFFFF", borderRadius: "16px", boxShadow: "0 18px 40px rgba(18,19,26,.2)", animation: "rise .2s ease-out" }}>
                  {[{ id: null, name: "Todos los bots" }, ...team].map((b) => {
                    const on = (botId || null) === b.id;
                    return (
                      <button key={b.id || "all"} type="button" role="option" aria-selected={on} onClick={() => { setBotId(b.id); setMenu(false); }} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", padding: "0 10px", border: 0, borderRadius: "10px", background: on ? "#F1F1EC" : "transparent", cursor: "pointer", fontSize: "14px", textAlign: "left" }}>
                        {b.id ? <BotDot bot={b} size={14} /> : <span style={{ width: "14px" }} />}
                        <span style={{ flex: 1 }}>{b.name}{b.role ? <span style={{ color: "#5C606C" }}>{" · " + b.role}</span> : null}</span>
                        {on ? <Check size={15} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                  {keptCount || kept ? (
                    <button type="button" role="option" aria-selected={kept} onClick={() => { setKept((v) => !v); setMenu(false); }} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", marginTop: "4px", padding: "0 10px", border: 0, borderTop: "1px solid rgba(18,19,26,.06)", borderRadius: "10px", background: kept ? "#F1F1EC" : "transparent", cursor: "pointer", fontSize: "14px", textAlign: "left" }}>
                      <span style={{ width: "14px" }} />
                      <span style={{ flex: 1 }}>{kept ? "Volver a las activas" : `Pospuestas y archivadas · ${keptCount}`}</span>
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </span>
          <div role="radiogroup" aria-label="Vista" style={{ display: "inline-flex", padding: "4px", gap: "2px", borderRadius: "999px", background: "#EBEBE6" }}>
            {VIEWS.map(([id, label]) => {
              const on = view === id;
              return <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setView(id)} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "999px", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none", fontSize: "13.5px", fontWeight: 500, cursor: "pointer" }}>{label}</button>;
            })}
          </div>
        </div>

        {!ready ? <div style={{ height: "220px", borderRadius: "22px", background: "#EBEBE6", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}

        {ready && view === "board" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(250px, 100%), 1fr))", gap: "14px", alignItems: "start" }}>
            {cols.map((c) => (
              <section key={c.id} aria-labelledby={"col-" + c.id} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px", borderRadius: "22px", background: c.bg }}>
                <h2 id={"col-" + c.id} style={{ margin: 0, padding: "4px 6px", display: "flex", alignItems: "center", gap: "8px", fontSize: "14.5px", fontWeight: 600 }}>
                  {c.title}
                  <span style={{ minWidth: "22px", height: "22px", padding: "0 7px", display: "grid", placeItems: "center", borderRadius: "11px", background: c.badgeBg, fontSize: "12px", fontWeight: 600 }}>{c.n ?? c.items.length}</span>
                </h2>
                {c.items.length ? c.items.map(card) : <p style={{ margin: 0, padding: "4px 6px 6px", fontSize: "13.5px", lineHeight: 1.45, color: "#5C606C" }}>{c.empty}</p>}
                {c.id === "done" && doneOlder.length ? (
                  <button type="button" onClick={() => setOlder((v) => !v)} style={{ alignSelf: "flex-start", padding: "2px 6px", border: 0, background: "transparent", cursor: "pointer", fontSize: "13.5px", fontWeight: 500, color: "#1F4FD1" }}>
                    {older ? "Ver solo las de esta semana" : `Ver ${doneOlder.length === 1 ? "la anterior" : `las ${doneOlder.length} anteriores`}`}
                  </button>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}

        {ready && view === "list" ? (
          <div style={{ display: "flex", flexDirection: "column", borderRadius: "22px", background: "#FFFFFF", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: "16px", padding: "12px 20px", background: "#F6F6F3", fontSize: "12.5px", fontWeight: 600, color: "#4A4D57" }}><span>Tarea</span><span>Estado</span><span>Quién</span><span>Entrega</span></div>
            {flat.length ? flat.map((t) => (
              <a key={t.m.id} href={t.href} onClick={go(t.href)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: "16px", alignItems: "center", minHeight: "56px", padding: "8px 20px", borderTop: "1px solid rgba(18,19,26,.06)", color: "#12131A", fontSize: "14.5px" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{t.m.title}</span>
                  <span style={{ fontSize: "13px", color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.now}</span>
                </span>
                <span><span style={{ height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: t.sBg, color: t.sInk, fontSize: "12px", fontWeight: 600 }}>{t.status}</span></span>
                <span style={{ display: "flex", gap: "4px" }}>{t.bots.map(({ b, work }) => <BotDot key={b.id} bot={b} size={16} work={work} />)}</span>
                <span style={{ color: "#4A4D57" }}>{t.due}{expert ? <span style={{ display: "block", font: "400 11.5px/1.3 'Geist Mono', monospace", color: "#5C606C" }}>{t.m.status}</span> : null}</span>
              </a>
            )) : <p style={{ margin: 0, padding: "20px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14.5px", color: "#5C606C" }}>{q || botId ? "Ninguna tarea coincide." : "Aún no hay tareas. Pide algo con «Nueva tarea»."}</p>}
          </div>
        ) : null}
      </main>
    </Shell>
  );
}

/** «Nueva tarea»: what to do, who (or Atlas decides) and by when. Starts it and opens it. */
function NewTask({ team, onClose }) {
  const [text, setText] = useState("");
  const [who, setWho] = useState([]);
  const [due, setDue] = useState("");
  const act = useAction();
  const box = useRef(null);
  useEffect(() => { box.current?.focus(); box.current?.scrollIntoView({ block: "center", behavior: scrollBehavior() }); }, []);
  const atlas = team.find((b) => b.id === "atlas");
  const helpers = team.filter((b) => b.id !== "atlas");
  const toggle = (id) => setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id].slice(0, 4)));
  const ok = text.trim().length >= 3;
  const start = () => act.act(async () => {
    if (!ok) return;
    const body = { prompt: text.trim(), safety: "preguntar", ...(due ? { dueAt: new Date(due + "T18:00:00").toISOString() } : {}), ...(who.length === 1 ? { mode: "solo", botIds: who } : { mode: "equipo", botIds: who }) };
    const m = await post("/missions", body);
    if (m?.id) navigate(`/encargo/${m.id}`);
  });
  const whoText = who.length === 0 ? `${atlas?.name || "Atlas"} decide quién lo hace` : who.length === 1 ? `${team.find((b) => b.id === who[0])?.name} se encarga` : `${atlas?.name || "Atlas"} lo reparte entre ${who.map((id) => team.find((b) => b.id === id)?.name).join(" y ")}`;
  const chip = (on) => ({ height: "40px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: `1.5px solid ${on ? "#12131A" : "rgba(18,19,26,.1)"}`, borderRadius: "12px", background: "#FFFFFF", fontSize: "14px", cursor: "pointer" });
  return (
    <section className="c-ring" aria-labelledby="nt-t" style={{ display: "flex", flexDirection: "column", gap: "18px", padding: "26px 28px", borderRadius: "26px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 56px -34px rgba(18,19,26,.4)", animation: "sheet .4s cubic-bezier(.2,.8,.2,1)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <h2 id="nt-t" style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>Nueva tarea</h2>
        <span style={{ fontSize: "13.5px", color: "#5C606C" }}>Algo que se hace una vez, con su plan y su entrega.</span>
      </div>
      <label style={{ display: "flex" }}>
        <span style={ZERO_WIDTH}>Qué hay que hacer</span>
        <textarea className="c-bare" ref={box} rows={2} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) start(); if (e.key === "Escape") onClose(); }}
          placeholder="Prepara el informe del trimestre para el comité del miércoles"
          style={{ flex: 1, minWidth: 0, padding: "4px 0", border: 0, resize: "none", background: "transparent", font: "500 clamp(22px, 2.4vw, 28px)/1.4 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", color: "#12131A" }} />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "18px", background: "#F6F6F3" }}>
        <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Quién lo hace <span style={{ fontWeight: 400, color: "#5C606C" }}>{"· " + whoText}</span></span>
        <div role="group" aria-label="Quién lo hace" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" aria-pressed={!who.length} onClick={() => setWho([])} style={chip(!who.length)}>{atlas ? <BotDot bot={atlas} size={16} /> : null}<span style={{ fontWeight: 600 }}>{atlas?.name || "Atlas"}</span><span style={{ color: "#5C606C" }}>decide</span></button>
          {helpers.map((b) => (
            <button key={b.id} type="button" aria-pressed={who.includes(b.id)} onClick={() => toggle(b.id)} style={chip(who.includes(b.id))}><BotDot bot={b} size={16} /><span style={{ fontWeight: 600 }}>{b.name}</span>{b.role ? <span style={{ color: "#5C606C" }}>{b.role.toLowerCase()}</span> : null}</button>
          ))}
        </div>
        <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", fontSize: "13.5px", fontWeight: 600 }}>
          Para cuándo
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ height: "36px", padding: "0 10px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "10px", background: "#FFFFFF", fontSize: "14px", fontWeight: 400 }} />
          <span style={{ fontWeight: 400, color: "#5C606C" }}>{due ? "" : "opcional"}</span>
        </label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <span role={act.error ? "alert" : undefined} style={{ flex: "1 1 260px", fontSize: "13.5px", color: act.error ? "#B4232A" : "#5C606C" }}>{act.error || "Enviar fuera, pagar, publicar y borrar siempre te preguntan."}</span>
        <button type="button" onClick={onClose} style={{ height: "44px", padding: "0 18px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "15px", fontWeight: 500, cursor: "pointer" }}>Ahora no</button>
        <button type="button" onClick={start} disabled={!ok || act.busy} style={{ height: "44px", padding: "0 22px", border: 0, borderRadius: "999px", background: ok ? "#12131A" : "rgba(18,19,26,.08)", color: ok ? "#FFFFFF" : "#8A8D96", fontSize: "15px", fontWeight: 600, cursor: ok ? "pointer" : "default" }}>{act.busy ? "Empezando…" : "Empezar"}</button>
      </div>
    </section>
  );
}
