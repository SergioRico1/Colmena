// Colmena's pixel-art bots (Colmena 4, design/v4/colmena-v4.html › pixelBot). Pure: no DOM, no
// React; the same inputs always give the same drawing, so it is cached and testable in node.
//
//   pixelBotSpec({ shape, color, role, seed, size, mood, owner }) → { n, size, rects, spark, badge }
//   pixelBotSvg(...same, label) → an <svg> string (shape-rendering="crispEdges")
//
// - shape  hex | capsule | square | diamond | leaf | arch: the role's silhouette (lib/identity.js
//          botShape: a «circle» is the capsule, anything unknown a rounded square)
// - color  the bot's own colour (a tone of its person's family, server/bot-looks.mjs). A colour in
//          honey's band (hues 23°–72°) is moved out of it: honey only ever means «te necesita».
// - role   coordinador | investigacion | datos | diseno | redaccion | codigo, or anything else
//          (Legal, a role you wrote): no prop. roleKey() reads it from a bot.
// - seed   moves the dither phase and the specular pixel, so two bots never share texture
// - size   px; the grid is 10 cells up to 20 px, 12 up to 24 px and 16 above, and the drawing is
//          laid out in cells (viewBox 0 0 n n) so any size scales without blurring
// - mood   libre | trabajando | espera | pausa (moodOf() reads it from a bot's state)
// - owner  { initials, color } for someone else's bot: a round chip in the corner (circles are
//          people). Your own bots carry none.
//
// Every bot: a dark visor shaped as the Colmena mark's cell, eyes in a light tint of its own
// colour, a one-cell outline, a light rim top-left, shadow and checker dither bottom-right.

import { botA11yName, botShape, initialsOf } from "./identity.js";

/* ── colour helpers ── */
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r) => "#" + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
export function hsl(hex) {
  const [r, g, b] = hex2rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return [h, s, l];
}
function fromHsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb2hex([r, g, b].map((v) => (v + m) * 255));
}
/** Honey and amber, never a bot's colour: hues 25°–70° (PRODUCT.md › Brand Commitments). */
export const HONEY_BAND = [25, 70];
/** True for a saturated, light colour in honey's band (the test the pixels must pass). */
export function inHoneyBand(hex) {
  const [h, s, l] = hsl(hex);
  return s >= 0.35 && l >= 0.3 && l <= 0.85 && h >= HONEY_BAND[0] && h <= HONEY_BAND[1];
}
// A bot's own colour keeps a few degrees from the band, so its lighter and greyer tones (which
// drift a little in hue when mixed) never fall into it.
const MARGIN = [20, 75];
const outOfHoney = (h) => { const x = ((h % 360) + 360) % 360; return x > MARGIN[0] && x < MARGIN[1] ? (x - MARGIN[0] < MARGIN[1] - x ? MARGIN[0] - 2 : MARGIN[1] + 2) : x; };
const safeColor = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#5B6680";
  const c = "#" + m[1].toUpperCase();
  const [h, s, l] = hsl(c);
  if (s < 0.2 || outOfHoney(h) === h) return c;
  return fromHsl(outOfHoney(h), s, l);
};

/* ── silhouettes: (u, v) in [-1, 1]², true inside ── */
export const SHAPES = Object.freeze({
  // The Colmena mark: flat top and bottom, pointed sides.
  hex: (u, v) => Math.abs(v) <= 0.98 && Math.abs(u) <= 1.06 - 0.52 * Math.abs(v),
  // Investigación: an upright capsule, two thirds as wide as tall (circles are people).
  capsule: (u, v) => u * u + Math.max(Math.abs(v) - 0.36, 0) ** 2 <= 0.64 ** 2 * 1.04,
  square: (u, v) => u ** 4 + v ** 4 <= 1,
  diamond: (u, v) => Math.abs(u) ** 1.4 + Math.abs(v) ** 1.4 <= 1.02,
  leaf: (u, v) => { const s = (u - v) / Math.SQRT2, t = (u + v) / Math.SQRT2; return (Math.abs(t) + 0.3) ** 2 + s * s <= 1.69; },
  // Código: a doorway arch, round top on straight sides with an opening between the feet, so it
  // never reads as the rounded square at 24 px.
  arch: (u, v) => (v < 0 ? u * u + v * v <= 1.02 : Math.abs(u) <= 0.98 && !(v > 0.76 && Math.abs(u) < 0.3)),
});
const shapeKey = (shape) => (shape === "circle" ? "capsule" : SHAPES[shape] ? shape : "square");

// Grid geometry per resolution: body box [x0,x1)×[y0,y1) and the visor rows/cols (inclusive).
const GRID = {
  10: { box: [0, 10, 1, 10], plate: [2, 7, 3, 5] },
  12: { box: [0, 12, 2, 12], plate: [2, 9, 4, 7] },
  16: { box: [1, 15, 3, 16], plate: [3, 12, 6, 10] },
};
// Faces: cells in eye tint, in white highlight, and dimmed (closed eyes). Absolute coordinates.
const FACES = {
  16: {
    libre: { eye: [[5, 7], [4, 8], [6, 8], [10, 7], [9, 8], [11, 8], [7, 10], [8, 10]] },
    trabajando: { eye: [[4, 8], [5, 8], [6, 8], [9, 8], [10, 8], [11, 8], [7, 10], [8, 10]] },
    espera: { eye: [[5, 6], [6, 6], [5, 7], [6, 7], [9, 6], [10, 6], [9, 7], [10, 7], [7, 9], [8, 9]], hi: [[5, 6], [9, 6]] },
    pausa: { dim: [[4, 9], [5, 9], [6, 9], [9, 9], [10, 9], [11, 9]] },
  },
  12: {
    libre: { eye: [[3, 5], [2, 6], [4, 6], [8, 5], [7, 6], [9, 6]] },
    trabajando: { eye: [[3, 6], [4, 6], [7, 6], [8, 6]] },
    espera: { eye: [[3, 4], [4, 4], [3, 5], [4, 5], [7, 4], [8, 4], [7, 5], [8, 5], [5, 7], [6, 7]], hi: [[3, 4], [7, 4]] },
    pausa: { dim: [[3, 6], [4, 6], [7, 6], [8, 6]] },
  },
  10: {
    libre: { eye: [[3, 4], [6, 4], [3, 3], [6, 3]] },
    trabajando: { eye: [[2, 4], [3, 4], [6, 4], [7, 4]] },
    espera: { eye: [[3, 3], [6, 3]], hi: [] },
    pausa: { dim: [[3, 5], [6, 5]] },
  },
};
// Props: `off` cells only where the body is not; `on` cells paint over the body.
// Kinds: eye (light tint) · hi (white) · deep (outline tone) · paint (the design drop) · rim/base/shade.
const PROPS = {
  coordinador: { // bee antennae with light knobs: the one who shares out the work of the hive
    16: { off: [["shade", [6, 2], [5, 1], [9, 2], [10, 1]], ["base", [4, 0], [11, 0], [4, 1], [11, 1]]] },
    12: { off: [["shade", [4, 1], [7, 1]], ["base", [3, 0], [8, 0]]] },
    10: { off: [["base", [3, 0], [6, 0]]] },
  },
  investigacion: { // a magnifier held up top-right, glass glinting
    16: { off: [["base", [12, 0], [13, 0], [11, 1], [14, 1], [11, 2], [14, 2], [12, 3], [13, 3]], ["eye", [12, 1], [13, 1], [12, 2]], ["hi", [13, 2]], ["shade", [10, 4], [9, 5]]] },
    12: { off: [["base", [9, 0], [10, 0], [11, 0], [9, 1], [11, 1], [9, 2], [10, 2], [11, 2]], ["eye", [10, 1]], ["shade", [8, 3]]] },
    10: { off: [["base", [7, 0], [8, 0], [9, 0], [7, 1], [9, 1], [8, 2]], ["eye", [8, 1]]] },
  },
  datos: { // a rising bar chart on the belly
    16: { on: [["eye", [6, 13], [8, 12], [8, 13], [10, 11], [10, 12], [10, 13]]] },
    12: { on: [["eye", [4, 10], [6, 9], [6, 10], [8, 8], [8, 9], [8, 10]]] },
    10: { on: [["eye", [3, 8], [5, 7], [5, 8], [7, 6], [7, 7], [7, 8]]] },
  },
  diseno: { // a drop of paint landing on the top vertex
    16: { off: [["paint", [8, 0], [7, 1], [8, 1], [7, 2], [8, 2]], ["hi", [7, 1]]], on: [["paint", [7, 3], [8, 3], [8, 4]]] },
    12: { off: [["paint", [6, 0], [5, 1], [6, 1]], ["hi", [5, 1]]], on: [["paint", [5, 2], [6, 2], [6, 3]]] },
    10: { off: [["paint", [4, 0], [5, 0]]], on: [["paint", [4, 1], [5, 1]]] },
  },
  redaccion: { // a quill tucked behind the leaf's tip, nib down
    16: { off: [["rim", [15, 0], [14, 0], [15, 1]], ["base", [13, 1], [14, 1], [14, 2], [13, 2]], ["shade", [12, 3]], ["deep", [11, 4]]] },
    12: { off: [["base", [11, 0], [10, 0], [11, 1], [10, 1]], ["shade", [9, 2]], ["deep", [8, 3]]] },
    10: { off: [["base", [9, 0], [8, 0], [9, 1], [8, 1]]] },
  },
  codigo: { // ‹ › on the chest
    16: { on: [["eye", [6, 11], [5, 12], [6, 13], [9, 11], [10, 12], [9, 13]]] },
    12: { on: [["eye", [4, 8], [3, 9], [4, 10], [7, 8], [8, 9], [7, 10]]] },
    10: { on: [["eye", [3, 6], [2, 7], [3, 8], [6, 6], [7, 7], [6, 8]]] },
  },
};
export const ROLES = Object.freeze(Object.keys(PROPS));
// Top-left marks: a twinkle while working; a «z» while paused, only from 32 px (16 cells) up:
// smaller, three cells read as «I», so the closed eyes and the dimmed body say it alone.
const MOOD_MARKS = {
  trabajando: { 16: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 12: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 10: [[0, 0], [1, 1]] },
  pausa: { 16: [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1], [1, 2], [0, 3], [1, 3], [2, 3], [3, 3]] },
};
export const MOODS = Object.freeze(["libre", "trabajando", "espera", "pausa"]);

/**
 * The design drop: the bot's complementary hue, kept out of honey and amber with a margin
 * (18°–95°: a lime drop on a small bot still reads yellow).
 */
export function paintOf(hex) {
  const [h] = hsl(safeColor(hex));
  const x = (((h + 180) % 360) + 360) % 360;
  return fromHsl(x > 18 && x < 95 ? (x - 18 < 95 - x ? 12 : 100) : x, 0.8, 0.58);
}
function tones(hex, mood) {
  const own = safeColor(hex);
  const base = mood === "pausa" ? mix(own, "#8C8F99", 0.4) : own;
  return {
    rim: mix(base, "#FFFFFF", 0.36), base, shade: mix(base, "#0B0C12", 0.24), deep: mix(base, "#0B0C12", 0.6),
    spec: mix(base, "#FFFFFF", 0.62), plate: mix(own, "#0D0E14", 0.84), eye: mix(own, "#FFFFFF", 0.84), hi: "#FFFFFF",
    dim: mix(own, "#FFFFFF", 0.45), paint: paintOf(own), spark: base, zz: base,
  };
}

export const gridFor = (size) => (size <= 20 ? 10 : size <= 24 ? 12 : 16);

function draw({ shape, color, role, seed, mood, n }) {
  const G = GRID[n], T = tones(color, mood), inside = SHAPES[shapeKey(shape)];
  const [x0, x1, y0, y1] = G.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  const grid = Array.from({ length: n }, () => Array(n).fill(null));
  for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) if (inside((i + 0.5 - cx) / hw, (j + 0.5 - cy) / hh)) grid[j][i] = "base";
  const isBody = grid.map((r) => r.map((v) => v !== null));
  const B = (i, j) => i >= 0 && j >= 0 && i < n && j < n && isBody[j][i];
  const edge = (i, j) => !B(i - 1, j) || !B(i + 1, j) || !B(i, j - 1) || !B(i, j + 1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!isBody[j][i]) continue;
    if (edge(i, j)) { grid[j][i] = "deep"; continue; }
    const up = edge(i, j - 1) || edge(i - 1, j), down = edge(i, j + 1) || edge(i + 1, j);
    if (up && !down) grid[j][i] = "rim";
    else if (down) grid[j][i] = "shade";
    else if ((j - cy) / hh > 0.42 && (i + j + seed) % 2 === 0) grid[j][i] = "shade";
  }
  // Specular: the first base cell under the rim from the top-left, nudged by the seed.
  outer: for (let j = y0 + 1; j < y1; j++) for (let i = x0 + 1 + (seed % 2); i < x1; i++) if (grid[j][i] === "base" && grid[j - 1][i] === "rim") { grid[j][i] = "spec"; break outer; }
  // Visor: the flat hexagon cell, kept inside the outline.
  const [px0, px1, py0, py1] = G.plate;
  for (let j = py0; j <= py1; j++) for (let i = px0; i <= px1; i++) {
    const h = py1 - py0 + 1, d = Math.abs(j - (py0 + py1) / 2), k = h >= 5 ? Math.round(d) : d >= (h - 1) / 2 ? 1 : 0;
    if (!(i < px0 + k || i > px1 - k) && isBody[j][i] && !edge(i, j)) grid[j][i] = "plate";
  }
  const put = (kind, [i, j], onlyEmpty) => { if (i < 0 || j < 0 || i >= n || j >= n) return; if (onlyEmpty && isBody[j][i]) return; grid[j][i] = kind; };
  const F = FACES[n][mood] || FACES[n].libre;
  for (const k of ["eye", "dim", "hi"]) (F[k] || []).forEach((p) => isBody[p[1]][p[0]] && put(k, p));
  const P = PROPS[role]?.[n];
  if (P) {
    (P.off || []).forEach(([k, ...cells]) => cells.forEach((p) => put(k, p, true)));
    (P.on || []).forEach(([k, ...cells]) => cells.forEach((p) => put(k, p, false)));
  }
  const kind = mood === "trabajando" ? "spark" : "zz";
  (MOOD_MARKS[mood]?.[n] || []).forEach((p) => { if (!isBody[p[1]][p[0]] && !grid[p[1]][p[0]]) grid[p[1]][p[0]] = kind; });
  // Runs of one colour per row → rects.
  const rects = [], spark = [];
  for (let j = 0; j < n; j++) {
    let i = 0;
    while (i < n) {
      const k = grid[j][i];
      if (!k) { i++; continue; }
      let e = i;
      while (e + 1 < n && grid[j][e + 1] === k) e++;
      (k === "spark" ? spark : rects).push({ x: i, y: j, w: e - i + 1, fill: T[k] });
      i = e + 1;
    }
  }
  return { rects, spark };
}

const cache = new Map();
const CACHE_MAX = 600;
/**
 * The drawing for these inputs, in cells (viewBox 0 0 n n): `rects` [{x, y, w, fill}] (one cell
 * tall), `spark` (the working twinkle, drawn in its own group), `badge` {cx, cy, r, ring, color,
 * text, fontSize} in cells, or null. Cached.
 */
export function pixelBotSpec({ shape = "hex", color = "#6E48F0", role = null, seed = 0, size = 32, mood = "libre", owner = null } = {}) {
  const n = gridFor(size);
  const m = MOODS.includes(mood) ? mood : "libre";
  const r = ROLES.includes(role) ? role : null;
  const s = Math.abs(Math.trunc(Number(seed) || 0));
  const key = [shapeKey(shape), color, r, s % 2, s % 7, m, n, size, owner ? owner.initials + owner.color : ""].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  const { rects, spark } = draw({ shape, color, role: r, seed: s, mood: m, n });
  const c = size / n; // px per cell
  let badge = null;
  if (owner) {
    const rpx = Math.max(4.5, size * 0.21);
    const text = 2 * rpx >= 17 ? (2 * rpx < 22 ? String(owner.initials || "").slice(0, 1) : String(owner.initials || "").slice(0, 2)) : "";
    badge = { cx: (size - rpx + size * 0.04) / c, cy: (size - rpx + size * 0.04) / c, r: rpx / c, ring: Math.max(1.5, size * 0.045) / c, color: safeColor(owner.color), text, fontSize: Math.max(11, Math.round(rpx * 0.95)) / c };
  }
  const spec = Object.freeze({ n, size, rects, spark, badge });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, spec);
  return spec;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
/** The bot as an <svg> string: role="img" with `label`, or hidden from screen readers without one. */
export function pixelBotSvg(opts = {}, label = "") {
  const spec = pixelBotSpec(opts);
  const rect = (r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.fill}"/>`;
  let body = spec.rects.map(rect).join("");
  if (spec.spark.length) body += `<g class="pb-spark">${spec.spark.map(rect).join("")}</g>`;
  const b = spec.badge;
  if (b) body += `<g shape-rendering="geometricPrecision"><circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="${b.color}" stroke="var(--c-cut,#fff)" stroke-width="${b.ring}"/>${b.text ? `<text x="${b.cx}" y="${b.cy}" dy=".36em" text-anchor="middle" font-family="Geist,sans-serif" font-weight="700" font-size="${b.fontSize}" fill="#FFFFFF">${esc(b.text)}</text>` : ""}</g>`;
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ` aria-hidden="true"`;
  return `<svg width="${spec.size}" height="${spec.size}" viewBox="0 0 ${spec.n} ${spec.n}" shape-rendering="crispEdges" overflow="visible"${a11y}>${body}</svg>`;
}

/**
 * Everything BotFace draws for a bot: { spec, label }. `owner` ({name, color, you}) puts the round
 * chip on someone else's bot only; `label` is its accessible name («Vera, bot de Lucía»).
 */
export function botFaceSpec({ bot, size = 32, state = null, mood = null, owner = null } = {}) {
  const other = owner && !owner.you;
  const spec = pixelBotSpec({
    shape: botShape(bot?.shape), color: bot?.color, role: roleKey(bot), seed: seedOf(bot), size, mood: mood || moodOf(state, bot),
    owner: other ? { initials: initialsOf(owner.name), color: owner.color || "#5B6680" } : null,
  });
  return { spec, label: botA11yName(bot, owner) };
}

/* ── reading a bot ── */
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const BY_ID = { atlas: "coordinador", nora: "investigacion", tomas: "datos", iris: "diseno", vera: "redaccion", bruno: "codigo" };
/** The prop a bot wears, from its role (or a built-in bot's id); null for any other role. */
export function roleKey(bot) {
  const r = fold(bot?.role);
  if (/coordin/.test(r)) return "coordinador";
  if (/investig/.test(r)) return "investigacion";
  if (/datos|finanz|analis/.test(r)) return "datos";
  if (/disen/.test(r)) return "diseno";
  if (/redacc|escrit|textos/.test(r)) return "redaccion";
  if (/codigo|program|desarroll/.test(r)) return "codigo";
  return r ? null : BY_ID[bot?.id] || null;
}
/** The mood a bot's live state shows: rest | work | wait | pause (Presence.jsx) or its status. */
export function moodOf(state, bot = null) {
  if (state === "work" || state === "trabajando" || bot?.status === "trabaja") return "trabajando";
  if (state === "wait" || state === "espera" || bot?.status === "espera") return "espera";
  if (state === "pause" || state === "pausa" || bot?.status === "pausado" || bot?.enabled === false) return "pausa";
  return "libre";
}
/** A stable seed from a bot's id (the dither phase and the specular pixel). */
export const seedOf = (bot) => [...String(bot?.id || bot?.name || "")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
