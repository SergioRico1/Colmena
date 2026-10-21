// The document as an A4 page: what the viewer shows before there is a PDF, and what the desktop
// app prints to PDF (Chromium paginates it; the footer with the page numbers is added there).
import { chartSvgDocument, esc, inlineHtml } from "../office/common.mjs";

export const PAGE = { width: 794, height: 1123, margins: "22mm 20mm 24mm 20mm" };
const NUMERIC = /^[-+−]?\(?[\d\s.,]+\)?\s?(%|€|\$|£|k|M|pp|p\.p\.)?$/i;

/** Columns whose cells are all figures are aligned to the right. */
export function numericColumns(header, rows) {
  return header.map((_, i) => {
    const cells = rows.map((r) => String(r[i] ?? "").trim()).filter(Boolean);
    return cells.length > 0 && cells.every((c) => NUMERIC.test(c) || /^[-+]?[\d.,]+\s?(€|%)$/.test(c));
  });
}

/** A light tint of a colour (callouts): `share` of the colour over white. */
export function tint(hex, share = 0.1) {
  const n = parseInt(hex, 16);
  const mix = (c) => Math.round(255 - (255 - c) * share);
  return [mix(n >> 16 & 255), mix(n >> 8 & 255), mix(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const toneColors = (theme) => ({
  info: { ink: theme.accent, bg: tint(theme.accent, 0.09) },
  success: { ink: "0B8A5F", bg: "E7F5EF" },
  warning: { ink: "A85C00", bg: "FFF3DD" },
});

function titleBlock(doc, theme) {
  const meta = [doc.author, doc.date].filter(Boolean).join(" · ");
  return `<header class="titleblock${doc.cover === "page" ? " cover" : ""}">
${meta ? `<p class="meta">${esc(meta)}</p>` : ""}<h1 class="title">${esc(doc.title)}</h1>${doc.subtitle ? `<p class="subtitle">${esc(doc.subtitle)}</p>` : ""}<div class="rule"></div></header>`;
}

function block(b, theme, images) {
  switch (b.type) {
    case "heading": return `<h${b.level + 1} class="h${b.level}">${esc(b.text)}</h${b.level + 1}>`;
    case "paragraph": return b.text.split(/\n{2,}/).map((p) => `<p>${inlineHtml(p)}</p>`).join("");
    case "bullets": return `<ul>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</ul>`;
    case "numbered": return `<ol>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</ol>`;
    case "table": {
      const right = numericColumns(b.header, b.rows);
      const cls = (i) => (right[i] ? ' class="num"' : "");
      return `<figure class="table"><table><thead><tr>${b.header.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
        b.rows.map((r) => `<tr>${b.header.map((_, i) => `<td${cls(i)}>${inlineHtml(r[i] ?? "")}</td>`).join("")}</tr>`).join("")
      }</tbody></table>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "image": {
      const img = images[b.image];
      return `<figure class="image ${b.width}">${img ? `<img alt="${esc(b.caption)}" src="${img.dataUri}">` : ""}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "chart": return `<figure class="chart">${chartSvgDocument(b.chart, theme)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    case "quote": return `<blockquote><p>${inlineHtml(b.text)}</p>${b.author ? `<cite>— ${esc(b.author)}</cite>` : ""}</blockquote>`;
    case "callout": return `<aside class="callout ${b.tone}">${b.title ? `<strong>${esc(b.title)}</strong>` : ""}<p>${inlineHtml(b.text)}</p></aside>`;
    case "page_break": return `<div class="pb"></div>`;
  }
  return "";
}

/** The footer Chromium prints on every page (title · n / total). */
export function footerTemplate(doc, theme) {
  return `<div style="width:100%;padding:0 20mm;font:8px 'Segoe UI',sans-serif;color:#${theme.muted};display:flex;justify-content:space-between"><span>${esc(doc.title.slice(0, 90))}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

/** One standalone page with the whole document, print-ready on A4. */
export function documentHtml(doc, theme, images = {}) {
  const tones = toneColors(theme);
  const heading = `'Segoe UI Semibold','Segoe UI',system-ui,sans-serif`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
@page{size:A4;margin:${PAGE.margins}}
*{box-sizing:border-box}
html{background:#FFFFFF;scrollbar-width:thin}
body{margin:0;font:11pt/1.45 'Segoe UI',system-ui,sans-serif;color:#${theme.ink};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:${PAGE.width}px;margin:0 auto}
@media screen{html{background:#EDEBE5}.sheet{background:#FFFFFF;padding:22mm 20mm 24mm;margin:24px auto;box-shadow:0 1px 3px rgba(18,19,26,.08),0 20px 40px -24px rgba(18,19,26,.25)}.pb{height:0;margin:22mm -20mm;border-top:24px solid #EDEBE5}}
@media print{.pb{break-after:page;height:0}}
p{margin:0 0 8pt}
a{color:#${theme.accent};text-decoration:underline}
h2,h3,h4{font-family:${heading};font-weight:600;line-height:1.2;break-after:avoid;page-break-after:avoid;margin:0}
h2.h1{font-size:19pt;margin:20pt 0 9pt;padding-bottom:5pt;border-bottom:1.5pt solid #${theme.accent}}
h3.h2{font-size:14pt;margin:16pt 0 6pt}
h4.h3{font-size:11.5pt;margin:12pt 0 4pt;color:#${theme.accent}}
.titleblock{margin:0 0 18pt}
.titleblock.cover{padding-top:60mm;break-after:page;page-break-after:always}
.titleblock .meta{font-size:9.5pt;letter-spacing:.06em;text-transform:uppercase;color:#${theme.muted};margin:0 0 8pt}
.titleblock .title{font-family:${heading};font-weight:600;font-size:${doc.cover === "page" ? 32 : 26}pt;line-height:1.12;margin:0;color:#${theme.ink}}
.titleblock .subtitle{font-size:13pt;color:#${theme.muted};margin:8pt 0 0}
.titleblock .rule{width:64px;height:4px;border-radius:2px;background:#${theme.accent};margin-top:14pt}
ul,ol{margin:0 0 9pt;padding-left:22pt}
li{margin:0 0 4pt;padding-left:2pt}
ul li::marker{color:#${theme.accent}}
ol li::marker{color:#${theme.accent};font-family:${heading}}
figure{margin:6pt 0 12pt;break-inside:avoid}
figcaption{font-size:9pt;color:#${theme.muted};margin-top:5pt}
figure.image img{display:block;max-width:100%;height:auto;border-radius:4px}
figure.image.half img{width:50%}
figure.chart svg{display:block;width:100%;height:auto}
table{width:100%;border-collapse:collapse;font-size:9.5pt;line-height:1.35}
thead{display:table-header-group}
tr{break-inside:avoid}
th{background:#${theme.dark};color:#${theme.onDark};font-family:${heading};font-weight:600;text-align:left;padding:5pt 7pt}
td{padding:5pt 7pt;border-bottom:.75pt solid #${theme.line};vertical-align:top}
th,td{overflow-wrap:anywhere}
tbody tr:nth-child(even) td{background:#${theme.surface}}
.num{text-align:right;font-variant-numeric:tabular-nums}
blockquote{margin:6pt 0 12pt;padding:2pt 0 2pt 14pt;border-left:3pt solid #${theme.accent};font-size:12.5pt;font-style:italic}
blockquote p{margin:0}
blockquote cite{display:block;margin-top:5pt;font-size:9.5pt;font-style:normal;color:#${theme.muted}}
.callout{margin:6pt 0 12pt;padding:9pt 12pt;border-left:3.5pt solid;border-radius:3pt;break-inside:avoid}
.callout strong{display:block;font-family:${heading};font-weight:600;margin-bottom:3pt}
.callout p{margin:0}
${Object.entries(tones).map(([k, c]) => `.callout.${k}{border-color:#${c.ink};background:#${c.bg}}.callout.${k} strong{color:#${c.ink}}`).join("\n")}
</style></head><body><main class="sheet">${doc.cover === "none" ? "" : titleBlock(doc, theme)}${doc.blocks.map((b) => block(b, theme, images)).join("\n")}</main></body></html>`;
}
