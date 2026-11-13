import { useState } from "react";
import { withRowBoundary } from "../../RowBoundary.jsx";

// «Se paró» (after assistant-ui stopped-run and MessageStatus.incomplete.reason): when a turn
// ends before its answer, one quiet card says why — you stopped it, it ran too long, a content
// filter cut it, an error, or something else — with «Continuar» (from the last saved step)
// and «Descartar» (drop what was left half done; what was said and done stays). When it was
// you who stopped it, a one-line field beside them lets you say why («Dile por qué lo has
// parado», optional): the bot reads it at its next turn as information — never as a request
// to send or approve anything (server/stopped.mjs stopWhyText). Intro keeps it; «Continuar»
// and «Descartar» take it along.

const REASONS = {
  cancelled: { title: (n) => `Paraste a ${n}`, hint: "Lo hecho hasta ahora se queda. Continúa cuando quieras, o descártalo y escribe otra cosa." },
  length: { title: () => "La respuesta era demasiado larga", hint: "Se cortó antes de terminar. Al continuar sigue desde el último paso guardado." },
  "content-filter": { title: () => "Un filtro de contenido la cortó", hint: "El proveedor de la IA no dejó terminar la respuesta. Prueba a pedirlo de otra manera." },
  error: { title: (n) => `${n} no pudo seguir`, hint: null },
  other: { title: (n) => `${n} se paró`, hint: null },
};
const WHY_MAX = 300;

function StoppedCard({ stopped, botName = "El bot", onContinue, onDiscard, onReason = null }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // What you told it (kept on the stop), and what is in the field now.
  const [why, setWhy] = useState(stopped?.why || "");
  const [kept, setKept] = useState(stopped?.why || "");
  const r = REASONS[stopped?.reason] || REASONS.other;
    const tone = stopped?.reason === "error" ? { bg: "#FBE7DF", fg: "#8E2A1F" } : stopped?.reason === "content-filter" ? { bg: "#FFF4D1", fg: "#8A5A00" } : { bg: "rgba(18,19,26,.06)", fg: "#3D404A" };
  const run = (what, fn) => async () => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try { await fn(); } catch (e) { setError(e?.message || "No se pudo."); } finally { setBusy(null); }
  };
  const mine = stopped?.reason === "cancelled" && !!onReason;
  const said = why.trim();
  const keep = run("why", async () => { if (!said || said === kept) return; await onReason(said); setKept(said); });
  const detail = stopped?.detail && stopped.reason !== "cancelled" ? stopped.detail : null;
  const buttons = (
    <>
      <button type="button" className="rm-focus" disabled={!!busy} onClick={run("continue", () => onContinue(mine && said ? said : undefined))} aria-busy={busy === "continue" ? "true" : undefined}
        style={{ flex: "none", height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: busy ? "progress" : "pointer", fontSize: "var(--t-ui)", fontWeight: 600 }}>{busy === "continue" ? "Continuando…" : "Continuar"}</button>
      <button type="button" className="rm-focus" disabled={!!busy} onClick={run("discard", () => onDiscard(mine && said ? said : undefined))} title="Quita lo que quedó a medias; lo dicho y hecho se queda"
        style={{ flex: "none", height: "34px", padding: "0 12px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", cursor: busy ? "progress" : "pointer", fontSize: "var(--t-ui)" }}>{busy === "discard" ? "Descartando…" : "Descartar"}</button>
    </>
  );
  // Colmena 3 (design/V3ChatExperto.dc.html): one quiet grey line with what happened and the
  // two ways on — «Continuar» in ink, «Descartar» outlined.
  return (
    <section role="status" aria-label="Se paró" style={{ display: "flex", flexDirection: "column", gap: mine ? "10px" : "6px", padding: "12px 14px 12px 16px", borderRadius: "14px", background: tone.bg === "rgba(18,19,26,.06)" ? "#F1F1EC" : tone.bg, animation: "rise .3s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <span style={{ flex: "1", minWidth: "200px", fontSize: "var(--t-ui)", lineHeight: "1.45", color: "#12131A" }}>
          <strong style={{ fontWeight: 600 }}>{r.title(botName) + "."}</strong>{r.hint ? " " + r.hint : ""}
        </span>
        {mine ? null : buttons}
      </div>
      {mine ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <input className="c-quiet" type="text" value={why} maxLength={WHY_MAX} disabled={busy === "continue" || busy === "discard"} aria-label={`Dile a ${botName} por qué lo has parado (opcional)`} placeholder="Dile por qué lo has parado (opcional)"
            onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent?.isComposing) { e.preventDefault(); void keep(); } }}
            style={{ flex: "1", minWidth: "200px", height: "34px", padding: "0 14px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", fontSize: "var(--t-ui)", fontFamily: "inherit" }} />
          {buttons}
        </div>
      ) : null}
      {mine && kept && kept === said ? <span data-why-kept="" style={{ fontSize: "var(--t-meta)", lineHeight: "1.5", color: "#3D404A" }}>{`${botName} lo leerá en su siguiente turno.`}</span>
        : mine && said ? <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.5", color: "#5C606C" }}>{"Intro lo guarda; «Continuar» y «Descartar» se lo llevan."}</span> : null}
      {detail ? <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.5", color: tone.fg, overflowWrap: "anywhere" }}>{detail}</span> : null}
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "#B4232A", fontWeight: 600 }}>{error}</span> : null}
    </section>
  );
}

export default withRowBoundary(StoppedCard, { label: "No se ha podido mostrar este aviso", resetKey: ({ stopped }) => `${stopped?.reason}:${stopped?.at}` });
