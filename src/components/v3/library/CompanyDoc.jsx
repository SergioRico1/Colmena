import { useState } from "react";
import { History, Pencil } from "../../Icon.js";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { put } from "../../../lib/api.js";
import Markdown from "../../room/Markdown.jsx";
import DocHistory from "../../v2/team/DocHistory.jsx";

// Biblioteca › Memoria › «Lo que sabe la empresa» (server/company-doc.mjs): COMPANY.md, what
// matters to the whole company so no department or person works in a silo. Everyone in the
// company reads it and writes it (a guest only reads); every bot reads it on each turn. Colmena
// adds, once a day, what the team already shares; every change keeps a version.

const day = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "");
const btn = { display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-sm)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", cursor: "pointer" };
const primary = { ...btn, border: 0, background: "var(--c-btn)", color: "var(--c-btn-text)", fontWeight: 600 };

export default function CompanyDoc() {
  const { cloud } = useStore();
  const doc = useResource("/company-doc");
  const { act, busy, error } = useAction();
  const [draft, setDraft] = useState(null);
  const [history, setHistory] = useState(false);
  const data = doc.data || null;
  const content = data?.content || "";
  const guest = cloud?.me?.role === "guest";
  const limit = data?.limit || 6000;
  const save = () => act(async () => { doc.setData(await put("/company-doc", { content: draft })); setDraft(null); });
  const edited = data?.updatedAt ? [data.updatedBy ? "Lo editó " + data.updatedBy : "Actualizado", day(data.updatedAt)].join(" · ") : null;

  return (
    <section aria-labelledby="company-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <h2 id="company-t" style={{ margin: "0", font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>{"Lo que sabe la empresa"}</h2>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"COMPANY.md · lo leen todas las personas y todos los bots, para que nadie trabaje en un silo"}</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" aria-expanded={history} onClick={() => setHistory((x) => !x)} style={{ ...btn, background: history ? "var(--c-chip)" : "var(--c-card)" }}><History size={14} aria-hidden="true" />{"Historial"}</button>
          {!guest && draft === null ? <button type="button" onClick={() => setDraft(content || data?.template || "")} style={btn}><Pencil size={14} aria-hidden="true" />{content ? "Editar" : "Empezar"}</button> : null}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)" }}>
        {doc.loading && !data ? (
          <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Cargando…"}</p>
        ) : draft !== null ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Texto de COMPANY.md"}</span>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={limit} rows={16} autoFocus spellCheck
                style={{ width: "100%", boxSizing: "border-box", minHeight: "280px", padding: "12px 14px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-md)", background: "var(--c-app)", color: "var(--c-text)", font: "400 var(--t-ui)/1.6 'Geist Mono', monospace", resize: "vertical" }} />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
              <span style={{ flex: "1 1 200px", fontSize: "var(--t-meta)", color: draft.length > limit * 0.95 ? "var(--c-error)" : "var(--c-text-3)" }}>{`${draft.length} / ${limit} · No escribas contraseñas ni datos personales: lo lee toda la empresa.`}</span>
              <button type="button" onClick={() => setDraft(null)} disabled={busy} style={btn}>{"Cancelar"}</button>
              <button type="button" onClick={save} disabled={busy || draft === content} style={primary}>{busy ? "Guardando…" : "Guardar"}</button>
            </div>
          </>
        ) : content ? (
          <Markdown text={content} size={15} />
        ) : (
          <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>
            {guest ? "Todavía no hay nada apuntado." : "Todavía está vacío. Apunta lo que toda la empresa debería saber: qué hacéis, quién lleva qué, clientes y proyectos clave, normas y prioridades. Colmena irá añadiendo lo importante que el equipo ya comparte."}
          </p>
        )}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</p> : null}
        {edited && draft === null ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{edited}</span> : null}
      </div>

      {history ? (
        <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden", animation: "rise .2s ease-out" }}>
          <div style={{ padding: "4px 0 6px" }}><DocHistory doc="company" empty="Todavía no ha cambiado." /></div>
        </div>
      ) : null}
    </section>
  );
}
