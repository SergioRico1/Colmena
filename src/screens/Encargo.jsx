import { useMemo } from "react";
import { RotateCw } from "../components/Icon.js";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { ChoiceCard, NeedCard } from "../components/v2/NeedCard.jsx";
import { BotDot } from "../components/v3/TrabajoHeader.jsx";
import NotFound from "./NotFound.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { useExpert } from "../lib/expert.js";
import { findBot } from "../components/room/common.jsx";
import { needsYou } from "../lib/format.js";
import { isTask } from "../lib/rooms.js";
import { pauseReason } from "../lib/pauseReason.js";
import { verbLabel } from "../components/room/working.js";
import Markdown from "../components/room/Markdown.jsx";

// Colmena 3 · Trabajo › Tareas › una tarea (design/V3Tarea.dc.html): how a piece of work goes —
// the plan with who does each part, what is being done right now (in sentences, with the
// time), its story; on the side the others meanwhile, what already exists and, when it was
// cut, how it resumed. Pause and talk from the header. Expert mode adds the tool calls.
const STAGE = new Set(["work", "solo", "synthesis", "proposal", "followup"]);
const DONE = new Set(["completed", "done"]);
const card = { background: "var(--c-card)", borderRadius: "var(--r-2xl)" };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function dayTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoy " + hhmm(iso);
  if (new Date(Date.now() - 864e5).toDateString() === d.toDateString()) return "Ayer " + hhmm(iso);
  if (today - d < 6 * 864e5) return cap(d.toLocaleDateString("es-ES", { weekday: "long" })) + " " + hhmm(iso);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
}
function dueText(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 864e5);
  const at = "a las " + hhmm(iso);
  if (days === 0) return "hoy " + at;
  if (days === 1) return "mañana " + at;
  if (days > 1 && days < 7) return "el " + d.toLocaleDateString("es-ES", { weekday: "long" }) + " " + at;
  return "el " + d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
}
/** «lleva 12 min», «lleva 3 h», «desde el lunes 09:10». */
function since(from) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(from || 0)) / 60000));
  if (min < 60) return `lleva ${min} min`;
  if (min < 24 * 60) return `lleva ${Math.round(min / 60)} h`;
  return "desde " + dayTime(from).toLowerCase();
}
// File badges of «Lo que ya hay» (the board's XLS / PDF / PPT squares).
const EXT = {
  table: ["XLS", "#E3F4EC", "#0B6B4A"], sheet: ["XLS", "#E3F4EC", "#0B6B4A"], csv: ["CSV", "#E3F4EC", "#0B6B4A"], xlsx: ["XLS", "#E3F4EC", "#0B6B4A"],
  pdf: ["PDF", "#FBE9EA", "#B4232A"], slides: ["PPT", "#FFE9DC", "#C2410C"], pptx: ["PPT", "#FFE9DC", "#C2410C"],
  design: ["IMG", "#FDE7F1", "#B0306A"], png: ["IMG", "#FDE7F1", "#B0306A"], svg: ["SVG", "#FDE7F1", "#B0306A"],
  code: ["COD", "#EEF0F4", "#1F4FD1"], doc: ["DOC", "#E3EBFF", "#1F4FD1"], docx: ["DOC", "#E3EBFF", "#1F4FD1"], document: ["DOC", "#E3EBFF", "#1F4FD1"],
};
const extOf = (a) => EXT[a.format] || EXT[a.kind] || ["DOC", "#E3EBFF", "#1F4FD1"];
const KIND = { table: "Hoja", sheet: "Hoja", doc: "Documento", document: "Documento", design: "Diseño", code: "Código", slides: "Diapositivas" };
const go = (href) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(href); };

export default function Encargo({ params = {} }) {
  const { bots, missions = [], ready } = useStore();
  const [expert] = useExpert();
  const room = useRoom(params.id);
  const { mission: m, steps, messages, artifacts, pending, activity } = room;
  const goals = useResource("/goals");
  const control = useAction();
  const moving = useAction();
  const story = useMemo(() => {
    if (!m) return [];
    const out = [];
    const first = messages.find((x) => x.role === "user");
    if (first) out.push({ at: first.at, text: `Pediste «${String(first.text).replace(/\s+/g, " ").slice(0, 120)}»${m.room ? ` en #${m.room}` : ""}.` });
    for (const s of steps) if (s.completedAt && DONE.has(s.status) && STAGE.has(s.kind)) out.push({ at: s.completedAt, text: `${findBot(bots, s.botId)?.name || "Un bot"} terminó «${s.title}».` });
    for (const x of messages) if (x.role === "user" && x !== first && x.at) out.push({ at: x.at, text: `Escribiste: «${String(x.text).replace(/\s+/g, " ").slice(0, 100)}»` });
    for (const a of artifacts) if (a.createdAt) out.push({ at: a.createdAt, text: `Se guardó «${a.title}» en la Biblioteca.` });
    return out.filter((x) => x.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
  }, [m, steps, messages, artifacts, bots]);

  if (ready && !room.loading && !m) return <NotFound title="Esta tarea ya no está" text="Puede que se cerrara o que alguien borrara su sala. No se ha perdido nada de lo tuyo." />;
  if (!m) return <Shell active="trabajo"><div /></Shell>;

  const stages = steps.filter((s) => STAGE.has(s.kind) && s.status !== "cancelled" && s.status !== "skipped").slice(0, 6);
  const done = stages.filter((s) => DONE.has(s.status)).length;
  const finished = m.status === "completed";
  const paused = m.status === "paused";
  const blocked = m.status === "blocked" || m.status === "failed";
  const asks = pending.filter((a) => a.kind !== "secret");
  // «Te necesita»: something of this task is on the one list of what waits for you (server/waiting.mjs).
  const waits = needsYou(missions.find((x) => x.id === m.id) || m);
  const pct = finished ? 100 : stages.length ? Math.round((100 * done) / (stages.length + 1)) : m.progress?.total ? Math.round((100 * (m.progress.done || 0)) / m.progress.total) : 0;
  const running = steps.find((s) => s.status === "running") || null;
  const runner = running ? findBot(bots, running.botId) : null;
  const act = runner ? activity.find((a) => a.botId === runner.id) : null;
  const log = (running?.activity || []).slice(-6).map((l) => ({ time: hhmm(l.at), text: l.text || [l.verb, l.detail].filter(Boolean).join(" · ") }));
  const others = stages.filter((s) => s !== running && !DONE.has(s.status));
  const lastArtifact = [...artifacts].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null;
  const due = dueText(m.dueAt);
  const lead = (m.mode === "solo" ? findBot(bots, m.botIds?.[0]) : null) || findBot(bots, "atlas") || findBot(bots, m.botIds?.[0]);
  const goal = (Array.isArray(goals.data) ? goals.data : []).find((g) => (g.milestones || []).some((x) => (x.missionIds || []).includes(m.id))) || null;
  const toggle = () => control.act(() => post(`/missions/${m.id}/control`, { action: paused ? "resume" : "pause" }));
  // A task is never cited as a room; «Mover a Salas» is the way back for one that was a room.
  const task = isTask(missions.find((x) => x.id === m.id) || m) && !m.conversation;
  // Opened once the state says it is a room (run refreshes it), so /sala/:id does not send it back here.
  const toRooms = async () => { if (await moving.act(async () => { await patch(`/missions/${m.id}`, { kind: "sala" }); return true; })) navigate(`/sala/${m.id}`); };
  // The conversation of a task: /sala/<task> opens its page, so the link says it wants the conversation.
  const talk = task ? `/sala/${m.id}?conversacion=1` : `/sala/${m.id}`;
  const state = finished ? { text: "Hecha", bg: "#E3F4EC", ink: "#0B6B4A" }
    : waits ? { text: "Te necesita", bg: "#FFC93C", ink: "#12131A" }
    : blocked ? { text: "Atascada · mira qué pasa", bg: "#FBE9EA", ink: "#B4232A" }
    : paused ? { text: "En pausa · " + (pauseReason(m, { botName: lead?.name })?.why || "seguirá donde lo dejó").replace(/^./, (c) => c.toLowerCase()), bg: "#F1F1EC", ink: "#4A4D57" }
    : { text: "En marcha · va según lo previsto", bg: "#EEF0F4", ink: "#1F4FD1" };
  const browsing = runner && /naveg|formulario|ordenador/i.test(act?.verb || "");
  const tools = expert && running ? (running.tools || []).slice(-6) : [];
  const plan = [
    ...stages.map((s) => {
      const b = findBot(bots, s.botId);
      const isDone = DONE.has(s.status);
      const now = s.status === "running" && !paused;
      const held = s.status === "running" && paused;
      const wait = s.status === "waiting";
      return {
        key: s.id, part: s.title, bot: b, now, wait,
        bar: isDone ? "#12131A" : now || held ? "linear-gradient(90deg, #12131A 50%, #E6E6E0 50%)" : wait ? "#FFC93C" : "#E6E6E0",
        state: `${b?.name || "Un bot"} · ${isDone ? "hecho" : now ? "ahora" : held ? "en pausa" : wait ? "te espera" : "después"}`,
        ink: isDone ? "#0B6B4A" : now ? "#1F4FD1" : held ? "#4A4D57" : wait ? "#8A5A00" : "#5C606C",
      };
    }),
    ...(finished ? [] : [{ key: "you", part: "Tu revisión", you: true, bar: asks.length ? "#FFC93C" : "#E6E6E0", state: asks.length ? "Tú · te esperan ahora" : "Tú · " + (due || "al terminar"), ink: asks.length ? "#8A5A00" : "#5C606C" }]),
  ];
  const cut = (paused || blocked) && m.error ? m.error : null;

  return (
    <Shell active="trabajo">
      <main style={{ maxWidth: "1160px", margin: "0 auto", padding: "36px clamp(20px, 4vw, 48px) 64px", display: "flex", flexDirection: "column", gap: "26px" }}>
        <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: "var(--c-text-3)", minWidth: 0 }}>
          <a href="/trabajo" onClick={go("/trabajo")} style={{ color: "var(--c-text-3)" }}>Trabajo</a><span aria-hidden="true">›</span>
          <a href="/trabajo/tareas" onClick={go("/trabajo/tareas")} style={{ color: "var(--c-text-3)" }}>Tareas</a><span aria-hidden="true">›</span>
          <span style={{ color: "var(--c-text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
        </nav>

        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
              <span role="status" style={{ height: "28px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "7px", borderRadius: "var(--r-pill)", background: state.bg, fontSize: "var(--t-meta)", fontWeight: 600, color: state.ink }}>
                {waits || finished ? null : <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "var(--r-circle)", background: "currentColor" }} />}
                {state.text}
              </span>
              {goal ? <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Objetivo: <a href={`/trabajo/objetivos/${goal.id}`} onClick={go(`/trabajo/objetivos/${goal.id}`)} style={{ color: "var(--c-accent-ink)" }}>{goal.title}</a></span> : null}
              {expert ? <span style={{ font: "400 var(--t-caption)/1 'Geist Mono', monospace", color: "var(--c-text-3)" }}>{`${m.id} · ${m.mode} · ${m.status}`}</span> : null}
            </div>
            <h1 style={{ margin: 0, font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em", overflowWrap: "anywhere" }}>{m.title}</h1>
            <p style={{ margin: 0, fontSize: "var(--t-read)", color: "var(--c-text-2)" }}>
              {m.automationId ? "La lanzó una rutina" : "Lo pediste"}
              {finished ? ` · terminada ${dayTime(m.completedAt).toLowerCase()}` : due ? ` · entrega ${due}` : " · sin fecha de entrega"}
              {m.room && !task ? <>{" · en "}<a href={`/sala/${m.id}`} onClick={go(`/sala/${m.id}`)} style={{ color: "var(--c-accent-ink)" }}>{"#" + m.room}</a></> : null}
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {finished ? null : <button type="button" disabled={control.busy} onClick={toggle} style={{ height: "42px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-body)", fontWeight: 500, cursor: control.busy ? "wait" : "pointer" }}>{paused ? "Reanudar" : "Pausar la tarea"}</button>}
            {task && !m.automationId ? <button type="button" disabled={moving.busy} onClick={toRooms} style={{ height: "42px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-body)", fontWeight: 500, cursor: moving.busy ? "wait" : "pointer" }}>Mover a Salas</button> : null}
            <a href={talk} onClick={go(talk)} style={{ height: "42px", padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: 600 }}>Hablar con el equipo</a>
          </div>
        </header>
        {moving.error ? <p role="alert" style={{ margin: "-14px 0 0", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{moving.error}</p> : null}
        {control.error ? <p role="alert" style={{ margin: "-14px 0 0", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{control.error}</p> : null}

        {plan.length > 1 || stages.length ? (
          <section aria-label="Plan" style={{ ...card, display: "flex", flexDirection: "column", gap: "16px", padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
              <h2 style={{ margin: 0, fontSize: "var(--t-body)", fontWeight: 600 }}>{`El plan de ${lead?.name || "Atlas"}`}</h2>
              <span style={{ font: "600 var(--t-headline)/1 'Bricolage Grotesque', sans-serif" }}>{pct + " %"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: "10px" }}>
              {plan.map((p) => (
                <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
                  <span aria-hidden="true" style={{ height: "6px", borderRadius: "var(--r-xs)", background: p.bar }} />
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    {p.you
                      ? <span aria-hidden="true" style={{ flex: "none", width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-micro)", fontWeight: 600 }}>TÚ</span>
                      : <BotDot bot={p.bot} size={18} work={p.now} />}
                    <span style={{ fontSize: "var(--t-ui)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.part}>{p.part}</span>
                  </div>
                  <span style={{ fontSize: "var(--t-meta)", color: p.ink }}>{p.state}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {asks.length || m.status === "awaiting_choice" ? (
          <section aria-label="Te necesitan" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px, 100%), 1fr))", gap: "18px", alignItems: "start" }}>
            {m.status === "awaiting_choice" ? <ChoiceCard m={m} bots={bots} /> : null}
            {asks.map((a) => <NeedCard key={a.id} a={a} bot={findBot(bots, a.botId)} mission={m} />)}
          </section>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
          <div style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "20px" }}>
            {running || paused ? (
              <section aria-labelledby="now-t" style={{ ...card, display: "flex", flexDirection: "column", gap: "16px", padding: "22px 24px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 50px -34px rgba(18,19,26,.4)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
                  <BotDot bot={runner || lead} size={26} work={!!runner && !paused} />
                  <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <h2 id="now-t" style={{ margin: 0, fontSize: "var(--t-read)", fontWeight: 600 }}>
                      {runner && !paused ? `Ahora mismo, ${runner.name} está ${act?.verb ? verbLabel(act.verb).toLowerCase() : "con «" + running.title + "»"}` : "La tarea está en pausa"}
                    </h2>
                    <span role="status" style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{paused ? "Nadie más se ve afectado. Seguirá donde lo dejó." : running?.narration?.text || (running?.startedAt ? since(running.startedAt) : "Trabajando")}</span>
                  </div>
                  {runner ? <a href={`/chat/${runner.id}`} onClick={go(`/chat/${runner.id}`)} style={{ fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-accent-ink)" }}>{`Hablar con ${runner.name}`}</a> : null}
                </div>
                {runner && !paused ? (
                  <span aria-hidden="true" style={{ position: "relative", height: "2px", borderRadius: "var(--r-xs)", background: "var(--c-chip)", overflow: "hidden" }}><span style={{ position: "absolute", top: 0, bottom: 0, width: "35%", background: runner.color || "#12131A", animation: "sweep 1.8s ease-in-out infinite" }} /></span>
                ) : null}
                {browsing ? (
                  <a href={`/ordenador/${m.id}?bot=${encodeURIComponent(runner.id)}`} onClick={go(`/ordenador/${m.id}?bot=${encodeURIComponent(runner.id)}`)} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "8px", height: "36px", padding: "0 14px", borderRadius: "var(--r-pill)", background: "var(--c-chip)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 600 }}>
                    <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "var(--r-circle)", background: "#B4232A", animation: "breathe 1.4s ease-in-out infinite" }} />
                    Ver su navegador en directo
                  </a>
                ) : null}
                {log.length ? (
                  <ol aria-label="Lo que está haciendo" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {log.map((l, i) => (
                      <li key={i} style={{ display: "flex", gap: "12px", fontSize: "var(--t-ui)", lineHeight: 1.45, animation: "rise .4s ease-out" }}>
                        <span style={{ flex: "none", width: "42px", color: "var(--c-text-3)", fontVariantNumeric: "tabular-nums" }}>{l.time}</span>
                        <span style={{ color: i === log.length - 1 ? "var(--c-text)" : "var(--c-text-2)" }}>{l.text}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {tools.length ? (
                  <div aria-label="Herramientas" style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--c-hover)", font: "400 var(--t-meta)/1.5 'Geist Mono', monospace", color: "var(--c-text-2)" }}>
                    {tools.map((t) => <span key={t.id} style={{ display: "flex", gap: "10px" }}><span style={{ color: "var(--c-text)", fontWeight: 500 }}>{t.name}</span><span style={{ color: t.status === "error" ? "var(--c-error)" : "var(--c-text-3)" }}>{t.error || t.status}</span></span>)}
                  </div>
                ) : null}
                {running?.text || lastArtifact ? (
                  <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: "12px", padding: "18px", borderRadius: "var(--r-xl)", background: "var(--c-hover)" }}>
                    <figcaption style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "var(--t-ui)", fontWeight: 600 }}>
                      {running?.text ? "Lo que lleva escrito" : "Lo último que ha salido"}
                      {!running?.text && lastArtifact.createdAt ? <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{dayTime(lastArtifact.createdAt)}</span> : null}
                    </figcaption>
                    {running?.text
                      ? <div style={{ maxHeight: "260px", overflow: "hidden", WebkitMaskImage: "linear-gradient(#000 70%, transparent)", maskImage: "linear-gradient(#000 70%, transparent)" }}><Markdown text={running.text} size={15} /></div>
                      : <a href={`/biblioteca?abrir=${encodeURIComponent(lastArtifact.id)}`} style={{ fontSize: "var(--t-body)", fontWeight: 600, color: "var(--c-text)" }}>{lastArtifact.title}</a>}
                  </figure>
                ) : null}
              </section>
            ) : null}

            {finished && m.recap?.text ? (
              <section aria-label="Resumen" style={{ ...card, display: "flex", gap: "14px", alignItems: "flex-start", padding: "22px 24px" }}>
                <BotPresence bot={lead} size={26} state="rest" />
                <div style={{ minWidth: 0, fontSize: "var(--t-read)", lineHeight: 1.55 }}><Markdown text={m.recap.text} size={16} /></div>
              </section>
            ) : null}

            {story.length ? (
              <section aria-labelledby="his-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h2 id="his-t" style={{ margin: 0, font: "600 var(--t-title)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Historia</h2>
                <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "var(--c-card)", padding: "6px 0" }}>
                  {story.map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: "14px", padding: "10px 20px", fontSize: "var(--t-ui)", lineHeight: 1.45 }}>
                      <span style={{ flex: "none", width: "92px", color: "var(--c-text-3)" }}>{dayTime(e.at)}</span>
                      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{e.text}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
            {others.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "16px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)" }}>
                <h2 style={{ margin: "0 0 6px", fontSize: "var(--t-ui)", fontWeight: 600 }}>Mientras tanto</h2>
                {others.map((s) => {
                  const b = findBot(bots, s.botId);
                  const now = s.status === "running";
                  return (
                    <div key={s.id} style={{ display: "flex", gap: "10px", padding: "6px 0", fontSize: "var(--t-ui)", lineHeight: 1.4 }}>
                      <BotDot bot={b} size={16} work={now && !paused} style={{ marginTop: "2px" }} />
                      <span><strong style={{ fontWeight: 600 }}>{b?.name || "Un bot"}</strong> <span style={{ color: "var(--c-text-2)" }}>{now ? s.narration?.text || "con «" + s.title + "»" : s.status === "waiting" ? "te espera para seguir" : `hará «${s.title}» después`}</span></span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {artifacts.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "16px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <h2 style={{ margin: 0, fontSize: "var(--t-ui)", fontWeight: 600 }}>Lo que ya hay</h2>
                  <a href="/biblioteca" onClick={go("/biblioteca")} style={{ fontSize: "var(--t-meta)", color: "var(--c-accent-ink)" }}>Ver en Biblioteca</a>
                </div>
                {artifacts.map((a) => {
                  const [ext, bg, ink] = extOf(a);
                  return (
                    <a key={a.id} href={`/biblioteca?abrir=${encodeURIComponent(a.id)}`} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "48px", color: "var(--c-text)" }}>
                      <span aria-hidden="true" style={{ flex: "none", width: "32px", height: "32px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: bg, color: ink, fontSize: "var(--t-micro)", fontWeight: 700 }}>{ext}</span>
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                        <span style={{ fontSize: "var(--t-ui)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{[KIND[a.kind] || "Documento", findBot(bots, a.botId)?.name, a.createdAt ? dayTime(a.createdAt).toLowerCase() : null].filter(Boolean).join(" · ")}</span>
                      </span>
                    </a>
                  );
                })}
              </div>
            ) : null}
            {cut ? (
              <div role={blocked ? "alert" : undefined} style={{ display: "flex", gap: "10px", padding: "14px 16px", borderRadius: "var(--r-xl)", background: blocked ? "var(--c-error-soft)" : "var(--c-chip)", fontSize: "var(--t-ui)", lineHeight: 1.45 }}>
                <RotateCw size={15} aria-hidden="true" style={{ flex: "none", marginTop: "2px", color: blocked ? "var(--c-error)" : "var(--c-ok-ink)" }} />
                <span>{cut} {paused ? <strong style={{ fontWeight: 600 }}>Al reanudarla sigue en el punto donde quedó; nada se repite.</strong> : null}</span>
              </div>
            ) : null}
            {!others.length && !artifacts.length && !cut ? (
              <div style={{ padding: "16px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>
                {finished ? "Terminada. Lo que salió queda en la Biblioteca y en su sala." : "Aquí verás quién más trabaja en esta tarea y lo que vaya saliendo."}
              </div>
            ) : null}
          </aside>
        </div>
      </main>
    </Shell>
  );
}
