import { useEffect, useState } from "react";
import { Card, Notice, PageHeader, Toggle, btn, field } from "./SettingsShell.jsx";
import { formatTokens } from "./format.jsx";
import UsageHistory from "./UsageHistory.jsx";

// Tokens in everyday terms: ~650 tokens are one page of text read or written.
const TOKENS_PER_PAGE = 650;
const pages = (tokens) => {
  const n = Math.round((tokens || 0) / TOKENS_PER_PAGE);
  return n < 1 ? "menos de una página" : n === 1 ? "1 página" : `${n.toLocaleString("es-ES")} páginas`;
};
import { useAction, useStore } from "../../lib/store.jsx";
import { patch } from "../../lib/api.js";

const PRESETS = [1e6, 5e6, 20e6];

/** «5 h», «7 días»: the length of a plan window, in plain words. */
const windowName = (m) => (!m ? "Ahora" : m % 1440 === 0 ? (m === 10080 ? "Esta semana" : "En " + m / 1440 + " días") : m % 60 === 0 ? "En las últimas " + m / 60 + " h" : "En " + m + " min");

/** «Tu plan de ChatGPT»: how much of the plan's own windows is used (only when ChatGPT reports it). */
function PlanCard({ limits }) {
  const rows = [limits?.primary, limits?.secondary].filter(Boolean);
  if (!rows.length) return null;
  return (
    <Card id="plan" title="Tu plan de ChatGPT">
      {rows.map((w, i) => {
        const left = 100 - w.usedPercent;
        const reset = w.resetsAt ? new Date(w.resetsAt).toLocaleString("es-ES", { weekday: Date.parse(w.resetsAt) - Date.now() > 864e5 ? "short" : undefined, hour: "2-digit", minute: "2-digit" }) : null;
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "8px", fontSize: "14px" }}>
              <span><strong>{windowName(w.windowMinutes)}</strong>{": te queda el " + left + " %"}</span>
              {reset ? <span style={{ color: "#5C606C" }}>{"se renueva a las " + reset}</span> : null}
            </span>
            <span role="progressbar" aria-label={windowName(w.windowMinutes) + ": usado"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={w.usedPercent} style={{ height: "10px", borderRadius: "5px", background: "#F4F4F0", overflow: "hidden" }}>
              <span style={{ display: "block", width: w.usedPercent + "%", height: "100%", background: w.usedPercent >= 90 ? "#E5484D" : w.usedPercent >= 70 ? "#C98A00" : "#12131A" }} />
            </span>
          </div>
        );
      })}
      <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Es el límite de tu suscripción de ChatGPT, aparte del límite de Colmena. Se actualiza con cada respuesta de los bots."}</span>
    </Card>
  );
}

/** Ajustes › Límites y gasto: monthly usage, limit and alerts (PATCH /api/settings {limits}). */
export default function Limites() {
  const { usage, settings, planLimits } = useStore();
  const limits = settings.limits || {};
  const { act, busy, error, setError } = useAction();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(limits.monthlyTokens ? String(limits.monthlyTokens) : ""), [limits.monthlyTokens]);

  const used = usage?.monthTokens || 0;
  const limit = usage?.limitTokens ?? limits.monthlyTokens ?? null;
  const percent = usage?.percent ?? (limit ? Math.round((100 * used) / limit) : null);
  const barColor = percent >= 100 ? "#E5484D" : percent >= 80 ? "#C98A00" : "#12131A";
  const month = new Date().toLocaleDateString("es-ES", { month: "long" });

  const save = async (next) => {
    setSaved(false);
    const ok = await act(() => patch("/settings", { limits: { ...limits, ...next } }));
    if (ok !== undefined) setSaved(true);
  };
  const submit = (event) => {
    event.preventDefault();
    const n = value.trim() === "" ? null : Math.round(Number(value.replace(/[.\s]/g, "")));
    if (n !== null && (!Number.isFinite(n) || n < 1000)) return setError("Escribe un número de al menos 1.000, o déjalo vacío para no poner límite.");
    save({ monthlyTokens: n });
  };

  return (
    <>
      <PageHeader title="Límites y gasto">Cuánto pueden trabajar tus bots cada mes con tu cuenta de IA. Se mide en tokens (trozos de texto que leen y escriben): un millón da para unas 1.500 páginas.</PageHeader>
      <Notice>{error}</Notice>
      {saved && !error ? <Notice tone="ok">Guardado.</Notice> : null}

      <Card id="uso" title={`Uso de ${month}`} aside={percent !== null ? <span style={{ font: "600 13px/1 'Geist Mono', monospace", color: percent >= 80 ? "#8A6400" : "#5C606C" }}>{percent} %</span> : null}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "10px" }}>
          <span style={{ font: "600 40px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", letterSpacing: "-0.02em" }}>{formatTokens(used)}</span>
          <span style={{ fontSize: "15px", color: "#5C606C" }}>{limit ? `de ${formatTokens(limit)} tokens` : "tokens · sin límite"}</span>
        </div>
        <span role="progressbar" aria-label="Uso del mes" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0} style={{ height: "14px", borderRadius: "7px", background: "#F4F4F0", overflow: "hidden", position: "relative" }}>
          <span style={{ display: "block", width: `${Math.min(100, percent ?? 0)}%`, height: "100%", background: barColor }} />
          {limits.warnAt80 && limit ? <span aria-hidden="true" style={{ position: "absolute", left: "80%", top: "0", bottom: "0", width: "2px", background: "#FFFFFF" }} /> : null}
        </span>
        <span style={{ fontSize: "13px", color: "#5C606C" }}>{`Este mes han leído y escrito el equivalente a ${pages(used)}`}<span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px" }}>{` · ${used.toLocaleString("es-ES")} tokens`}</span></span>
      </Card>

      <UsageHistory />

      <PlanCard limits={planLimits} />

      <form onSubmit={submit} aria-labelledby="limite" style={{ background: "#FFFFFF", border: "0", borderRadius: "26px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 id="limite" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Límite mensual</h2>
          <span style={{ fontSize: "13px", color: "#5C606C" }}>{limits.monthlyTokens ? `Ahora: ${formatTokens(limits.monthlyTokens)} tokens al mes (unas ${pages(limits.monthlyTokens)}).` : "Ahora no hay límite: los bots trabajan lo que haga falta."}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "10px" }}>
          <label style={{ ...field.label, flex: "1 1 220px" }}>
            Tokens al mes
            <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Sin límite" style={{ ...field.input, ...field.mono }} />
          </label>
          <button type="submit" disabled={busy} style={{ ...btn.dark, height: "44px" }}>Guardar</button>
        </div>
        <div role="group" aria-label="Límites habituales" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {PRESETS.map((p) => {
            const on = limits.monthlyTokens === p;
            return <button key={p} type="button" title={`Unas ${pages(p)} al mes`} aria-pressed={on} disabled={busy} onClick={() => save({ monthlyTokens: p })} style={on ? { height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "18px", cursor: "pointer", fontSize: "13px", fontWeight: "600" } : { height: "36px", padding: "0 12px", background: "#FFFFFF", border: "0", borderRadius: "18px", cursor: "pointer", fontSize: "13px" }}>{formatTokens(p)}</button>;
          })}
          <button type="button" aria-pressed={!limits.monthlyTokens} disabled={busy} onClick={() => save({ monthlyTokens: null })} style={!limits.monthlyTokens ? { height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "18px", cursor: "pointer", fontSize: "13px", fontWeight: "600" } : { height: "36px", padding: "0 12px", background: "#FFFFFF", border: "0", borderRadius: "18px", cursor: "pointer", fontSize: "13px" }}>Sin límite</button>
        </div>
      </form>

      <Card id="avisos" title="Al acercarse al límite">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minHeight: "52px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "14px", lineHeight: "1.4" }}>
            Pausar a todo el equipo si se llega al límite
            <span style={{ fontSize: "12px", color: "#5C606C" }}>El trabajo hecho se conserva; lo reanudas desde Espacio.</span>
          </span>
          <Toggle on={!!limits.pauseAtLimit} disabled={busy} label="Pausar al llegar al límite" onChange={(v) => save({ pauseAtLimit: v })} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minHeight: "52px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "14px", lineHeight: "1.4" }}>
            Avisarme al llegar al 80 %
            <span style={{ fontSize: "12px", color: "#5C606C" }}>Un aviso cuando quede el 20 % del límite.</span>
          </span>
          <Toggle on={!!limits.warnAt80} disabled={busy} label="Avisar al 80 por ciento" onChange={(v) => save({ warnAt80: v })} />
        </div>
      </Card>
    </>
  );
}
