import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { post } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";

// «Limitado» (T3 Code UsageLimitRecoveryBanner, in Colmena's v2 look): an AI ran out of its
// plan, which limit it was, when it renews, and that the work goes on by itself then.
// LimitBanner goes in a chat or room (mission.limited); LimitLine on a bot's card.

const ENGINE = { openai: "ChatGPT", anthropic: "Claude", "opencode-go": "OpenCode Go" };
export const engineName = (engine) => ENGINE[engine] || "La IA";

/** «hoy a las 15:40», «en 12 min», «mañana a las 9:05». */
export function renewText(iso, at = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  if (t - at < 60_000) return "en un momento";
  if (t - at < 3_600_000) return "en " + Math.ceil((t - at) / 60_000) + " min";
  const d = new Date(t), now = new Date(at);
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  if (days <= 0) return "hoy a las " + hm;
  if (days === 1) return "mañana a las " + hm;
  if (days < 7) return "el " + d.toLocaleDateString("es-ES", { weekday: "long" }) + " a las " + hm;
  return "el " + d.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + " a las " + hm;
}

/** Re-renders every 30 s so «en 12 min» counts down. */
function useMinuteClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The chat/room banner for a mission paused by a usage limit. `botName` says who goes on.
 * Actions: choose another AI (Ajustes › Inteligencia) or try now (resume).
 */
export function LimitBanner({ mission, botName = null }) {
  const now = useMinuteClock();
  const act = useAction();
  const limited = mission?.limited;
  if (!limited) return null;
  const when = renewText(limited.resetsAt, now);
  const again = renewText(limited.resumeAt, now);
  const who = botName || "El equipo";
  return (
    <section role="status" aria-label="Limitado" style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "18px 20px", borderRadius: "22px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.08), 0 18px 40px -28px rgba(18,19,26,.35)", animation: "fade .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
        <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", borderRadius: "14px", background: "#FFF4D1", color: "#8A5A00" }}>
          <Hourglass size={19} strokeWidth={2.1} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "15px", fontWeight: 600 }}>Limitado</strong>
            <span style={{ fontSize: "13px", color: "#8A5A00" }}>{engineName(limited.engine)} · {limited.label || "límite de uso"}</span>
          </span>
          <span style={{ fontSize: "15px", lineHeight: 1.5, color: "#3D404A" }}>
            {when ? `Se renueva ${when} y ${who} seguirá entonces por su cuenta; lo hecho se conserva.` : `${who} lo volverá a intentar por su cuenta ${again || "dentro de un rato"}; lo hecho se conserva.`}
          </span>
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingLeft: "54px" }}>
        <button type="button" onClick={() => navigate("/ajustes/inteligencia#respaldo")} style={{ height: "36px", padding: "0 16px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#FFFFFF", background: "#12131A" }}>Usar otra IA mientras</button>
        <button type="button" disabled={act.busy} onClick={() => act.act(() => post(`/missions/${mission.id}/control`, { action: "resume" }))} style={{ height: "36px", padding: "0 16px", border: 0, borderRadius: "999px", cursor: act.busy ? "wait" : "pointer", fontSize: "13px", fontWeight: 600, color: "#12131A", background: "rgba(18,19,26,.06)" }}>Intentar ahora</button>
      </div>
      {act.error ? <p role="alert" style={{ margin: "0 0 0 54px", fontSize: "13px", color: "#B4372A" }}>{act.error}</p> : null}
    </section>
  );
}

/** One line for a bot's card: «Limitado · vuelve hoy a las 15:40». */
export function LimitLine({ limited, style = null }) {
  const now = useMinuteClock();
  if (!limited) return null;
  const when = renewText(limited.resetsAt || limited.resumeAt || limited.until, now);
  return (
    <span title={`${engineName(limited.engine)} ha llegado a su ${limited.label || "límite de uso"}`} style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#8A5A00", minWidth: 0, ...style }}>
      <Hourglass size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"Limitado" + (when ? " · vuelve " + when : "")}</span>
    </span>
  );
}
