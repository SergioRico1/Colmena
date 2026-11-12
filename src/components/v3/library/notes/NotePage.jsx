import { useEffect, useMemo, useState } from "react";
import { Archive, Folder, Globe, Hash } from "lucide-react";
import Markdown from "../../../room/Markdown.jsx";
import RowBoundary from "../../../RowBoundary.jsx";
import { NoteLinkContext } from "../../../wiki/NoteLink.jsx";
import { useAction, useResource } from "../../../../lib/store.jsx";
import { del, post } from "../../../../lib/api.js";
import { navigate } from "../../../../lib/router.jsx";
import { roomUrl } from "../../../../lib/format.js";
import { withMessage } from "../../../../lib/reveal.js";
import { bodyWithoutTitle, noteUrl } from "../../../../lib/wikiLinks.js";
import { whenShort } from "../Files.jsx";
import { Back, CARD, CHIP, DARK, Dialog, ERROR, FIELD, LABEL, MUTED, PILL, QUIET, Who } from "./parts.jsx";
import { createNote } from "./actions.js";
import NoteEditor from "./NoteEditor.jsx";
import NoteHistory from "./NoteHistory.jsx";
import NoteGraph from "./NoteGraph.jsx";

// Biblioteca › Notas, one note (/biblioteca/notas/<slug>): its text with the `[[links]]` as
// links, who last changed it, where it is filed, what names it («Aparece en») and what it
// names. `?ver=editar` writes it, `?ver=historial` shows its versions, `?ver=mapa` its
// surroundings. The address takes the slug, the title or an old name (an alias).

const NOT_FOUND = "Nota no encontrada.";
const icon = { size: 13, strokeWidth: 2, "aria-hidden": true };
const pathOf = (slug) => `/wiki/pages/${encodeURIComponent(slug)}`;
const H3 = { margin: 0, fontSize: "13px", fontWeight: "600", color: "#5C606C" };

export default function NotePage({ slug, view = "", query = {}, bots = [], missions = [], expert = false }) {
  const { data: page, error, loading, setData } = useResource(pathOf(slug));
  const [dialog, setDialog] = useState(null); // 'rename' | 'delete'
  const act = useAction();
  // The address always shows the note's own slug (you may have come by its title or an old name).
  const [from, setFrom] = useState(null);
  useEffect(() => {
    if (!page || page.slug === slug) return;
    if (page.redirectedFrom) setFrom(slug);
    navigate(noteUrl(page.slug, view) + (view === "historial" && query.v ? "&v=" + encodeURIComponent(query.v) : ""), { replace: true, force: true });
  }, [page, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const links = useMemo(() => ({ onMissing: (title) => act.act(() => createNote(title)) }), [act.act]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error === NOT_FOUND && !page) return <Absent name={slug} />;
  if (error && !page) return <><Back /><p role="alert" style={ERROR}>{error}</p></>;
  if (!page) return <><Back /><div aria-busy={loading} style={{ height: "320px", borderRadius: "22px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /></>;
  if (page.slug !== slug && error === NOT_FOUND) return <Absent name={slug} />;

  const run = (fn) => act.act(async () => { const next = await fn(); if (next?.slug) setData(next); return next; });
  const archive = () => run(() => post(`${pathOf(page.slug)}/${page.archived ? "restore" : "archive"}`, {}));
  const trust = () => run(() => post(`${pathOf(page.slug)}/trust`, { revision: page.revision }));

  if (view === "editar") return <NoteEditor key={page.id} page={page} bots={bots} onSaved={setData} />;
  if (view === "historial") return <NoteHistory page={page} bots={bots} version={query.v || null} onRestored={setData} />;
  if (view === "mapa") return <><Back href={noteUrl(page.slug)} label={page.title} /><NoteGraph focus={page.slug} title={page.title} /></>;

  const back = page.backlinks || { pages: [], messages: [], artifacts: [] };
  const missionOf = (id) => missions.find((m) => m.id === id) || null;
  const nBack = back.pages.length + back.messages.length + back.artifacts.length;
  return (
    <NoteLinkContext.Provider value={links}>
      <Back />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
        <article aria-labelledby="note-t" style={{ ...CARD, flex: "999 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: "18px", padding: "28px clamp(20px, 3vw, 34px) 32px" }}>
          <header style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h2 id="note-t" style={{ margin: 0, font: "600 34px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>{page.title}</h2>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", fontSize: "13px", color: "#5C606C" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>{"Último cambio: "}<Who by={page.updatedBy} bots={bots} />{" · " + whenShort(page.updatedAt, true)}</span>
              {page.folder ? <span style={CHIP}><Folder {...icon} />{page.folder}</span> : null}
              {(page.tags || []).map((t) => <span key={t} style={CHIP}><Hash {...icon} />{t}</span>)}
              {page.archived ? <span style={CHIP}><Archive {...icon} />{"Archivada"}</span> : null}
            </span>
            {from ? <p role="status" style={MUTED}>{`Has llegado por «${from}», su nombre de antes. Lo que la nombraba así sigue llegando aquí.`}</p> : null}
          </header>
          {page.external ? (
            <div role="note" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "14px 16px", borderRadius: "16px", background: "#F6F6F3" }}>
              <span style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "5px" }}>
                <span style={{ alignSelf: "flex-start", ...CHIP, background: "#FFFFFF" }}><Globe {...icon} />{"Incluye texto de fuera"}</span>
                <span style={{ fontSize: "13.5px", lineHeight: "1.5", color: "#4A4D57" }}>
                  {page.external.suspicious
                    ? "Parte de esta nota la escribió un bot después de leer un texto de fuera que intentaba darle órdenes. Léela con calma: tus bots la tratan como algo que no has dicho tú."
                    : `Parte de esta nota la escribió un bot después de leer algo de fuera${page.external.label ? ` (${page.external.label})` : " (una web, un correo o una app)"}. Tus bots la tratan como algo que no has dicho tú hasta que la revises.`}
                </span>
              </span>
              <button type="button" disabled={act.busy} onClick={trust} style={PILL}>{"Marcar como revisado"}</button>
            </div>
          ) : null}
          {page.body.trim()
            ? <RowBoundary label="No se ha podido mostrar el texto de esta nota" action={{ href: noteUrl(page.slug, "editar"), text: "Abrirla para editar" }} resetKey={page.revision}><Markdown text={bodyWithoutTitle(page.body, page.title)} size={16} /></RowBoundary>
            : <p style={{ margin: 0, fontSize: "15px", color: "#5C606C" }}>{"Esta nota está vacía. "}<a href={noteUrl(page.slug, "editar")} style={{ color: "#1F4FD1" }}>{"Escribe algo"}</a>{"."}</p>}
          {act.error ? <p role="alert" style={ERROR}>{act.error}</p> : null}
        </article>

        <aside aria-label="Sobre esta nota" style={{ ...CARD, flex: "1 1 280px", minWidth: 0, position: "sticky", top: "24px", display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {page.archived
              ? <button type="button" disabled={act.busy} onClick={archive} style={{ ...DARK, flex: "1", justifyContent: "center" }}>{"Recuperar"}</button>
              : <a href={noteUrl(page.slug, "editar")} style={{ ...DARK, flex: "1", justifyContent: "center" }}>{"Editar"}</a>}
            <a href={noteUrl(page.slug, "historial")} style={PILL}>{page.versions > 1 ? `Historial · ${page.versions}` : "Historial"}</a>
          </div>
          <section aria-labelledby="note-back" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h3 id="note-back" style={H3}>{nBack ? `Aparece en · ${nBack}` : "Aparece en"}</h3>
            {!nBack ? <p style={MUTED}>{"Nada la nombra todavía. Escribe [[" + page.title + "]] en otra nota o en un chat y saldrá aquí."}</p> : null}
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13.5px" }}>
              {back.pages.map((b) => <li key={"p" + b.slug}><a href={noteUrl(b.slug)} style={{ color: "#1F4FD1" }}>{b.title}</a></li>)}
              {back.messages.slice(0, 8).map((m) => {
                const mission = missionOf(m.missionId);
                const who = m.role === "user" ? "Tú" : bots.find((b) => b.id === m.botId)?.name || "Un bot";
                const where = m.missionTitle || mission?.title || "un chat";
                return <li key={"m" + m.id}>{mission ? <a href={withMessage(roomUrl(mission), m.id)} style={{ color: "#1F4FD1" }}>{`${who}, en «${where}»`}</a> : `${who}, en «${where}»`}<span style={{ color: "#5C606C" }}>{" · " + whenShort(m.at)}</span></li>;
              })}
              {back.messages.length > 8 ? <li style={{ color: "#5C606C" }}>{`y ${back.messages.length - 8} mensajes más`}</li> : null}
              {back.artifacts.slice(0, 8).map((a) => <li key={"a" + a.id}><a href={`/biblioteca/archivos?abrir=${encodeURIComponent(a.id)}`} style={{ color: "#1F4FD1" }}>{a.title}</a><span style={{ color: "#5C606C" }}>{" · archivo"}</span></li>)}
            </ul>
          </section>
          <section aria-labelledby="note-out" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h3 id="note-out" style={H3}>{page.links?.length ? `Enlaza con · ${page.links.length}` : "Enlaza con"}</h3>
            {!page.links?.length ? <p style={MUTED}>{"No nombra ninguna otra nota."}</p> : null}
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: "13.5px" }}>
              {(page.links || []).map((l) => (
                <li key={l.slug}>
                  {l.exists
                    ? <a href={noteUrl(l.slug)} style={{ color: "#1F4FD1" }}>{l.title || l.target}{l.archived ? " (archivada)" : ""}</a>
                    : <a href={noteUrl(l.target)} data-note-missing="" title={`«${l.target}» está por crear`} onClick={(e) => { e.preventDefault(); links.onMissing(l.target); }} style={{ color: "#5C606C", textDecoration: "underline dashed", textUnderlineOffset: "3px" }}>{l.target}</a>}
                </li>
              ))}
            </ul>
            {(page.links || []).some((l) => !l.exists) ? <p style={{ ...MUTED, fontSize: "12.5px" }}>{"Las de línea discontinua están por crear: un clic y la escribes."}</p> : null}
          </section>
          {page.aliases?.length ? (
            <section style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <h3 style={H3}>{"También se llama"}</h3>
              <p style={{ ...MUTED, color: "#3D404A" }}>{page.aliases.join(" · ")}</p>
            </section>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px", borderTop: "1px solid rgba(18,19,26,.06)", paddingTop: "12px", marginLeft: "-10px" }}>
            <a href={noteUrl(page.slug, "mapa")} style={QUIET}>{"Ver en el mapa"}</a>
            <button type="button" onClick={() => setDialog("rename")} style={QUIET}>{"Cambiar el nombre"}</button>
            <a href={`/api${pathOf(page.slug)}/export`} download style={QUIET}>{"Exportar (.md)"}</a>
            {!page.archived ? <button type="button" disabled={act.busy} onClick={archive} style={QUIET}>{"Archivar"}</button> : null}
            {page.archived ? <button type="button" onClick={() => setDialog("delete")} style={{ ...QUIET, color: "#B4232A" }}>{"Borrar para siempre"}</button> : null}
          </div>
          {expert ? <span style={{ padding: "10px 12px", borderRadius: "12px", background: "#F6F6F3", font: "500 12px/1.6 'Geist Mono', monospace", color: "#4A4D57", overflowWrap: "anywhere" }}>{[page.slug, `rev ${page.revision} · ${page.size} caracteres`, page.id].map((l) => <span key={l} style={{ display: "block" }}>{l}</span>)}</span> : null}
        </aside>
      </div>
      {dialog === "rename" ? <Rename page={page} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <Delete page={page} onClose={() => setDialog(null)} /> : null}
    </NoteLinkContext.Provider>
  );
}

/** The address names a note that does not exist: say so and offer to create it. */
function Absent({ name }) {
  const act = useAction();
  const missing = useResource("/wiki/missing");
  // A slug in the address («plan-2027») → the name as it was written where it is linked («Plan 2027»).
  const title = missing.data?.missing?.find((m) => m.slug === name)?.title || name;
  return (
    <>
      <Back />
      <div style={{ ...CARD, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px", padding: "28px" }}>
        <h2 style={{ margin: 0, font: "600 26px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em", overflowWrap: "anywhere" }}>{`«${title}» está por crear`}</h2>
        <p style={{ margin: 0, fontSize: "15px", lineHeight: "1.55", color: "#4A4D57" }}>{"Algo nombra esta nota, pero todavía no existe. Puedes crearla ahora y escribirla."}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" disabled={act.busy} onClick={() => act.act(() => createNote(title))} style={DARK}>{"Crear esta nota"}</button>
          <a href="/biblioteca/notas" style={PILL}>{"Ver todas las notas"}</a>
        </div>
        {act.error ? <p role="alert" style={ERROR}>{act.error}</p> : null}
      </div>
    </>
  );
}

function Rename({ page, onClose }) {
  const act = useAction();
  const [title, setTitle] = useState(page.title);
  const clean = title.trim();
  const save = async (e) => {
    e.preventDefault();
    if (!clean || clean === page.title) { onClose(); return; }
    const next = await act.act(() => post(`${pathOf(page.slug)}/rename`, { title: clean, revision: page.revision }));
    if (next?.slug) { onClose(); navigate(noteUrl(next.slug), { replace: true, force: true }); }
  };
  return (
    <Dialog title="Cambiar el nombre" onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={LABEL}>{"Nombre de la nota"}</span>
          <input className="c-quiet" data-autofocus="" type="text" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} style={FIELD} />
        </label>
        <p style={MUTED}>{`El nombre de antes («${page.title}») sigue valiendo: lo que ya la nombra así en otras notas y en los chats seguirá llegando a esta nota.`}</p>
        {act.error ? <p role="alert" style={ERROR}>{act.conflict ? act.error + " Cierra y vuelve a intentarlo." : act.error}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} style={PILL}>{"Cancelar"}</button>
          <button type="submit" disabled={act.busy || !clean} style={DARK}>{"Cambiar el nombre"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function Delete({ page, onClose }) {
  const act = useAction();
  const go = async () => {
    const ok = await act.act(() => del(pathOf(page.slug)));
    if (ok?.ok) { onClose(); navigate("/biblioteca/notas?ver=archivadas", { force: true }); }
  };
  return (
    <Dialog title={`¿Borrar «${page.title}» para siempre?`} onClose={onClose}
      footer={<><button type="button" data-autofocus="" onClick={onClose} style={PILL}>{"No, dejarla archivada"}</button><button type="button" disabled={act.busy} onClick={go} style={{ ...DARK, background: "#B4232A" }}>{"Borrarla para siempre"}</button></>}>
      <p style={{ margin: 0, fontSize: "15px", lineHeight: "1.55", color: "#3D404A" }}>{"Se borra la nota con todo su historial y no se puede recuperar. Lo que la nombraba pasa a «Por crear»."}</p>
      {act.error ? <p role="alert" style={ERROR}>{act.error}</p> : null}
    </Dialog>
  );
}
