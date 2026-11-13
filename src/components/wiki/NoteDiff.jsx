import { useMemo, useState } from "react";
import { diffModel, diffSummary, noteAskTitle, noteUrl } from "../../lib/wikiLinks.js";
import { useResource } from "../../lib/store.jsx";

// The changes of a note as lines: what is new in green with «+», what goes in red with «−»
// (the sign says it too, not only the colour). Used by the conflict view, the history and
// the approval cards of a bot's note write (approval.wiki).

const MONO = "'Geist Mono', monospace";
const TONE = { add: ["#E3F4EC", "#0B6B4A", "+"], del: ["#FBE9EA", "#B4232A", "−"], ctx: ["transparent", "#3D404A", " "] };
const WORD = { add: "Línea nueva", del: "Línea quitada" };

/** `diff` is `{patch, added, removed, truncated}` (or the patch alone). `max` rows before «Ver todo». */
export default function NoteDiff({ diff, max = 400, label = "Cambios en la nota", empty = "Los dos textos son iguales.", style = null }) {
  const model = useMemo(() => diffModel(diff), [diff]);
  const [all, setAll] = useState(false);
  if (model.same) return <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)", ...style }}>{empty}</p>;
  const rows = all ? model.rows : model.rows.slice(0, max);
  return (
    <div role="group" aria-label={`${label}: ${diffSummary(model)}`} style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, ...style }}>
      <div tabIndex={0} aria-label={label} style={{ maxHeight: "360px", overflow: "auto", borderRadius: "var(--r-md)", background: "var(--c-sunken)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .06)", font: `400 var(--t-meta)/1.6 ${MONO}` }}>
        {rows.map((r, i) => {
          if (r.type === "gap") return <div key={i} aria-hidden="true" style={{ padding: "2px 12px", color: "#8A8D97" }}>{"⋯"}</div>;
          const [bg, ink, sign] = TONE[r.type];
          return (
            <div key={i} style={{ display: "flex", gap: "8px", padding: "0 12px", background: bg, color: ink }}>
              <span aria-hidden="true" style={{ flex: "none", width: "10px", userSelect: "none" }}>{sign}</span>
              {WORD[r.type] ? <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{WORD[r.type] + ": "}</span> : null}
              <span style={{ flex: "1", minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.text || " "}</span>
            </div>
          );
        })}
      </div>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
        {diffSummary(model)}
        {model.truncated ? <span>{"· Es un cambio largo: aquí solo se ve una parte."}</span> : null}
        {!all && model.rows.length > max ? <button type="button" onClick={() => setAll(true)} style={{ height: "28px", padding: "0 8px", border: "0", background: "transparent", color: "var(--c-accent-ink)", fontSize: "var(--t-meta)", cursor: "pointer" }}>{"Ver todo"}</button> : null}
      </span>
    </div>
  );
}

const shine = { background: "linear-gradient(90deg,#ECECE7 0%,#F6F6F3 40%,#ECECE7 80%)", backgroundSize: "300% 100%", animation: "shimmer 1.6s ease-in-out infinite" };
/** The diff while it loads: grey lines with the soft shimmer of every «Cargando» (Skeleton.jsx). */
function DiffLoading() {
  return (
    <div role="status" aria-label="Cargando los cambios de la nota" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px", borderRadius: "var(--r-md)", background: "var(--c-sunken)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .06)" }}>
      {["72%", "58%", "80%"].map((width, i) => <span key={i} aria-hidden="true" style={{ height: "10px", width, borderRadius: "var(--r-pill)", ...(i ? { background: "var(--c-chip)" } : shine) }} />)}
    </div>
  );
}

/**
 * A bot's note write waiting for the person's OK (`approval.wiki`): which note, what it would
 * do, and the diff. `compact` folds the diff behind «Ver los cambios» (rows above the composer).
 * The state carries only the summary (title, counts, the outside mark): the diff itself is
 * asked for with the approval's `id` when it is shown (GET /api/approvals/:id/wiki).
 */
export function NoteAsk({ id = null, wiki, compact = false, style = null }) {
  const [open, setOpen] = useState(!compact);
  const inline = typeof wiki?.patch === "string";
  const loaded = useResource(open && wiki && !inline && id ? `/approvals/${encodeURIComponent(id)}/wiki` : null);
  if (!wiki) return null;
  const diff = inline ? wiki : loaded.data ? { ...wiki, ...loaded.data } : null;
  const creates = wiki.create || wiki.action === "create";
  return (
    <div data-note-ask="" style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, ...style }}>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>
        <span>{noteAskTitle(wiki)}</span>
        {!creates && wiki.slug ? <a href={noteUrl(wiki.slug)} style={{ color: "var(--c-accent-ink)", fontSize: "var(--t-ui)" }}>{"Ver la nota"}</a> : null}
        {compact ? <button type="button" className="rm-focus" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ height: "28px", padding: "0 8px", border: "0", borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-accent-ink)", fontSize: "var(--t-ui)", cursor: "pointer" }}>{open ? "Ocultar los cambios" : `Ver los cambios (${diffSummary(wiki).toLowerCase()})`}</button> : null}
      </span>
      {wiki.outside ? <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.45", color: "var(--c-error)" }}>{wiki.outside.suspicious ? "Lo escribe después de leer un texto de fuera que intentaba darle órdenes. Léelo con calma antes de aprobar." : "Incluye texto copiado de fuera (una web, un correo o una app). La nota quedará marcada hasta que la revises."}</span> : null}
      {!open ? null : diff
        ? <NoteDiff diff={diff} max={compact ? 80 : 200} label={creates ? "Texto de la nota nueva" : "Cambios en la nota"} empty="No cambia el texto de la nota." />
        : loaded.error
          ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{"No se pudieron cargar los cambios. " + loaded.error}</p>
          : <DiffLoading />}
    </div>
  );
}
