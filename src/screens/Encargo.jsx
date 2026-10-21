import { useMemo } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence, PersonPresence } from "../components/v2/Presence.jsx";
import { NeedCard } from "../components/v2/NeedCard.jsx";
import NotFound from "./NotFound.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { useAction, useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { findBot } from "../components/room/common.jsx";
import { verbLabel } from "../components/room/working.js";
import Markdown from "../components/room/Markdown.jsx";

// Colmena 2.0 · 25 «Encargo en marcha» (design/V2Encargo.dc.html): how a piece of work goes —
// its stages with who does each, what is being done right now (in sentences, with the time),
// the others meanwhile, what already exists and its story. Pause and talk from here.
const STAGE = new Set(["work", "solo", "synthesis", "proposal", "followup"]);
const DONE = new Set(["completed", "done"]);
const card = { background: "#FFFFFF", borderRadius: "32px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 50px -28px rgba(18,19,26,.25)" };
const h2 = { margin: "0", font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");
function dayTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoy " + hhmm(iso);
  if (new Date(Date.now() - 864e5).toDateString() === d.toDateString()) return "Ayer " + hhmm(iso);
  const w = d.toLocaleDateString("es-ES", { weekday: "long" });
  return w.charAt(0).toUpperCase() + w.slice(1);
}
function dueText(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 864e5);
  const at = "a las " + hhmm(iso);
  if (days === 0) return "hoy " + at;
  if (days === 1) return "mañana " + at;
  if (days > 1 && days < 7) return d.toLocaleDateString("es-ES", { weekday: "long" }) + " " + at;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + " " + at;
}
const THUMB = {
  table: "repeating-linear-gradient(0deg, #E1F4EC 0 22px, #FFFFFF 22px 24px), #E1F4EC",
  doc: "linear-gradient(180deg, #DDE7FF 0 30%, #FFFFFF 30% 34%, #EEF2FF 34% 100%)",
  design: "radial-gradient(circle at 75% 30%, #FFC93C 0 12%, transparent 12.5%), linear-gradient(135deg, #FFE6F1, #F5E9FF)",
  code: "repeating-linear-gradient(0deg, #12131A 0 18px, #1D1F27 18px 20px)",
};
const thumbOf = (a) => (a.kind === "table" || a.kind === "sheet" || a.format === "csv" ? THUMB.table : a.kind === "code" ? THUMB.code : a.kind === "design" || a.format === "svg" || a.format === "png" ? THUMB.design : THUMB.doc);
const KIND = { table: "Hoja", sheet: "Hoja", doc: "Documento", design: "Diseño", code: "Código" };

export default function Encargo({ params = {} }) {
  const { bots, ready } = useStore();
  const room = useRoom(params.id);
  const { mission: m, steps, messages, artifacts, pending, activity } = room;
  const control = useAction();
  const story = useMemo(() => {
    if (!m) return [];
    const out = [];
    const first = messages.find((x) => x.role === "user");
    if (first) out.push({ at: first.at, text: `Pediste «${String(first.text).replace(/\s+/g, " ").slice(0, 120)}»${m.room ? ` en #${m.room}` : ""}.` });
    for (const s of steps) if (s.completedAt && DONE.has(s.status) && STAGE.has(s.kind)) out.push({ at: s.completedAt, text: `${findBot(bots, s.botId)?.name || "Un bot"} terminó «${s.title}».` });
    for (const x of messages) if (x.role === "user" && x !== first && x.at) out.push({ at: x.at, text: `Escribiste: «${String(x.text).replace(/\s+/g, " ").slice(0, 100)}»` });
    for (const a of artifacts) if (a.createdAt) out.push({ at: a.createdAt, text: `Se guardó «${a.title}» en el Archivo.` });
    return out.filter((x) => x.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
  }, [m, steps, messages, artifacts, bots]);

  if (ready && !room.loading && !m) return <NotFound title="Este encargo ya no está" text="Puede que se cerrara o que alguien borrara su sala. No se ha perdido nada de lo tuyo." />;
  if (!m) return <Shell active="hoy"><div /></Shell>;

  const stages = steps.filter((s) => STAGE.has(s.kind) && s.status !== "cancelled" && s.status !== "skipped").slice(0, 6);
  const done = stages.filter((s) => DONE.has(s.status)).length;
  const finished = m.status === "completed";
  const pct = finished ? 100 : stages.length ? Math.round((100 * done) / (stages.length + 1)) : m.progress?.total ? Math.round((100 * (m.progress.done || 0)) / m.progress.total) : 0;
  const paused = m.status === "paused";
  const blocked = m.status === "blocked";
  const pace = finished ? "terminado" : paused ? "en pausa" : blocked ? "atascado: necesita que mires qué pasa" : pending.length ? "te espera" : "va según lo previsto";
  const running = steps.find((s) => s.status === "running") || null;
  const runner = running ? findBot(bots, running.botId) : null;
  const act = runner ? activity.find((a) => a.botId === runner.id) : null;
  const log = (running?.activity || []).slice(-6).map((l, i, all) => ({ time: hhmm(l.at), text: l.text || [l.verb, l.detail].filter(Boolean).join(" · "), op: i === all.length - 1 ? "1" : ".6" }));
  const others = stages.filter((s) => s !== running && !DONE.has(s.status));
  const lastArtifact = [...artifacts].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null;
  const due = dueText(m.dueAt);
  const cols = stages.length + (finished ? 0 : 1);
  const youState = finished ? "done" : pending.length ? "wait" : "later";
  const toggle = () => control.act(() => post(`/missions/${m.id}/control`, { action: paused ? "resume" : "pause" }));

  return (
    <Shell active="hoy">
      <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px) 40px", display: "flex", flexDirection: "column", gap: "52px" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <a href="/" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px 0 10px", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", fontWeight: "500" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            {"Hoy"}
          </a>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, flex: "1 1 400px" }}>
              <h1 style={{ margin: "0", font: "600 clamp(48px, 7vw, 84px)/0.95 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em", overflowWrap: "anywhere" }}>{m.title}</h1>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.5", color: "#5C606C" }}>
                {"Lo pediste"}{m.room ? <>{" en "}<a href={`/sala/${m.id}`} style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{"#" + m.room}</a></> : null}
                {finished ? <>{" · terminado "}<strong style={{ color: "#12131A", fontWeight: "600" }}>{dayTime(m.completedAt).toLowerCase()}</strong></> : due ? <>{" · entrega "}<strong style={{ color: "#12131A", fontWeight: "600" }}>{due}</strong></> : " · sin fecha de entrega"}
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
              <span style={{ font: "600 56px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{pct}<span style={{ fontSize: "28px", color: "#9A9DA6" }}>{" %"}</span></span>
              <span style={{ fontSize: "14px", color: pending.length || blocked ? "#8A5A00" : "#6B6F7A" }}>{pace}</span>
            </div>
          </div>
        </header>

        {stages.length ? (
          <section aria-label="Etapas" style={{ ...card, padding: "34px 30px 30px", overflowX: "auto" }}>
            <ol style={{ position: "relative", margin: "0", padding: "0", listStyle: "none", display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(110px, 1fr))`, gap: "8px" }}>
              <li aria-hidden="true" style={{ position: "absolute", left: `${50 / cols}%`, right: `${50 / cols}%`, top: "27px", height: "2px", background: "rgba(18,19,26,.08)" }} />
              <li aria-hidden="true" style={{ position: "absolute", left: `${50 / cols}%`, width: `${Math.max(0, (100 - 100 / cols) * Math.min(1, (done + (running ? 0.5 : 0)) / Math.max(1, cols - 1)))}%`, top: "27px", height: "2px", background: "#12131A", transformOrigin: "left", animation: "grow 1.2s cubic-bezier(.2,.8,.2,1)" }} />
              {stages.map((s) => {
                const b = findBot(bots, s.botId);
                const isDone = DONE.has(s.status);
                const now = s.status === "running";
                const waits = s.status === "waiting";
                return (
                  <li key={s.id} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", textAlign: "center" }}>
                    <span style={{ width: "56px", height: "56px", display: "grid", placeItems: "center", borderRadius: "50%", background: isDone ? "#12131A" : now ? "#FFFFFF" : "#F4F4F0", boxShadow: now ? "0 0 0 2px #12131A" : waits ? "0 0 0 2px #FFC93C, 0 0 0 7px rgba(255,201,60,.18)" : "none" }}>
                      {isDone ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                        : <BotPresence bot={b} size={now ? 30 : 24} state={now ? "work" : waits ? "wait" : "rest"} />}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <strong style={{ fontSize: "15px", fontWeight: "600" }}>{s.title}</strong>
                      <span style={{ fontSize: "13px", color: now ? "#0B6B4A" : waits ? "#8A5A00" : "#6B6F7A", fontWeight: now ? "500" : "400" }}>{`${b?.name || "Un bot"} · ${isDone ? "hecho" : now ? "ahora" : waits ? "te espera" : "después"}`}</span>
                    </span>
                  </li>
                );
              })}
              {finished ? null : (
                <li style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", textAlign: "center" }}>
                  <span style={{ width: "56px", height: "56px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#FFFFFF", boxShadow: youState === "wait" ? "0 0 0 2px #FFC93C, 0 0 0 7px rgba(255,201,60,.18)" : "0 0 0 2px rgba(18,19,26,.08)" }}>
                    <PersonPresence me size={34} />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    <strong style={{ fontSize: "15px", fontWeight: "600" }}>{"Tu revisión"}</strong>
                    <span style={{ fontSize: "13px", color: youState === "wait" ? "#8A5A00" : "#6B6F7A" }}>{youState === "wait" ? "te esperan ahora" : due || "al terminar"}</span>
                  </span>
                </li>
              )}
            </ol>
          </section>
        ) : null}

        {pending.filter((a) => a.kind !== "secret").length ? (
          <section aria-label="Te necesitan" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px, 100%), 1fr))", gap: "22px", alignItems: "start" }}>
            {pending.filter((a) => a.kind !== "secret").map((a) => <NeedCard key={a.id} a={a} bot={findBot(bots, a.botId)} mission={m} />)}
          </section>
        ) : null}

        {running || paused ? (
          <section aria-labelledby="now-t" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <h2 id="now-t" style={h2}>{"Ahora mismo"}</h2>
            <div style={{ ...card, display: "grid", gridTemplateColumns: lastArtifact || running?.text ? "repeat(auto-fit, minmax(min(420px, 100%), 1fr))" : "1fr", gap: "0", overflow: "hidden" }}>
              <div style={{ padding: "30px", display: "flex", flexDirection: "column", gap: "22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <BotPresence bot={runner || findBot(bots, "atlas")} size={52} state={paused ? "rest" : "work"} />
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                    <strong style={{ font: "600 22px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
                      {runner ? `${runner.name} está ${running.narration?.text ? "trabajando" : act?.verb ? verbLabel(act.verb).toLowerCase() : "con «" + running.title + "»"}` : "El encargo está en pausa"}
                    </strong>
                    <span role="status" style={{ fontSize: "14px", color: paused ? "#8A5A00" : "#5C606C" }}>{paused ? "En pausa. Nadie más se ve afectado." : running?.narration?.text || "Trabajando"}</span>
                  </span>
                </div>
                {runner && /naveg|formulario|ordenador/i.test(act?.verb || "") ? (
                  <a href={`/ordenador/${m.id}?bot=${encodeURIComponent(runner.id)}`} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 16px", borderRadius: "999px", background: "rgba(18,19,26,.06)", fontSize: "14px", fontWeight: "600" }}>
                    <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#0B8A5F", animation: "halo 1.8s ease-out infinite" }} />
                    {`Ver su navegador en directo`}
                  </a>
                ) : null}
                {log.length ? (
                  <ol aria-label="Lo que está haciendo" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "12px" }}>
                    {log.map((l, i) => (
                      <li key={i} style={{ display: "grid", gridTemplateColumns: "50px 1fr", gap: "12px", fontSize: "15px", lineHeight: "1.45", animation: "rise .4s ease-out", opacity: l.op }}>
                        <span style={{ font: "400 13px/1.6 'Geist Mono', monospace", color: "#8A8D96" }}>{l.time}</span>
                        <span>{l.text}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  <button type="button" disabled={control.busy} onClick={toggle} style={{ height: "46px", padding: "0 22px", border: "0", borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{paused ? "Seguir" : "Pausar"}</button>
                  <a href={`/sala/${m.id}`} style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 22px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "15px", fontWeight: "600" }}>{runner ? `Hablar con ${runner.name}` : "Abrir la sala"}</a>
                </div>
                {control.error ? <span role="alert" style={{ fontSize: "14px", color: "#B4372A" }}>{control.error}</span> : null}
              </div>
              {running?.text || lastArtifact ? (
                <div style={{ padding: "30px", background: "#FAFAF7", display: "flex", flexDirection: "column", gap: "18px", borderLeft: "1px solid rgba(18,19,26,.05)", minWidth: 0 }}>
                  {running?.text ? (
                    <>
                      <span style={{ fontSize: "14px", color: "#5C606C" }}>{"Lo que lleva escrito"}</span>
                      <div style={{ maxHeight: "260px", overflow: "hidden", WebkitMaskImage: "linear-gradient(#000 70%, transparent)", maskImage: "linear-gradient(#000 70%, transparent)" }}><Markdown text={running.text} size={15} /></div>
                    </>
                  ) : (
                    <>
                      <span style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", color: "#5C606C" }}><span>{"Lo último que ha salido"}</span><span>{dayTime(lastArtifact.createdAt)}</span></span>
                      <a href={`/archivo?abrir=${encodeURIComponent(lastArtifact.id)}`} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <span aria-hidden="true" style={{ height: "160px", borderRadius: "16px", background: thumbOf(lastArtifact) }} />
                        <strong style={{ fontSize: "16px", fontWeight: "600" }}>{lastArtifact.title}</strong>
                      </a>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {others.length ? (
          <section aria-labelledby="mean-t" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <h2 id="mean-t" style={h2}>{"Mientras tanto"}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "16px" }}>
              {others.map((s) => {
                const b = findBot(bots, s.botId);
                const now = s.status === "running";
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "22px 24px", background: now ? "#FFFFFF" : "rgba(255,255,255,.55)", borderRadius: "26px" }}>
                    <BotPresence bot={b} size={36} state={now ? "work" : s.status === "waiting" ? "wait" : "rest"} />
                    <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                      <strong style={{ fontSize: "16px", fontWeight: "600" }}>{b?.name || "Un bot"}</strong>
                      <span style={{ fontSize: "14px", color: "#5C606C" }}>{now ? s.narration?.text || s.title : s.status === "waiting" ? "Te espera para seguir" : `${s.title} · cuando acabe la etapa anterior`}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {finished && m.recap?.text ? (
          <section aria-label="Resumen" style={{ ...card, padding: "30px", display: "flex", gap: "18px", alignItems: "flex-start" }}>
            <BotPresence bot={findBot(bots, "atlas")} size={36} state="rest" />
            <p style={{ margin: 0, fontSize: "18px", lineHeight: "1.55" }}>{m.recap.text}</p>
          </section>
        ) : null}

        {artifacts.length ? (
          <section aria-labelledby="have-t" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h2 id="have-t" style={h2}>{"Lo que ya hay"}</h2>
              <a href="/archivo" style={{ fontSize: "15px", fontWeight: "500", color: "#1F4FD1" }}>{"Ver en el Archivo"}</a>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: "16px" }}>
              {artifacts.map((a) => (
                <a key={a.id} href={`/archivo?abrir=${encodeURIComponent(a.id)}`} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px", background: "#FFFFFF", borderRadius: "26px" }}>
                  {a.format === "png" ? <img src={`/api/artifacts/${encodeURIComponent(a.id)}/file`} alt="" style={{ height: "130px", width: "100%", objectFit: "cover", borderRadius: "16px" }} /> : <span aria-hidden="true" style={{ height: "130px", borderRadius: "16px", background: thumbOf(a) }} />}
                  <span style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "0 6px 4px" }}>
                    <strong style={{ fontSize: "15px", fontWeight: "600" }}>{a.title}</strong>
                    <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{[KIND[a.kind] || "Documento", findBot(bots, a.botId)?.name, a.createdAt ? dayTime(a.createdAt).toLowerCase() : null].filter(Boolean).join(" · ")}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {story.length ? (
          <section aria-labelledby="hist-t" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h2 id="hist-t" style={{ margin: "0 0 10px", font: "500 15px/1 'Geist', sans-serif", color: "#6B6F7A" }}>{"Historia"}</h2>
            {story.map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "12px", padding: "14px 0", borderBottom: i < story.length - 1 ? "1px solid rgba(18,19,26,.07)" : "0", fontSize: "15px" }}>
                <span style={{ color: "#6B6F7A" }}>{dayTime(e.at)}</span>
                <span>{e.text}</span>
              </div>
            ))}
          </section>
        ) : null}
      </main>
    </Shell>
  );
}
