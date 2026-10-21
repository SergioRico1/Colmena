import { useMemo, useState } from "react";
import { css } from "../design/css/Equipo.js";
import Sidebar from "../components/Sidebar.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { time } from "../lib/format.js";
import { BotAvatar, Notice, Spinner, autonomyShort, fold, locationLabel, writeDraft } from "../components/team/common.jsx";
import { TEMPLATES } from "../components/team/templates.jsx";

const ACTIVE = ["running", "planning", "queued"];
const WAITING = ["waiting", "awaiting_choice", "awaiting_plan"];

function statusLine(bot, { missions, approvals, automations }) {
  const mine = missions.filter((m) => (m.botIds || []).includes(bot.id));
  if (bot.status === "espera") {
    const approval = approvals.find((a) => a.status === "pending" && a.botId === bot.id);
    const mission = mine.find((m) => WAITING.includes(m.status) || m.pendingCount > 0);
    const what = approval?.title || mission?.title;
    return { kind: "espera", text: what ? `Te espera: ${what.charAt(0).toLowerCase()}${what.slice(1)}` : "Te espera" };
  }
  if (bot.status === "trabaja") {
    const running = mine.filter((m) => ACTIVE.includes(m.status));
    if (running.length > 1) return { kind: "trabaja", text: `${bot.id === "atlas" ? "Coordina" : "Trabaja en"} ${running.length} misiones` };
    const m = running[0] || missions.find((x) => x.id === bot.activity?.missionId);
    if (m) return { kind: "trabaja", text: m.progress?.total ? `${m.title} · ${m.progress.done} de ${m.progress.total}` : m.title };
    return { kind: "trabaja", text: bot.activity?.detail || "Trabajando" };
  }
  if (bot.status === "bloqueado") {
    const m = mine.find((x) => x.status === "blocked");
    return { kind: "bloqueado", text: m ? `Bloqueado: ${m.title}` : "Bloqueado" };
  }
  if (bot.status === "pausado" || bot.enabled === false) return { kind: "libre", text: bot.enabled === false ? "Desactivado" : "En pausa" };
  const next = automations
    .filter((a) => a.botId === bot.id && a.enabled !== false && a.nextRun)
    .sort((a, b) => Date.parse(a.nextRun) - Date.parse(b.nextRun))[0];
  if (next && Date.parse(next.nextRun) - Date.now() < 864e5) return { kind: "libre", text: `Libre · vuelve a las ${time(next.nextRun)}` };
  return { kind: "libre", text: "Libre" };
}

const DOT = {
  trabaja: { width: "8px", height: "8px", borderRadius: "50%", background: "#0B8A5F", boxShadow: "0 0 0 4px #D6F0E4" },
  espera: { width: "8px", height: "8px", borderRadius: "2px", background: "#C98A00" },
  bloqueado: { width: "8px", height: "8px", borderRadius: "2px", background: "#E5484D" },
  libre: { width: "8px", height: "8px", borderRadius: "50%", border: "1.5px solid #4A4F5C" },
};

function summary(bots) {
  const count = (s) => bots.filter((b) => b.status === s).length;
  const parts = [];
  const working = count("trabaja");
  const waiting = count("espera");
  const free = bots.filter((b) => !b.status || b.status === "libre").length;
  const paused = count("pausado");
  const blocked = count("bloqueado");
  if (working) parts.push(`${working} trabajando`);
  if (waiting) parts.push(`${waiting} te ${waiting === 1 ? "espera" : "esperan"}`);
  if (blocked) parts.push(`${blocked} ${blocked === 1 ? "bloqueado" : "bloqueados"}`);
  if (paused) parts.push(`${paused} en pausa`);
  if (free) parts.push(`${free} ${free === 1 ? "libre" : "libres"}`);
  return `${bots.length} ${bots.length === 1 ? "bot" : "bots"}${parts.length ? " · " + parts.join(", ") : ""}`;
}

export default function Equipo() {
  const store = useStore();
  const { bots, skills, ready } = store;
  const [query, setQuery] = useState("");
  const [hiring, setHiring] = useState(null);
  const { act, error } = useAction();

  const templates = useMemo(() => {
    const q = fold(query).trim();
    if (!q) return TEMPLATES;
    const terms = q.split(/\s+/);
    return TEMPLATES.filter((t) => {
      const hay = fold(`${t.title} ${t.desc} ${t.keywords} ${t.bot.role}`);
      return terms.every((w) => hay.includes(w));
    });
  }, [query]);

  const hire = async (t) => {
    setHiring(t.id);
    const bot = await act(() => post("/bots", { name: t.bot.name, role: t.bot.role, instructions: t.bot.instructions, color: t.bot.color, shape: t.bot.shape }));
    setHiring(null);
    if (bot?.id) navigate(`/equipo/${bot.id}`);
  };

  const fromScratch = (event) => {
    if (!query.trim()) return; // plain link
    event.preventDefault();
    writeDraft({ description: `Quiero un bot que me ayude con ${query.trim()}.` });
    navigate("/equipo/nuevo");
  };

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" active="equipo" />

        <main style={{ flex: "999 1 560px", minWidth: 0, padding: "28px clamp(16px, 3vw, 36px) 56px", display: "flex", flexDirection: "column", gap: "28px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: 0, font: "800 36px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Tu equipo</h1>
              <p style={{ margin: 0, fontSize: "15px", color: "#4A4F5C" }}>{ready ? summary(bots) : "Cargando tu equipo…"}</p>
            </div>
            <a href="/equipo/nuevo" style={{ display: "flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 18px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", fontWeight: "700", fontSize: "14px" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Contratar un bot</a>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "16px" }}>
            {ready && bots.length === 0 ? (
              <p style={{ margin: 0, fontSize: "15px", color: "#4A4F5C" }}>Aún no tienes bots. Contrata el primero con una plantilla o desde cero.</p>
            ) : null}
            {bots.map((bot) => {
              const line = statusLine(bot, store);
              const waiting = line.kind === "espera";
              const own = skills.filter((s) => s.botId === bot.id);
              const active = own.filter((s) => s.status === "active").sort((a, b) => (b.uses || 0) - (a.uses || 0));
              const learned = own.filter((s) => s.status === "pending").length;
              return (
                <article key={bot.id} style={waiting
                  ? { background: "#FFFFFF", border: "2px solid #12131A", boxShadow: "6px 6px 0 #FFC93C", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }
                  : { background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px", opacity: bot.enabled === false ? 0.7 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <BotAvatar bot={bot} size={56} font={bot.shape === "diamond" ? 20 : 24} />
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}><strong style={{ font: "700 22px/1 'Bricolage Grotesque', sans-serif" }}>{bot.name}</strong><span style={{ fontSize: "14px", color: "#4A4F5C" }}>{bot.role}</span></div>
                  </div>
                  <p style={waiting ? { margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: "600" } : { margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}><span style={{ ...DOT[line.kind], flex: "none" }} />{line.text}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "13px" }}>
                    {active.slice(0, 3).map((s) => <span key={s.id} style={{ padding: "5px 9px", background: "#F4F5F8", borderRadius: "6px" }}>{s.name}</span>)}
                    {active.length > 3 ? <span style={{ padding: "5px 9px", background: "#F4F5F8", borderRadius: "6px" }}>+{active.length - 3} más</span> : null}
                    {learned ? <a href={`/equipo/${bot.id}#habilidades`} style={{ padding: "5px 9px", background: "#E1F4EC", borderRadius: "6px", fontWeight: "600" }}>+{learned} {learned === 1 ? "aprendida" : "aprendidas"}</a> : null}
                    {!active.length && !learned ? <span style={{ padding: "5px 9px", background: "#F4F5F8", borderRadius: "6px", color: "#555A68" }}>Aún sin habilidades</span> : null}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px", color: "#4A4F5C", paddingTop: "10px", borderTop: "1px solid #E6E8EE" }}><span>{locationLabel(bot.location)}</span><span>{autonomyShort(bot.autonomy)}</span></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}><a href={`/chat/${bot.id}`} style={{ display: "grid", placeItems: "center", height: "42px", background: "#12131A", color: "#FFFFFF", borderRadius: "10px", fontWeight: "600", fontSize: "14px" }}>Chat</a><a href={`/equipo/${bot.id}`} style={{ display: "grid", placeItems: "center", height: "42px", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px" }}>Perfil</a></div>
                </article>
              );
            })}
          </div>

          <section id="plantillas" aria-labelledby="galeria" style={{ display: "flex", flexDirection: "column", gap: "16px", paddingTop: "8px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <h2 id="galeria" style={{ margin: 0, font: "800 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>Contratar un bot</h2>
                <p style={{ margin: 0, fontSize: "15px", color: "#4A4F5C" }}>Plantillas listas para empezar. Las ajustas después a tu manera.</p>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", flex: "0 1 300px" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg><input type="search" aria-label="Buscar plantillas" placeholder="Busca por tarea: «nóminas», «traducir»…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: "1", minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "14px" }} /></label>
            </div>
            {error ? <Notice>{error}</Notice> : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "12px" }}>
              <a href="/equipo/nuevo" onClick={fromScratch} style={{ padding: "18px", background: "#12131A", color: "#FFFFFF", borderRadius: "16px", display: "flex", flexDirection: "column", gap: "10px", minHeight: "170px" }}><span aria-hidden="true" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "#FFC93C", color: "#12131A", borderRadius: "10px" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span><strong style={{ font: "700 18px/1.2 'Bricolage Grotesque', sans-serif" }}>Crear desde cero</strong><span style={{ fontSize: "14px", lineHeight: "1.45", color: "#C9CCD6" }}>{query.trim() ? `Describe «${query.trim()}» con tus palabras y Colmena lo prepara.` : "Describe con tus palabras lo que necesitas y Colmena lo prepara."}</span></a>
              {templates.map((t) => (
                <div key={t.id} style={{ padding: "18px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span aria-hidden="true" style={{ width: "40px", height: "40px", border: "2px dashed #8C91A0", ...t.outline }} />
                  <strong style={{ fontSize: "16px" }}>{t.title}</strong>
                  <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#4A4F5C" }}>{t.desc}</span>
                  <button type="button" disabled={Boolean(hiring)} aria-label={`Contratar: ${t.title}`} onClick={() => hire(t)} style={{ marginTop: "auto", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 12px", background: "transparent", border: "1px solid #12131A", borderRadius: "9px", cursor: hiring ? "wait" : "pointer", fontSize: "13px", fontWeight: "600" }}>{hiring === t.id ? <><Spinner size={12} />Contratando…</> : "Contratar"}</button>
                </div>
              ))}
            </div>
            {templates.length === 0 ? <p style={{ margin: 0, fontSize: "14px", color: "#4A4F5C" }}>Ninguna plantilla encaja con «{query.trim()}». Créalo desde cero: Colmena lo prepara con tu descripción.</p> : null}
          </section>
        </main>
      </div>
    </>
  );
}
