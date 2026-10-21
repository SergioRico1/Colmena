// The same boxes as native PowerPoint: real text, shapes, tables and charts you can edit.
import PptxGenJS from "pptxgenjs";
import { FONTS } from "./layout.mjs";
import { SERIES } from "./html.mjs";

const inch = (v) => +(v / 96).toFixed(3);
const at = (b) => ({ x: inch(b.x), y: inch(b.y), w: inch(b.w), h: inch(b.h) });

function addText(slide, e) {
  const base = { fontFace: FONTS[e.font], fontSize: e.size, color: e.color, bold: e.font === "heading", align: e.align, valign: e.valign, margin: 0, lineSpacingMultiple: e.lineHeight, fit: "none", paraSpaceAfter: Math.round(e.size * 0.45) };
  const runs = e.paragraphs.map((p, i) => ({
    text: String(p),
    options: { ...(e.bullets ? { bullet: { code: "25CF", indent: Math.round(e.size * 1.1) } } : {}), breakLine: i < e.paragraphs.length - 1 },
  }));
  slide.addText(runs, { ...at(e.box), ...base });
}

function addChart(pres, slide, e, theme) {
  const { chart } = e;
  const type = { bar: pres.ChartType.bar, column: pres.ChartType.bar, line: pres.ChartType.line, pie: pres.ChartType.pie, doughnut: pres.ChartType.doughnut }[chart.type];
  const round = chart.type === "pie" || chart.type === "doughnut";
  const data = (round ? chart.series.slice(0, 1) : chart.series).map((s) => ({ name: s.name || " ", labels: chart.labels, values: s.values }));
  const pie = [theme.accent, theme.accent2, theme.ink, theme.muted, theme.line, "9AA0AE"];
  slide.addChart(type, data, {
    ...at(e.box),
    barDir: chart.type === "bar" ? "bar" : "col",
    chartColors: round ? pie : SERIES(theme),
    showLegend: round || chart.series.length > 1, legendPos: round ? "r" : "t", legendFontFace: FONTS.body, legendFontSize: 14, legendColor: theme.ink,
    catAxisLabelColor: theme.muted, valAxisLabelColor: theme.muted, catAxisLabelFontFace: FONTS.body, valAxisLabelFontFace: FONTS.body, catAxisLabelFontSize: 13, valAxisLabelFontSize: 12,
    valGridLine: { color: theme.line, size: 1 }, catGridLine: { style: "none" }, valAxisLineShow: false,
    lineSize: 3, lineDataSymbolSize: 8, barGapWidthPct: 60,
    showValue: round, dataLabelColor: theme.onDark, dataLabelFontSize: 12, holeSize: 58,
    ...(chart.unit ? { valAxisTitle: chart.unit, showValAxisTitle: true, valAxisTitleColor: theme.muted, valAxisTitleFontSize: 12 } : {}),
  });
}

function addTable(slide, e, theme) {
  const head = e.header.map((c) => ({ text: c, options: { bold: true, color: theme.onDark, fill: { color: theme.dark }, fontFace: FONTS.heading } }));
  const rows = e.rows.map((r) => e.header.map((_, i) => ({ text: r[i] ?? "", options: { color: theme.ink, fill: { color: theme.surface } } })));
  slide.addTable([head, ...rows], {
    ...at(e.box), colW: e.header.map(() => inch(e.box.w / e.header.length)), rowH: e.heights.map(inch),
    fontFace: FONTS.body, fontSize: e.size, valign: "middle", margin: [0, 0.18, 0, 0.18],
    border: { type: "solid", pt: 1, color: theme.line },
  });
}

/** The .pptx bytes of a laid-out deck. */
export async function deckPptx(deck, laid, theme) {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in = 1280 × 720 px
  pres.title = deck.title;
  pres.company = "Colmena";
  laid.forEach((s, i) => {
    const slide = pres.addSlide();
    slide.background = { color: s.bg };
    for (const e of s.elements) {
      if (e.type === "text") addText(slide, e);
      else if (e.type === "shape") slide.addShape(e.radius ? pres.ShapeType.roundRect : pres.ShapeType.rect, { ...at(e.box), fill: { color: e.fill }, line: e.stroke ? { color: e.stroke, width: 0.75 } : { type: "none" }, ...(e.radius ? { rectRadius: inch(e.radius) } : {}) });
      else if (e.type === "image") slide.addImage({ data: e.src.replace(/^data:/, ""), ...at(e.box), sizing: { type: e.fit === "contain" ? "contain" : "cover", w: inch(e.box.w), h: inch(e.box.h) } });
      else if (e.type === "chart") addChart(pres, slide, e, theme);
      else if (e.type === "table") addTable(slide, e, theme);
    }
    if (deck.slides[i].notes) slide.addNotes(deck.slides[i].notes);
  });
  return Buffer.from(await pres.write({ outputType: "nodebuffer" }));
}
