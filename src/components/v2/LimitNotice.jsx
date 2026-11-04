import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { patch, post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";

// «Límite del plan» (T3 Code UsageLimitRecoveryBanner, in Colmena 3's look, design/V3Estados):
// an AI ran out of its plan, which limit it was, when it renews, and that the work goes on —
// with the backup account, or by itself when it renews. Nothing stops without saying so.
// LimitBanner goes in a chat or room (mission.limited); PlanLimitNotice at app level (Inicio);
// LimitLine on a bot's card.

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

/** The usage bar at its limit: «100 % usado · vuelve hoy a las 18:40». */
function FullBar({ when }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span aria-hidden="true" style={{ height: "8px", borderRadius: "4px", background: "#12131A" }} />
      <span style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12.5px", color: "#5C606C" }}>
        <span>100 % usado</span>
        {when ? <span>vuelve {when}</span> : null}
      </span>
    </div>
  );
}
const card = { display: "flex", flexDirection: "column", justifyContent: "center", gap: "14px", padding: "28px", borderRadius: "24px", background: "#FFFFFF", animation: "fade .3s ease-out" };
const outline = (busy = false) => ({ height: "42px", padding: "0 16px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", fontSize: "14px", fontWeight: 500, cursor: busy ? "wait" : "pointer" });
const link = { height: "42px", padding: "0 12px", display: "inline-flex", alignItems: "center", border: 0, background: "transparent", color: "#1F4FD1", fontSize: "14px", fontWeight: 500, cursor: "pointer", textDecoration: "none" };

/**
 * The chat/room banner for a mission paused by a usage limit. `botName` says who goes on.
 * Ways out: another AI meanwhile (Ajustes › Cuentas de IA › Si falla, usar) or try now (resume).
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
    <section role="status" aria-label="Límite del plan" style={{ ...card, padding: "22px 24px", boxShadow: "0 0 0 1px rgba(18,19,26,.08)" }}>
      <span style={{ fontSize: "15.5px", fontWeight: 600 }}>{`${engineName(limited.engine)} ha llegado a su ${limited.label || "límite de uso"}`}</span>
      <span style={{ fontSize: "14px", lineHeight: 1.5, color: "#4A4D57" }}>
        {when ? `Se renueva ${when} y ${who} seguirá entonces por su cuenta; lo hecho se conserva.` : `${who} lo volverá a intentar por su cuenta ${again || "dentro de un rato"}; lo hecho se conserva.`}
      </span>
      <FullBar when={when} />
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => navigate("/ajustes/ia#respaldo")} style={outline()}>Usar otra IA mientras</button>
        <button type="button" disabled={act.busy} onClick={() => act.act(() => post(`/missions/${mission.id}/control`, { action: "resume" }))} style={{ ...link, cursor: act.busy ? "wait" : "pointer" }}>Intentar ahora</button>
      </div>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "13px", color: "#B4232A" }}>{act.error}</p> : null}
    </section>
  );
}

/**
 * App level (Inicio): the team's AI ran out of its plan. With a backup account chosen in
 * Ajustes nothing stops — the bots go on with it, the card says so and when the first one is
 * back; «Mejor esperar a …» stops using the backup. Without one, they wait for it.
 * Null while the team's engine is not limited.
 */
export function PlanLimitNotice({ style = null }) {
  const { ai } = useStore();
  const now = useMinuteClock();
  const act = useAction();
  const engines = ai?.engines || [];
  const primary = engines.find((e) => e.id === ai?.primary) || engines.find((e) => e.connected) || null;
  if (!primary?.limit) return null;
  const when = renewText(primary.limit.resetsAt || primary.limit.until, now);
  const name = engineName(primary.id);
  const backup = ai.fallback === "local" && ai.local ? { label: "el modelo de este ordenador", local: true }
    : engines.find((e) => e.id === ai.fallback && e.id !== primary.id && e.connected && !e.resting) || null;
  return (
    <section role="status" aria-label="Límite del plan" style={{ ...card, ...style }}>
      <span style={{ fontSize: "15.5px", fontWeight: 600 }}>{`${name} ha llegado a su ${primary.limit.label || "límite de uso"}`}</span>
      <span style={{ fontSize: "14px", lineHeight: 1.5, color: "#4A4D57" }}>
        {backup
          ? `Tus bots siguen con ${backup.local ? backup.label : backup.label + ", tu cuenta de respaldo"}, como pediste en Ajustes. ${name} vuelve ${when || "dentro de un rato"}.`
          : `Tus bots esperan a que vuelva ${when || "dentro de un rato"}; lo hecho se conserva. Con una cuenta de respaldo seguirían con ella.`}
      </span>
      <FullBar when={when} />
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {backup ? <button type="button" disabled={act.busy} title="Deja de usar el respaldo; lo puedes volver a elegir en Ajustes" onClick={() => act.act(() => patch("/ai/engines", { fallback: "none" }))} style={outline(act.busy)}>{`Mejor esperar a ${name}`}</button> : null}
        <a href="/ajustes/ia#respaldo" onClick={(e) => { e.preventDefault(); navigate("/ajustes/ia#respaldo"); }} style={link}>{backup ? "Cambiar el respaldo" : "Elegir un respaldo"}</a>
      </div>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "13px", color: "#B4232A" }}>{act.error}</p> : null}
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
