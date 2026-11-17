// What a file looks like, drawn in the page (loaded only when a preview is wanted): PDF pages
// (pdf.js), Word as text and tables (mammoth, cleaned to a short list of tags), Excel and
// PowerPoint read from their XML, CSV as a table, Markdown, plain text and images. `Thumb` is the
// small picture on a file's card; `FileView` the whole thing in the side panel (FileCard.jsx).
import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import Markdown from "../components/room/Markdown.jsx";
import { parseCsv } from "../components/room/ArtifactPanel.jsx";
import { fileUrl } from "./api.js";
import { kindOf, readBytes } from "./files.js";

// ---- reading, once per file and kind of view
const cache = new Map();
const once = (key, make) => {
  if (!cache.has(key)) { const p = make(); p.catch(() => cache.delete(key)); cache.set(key, p); if (cache.size > 40) cache.delete(cache.keys().next().value); }
  return cache.get(key);
};
const text = (buf) => new TextDecoder("utf-8").decode(buf);
const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const tags = (node, name) => [...node.getElementsByTagName(name)];

let pdfjs = null;
async function pdfLib() {
  if (!pdfjs) {
    const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    pdfjs = lib;
  }
  return pdfjs;
}
const pdfDoc = (id) => once("pdf:" + id, async () => {
  const lib = await pdfLib();
  // pdf.js keeps (and may detach) the buffer it gets: a copy.
  const data = new Uint8Array((await readBytes(id)).slice(0));
  return lib.getDocument({ data }).promise;
});

/** Word → a few safe tags. Images stay only as data: pictures; links only http(s) and mailto. */
const ALLOWED = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "BR", "A", "IMG", "BLOCKQUOTE", "SUP", "SUB", "PRE", "CODE"]);
export function cleanHtml(html) {
  const doc = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
  const walk = (node) => {
    for (const el of [...node.children]) {
      walk(el);
      if (!ALLOWED.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const keep = (el.tagName === "A" && a.name === "href" && /^(https?:|mailto:)/i.test(a.value))
          || (el.tagName === "IMG" && a.name === "src" && /^data:image\/(png|jpe?g|gif|webp)/i.test(a.value))
          || ((el.tagName === "TD" || el.tagName === "TH") && (a.name === "colspan" || a.name === "rowspan") && /^\d{1,3}$/.test(a.value));
        if (!keep) el.removeAttribute(a.name);
      }
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer nofollow"); }
      if (el.tagName === "IMG") { el.setAttribute("alt", ""); el.setAttribute("loading", "lazy"); }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
const docx = (id) => once("docx:" + id, async () => {
  const mammoth = (await import("mammoth/mammoth.browser.js")).default;
  const out = await mammoth.convertToHtml({ arrayBuffer: await readBytes(id) });
  return cleanHtml(out.value || "");
});

/** Excel: [{name, rows: [[text]]}], up to 200 rows and 30 columns a sheet. */
const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)?.[0] || "A") n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const xlsx = (id) => once("xlsx:" + id, async () => {
  const zip = await JSZip.loadAsync(await readBytes(id));
  const read = async (p) => (zip.file(p) ? zip.file(p).async("string") : null);
  const wb = xml(await read("xl/workbook.xml") || "<w/>");
  const rels = xml(await read("xl/_rels/workbook.xml.rels") || "<r/>");
  const target = Object.fromEntries(tags(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const sst = xml(await read("xl/sharedStrings.xml") || "<s/>");
  const shared = tags(sst, "si").map((si) => tags(si, "t").map((t) => t.textContent).join(""));
  // Which cells are dates (their style's number format).
  const styles = xml(await read("xl/styles.xml") || "<s/>");
  const custom = Object.fromEntries(tags(styles, "numFmt").map((n) => [n.getAttribute("numFmtId"), n.getAttribute("formatCode") || ""]));
  const xfs = tags(styles, "cellXfs")[0];
  const dateStyle = (xfs ? tags(xfs, "xf") : []).map((x) => { const nid = Number(x.getAttribute("numFmtId")); return DATE_IDS.has(nid) || (/[dmy]/i.test((custom[nid] || "").replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/[0#]/.test(custom[nid] || "")); });
  const num = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 6 });
  const sheets = [];
  for (const s of tags(wb, "sheet").slice(0, 12)) {
    const t = target[s.getAttribute("r:id")] || "";
    const doc = xml(await read("xl/" + t.replace(/^\/?xl\//, "").replace(/^\//, "")) || "<x/>");
    const rows = [];
    let width = 0;
    for (const row of tags(doc, "row").slice(0, 200)) {
      const r = Number(row.getAttribute("r")) - 1;
      if (r >= 200) break;
      const cells = [];
      for (const c of tags(row, "c")) {
        const i = colIndex(c.getAttribute("r") || "A");
        if (i >= 30) continue;
        const type = c.getAttribute("t"), v = tags(c, "v")[0]?.textContent ?? "";
        let out = v;
        if (type === "s") out = shared[Number(v)] ?? "";
        else if (type === "inlineStr") out = tags(c, "t").map((x) => x.textContent).join("");
        else if (type === "b") out = v === "1" ? "VERDADERO" : "FALSO";
        else if (type !== "str" && type !== "e" && v !== "" && Number.isFinite(Number(v))) {
          out = dateStyle[Number(c.getAttribute("s") || 0)] ? new Date(Math.round((Number(v) - 25569) * 86400000)).toLocaleDateString("es-ES", { timeZone: "UTC" }) : num.format(Number(v));
        }
        cells[i] = out;
        width = Math.max(width, i + 1);
      }
      rows[r] = cells;
    }
    const filled = Array.from({ length: rows.length }, (_, k) => Array.from({ length: width }, (_, j) => rows[k]?.[j] ?? ""));
    sheets.push({ name: s.getAttribute("name") || "Hoja", rows: filled });
  }
  return sheets;
});

/** PowerPoint: [{title, lines: [text], image: blob url|null}] in the deck's order. */
const pptx = (id) => once("pptx:" + id, async () => {
  const zip = await JSZip.loadAsync(await readBytes(id));
  const read = async (p) => (zip.file(p) ? zip.file(p).async("string") : null);
  const pres = xml(await read("ppt/presentation.xml") || "<p/>");
  const rels = xml(await read("ppt/_rels/presentation.xml.rels") || "<r/>");
  const target = Object.fromEntries(tags(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const slides = [];
  for (const sid of tags(pres, "p:sldId").slice(0, 60)) {
    const path = "ppt/" + (target[sid.getAttribute("r:id")] || "").replace(/^\/?ppt\//, "");
    const doc = xml(await read(path) || "<s/>");
    let title = "";
    const lines = [];
    for (const sp of tags(doc, "p:sp")) {
      const ph = tags(sp, "p:ph")[0]?.getAttribute("type") || "";
      const paras = tags(sp, "a:p").map((p) => tags(p, "a:t").map((t) => t.textContent).join("")).filter((x) => x.trim());
      if (!title && /title|ctrTitle/i.test(ph)) title = paras.join(" ");
      else lines.push(...paras);
    }
    // Its first picture, if any.
    let image = null;
    const relPath = path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
    const srels = xml(await read(relPath) || "<r/>");
    const pic = tags(srels, "Relationship").find((r) => /\/image$/.test(r.getAttribute("Type") || ""));
    if (pic) {
      const file = zip.file("ppt/" + pic.getAttribute("Target").replace(/^\.\.\//, "").replace(/^\/?ppt\//, ""));
      if (file && /\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
        const b = await file.async("uint8array");
        if (b.length < 3 * 1048576) image = URL.createObjectURL(new Blob([b], { type: /\.png$/i.test(file.name) ? "image/png" : /\.gif$/i.test(file.name) ? "image/gif" : /\.webp$/i.test(file.name) ? "image/webp" : "image/jpeg" }));
      }
    }
    if (!title && lines.length) title = lines.shift();
    slides.push({ title, lines: lines.slice(0, 10), image });
  }
  return slides;
});

const plainText = (id) => once("text:" + id, async () => text(await readBytes(id)));

// ---- pieces
function PdfPage({ doc, n, width }) {
  const canvas = useRef(null);
  useEffect(() => {
    let task = null, gone = false;
    doc.getPage(n).then((page) => {
      if (gone || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      canvas.current.style.aspectRatio = base.width + " / " + base.height;
      task = page.render({ canvas: canvas.current, viewport });
      task.promise.catch(() => {});
    });
    return () => { gone = true; task?.cancel?.(); };
  }, [doc, n, width]);
  return <canvas ref={canvas} className="fv-page" aria-label={"Página " + n} />;
}

function Slide({ s, n, small = false }) {
  return (
    <div className={"fv-slide" + (small ? " is-small" : "")} aria-label={"Diapositiva " + n}>
      <div className="fv-slide-text">
        {s.title ? <p className="fv-slide-title">{s.title}</p> : null}
        {(small ? s.lines.slice(0, 3) : s.lines).map((l, i) => <p key={i} className="fv-slide-line">{l}</p>)}
      </div>
      {s.image ? <img className="fv-slide-img" src={s.image} alt="" /> : null}
    </div>
  );
}

function Grid({ rows, small = false }) {
  const shown = small ? rows.slice(0, 6).map((r) => r.slice(0, 5)) : rows;
  if (!shown.length) return <p className="fv-note">La hoja está vacía.</p>;
  return (
    <div className={"fv-grid-wrap" + (small ? " is-small" : "")}>
      <table className="fv-grid">
        <tbody>{shown.map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Runs `load()` and keeps {state, data, error}. */
function useLoad(load, key) {
  const [r, setR] = useState({ state: "loading" });
  useEffect(() => {
    let live = true;
    setR({ state: "loading" });
    load().then((data) => live && setR({ state: "ready", data }), (e) => live && setR({ state: "error", error: e?.message || "No se pudo leer el archivo." }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return r;
}

const LOADERS = { pdf: pdfDoc, docx, xlsx, pptx, csv: plainText, md: plainText, text: plainText, image: async () => null };

/** The small picture on a file's card. */
export function Thumb({ file }) {
  const kind = kindOf(file);
  const r = useLoad(() => LOADERS[kind](file.id), file.id);
  if (r.state !== "ready") return <div className={"fv-thumb is-" + r.state} aria-hidden="true" />;
  const d = r.data;
  return (
    <div className="fv-thumb" aria-hidden="true">
      {kind === "pdf" ? <PdfPage doc={d} n={1} width={300} />
        : kind === "pptx" ? (d[0] ? <Slide s={d[0]} n={1} small /> : null)
        : (
          // Drawn at full size and shown at half: small type without sizes off the scale.
          <div className="fv-shrink">
            {kind === "xlsx" ? (d[0] ? <Grid rows={d[0].rows} small /> : null)
              : kind === "docx" ? <div className="fv-doc" dangerouslySetInnerHTML={{ __html: d.slice(0, 3000) }} />
              : kind === "csv" ? <Grid rows={parseCsv(d.slice(0, 4000))} small />
              : kind === "md" ? <div className="fv-md"><Markdown text={d.slice(0, 1200)} size={14} /></div>
              : <pre className="fv-text">{d.slice(0, 800)}</pre>}
          </div>
        )}
    </div>
  );
}

/** The whole file, in the side panel. */
export function FileView({ file }) {
  const kind = kindOf(file);
  const r = useLoad(() => LOADERS[kind](file.id), file.id);
  const [sheet, setSheet] = useState(0);
  const [width, setWidth] = useState(560);
  const box = useRef(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  let body = null;
  if (r.state === "loading") body = <p className="fv-note">Preparando la vista…</p>;
  else if (r.state === "error") body = <p className="ch-error" role="alert">{r.error}</p>;
  else if (kind === "image") body = <img className="fv-image" src={fileUrl(file.id)} alt={file.name} />;
  else if (kind === "pdf") body = <div className="fv-pages">{Array.from({ length: Math.min(r.data.numPages, 60) }, (_, i) => <PdfPage key={i} doc={r.data} n={i + 1} width={width} />)}{r.data.numPages > 60 ? <p className="fv-note">Se ven las 60 primeras páginas de {r.data.numPages}. Descárgalo para verlo entero.</p> : null}</div>;
  else if (kind === "docx") body = <div className="fv-doc" dangerouslySetInnerHTML={{ __html: r.data || "<p>El documento está vacío.</p>" }} />;
  else if (kind === "pptx") body = <div className="fv-slides">{r.data.length ? r.data.map((s, i) => <Slide key={i} s={s} n={i + 1} />) : <p className="fv-note">La presentación no tiene diapositivas.</p>}</div>;
  else if (kind === "xlsx") {
    const sheets = r.data;
    body = (
      <>
        {sheets.length > 1 ? <div className="fv-tabs" role="tablist" aria-label="Hojas">{sheets.map((s, i) => <button key={i} type="button" role="tab" aria-selected={i === sheet} className="fv-tab" onClick={() => setSheet(i)}>{s.name}</button>)}</div> : null}
        {sheets[sheet] ? <Grid rows={sheets[sheet].rows} /> : <p className="fv-note">El libro no tiene hojas.</p>}
        <p className="fv-note">Se ven hasta 200 filas y 30 columnas por hoja, sin fórmulas ni formato.</p>
      </>
    );
  } else if (kind === "csv") body = <Grid rows={parseCsv(r.data).slice(0, 500)} />;
  else if (kind === "md") body = <div className="fv-md"><Markdown text={r.data} size={15} /></div>;
  else body = <pre className="fv-text">{r.data.slice(0, 200000)}</pre>;
  return <div ref={box} className={"fv is-" + kind}>{body}</div>;
}
