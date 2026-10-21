import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Card } from "./SettingsShell.jsx";
import { formatTokens } from "./format.jsx";
import { get } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { botById } from "../../lib/bots.js";
import { roomUrl } from "../../lib/format.js";
import { Avatar } from "../home/shared.jsx";

// «Últimos 30 días» (OpenClaw usage dashboard): tokens per day as bars (today in honey),
// then who used them — per bot or per room — and the whole detail as a CSV for Excel.
const dayLabel = (iso, long = false) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", long ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
};

export default function UsageHistory() {
  const { bots, missions } = useStore();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [by, setBy] = useState("bot");
  const [hover, setHover] = useState(null);
  // Refreshed at most once a minute while the team works.
  const updated = Math.floor(Date.parse(missions.reduce((t, m) => (m.updatedAt > t ? m.updatedAt : t), "")) / 60000) || 0;
  useEffect(() => {
    let alive = true;
    get("/usage/history?days=30").then((d) => alive && (setData(d), setFailed(false)), () => alive && setFailed(true));
    return () => { alive = false; };
  }, [updated]);

  const max = useMemo(() => Math.max(1, ...(data?.days || []).map((d) => d.tokens)), [data]);
  if (failed && !data) return <Card id="historial" title="Últimos 30 días"><span style={{ fontSize: "14px", color: "#5C606C" }}>{"No se pudo cargar el historial de uso."}</span></Card>;
  if (!data) return <Card id="historial" title="Últimos 30 días"><span aria-hidden="true" className="colmena-skeleton" style={{ height: "120px", borderRadius: "12px" }} /></Card>;

  const today = data.days.at(-1);
  const active = data.days.filter((d) => d.tokens > 0).length;
  const peak = data.days.reduce((p, d) => (d.tokens > (p?.tokens || 0) ? d : p), null);
  const shown = hover ? data.days.find((d) => d.date === hover) : null;
  const rows = by === "bot" ? data.bots : data.rooms;
  const top = Math.max(1, ...rows.map((r) => r.tokens));
  const caption = shown
    ? `${dayLabel(shown.date, true)}: ${shown.tokens ? formatTokens(shown.tokens) + " tokens · " + shown.calls + (shown.calls === 1 ? " llamada" : " llamadas") : "sin uso"}`
    : peak ? `El día de más uso fue el ${dayLabel(peak.date, true)}, con ${formatTokens(peak.tokens)} tokens.` : "Aún no hay uso en estos 30 días.";

  return (
    <Card id="historial" title="Últimos 30 días" aside={
      <a href="/api/usage/history.csv?days=30" download className="rm-focus" style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 12px", background: "#FFFFFF", color: "#12131A", border: "0", borderRadius: "999px", fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>
        <Download size={14} strokeWidth={2.2} aria-hidden="true" />{"Descargar CSV"}
      </a>
    }>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 14px" }}>
        <span style={{ font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", letterSpacing: "-0.02em" }}>{formatTokens(data.total)}</span>
        <span style={{ fontSize: "14px", color: "#5C606C" }}>{`tokens · ${data.calls.toLocaleString("es-ES")} ${data.calls === 1 ? "llamada" : "llamadas"} · ${active} ${active === 1 ? "día con uso" : "días con uso"}`}</span>
      </div>

      <div onMouseLeave={() => setHover(null)} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div role="group" aria-label="Tokens por día" style={{ height: "112px", display: "flex", alignItems: "flex-end", gap: "3px", borderBottom: "1px solid rgba(18,19,26,.1)" }}>
          {data.days.map((d) => {
            const isToday = d === today;
            const h = d.tokens ? Math.max(4, Math.round((d.tokens / max) * 108)) : 2;
            const on = hover === d.date;
            return (
              <button key={d.date} type="button" className="rm-focus" aria-label={`${dayLabel(d.date, true)}: ${d.tokens ? formatTokens(d.tokens) + " tokens" : "sin uso"}`}
                onMouseEnter={() => setHover(d.date)} onFocus={() => setHover(d.date)} onBlur={() => setHover(null)}
                style={{ flex: "1", minWidth: 0, height: "100%", padding: 0, background: "transparent", border: 0, cursor: "default", display: "flex", alignItems: "flex-end" }}>
                <span style={{ display: "block", width: "100%", height: h + "px", borderRadius: "3px 3px 0 0", background: !d.tokens ? "rgba(18,19,26,.1)" : isToday ? "#FFC93C" : on ? "#5C606C" : "#12131A", boxShadow: isToday && d.tokens ? "inset 0 0 0 1.5px #12131A" : "none", transition: "background .12s ease" }} />
              </button>
            );
          })}
        </div>
        <div aria-hidden="true" style={{ display: "flex", justifyContent: "space-between", font: "500 11px/1 'Geist Mono', monospace", color: "#6B6F7A" }}>
          <span>{dayLabel(data.from)}</span><span>{dayLabel(data.days[15].date)}</span><span>{"Hoy"}</span>
        </div>
        <span aria-live="polite" style={{ fontSize: "13px", color: "#3D404A", minHeight: "18px" }}>{caption}</span>
      </div>

      {rows.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid rgba(18,19,26,.06)", paddingTop: "14px" }}>
          <div role="group" aria-label="Ver el uso" style={{ display: "inline-flex", alignSelf: "flex-start", padding: "3px", background: "#F4F4F0", borderRadius: "10px" }}>
            {[["bot", "Por bot"], ["sala", "Por sala o chat"]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={by === id ? "true" : "false"} onClick={() => setBy(id)} className="rm-focus"
                style={{ height: "30px", padding: "0 12px", background: by === id ? "#FFFFFF" : "transparent", border: 0, borderRadius: "8px", boxShadow: by === id ? "0 1px 2px rgba(18,19,26,.12)" : "none", cursor: "pointer", fontSize: "13px", fontWeight: by === id ? 700 : 500, color: "#12131A" }}>{label}</button>
            ))}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            {rows.map((r) => {
              const bot = by === "bot" ? botById(bots, r.botId) : null;
              const m = by === "sala" ? missions.find((x) => x.id === r.missionId) : null;
              const pct = data.total ? Math.round((r.tokens / data.total) * 100) : 0;
              const name = bot?.name || r.name;
              return (
                <li key={r.botId || r.missionId} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr auto", alignItems: "center", gap: "12px", fontSize: "14px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    {bot ? <Avatar bot={bot} size={22} /> : null}
                    {m && r.exists ? <a href={roomUrl(m)} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{name}</a>
                      : <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: r.exists === false ? "#6B6F7A" : "#12131A" }}>{name}</span>}
                  </span>
                  <span aria-hidden="true" style={{ height: "8px", borderRadius: "4px", background: "#F4F4F0", overflow: "hidden" }}>
                    <span style={{ display: "block", width: Math.max(2, (r.tokens / top) * 100) + "%", height: "100%", background: "#12131A", borderRadius: "4px" }} />
                  </span>
                  <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C", whiteSpace: "nowrap" }}>{`${formatTokens(r.tokens)} · ${pct} %`}</span>
                </li>
              );
            })}
          </ul>
          {by === "sala" && data.rooms.length >= 12 ? <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{"Las 12 que más han usado. El CSV las tiene todas."}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}
