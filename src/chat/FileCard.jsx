// A file in a message as a card: its kind in colour, name and size, a small picture of what is
// inside (read when the card comes into view, for files up to 4 MB) and «Ver» to open it in the
// side panel next to the conversation (?archivo=<id>, Canal.jsx) without downloading it.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Download, Eye, FileCsv, FileDoc, FileMd, FilePdf, FilePpt, FileText, FileXls, Image, X } from "../components/Icon.js";
import { navigate } from "../lib/router.jsx";
import { fileUrl } from "./api.js";
import { KIND_LABEL, PREVIEW_MAX, THUMB_MAX, fileMeta, kindOf, remember } from "./files.js";
import { sizeOf } from "./ui.jsx";
import "./files.css";

const Thumb = lazy(() => import("./FileViewer.jsx").then((m) => ({ default: m.Thumb })));
const FileView = lazy(() => import("./FileViewer.jsx").then((m) => ({ default: m.FileView })));
const ICON = { pdf: FilePdf, docx: FileDoc, xlsx: FileXls, pptx: FilePpt, csv: FileCsv, md: FileMd, text: FileText, image: Image };

/** True once the element has been on screen. */
function useSeen() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** Where «Ver» goes: the conversation with the file beside it (a thread open stays open). */
export function previewHref(channel, id) {
  const q = new URLSearchParams(location.search);
  q.delete("persona"); q.delete("m");
  q.set("archivo", id);
  return "/canal/" + channel + "?" + q.toString();
}

export function FileCard({ f, channel }) {
  remember(f);
  const kind = kindOf(f);
  const Icon = ICON[kind] || FileText;
  const canView = !!f.id && !!kind && kind !== "image" && (f.size || 0) <= PREVIEW_MAX;
  const thumb = canView && (f.size || 0) <= THUMB_MAX && kind !== "text";
  const [ref, seen] = useSeen();
  const href = f.id ? fileUrl(f.id, { download: true }) : f.link || null;
  const open = () => navigate(previewHref(channel, f.id));
  return (
    <div ref={ref} className={"fc is-" + (kind || "other") + (thumb ? " has-thumb" : "")}>
      {thumb ? (
        <button type="button" className="fc-thumb" onClick={open} aria-label={"Ver " + f.name} tabIndex={-1}>
          {seen ? <Suspense fallback={<div className="fv-thumb is-loading" />}><Thumb file={f} /></Suspense> : <div className="fv-thumb is-loading" />}
        </button>
      ) : null}
      <div className="fc-row">
        <span className="fc-icon" aria-hidden="true"><Icon size={20} /></span>
        <span className="fc-main">
          {canView ? <button type="button" className="fc-name" onClick={open} title={"Ver " + f.name}>{f.name}</button> : <span className="fc-name">{f.name}</span>}
          <span className="fc-meta">{f.id ? [KIND_LABEL[kind], sizeOf(f.size)].filter(Boolean).join(" · ") : f.link ? "Enlace del archivo original" : "No se incluyó en la exportación"}</span>
        </span>
        {canView ? <button type="button" className="ch-iconbtn" onClick={open} aria-label={"Ver " + f.name} title="Ver aquí"><Eye size={18} /></button> : null}
        {href ? <a className="ch-iconbtn" href={href} {...(f.id ? { download: f.name } : { target: "_blank", rel: "noopener noreferrer" })} aria-label={(f.id ? "Descargar " : "Abrir ") + f.name} title={f.id ? "Descargar" : "Abrir"}><Download size={18} /></a> : null}
      </div>
    </div>
  );
}

/** The file beside the conversation; Escape or the cross closes it. */
export function FilePanel({ id, onClose }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const panel = useRef(null);
  useEffect(() => {
    let live = true;
    setFile(null); setError(null);
    fileMeta(id).then((f) => live && setFile(f), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, [id]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape" && !e.defaultPrevented && panel.current?.contains(document.activeElement)) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const kind = file ? kindOf(file) : null;
  const Icon = ICON[kind] || FileText;
  return (
    <aside ref={panel} tabIndex={-1} className="th r-overlay fp" aria-label={file ? "Vista de " + file.name : "Vista del archivo"}>
      <div className="th-head">
        <div className="th-title fp-title"><span className={"fc-icon is-" + (kind || "other")} aria-hidden="true"><Icon size={18} /></span><h2 className="fp-name">{file?.name || "Archivo"}</h2>{file?.size ? <span>{sizeOf(file.size)}</span> : null}</div>
        {file ? <a className="ch-iconbtn" href={fileUrl(id, { download: true })} download={file.name} aria-label={"Descargar " + file.name} title="Descargar"><Download size={18} /></a> : null}
        <button type="button" className="ch-iconbtn th-close" onClick={onClose} aria-label="Cerrar la vista"><X size={18} /></button>
      </div>
      <div className="th-body fp-body">
        {error ? <p className="ch-error" role="alert">{error}</p>
          : !file ? <p className="fv-note">Abriendo…</p>
          : !kind || (file.size || 0) > PREVIEW_MAX ? <p className="fv-note">Este archivo no se puede ver aquí. Descárgalo para abrirlo.</p>
          : <Suspense fallback={<p className="fv-note">Preparando la vista…</p>}><FileView file={file} /></Suspense>}
      </div>
    </aside>
  );
}
