// The same document as native Word: real heading styles (navigation pane, index), lists,
// tables whose header repeats on every page, pictures, editable charts and page numbers.
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, ImageRun, LevelFormat, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType, PageBreak,
} from "docx";
import { ChartRun } from "docx/charts";
import { inlineRuns } from "../office/common.mjs";
import { numericColumns, toneColors } from "./html.mjs";
import { SERIES } from "../slides/html.mjs";

const FONT = "Segoe UI", HEADING = "Segoe UI Semibold";
// A4 with margins 22/20/24 mm, in twips; the line is 170 mm ≈ 642 px wide.
const PAGE = { width: 11906, height: 16838, margin: { top: 1247, right: 1134, bottom: 1361, left: 1134, footer: 567 } };
const LINE_PX = 642, LINE_TW = PAGE.width - PAGE.margin.left - PAGE.margin.right;
const pt = (n) => Math.round(n * 2); // half-points

function runs(text, base = {}) {
  return inlineRuns(text).flatMap((r) => {
    const lines = String(r.text).split("\n");
    const parts = lines.map((t, i) => new TextRun({ text: t, bold: r.bold || base.bold, italics: r.italic || base.italics, color: base.color, size: base.size, font: base.font, break: i ? 1 : undefined, ...(r.link ? { style: "Hyperlink" } : {}) }));
    return r.link ? [new ExternalHyperlink({ link: r.link, children: parts })] : parts;
  });
}

function table(b, theme) {
  const right = numericColumns(b.header, b.rows);
  const width = Math.floor(LINE_TW / b.header.length);
  const border = { style: BorderStyle.SINGLE, size: 4, color: theme.line };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const cell = (text, i, { head = false, zebra = false } = {}) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: theme.dark } : zebra ? { type: ShadingType.CLEAR, color: "auto", fill: theme.surface } : undefined,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    borders: { top: none, left: none, right: none, bottom: head ? none : border },
    children: [new Paragraph({
      alignment: right[i] ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 0, line: 264 },
      children: head ? [new TextRun({ text, font: HEADING, color: theme.onDark, size: pt(9.5) })] : runs(text, { size: pt(9.5) }),
    })],
  });
  return new Table({
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    width: { size: LINE_TW, type: WidthType.DXA }, columnWidths: b.header.map(() => width), layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: b.header.map((h, i) => cell(h, i, { head: true })) }),
      ...b.rows.map((r, k) => new TableRow({ cantSplit: true, children: b.header.map((_, i) => cell(r[i] ?? "", i, { zebra: k % 2 === 1 })) })),
    ],
  });
}

const caption = (text, theme) => text ? [new Paragraph({ spacing: { before: 80, after: 220 }, children: [new TextRun({ text, size: pt(9), color: theme.muted })] })] : [];

function chart(b, theme) {
  const c = b.chart, colors = SERIES(theme);
  const font = { name: FONT, size: 9, color: theme.muted };
  const pie = c.type === "pie" || c.type === "doughnut";
  const common = {
    transformation: { width: LINE_PX, height: Math.round(LINE_PX * 0.48) },
    font: { name: FONT, color: theme.ink },
    chartArea: { border: "none" },
    legend: pie || c.series.length > 1 ? { position: pie ? "right" : "top", font } : false,
    categories: c.labels,
    altText: { name: b.caption || "Gráfico", description: b.caption || c.series.map((s) => s.name).join(", ") },
  };
  const options = pie
    ? { ...common, type: c.type, series: [{ name: c.series[0].name || "Serie", values: c.series[0].values.map((v) => Math.max(0, v)), colors: c.labels.map((_, i) => [theme.accent, theme.accent2, theme.ink, theme.muted, theme.line, "9AA0AE"][i % 6]) }], dataLabels: { percentage: true } }
    : {
      ...common, type: c.type,
      series: c.series.map((s, k) => ({ name: s.name || (c.series.length > 1 ? `Serie ${k + 1}` : c.unit || "Valor"), values: s.values, color: colors[k % colors.length] })),
      categoryAxis: { font }, valueAxis: { font, ...(c.unit ? { title: c.unit } : {}) },
    };
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: b.caption ? 0 : 220 }, keepNext: !!b.caption, children: [new ChartRun(options)] });
}

function image(b, theme, images) {
  const img = images[b.image];
  const w = Math.round(b.width === "half" ? LINE_PX / 2 : Math.min(LINE_PX, img.width));
  const h = Math.round((w * img.height) / img.width);
  return new Paragraph({
    spacing: { before: 120, after: b.caption ? 0 : 220 }, keepNext: !!b.caption,
    children: [new ImageRun({ type: img.type, data: img.bytes, transformation: { width: w, height: h }, altText: { name: b.caption || "Imagen", description: b.caption || b.image, title: b.caption || "Imagen" } })],
  });
}

function blocks(doc, theme, images) {
  const tones = toneColors(theme);
  const out = [];
  doc.blocks.forEach((b, n) => {
    switch (b.type) {
      case "heading": out.push(new Paragraph({ heading: `Heading${b.level}`, children: [new TextRun(b.text)] })); break;
      case "paragraph": for (const p of b.text.split(/\n{2,}/)) out.push(new Paragraph({ children: runs(p) })); break;
      case "bullets": for (const i of b.items) out.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: runs(i) })); break;
      case "numbered": for (const i of b.items) out.push(new Paragraph({ numbering: { reference: "numbers", level: 0, instance: n + 1 }, spacing: { after: 80 }, children: runs(i) })); break;
      // Word needs a paragraph after a table; the caption is it, or an empty one.
      case "table": out.push(table(b, theme), ...(b.caption ? caption(b.caption, theme) : [new Paragraph({ spacing: { after: 120 }, children: [] })])); break;
      case "image": out.push(image(b, theme, images), ...caption(b.caption, theme)); break;
      case "chart": out.push(chart(b, theme), ...caption(b.caption, theme)); break;
      case "quote": {
        // One paragraph (the author after a line break), so the bar on the left is one line.
        const author = b.author ? [new TextRun({ text: "— " + b.author, size: pt(9.5), color: theme.muted, break: 1 })] : [];
        out.push(new Paragraph({ indent: { left: 280 }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: theme.accent, space: 10 } }, spacing: { before: 120, after: 220 }, children: [...runs(b.text, { italics: true, size: pt(12.5) }), ...author] }));
        break;
      }
      case "callout": {
        // A one-cell table: Word draws its left bar and its background as one block (a shaded
        // paragraph breaks the bar between lines).
        const c = tones[b.tone];
        const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
        const title = b.title ? [new Paragraph({ keepNext: true, spacing: { after: 40 }, children: [new TextRun({ text: b.title, font: HEADING, color: c.ink })] })] : [];
        out.push(new Table({
          width: { size: LINE_TW, type: WidthType.DXA }, columnWidths: [LINE_TW], layout: TableLayoutType.FIXED,
          borders: { top: none, bottom: none, right: none, insideHorizontal: none, insideVertical: none, left: { style: BorderStyle.SINGLE, size: 28, color: c.ink } },
          rows: [new TableRow({ cantSplit: true, children: [new TableCell({
            width: { size: LINE_TW, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: "auto", fill: c.bg },
            margins: { top: 140, bottom: 140, left: 220, right: 200 },
            borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 28, color: c.ink } },
            children: [...title, new Paragraph({ spacing: { after: 0 }, children: runs(b.text) })],
          })] })],
        }), new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case "page_break": out.push(new Paragraph({ children: [new PageBreak()] })); break;
    }
  });
  return out;
}

function titleBlock(doc, theme) {
  if (doc.cover === "none") return [];
  const coverPage = doc.cover === "page";
  const meta = [doc.author, doc.date].filter(Boolean).join(" · ");
  const out = [];
  if (meta) out.push(new Paragraph({ spacing: { before: coverPage ? 3400 : 0, after: 120 }, children: [new TextRun({ text: meta.toUpperCase(), size: pt(9.5), color: theme.muted, characterSpacing: 12 })] }));
  out.push(new Paragraph({ heading: "Title", spacing: { before: !meta && coverPage ? 3400 : 0, after: doc.subtitle ? 120 : 240, line: 264 }, children: [new TextRun({ text: doc.title, size: pt(coverPage ? 32 : 26) })] }));
  if (doc.subtitle) out.push(new Paragraph({ heading: "Subtitle", spacing: { after: 240 }, children: [new TextRun(doc.subtitle)] }));
  // The short accent rule under the title: the bottom border of a paragraph 64 px wide.
  out.push(new Paragraph({ indent: { right: LINE_TW - 960 }, border: { bottom: { style: BorderStyle.SINGLE, size: 32, color: theme.accent, space: 1 } }, spacing: { after: 420 }, children: [new TextRun({ text: "", size: 4 })] }));
  if (coverPage) out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

/** The .docx bytes of a validated document. `images`: path → {bytes, type, width, height}. */
export async function documentDocx(doc, theme, images = {}) {
  const heading = (id, name, size, extra = {}) => ({
    id, name, basedOn: "Normal", next: "Normal", quickFormat: true,
    run: { font: HEADING, size: pt(size), color: extra.color || theme.ink },
    paragraph: { keepNext: true, keepLines: true, spacing: { before: extra.before ?? 360, after: extra.after ?? 140 }, outlineLevel: extra.outline, ...(extra.border ? { border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: theme.accent, space: 4 } } } : {}) },
  });
  const document = new Document({
    creator: "Colmena", title: doc.title, description: doc.subtitle || undefined, lastModifiedBy: "Colmena",
    styles: {
      default: {
        document: { run: { font: FONT, size: pt(11), color: theme.ink }, paragraph: { spacing: { after: 160, line: 300 } } },
        title: { run: { font: HEADING, size: pt(26), color: theme.ink } },
      },
      paragraphStyles: [
        heading("Heading1", "Heading 1", 19, { before: 400, after: 180, outline: 0, border: true }),
        heading("Heading2", "Heading 2", 14, { before: 320, after: 120, outline: 1 }),
        heading("Heading3", "Heading 3", 11.5, { before: 240, after: 80, outline: 2, color: theme.accent }),
        { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", run: { font: FONT, size: pt(13), color: theme.muted } },
      ],
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: theme.accent, underline: { type: "single" } } }],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { run: { color: theme.accent }, paragraph: { indent: { left: 440, hanging: 280 } } } }] },
        { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { run: { color: theme.accent, font: HEADING }, paragraph: { indent: { left: 440, hanging: 320 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin } },
      footers: {
        default: new Footer({ children: [new Paragraph({
          tabStops: [{ type: "right", position: LINE_TW }],
          children: [new TextRun({ text: doc.title.slice(0, 90), size: pt(8), color: theme.muted }), new TextRun({ children: ["\t", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], size: pt(8), color: theme.muted })],
        })] }),
      },
      children: [...titleBlock(doc, theme), ...blocks(doc, theme, images)],
    }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
