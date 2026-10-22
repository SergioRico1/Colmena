import { useState } from "react";
import { AccessPills, BotChips, Card, Notice, PageHeader, btn, field } from "./SettingsShell.jsx";
import { useAction, useStore } from "../../lib/store.jsx";
import { del, patch, post } from "../../lib/api.js";
import { later } from "../../lib/undoToast.js";

/** Ajustes › Este ordenador: folders the bots may open (POST/PATCH/DELETE /api/folders). */
export default function Ordenador() {
  const { folders, bots, error: offline } = useStore();
  const team = bots.filter((b) => b.enabled !== false);
  const { act, busy, error, setError } = useAction();
  const [draft, setDraft] = useState({ path: "", label: "", access: "lee", botIds: [] });

  const update = (f, change) => act(() => patch(`/folders/${encodeURIComponent(f.id)}`, change));
  const toggleIn = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const add = async (event) => {
    event.preventDefault();
    const path = draft.path.trim();
    if (!path) return setError("Escribe la ruta de la carpeta, por ejemplo C:\\Users\\tú\\Documentos.");
    const label = draft.label.trim() || path.split(/[\\/]/).filter(Boolean).pop() || path;
    const ok = await act(() => post("/folders", { path, label, access: draft.access, botIds: draft.botIds }));
    if (ok !== undefined) setDraft({ path: "", label: "", access: "lee", botIds: [] });
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
        <PageHeader title="Este ordenador">Las carpetas que tus bots pueden abrir mientras la app esté abierta. Cada bot solo ve las carpetas que marques aquí.</PageHeader>
        {offline
          ? <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#8F1D22", fontWeight: "600" }}><span style={{ width: "7px", height: "7px", borderRadius: "2px", background: "#E5484D" }} />Sin conexión</span>
          : <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#0B8A5F" }} />En línea</span>}
      </div>
      <Notice>{error}</Notice>

      <Card id="carpetas" title="Carpetas compartidas" aside={<span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{folders.length} {folders.length === 1 ? "carpeta" : "carpetas"}</span>}>
        {folders.length === 0 ? (
          <p style={{ margin: "0", padding: "14px", background: "#F6F6F3", borderRadius: "12px", fontSize: "14px", color: "#5C606C" }}>Aún no has compartido ninguna carpeta. Añade una abajo para que los bots puedan leer o guardar archivos en ella.</p>
        ) : null}
        {folders.map((f, i) => (
          <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: i ? "14px" : "0", borderTop: i ? "1px solid rgba(18,19,26,.06)" : "0" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
              <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "#F4F4F0", borderRadius: "10px" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 6h7l2 2h9v11H3z" /></svg>
              </span>
              <span style={{ flex: "1 1 240px", minWidth: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
                <strong style={{ fontSize: "15px" }}>{f.label || f.path}</strong>
                <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: "#5C606C", overflowWrap: "anywhere" }}>{f.path}</span>
              </span>
              <AccessPills value={f.access || "lee"} label={`Acceso a ${f.label || f.path}`} onChange={(access) => access !== f.access && update(f, { access })} />
              <button type="button" onClick={() => later({ id: "folder:" + f.id, keys: ["folder:" + f.id], text: `Carpeta «${f.label || f.path}» quitada`, error: "No se pudo quitar la carpeta", run: () => act(() => del(`/folders/${encodeURIComponent(f.id)}`)) })} aria-label={`Quitar ${f.label || f.path}`} style={btn.quiet}>Quitar</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "52px" }}>
              <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C606C" }}>Bots con acceso</span>
              <BotChips bots={team} selected={f.botIds || []} label={`Bots con acceso a ${f.label || f.path}`} onToggle={(id) => update(f, { botIds: toggleIn(f.botIds || [], id) })} />
            </div>
          </div>
        ))}
      </Card>

      <form onSubmit={add} aria-labelledby="nueva-carpeta" style={{ background: "#FFFFFF", border: "0", borderRadius: "26px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 id="nueva-carpeta" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Añadir carpeta</h2>
          <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>{window.colmenaWindow?.pickFolder ? "Elígela en tu ordenador o pega su ruta. Los bots no pueden salir de esa carpeta." : "Copia la ruta desde la barra del Explorador de archivos. Los bots no pueden salir de esa carpeta."}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <label style={{ ...field.label, flex: "2 1 300px" }}>
            Ruta
            <span style={{ display: "flex", gap: "8px" }}>
              <input value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} placeholder="C:\Users\tú\Documentos\Contabilidad" spellCheck="false" style={{ ...field.input, ...field.mono, flex: "1", minWidth: "0" }} />
              {window.colmenaWindow?.pickFolder ? (
                <button type="button" onClick={async () => {
                  const chosen = await window.colmenaWindow.pickFolder().catch(() => null);
                  if (!chosen) return;
                  const base = chosen.split(/[\\/]/).filter(Boolean).pop() || "";
                  setDraft((d) => ({ ...d, path: chosen, label: d.label || base }));
                }} style={{ flex: "none", height: "46px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>Elegir carpeta…</button>
              ) : null}
            </span>
          </label>
          <label style={{ ...field.label, flex: "1 1 200px" }}>
            Nombre para el equipo
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Contabilidad" style={field.input} />
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", fontSize: "13px", color: "#5C606C" }}>
          Pueden
          <AccessPills value={draft.access} onChange={(access) => setDraft({ ...draft, access })} label="Acceso de la nueva carpeta" />
          <span>{draft.access === "escribe" ? "leer, crear y cambiar archivos (borrar siempre pide permiso)" : "solo abrir y leer archivos"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C606C" }}>Bots con acceso</span>
          <BotChips bots={team} selected={draft.botIds} label="Bots con acceso a la nueva carpeta" onToggle={(id) => setDraft({ ...draft, botIds: toggleIn(draft.botIds, id) })} />
        </div>
        <button type="submit" disabled={busy} style={{ ...btn.dark, alignSelf: "flex-start", height: "44px", borderRadius: "999px" }}>{busy ? "Añadiendo…" : "Añadir carpeta"}</button>
      </form>
    </>
  );
}
