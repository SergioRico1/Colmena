import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FileLinksContext } from "./fileLinks.jsx";
import { ChevronRight, Columns2, ExternalLink, FilePen, FilePlus2, FileX2, Rows3, X } from "lucide-react";
import { parsePatch, sideBySide } from "../code/model.js";
import DocPages, { VisualNotes, useVisual } from "../../room/DocPages.jsx";
import { CHANGE_WORD, deltaLabel, fileOfLink, fileTypeOf, sizeLabel, turnChanges } from "../../../lib/turnFiles.js";
import { dragOutProps, workFileUrl } from "../../../lib/dragOut.js";
import { plural } from "../../../lib/undo.js";

// «Archivos cambiados» (server/turn-changes.mjs): the turn of a bot that changed files ends with
// this card — each file with what changed (+lines −lines, or its size) — and each one opens
// its before/after: the text diff (Word, Excel and PowerPoint by their text, or as their pages),
// or both versions side by side (pictures, PDFs). The file names the bot writes in its answer
// become links that open the file in the side panel (event «colmena:open-file», the screen
// with the panel opens its tab).

const ICON = { created: FilePlus2, edited: FilePen, deleted: FileX2 };
const MONO = "'Geist Mono', monospace";
const GREEN = "#0B6B4A", RED = "#B4232A";

/** Opens a file of the chat's folder in the side panel of the screen that shows it. */
export function openWorkFile(missionId, file) {
  window.dispatchEvent(new CustomEvent("colmena:open-file", { detail: { missionId, path: file.path, name: file.name || file.path.split("/").pop(), type: fileTypeOf(file.kind, file.path) } }));
}

/** The screen with the side panel: «open this file of chat `missionId`» → `open({path, name, type})`. */
export function useOpenFileRequests(missionId, open) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (!missionId) return undefined;
    const on = (e) => { if (e.detail?.missionId === missionId && e.detail.path) latest.current(e.detail); };
    window.addEventListener("colmena:open-file", on);
    return () => window.removeEventListener("colmena:open-file", on);
  }, [missionId]);
}

/** The files of a turn: {data, error}. */
export function useTurnChanges(missionId, cp) {
  const [state, setState] = useState({ data: null, error: null });
  const key = cp ? cp.id + ":" + (cp.restoredAt || "") : null;
  useEffect(() => {
    if (!missionId || !cp?.id) return undefined;
    let live = true;
    turnChanges(missionId, cp.id, cp.restoredAt || "").then((data) => live && setState({ data, error: null }), (e) => live && setState({ data: null, error: e.message }));
    return () => { live = false; };
  }, [missionId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** Wraps the answer of a turn that changed files: its file names become links. */
export function TurnFileLinks({ missionId, cp, children }) {
  const { data } = useTurnChanges(missionId, cp);
  const [comparing, setComparing] = useState(null);
  const value = useMemo(() => (data?.files?.length ? {
    missionId,
    files: data.files,
    find: (s) => fileOfLink(data.files, s),
    open: (f) => (f.openable ? openWorkFile(missionId, f) : setComparing(f)),
  } : null), [data, missionId]);
  return (
    <FileLinksContext.Provider value={value}>
      {children}
      {comparing ? <CompareDialog missionId={missionId} cpId={cp.id} file={comparing} onClose={() => setComparing(null)} /> : null}
    </FileLinksContext.Provider>
  );
}

/** The card under the answer: the files the turn changed. */
export default function ChangedFiles({ cp, missionId }) {
  const { data, error } = useTurnChanges(missionId, cp);
  const [comparing, setComparing] = useState(null);
  const files = data?.files || [];
  if (error || (data && !files.length)) return null;
  const total = files.length + (data?.more || 0);
  return (
    <section aria-label="Archivos cambiados" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "14px 10px 10px", borderRadius: "20px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 40px -32px rgba(18,19,26,.35)", animation: "fade .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", padding: "0 8px 4px" }}>
        <span style={{ fontSize: "14px", fontWeight: 600, color: "#12131A" }}>{"Archivos cambiados"}</span>
        <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{data ? plural(total, "archivo", "archivos") : "Mirando los cambios…"}</span>
      </div>
      {files.map((f) => {
        const Icon = ICON[f.change] || FilePen;
        const d = deltaLabel(f);
        return (
          <button key={f.scope + "/" + f.path} type="button" className="rm-focus msg-row" onClick={() => setComparing(f)} title={`Ver antes y después de ${f.path}`}
            {...(f.openable ? dragOutProps(workFileUrl(missionId, f.path)) : {})}
            style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", margin: 0, padding: "6px 8px", border: 0, borderRadius: "12px", background: "transparent", cursor: "pointer", textAlign: "left" }}>
            <Icon size={16} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: f.change === "deleted" ? "#8C91A0" : "#4A4F5C" }} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ minWidth: 0, font: `500 13px/1.35 ${MONO}`, color: f.change === "deleted" ? "#6B6F7A" : "#12131A", textDecoration: f.change === "deleted" ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
              <span style={{ flex: "none", fontSize: "12px", color: "#6B6F7A" }}>{[CHANGE_WORD[f.change], f.folder ? `en «${f.folder}»` : null].filter(Boolean).join(" · ")}</span>
            </span>
            <span style={{ flex: "none", font: `500 12.5px/1 ${MONO}`, whiteSpace: "nowrap" }}>
              {d.kind === "lines" ? (
                <>{d.added ? <span style={{ color: GREEN }}>{"+" + d.added}</span> : null}{d.added && d.removed ? " " : ""}{d.removed ? <span style={{ color: RED }}>{"−" + d.removed}</span> : null}{!d.added && !d.removed ? <span style={{ color: "#6B6F7A" }}>{"="}</span> : null}</>
              ) : <span style={{ color: "#6B6F7A" }}>{d.text}</span>}
            </span>
            <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#8C91A0" }} />
          </button>
        );
      })}
      {data?.more ? <span style={{ padding: "2px 8px", fontSize: "13px", color: "#6B6F7A" }}>{`y ${plural(data.more, "archivo más", "archivos más")}`}</span> : null}
      {comparing ? <CompareDialog missionId={missionId} cpId={cp.id} file={comparing} onClose={() => setComparing(null)} /> : null}
    </section>
  );
}

const STYLE = {
  add: { bg: "#EAF7F0", fg: GREEN, sign: "+" },
  del: { bg: "#FBEDEE", fg: RED, sign: "−" },
  ctx: { bg: "transparent", fg: "#3D404A", sign: " " },
};

function Unified({ rows }) {
  return rows.map((row, k) => row.type === "hunk"
    ? (k ? <div key={k} style={{ padding: "4px 12px 4px 64px", font: `400 11.5px/1.5 ${MONO}`, color: "#8C91A0", background: "rgba(18,19,26,.03)" }}>{"línea " + row.start}</div> : null)
    : row.type === "note" ? null : (
      <div key={k} style={{ display: "flex", background: STYLE[row.type].bg, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        <span style={{ flex: "none", width: "48px", paddingRight: "10px", textAlign: "right", color: "#8C91A0", userSelect: "none" }}>{row.b ?? row.a ?? ""}</span>
        <span aria-hidden="true" style={{ flex: "none", width: "16px", color: STYLE[row.type].fg, userSelect: "none" }}>{STYLE[row.type].sign}</span>
        <span style={{ minWidth: 0, color: STYLE[row.type].fg, paddingRight: "14px" }}>{row.text || " "}</span>
      </div>
    ));
}

function Split({ rows }) {
  const pairs = sideBySide(rows);
  const half = (row, side) => {
    if (!row) return <><span style={{ background: "rgba(18,19,26,.025)" }} /><span style={{ background: "rgba(18,19,26,.025)" }} /></>;
    const s = STYLE[row.type];
    const bg = row.type === "ctx" ? "transparent" : s.bg;
    return (
      <>
        <span style={{ paddingRight: "8px", textAlign: "right", color: "#8C91A0", background: bg, userSelect: "none" }}>{(side === "left" ? row.a : row.b) ?? ""}</span>
        <span style={{ minWidth: 0, padding: "0 10px 0 4px", whiteSpace: "pre-wrap", wordBreak: "break-word", color: s.fg, background: bg }}>{row.text || " "}</span>
      </>
    );
  };
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) 44px minmax(0, 1fr)", position: "sticky", top: 0, background: "#F7F8FA", font: `600 11px/2.2 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68", borderBottom: "1px solid #E6E8EE" }}>
        <span /><span>{"Antes"}</span><span /><span>{"Después"}</span>
      </div>
      {pairs.map((p) => p.type === "hunk"
        ? <div key={"h" + p.k} style={{ padding: "4px 12px 4px 56px", font: `400 11.5px/1.5 ${MONO}`, color: "#8C91A0", background: "rgba(18,19,26,.03)" }}>{"línea " + p.start}</div>
        : <div key={"p" + p.k} style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) 44px minmax(0, 1fr)" }}>{half(p.left, "left")}{half(p.right, "right")}</div>)}
    </>
  );
}

/** One side of a visual comparison: the picture, or the pages of a PDF / Office file. */
function VisualSide({ base, file, side }) {
  const exists = !!file[side];
  const q = `?path=${encodeURIComponent(file.path)}&scope=${encodeURIComponent(file.scope || "")}&side=${side}`;
  const isImage = file.kind === "image";
  const visual = useVisual(exists && !isImage ? base + "/visual" + q : null, side);
  const label = side === "before" ? "Antes" : "Después";
  return (
    <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={{ font: `600 11px/1 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{label + (exists ? " · " + sizeLabel(file[side].size) : "")}</span>
      {!exists ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: "180px", padding: "16px", borderRadius: "12px", border: "1px dashed #A9AEBB", fontSize: "14px", color: "#555A68", textAlign: "center" }}>
          {side === "before" ? "No existía antes de esta respuesta." : "Esta respuesta lo borró."}
        </div>
      ) : isImage ? (
        <img src={base + "/blob" + q} alt={`${file.name} ${label.toLowerCase()}`} data-lightbox="" data-name={file.name}
          style={{ maxWidth: "100%", height: "auto", alignSelf: "flex-start", borderRadius: "10px", border: "1px solid #E6E8EE", background: "#FFFFFF", cursor: "zoom-in" }} />
      ) : visual.state === "loading" ? (
        <p role="status" style={{ margin: 0, fontSize: "14px", color: "#555A68" }}>{file.kind === "pdf" ? "Dibujando sus páginas…" : "Preparando la vista con su formato…"}</p>
      ) : visual.state === "ready" ? (
        <>
          <VisualNotes info={visual.info} />
          <DocPages info={visual.info} max={30} pageUrl={(n) => `${base}/page/${n}${q}&width=900&v=${visual.info.version}`} label={/\.pptx?$/i.test(file.path) ? "Diapositiva" : "Página"} />
        </>
      ) : <p style={{ margin: 0, fontSize: "14px", color: "#555A68" }}>{visual.info?.note || "No se puede ver aquí."}</p>}
    </div>
  );
}

/** Before/after of one file of the turn, over everything (Esc closes). */
export function CompareDialog({ missionId, cpId, file, onClose }) {
  const dialog = useRef(null);
  const titleId = useId();
  const base = `/api/missions/${encodeURIComponent(missionId)}/checkpoints/${encodeURIComponent(cpId)}`;
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);
  const [split, setSplitState] = useState(() => { try { return localStorage.getItem("colmena:turn-diff-split") === "1"; } catch { return false; } });
  const setSplit = (v) => { setSplitState(v); try { localStorage.setItem("colmena:turn-diff-split", v ? "1" : "0"); } catch {} };
  const [look, setLook] = useState("text"); // document: text | pages
  useEffect(() => { const el = dialog.current; if (el && !el.open) el.showModal(); }, []);
  useEffect(() => {
    let live = true;
    fetch(`${base}/diff?path=${encodeURIComponent(file.path)}&scope=${encodeURIComponent(file.scope || "")}`)
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw Error(b.error || "No pude compararlo."); return b; })
      .then((d) => live && setDiff(d), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [base, file.path, file.scope]);
  const rows = useMemo(() => (diff?.patch ? parsePatch(diff.patch) : []), [diff?.patch]);
  const textual = diff && (diff.mode === "text" || diff.mode === "document");
  const showPages = diff?.mode === "visual" || (diff?.mode === "document" && diff.visual && look === "pages");
  const d = deltaLabel(file);
  const seg = (on) => ({ display: "inline-flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none", color: on ? "#12131A" : "#4A4F5C" });
  const fileForVisual = { ...file, kind: diff?.mode === "document" ? "office" : file.kind, before: diff?.before ?? (file.before != null ? { size: file.before } : null), after: diff?.after ?? (file.after != null ? { size: file.after } : null) };
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby={titleId} onClick={(e) => { if (e.target === e.currentTarget) dialog.current.close(); }}
      style={{ width: "min(1120px, calc(100vw - 48px))", maxWidth: "none", height: "min(820px, calc(100vh - 48px))", maxHeight: "none", padding: 0, border: 0, borderRadius: "24px", background: "#F7F8FA", boxShadow: "0 40px 80px -30px rgba(18,19,26,.45)", overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "18px 20px 14px", background: "#FFFFFF", borderBottom: "1px solid #E6E8EE" }}>
          <span style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
            <h3 id={titleId} {...(file.openable ? dragOutProps(workFileUrl(missionId, file.path)) : {})} title={file.path} style={{ margin: 0, font: "600 19px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</h3>
            <span style={{ fontSize: "13px", color: "#555A68" }}>
              {[file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : null, file.folder ? `en «${file.folder}»` : null, CHANGE_WORD[file.change], d.text].filter(Boolean).join(" · ")}
            </span>
          </span>
          {diff?.mode === "document" && diff.visual ? (
            <span role="group" aria-label="Cómo compararlo" style={{ display: "inline-flex", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.06)" }}>
              <button type="button" aria-pressed={look === "text" ? "true" : "false"} onClick={() => setLook("text")} style={seg(look === "text")}>{"Texto"}</button>
              <button type="button" aria-pressed={look === "pages" ? "true" : "false"} onClick={() => setLook("pages")} style={seg(look === "pages")}>{"Con formato"}</button>
            </span>
          ) : null}
          {textual && !showPages && rows.length ? (
            <span role="group" aria-label="Vista del cambio" style={{ display: "inline-flex", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.06)" }}>
              <button type="button" aria-pressed={!split ? "true" : "false"} onClick={() => setSplit(false)} style={seg(!split)}><Rows3 size={14} strokeWidth={2.2} aria-hidden="true" />{"Seguido"}</button>
              <button type="button" aria-pressed={split ? "true" : "false"} onClick={() => setSplit(true)} style={seg(split)}><Columns2 size={14} strokeWidth={2.2} aria-hidden="true" />{"Lado a lado"}</button>
            </span>
          ) : null}
          {file.openable ? (
            <button type="button" className="rm-focus" onClick={() => { openWorkFile(missionId, file); dialog.current?.close(); }}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
              <ExternalLink size={14} strokeWidth={2.2} aria-hidden="true" />{"Abrir el archivo"}
            </button>
          ) : null}
          <button type="button" className="rm-focus" onClick={() => dialog.current?.close()} aria-label="Cerrar (Esc)" title="Cerrar (Esc)"
            style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer", color: "#3D404A" }}>
            <X size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px 24px" }}>
          {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4372A" }}>{error}</p> : null}
          {!diff && !error ? <p role="status" style={{ margin: 0, fontSize: "14px", color: "#555A68" }}>{"Comparando…"}</p> : null}
          {showPages ? (
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
              <VisualSide base={base} file={fileForVisual} side="before" />
              <VisualSide base={base} file={fileForVisual} side="after" />
            </div>
          ) : textual ? (
            <>
              {diff.mode === "document" ? <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#555A68" }}>{"Se compara su texto" + (diff.visual ? "; «Con formato» muestra sus páginas antes y después." : ".")}</p> : null}
              {diff.same ? <p style={{ margin: 0, fontSize: "14px", color: "#555A68" }}>{"Su texto no cambió (cambió el formato u otra cosa del archivo)."}</p> : (
                <div style={{ borderRadius: "14px", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.08)", overflow: "hidden", font: `400 12.5px/1.75 ${MONO}` }}>
                  {split ? <Split rows={rows} /> : <Unified rows={rows} />}
                </div>
              )}
              {diff.truncated ? <p style={{ margin: "10px 0 0", fontSize: "12px", color: "#555A68" }}>{"Es muy largo: se comparan sus primeras 20 000 líneas."}</p> : null}
            </>
          ) : diff ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", color: "#3D404A" }}>
              <p style={{ margin: 0 }}>{diff.note}</p>
              <p style={{ margin: 0, font: `500 13px/1.5 ${MONO}` }}>{`Antes: ${diff.before ? sizeLabel(diff.before.size) : "no existía"} · Después: ${diff.after ? sizeLabel(diff.after.size) : "borrado"}`}</p>
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
