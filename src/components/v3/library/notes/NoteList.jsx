import Select from "../../../Select.jsx";
import { useEffect, useState } from "react";
import { Archive, Folder, Globe, Hash } from "lucide-react";
import RowBoundary from "../../../RowBoundary.jsx";
import { plain } from "../../../room/Markdown.jsx";
import { useAction, useResource } from "../../../../lib/store.jsx";
import { noteUrl, plainLinks } from "../../../../lib/wikiLinks.js";
import { whenShort } from "../Files.jsx";
import { CARD, CHIP, ERROR, MUTED, PILL, QUIET, SR, SearchBox, Who, filterChip } from "./parts.jsx";
import { createNote } from "./actions.js";

// Biblioteca › Notas, the list: a search box (ranked, with the words in their sentence),
// folders and tags from their counts, the order, pages of 50, the archived ones, and «Por
// crear»: names that notes and chats link to and are not a note yet (a click creates it).

const PAGE = 50;
const SORTS = [["updated", "Lo último"], ["title", "Por título"], ["created", "Por creación"]];
const VIEWS = [["notas", "Notas"], ["archivadas", "Archivadas"], ["por-crear", "Por crear"], ["mapa", "Mapa"]];
const icon = { size: 13, strokeWidth: 2, "aria-hidden": true };

/** «Notas · 12 | Archivadas · 2 | Por crear · 3 | Mapa»: the views of the section, as links. */
export function NoteViews({ view, counts = null, missing = null }) {
  const n = { notas: counts?.pages, archivadas: counts?.archived, "por-crear": missing };
  return (
    <nav aria-label="Qué ver de las notas" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {VIEWS.map(([id, label]) => (
        <a key={id} href={"/biblioteca/notas" + (id === "notas" ? "" : "?ver=" + id)} aria-current={view === id ? "page" : undefined} style={filterChip(view === id)}>
          {label}{n[id] != null ? " · " + n[id] : ""}
        </a>
      ))}
    </nav>
  );
}

function Row({ p, bots, q }) {
  return (
    <a href={noteUrl(p.slug)} style={{ display: "flex", flexDirection: "column", gap: "5px", minHeight: "56px", padding: "12px 20px", borderTop: "1px solid rgba(18,19,26,.05)", color: "#12131A", textDecoration: "none" }}>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" }}>
        <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: "15px", fontWeight: "600", lineHeight: "1.35", overflowWrap: "anywhere" }}>{p.title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "#5C606C" }}><Who by={p.updatedBy} bots={bots} />{" · " + whenShort(p.updatedAt, true)}</span>
      </span>
      {(q ? p.snippet : p.excerpt) ? <span style={{ fontSize: "13.5px", lineHeight: "1.45", color: "#4A4D57", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{plain(plainLinks(q ? p.snippet : p.excerpt))}</span> : null}
      {p.folder || p.tags?.length || p.external || p.archived ? (
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
          {p.folder ? <span style={CHIP}><Folder {...icon} />{p.folder}</span> : null}
          {(p.tags || []).slice(0, 6).map((t) => <span key={t} style={CHIP}><Hash {...icon} />{t}</span>)}
          {p.external ? <span style={CHIP}><Globe {...icon} />{"Incluye texto de fuera"}</span> : null}
          {p.archived ? <span style={CHIP}><Archive {...icon} />{"Archivada"}</span> : null}
        </span>
      ) : null}
    </a>
  );
}

export default function NoteList({ view = "notas", bots = [], onNew }) {
  const archived = view === "archivadas";
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("updated");
  const [offset, setOffset] = useState(0);
  // The list follows the typing a moment later (one call per pause, not per letter).
  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setOffset(0); }, 220);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => { setOffset(0); }, [folder, tag, sort, view]);
  const params = new URLSearchParams({ archived: archived ? "1" : "0", sort, offset: String(offset), limit: String(PAGE) });
  if (q) params.set("q", q);
  if (folder) params.set("folder", folder);
  if (tag) params.set("tag", tag);
  const { data, error, loading } = useResource("/wiki/pages?" + params.toString());
  const missing = useResource("/wiki/missing");
  const pages = data?.pages || [];
  const total = data?.total || 0;
  const folders = data?.folders || [];
  const tags = data?.tags || [];
  const filtered = !!(q || folder || tag);
  const empty = !loading && data && !pages.length;

  return (
    <>
      <NoteViews view={view} counts={data?.counts} missing={missing.data?.total} />
      {view === "por-crear" ? <Missing data={missing.data} error={missing.error} loading={missing.loading} /> : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <SearchBox value={text} onChange={setText} label="Buscar en las notas" placeholder="Buscar por título o por lo que dicen" />
            <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13.5px", color: "#5C606C" }}>
              {"Orden"}
              <Select label="Orden" className="c-quiet" value={q ? "relevance" : sort} disabled={!!q} onChange={(e) => setSort(e.target.value)} style={{ height: "40px", padding: "0 10px", border: "1px solid rgba(18,19,26,.08)", borderRadius: "12px", background: "#FFFFFF", fontSize: "14px", color: "#12131A" }} options={[...(q ? [["relevance", "Lo que más se parece"]] : []), ...SORTS]} />
            </label>
          </div>
          {folders.length ? (
            <div role="group" aria-label="Carpetas" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
              <span style={{ ...MUTED, marginRight: "4px" }}>{"Carpetas"}</span>
              <button type="button" aria-pressed={!folder} onClick={() => setFolder("")} style={filterChip(!folder)}>{"Todas"}</button>
              {folders.slice(0, 14).map((f) => <button key={f.name} type="button" aria-pressed={folder === f.name} onClick={() => setFolder(folder === f.name ? "" : f.name)} style={filterChip(folder === f.name)}>{f.name + " · " + f.count}</button>)}
            </div>
          ) : null}
          {tags.length ? (
            <div role="group" aria-label="Etiquetas" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
              <span style={{ ...MUTED, marginRight: "4px" }}>{"Etiquetas"}</span>
              {tags.slice(0, 20).map((t) => <button key={t.name} type="button" aria-pressed={tag === t.name} onClick={() => setTag(tag === t.name ? "" : t.name)} style={filterChip(tag === t.name)}>{t.name + " · " + t.count}</button>)}
            </div>
          ) : null}
          {error ? <p role="alert" style={ERROR}>{error}</p> : null}
          {loading && !data ? <div style={{ height: "240px", borderRadius: "22px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
          {empty ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "60px 0", textAlign: "center" }}>
              <p style={{ margin: 0, maxWidth: "520px", fontSize: "16px", lineHeight: "1.5", color: "#5C606C" }}>
                {filtered ? "No hay ninguna nota que coincida. Prueba con otra palabra o quita los filtros."
                  : archived ? "No hay notas archivadas. Lo que archives deja de salir en las listas y en la búsqueda, y lo puedes recuperar aquí."
                    : "Aún no hay notas. Aquí guardáis lo que conviene tener escrito: clientes, proyectos, cómo se hace cada cosa y lo que se ha decidido. Tus bots las leen, y te preguntan antes de cambiarlas."}
              </p>
              {!filtered && !archived && onNew ? <button type="button" onClick={onNew} style={{ ...PILL, height: "44px", padding: "0 18px", border: "0", background: "#12131A", color: "#FFFFFF", fontWeight: "600" }}>{"Escribir la primera nota"}</button> : null}
            </div>
          ) : null}
          {pages.length ? (
            <div style={{ ...CARD, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <h2 style={{ margin: "0", padding: "14px 20px 8px", fontSize: "13px", fontWeight: "600", color: "#5C606C" }} aria-live="polite">
                {q ? (total === 1 ? "1 nota coincide" : `${total} notas coinciden`) : archived ? "Archivadas" : folder || tag ? [folder, tag ? "#" + tag : null].filter(Boolean).join(" · ") : "Todas las notas"}
              </h2>
              {pages.map((p) => <RowBoundary key={p.id} label="No se ha podido mostrar esta nota" action={{ href: noteUrl(p.slug), text: "Abrirla" }} resetKey={p.revision}><Row p={p} bots={bots} q={q} /></RowBoundary>)}
            </div>
          ) : null}
          {total > PAGE ? (
            <nav aria-label="Páginas de la lista" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={MUTED}>{`${offset + 1}–${Math.min(offset + PAGE, total)} de ${total}`}</span>
              <span style={{ display: "flex", gap: "8px" }}>
                <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} style={{ ...PILL, opacity: offset === 0 ? ".45" : "1", cursor: offset === 0 ? "default" : "pointer" }}>{"Anteriores"}</button>
                <button type="button" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} style={{ ...PILL, opacity: offset + PAGE >= total ? ".45" : "1", cursor: offset + PAGE >= total ? "default" : "pointer" }}>{"Siguientes"}</button>
              </span>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

/** «Por crear»: names something links to that are not a note yet. A click creates the note. */
function Missing({ data, error, loading }) {
  const act = useAction();
  const list = data?.missing || [];
  const create = (m) => act.act(() => createNote(m.title));
  if (error) return <p role="alert" style={ERROR}>{error}</p>;
  if (loading && !data) return <div style={{ height: "160px", borderRadius: "22px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} />;
  if (!list.length) return <p style={{ margin: 0, padding: "60px 0", textAlign: "center", fontSize: "16px", color: "#5C606C" }}>{"No hay nada por crear. Cuando una nota o un chat nombre con [[corchetes]] una nota que aún no existe, saldrá aquí."}</p>;
  return (
    <div style={{ ...CARD, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <h2 style={{ margin: "0", padding: "14px 20px 8px", fontSize: "13px", fontWeight: "600", color: "#5C606C" }}>{"Notas que se nombran y aún no existen"}</h2>
      {act.error ? <p role="alert" style={{ ...ERROR, padding: "0 20px 8px" }}>{act.error}</p> : null}
      {list.map((m) => (
        <div key={m.slug} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", minHeight: "56px", padding: "8px 20px", borderTop: "1px solid rgba(18,19,26,.05)" }}>
          <span style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ fontSize: "15px", fontWeight: "600", overflowWrap: "anywhere" }}>{m.title}</span>
            <span style={{ fontSize: "12.5px", color: "#5C606C" }}>
              {m.from?.length ? <>{"La nombra "}{m.from.slice(0, 3).map((f, i) => <span key={f.slug}>{i ? ", " : ""}<a href={noteUrl(f.slug)} style={{ color: "#1F4FD1" }}>{f.title}</a></span>)}{m.from.length > 3 ? ` y ${m.from.length - 3} más` : ""}</> : null}
              {m.mentions ? (m.from?.length ? " · " : "") + (m.mentions === 1 ? "Sale en 1 mensaje o archivo" : `Sale en ${m.mentions} mensajes o archivos`) : null}
            </span>
          </span>
          <button type="button" disabled={act.busy} onClick={() => create(m)} style={QUIET}><span style={SR}>{`«${m.title}»: `}</span>{"Crear la nota"}</button>
        </div>
      ))}
    </div>
  );
}
