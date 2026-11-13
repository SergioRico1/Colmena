import { useMemo, useRef, useState } from "react";
import { post } from "../../../../lib/api.js";
import { useStore } from "../../../../lib/store.jsx";
import { importModel } from "../../../../lib/wikiLinks.js";
import { DARK, Dialog, ERROR, LABEL, MUTED, PILL } from "./parts.jsx";
import { sourceOfFolder, sourceOfZip } from "./actions.js";

// «Importar notas» (POST /api/wiki/import): a folder or a .zip of Markdown files, the way
// Obsidian keeps them. Always two steps: first what it would do (nothing is written), then
// «Traer» with the plan that was shown. If the notes changed in between, the server answers
// with the new plan and it is shown again before anything is written.

const SHOWN = 60;

export default function NoteImport({ onClose }) {
  const { run } = useStore();
  const [source, setSource] = useState(null);
  const [left, setLeft] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(false);
  const folderInput = useRef(null);
  const zipInput = useRef(null);
  const model = useMemo(() => (plan ? importModel(left?.attachments ? { ...plan, counts: { ...plan.counts, attachments: (plan.counts?.attachments || 0) + left.attachments } } : plan) : null), [plan, left]);

  const preview = async (make) => {
    setBusy(true); setError(null); setPlan(null); setChanged(false);
    try {
      const picked = await make();
      setSource(picked.source); setLeft(picked.left);
      setPlan(await post("/wiki/import", { source: picked.source }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setError(null);
    try {
      setPlan(await run(() => post("/wiki/import", { source, apply: true, planId: plan.planId })));
      setChanged(false);
    } catch (e) {
      // Something changed since the preview: here is the new one; nothing was written.
      if (e.status === 409 && e.data?.details?.planId) { setPlan(e.data.details); setChanged(true); }
      else setError(e.message);
    } finally { setBusy(false); }
  };
  const again = () => { setPlan(null); setSource(null); setLeft(null); setError(null); setChanged(false); };

  return (
    <Dialog title="Importar notas" onClose={busy ? null : onClose} width="640px"
      footer={model?.applied
        ? <button type="button" data-autofocus="" onClick={onClose} style={DARK}>{"Hecho"}</button>
        : model
          ? <><button type="button" disabled={busy} onClick={again} style={PILL}>{"Elegir otra cosa"}</button><button type="button" disabled={busy} onClick={onClose} style={PILL}>{"Cancelar"}</button><button type="button" data-autofocus="" disabled={busy || !model.canApply} onClick={apply} style={{ ...DARK, opacity: model.canApply ? "1" : ".5" }}>{busy ? "Trayendo…" : model.changes === 1 ? "Traer 1 nota" : `Traer ${model.changes} notas`}</button></>
          : <button type="button" disabled={busy} onClick={onClose} style={PILL}>{"Cancelar"}</button>}>
      {!model ? (
        <>
          <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: "1.55", color: "var(--c-text-2)" }}>{"Trae tus notas en Markdown (por ejemplo, las de Obsidian). Se conservan los [[enlaces]], las carpetas, las etiquetas y los otros nombres. Antes de traer nada verás qué se va a crear y qué va a cambiar."}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" data-autofocus="" disabled={busy} onClick={() => folderInput.current?.click()} style={DARK}>{"Elegir una carpeta"}</button>
            <button type="button" disabled={busy} onClick={() => zipInput.current?.click()} style={PILL}>{"Elegir un .zip"}</button>
          </div>
          <input ref={folderInput} type="file" multiple webkitdirectory="" directory="" hidden tabIndex={-1} aria-hidden="true" onChange={(e) => { const files = [...e.target.files]; e.target.value = ""; if (files.length) preview(() => sourceOfFolder(files)); }} />
          <input ref={zipInput} type="file" accept=".zip,application/zip" hidden tabIndex={-1} aria-hidden="true" onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; if (file) preview(() => sourceOfZip(file)); }} />
          {busy ? <p role="status" style={MUTED}>{"Mirando qué hay…"}</p> : null}
          <p style={{ ...MUTED, fontSize: "var(--t-meta)" }}>{"Solo se traen archivos .md. Las imágenes y los demás archivos se quedan donde están."}</p>
        </>
      ) : (
        <>
          {changed ? <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--c-hover)", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{"Algo ha cambiado desde que lo revisaste (en la carpeta o en tus notas). No se ha traído nada: revisa de nuevo lo que se haría ahora."}</p> : null}
          <p role="status" style={{ margin: 0, fontSize: "var(--t-read)", fontWeight: "600" }}>{model.applied ? "Hecho: " + model.headline : model.headline}</p>
          {!model.applied && !model.canApply ? <p style={MUTED}>{"No hay nada nuevo que traer."}</p> : null}
          <div tabIndex={0} aria-label="Lo que se trae" style={{ maxHeight: "44vh", overflow: "auto", display: "flex", flexDirection: "column", gap: "14px", padding: "2px" }}>
            {model.groups.map((g) => (
              <section key={g.id} aria-label={g.title} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <h3 style={{ ...LABEL, margin: 0 }}>{`${g.title} · ${g.count}`}</h3>
                {g.hint ? <p style={{ ...MUTED, fontSize: "var(--t-meta)" }}>{g.hint}</p> : null}
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", fontSize: "var(--t-ui)" }}>
                  {g.rows.slice(0, SHOWN).map((r) => (
                    <li key={r.kind + r.path} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", padding: "5px 0", borderTop: "1px solid rgb(var(--c-ink-rgb) / .05)" }}>
                      <span style={{ fontWeight: "500", overflowWrap: "anywhere" }}>{r.title}</span>
                      {r.folder ? <span style={{ color: "var(--c-text-3)" }}>{r.folder}</span> : null}
                      {r.note ? <span style={{ flexBasis: "100%", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{r.note}</span> : null}
                    </li>
                  ))}
                  {g.rows.length > SHOWN || g.count > g.rows.length ? <li style={{ padding: "5px 0", color: "var(--c-text-3)" }}>{`y ${Math.max(g.count, g.rows.length) - Math.min(SHOWN, g.rows.length)} más`}</li> : null}
                </ul>
              </section>
            ))}
            {left?.big?.length ? <p style={MUTED}>{`${left.big.length === 1 ? "1 nota pesa" : left.big.length + " notas pesan"} más de 1 MB y no se ${left.big.length === 1 ? "trae" : "traen"}: ${left.big.slice(0, 4).join(", ")}${left.big.length > 4 ? "…" : ""}`}</p> : null}
          </div>
          {model.notes.length ? <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "3px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{model.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
        </>
      )}
      {error ? <p role="alert" style={ERROR}>{error}</p> : null}
    </Dialog>
  );
}
