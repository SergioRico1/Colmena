// The deck as a page of 1280×720 slides (viewer, PDF and the checks in a hidden window).
import { FONTS, H, W } from "./layout.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ptPx = (pt) => (pt * 96 / 72).toFixed(1) + "px";
const box = (b) => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
const family = (f) => f === "heading" ? `'${FONTS.heading}','Segoe UI',system-ui,sans-serif;font-weight:600` : `'${FONTS.body}',system-ui,sans-serif`;

export const SERIES = (theme) => [theme.accent, theme.accent2, theme.muted, theme.ink];

function textEl(e, n) {
  const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[e.valign] || "flex-start";
  const paras = e.paragraphs.map((p) => e.bullets
    ? `<li>${esc(p)}</li>`
    : `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const inner = e.bullets ? `<ul>${paras}</ul>` : paras;
  return `<div class="t" data-check="${esc(e.what || "")}" data-slide="${n}" style="${box(e.box)};justify-content:${justify};text-align:${e.align};color:#${e.color};font-family:${family(e.font)};font-size:${ptPx(e.size)};line-height:${e.lineHeight}${e.oneLine ? ";white-space:nowrap" : ""}">${inner}</div>`;
}

export function chartSvg(chart, b, theme) {
  const colors = SERIES(theme);
  const { labels, series, type, unit } = chart;
  const fmt = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString("es-ES") : String(+v.toFixed(2))) + (unit ? " " + unit : "");
  if (type === "pie" || type === "doughnut") {
    const values = series[0].values, total = values.reduce((a, v) => a + Math.max(0, v), 0) || 1;
    const r = Math.min(b.h, b.w * 0.55) / 2 - 10, cx = r + 10, cy = b.h / 2;
    const pie = ["#" + theme.accent, "#" + theme.accent2, "#" + theme.ink, "#" + theme.muted, "#" + theme.line, "#9AA0AE"];
    let a0 = -Math.PI / 2, out = "";
    values.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
      out += values.length === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${pie[0]}"/>` : `<path d="M${cx},${cy} L${p(a0)} A${r},${r} 0 ${large} 1 ${p(a1)} Z" fill="${pie[i % pie.length]}"/>`;
      a0 = a1;
    });
    if (type === "doughnut") out += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.58).toFixed(1)}" fill="#${theme.bg}"/>`;
    const legend = labels.map((l, i) => `<g transform="translate(${2 * r + 50},${cy - labels.length * 19 + i * 38})"><rect width="18" height="18" rx="4" fill="${pie[i % pie.length]}"/><text x="30" y="15" font-size="20" fill="#${theme.ink}">${esc(l)} · ${esc(fmt(values[i] ?? 0))}</text></g>`).join("");
    return out + legend;
  }
  const all = series.flatMap((s) => s.values);
  // Round ticks (0, 1.000, 2.000…), as a person would draw the axis.
  const rough = (Math.max(0, ...all) - Math.min(0, ...all) || 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const tick = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= rough);
  const max = Math.ceil(Math.max(0, ...all) / tick) * tick, min = Math.floor(Math.min(0, ...all) / tick) * tick, span = max - min || 1;
  const ticks = Math.round(span / tick);
  const left = 84, bottom = 46, top = series.length > 1 ? 44 : 14, w = b.w - left - 10, h = b.h - bottom - top;
  const y = (v) => top + h - ((v - min) / span) * h;
  let out = "";
  for (let i = 0; i <= ticks; i++) {
    const v = min + tick * i, yy = y(v).toFixed(1);
    out += `<line x1="${left}" x2="${left + w}" y1="${yy}" y2="${yy}" stroke="#${theme.line}" stroke-width="1"/><text x="${left - 12}" y="${+yy + 6}" font-size="15" text-anchor="end" fill="#${theme.muted}">${esc(fmt(+v.toFixed(2)))}</text>`;
  }
  const step = w / labels.length;
  labels.forEach((l, i) => { out += `<text x="${(left + step * (i + 0.5)).toFixed(1)}" y="${top + h + 30}" font-size="16" text-anchor="middle" fill="#${theme.muted}">${esc(l)}</text>`; });
  if (type === "line") {
    series.forEach((s, k) => {
      const pts = s.values.map((v, i) => `${(left + step * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`);
      out += `<polyline points="${pts.join(" ")}" fill="none" stroke="#${colors[k]}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` + pts.map((p) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="6" fill="#${colors[k]}"/>`).join("");
    });
  } else {
    const group = step * 0.7, bar = group / series.length;
    series.forEach((s, k) => s.values.forEach((v, i) => {
      const x = left + step * i + (step - group) / 2 + k * bar, y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
      out += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(2, bar - 6).toFixed(1)}" height="${Math.max(1, y1 - y0).toFixed(1)}" rx="6" fill="#${colors[k]}"/>`;
    }));
  }
  if (series.length > 1) out += series.map((s, k) => `<g transform="translate(${left + k * 220},4)"><rect width="18" height="18" rx="4" fill="#${colors[k]}"/><text x="28" y="15" font-size="17" fill="#${theme.ink}">${esc(s.name)}</text></g>`).join("");
  return out;
}

function element(e, n, theme) {
  if (e.type === "text") return textEl(e, n);
  if (e.type === "shape") return `<div style="position:absolute;${box(e.box)};background:#${e.fill};border-radius:${e.radius || 0}px;${e.stroke ? `box-shadow:inset 0 0 0 1px #${e.stroke}` : ""}"></div>`;
  if (e.type === "image") return `<img alt="" src="${e.src}" style="position:absolute;${box(e.box)};object-fit:${e.fit};border-radius:${e.radius || 0}px">`;
  if (e.type === "chart") return `<svg style="position:absolute;${box(e.box)};font-family:${family("body")}" viewBox="0 0 ${e.box.w} ${e.box.h}">${chartSvg(e.chart, e.box, theme)}</svg>`;
  if (e.type === "table") {
    const head = `<tr style="height:${e.heights[0].toFixed(1)}px">${e.header.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
    const rows = e.rows.map((r, k) => `<tr style="height:${e.heights[k + 1].toFixed(1)}px">${e.header.map((_, i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("");
    return `<table data-check="la tabla" data-slide="${n}" style="position:absolute;${box(e.box)};font-size:${ptPx(e.size)}"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }
  return "";
}

/** One standalone page: every slide (or only slide `only`, 1-based), print-ready at 1280×720. */
export function deckHtml(deck, laid, theme, { only = 0 } = {}) {
  const slides = laid.map((s, i) => ({ s, n: i + 1 })).filter(({ n }) => !only || n === only);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(deck.title)}</title><style>
@page{size:${W}px ${H}px;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#${theme.bg}}
.slide{position:relative;width:${W}px;height:${H}px;overflow:hidden;page-break-after:always;break-after:page}
.t{position:absolute;display:flex;flex-direction:column;overflow:hidden;overflow-wrap:anywhere}
.t p+p{margin-top:.45em}
.t ul{list-style:none;display:flex;flex-direction:column;gap:.45em}
.t li{position:relative;padding-left:1.1em}
.t li::before{content:"";position:absolute;left:0;top:.5em;width:.42em;height:.42em;border-radius:50%;background:#${theme.accent}}
table{border-collapse:separate;border-spacing:0;font-family:'${FONTS.body}',system-ui,sans-serif;color:#${theme.ink};table-layout:fixed;border-radius:16px;overflow:hidden;box-shadow:inset 0 0 0 1px #${theme.line}}
th{background:#${theme.dark};color:#${theme.onDark};font-family:'${FONTS.heading}','Segoe UI',sans-serif;font-weight:600;text-align:left;padding:0 18px}
td{padding:0 18px;border-top:1px solid #${theme.line};background:#${theme.surface}}
th,td{overflow-wrap:anywhere;line-height:1.3}
html{scrollbar-width:none}
::-webkit-scrollbar{display:none}
</style></head><body>${slides.map(({ s, n }) => `<section class="slide" data-n="${n}" style="background:#${s.bg}">${s.elements.map((e) => element(e, n, theme)).join("")}</section>`).join("")}</body></html>`;
}
