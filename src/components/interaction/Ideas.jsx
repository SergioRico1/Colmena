import { useState } from "react";
import { BotPresence } from "../v2/Presence.jsx";
import { post } from "../../lib/api.js";
import { avatarStyle, botById, initial } from "../../lib/bots.js";
import { navigate } from "../../lib/router.jsx";
import { useAction } from "../../lib/store.jsx";
import { roomUrl } from "../../lib/format.js";

// «Atlas ha notado…» with evidence (openmuse ideas): each suggestion can show where it
// comes from («Ver de dónde sale»). Same card as design/Automatizaciones (blue note).
// Plus the weekly summary card for Inicio (OpenClaw team-reports).

const errStyle = { fontSize: "13px", color: "#B4372A", fontWeight: "600" };

function Evidence({ items }) {
  return (
    <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map((e, i) => {
        const internal = typeof e.url === "string" && e.url.startsWith("/");
        const external = typeof e.url === "string" && e.url.startsWith("https://");
        return (
          <li key={i} style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "8px 10px", background: "#FFFFFF", border: "1px solid #CBD8FF", borderRadius: "10px" }}>
            <span style={{ font: "500 11px/1.3 'Geist Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase", color: "#4A4F5C" }}>{e.source}</span>
            {e.quote ? <q style={{ fontSize: "13px", lineHeight: "1.45", color: "#2B2D36", quotes: "«» «»" }}>{e.quote}</q> : null}
            {internal ? <a href={e.url} style={{ alignSelf: "flex-start", fontSize: "12px", fontWeight: "600", color: "#1F4FD1", textDecoration: "underline" }}>{"Abrir"}</a> : null}
            {external ? <a href={e.url} target="_blank" rel="noreferrer noopener" style={{ alignSelf: "flex-start", fontSize: "12px", fontWeight: "600", color: "#1F4FD1", textDecoration: "underline" }}>{"Abrir en el calendario"}</a> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One suggestion: text, «Ver de dónde sale», accept / «Ahora no». */
export function SuggestionCard({ s, bots, fallbackCta = "Sí, hazlo" }) {
  const [open, setOpen] = useState(false);
  const { act, busy, error } = useAction();
  const b = botById(bots, s.botId) || botById(bots, "atlas") || { name: "Atlas", color: "#FFC93C", shape: "hex" };
  const text = (s.text || "").replace(/^Atlas ha notado\s*(que\s*)?/i, (m, que) => (que ? "que " : ""));
  const evidence = Array.isArray(s.evidence) ? s.evidence : [];
  const decide = (decision) =>
    act(async () => {
      const result = await post(`/suggestions/${encodeURIComponent(s.id)}`, { decision });
      if (decision === "accept" && result?.missionId) navigate(roomUrl({ id: result.missionId }));
      return result;
    });
  return (
    <div style={{ display: "flex", gap: "12px", padding: "14px 16px", background: "#E7EEFF", border: "1px solid #B4C8FF", borderRadius: "14px" }}>
      <BotPresence bot={b} size={30} />
      <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px", lineHeight: "1.45" }}>
        <span><strong>{"Atlas ha notado"}</strong>{" " + text}</span>
        {open && evidence.length ? <Evidence items={evidence} /> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" disabled={busy} onClick={() => decide("accept")} style={{ height: "38px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontWeight: "600", fontSize: "13px" }}>{s.cta || fallbackCta}</button>
          <button type="button" disabled={busy} onClick={() => decide("dismiss")} style={{ height: "38px", padding: "0 12px", background: "transparent", border: "0", cursor: "pointer", fontSize: "13px", color: "#2B2D36" }}>{"Ahora no"}</button>
          {evidence.length ? (
            <button type="button" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "4px", height: "38px", padding: "0 6px", background: "transparent", border: "0", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>
              {open ? "Ocultar de dónde sale" : "Ver de dónde sale"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="m6 9 6 6 6-6" /></svg>
            </button>
          ) : null}
        </div>
        {error ? <span role="alert" style={errStyle}>{error}</span> : null}
      </div>
    </div>
  );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Inicio: Atlas's weekly summary (Friday 17:00). Hidden when there is none this week. */
export function WeeklyDigestCard({ digest, bots }) {
  const { act, busy, error } = useAction();
  if (!digest) return null;
  const s = digest.stats || {};
  const atlas = botById(bots, "atlas") || { name: "Atlas", color: "#FFC93C", shape: "hex" };
  const tiles = [
    [s.missions || 0, "misión terminada", "misiones terminadas"],
    [s.artifacts || 0, "entregable nuevo", "entregables nuevos"],
    [s.approvals || 0, "aprobación tuya", "aprobaciones tuyas"],
    [s.skills || 0, "habilidad aprendida", "habilidades aprendidas"],
  ];
  const h = s.highlights || {};
  return (
    <section aria-labelledby="resumen-semana" style={{ background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "18px", boxShadow: "6px 6px 0 #FFC93C", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
        <BotPresence bot={atlas} size={34} />
        <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{"Resumen de la semana"}</span>
          <h2 id="resumen-semana" style={{ margin: "0", font: "700 20px/1.15 'Bricolage Grotesque', sans-serif" }}>{`${atlas.name} te cuenta cómo ha ido`}</h2>
        </div>
        <button type="button" disabled={busy} onClick={() => act(() => post(`/weekly-digest/${encodeURIComponent(digest.id)}/dismiss`))} style={{ height: "38px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>{"Leído"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))", gap: "10px" }}>
        {tiles.map(([n, one, many]) => (
          <div key={one} style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "12px", background: "#F7F8FA", border: "1px solid #E6E8EE", borderRadius: "12px" }}>
            <strong style={{ font: "800 26px/1 'Bricolage Grotesque', sans-serif" }}>{n}</strong>
            <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{n === 1 ? one : many}</span>
          </div>
        ))}
      </div>
      {h.missions?.length ? (
        <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#2B2D36" }}>
          <strong>{"Terminadas: "}</strong>
          {h.missions.map((m, i) => (
            <span key={m.id}>{i ? ", " : ""}<a href={`/misiones/${m.id}`} style={{ textDecoration: "underline" }}>{m.title}</a></span>
          ))}
          {h.busiest ? `. Quien más ha trabajado: ${h.busiest.name} (${plural(h.busiest.missions, "misión", "misiones")}).` : "."}
        </p>
      ) : null}
      {h.skills?.length ? <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#2B2D36" }}><strong>{"Ha aprendido: "}</strong>{h.skills.map((x) => `«${x.name}»`).join(", ")}{h.skills.some((x) => x.status === "pending") ? " · alguna espera tu revisión" : ""}.</p> : null}
      <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.5" }}>{digest.closing || digest.text}</p>
      {error ? <span role="alert" style={errStyle}>{error}</span> : null}
    </section>
  );
}
