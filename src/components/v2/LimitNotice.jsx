import { useEffect, useState } from "react";
import { Hourglass } from "../Icon.js";
import { patch, post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { engineName, renewText } from "../../lib/limitWords.js";

// «Límite del plan» (T3 Code UsageLimitRecoveryBanner, in Colmena 3's look, design/V3Estados):
// an AI ran out of its plan, which limit it was, when it renews, and that the work goes on —
// with the backup account, or by itself when it renews. Nothing stops without saying so.
// LimitBanner goes in a chat or room (mission.limited); PlanLimitNotice at app level (Inicio);
// LimitLine on a bot's card.

// The engine names and «hoy a las 15:40» live in lib/limitWords.js (a paused task's reason uses them too).
export { engineName, renewText };

/** Re-renders every 30 s so «en 12 min» counts down. */
function useMinuteClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The usage bar: «100 % usado · vuelve hoy a las 18:40» at the limit, or how much is used when parked before it. */
function FullBar({ when, percent = 100, back = "vuelve" }) {
  const used = Math.max(0, Math.min(100, Math.round(Number(percent)) || 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span aria-hidden="true" style={{ height: "8px", borderRadius: "var(--r-xs)", background: "var(--c-chip)", overflow: "hidden" }}>
        <span style={{ display: "block", width: used + "%", height: "100%", background: "#12131A" }} />
      </span>
      <span style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
        <span>{used} % usado</span>
        {when ? <span>{back} {when}</span> : null}
      </span>
    </div>
  );
}
const card = { display: "flex", flexDirection: "column", justifyContent: "center", gap: "14px", padding: "28px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", animation: "fade .3s ease-out" };
const outline = (busy = false) => ({ height: "42px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 500, cursor: busy ? "wait" : "pointer" });
const link = { height: "42px", padding: "0 12px", display: "inline-flex", alignItems: "center", border: 0, background: "transparent", color: "var(--c-accent-ink)", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer", textDecoration: "none" };

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
  const resume = () => act.act(() => post(`/missions/${mission.id}/control`, { action: "resume" }));
  // Parked before the plan ran out (long work waits so you can keep chatting): the same card,
  // with how much is used and «Continuar ahora» for this one.
  if (limited.plan) return (
    <section role="status" aria-label="Queda poco del plan" style={{ ...card, padding: "22px 24px", boxShadow: "0 0 0 1px rgba(18,19,26,.08)" }}>
      <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{`Queda poco del plan de ${engineName(limited.engine)}`}</span>
      <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>
        {`${who} lo deja en pausa para que puedas seguir chateando. ${when ? `Sigue por su cuenta cuando se renueve, ${when}` : `Lo vuelve a mirar por su cuenta ${again || "dentro de un rato"}`}; lo hecho se conserva.`}
      </span>
      {limited.percent != null ? <FullBar percent={limited.percent} when={when} back="se renueva" /> : null}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button type="button" disabled={act.busy} onClick={resume} style={outline(act.busy)}>Continuar ahora</button>
        <a href="/ajustes/uso#pausa-plan" onClick={(e) => { e.preventDefault(); navigate("/ajustes/uso#pausa-plan"); }} style={link}>Cambiar cuándo se pausa</a>
      </div>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{act.error}</p> : null}
    </section>
  );
  return (
    <section role="status" aria-label="Límite del plan" style={{ ...card, padding: "22px 24px", boxShadow: "0 0 0 1px rgba(18,19,26,.08)" }}>
      <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{`${engineName(limited.engine)} ha llegado a su ${limited.label || "límite de uso"}`}</span>
      <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>
        {when ? `Se renueva ${when} y ${who} seguirá entonces por su cuenta; lo hecho se conserva.` : `${who} lo volverá a intentar por su cuenta ${again || "dentro de un rato"}; lo hecho se conserva.`}
      </span>
      <FullBar when={when} />
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => navigate("/ajustes/ia#respaldo")} style={outline()}>Usar otra IA mientras</button>
        <button type="button" disabled={act.busy} onClick={resume} style={{ ...link, cursor: act.busy ? "wait" : "pointer" }}>Intentar ahora</button>
      </div>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{act.error}</p> : null}
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
      <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{`${name} ha llegado a su ${primary.limit.label || "límite de uso"}`}</span>
      <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>
        {backup
          ? `Tus bots siguen con ${backup.local ? backup.label : backup.label + ", tu cuenta de respaldo"}, como pediste en Ajustes. ${name} vuelve ${when || "dentro de un rato"}.`
          : `Tus bots esperan a que vuelva ${when || "dentro de un rato"}; lo hecho se conserva. Con una cuenta de respaldo seguirían con ella.`}
      </span>
      <FullBar when={when} />
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {backup ? <button type="button" disabled={act.busy} title="Deja de usar el respaldo; lo puedes volver a elegir en Ajustes" onClick={() => act.act(() => patch("/ai/engines", { fallback: "none" }))} style={outline(act.busy)}>{`Mejor esperar a ${name}`}</button> : null}
        <a href="/ajustes/ia#respaldo" onClick={(e) => { e.preventDefault(); navigate("/ajustes/ia#respaldo"); }} style={link}>{backup ? "Cambiar el respaldo" : "Elegir un respaldo"}</a>
      </div>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{act.error}</p> : null}
    </section>
  );
}

/** One line for a bot's card: «Limitado · vuelve hoy a las 15:40». Neutral: it goes on by itself, it does not wait for you. */
export function LimitLine({ limited, style = null }) {
  const now = useMinuteClock();
  if (!limited) return null;
  const when = renewText(limited.resetsAt || limited.resumeAt || limited.until, now);
  return (
    <span title={limited.plan ? `Queda poco del plan de ${engineName(limited.engine)}: su trabajo largo espera a que se renueve` : `${engineName(limited.engine)} ha llegado a su ${limited.label || "límite de uso"}`} style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: "var(--c-text-2)", minWidth: 0, ...style }}>
      <Hourglass size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(limited.plan ? "En pausa" : "Limitado") + (when ? (limited.plan ? " · sigue " : " · vuelve ") + when : "")}</span>
    </span>
  );
}
