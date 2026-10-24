import { useEffect, useState } from "react";
import { Download, File, FileImage, FileSpreadsheet, FileText, Lock, Presentation, RotateCw, X } from "lucide-react";
import { get, post } from "../../../lib/api.js";

// Files shared in a conversation with people (design/V2Personas.dc.html, paso archivo): a
// card in the message and a viewer over the conversation. The viewer only shows plain data
// this Colmena read out of the file (pages drawn here, text, values): nothing in the file runs.
const enc = encodeURIComponent;
export const fileUrl = (id, download = false) => `/api/peers/files/${enc(id)}${download ? "?download=1" : ""}`;
const ICON = { image: FileImage, pdf: FileText, doc: FileText, sheet: FileSpreadsheet, deck: Presentation, text: FileText };
const KIND = { image: "Imagen", pdf: "PDF", doc: "Word", sheet: "Excel", deck: "PowerPoint", text: "Texto" };
const TINT = { pdf: "#FCEBEA", doc: "#E6EEFB", sheet: "#E8F5EE", deck: "#FFF1E0", image: "#F2EEF9", text: "#F2F2EE" };
export const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
const pill = { display: "inline-flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, textDecoration: "none" };

/** The card of a shared file inside its message. */
export function FileCard({ file, onOpen, onChanged }) {
  const Icon = ICON[file.kind] || File;
  const ready = file.status === "ready";
  const retry = async () => { try { onChanged?.(await post(`/peers/files/${enc(file.id)}/retry`)); } catch {} };
  return (
    <div style={{ alignSelf: "flex-start", width: "min(420px, 100%)", display: "flex", flexDirection: "column", gap: "10px", padding: "10px", borderRadius: "22px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 14px 30px -20px rgba(18,19,26,.3)", animation: "rise .3s ease-out" }}>
      {ready && file.kind === "image" ? (
        <button type="button" onClick={() => onOpen(file)} aria-label={"Ver " + file.name} style={{ padding: 0, border: 0, borderRadius: "14px", overflow: "hidden", cursor: "zoom-in", background: "#F2F2EE", lineHeight: 0 }}>
          <img src={fileUrl(file.id)} alt="" style={{ width: "100%", maxHeight: "280px", objectFit: "cover" }} />
        </button>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "2px 4px 0" }}>
        <span aria-hidden="true" style={{ width: "42px", height: "42px", flex: "none", display: "grid", placeItems: "center", borderRadius: "13px", background: TINT[file.kind] || "#F2F2EE", color: "#3D404A" }}><Icon size={20} strokeWidth={1.9} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ fontSize: "15px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.name}>{file.name}</strong>
          <span style={{ fontSize: "12px", color: file.status === "failed" || file.status === "expired" ? "#B4231A" : "#6B6F7A" }}>
            {file.status === "pending" ? "Llegando cifrado…" : file.status === "failed" ? "No llegó entero" : file.status === "expired" ? "Ya no está en el buzón: pídeselo otra vez" : (KIND[file.kind] || "Archivo") + " · " + sizeText(file.size || 0)}
          </span>
        </span>
      </div>
      {ready ? (
        <span style={{ display: "flex", gap: "6px", padding: "0 2px 2px" }}>
          <button type="button" onClick={() => onOpen(file)} style={{ ...pill, background: "#12131A", color: "#FFFFFF" }}>{"Ver"}</button>
          <a href={fileUrl(file.id, true)} download={file.name} style={{ ...pill, background: "rgba(18,19,26,.06)", color: "#12131A" }}><Download size={14} strokeWidth={2.2} aria-hidden="true" />{"Guardar"}</a>
        </span>
      ) : file.status === "failed" ? (
        <button type="button" onClick={retry} style={{ ...pill, alignSelf: "flex-start", background: "rgba(180,35,26,.08)", color: "#B4231A" }}><RotateCw size={13} strokeWidth={2.4} aria-hidden="true" />{"Reintentar"}</button>
      ) : file.status === "pending" ? (
        <span aria-hidden="true" style={{ height: "4px", margin: "0 4px 4px", borderRadius: "999px", background: "linear-gradient(90deg, rgba(18,19,26,.06), rgba(18,19,26,.18), rgba(18,19,26,.06))", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} />
      ) : null}
    </div>
  );
}

/** The viewer: over the conversation, Esc closes it. */
export function FileViewer({ file, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    let alive = true;
    get(`/peers/files/${enc(file.id)}/preview`).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { alive = false; window.removeEventListener("keydown", esc); };
  }, [file.id, onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={"Ver " + file.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", justifyContent: "center", padding: "28px", background: "rgba(18,19,26,.42)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)", animation: "fade .2s ease-out" }}>
      <div style={{ width: "min(1040px, 100%)", height: "100%", display: "flex", flexDirection: "column", borderRadius: "30px", background: "#F5F5F2", overflow: "hidden", boxShadow: "0 40px 90px -30px rgba(18,19,26,.6)", animation: "sheet .4s cubic-bezier(.2,.8,.2,1)" }}>
        <header style={{ flex: "none", display: "flex", alignItems: "center", gap: "12px", padding: "18px 18px 14px 24px" }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
            <strong style={{ font: "600 19px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</strong>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6B6F7A" }}><Lock size={12} strokeWidth={2.2} aria-hidden="true" />{(data?.show === "deck" ? "Vista de texto · el diseño está en el archivo · " : data?.show === "doc" ? "Vista de texto · " : "") + "Llegó cifrado; solo está en vuestros ordenadores"}</span>
          </span>
          <a href={fileUrl(file.id, true)} download={file.name} style={{ ...pill, height: "40px", background: "#12131A", color: "#FFFFFF" }}><Download size={15} strokeWidth={2.2} aria-hidden="true" />{"Guardar"}</a>
          <button type="button" aria-label="Cerrar" onClick={onClose} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer" }}><X size={18} strokeWidth={2.2} aria-hidden="true" /></button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 24px 28px" }}>
          {error ? <p role="alert" style={{ margin: "30px 0", fontSize: "15px", color: "#B4231A" }}>{error}</p> : !data ? <p style={{ margin: "30px 0", fontSize: "15px", color: "#6B6F7A" }}>{"Abriendo…"}</p> : null}
          {data?.show === "image" ? <img src={fileUrl(file.id)} alt={file.name} style={{ display: "block", maxWidth: "100%", margin: "0 auto", borderRadius: "16px" }} /> : null}
          {data?.show === "pdf" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              {data.pages ? Array.from({ length: Math.min(data.pages, 200) }, (_, i) => <img key={i} loading="lazy" src={`/api/peers/files/${enc(file.id)}/pages/${i + 1}?width=1400`} alt={"Página " + (i + 1)} style={{ width: "min(860px, 100%)", borderRadius: "8px", background: "#FFFFFF", boxShadow: "0 10px 30px -18px rgba(18,19,26,.4)" }} />) : <p style={{ fontSize: "15px", color: "#5C606C" }}>{"No se pueden dibujar sus páginas aquí. Guárdalo para abrirlo."}</p>}
            </div>
          ) : null}
          {data?.show === "doc" ? (
            <article style={{ maxWidth: "760px", margin: "0 auto", padding: "40px 48px", borderRadius: "10px", background: "#FFFFFF", boxShadow: "0 10px 30px -18px rgba(18,19,26,.4)", fontSize: "15px", lineHeight: 1.65, color: "#2B2E36", userSelect: "text" }}>
              {data.blocks.map((b, i) => b.t === "h" ? <p key={i} role="heading" aria-level={b.level} style={{ margin: "18px 0 8px", font: `600 ${Math.max(16, 26 - b.level * 3)}px/1.25 'Bricolage Grotesque', sans-serif` }}>{b.text}</p>
                : b.t === "li" ? <p key={i} style={{ margin: "4px 0 4px 18px" }}>{"• " + b.text}</p>
                  : b.t === "table" ? <table key={i} style={{ width: "100%", margin: "12px 0", borderCollapse: "collapse", fontSize: "13px" }}><tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} style={{ padding: "6px 8px", border: "1px solid rgba(18,19,26,.12)" }}>{c}</td>)}</tr>)}</tbody></table>
                    : <p key={i} style={{ margin: "0 0 10px" }}>{b.text}</p>)}
            </article>
          ) : null}
          {data?.show === "sheet" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {data.sheets.length > 1 ? <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>{data.sheets.map((s, i) => <button key={s.name} type="button" role="tab" aria-selected={i === sheet ? "true" : "false"} onClick={() => setSheet(i)} style={{ ...pill, background: i === sheet ? "#12131A" : "rgba(18,19,26,.06)", color: i === sheet ? "#FFFFFF" : "#12131A" }}>{s.name}</button>)}</div> : null}
              {data.sheets[sheet] ? (
                <div style={{ overflow: "auto", borderRadius: "14px", background: "#FFFFFF", boxShadow: "0 10px 30px -18px rgba(18,19,26,.4)" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: "13px", fontVariantNumeric: "tabular-nums" }}>
                    <tbody>{data.sheets[sheet].rows.map((r) => <tr key={r.n}><th style={{ position: "sticky", left: 0, padding: "6px 10px", background: "#F4F4F0", color: "#8C8F99", fontWeight: 500, textAlign: "right", borderBottom: "1px solid rgba(18,19,26,.06)" }}>{r.n}</th>{r.cells.map((c, k) => <td key={k} style={{ padding: "6px 12px", whiteSpace: "nowrap", borderBottom: "1px solid rgba(18,19,26,.06)", borderLeft: "1px solid rgba(18,19,26,.04)" }}>{c}</td>)}</tr>)}</tbody>
                  </table>
                  {data.sheets[sheet].more ? <p style={{ margin: 0, padding: "10px 14px", fontSize: "12px", color: "#6B6F7A" }}>{"Solo las primeras filas. Guárdalo para verlo entero."}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {data?.show === "deck" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "14px" }}>
              {data.slides.map((s, i) => (
                <div key={i} style={{ aspectRatio: "16 / 9", display: "flex", flexDirection: "column", gap: "6px", padding: "18px 20px", borderRadius: "14px", background: "#FFFFFF", boxShadow: "0 10px 30px -18px rgba(18,19,26,.4)", overflow: "hidden" }}>
                  <span style={{ font: "500 11px/1 'Geist Mono', monospace", color: "#8C8F99" }}>{i + 1}</span>
                  <strong style={{ font: "600 17px/1.25 'Bricolage Grotesque', sans-serif" }}>{s.title || "Sin título"}</strong>
                  {s.lines.slice(0, 6).map((l, j) => <span key={j} style={{ fontSize: "13px", lineHeight: 1.45, color: "#3D404A" }}>{l}</span>)}
                </div>
              ))}
            </div>
          ) : null}
          {data?.show === "text" ? <pre style={{ margin: 0, padding: "22px", borderRadius: "14px", background: "#FFFFFF", whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "400 13px/1.6 'Geist Mono', monospace", userSelect: "text" }}>{data.text}</pre> : null}
          {data?.show === "none" ? <p style={{ fontSize: "15px", color: "#5C606C" }}>{"Este archivo no se puede ver aquí. Guárdalo para abrirlo."}</p> : null}
        </div>
      </div>
    </div>
  );
}
