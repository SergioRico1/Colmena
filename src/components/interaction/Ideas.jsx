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

const errStyle = { fontSize: "var(--t-meta)", color: "#B4372A", fontWeight: "600" };

function Evidence({ items }) {
  return (
    <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map((e, i) => {
        const internal = typeof e.url === "string" && e.url.startsWith("/");
        const external = typeof e.url === "string" && e.url.startsWith("https://");
        return (
          <li key={i} style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "8px 10px", background: "#FFFFFF", border: "1px solid #CBD8FF", borderRadius: "10px" }}>
            <span style={{ font: "500 var(--t-micro)/1.3 'Geist Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase", color: "#4A4F5C" }}>{e.source}</span>
            {e.quote ? <q style={{ fontSize: "var(--t-meta)", lineHeight: "1.45", color: "#2B2D36", quotes: "«» «»" }}>{e.quote}</q> : null}
            {internal ? <a href={e.url} style={{ alignSelf: "flex-start", fontSize: "var(--t-caption)", fontWeight: "600", color: "#1F4FD1", textDecoration: "underline" }}>{"Abrir"}</a> : null}
            {external ? <a href={e.url} target="_blank" rel="noreferrer noopener" style={{ alignSelf: "flex-start", fontSize: "var(--t-caption)", fontWeight: "600", color: "#1F4FD1", textDecoration: "underline" }}>{"Abrir en el calendario"}</a> : null}
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
  const b = botById(bots, s.botId) || botById(bots, "atlas") || { name: "Atlas", color: "#12131A", shape: "hex" };
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
      <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "10px", fontSize: "var(--t-ui)", lineHeight: "1.45" }}>
        <span><strong>{"Atlas ha notado"}</strong>{" " + text}</span>
        {open && evidence.length ? <Evidence items={evidence} /> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" disabled={busy} onClick={() => decide("accept")} style={{ height: "38px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontWeight: "600", fontSize: "var(--t-meta)" }}>{s.cta || fallbackCta}</button>
          <button type="button" disabled={busy} onClick={() => decide("dismiss")} style={{ height: "38px", padding: "0 12px", background: "transparent", border: "0", cursor: "pointer", fontSize: "var(--t-meta)", color: "#2B2D36" }}>{"Ahora no"}</button>
          {evidence.length ? (
            <button type="button" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "4px", height: "38px", padding: "0 6px", background: "transparent", border: "0", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: "600", color: "#1F4FD1" }}>
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
