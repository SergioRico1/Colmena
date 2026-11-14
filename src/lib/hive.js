// The honeycomb Colmena draws behind the home page's hero (site/src/home.js), shared by the app:
// the hosted onboarding's living hive (src/cloud/Hive.jsx) and the sidebar's corner of comb
// (src/components/v3/SidebarComb.jsx). Pure geometry: no DOM, no canvas.
//
// Cells are pointy-topped hexagons in offset rows (odd rows shifted half a cell), as on the site.

export const SQRT3 = Math.sqrt(3);

/** Column width and row height of a comb whose cells have circumradius `r`. */
export const pitch = (r) => ({ cw: SQRT3 * r, rh: 1.5 * r });

/** The six corners of a pointy-topped cell centred at (x, y): [[x, y], …]. */
export function hexCorners(x, y, r) {
  const h = (SQRT3 / 2) * r;
  return [[x, y - r], [x + h, y - r / 2], [x + h, y + r / 2], [x, y + r], [x - h, y + r / 2], [x - h, y - r / 2]];
}

/** An SVG path for one cell («M… Z»), rounded to tenths so it stays short. */
export function hexPath(x, y, r) {
  const f = (v) => Math.round(v * 10) / 10;
  return "M" + hexCorners(x, y, r).map(([a, b]) => f(a) + " " + f(b)).join("L") + "Z";
}

/**
 * The cells covering a `width` × `height` box, one ring past each edge so the comb bleeds:
 * [{c, r, x, y}], row by row. `r` is the circumradius.
 */
export function combCells(width, height, r) {
  const { cw, rh } = pitch(r);
  const cols = Math.ceil(width / cw) + 2, rows = Math.ceil(height / rh) + 2;
  const cells = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      cells.push({ c: col, r: row, x: (col - 0.5) * cw + (row & 1 ? cw / 2 : 0), y: (row - 0.5) * rh });
  return { cells, cols, rows };
}

/** The (up to six) neighbours of a cell in a comb laid out by combCells. */
export function neighbours(cells, cols, rows, cell) {
  const at = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? cells[r * cols + c] : null);
  const { c, r } = cell, o = r & 1;
  return [at(c - 1, r), at(c + 1, r), at(c - 1 + o, r - 1), at(c + o, r - 1), at(c - 1 + o, r + 1), at(c + o, r + 1)].filter(Boolean);
}

/** A small deterministic generator (mulberry32), so a still frame is the same on every load. */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seeded team every hosted company starts with (server/store.mjs SEEDS; docs/CLOUD.md › Bots
 * in channels), as the onboarding shows it before the company exists. Ids, names, roles, shapes
 * and colours are the store's own; `intro` is the one line each says when you meet it.
 */
export const SEEDED_TEAM = Object.freeze([
  { id: "atlas", name: "Atlas", role: "Coordinador", shape: "hex", color: "#12131A", intro: "Reparto el trabajo entre el equipo y te doy el resultado junto." },
  { id: "nora", name: "Nora", role: "Investigación", shape: "capsule", color: "#2F6BFF", intro: "Busco, contrasto y te digo de dónde sale cada dato." },
  { id: "tomas", name: "Tomás", role: "Datos y finanzas", shape: "square", color: "#0B8A5F", intro: "Hago cuentas, hojas de cálculo y compruebo las cifras." },
  { id: "iris", name: "Iris", role: "Diseño", shape: "diamond", color: "#FF5CA8", intro: "Propongo cómo se ve: presentaciones, páginas y marcas." },
  { id: "vera", name: "Vera", role: "Redacción", shape: "leaf", color: "#7B4DFF", intro: "Escribo correos, textos y documentos con tu tono." },
  { id: "bruno", name: "Bruno", role: "Código", shape: "arch", color: "#FF7A1A", intro: "Programo, reviso código y te explico lo que cambia." },
]);
