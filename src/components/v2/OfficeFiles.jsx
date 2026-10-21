import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Sigma } from "lucide-react";
import { get } from "../../lib/api.js";

// Word documents (create_document) and Excel workbooks (create_spreadsheet) the bots made:
// a card in the chat and the full view in the side panel and the Biblioteca.

const enc = encodeURIComponent;
export const isWordDoc = (a) => String(a?.format || "").toLowerCase() === "docx" && !!a?.paged;
export const isWorkbook = (a) => String(a?.format || "").toLowerCase() === "xlsx" && Array.isArray(a?.sheets) && a.sheets.length > 0;
const fileUrl = (id) => `/api/artifacts/${enc(id)}/file?download=1`;
const pdfUrl = (id) => `/api/artifacts/${enc(id)}/pdf?download=1`;
const pageUrl = (id, n) => `/api/artifacts/${enc(id)}/thumbs/${n}`;
const docPageUrl = (id) => `/api/artifacts/${enc(id)}/document`;
const chartUrl = (id, n) => `/api/artifacts/${enc(id)}/charts/${n}`;

const pill = { display: "inline-flex", alignItems: "center", gap: "7px", height: "40px", padding: "0 16px", borderRadius: "999px", fontSize: "14px", fontWeight: "600", textDecoration: "none", cursor: "pointer", border: 0 };
const dark = { ...pill, background: "#12131A", color: "#FFFFFF" };
const soft = { ...pill, background: "rgba(18,19,26,.06)", color: "#12131A" };
const kicker = { font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" };
const cardTitle = { font: "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", overflowWrap: "anywhere" };
const card = { display: "flex", flexDirection: "column", gap: "16px", padding: "14px 14px 20px", background: "#FFFFFF", borderRadius: "28px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 50px -28px rgba(18,19,26,.3)", animation: "rise .5s ease-out" };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Word ----------

/** The top of page 1: its picture, or the page itself scaled down until there is one. */
function PagePeek({ artifact, height = 220 }) {
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  const picture = Number(artifact?.thumbs) > 0;
  useEffect(() => {
    if (picture || !box.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [picture]);
  return (
    <div ref={box} style={{ position: "relative", height: height + "px", overflow: "hidden", borderRadius: "18px", background: "#EDEBE5", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.06)" }}>
      <div style={{ position: "absolute", left: "8%", right: "8%", top: "18px", bottom: 0, background: "#FFFFFF", borderRadius: "6px 6px 0 0", overflow: "hidden", boxShadow: "0 8px 30px -12px rgba(18,19,26,.35)" }}>
        {picture ? (
          <img src={pageUrl(artifact.id, 1)} alt="Primera página" decoding="async" style={{ display: "block", width: "100%", height: "auto" }} />
        ) : width ? (
          <iframe title="Primera página" src={docPageUrl(artifact.id)} sandbox="" tabIndex={-1} loading="lazy"
            style={{ position: "absolute", left: 0, top: "-24px", width: "794px", height: "1400px", border: 0, transformOrigin: "0 0", transform: `scale(${(width * 0.84) / 794})`, pointerEvents: "none" }} />
        ) : null}
      </div>
    </div>
  );
}

/** In the chat: the top of the first page, what it is, «Abrir», Word and PDF. */
export function DocCard({ artifact, onOpen }) {
  const pages = Number(artifact?.pages) || 0;
  return (
    <article style={card}>
      <button type="button" onClick={onOpen} aria-label={`Abrir «${artifact?.title || "documento"}»`} style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer", borderRadius: "18px", textAlign: "left" }}>
        <PagePeek artifact={artifact} />
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 10px" }}>
        <span style={kicker}>{pages ? `Documento · ${plural(pages, "página", "páginas")}` : "Documento de Word"}</span>
        <strong style={cardTitle}>{artifact?.title || "Documento"}</strong>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "0 10px" }}>
        <button type="button" onClick={onOpen} style={dark}><FileText size={16} strokeWidth={2.2} aria-hidden="true" />{"Abrir"}</button>
        <a href={fileUrl(artifact.id)} download style={soft}><Download size={16} strokeWidth={2.2} aria-hidden="true" />{"Word"}</a>
        {artifact?.pdf ? <a href={pdfUrl(artifact.id)} download style={soft}><FileText size={16} strokeWidth={2.2} aria-hidden="true" />{"PDF"}</a> : null}
      </div>
    </article>
  );
}

/** In the side panel and the Biblioteca: every page, one under another, and the downloads. */
export function DocViewer({ artifact }) {
  const count = Number(artifact?.thumbs) || 0;
  const pages = Number(artifact?.pages) || count;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ font: "500 13px/1 'Geist Mono', monospace", color: "#5C606C" }}>{pages ? plural(pages, "página", "páginas") : "Vista previa"}</span>
        <span style={{ flex: 1 }} />
        <a href={fileUrl(artifact.id)} download style={dark}><Download size={16} strokeWidth={2.2} aria-hidden="true" />{"Word"}</a>
        {artifact?.pdf ? <a href={pdfUrl(artifact.id)} download style={soft}><FileText size={16} strokeWidth={2.2} aria-hidden="true" />{"PDF"}</a> : null}
      </div>
      {count ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "14px", background: "#EDEBE5", borderRadius: "16px" }}>
          {Array.from({ length: count }, (_, i) => (
            <img key={i} data-lightbox="" data-name={`${artifact?.title || "Documento"} · página ${i + 1}`} src={pageUrl(artifact.id, i + 1)} alt={`Página ${i + 1} de ${pages}`} loading={i < 2 ? "eager" : "lazy"} decoding="async"
              style={{ cursor: "zoom-in", display: "block", width: "100%", height: "auto", aspectRatio: "210 / 297", background: "#FFFFFF", borderRadius: "4px", boxShadow: "0 1px 3px rgba(18,19,26,.08), 0 18px 36px -24px rgba(18,19,26,.3)" }} />
          ))}
          {pages > count ? <p style={{ margin: 0, fontSize: "13px", color: "#555A68" }}>{`Se muestran ${count} de ${pages} páginas; descarga el PDF o el Word para verlas todas.`}</p> : null}
        </div>
      ) : (
        <iframe title={artifact?.title || "Documento"} src={docPageUrl(artifact.id)} sandbox="" style={{ width: "100%", height: "78vh", border: 0, borderRadius: "16px", background: "#EDEBE5" }} />
      )}
    </div>
  );
}

// ---------- Excel ----------

const previews = new Map();
/** The workbook's preview (it never changes: a new version is another deliverable). */
function useWorkbook(id) {
  const [state, setState] = useState(() => (previews.has(id) ? { data: previews.get(id) } : { loading: true }));
  useEffect(() => {
    if (!id || previews.has(id)) { if (previews.has(id)) setState({ data: previews.get(id) }); return undefined; }
    let live = true;
    setState({ loading: true });
    get(`/artifacts/${enc(id)}/sheet`).then((data) => { previews.set(id, data); if (live) setState({ data }); }).catch((e) => live && setState({ error: e.message }));
    return () => { live = false; };
  }, [id]);
  return state;
}

const cellBase = { padding: "0 10px", height: "30px", borderBottom: "1px solid #EEECE6", borderRight: "1px solid #F2F0EB", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "280px", fontSize: "13px" };

function cellStyle(cell, col, row) {
  const align = cell.align || col.align;
  const s = { ...cellBase, textAlign: align, fontVariantNumeric: align === "right" ? "tabular-nums" : undefined, color: "#12131A" };
  if (row.total) Object.assign(s, { fontWeight: 600, background: "#F6F5F2", borderTop: "2px solid #12131A" });
  if (cell.fill) Object.assign(s, { background: "#" + cell.fill });
  if (cell.ink) s.color = "#" + cell.ink;
  if (cell.bar != null) s.backgroundImage = `linear-gradient(90deg, #${cell.barColor || "7B4DFF"} 0 ${Math.round(cell.bar * 100)}%, transparent ${Math.round(cell.bar * 100)}%)`;
  if (cell.err) Object.assign(s, { color: "#9C0006", fontWeight: 600 });
  return s;
}

/** One sheet as Excel shows it: letters, row numbers, the header, values, totals and rule colours. */
function Grid({ sheet, dark: headBg = "12131A", maxHeight = "64vh", rows: limit = Infinity, cols: colLimit = Infinity, onPick, picked }) {
  const columns = sheet.columns.slice(0, colLimit);
  const rows = sheet.rows.slice(0, limit);
  const mono = { font: "500 11px/1 'Geist Mono', monospace", color: "#8A8D96" };
  return (
    <div style={{ overflow: "auto", maxHeight, border: "1px solid #E6E8EE", borderRadius: "14px", background: "#FFFFFF" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
          <tr>
            <th aria-hidden="true" style={{ ...mono, position: "sticky", left: 0, zIndex: 3, width: "40px", height: "22px", background: "#F4F3EF", borderBottom: "1px solid #E6E8EE", borderRight: "1px solid #E6E8EE" }} />
            {columns.map((c) => <th key={c.letter} aria-hidden="true" style={{ ...mono, height: "22px", background: "#F4F3EF", borderBottom: "1px solid #E6E8EE", borderRight: "1px solid #ECEAE4", textAlign: "center", fontWeight: 500 }}>{c.letter}</th>)}
          </tr>
          <tr>
            <th scope="row" style={{ ...mono, position: "sticky", left: 0, zIndex: 3, background: "#F4F3EF", borderRight: "1px solid #E6E8EE", textAlign: "center" }}>{"1"}</th>
            {columns.map((c) => <th key={c.letter} scope="col" style={{ ...cellBase, height: "34px", background: "#" + headBg, color: "#FFFFFF", fontWeight: 600, textAlign: c.align === "right" ? "right" : "left", borderRight: "1px solid rgba(255,255,255,.08)" }}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.n}>
              <th scope="row" style={{ ...mono, position: "sticky", left: 0, zIndex: 1, background: "#F4F3EF", borderRight: "1px solid #E6E8EE", borderBottom: "1px solid #ECEAE4", textAlign: "center", fontWeight: 500 }}>{row.n}</th>
              {row.cells.slice(0, colLimit).map((cell, i) => {
                const on = picked && picked.n === row.n && picked.i === i;
                return (
                  <td key={i} title={cell.f || undefined} onClick={onPick ? () => onPick({ n: row.n, i, cell, col: columns[i] }) : undefined}
                    style={{ ...cellStyle(cell, columns[i], row), cursor: onPick ? "cell" : "default", outline: on ? "2px solid #7B4DFF" : "none", outlineOffset: "-2px" }}>{cell.v}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** In the chat: the first rows of the first sheet, what it is, «Abrir» and Excel. */
export function SheetCard({ artifact, onOpen }) {
  const { data } = useWorkbook(artifact?.id);
  const sheets = artifact?.sheets || [];
  const rows = Number(artifact?.rows) || 0;
  const first = data?.sheets?.[0];
  return (
    <article style={card}>
      <button type="button" onClick={onOpen} aria-label={`Abrir «${artifact?.title || "hoja de cálculo"}»`} style={{ padding: 0, border: 0, background: "#EDEBE5", cursor: "pointer", borderRadius: "18px", textAlign: "left", height: "220px", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", inset: "18px 18px 0 18px", pointerEvents: "none" }}>
          {first ? <Grid sheet={first} dark={data.dark} rows={6} cols={5} maxHeight="none" /> : <div style={{ height: "100%", borderRadius: "14px", background: "#FFFFFF", opacity: 0.7 }} />}
        </div>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "56px", background: "linear-gradient(180deg, rgba(237,235,229,0), #EDEBE5)" }} />
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 10px" }}>
        <span style={kicker}>{`Hoja de cálculo · ${plural(sheets.length, "hoja", "hojas")} · ${plural(rows, "fila", "filas")}`}</span>
        <strong style={cardTitle}>{artifact?.title || "Hoja de cálculo"}</strong>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "0 10px" }}>
        <button type="button" onClick={onOpen} style={dark}><FileSpreadsheet size={16} strokeWidth={2.2} aria-hidden="true" />{"Abrir"}</button>
        <a href={fileUrl(artifact.id)} download style={soft}><Download size={16} strokeWidth={2.2} aria-hidden="true" />{"Excel"}</a>
      </div>
    </article>
  );
}

/** In the side panel and the Biblioteca: a tab per sheet, the grid, the formula of the picked cell and the charts. */
export function SheetViewer({ artifact }) {
  const { data, error, loading } = useWorkbook(artifact?.id);
  const [tab, setTab] = useState(0);
  const [picked, setPicked] = useState(null);
  if (error) return <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "14px", color: "#8F1D22" }}>{`No se pudo abrir la vista previa: ${error}`}</p>;
  if (loading || !data) return <p style={{ margin: 0, color: "#4A4F5C" }}>{"Abriendo…"}</p>;
  const sheet = data.sheets[Math.min(tab, data.sheets.length - 1)];
  // Charts are numbered across the workbook, sheet after sheet.
  const before = data.sheets.slice(0, tab).reduce((n, s) => n + s.charts.length, 0);
  const pick = (p) => setPicked(p);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div role="tablist" aria-label="Hojas" style={{ display: "flex", gap: "6px", flexWrap: "wrap", flex: 1 }}>
          {data.sheets.map((s, i) => (
            <button key={s.name} type="button" role="tab" aria-selected={i === tab} onClick={() => { setTab(i); setPicked(null); }}
              style={{ ...pill, height: "34px", padding: "0 14px", fontSize: "13px", background: i === tab ? "#12131A" : "rgba(18,19,26,.06)", color: i === tab ? "#FFFFFF" : "#12131A" }}>{s.name}</button>
          ))}
        </div>
        <a href={fileUrl(artifact.id)} download style={dark}><Download size={16} strokeWidth={2.2} aria-hidden="true" />{"Excel"}</a>
      </div>
      <div aria-live="polite" style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: "0 12px", border: "1px solid #E6E8EE", borderRadius: "10px", background: "#FAFAF8", font: "400 13px/1.4 'Geist Mono', monospace", color: "#3D404A", overflow: "hidden" }}>
        <span style={{ minWidth: "44px", color: "#6B6F7A" }}>{picked ? picked.col.letter + picked.n : ""}</span>
        <Sigma size={14} strokeWidth={2.2} aria-hidden="true" style={{ color: "#8A8D96", flex: "none" }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{picked ? picked.cell.f || picked.cell.v : "Toca una celda para ver su fórmula"}</span>
      </div>
      <Grid sheet={sheet} dark={data.dark} onPick={pick} picked={picked} />
      <span style={{ fontSize: "13px", color: "#555A68" }}>
        {`${plural(sheet.rowCount, "fila", "filas")} de datos` + (sheet.truncated ? ` · se muestran las primeras ${sheet.rows.length}; descarga el Excel para verlas todas` : "")}
      </span>
      {sheet.charts.map((name, k) => (
        <figure key={k} style={{ margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
          <img data-lightbox="" data-name={`${artifact?.title || "Hoja"} · ${name}`} src={chartUrl(artifact.id, before + k + 1)} alt={`Gráfico: ${name}`} loading="lazy"
            style={{ cursor: "zoom-in", display: "block", width: "100%", height: "auto", border: "1px solid #E6E8EE", borderRadius: "14px", background: "#FFFFFF" }} />
        </figure>
      ))}
    </div>
  );
}
