import { useState } from "react";
import { CircleAlert, Hand, PauseCircle, Ruler, ShieldAlert } from "lucide-react";

// «Se paró» (after assistant-ui stopped-run and MessageStatus.incomplete.reason): when a turn
// ends before its answer, one quiet card says why — you stopped it, it ran too long, a content
// filter cut it, an error, or something else — with «Continuar» (from the last saved step)
// and «Descartar» (drop what was left half done; what was said and done stays).

const REASONS = {
  cancelled: { icon: Hand, title: (n) => `Paraste a ${n}`, hint: "Lo hecho hasta ahora se queda. Continúa cuando quieras, o descártalo y escribe otra cosa." },
  length: { icon: Ruler, title: () => "La respuesta era demasiado larga", hint: "Se cortó antes de terminar. Al continuar sigue desde el último paso guardado." },
  "content-filter": { icon: ShieldAlert, title: () => "Un filtro de contenido la cortó", hint: "El proveedor de la IA no dejó terminar la respuesta. Prueba a pedirlo de otra manera." },
  error: { icon: CircleAlert, title: (n) => `${n} no pudo seguir`, hint: null },
  other: { icon: PauseCircle, title: (n) => `${n} se paró`, hint: null },
};

export default function StoppedCard({ stopped, botName = "El bot", onContinue, onDiscard }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const r = REASONS[stopped?.reason] || REASONS.other;
  const Icon = r.icon;
  const tone = stopped?.reason === "error" ? { bg: "#FBE7DF", fg: "#8E2A1F" } : stopped?.reason === "content-filter" ? { bg: "#FFF4D1", fg: "#8A5A00" } : { bg: "rgba(18,19,26,.06)", fg: "#3D404A" };
  const run = (what, fn) => async () => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try { await fn(); } catch (e) { setError(e?.message || "No se pudo."); } finally { setBusy(null); }
  };
  const detail = stopped?.detail && stopped.reason !== "cancelled" ? stopped.detail : null;
  return (
    <section role="status" aria-label="Se paró" style={{ display: "flex", gap: "14px", padding: "18px 20px", borderRadius: "24px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 0 0 1px rgba(18,19,26,.06)", animation: "rise .3s ease-out" }}>
      <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: tone.bg, color: tone.fg }}>
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        <strong style={{ fontSize: "16px", fontWeight: 600, color: "#12131A" }}>{r.title(botName)}</strong>
        {detail ? <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#3D404A", overflowWrap: "anywhere" }}>{detail}</span> : null}
        {r.hint ? <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{r.hint}</span> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "6px" }}>
          <button type="button" className="rm-focus" disabled={!!busy} onClick={run("continue", onContinue)} aria-busy={busy === "continue" ? "true" : undefined}
            style={{ height: "40px", padding: "0 18px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: busy ? "progress" : "pointer", fontSize: "14px", fontWeight: 600 }}>{busy === "continue" ? "Continuando…" : "Continuar"}</button>
          <button type="button" className="rm-focus" disabled={!!busy} onClick={run("discard", onDiscard)} title="Quita lo que quedó a medias; lo dicho y hecho se queda"
            style={{ height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", color: "#12131A", cursor: busy ? "progress" : "pointer", fontSize: "14px", fontWeight: 600 }}>{busy === "discard" ? "Descartando…" : "Descartar"}</button>
        </div>
        {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4372A", fontWeight: 600 }}>{error}</span> : null}
      </div>
    </section>
  );
}
