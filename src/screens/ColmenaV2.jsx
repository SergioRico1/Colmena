import { useEffect, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence, gloss, presenceState, shapeOf } from "../components/v2/Presence.jsx";
import { portraitOf } from "../lib/bots.js";
import NewBot from "../components/v2/team/NewBot.jsx";
import PortraitPicker from "../components/team/PortraitPicker.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { del, get, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { formatTokens } from "../components/settings/format.jsx";
import { LimitLine } from "../components/v2/LimitNotice.jsx";
import { later } from "../lib/undoToast.js";
import { VerdictList, VerdictMark } from "../components/v2/team/Verdict.jsx";
import DocHistory from "../components/v2/team/DocHistory.jsx";

// Colmena 2.0 · 27 «Tu colmena» (design/V2Colmena.dc.html): your bots as presences (they
// breathe while they work) and, beside them, the chosen one: what it is, what it knows, what it
// can use, how it works, its limits and what it remembers. «Nuevo bot» opens the 3-step sheet.
const CAPS = [["web", "Buscar en la web"], ["carpetas", "Carpetas de este ordenador"], ["apps", "Apps conectadas"], ["ordenador", "Usar el ordenador"]];
const HOW = [
  { key: "autonomy", label: "Autonomía", opts: [["sugiere", "Solo sugiere", "Te propone lo que haría y espera a que digas que sí."], ["avisa", "Hace y te avisa", "Hace el trabajo y te cuenta lo que ha hecho. Lo que sale fuera siempre te lo pregunta."], ["solo", "Hace solo", "Trabaja sin avisarte salvo en las líneas rojas: enviar fuera, pagar, borrar o instalar."]], def: "avisa" },
  { key: "thinking", label: "Forma de pensar", opts: [["rapido", "Rápido", "Responde enseguida. Para tareas cortas y conocidas."], ["equilibrado", "Equilibrado", "Piensa lo justo. Lo mejor para casi todo."], ["profundo", "A fondo", "Se toma su tiempo y gasta más. Para análisis y decisiones importantes."]], def: "equilibrado" },
];
const STATE = { trabaja: "Trabajando", espera: "Te espera", pausado: "En pausa", bloqueado: "Atascado", libre: "Libre", limitado: "Limitado" };

export default function ColmenaV2({ params = {}, query = {} }) {
  const { bots, skills, memories, missions, activity } = useStore();
  const team = bots.filter((b) => b.enabled !== false);
  const [sel, setSel] = useState(params.bot || team[0]?.id || null);
  useEffect(() => { if (params.bot) setSel(params.bot); }, [params.bot]);
  const [creating, setCreating] = useState(query.nuevo === "1" || (typeof location !== "undefined" && /^\/(colmena|equipo)\/nuevo/.test(location.pathname)));
  const cur = team.find((b) => b.id === sel) || team[0] || null;
  const working = team.filter((b) => b.status === "trabaja").length;
  const countLine = `${team.length} ${team.length === 1 ? "bot" : "bots"}${working ? ` · ${working} ${working === 1 ? "trabajando ahora" : "trabajando ahora"}` : " · todos libres"}`;

  return (
    <Shell active="colmena">
      <main style={{ maxWidth: "1240px", margin: "0 auto", padding: "64px clamp(20px, 4vw, 48px) 40px", display: "flex", flexDirection: "column", gap: "40px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <h1 style={{ margin: "0", font: "600 clamp(48px, 7vw, 84px)/0.95 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>{"Tu colmena"}</h1>
            <p style={{ margin: "0", fontSize: "17px", color: "#5C606C" }}>{countLine}</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} style={{ display: "flex", alignItems: "center", gap: "10px", height: "52px", padding: "0 24px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {"Nuevo bot"}
          </button>
        </header>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "flex-start" }}>
          <div role="listbox" aria-label="Bots" style={{ flex: "1 1 520px", minWidth: "0", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "14px" }}>
            {team.map((b) => {
              const on = b.id === cur?.id;
              const work = b.status === "trabaja";
              const act = activity?.[b.id];
              return (
                <button key={b.id} type="button" role="option" aria-selected={on ? "true" : "false"} onClick={() => { setSel(b.id); history.replaceState(null, "", `/colmena/${b.id}`); }}
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "22px", padding: "26px 22px 22px", textAlign: "left", border: "0", borderRadius: "28px", cursor: "pointer", transition: "box-shadow .3s ease, transform .3s ease", background: "#FFFFFF", boxShadow: on ? "0 0 0 2px #12131A, 0 24px 50px -24px rgba(18,19,26,.4)" : "0 1px 2px rgba(18,19,26,.05), 0 12px 30px -20px rgba(18,19,26,.2)", transform: on ? "translateY(-2px)" : "none" }}>
                  <BotPresence bot={b} size={64} state={presenceState(b)} />
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <strong style={{ font: "600 21px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{b.name}</strong>
                    <span style={{ fontSize: "14px", color: "#5C606C" }}>{b.role}</span>
                  </span>
                  {b.status === "limitado" ? <LimitLine limited={b.limited} /> : <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: work ? "#0B6B4A" : b.status === "espera" ? "#8A5A00" : "#6B6F7A", minWidth: 0 }}>
                    <span aria-hidden="true" style={{ width: "7px", height: "7px", flex: "none", borderRadius: "50%", background: work ? "#0B8A5F" : b.status === "espera" ? "#FFC93C" : "#C9CBD1" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{work && act?.verb ? act.verb.charAt(0).toUpperCase() + act.verb.slice(1) : STATE[b.status] || "Libre"}</span>
                  </span>}
                </button>
              );
            })}
          </div>
          {cur ? <Profile key={cur.id} bot={cur} skills={skills} memories={memories} missions={missions} /> : null}
        </div>
      </main>
      {creating ? <NewBot onClose={() => setCreating(false)} onHired={(b) => { setCreating(false); setSel(b.id); navigate(`/colmena/${b.id}`); }} /> : null}
    </Shell>
  );
}

function Profile({ bot, skills, memories, missions }) {
  const { act, busy, error } = useAction();
  const [learning, setLearning] = useState(null);
  const [usage, setUsage] = useState(null);
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    let alive = true;
    get(`/bots/${encodeURIComponent(bot.id)}/learning`).then((d) => alive && setLearning(d), () => {});
    get("/usage/history?days=30").then((d) => alive && setUsage(d.bots?.find((x) => x.botId === bot.id) || { tokens: 0 }), () => {});
    return () => { alive = false; };
  }, [bot.id]);
  const work = bot.status === "trabaja";
  const own = (learning?.skills || skills.filter((s) => s.botId === bot.id)).filter((s) => !["archived", "pending", "disabled"].includes(s.status));
  const pendingSkills = (learning?.skills || []).filter((s) => s.status === "pending").length;
  const caps = learning?.capabilities || { web: true, carpetas: true, apps: true, ordenador: true };
  const mem = memories.filter((m) => m.botId === bot.id && m.scope === "bot");
  const live = missions.filter((m) => ["running", "queued"].includes(m.status) && [...(m.botIds || []), ...(m.chosenBotIds || [])].includes(bot.id));
  const setCap = async (key, value) => { const r = await act(() => patch(`/bots/${bot.id}/capabilities`, { [key]: value })); if (r?.capabilities) setLearning((d) => ({ ...(d || {}), capabilities: r.capabilities })); };
  const sh = shapeOf(bot);
  const about = String(bot.instructions || "").split(/(?<=[.!?])\s/).slice(0, 2).join(" ");
  return (
    <aside aria-live="polite" style={{ flex: "1 1 440px", minWidth: "0", position: "sticky", top: "24px", background: "#FFFFFF", borderRadius: "34px", overflow: "hidden", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 30px 70px -36px rgba(18,19,26,.35)" }}>
      <div style={{ display: "flex", flexDirection: "column", animation: "fade .35s ease-out" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "20px", padding: "34px 32px 28px", background: `linear-gradient(180deg, ${bot.color}22, rgba(255,255,255,0))` }}>
          <button type="button" onClick={() => setPortrait(true)} aria-label={portraitOf(bot) ? `Cambiar el retrato de ${bot.name}` : `Darle un retrato a ${bot.name}`} title={portraitOf(bot) ? "Cambiar el retrato" : "Darle un retrato"} style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
            <span aria-hidden="true" style={{ display: "inline-grid", filter: work ? `drop-shadow(0 12px 24px ${bot.color}99)` : "drop-shadow(0 6px 12px rgba(18,19,26,.18))", animation: work ? "breathe 2.8s ease-in-out infinite" : "none" }}>
              <span style={{ display: "block", width: "92px", height: "92px", background: portraitOf(bot) ? `${bot.color} url("${portraitOf(bot)}") center / cover no-repeat` : gloss(bot.color), clipPath: sh.clip, borderRadius: sh.radius }} />
            </span>
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2 style={{ margin: "0", font: "600 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>{bot.name}</h2>
            <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.5", color: "#3D404A" }}>{about || bot.role}</p>
            {bot.limited || bot.engineLimit ? <LimitLine limited={bot.limited || bot.engineLimit} style={{ fontSize: "14px" }} /> : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <a href={`/chat/${bot.id}`} style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 20px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "15px", fontWeight: "600" }}>{"Hablar con " + bot.name}</a>
            {live.length ? <button type="button" disabled={busy} onClick={() => act(async () => { for (const m of live) await post(`/missions/${m.id}/control`, { action: "pause" }); })} style={{ height: "46px", padding: "0 20px", border: "0", borderRadius: "999px", background: "rgba(255,255,255,.7)", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{"Pausar su trabajo"}</button> : null}
            <a href={`/equipo/${bot.id}`} style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 18px", borderRadius: "999px", background: "rgba(255,255,255,.7)", fontSize: "15px", fontWeight: "600" }}>{"Personalidad y más"}</a>
          </div>
        </div>
        <div style={{ padding: "8px 32px 32px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "22px 0", borderBottom: "1px solid rgba(18,19,26,.07)" }}>
            <h3 style={{ margin: "0", fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Sabe"}</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {own.length ? own.map((k) => <span key={k.id} title={k.description || undefined} style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "8px 14px", borderRadius: "999px", background: "#F4F4F0", fontSize: "14px" }}>{k.name}{k.verdict && k.verdict.value !== "dudoso" ? <VerdictMark verdict={k.verdict} compact consolidated={k.consolidated} /> : null}</span>) : <span style={{ fontSize: "14px", color: "#6B6F7A" }}>{"Aún no tiene habilidades guardadas. Las irá aprendiendo con el trabajo."}</span>}
            </div>
            <VerdictList verdicts={learning?.verdicts} />
            {pendingSkills ? <a href="/archivo?tab=habilidades" style={{ fontSize: "14px", fontWeight: 600, color: "#1F4FD1" }}>{pendingSkills === 1 ? "1 habilidad nueva por revisar" : `${pendingSkills} habilidades nuevas por revisar`}</a> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "22px 0", borderBottom: "1px solid rgba(18,19,26,.07)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Puede usar"}</h3>
            {CAPS.map(([key, label]) => {
              const on = caps[key] !== false;
              return (
                <button key={key} type="button" role="switch" aria-checked={on ? "true" : "false"} disabled={busy} onClick={() => setCap(key, !on)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "50px", padding: "0", border: "0", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ flex: "1", fontSize: "15px" }}>{label}</span>
                  <span aria-hidden="true" style={{ width: "46px", height: "28px", flex: "none", padding: "3px", borderRadius: "14px", transition: "background .25s ease", background: on ? "#0B8A5F" : "rgba(18,19,26,.14)", boxSizing: "border-box" }}>
                    <span style={{ display: "block", width: "22px", height: "22px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(18px)" : "translateX(0)" }} />
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "22px 0", borderBottom: "1px solid rgba(18,19,26,.07)" }}>
            <h3 style={{ margin: "0", fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Cómo trabaja"}</h3>
            {HOW.map((h) => {
              const v = bot[h.key] || h.def;
              const cur = h.opts.find((o) => o[0] === v) || h.opts[1];
              return (
                <div key={h.key} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontSize: "15px", fontWeight: "500" }}>{h.label}</span>
                  <div role="radiogroup" aria-label={h.label} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", padding: "3px", borderRadius: "14px", background: "rgba(18,19,26,.05)" }}>
                    {h.opts.map(([id, label]) => {
                      const on = id === v;
                      return <button key={id} type="button" role="radio" aria-checked={on ? "true" : "false"} disabled={busy} onClick={() => act(() => patch(`/bots/${bot.id}`, { [h.key]: id }))} style={{ minHeight: "40px", padding: "4px 8px", border: "0", borderRadius: "11px", cursor: "pointer", fontSize: "13px", fontWeight: "600", transition: "all .2s ease", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>{label}</button>;
                    })}
                  </div>
                  <span role="status" style={{ fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>{cur[2]}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "22px 0", borderBottom: "1px solid rgba(18,19,26,.07)" }}>
            <h3 style={{ margin: "0", fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Límites"}</h3>
            <p style={{ margin: "0", fontSize: "16px", lineHeight: "1.6" }}>{"Antes de enviar algo fuera, pagar, borrar o instalar, siempre te pregunta. "}<a href="/ajustes/uso#limite-mensual" style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{"Límite de gasto del espacio"}</a></p>
            <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{usage ? `En los últimos 30 días ha usado ${formatTokens(usage.tokens || 0)} tokens.` : " "}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "22px 0 0" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Recuerda"}</h3>
            {mem.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "46px", animation: "fade .3s ease-out" }}>
                <span style={{ flex: "1", fontSize: "15px", lineHeight: "1.45" }}>{m.text}</span>
                <button type="button" disabled={busy} onClick={() => later({ id: "memory:" + m.id, keys: ["memory:" + m.id], text: "Recuerdo olvidado", error: "No se pudo olvidar", run: () => act(() => del(`/memories/${encodeURIComponent(m.id)}`)) })} style={{ height: "32px", padding: "0 12px", border: "0", borderRadius: "999px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "13px", fontWeight: "500" }}>{"Olvidar"}</button>
              </div>
            ))}
            {!mem.length ? <span style={{ fontSize: "14px", color: "#6B6F7A" }}>{"No recuerda nada de ti todavía."}</span> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "22px 0 0", marginTop: "22px", borderTop: "1px solid rgba(18,19,26,.07)" }}>
            <h3 style={{ margin: "0 0 2px", fontSize: "13px", fontWeight: "500", color: "#6B6F7A" }}>{"Su forma de ser"}</h3>
            <p style={{ margin: "0 0 6px", fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{"Cada cambio en su carácter (SOUL.md) queda guardado. Puedes volver a cualquier versión."}</p>
            <div style={{ margin: "0 -20px" }}><DocHistory doc="soul" botId={bot.id} empty="Su carácter no ha cambiado desde que llegó." /></div>
          </div>
          {error ? <p role="alert" style={{ margin: "14px 0 0", fontSize: "14px", color: "#B4372A" }}>{error}</p> : null}
        </div>
      </div>
      {portrait ? <PortraitPicker bot={bot} onClose={() => setPortrait(false)} onSaved={() => {}} /> : null}
    </aside>
  );
}
