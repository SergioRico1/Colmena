import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown from "../../../room/Markdown.jsx";
import NoteDiff from "../../../wiki/NoteDiff.jsx";
import { useResource } from "../../../../lib/store.jsx";
import { patch } from "../../../../lib/api.js";
import { navigate, setLeaveGuard } from "../../../../lib/router.jsx";
import { byName, completeLink, linkOptions, linkTrigger, noteUrl } from "../../../../lib/wikiLinks.js";
import { whenShort } from "../Files.jsx";
import { Back, CARD, DARK, Dialog, ERROR, FIELD, LABEL, MUTED, PILL, Who, filterChip } from "./parts.jsx";
import { C } from "../../../../lib/theme.js";

// Biblioteca › Notas, writing a note (?ver=editar): a plain Markdown box, `[[` offers the
// titles of the other notes (and a new one), Ctrl+S saves, and nothing is lost on the way out:
// leaving with changes asks first, and a draft left behind (the Back button) comes back.
// Saving sends the revision that was read: if the note changed meanwhile (a bot, another
// window) nothing is written and both texts are shown, to keep one or join them by hand.

const drafts = new Map(); // page id → {body, tags, folder, aliases, revision}: what was being written when the screen went away
const listOf = (text) => String(text || "").split(",").map((s) => s.trim().replace(/^#+/, "")).filter(Boolean);
/**
 * How far down the text box the line after the caret is, in px from the box's top edge (the
 * menu of `[[` opens there). Measured on a hidden copy of the text with the box's own type.
 */
function caretBottom(el) {
  try {
    const cs = getComputedStyle(el);
    const copy = document.createElement("div");
    for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "padding", "border", "boxSizing", "tabSize"]) copy.style[k] = cs[k];
    Object.assign(copy.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", width: el.clientWidth + "px", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
    copy.textContent = el.value.slice(0, el.selectionStart);
    const mark = document.createElement("span");
    mark.textContent = "\u200b";
    copy.appendChild(mark);
    document.body.appendChild(copy);
    const bottom = mark.offsetTop + mark.offsetHeight - el.scrollTop;
    copy.remove();
    return Math.max(0, Math.min(bottom, el.clientHeight)) + 6;
  } catch { return el.clientHeight; }
}
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export default function NoteEditor({ page, bots = [], onSaved }) {
  const kept = useRef(drafts.get(page.id) || null).current;
  const [base, setBase] = useState(() => ({ revision: kept?.revision ?? page.revision, body: kept ? kept.baseBody : page.body }));
  const [body, setBody] = useState(kept?.body ?? page.body);
  const [tags, setTags] = useState(kept?.tags ?? (page.tags || []).join(", "));
  const [folder, setFolder] = useState(kept?.folder ?? (page.folder || ""));
  const [aliases, setAliases] = useState(kept?.aliases ?? (page.aliases || []).join(", "));
  const [recovered, setRecovered] = useState(!!kept);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null); // {current, yours, diff} from the 409
  const [other, setOther] = useState(null); // the other version, shown beside while joining by hand
  const [leaving, setLeaving] = useState(null); // where the person was going when asked
  const [menu, setMenu] = useState(null); // {trigger, options, at}
  const area = useRef(null);
  const caret = useRef(null);
  const titles = useResource("/wiki/pages?limit=200&sort=title");

  const changes = useMemo(() => {
    const c = {};
    if (body !== base.body) c.body = body;
    if (!sameList(listOf(tags), page.tags || [])) c.tags = listOf(tags);
    if (folder.trim() !== (page.folder || "")) c.folder = folder.trim();
    if (!sameList(listOf(aliases), page.aliases || [])) c.aliases = listOf(aliases);
    return c;
  }, [body, tags, folder, aliases, base.body, page]);
  const dirty = Object.keys(changes).length > 0;
  // Somebody saved the note while it is open here: said at once, compared on saving.
  const moved = page.revision > base.revision && !conflict;

  // What is being written survives the screen going away (Back, a reload of the route).
  const live = useRef(null);
  live.current = { dirty, draft: { body, tags, folder, aliases, revision: base.revision, baseBody: base.body } };
  useEffect(() => () => { if (live.current.dirty) drafts.set(page.id, live.current.draft); else drafts.delete(page.id); }, [page.id]);
  useEffect(() => {
    const stop = setLeaveGuard((to) => { if (!live.current.dirty) return true; setLeaving(to); return false; });
    const unload = (e) => { if (live.current.dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { stop(); window.removeEventListener("beforeunload", unload); };
  }, []);

  const done = (next) => { drafts.delete(page.id); live.current.dirty = false; onSaved?.(next); };
  const save = async ({ revision = base.revision, then = null } = {}) => {
    if (busy) return false;
    if (!dirty && revision === base.revision) { if (then) navigate(then, { force: true }); return true; }
    setBusy(true); setError(null);
    try {
      const next = await patch(`/wiki/pages/${encodeURIComponent(page.slug)}`, { revision, ...changes });
      setBase({ revision: next.revision, body: next.body });
      setBody(next.body); setTags((next.tags || []).join(", ")); setFolder(next.folder || ""); setAliases((next.aliases || []).join(", "));
      setConflict(null); setOther(null); setRecovered(false);
      done(next);
      if (then) navigate(then, { force: true });
      return true;
    } catch (e) {
      if (e.status === 409 && e.data?.details?.current) { setConflict(e.data.details); setOther(null); setLeaving(null); }
      else setError(e.message);
      return false;
    } finally { setBusy(false); }
  };
  // The dialog that created the note gives focus back to its button as it closes: the text box takes it after.
  useEffect(() => { const t = setTimeout(() => area.current?.focus(), 60); return () => clearTimeout(t); }, []);
  // Ctrl+S (⌘S) saves from anywhere in the editor.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // The three ways out of a conflict.
  const keepMine = () => save({ revision: conflict.current.revision });
  const takeOther = () => { setBody(conflict.current.body); setBase({ revision: conflict.current.revision, body: conflict.current.body }); setConflict(null); setOther(null); };
  const mergeByHand = () => { setOther(conflict.current); setBase({ revision: conflict.current.revision, body: conflict.current.body }); setConflict(null); setPreview(false); setTimeout(() => area.current?.focus(), 0); };
  const discard = () => { drafts.delete(page.id); live.current.dirty = false; navigate(leaving || noteUrl(page.slug), { force: true }); };

  // The `[[` menu.
  const look = (el) => {
    const trigger = el.selectionStart === el.selectionEnd ? linkTrigger(el.value, el.selectionStart) : null;
    if (!trigger) { setMenu(null); return; }
    const options = linkOptions((titles.data?.pages || []).filter((p) => p.id !== page.id), trigger.query);
    setMenu(options.length ? { trigger, options, at: 0, top: el.offsetTop + caretBottom(el) } : null);
  };
  const choose = (o) => {
    const el = area.current;
    const next = completeLink(body, el.selectionStart, menu.trigger, o.title);
    caret.current = next.caret;
    setBody(next.text);
    setMenu(null);
  };
  useLayoutEffect(() => {
    if (caret.current == null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [body]);
  const onKey = (e) => {
    if (!menu) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setMenu({ ...menu, at: (menu.at + (e.key === "ArrowDown" ? 1 : menu.options.length - 1)) % menu.options.length }); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(menu.options[menu.at]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMenu(null); }
  };

  return (
    <>
      <Back href={noteUrl(page.slug)} label={page.title} />
      <section aria-labelledby="edit-t" style={{ ...CARD, display: "flex", flexDirection: "column", gap: "16px", padding: "24px clamp(18px, 3vw, 30px) 26px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <h2 id="edit-t" style={{ margin: 0, font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em", overflowWrap: "anywhere" }}>{page.title}</h2>
          <div role="group" aria-label="Cómo ver la nota" style={{ display: "flex", gap: "6px" }}>
            <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)} style={{ ...filterChip(!preview), background: !preview ? C.btn : "var(--c-chip)" }}>{"Escribir"}</button>
            <button type="button" aria-pressed={preview} onClick={() => { setPreview(true); setMenu(null); }} style={{ ...filterChip(preview), background: preview ? C.btn : "var(--c-chip)" }}>{"Ver cómo queda"}</button>
          </div>
        </div>
        {recovered ? <p role="status" style={MUTED}>{"Tenías cambios sin guardar en esta nota: los hemos recuperado."}</p> : null}
        {moved ? <p role="status" style={{ ...MUTED, padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--c-hover)", color: "var(--c-text-2)" }}>{`${page.updatedBy?.kind === "bot" ? byName(page.updatedBy) + " ha cambiado esta nota" : "Esta nota se ha cambiado en otra ventana"} mientras la editas (${whenShort(page.updatedAt, true)}). Al guardar podrás comparar los dos textos.`}</p> : null}

        {conflict ? (
          <div role="alertdialog" aria-labelledby="conf-t" aria-describedby="conf-d" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "18px", borderRadius: "var(--r-xl)", background: "var(--c-hover)" }}>
            <h3 id="conf-t" style={{ margin: 0, fontSize: "var(--t-read)", fontWeight: "600" }}>{"La nota ha cambiado mientras la editabas"}</h3>
            <p id="conf-d" style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" }}>
              {conflict.current.updatedBy?.kind === "bot" ? <>{"La cambió "}<Who by={conflict.current.updatedBy} bots={bots} /></> : "Se cambió en otra ventana"}{` (${whenShort(conflict.current.updatedAt, true)}). No se ha guardado nada todavía. Abajo, lo que cambia tu texto respecto al que hay guardado.`}
            </p>
            <NoteDiff diff={conflict.diff} label="Del texto guardado al tuyo" empty="Tu texto y el guardado dicen lo mismo." />
            <details>
              <summary style={{ fontSize: "var(--t-ui)", color: "var(--c-accent-ink)", cursor: "pointer" }}>{"Ver los dos textos enteros"}</summary>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "10px" }}>
                {[["El que hay guardado", conflict.current.body], ["El tuyo", conflict.yours?.body ?? body]].map(([label, text]) => (
                  <div key={label} style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={LABEL}>{label}</span>
                    <pre tabIndex={0} style={{ margin: 0, maxHeight: "260px", overflow: "auto", padding: "12px", borderRadius: "var(--r-md)", background: "var(--c-card)", font: "400 var(--t-meta)/1.6 'Geist Mono', monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</pre>
                  </div>
                ))}
              </div>
            </details>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button type="button" disabled={busy} onClick={mergeByHand} style={DARK}>{"Juntarlos a mano"}</button>
              <button type="button" disabled={busy} onClick={keepMine} style={PILL}>{"Guardar el mío"}</button>
              <button type="button" disabled={busy} onClick={takeOther} style={PILL}>{"Quedarme con el guardado"}</button>
            </div>
            <p style={{ ...MUTED, fontSize: "var(--t-meta)" }}>{"«Guardar el mío» pone tu texto encima del guardado (el otro queda en el historial). «Quedarme con el guardado» descarta lo que has escrito aquí."}</p>
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "stretch" }}>
          <div style={{ flex: "2 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
            {preview ? (
              <div aria-label="Cómo queda la nota" style={{ minHeight: "420px", padding: "16px 18px", borderRadius: "var(--r-lg)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .08)", background: "var(--c-sunken)" }}>
                {body.trim() ? <Markdown text={body} size={16} /> : <p style={MUTED}>{"Todavía no has escrito nada."}</p>}
              </div>
            ) : (
              <>
                <label htmlFor="note-body" style={LABEL}>{"Texto de la nota (Markdown)"}</label>
                <textarea id="note-body" ref={area} className="c-quiet" autoFocus value={body} spellCheck="true"
                  role="combobox" aria-autocomplete="list" aria-expanded={!!menu} aria-controls="note-links" aria-activedescendant={menu ? "note-link-" + menu.at : undefined} aria-describedby="note-help"
                  onChange={(e) => { setBody(e.target.value); look(e.target); }} onKeyDown={onKey} onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) look(e.target); }} onClick={(e) => look(e.target)} onBlur={() => setTimeout(() => setMenu(null), 150)}
                  style={{ minHeight: "420px", resize: "vertical", padding: "14px 16px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-lg)", background: "var(--c-card)", font: "400 var(--t-body)/1.65 'Geist Mono', monospace", color: "var(--c-text)" }} />
                {menu ? (
                  <ul id="note-links" role="listbox" aria-label="Notas para enlazar" style={{ position: "absolute", zIndex: 5, top: menu.top + "px", left: "12px", width: "min(440px, calc(100% - 24px))", margin: 0, padding: "6px", listStyle: "none", display: "flex", flexDirection: "column", borderRadius: "var(--r-lg)", background: "var(--c-card)", boxShadow: "0 0 0 1px rgb(var(--c-ink-rgb) / .08), var(--c-shadow-pop)" }}>
                    {menu.options.map((o, i) => (
                      <li key={o.kind + (o.slug || o.title)} id={"note-link-" + i} role="option" aria-selected={i === menu.at} onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setMenu((m) => (m ? { ...m, at: i } : m))}
                        style={{ display: "flex", alignItems: "baseline", gap: "10px", minHeight: "36px", padding: "6px 10px", borderRadius: "var(--r-sm)", background: i === menu.at ? "var(--c-chip)" : "transparent", fontSize: "var(--t-ui)", cursor: "pointer" }}>
                        <span style={{ flex: "1", minWidth: 0, fontWeight: "500", overflowWrap: "anywhere" }}>{o.kind === "new" ? `Enlazar con una nota nueva: «${o.title}»` : o.title}</span>
                        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{o.kind === "new" ? "queda por crear" : o.alias ? `también «${o.alias}»` : o.folder}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <span id="note-help" style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Escribe [[ para enlazar con otra nota. Ctrl+S guarda."}</span>
              </>
            )}
          </div>
          {other ? (
            <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={LABEL}>{"El otro texto (solo para copiar de él)"}</span>
              <pre tabIndex={0} aria-label="El otro texto de la nota" style={{ flex: "1", margin: 0, maxHeight: "460px", overflow: "auto", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "var(--c-hover)", font: "400 var(--t-meta)/1.65 'Geist Mono', monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{other.body}</pre>
              <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Copia de aquí lo que quieras conservar y guarda: tu texto quedará como la versión nueva."}</span>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <label style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={LABEL}>{"Carpeta"}</span>
            <input className="c-quiet" type="text" value={folder} maxLength={200} onChange={(e) => setFolder(e.target.value)} placeholder="clientes/activos" style={FIELD} />
          </label>
          <label style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={LABEL}>{"Etiquetas, separadas por comas"}</span>
            <input className="c-quiet" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cliente, urgente" style={FIELD} />
          </label>
          <label style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={LABEL}>{"Otros nombres, separados por comas"}</span>
            <input className="c-quiet" type="text" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Acme, Acme España" style={FIELD} />
          </label>
        </div>
        {error ? <p role="alert" style={ERROR}>{error}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <button type="button" disabled={busy || !!conflict || !dirty} onClick={() => save()} style={{ ...DARK, height: "44px", padding: "0 20px", opacity: !dirty || conflict ? ".5" : "1", cursor: dirty && !conflict ? "pointer" : "default" }}>{busy ? "Guardando…" : "Guardar"}</button>
          {dirty
            ? <button type="button" onClick={discard} style={{ ...PILL, height: "44px" }}>{"Salir sin guardar"}</button>
            : <a href={noteUrl(page.slug)} style={{ ...PILL, height: "44px" }}>{"Volver a la nota"}</a>}
          <span aria-live="polite" style={MUTED}>{dirty ? "Hay cambios sin guardar." : "Todo guardado."}</span>
        </div>
      </section>
      {leaving ? (
        <Dialog title="Tienes cambios sin guardar" onClose={() => setLeaving(null)}
          footer={<>
            <button type="button" onClick={() => setLeaving(null)} style={PILL}>{"Seguir editando"}</button>
            <button type="button" onClick={discard} style={PILL}>{"Salir sin guardar"}</button>
            <button type="button" data-autofocus="" disabled={busy} onClick={() => save({ then: leaving })} style={DARK}>{"Guardar y salir"}</button>
          </>}>
          <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: "1.55", color: "var(--c-text-2)" }}>{`Si sales ahora, lo que has escrito en «${page.title}» no se guarda.`}</p>
          {error ? <p role="alert" style={ERROR}>{error}</p> : null}
        </Dialog>
      ) : null}
    </>
  );
}
