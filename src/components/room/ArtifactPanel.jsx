import { Check } from "lucide-react";
import { useState } from "react";
import { useResource } from "../../lib/store.jsx";
import { usePanelWidth } from "../../lib/usePanelWidth.jsx";
import { download } from "../../lib/api.js";
import { KIND_LABEL, copyText, ErrorLine } from "./common.jsx";
import Markdown from "./Markdown.jsx";
import { SlideViewer, isDeck } from "../v2/SlideDeck.jsx";
import { DocViewer, SheetViewer, isWordDoc, isWorkbook } from "../v2/OfficeFiles.jsx";

const CODE_FORMATS = new Set(["py", "js", "jsx", "ts", "tsx", "css", "json", "sql", "sh", "yaml", "yml", "xml", "java", "go", "rb", "php", "c", "cpp", "rs", "txt", "log"]);
const MIME = { csv: "text/csv;charset=utf-8", svg: "image/svg+xml", html: "text/html;charset=utf-8", md: "text/markdown;charset=utf-8", json: "application/json" };

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, ; or , separator). */
export function parseCsv(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!src) return [];
  const firstLine = src.split("\n")[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** CSV rendered with the comparison-table styles of the Chat mockup. */
export function CsvTable({ text }) {
  const rows = parseCsv(text);
  if (!rows.length) return <p style={{ margin: "0", fontSize: "14px", color: "#555A68" }}>{"La tabla está vacía."}</p>;
  const [head, ...body] = rows;
  return (
    <table style={{ width: "100%", minWidth: "360px", borderCollapse: "collapse", fontSize: "14px", lineHeight: "1.4" }}>
      <thead>
        <tr style={{ textAlign: "left" }}>
          {head.map((h, i) => <th key={i} style={{ padding: "10px 8px", borderBottom: "2px solid #12131A", fontWeight: "600" }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {body.map((r, i) => (
          <tr key={i}>
            {head.map((_, j) => (
              <td key={j} style={j === 0 ? { padding: "12px 8px", borderBottom: "1px solid #E6E8EE", fontWeight: "600" } : { padding: "12px 8px", borderBottom: "1px solid #E6E8EE" }}>{r[j] ?? ""}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Deliverables whose content is a file on disk (PNG images, filled PDF copies). */
// Deliverables that are a real file (downloaded as such, never as their text).
export const FILE_FORMATS = new Set(["png", "pdf", "docx", "xlsx", "pptx"]);
export const isFileArtifact = (a) => !!a && FILE_FORMATS.has(String(a.format || "").toLowerCase());
export const artifactFileUrl = (id, download = false) => `/api/artifacts/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}`;
export const artifactPageUrl = (id, page, width = 900) => `/api/artifacts/${encodeURIComponent(id)}/pages/${page}?width=${width}`;

/** Thumbnail of a deliverable for lists (Biblioteca, cards): PNG image, first PDF page, SVG; null otherwise. */
export function ArtifactThumb({ artifact, size = 64, style = {} }) {
  const [failed, setFailed] = useState(false);
  const format = String(artifact?.format || "").toLowerCase();
  const src = !artifact || failed ? null : format === "png" ? artifactFileUrl(artifact.id) : format === "pdf" ? artifactPageUrl(artifact.id, 1, 320) : null;
  if (!src) return null;
  return <img src={src} alt="" aria-hidden="true" loading="lazy" onError={() => setFailed(true)} style={{ display: "block", width: `${size}px`, height: `${size}px`, objectFit: "cover", borderRadius: "8px", border: "1px solid #E6E8EE", background: "#F7F8FA", ...style }} />;
}

/** Field → value table of a filled PDF, with the comparison-table styles of the Chat mockup. */
function FieldsTable({ fields }) {
  if (!fields?.length) return null;
  return (
    <table style={{ width: "100%", minWidth: "320px", borderCollapse: "collapse", fontSize: "14px", lineHeight: "1.4" }}>
      <thead>
        <tr style={{ textAlign: "left" }}>
          <th style={{ padding: "10px 8px", borderBottom: "2px solid #12131A", fontWeight: "600" }}>{"Campo"}</th>
          <th style={{ padding: "10px 8px", borderBottom: "2px solid #12131A", fontWeight: "600" }}>{"Valor"}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f, i) => (
          <tr key={f.name || i}>
            <td style={{ padding: "12px 8px", borderBottom: "1px solid #E6E8EE", fontWeight: "600", overflowWrap: "anywhere" }}>{f.name}</td>
            <td style={{ padding: "12px 8px", borderBottom: "1px solid #E6E8EE", overflowWrap: "anywhere" }}>{String(f.value ?? "")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Page previews of a PDF deliverable (PNG rendered by the local service: nothing of the PDF runs here). */
function PdfPages({ artifact, meta }) {
  const [failed, setFailed] = useState(false);
  const pages = Math.max(1, Math.min(20, meta?.pages || 1));
  return (
    <div data-gallery="" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {failed ? (
        <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#555A68" }}>{"No se puede mostrar la vista previa en este equipo. Descarga el PDF para verlo."}</p>
      ) : (
        Array.from({ length: pages }, (_, i) => (
          <img key={i} data-lightbox="" data-name={`${artifact?.title || "Documento"} · página ${i + 1}`} src={artifactPageUrl(artifact.id, i + 1)} alt={`Página ${i + 1} de ${meta?.pages || pages}`} loading="lazy" onError={() => setFailed(true)}
            style={{ cursor: "zoom-in", display: "block", width: "100%", height: "auto", borderRadius: "12px", border: "1px solid #E6E8EE", background: "#FFFFFF" }} />
        ))
      )}
      {meta?.pages > 20 ? <p style={{ margin: "0", fontSize: "13px", color: "#555A68" }}>{`Se muestran 20 de ${meta.pages} páginas.`}</p> : null}
      <a href={artifactFileUrl(artifact.id, true)} download style={{ alignSelf: "flex-start", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{"Descargar el PDF"}</a>
    </div>
  );
}

export function svgSrc(content) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(content || ""));
}

/** Renders an artifact's content according to its format (safe: no raw HTML/script execution). */
export function ArtifactBody({ artifact, content, meta = null }) {
  const format = (artifact?.format || "").toLowerCase();
  const kind = artifact?.kind;
  if (isDeck(artifact)) return <SlideViewer artifact={artifact} />;
  if (isWordDoc(artifact)) return <DocViewer artifact={artifact} />;
  if (isWorkbook(artifact)) return <SheetViewer artifact={artifact} />;
  if (format === "png" && artifact?.id) {
    return (
      <figure style={{ margin: "0", display: "flex", flexDirection: "column", gap: "10px" }}>
        <img data-lightbox="" data-name={(artifact?.title || "imagen") + ".png"} loading="lazy" decoding="async" src={artifactFileUrl(artifact.id)} alt={artifact?.title || "Imagen"} style={{ cursor: "zoom-in", display: "block", width: "100%", height: "auto", borderRadius: "12px", border: "1px solid #E6E8EE", background: "#F7F8FA" }} />
        {meta?.prompt ? <figcaption style={{ fontSize: "13px", lineHeight: "1.5", color: "#555A68" }}>{`Petición: «${meta.prompt}»`}{meta.width ? ` · ${meta.width}×${meta.height}` : ""}</figcaption> : null}
      </figure>
    );
  }
  if (format === "pdf" && artifact?.id) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {meta?.source?.name ? <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#2B2D36" }}>{`Copia rellena de «${meta.source.name}». El original no se ha modificado.`}</p> : null}
        <FieldsTable fields={meta?.fields} />
        <PdfPages artifact={artifact} meta={meta} />
      </div>
    );
  }
  if (format === "csv" || kind === "table" || kind === "sheet") return <CsvTable text={content} />;
  if (format === "svg") return <img loading="lazy" decoding="async" src={svgSrc(content)} alt={artifact?.title || "Diseño"} style={{ display: "block", width: "100%", height: "auto", borderRadius: "12px", border: "1px solid #E6E8EE", background: "#FFFFFF" }} />;
  if (format === "html" && (kind === "slides" || kind === "design")) {
    return <iframe title={artifact?.title || "Vista previa"} sandbox="" srcDoc={String(content || "")} style={{ width: "100%", height: "520px", border: "1px solid #E6E8EE", borderRadius: "12px", background: "#FFFFFF" }} />;
  }
  if (kind === "code" || CODE_FORMATS.has(format) || format === "html") {
    return <pre style={{ margin: "0", padding: "14px 16px", background: "#1D1F27", color: "#E6E8EE", borderRadius: "12px", font: "400 13px/1.75 'Geist Mono', monospace", overflowX: "auto", whiteSpace: "pre" }}>{content}</pre>;
  }
  return <Markdown text={content} size={15} />;
}

/**
 * Side panel with an open deliverable (Chat mockup «Comparativa abierta»).
 * Either `artifactId` (fetched from /api/artifacts/:id) or `live` ({ title, text, botName }) while a bot still writes.
 */
export default function ArtifactPanel({ artifactId, live, bots = [], onClose, variant = "chat", bare = false }) {
  const { data, error, loading } = useResource(artifactId ? `/artifacts/${artifactId}` : null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const artifact = artifactId ? data : null;
  const fileBased = isFileArtifact(artifact);
  const { data: fileMeta } = useResource(artifactId && fileBased ? `/artifacts/${artifactId}/meta` : null);
  const content = artifact ? artifact.content : live?.text;
  const title = artifact?.title || live?.title || "Entregable";
  const bot = bots.find((b) => b.id === (artifact?.botId || live?.botId));
  const meta = artifact
    ? [KIND_LABEL[artifact.kind] || "Documento", bot ? `hecha por ${bot.name}` : null, artifact.version ? `versión ${artifact.version}` : null].filter(Boolean).join(" · ")
    : [bot ? `${bot.name} lo está escribiendo` : "En curso", "sin guardar todavía"].join(" · ");
  const room = variant === "room";
  const resize = usePanelWidth(room ? "room" : "chat", { min: 340 });

  const copy = async () => {
    await copyText(content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const save = () => {
    const ext = artifact?.format || "md";
    const base = (title || "entregable").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
    download(`${base}.${ext}`, content || "", MIME[ext] || "text/plain;charset=utf-8");
    setSaved(true);
  };

  return (
    <Frame bare={bare} label={`${title} abierto`} style={{ ...(room
      ? { flex: "1 1 360px", minWidth: "0", background: "#FFFFFF", borderLeft: "1px solid #DCE0E8", display: "flex", flexDirection: "column" }
      : { flex: "1 1 420px", minWidth: "0", background: "#FFFFFF", borderLeft: "1px solid #DCE0E8", display: "flex", flexDirection: "column" }), ...resize.style }}>
      {bare ? null : resize.handle}
      <div style={bare ? { display: "flex", flexDirection: "column" } : { position: "sticky", top: "0", maxHeight: "100vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "sticky", top: "0", zIndex: "1", background: "#FFFFFF", minHeight: "64px", padding: "10px 12px 10px 20px", borderBottom: "1px solid #E6E8EE", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" }}>
          <strong style={{ fontSize: "15px", overflowWrap: "anywhere" }}>{title}</strong>
          <span style={{ fontSize: "12px", color: "#555A68" }}>{meta}</span>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {content && !fileBased ? (
            <button type="button" className="rm-focus" onClick={copy} style={{ height: "40px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "13px" }}>{copied ? <span className="c-ok"><Check size={13} strokeWidth={2.6} aria-hidden="true" />Copiado</span> : "Copiar"}</button>
          ) : null}
          {artifact && fileBased ? (
            <a href={artifactFileUrl(artifact.id, true)} download className="rm-focus" onClick={() => setSaved(true)} title="Ya está en la Biblioteca; descarga una copia" style={{ height: "40px", padding: "0 12px", display: "flex", alignItems: "center", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: "600", textDecoration: "none" }}>{saved ? "Guardado" : "Guardar en Biblioteca"}</a>
          ) : artifact && content != null ? (
            <button type="button" className="rm-focus" onClick={save} title="Ya está en la Biblioteca; descarga una copia" style={{ height: "40px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>{saved ? "Guardado" : "Guardar en Biblioteca"}</button>
          ) : null}
          {bare ? null : <button type="button" className="rm-focus" aria-label="Cerrar panel" onClick={onClose} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>}
        </div>
      </div>
      <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: "18px", overflowX: "auto" }}>
        <h2 style={{ margin: "0", font: "700 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{title}</h2>
        {artifactId && loading && !data ? <p style={{ margin: "0", fontSize: "14px", color: "#555A68" }}>{"Abriendo…"}</p> : null}
        {artifactId && error ? <ErrorLine>{`No he podido abrir el entregable: ${error}`}</ErrorLine> : null}
        {content != null && (artifact || live) ? <ArtifactBody artifact={artifact || { format: "md" }} content={content} meta={fileMeta} /> : null}
        {artifact?.room ? <p style={{ margin: "0", fontSize: "13px", lineHeight: "1.5", color: "#555A68" }}>{`Guardado en la Biblioteca · sala #${artifact.room}`}</p> : null}
      </div>
      </div>
    </Frame>
  );
}

/** On its own (an <aside>) or as a tab of the SideDock («bare»). */
function Frame({ bare, label, style, children }) {
  if (bare) return <div aria-label={label} style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "#FFFFFF" }}>{children}</div>;
  return <aside aria-label={label} className="c-panel" style={style}>{children}</aside>;
}
