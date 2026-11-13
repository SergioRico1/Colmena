import { useMemo, useState } from "react";
import { useStore } from "../../../lib/store.jsx";
import { callOf } from "./WorkLog.jsx";
import { kTokens } from "./Parts.jsx";

// Colmena 3 · Inspector (design/V3ChatExperto.dc.html), expert mode only, Ctrl I: what the bot
// has in front of it (Contexto, estimated from what it reads: its instructions, memory, skills,
// this conversation and the files it read), what it may use (Herramientas, from the bot's
// permissions) and what happened, in order (Registro). At the foot, the receipts of what it
// did outside: approved, waiting, refused.
const PARTS = [
  { key: "soul", label: "Instrucciones y reglas", color: "#FF8A65" },
  { key: "memory", label: "Memoria y perfil", color: "#7B4DFF" },
  { key: "skills", label: "Habilidades", color: "#2F6BFF" },
  { key: "chat", label: "Conversación", color: "#FFFFFF" },
  { key: "files", label: "Archivos leídos", color: "#3DDC97" },
];
const TOOL_NAMES = { correo: "Correo", calendario: "Calendario", carpeta: "Carpeta", hojas: "Hojas de cálculo", chat: "Mensajería", erp: "ERP", web: "Web", navegador: "Navegador", terminal: "Terminal" };
const LEVEL = { escribe: ["Lee y escribe", "rgba(61,220,151,.18)", "#3DDC97"], lee: ["Solo lee", "rgba(255,255,255,.16)", "#FFFFFF"], none: ["Nunca", "rgba(255,255,255,.06)", "#A9ACB6"] };
const tok = (text) => Math.ceil(String(text || "").length / 4);
const hms = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--");

export default function Inspector({ bot, mission, messages = [], steps = [], approvals = [], onClose }) {
  const { memories = [], skills = [] } = useStore();
  const [tab, setTab] = useState("ctx");
  const parts = useMemo(() => {
    const own = (x) => !x.botId || x.botId === bot?.id;
    const files = steps.flatMap((s) => s.tools || []).filter((t) => ["file", "web", "pdf_fields", "command", "app"].includes(t.card?.type));
    return {
      soul: tok([bot?.role, bot?.instructions, JSON.stringify(bot?.personality || {})].join(" ")),
      memory: memories.filter(own).reduce((n, m) => n + tok(m.text), 0),
      skills: skills.filter((s) => own(s) && s.status !== "archived").reduce((n, s) => n + tok(s.name + " " + s.description), 0),
      chat: messages.reduce((n, m) => n + tok(m.text), 0),
      files: files.reduce((n, t) => n + tok(t.card?.output || t.card?.excerpt || ""), 0),
    };
  }, [bot, memories, skills, messages, steps]);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const cells = [];
  for (const p of PARTS) { const n = total ? Math.round((parts[p.key] / total) * 64) : 0; for (let i = 0; i < n && cells.length < 64; i++) cells.push(p.color); }
  while (cells.length < 64) cells.push("rgba(255,255,255,.12)");
  const last = [...messages].reverse().find((m) => m.summary?.tokens);

  // What happened, in order: each turn, each call, each approval.
  const log = useMemo(() => {
    const lines = [];
    for (const s of steps) {
      const who = s.botId || bot?.id || "bot";
      if (s.startedAt) lines.push({ at: s.startedAt, t: `${hms(s.startedAt)} turn.start  ${who}` });
      for (const t of s.tools || []) lines.push({ at: s.startedAt || s.completedAt, t: `${hms(s.startedAt || s.completedAt)} tool.${t.status === "error" ? "error" : t.status === "running" ? "call " : "done "}  ${callOf(t)}` });
      if (s.completedAt) lines.push({ at: s.completedAt, t: `${hms(s.completedAt)} turn.${s.status === "completed" || s.status === "done" ? "done " : s.status}  ${who}` });
    }
    for (const a of approvals) lines.push({ at: a.createdAt || a.updatedAt, t: `${hms(a.createdAt || a.updatedAt)} approval    ${a.kind}  ${a.status}` });
    for (const m of messages) if (m.summary?.tokens) lines.push({ at: m.at, t: `${hms(m.at)} usage       tokens=${kTokens(m.summary.tokens)}${m.summary.cachedPercent != null ? ` cache=${m.summary.cachedPercent}%` : ""}` });
    return lines.sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).slice(-60).map((l) => l.t).join("\n");
  }, [steps, approvals, messages, bot]);

  const done = approvals.filter((a) => ["approved", "resolved", "answered", "done"].includes(a.status)).length;
  const waiting = approvals.filter((a) => a.status === "pending").length;
  const refused = approvals.filter((a) => ["rejected", "denied", "declined"].includes(a.status)).length;
  const tools = Object.entries(bot?.tools || {});
  const tabs = [["ctx", "Contexto"], ["tools", "Herramientas"], ["log", "Registro"]];

  return (
    <aside aria-label="Inspector" style={{ flex: "1 1 340px", maxWidth: "420px", minWidth: "300px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", padding: "16px 18px 20px", background: "var(--c-btn)", color: "var(--c-btn-text)", animation: "fade .2s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <h2 style={{ margin: 0, fontSize: "var(--t-body)", fontWeight: 600 }}>{"Inspector"}</h2>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "#A9ACB6" }}>{"Ctrl I"}</span>
          <button type="button" aria-label="Cerrar el inspector" onClick={onClose} style={{ width: "28px", height: "28px", padding: 0, border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "#C9CBD3", cursor: "pointer", fontSize: "var(--t-read)" }}>{"×"}</button>
        </span>
      </div>
      <div role="tablist" aria-label="Inspector" style={{ display: "flex", padding: "3px", gap: "2px", borderRadius: "var(--r-pill)", background: "rgba(255,255,255,.08)" }}>
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id ? "true" : "false"} onClick={() => setTab(id)} style={{ flex: "1", height: "30px", border: 0, borderRadius: "var(--r-pill)", background: tab === id ? "var(--c-card)" : "transparent", color: tab === id ? "var(--c-text)" : "#C9CBD3", fontSize: "var(--t-meta)", fontWeight: 600, cursor: "pointer" }}>{label}</button>)}
      </div>

      {tab === "ctx" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
            <span style={{ font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif" }}>{"≈ " + kTokens(total)}<span style={{ fontSize: "var(--t-body)", color: "#A9ACB6" }}>{" tokens"}</span></span>
            <span style={{ fontSize: "var(--t-meta)", color: "#A9ACB6" }}>{"estimado"}</span>
          </div>
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(32, minmax(0, 1fr))", gap: "3px" }}>
            {cells.map((c, i) => <span key={i} style={{ aspectRatio: "1", borderRadius: "var(--r-xs)", background: c }} />)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {PARTS.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-meta)" }}>
                <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "var(--r-xs)", background: p.color }} />
                <span style={{ flex: "1", color: "#E6E7EC" }}>{p.label}</span>
                <span style={{ font: "400 var(--t-caption)/1 'Geist Mono', monospace", color: "#A9ACB6" }}>{kTokens(parts[p.key])}</span>
              </div>
            ))}
          </div>
          {last ? <span style={{ font: "400 var(--t-caption)/1.5 'Geist Mono', monospace", color: "#A9ACB6" }}>{`último turno: ${kTokens(last.summary.tokens)} tokens${last.summary.calls ? ` · ${last.summary.calls} llamadas` : ""}${last.summary.cachedPercent != null ? ` · caché ${last.summary.cachedPercent} %` : ""}`}</span> : null}
        </div>
      ) : null}

      {tab === "tools" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {tools.length ? tools.map(([key, level]) => {
            const [label, bg, ink] = LEVEL[level] || LEVEL.none;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", fontSize: "var(--t-meta)" }}>
                <span style={{ flex: "1", font: "400 var(--t-meta)/1 'Geist Mono', monospace", color: "#E6E7EC" }}>{key}<span style={{ fontFamily: "'Geist', sans-serif", color: "#A9ACB6" }}>{TOOL_NAMES[key] ? " · " + TOOL_NAMES[key] : ""}</span></span>
                <span style={{ height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: bg, color: ink, fontSize: "var(--t-caption)", fontWeight: 600 }}>{label}</span>
              </div>
            );
          }) : <span style={{ fontSize: "var(--t-meta)", color: "#A9ACB6" }}>{"Este bot no tiene permisos propios: usa los de tu equipo."}</span>}
          <p style={{ margin: "10px 0 0", fontSize: "var(--t-meta)", lineHeight: "1.5", color: "#A9ACB6" }}>{"Enviar, comprar, publicar o pagar es línea roja: siempre pregunta, sin «permitir siempre»."}</p>
          {bot?.id ? <a href={`/equipo/${bot.id}`} style={{ marginTop: "4px", fontSize: "var(--t-meta)", color: "#9DB6FF" }}>{"Cambiar permisos en la ficha"}</a> : null}
        </div>
      ) : null}

      {tab === "log" ? (
        <pre aria-label="Registro" style={{ margin: 0, padding: "12px", borderRadius: "var(--r-md)", background: "rgba(255,255,255,.06)", font: "400 var(--t-caption)/1.7 'Geist Mono', monospace", color: "#C9CBD3", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{log || "Aún no ha pasado nada en esta conversación."}</pre>
      ) : null}

      <span style={{ flex: "1" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "14px", borderRadius: "var(--r-lg)", background: "rgba(255,255,255,.06)", fontSize: "var(--t-meta)", color: "#C9CBD3" }}>
        <span style={{ fontWeight: 600, color: "#FFFFFF" }}>{"Recibos de esta conversación"}</span>
        <span>{`${done} ${done === 1 ? "aprobado" : "aprobados"} · ${waiting} esperando · ${refused} ${refused === 1 ? "denegado" : "denegados"}`}</span>
        <span>{mission?.incognito ? "De incógnito: no aprende nada de aquí." : "Ninguna acción se repite sola tras un cierre."}</span>
      </div>
    </aside>
  );
}
