import { useMemo, useState } from "react";
import { BotPresence } from "../../v2/Presence.jsx";
import { formatTokens } from "../../settings/format.jsx";
import { weekRange, weekSummary } from "../../../lib/week.js";

// «Tu semana con el equipo» (it lived at the foot of Inicio; now in Actividad, where what the
// team did is told): what the last seven days were and what comes, once per week («Leído»).
const weekKey = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };

export default function WeekDigest({ missions, approvals, skills, usage, bots, goals, artifacts }) {
  const key = "colmena:digest:" + weekKey();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const week = useMemo(() => weekSummary({ missions, approvals, skills, goals, artifacts }), [missions, approvals, skills, goals, artifacts]);
  if (dismissed || (!week.done && !week.approved && !week.skills)) return null;
  const spend = usage?.percent != null ? { n: usage.percent + " %", label: "del gasto del mes" } : { n: formatTokens(usage?.monthTokens || 0), label: "tokens este mes" };
  const atlas = bots.find((b) => b.id === "atlas") || { shape: "hex", color: "#12131A" };
  const stat = (value, label) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "rgba(255,255,255,.08)" }}>
      <span style={{ font: "600 var(--t-headline)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: "var(--t-meta)", color: "#B8BBC4" }}>{label}</span>
    </div>
  );
  const list = (head, items) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontSize: "var(--t-meta)", fontWeight: "500", color: "#B8BBC4" }}>{head}</span>
      <ul style={{ margin: "0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-body)", lineHeight: "1.5", color: "#E6E7EC" }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
  const pill = { display: "inline-flex", alignItems: "center", height: "40px", padding: "0 16px", borderRadius: "var(--r-pill)", fontSize: "var(--t-ui)", fontWeight: "600" };
  return (
    <section aria-labelledby="wk-t" style={{ display: "flex", flexDirection: "column", gap: "18px", padding: "24px 28px", borderRadius: "var(--r-2xl)", background: "#12131A", color: "#FFFFFF", animation: "rise .5s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <BotPresence bot={atlas} size={26} state="rest" />
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <h2 id="wk-t" style={{ margin: "0", font: "600 var(--t-title)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Tu semana con el equipo"}</h2>
            <span style={{ fontSize: "var(--t-meta)", color: "#B8BBC4" }}>{weekRange(week.from, week.to) + " · te lo resume " + (atlas.name || "Atlas")}</span>
          </div>
        </div>
        <button type="button" onClick={() => { try { localStorage.setItem(key, "1"); } catch {} setDismissed(true); }} style={{ ...pill, border: "0", background: "rgba(255,255,255,.1)", color: "#FFFFFF", cursor: "pointer" }}>{"Leído"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
        {stat(week.done, week.done === 1 ? "trabajo terminado" : "trabajos terminados")}
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
