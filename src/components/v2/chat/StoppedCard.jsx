import { useState } from "react";
import { withRowBoundary } from "../../RowBoundary.jsx";

// «Se paró» (after assistant-ui stopped-run and MessageStatus.incomplete.reason): when a turn
// ends before its answer, one quiet card says why — you stopped it, it ran too long, a content
// filter cut it, an error, or something else — with «Continuar» (from the last saved step)
// and «Descartar» (drop what was left half done; what was said and done stays).

const REASONS = {
  cancelled: { title: (n) => `Paraste a ${n}`, hint: "Lo hecho hasta ahora se queda. Continúa cuando quieras, o descártalo y escribe otra cosa." },
  length: { title: () => "La respuesta era demasiado larga", hint: "Se cortó antes de terminar. Al continuar sigue desde el último paso guardado." },
  "content-filter": { title: () => "Un filtro de contenido la cortó", hint: "El proveedor de la IA no dejó terminar la respuesta. Prueba a pedirlo de otra manera." },
  error: { title: (n) => `${n} no pudo seguir`, hint: null },
  other: { title: (n) => `${n} se paró`, hint: null },
};

function StoppedCard({ stopped, botName = "El bot", onContinue, onDiscard }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const r = REASONS[stopped?.reason] || REASONS.other;
    const tone = stopped?.reason === "error" ? { bg: "#FBE7DF", fg: "#8E2A1F" } : stopped?.reason === "content-filter" ? { bg: "#FFF4D1", fg: "#8A5A00" } : { bg: "rgba(18,19,26,.06)", fg: "#3D404A" };
  const run = (what, fn) => async () => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try { await fn(); } catch (e) { setError(e?.message || "No se pudo."); } finally { setBusy(null); }
  };
  const detail = stopped?.detail && stopped.reason !== "cancelled" ? stopped.detail : null;
  // Colmena 3 (design/V3ChatExperto.dc.html): one quiet grey line with what happened and the
  // two ways on — «Continuar» in ink, «Descartar» outlined.
  return (
    <section role="status" aria-label="Se paró" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "12px 14px 12px 16px", borderRadius: "14px", background: tone.bg === "rgba(18,19,26,.06)" ? "#F1F1EC" : tone.bg, animation: "rise .3s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <span style={{ flex: "1", minWidth: "200px", fontSize: "14px", lineHeight: "1.45", color: "#12131A" }}>
          <strong style={{ fontWeight: 600 }}>{r.title(botName) + "."}</strong>{r.hint ? " " + r.hint : ""}
        </span>
        <button type="button" className="rm-focus" disabled={!!busy} onClick={run("continue", onContinue)} aria-busy={busy === "continue" ? "true" : undefined}
          style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: busy ? "progress" : "pointer", fontSize: "13.5px", fontWeight: 600 }}>{busy === "continue" ? "Continuando…" : "Continuar"}</button>
        <button type="button" className="rm-focus" disabled={!!busy} onClick={run("discard", onDiscard)} title="Quita lo que quedó a medias; lo dicho y hecho se queda"
          style={{ height: "34px", padding: "0 12px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", cursor: busy ? "progress" : "pointer", fontSize: "13.5px" }}>{busy === "discard" ? "Descartando…" : "Descartar"}</button>
      </div>
      {detail ? <span style={{ fontSize: "13px", lineHeight: "1.5", color: tone.fg, overflowWrap: "anywhere" }}>{detail}</span> : null}
      {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4232A", fontWeight: 600 }}>{error}</span> : null}
    </section>
  );
}

export default withRowBoundary(StoppedCard, { label: "No se ha podido mostrar este aviso", resetKey: ({ stopped }) => `${stopped?.reason}:${stopped?.at}` });
