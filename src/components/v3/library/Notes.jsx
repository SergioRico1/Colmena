import { useState } from "react";
import { useAction, useResource } from "../../../lib/store.jsx";
import NoteList, { NoteViews } from "./notes/NoteList.jsx";
import NotePage from "./notes/NotePage.jsx";
import NoteGraph from "./notes/NoteGraph.jsx";
import NoteImport from "./notes/NoteImport.jsx";
import { DARK, Dialog, ERROR, FIELD, LABEL, MUTED, PILL } from "./notes/parts.jsx";
import { createNote } from "./notes/actions.js";

// Biblioteca › Notas (docs/CONTRACT.md §16): the pages the person and the bots share —
// clients, projects, how things are done, what was decided. /biblioteca/notas is the list
// (?ver=archivadas, ?ver=por-crear, ?ver=mapa); /biblioteca/notas/<slug> one note
// (?ver=editar, ?ver=historial, ?ver=mapa). Every list and page is asked again when the
// server says the notes changed (useResource follows /api/events), so what a bot writes
// shows up while you look.

const LIST_VIEWS = new Set(["archivadas", "por-crear", "mapa"]);

/** The buttons of the section, in Biblioteca's header. */
export function NotesActions({ onNew, onImport }) {
  const white = { ...PILL, height: "44px", padding: "0 18px", fontSize: "var(--t-body)", fontWeight: "500", border: "1px solid rgb(var(--c-ink-rgb) / .16)" };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <a href="/api/wiki/export" download title="Descarga todas las notas en un .zip, cada una en su carpeta" style={white}>{"Exportar"}</a>
      <button type="button" onClick={onImport} style={white}>{"Importar notas"}</button>
      <button type="button" onClick={onNew} style={{ ...white, border: "0", background: "var(--c-btn)", color: "var(--c-btn-text)", fontWeight: "600" }}>{"Nueva nota"}</button>
    </div>
  );
}

export default function Notes({ slug = null, query = {}, bots = [], missions = [], expert = false, dialog = null, onDialog }) {
  const view = slug ? "" : LIST_VIEWS.has(query.ver) ? query.ver : "notas";
  return (
    <>
      {slug
        ? <NotePage slug={slug} view={query.ver || ""} query={query} bots={bots} missions={missions} expert={expert} />
        : view === "mapa"
          ? <><MapViews /><NoteGraph /></>
          : <NoteList view={view} bots={bots} onNew={() => onDialog?.("new")} />}
      {dialog === "new" ? <NewNote onClose={() => onDialog?.(null)} /> : null}
      {dialog === "import" ? <NoteImport onClose={() => onDialog?.(null)} /> : null}
    </>
  );
}

/** The views row above the map, with the same counts the list shows. */
function MapViews() {
  const pages = useResource("/wiki/pages?limit=1");
  const missing = useResource("/wiki/missing");
  return <NoteViews view="mapa" counts={pages.data?.counts} missing={missing.data?.total} />;
}

/** «Nueva nota»: its name, and straight to writing it. */
function NewNote({ onClose }) {
  const act = useAction();
  const [title, setTitle] = useState("");
  const clean = title.trim();
  const create = async (e) => {
    e.preventDefault();
    if (!clean) return;
    const done = await act.act(async () => { await createNote(clean); return true; });
    if (done) onClose();
  };
  return (
    <Dialog title="Nueva nota" onClose={onClose}>
      <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={LABEL}>{"Cómo se llama"}</span>
          <input className="c-quiet" data-autofocus="" type="text" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Acme S.L., Cómo facturamos, Plan 2027…" style={FIELD} />
        </label>
        <p style={MUTED}>{"El nombre es como la nombras en otras notas y en los chats: [[Acme S.L.]]. Si ya hay una con ese nombre, se abre esa."}</p>
        {act.error ? <p role="alert" style={ERROR}>{act.error}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} style={PILL}>{"Cancelar"}</button>
          <button type="submit" disabled={act.busy || !clean} style={{ ...DARK, opacity: clean ? "1" : ".5" }}>{"Crear y escribir"}</button>
        </div>
      </form>
    </Dialog>
  );
}
