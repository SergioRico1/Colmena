// Where everything goes on a 1280×720 slide (16:9, 96 px per inch: PowerPoint's 13.33×7.5 in).
// Both renderers draw these same boxes, so the PDF, the viewer and the .pptx match.
// Text is sized to fit its box (titles 36–44 pt, body 14–16 pt and up, margins ≥ 0.5 in):
// a box that still overflows at its smallest size is reported for the bot to shorten.

export const W = 1280, H = 720, M = 72;

const PALETTES = {
  colmena: { bg: "F7F5F0", ink: "12131A", muted: "5C606C", accent: "7B4DFF", accent2: "FFC93C", surface: "FFFFFF", dark: "12131A", onDark: "FFFFFF", line: "E4E1DA" },
  noche: { bg: "12131A", ink: "F4F4F6", muted: "A3A6B0", accent: "FFC93C", accent2: "7B4DFF", surface: "1E2029", dark: "0B0C10", onDark: "FFFFFF", line: "2C2F3A" },
  sobrio: { bg: "FFFFFF", ink: "1B2A41", muted: "5B6B82", accent: "2F6BFF", accent2: "0B8A5F", surface: "F2F5F9", dark: "1B2A41", onDark: "FFFFFF", line: "DCE3EC" },
  calido: { bg: "FFF8EE", ink: "2B1D12", muted: "7A6553", accent: "E2572B", accent2: "F2B134", surface: "FFFFFF", dark: "2B1D12", onDark: "FFF8EE", line: "EADCC8" },
};
export const FONTS = { heading: "Segoe UI Semibold", body: "Segoe UI" };

export function themeOf(deck) {
  const p = { ...(PALETTES[deck.theme] || PALETTES.colmena) };
  const accent = String(deck.accent || "").replace("#", "").toUpperCase();
  if (/^[0-9A-F]{6}$/.test(accent)) p.accent = accent;
  return p;
}

// Average glyph width of Segoe UI as a share of the font size (measured; a little generous).
const GLYPH = { heading: 0.56, body: 0.52 };
const px = (pt) => pt * 96 / 72;

/** Lines a paragraph takes at this size in a box this wide. */
function linesFor(textValue, sizePt, width, kind) {
  const perLine = Math.max(4, Math.floor(width / (px(sizePt) * GLYPH[kind])));
  return String(textValue).split("\n").reduce((n, part) => {
    let lines = 1, used = 0;
    for (const word of part.split(/\s+/).filter(Boolean)) {
      const len = word.length + (used ? 1 : 0);
      if (used + len > perLine && used) { lines++; used = word.length; } else used += len;
      // A word longer than the line is broken: it takes more lines.
      while (used > perLine) { lines++; used -= perLine; }
    }
    return n + lines;
  }, 0);
}

/** The largest size from max to min (pt) at which the paragraphs fit; overflow when none does. */
export function fit(paragraphs, box, { max, min, kind = "body", lineHeight = 1.25, gap = 0.45, oneLine = false }) {
  const list = paragraphs.filter((p) => String(p).trim());
  for (let size = max; size >= min; size -= 1) {
    const lines = list.reduce((n, p) => n + linesFor(p, size, box.w - (kind === "bullet" ? px(size) * 1.1 : 0), kind === "heading" ? "heading" : "body"), 0);
    // A figure («15.962,57 €») never breaks: it shrinks until it fits on one line.
    if (oneLine && lines > list.length) continue;
    const height = lines * px(size) * lineHeight + Math.max(0, list.length - 1) * px(size) * gap;
    if (height <= box.h) return { size, overflow: false };
  }
  return { size: min, overflow: true };
}

const text = (box, paragraphs, o) => {
  const { size, overflow } = fit(paragraphs, box, o);
  return { type: "text", box, paragraphs: paragraphs.filter((p) => String(p).trim()), size, overflow, oneLine: !!o.oneLine, bullets: !!o.bullets, bold: o.kind === "heading" || !!o.bold, color: o.color, align: o.align || "left", valign: o.valign || "top", font: o.kind === "heading" || o.bold ? "heading" : "body", lineHeight: o.lineHeight || 1.25, what: o.what };
};

/** Every element of one slide, with its box, in drawing order. */
export function slideElements(slide, index, count, theme, images = {}) {
  const els = [];
  const dark = ["cover", "section", "closing"].includes(slide.layout);
  const bg = slide.layout === "section" ? theme.accent : dark ? theme.dark : theme.bg;
  const ink = dark ? theme.onDark : theme.ink;
  const muted = dark ? theme.onDark : theme.muted;
  const title = (box, o = {}) => slide.title ? els.push(text(box, [slide.title], { max: 40, min: 28, kind: "heading", color: ink, lineHeight: 1.12, what: "el título", ...o })) : null;
  const image = images[slide.image];
  const standardTitle = () => title({ x: M, y: 54, w: W - 2 * M, h: 104 }, { valign: "bottom" });
  const body = { x: M, y: 186, w: W - 2 * M, h: 462 };

  switch (slide.layout) {
    case "cover":
    case "closing": {
      const textW = image ? 560 : W - 2 * M;
      if (image) els.push({ type: "image", box: { x: 680, y: 0, w: 600, h: H }, src: image, fit: "cover" });
      title({ x: M, y: 168, w: textW, h: 250 }, { max: slide.layout === "cover" ? 60 : 50, min: 34, valign: "bottom", lineHeight: 1.06 });
      els.push({ type: "shape", box: { x: M, y: 446, w: 56, h: 8 }, fill: theme.accent2, radius: 4 });
      if (slide.subtitle) els.push(text({ x: M, y: 478, w: textW, h: 150 }, [slide.subtitle], { max: 24, min: 16, color: muted, what: "el subtítulo" }));
      break;
    }
    case "section": {
      els.push(text({ x: M, y: 150, w: 400, h: 140 }, [String(index + 1).padStart(2, "0")], { max: 88, min: 60, kind: "heading", color: theme.accent2, lineHeight: 1 }));
      title({ x: M, y: 300, w: W - 2 * M, h: 210 }, { max: 54, min: 34, lineHeight: 1.08 });
      if (slide.subtitle) els.push(text({ x: M, y: 520, w: 900, h: 120 }, [slide.subtitle], { max: 22, min: 16, color: theme.onDark, what: "el subtítulo" }));
      break;
    }
    case "bullets": {
      standardTitle();
      const box = image ? { ...body, w: 640 } : body;
      els.push(text(box, slide.bullets, { max: 26, min: 16, bullets: true, kind: "bullet", color: ink, lineHeight: 1.3, what: "los puntos" }));
      if (image) els.push({ type: "image", box: { x: 760, y: 186, w: 448, h: 462 }, src: image, fit: "cover", radius: 18 });
      if (slide.subtitle && !image) els.push(text({ x: M, y: 652, w: W - 2 * M, h: 40 }, [slide.subtitle], { max: 14, min: 12, color: theme.muted }));
      break;
    }
    case "two_columns": {
      standardTitle();
      [slide.left, slide.right].forEach((col, i) => {
        const x = M + i * 580, w = 556;
        els.push({ type: "shape", box: { x, y: 186, w, h: 462 }, fill: theme.surface, radius: 22, stroke: theme.line });
        let y = 214;
        if (col?.heading) { els.push(text({ x: x + 32, y, w: w - 64, h: 70 }, [col.heading], { max: 26, min: 18, kind: "heading", color: theme.accent, what: "un encabezado" })); y += 84; }
        els.push(text({ x: x + 32, y, w: w - 64, h: 634 - y }, col?.bullets || [], { max: 22, min: 14, bullets: true, kind: "bullet", color: ink, lineHeight: 1.3, what: "una columna" }));
      });
      break;
    }
    case "stats": {
      standardTitle();
      const n = slide.stats.length, gap = 28, w = (W - 2 * M - gap * (n - 1)) / n;
      slide.stats.forEach((s, i) => {
        const x = M + i * (w + gap);
        els.push({ type: "shape", box: { x, y: 216, w, h: 380 }, fill: theme.surface, radius: 24, stroke: theme.line });
        els.push(text({ x: x + 28, y: 256, w: w - 56, h: 150 }, [s.value], { max: n > 2 ? 64 : 80, min: 28, kind: "heading", color: theme.accent, lineHeight: 1, oneLine: true, valign: "bottom", what: "una cifra" }));
        els.push(text({ x: x + 28, y: 420, w: w - 56, h: 150 }, [s.label], { max: 22, min: 14, color: ink, what: "la etiqueta de una cifra" }));
      });
      break;
    }
    case "quote": {
      els.push(text({ x: M, y: 70, w: 200, h: 160 }, ["“"], { max: 160, min: 120, kind: "heading", color: theme.accent, lineHeight: 1 }));
      els.push(text({ x: M + 40, y: 200, w: W - 2 * M - 80, h: 300 }, [slide.quote], { max: 40, min: 24, kind: "heading", color: theme.ink, lineHeight: 1.22, what: "la cita" }));
      if (slide.author) els.push(text({ x: M + 40, y: 530, w: W - 2 * M - 80, h: 60 }, ["— " + slide.author], { max: 22, min: 16, color: theme.muted }));
      break;
    }
    case "image": {
      if (slide.title) standardTitle();
      const top = slide.title ? 186 : M, bottom = slide.caption ? 610 : 648;
      if (image) els.push({ type: "image", box: { x: M, y: top, w: W - 2 * M, h: bottom - top }, src: image, fit: "cover", radius: 20 });
      if (slide.caption) els.push(text({ x: M, y: 624, w: W - 2 * M, h: 50 }, [slide.caption], { max: 18, min: 13, color: theme.muted }));
      break;
    }
    case "chart": {
      standardTitle();
      const side = slide.subtitle || slide.bullets.length;
      els.push({ type: "chart", box: { x: M, y: 186, w: side ? 760 : W - 2 * M, h: 462 }, chart: slide.chart });
      if (side) els.push(text({ x: 872, y: 206, w: 336, h: 430 }, slide.bullets.length ? slide.bullets : [slide.subtitle], { max: 24, min: 15, bullets: !!slide.bullets.length, kind: slide.bullets.length ? "bullet" : "body", color: ink, lineHeight: 1.3, what: "la explicación del gráfico" }));
      break;
    }
    case "table": {
      standardTitle();
      // Cells wrap; each row is as tall as its longest cell, and the size drops until it fits.
      const cols = slide.table.header.length, colW = (W - 2 * M) / cols - 36;
      const all = [slide.table.header, ...slide.table.rows];
      let size = all.length > 8 ? 14 : all.length > 6 ? 16 : 18, heights = [];
      for (; size >= 11; size--) {
        heights = all.map((r) => Math.max(...slide.table.header.map((_, i) => linesFor(r[i] ?? "", size, colW, "body"))) * px(size) * 1.3 + px(size) * 1.1);
        heights = heights.map((h) => Math.max(h, Math.min(64, 462 / all.length)));
        if (heights.reduce((a, h) => a + h, 0) <= 462) break;
      }
      const total = heights.reduce((a, h) => a + h, 0);
      els.push({ type: "table", box: { x: M, y: 186, w: W - 2 * M, h: total }, header: slide.table.header, rows: slide.table.rows, size: Math.max(11, size), heights, overflow: total > 462 + 1, what: "la tabla" });
      break;
    }
  }
  if (!dark) els.push(text({ x: W - M - 120, y: H - 44, w: 120, h: 24 }, [String(index + 1) + " / " + count], { max: 11, min: 11, color: theme.muted, align: "right" }));
  return { bg, elements: els };
}

/** «Diapositiva 3: el texto de los puntos no cabe» for every box that overflows at its smallest size. */
export function layoutWarnings(slides) {
  return slides.flatMap((s, i) => s.elements.filter((e) => (e.type === "text" || e.type === "table") && e.overflow && e.what)
    .map((e) => `Diapositiva ${i + 1}: ${e.what} no cabe; recórtalo o reparte el contenido en dos diapositivas.`));
}
