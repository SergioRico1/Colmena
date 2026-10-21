import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence, gloss, presenceState, shapeOf } from "../components/v2/Presence.jsx";
import { ChoiceCard, NeedCard, WatchCard, recentlyDone } from "../components/v2/NeedCard.jsx";
import { needsOf } from "../components/v2/needs.js";
import { useResource, useStore } from "../lib/store.jsx";
import { pickFiles, post } from "../lib/api.js";
import { greeting, time } from "../lib/format.js";
import { formatTokens } from "../components/settings/format.jsx";
import { mentionedBots } from "../components/home/shared.jsx";
import { navigate } from "../lib/router.jsx";

// Colmena 2.0 · 22 «Hoy» (design/V2Hoy.dc.html): one place to start. Home, the inbox and the
// command palette in one: you write what you need and Atlas decides who does it; below, only
// what needs you (in honey), what is under way, your colmena and what finished this morning.
const COUNT = ["Nada te espera.", "Una cosa te espera.", "Dos cosas te esperan.", "Tres cosas te esperan.", "Cuatro cosas te esperan.", "Cinco cosas te esperan.", "Seis cosas te esperan.", "Siete cosas te esperan.", "Ocho cosas te esperan.", "Nueve cosas te esperan.", "Diez cosas te esperan."];
const WORKING = new Set(["running", "queued", "waiting", "awaiting_plan", "awaiting_choice", "blocked", "paused"]);
const ROLE_WORDS = [
  [/diapositiva|portada|diseñ|imagen|logo|cartel|presentaci/i, ["iris"]],
  [/hoja|cifra|dato|excel|ventas|gasto|compara|presupuesto|factura|tesorer/i, ["tomas"]],
  [/correo|resum|texto|escrib|redact|carta|post/i, ["vera"]],
  [/busca|investiga|estudio|competencia|fuente|noticia|lee /i, ["nora"]],
  [/script|código|codigo|programa|automatiza|macro/i, ["bruno"]],
];

/** Who will take it: a mentioned bot, a bot whose kind of work it clearly is, or Atlas. */
function routeOf(text, bots) {
  const on = bots.filter((b) => b.enabled !== false);
  const atlas = on.find((b) => b.id === "atlas") || { id: "atlas", name: "Atlas", color: "#FFC93C", shape: "hex" };
  const t = String(text || "").trim();
  const named = mentionedBots(t, on).filter((b) => b.id !== "atlas");
  if (named.length === 1) return { bot: named[0], solo: true, text: `${named[0].name} se encargará` };
  if (named.length > 1) return { bot: atlas, solo: false, ids: named.map((b) => b.id), text: "Atlas lo repartirá entre " + named.map((b) => b.name).join(" y ") };
  if (t) for (const [re, ids] of ROLE_WORDS) {
    if (!re.test(t)) continue;
    const bot = on.find((b) => ids.includes(b.id));
    if (bot) return { bot, solo: true, text: `${bot.name} se encargará` };
  }
  return { bot: atlas, solo: false, text: t ? "Atlas decidirá quién lo hace" : "Atlas lo repartirá entre tus bots" };
}

const pct = (m) => (m.progress?.total ? Math.round((100 * (m.progress.done || 0)) / m.progress.total) : null);
const dueLabel = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(d.toDateString()) - new Date(today.toDateString())) / 864e5);
  const at = time(iso);
  if (days === 0) return "hoy " + at;
  if (days === 1) return "mañana " + at;
  if (days > 1 && days < 7) return d.toLocaleDateString("es-ES", { weekday: "long" }) + " " + at;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};
const verbOf = (bot, store) => {
  const act = store.activity?.[bot.id];
  if (act?.verb) return act.verb;
  if (bot.status === "espera") return "te espera";
  if (bot.status === "pausado") return "en pausa";
  if (bot.status === "bloqueado") return "atascado";
  if (bot.status === "trabaja") return "trabajando";
  return "libre";
};
const weekKey = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };
const IDEAS = ["Resume mis correos de hoy", "Prepara mi semana", "Compara las ventas con el mes pasado"];

export default function Hoy({ query = {} }) {
  const store = useStore();
  // Links of v1 (/bandeja?aprobacion=…) open that request in Revisar.
  useEffect(() => { if (query.aprobacion) navigate(`/revisar/${encodeURIComponent(query.aprobacion)}`, { replace: true }); }, [query.aprobacion]);
  const { bots, missions, approvals, artifacts, skills, usage, settings } = store;
  const { asks, choices, notes } = needsOf(store);
  const [ask, setAsk] = useState("");
  const [files, setFiles] = useState([]);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const route = routeOf(ask, bots);
  const botOf = (id) => bots.find((b) => b.id === id) || null;

  // «Pedir» from elsewhere (an old /#pedir link or the colmena:ask event): here, with the box focused.
  useEffect(() => {
    const focus = () => requestAnimationFrame(() => { input.current?.focus(); input.current?.scrollIntoView({ block: "center", behavior: "smooth" }); });
    if (location.hash === "#pedir") focus();
    window.addEventListener("colmena:ask", focus);
    return () => window.removeEventListener("colmena:ask", focus);
  }, []);

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
    try { const picked = await pickFiles(); setFiles((f) => [...f, ...picked].slice(0, 5)); } catch (e) { setError(e.message); }
  };

  const settled = recentlyDone().filter((d) => !asks.some((a) => a.id === d.approval.id));
  const n = asks.length + choices.length + notes.length;
  const running = missions.filter((m) => !m.conversation && !m.archived && WORKING.has(m.status) && !choices.includes(m))
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  const team = bots.filter((b) => b.enabled !== false);
  const morning = new Date().getHours() < 14;
  const today = new Date().toDateString();
  const finished = missions.filter((m) => m.status === "completed" && !m.watch && m.completedAt && new Date(m.completedAt).toDateString() === today)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 6);

  return (
    <Shell active="hoy">
      <main style={{ maxWidth: "1060px", margin: "0 auto", padding: "76px clamp(20px, 4vw, 48px) 40px", display: "flex", flexDirection: "column", gap: "60px" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "14px", animation: "rise .6s ease-out" }}>
          <span style={{ fontSize: "15px", color: "#6B6F7A" }}>{capital(new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }))}</span>
          <h1 style={{ margin: "0", font: "600 clamp(44px, 6.4vw, 76px)/0.98 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>
            {greeting()}
            <br />
            <span style={{ color: "#9A9DA6" }}>{COUNT[n] || `${n} cosas te esperan.`}</span>
          </h1>
        </header>

        <section id="pedir" aria-label="Pedir algo" style={{ scrollMarginTop: "40px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ background: "#FFFFFF", borderRadius: "30px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 30px 70px -30px rgba(18,19,26,.32)", padding: "10px 10px 4px 28px" }}>
            <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <label style={{ flex: "1", display: "flex" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Pide algo a tu colmena"}</span>
                <input ref={input} type="text" value={ask} onChange={(e) => { setAsk(e.target.value); setSent(null); setError(null); }} placeholder="Pide algo a tu colmena…" maxLength={4000}
                  style={{ flex: "1", minWidth: "0", height: "68px", border: "0", outline: "none", background: "transparent", fontSize: "22px", letterSpacing: "-0.01em" }} />
              </label>
              <button type="submit" aria-label="Enviar" disabled={busy} style={{ width: "54px", height: "54px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", cursor: "pointer", color: "#FFFFFF", transition: "background .25s ease, transform .25s ease", background: ask.trim() ? "#12131A" : "#C9CBD1", transform: ask.trim() ? "scale(1)" : "scale(.92)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
              </button>
            </form>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 18px", padding: "12px 8px 12px 0", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px", color: "#5C606C" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span aria-hidden="true" style={{ display: "inline-grid", filter: "drop-shadow(0 2px 3px rgba(18,19,26,.18))", transition: "all .3s ease" }}>
                  <span style={{ display: "block", width: "18px", height: "18px", transition: "all .3s ease", background: gloss(route.bot.color), clipPath: shapeOf(route.bot).clip, borderRadius: shapeOf(route.bot).radius }} />
                </span>
                <span role="status">{route.text}</span>
              </span>
              {files.map((f, i) => (
                <span key={f.name + i} style={{ display: "flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 6px 0 10px", borderRadius: "999px", background: "#F2F2EE", fontSize: "13px", color: "#12131A" }}>
                  {f.name}
                  <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#6B6F7A" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </span>
              ))}
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "14px" }}>
                <button type="button" onClick={attach} style={{ height: "32px", padding: "0 4px", background: "transparent", border: "0", cursor: "pointer", color: "#5C606C", fontSize: "14px" }}>{"Adjuntar"}</button>
                <span title="Busca o pide algo sin salir de donde estés">{"Ctrl+K en cualquier pantalla"}</span>
              </span>
            </div>
          </div>
          {sent ? <p role="status" style={{ margin: "0", padding: "0 28px", fontSize: "15px", color: "#0B6B4A", animation: "rise .35s ease-out" }}>{sent}</p> : null}
          {error ? <p role="alert" style={{ margin: "0", padding: "0 28px", fontSize: "15px", color: "#B4372A" }}>{error}</p> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "0 12px" }}>
            {IDEAS.map((label) => (
              <button key={label} type="button" onClick={() => { setAsk(label); setSent(null); input.current?.focus(); }} style={{ height: "38px", padding: "0 16px", background: "transparent", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", cursor: "pointer", fontSize: "14px", color: "#3D404A" }}>{label}</button>
            ))}
          </div>
        </section>

        <WeekDigest store={store} artifacts={artifacts} skills={skills} usage={usage} missions={missions} approvals={approvals} bots={bots} settings={settings} />

        <section aria-labelledby="need-t" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
            <h2 id="need-t" style={{ margin: "0", font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Te necesitan"}</h2>
            <span style={{ fontSize: "15px", color: "#6B6F7A" }}>{n ? `${n} ${n === 1 ? "pendiente" : "pendientes"}` : "al día"}</span>
          </div>
          {n === 0 && !settled.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: "24px", padding: "34px", background: "#FFFFFF", borderRadius: "30px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 16px 40px -20px rgba(18,19,26,.16)", animation: "rise .5s ease-out" }}>
              <span style={{ animation: "drift 5s ease-in-out infinite" }}><BotPresence bot={{ shape: "hex", color: "#FFC93C" }} size={64} state="rest" /></span>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <strong style={{ font: "600 24px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Nada te espera."}</strong>
                <span style={{ fontSize: "16px", lineHeight: "1.5", color: "#5C606C" }}>{"Tus bots siguen trabajando. Solo te avisaremos si hace falta."}</span>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px, 100%), 1fr))", gap: "22px", alignItems: "start" }}>
              {notes.filter((x) => x.urgent).map((x) => <WatchCard key={x.id} n={x} bot={botOf(x.botId)} />)}
              {asks.map((a) => <NeedCard key={a.id} a={a} bot={botOf(a.botId)} mission={missions.find((m) => m.id === a.missionId)} />)}
              {notes.filter((x) => !x.urgent).map((x) => <WatchCard key={x.id} n={x} bot={botOf(x.botId)} />)}
              {choices.map((m) => <ChoiceCard key={m.id} m={m} bots={bots} />)}
              {settled.map((d) => <NeedCard key={"done" + d.approval.id} a={d.approval} bot={botOf(d.approval.botId)} mission={missions.find((m) => m.id === d.approval.missionId)} settled={d.text} />)}
            </div>
          )}
        </section>

        <section aria-labelledby="run-t" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h2 id="run-t" style={{ margin: "0", font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"En marcha"}</h2>
            <span style={{ display: "flex", alignItems: "baseline", gap: "18px", fontSize: "15px", color: "#6B6F7A" }}>
              {running.length === 1 ? "1 encargo" : `${running.length} encargos`}
              <a href="/objetivos" style={{ fontWeight: "500", color: "#1F4FD1" }}>{"Ver objetivos"}</a>
            </span>
          </div>
          {running.length ? (
            <div style={{ background: "#FFFFFF", borderRadius: "30px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 16px 40px -22px rgba(18,19,26,.16)", overflow: "hidden" }}>
              {running.map((m, i) => {
                const p = pct(m);
                const members = [...new Set([...(m.botIds || []), ...(m.chosenBotIds || [])])].map(botOf).filter(Boolean).slice(0, 3);
                const shown = members.length ? members : [botOf("atlas")].filter(Boolean);
                return (
                  <a key={m.id} href={`/encargo/${m.id}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 22px", padding: "22px 26px", borderBottom: i < running.length - 1 ? "1px solid rgba(18,19,26,.06)" : "0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px", width: "92px" }}>
                      {shown.map((b) => <BotPresence key={b.id} bot={b} size={22} state={store.activity?.[b.id]?.mission === m.id ? "work" : "rest"} />)}
                    </span>
                    <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      <strong style={{ fontSize: "17px", fontWeight: "600" }}>{m.title}</strong>
                      <span style={{ fontSize: "14px", color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.narration?.text || m.activityLine || m.statusLabel}</span>
                    </span>
                    <span style={{ flex: "0 1 200px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <span style={{ position: "relative", height: "4px", borderRadius: "2px", background: "rgba(18,19,26,.08)", overflow: "hidden" }}>
                        <span style={{ position: "absolute", inset: `0 ${100 - (p ?? 8)}% 0 0`, background: "#12131A", borderRadius: "2px" }} />
                        {m.status === "running" ? <span style={{ position: "absolute", top: "0", bottom: "0", width: "40%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent)", animation: `sweep 2.4s ${(i % 3) * 0.6}s ease-in-out infinite` }} /> : null}
                      </span>
                      <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{[p != null ? p + " %" : null, dueLabel(m.dueAt)].filter(Boolean).join(" · ") || m.statusLabel}</span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A9DA6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </a>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: 0, padding: "22px 26px", background: "rgba(255,255,255,.55)", borderRadius: "24px", fontSize: "15px", color: "#5C606C" }}>{"Nada en marcha ahora mismo. Pide algo arriba y lo verás aquí mientras se hace."}</p>
          )}
        </section>

        <section aria-labelledby="hive-t" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h2 id="hive-t" style={{ margin: "0", font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Tu colmena"}</h2>
            <a href="/colmena" style={{ fontSize: "15px", fontWeight: "500", color: "#1F4FD1" }}>{"Ver todos"}</a>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
            {team.map((b) => {
              const s = presenceState(b);
              return (
                <a key={b.id} href={`/colmena/${b.id}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "26px 12px 22px", background: s === "rest" ? "rgba(255,255,255,.55)" : "#FFFFFF", borderRadius: "26px" }}>
                  <BotPresence bot={b} size={56} state={s} />
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                    <strong style={{ fontSize: "15px", fontWeight: "600" }}>{b.name}</strong>
                    <span style={{ fontSize: "13px", color: "#5C606C" }}>{verbOf(b, store)}</span>
                  </span>
                </a>
              );
            })}
          </div>
        </section>

        {finished.length ? (
          <section aria-labelledby="done-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <h2 id="done-t" style={{ margin: "0", font: "500 15px/1 'Geist', sans-serif", color: "#6B6F7A" }}>{morning ? "Terminado esta mañana" : "Terminado hoy"}</h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {finished.map((m, i) => {
                const b = botOf(m.botIds?.[0]) || botOf("atlas");
                const line = firstSentence(m.recap?.text) || `${b?.name || "Tu equipo"} terminó «${m.title}»`;
                return (
                  <a key={m.id} href={m.conversation ? `/chat/${m.botIds?.[0]}?c=${m.id}` : `/encargo/${m.id}`} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 0", borderBottom: i < finished.length - 1 ? "1px solid rgba(18,19,26,.07)" : "0", fontSize: "15px" }}>
                    <BotPresence bot={b} size={16} state="rest" />
                    <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</span>
                    <span style={{ color: "#6B6F7A" }}>{time(m.completedAt)}</span>
                  </a>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
    </Shell>
  );
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const firstSentence = (t) => (t ? (String(t).match(/^[^.!?]+[.!?]?/) || [""])[0].replace(/[.]$/, "") : "");

/** «Tu semana con la colmena»: on a new week, what happened and what comes, once («Leído»). */
function WeekDigest({ missions, approvals, skills, usage, bots }) {
  const key = "colmena:digest:" + weekKey();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const goals = useResource("/goals").data;
  const from = new Date(); from.setDate(from.getDate() - 7);
  const week = useMemo(() => {
    const since = from.getTime();
    const done = missions.filter((m) => !m.conversation && m.status === "completed" && Date.parse(m.completedAt || 0) > since);
    const approved = approvals.filter((a) => a.decidedBy === "tú" && Date.parse(a.decidedAt || 0) > since);
    const pendingSkills = (skills || []).filter((s) => s.status === "pending");
    const happened = done.filter((m) => m.recap?.text).slice(0, 3).map((m) => firstSentence(m.recap.text) + ".");
    const soon = [];
    for (const g of Array.isArray(goals) ? goals : []) if (g.next?.dueAt && Date.parse(g.next.dueAt) - Date.now() < 21 * 864e5 && Date.parse(g.next.dueAt) > Date.now()) soon.push(`El objetivo «${g.title}» tiene un hito el ${new Date(g.next.dueAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}.`);
    const awaiting = missions.filter((m) => m.status === "awaiting_choice").length;
    if (awaiting) happened.push(awaiting === 1 ? "Hay una propuesta esperando tu decisión." : `Hay ${awaiting} propuestas esperando tu decisión.`);
    return { done: done.length, approved: approved.length, skills: pendingSkills.length, happened: happened.slice(0, 3), soon: soon.slice(0, 3) };
  }, [missions, approvals, skills, goals]);
  if (dismissed || (!week.done && !week.approved && !week.skills)) return null;
  const to = new Date(); to.setDate(to.getDate() - 1);
  const range = `Del ${from.getDate()} al ${to.getDate()} de ${to.toLocaleDateString("es-ES", { month: "long" })}`;
  const spend = usage?.percent != null ? { n: usage.percent + " %", label: "del gasto del mes" } : { n: formatTokens(usage?.monthTokens || 0), label: "tokens este mes" };
  const atlas = bots.find((b) => b.id === "atlas") || { shape: "hex", color: "#FFC93C" };
  const stat = (n, label) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "18px", borderRadius: "20px", background: "rgba(255,255,255,.06)" }}>
      <span style={{ font: "600 40px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{n}</span>
      <span style={{ fontSize: "14px", color: "#C9CBD3" }}>{label}</span>
    </div>
  );
  const list = (title, items) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={{ fontSize: "13px", fontWeight: "500", color: "#A9ACB6" }}>{title}</span>
      <ul style={{ margin: "0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px", lineHeight: "1.5", color: "#E6E7EC" }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
  return (
    <section aria-labelledby="wk-t" style={{ display: "flex", flexDirection: "column", gap: "22px", padding: "30px 32px", borderRadius: "32px", background: "#12131A", color: "#FFFFFF", animation: "rise .5s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <BotPresence bot={atlas} size={34} state="rest" />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 id="wk-t" style={{ margin: "0", font: "600 26px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Tu semana con la colmena"}</h2>
            <span style={{ fontSize: "14px", color: "#A9ACB6" }}>{range + " · te lo resume " + (atlas.name || "Atlas")}</span>
          </div>
        </div>
        <button type="button" onClick={() => { try { localStorage.setItem(key, "1"); } catch {} setDismissed(true); }} style={{ height: "40px", padding: "0 16px", border: "0", borderRadius: "999px", background: "rgba(255,255,255,.1)", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>{"Leído"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
        {stat(week.done, week.done === 1 ? "encargo terminado" : "encargos terminados")}
        {stat(week.approved, week.approved === 1 ? "cosa aprobaste tú" : "cosas aprobaste tú")}
        {stat(week.skills, week.skills === 1 ? "habilidad nueva por revisar" : "habilidades nuevas por revisar")}
        {stat(spend.n, spend.label)}
      </div>
      {week.happened.length || week.soon.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "22px" }}>
          {week.happened.length ? list("Lo que ha pasado", week.happened) : null}
          {week.soon.length ? list("Lo que viene", week.soon) : null}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {week.skills ? <a href="/archivo?tab=habilidades" style={{ display: "flex", alignItems: "center", height: "44px", padding: "0 18px", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", fontSize: "14px", fontWeight: "600" }}>{"Revisar las habilidades"}</a> : null}
        <a href="/objetivos" style={{ display: "flex", alignItems: "center", height: "44px", padding: "0 18px", borderRadius: "999px", background: "rgba(255,255,255,.1)", color: "#FFFFFF", fontSize: "14px", fontWeight: "600" }}>{"Ver objetivos"}</a>
      </div>
    </section>
  );
}
