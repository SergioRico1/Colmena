import ReactMarkdown from "react-markdown";
import { SlideViewer, isDeck } from "../../v2/SlideDeck.jsx";
import { DocViewer, SheetViewer, isWordDoc, isWorkbook } from "../../v2/OfficeFiles.jsx";
import NoteLink from "../../wiki/NoteLink.jsx";
import { NOTE_HREF, linkifyNotes, noteOfHref } from "../../../lib/wikiLinks.js";
import { C } from "../../../lib/theme.js";

// `[[Nota]]` in a deliverable is a link to that note (docs/CONTRACT.md §16).
const MD = {
  a: ({ node, href, ...props }) => (String(href || "").startsWith(NOTE_HREF)
    ? <NoteLink target={noteOfHref(href)}>{props.children}</NoteLink>
    : <a href={href} {...props} />),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < text.length && rows.length < 300; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** The content of a deliverable: image, table, page, markdown or code. */
export function ArtifactContent({ a, loading = false, error = null }) {
  const content = a?.content ?? "";
  if (loading && !a) return <p style={{ margin: 0, color: "var(--c-text-2)" }}>Abriendo…</p>;
  if (error) return <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "var(--c-error-soft)", border: "1px solid color-mix(in srgb, var(--c-error) 35%, transparent)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{`No se pudo abrir: ${error}`}</p>;
  if (!content) return <p style={{ margin: 0, color: "var(--c-text-2)" }}>{a?.status === "en curso" ? "Todavía se está haciendo. Aparecerá aquí en cuanto el bot lo termine." : "Este entregable está vacío."}</p>;
  if (isDeck(a)) return <SlideViewer artifact={a} />;
  if (isWordDoc(a)) return <DocViewer artifact={a} />;
  if (isWorkbook(a)) return <SheetViewer artifact={a} />;
  if (a.format === "svg") return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`} alt={a.title} style={{ maxWidth: "100%", display: "block", margin: "0 auto", background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)" }} />;
  if (a.format === "csv") {
    const rows = parseCsv(content);
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "var(--t-meta)", minWidth: "100%" }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => i === 0
                ? <th key={j} scope="col" style={{ padding: "8px", borderBottom: "2px solid var(--c-text)", textAlign: "left", fontWeight: "600", whiteSpace: "nowrap" }}>{c}</th>
                : <td key={j} style={{ padding: "8px", borderBottom: "1px solid var(--c-line)", fontFamily: /^-?[\d.,%€$ ]+$/.test(c) ? "'Geist Mono', monospace" : "inherit" }}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (a.format === "html") return <iframe title={a.title} sandbox="" srcDoc={content} style={{ width: "100%", height: "70vh", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-card)" }} />;
  if (a.format === "md" || a.format === "txt" || a.kind === "document" || a.kind === "slides") return <div className="colmena-md"><ReactMarkdown components={MD}>{linkifyNotes(content)}</ReactMarkdown></div>;
  return <pre style={{ margin: 0, padding: "16px", background: "var(--c-term-bg)", color: "var(--c-term-fg)", border: "1px solid var(--c-term-line)", borderRadius: "var(--r-md)", overflow: "auto", font: "400 var(--t-meta)/1.6 'Geist Mono', monospace" }}>{content}</pre>;
}
