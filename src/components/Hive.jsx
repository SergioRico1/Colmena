import { memo, useId, useMemo } from "react";
import { combCells, hexPath, pitch, seeded } from "../lib/hive.js";

// Colmena's two textures in one place: the honeycomb (lib/hive.js, the sidebar's comb) and the
// pixels its bots are made of (lib/pixelBot.js). Decorative only: aria-hidden, no motion, no
// honey (honey means «te necesita»). Colours come from whoever they decorate.
//
//   <PixelBanner color={bot.color} seed={bot.id} />   a card's banner: pixels that settle into a comb
//   <HexField className="…" />                        a quiet comb that fades from a corner

const hash = (s) => { let h = 2166136261; for (const ch of String(s || "colmena")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/**
 * A banner in `color`: a dither of pixels, denser towards the right, that turns into a few
 * honeycomb cells there. The same `seed` draws the same banner on every load.
 */
export const PixelBanner = memo(function PixelBanner({ color = "#6b7cff", seed = "", height = 88, className = "", style = null }) {
  const id = useId().replace(/:/g, "");
  const W = 320, P = 8;
  const { pixels, cells } = useMemo(() => {
    const rnd = seeded(hash(seed));
    const cols = W / P, rows = Math.ceil(height / P);
    const pixels = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        // Denser to the right and to the bottom; a little noise so it never looks like a gradient.
        const p = Math.pow(x / cols, 1.6) * 0.75 + (y / rows) * 0.18 - 0.08;
        const r = rnd();
        if (r < p) pixels.push({ x: x * P, y: y * P, o: r < p * 0.45 ? 0.32 : 0.16 });
      }
    // The comb on the right: the pixels give way to a few cells.
    const R = 13, { cw, rh } = pitch(R);
    const cells = [];
    for (let row = 0; row < Math.ceil(height / rh) + 1; row++)
      for (let c = 0; c < 4; c++) {
        const x = W - (c + 0.5) * cw - (row & 1 ? cw / 2 : 0), y = row * rh;
        if (rnd() < 0.82 - c * 0.18) cells.push(hexPath(x, y, R - 1.5));
      }
    return { pixels, cells };
  }, [seed, height]);
  return (
    <svg className={"hv-banner " + className} style={style} aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="xMidYMid slice" width="100%" height={height}>
      <defs>
        <linearGradient id={"g" + id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.55" />
          <stop offset="1" stopColor={color} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width={W} height={height} fill="var(--c-card)" />
      <rect width={W} height={height} fill={`url(#g${id})`} />
      <g fill="#fff" shapeRendering="crispEdges">{pixels.map((p, i) => <rect key={i} x={p.x} y={p.y} width={P} height={P} opacity={p.o} />)}</g>
      <path d={cells.join("")} fill="none" stroke="#fff" strokeOpacity="0.38" strokeWidth="1.5" />
    </svg>
  );
});

/** A hairline honeycomb in the ink colour, fading out from the top right corner. */
export const HexField = memo(function HexField({ width = 360, height = 140, r = 14, className = "", style = null }) {
  const id = useId().replace(/:/g, "");
  const d = useMemo(() => combCells(width, height, r).cells.map((c) => hexPath(c.x, c.y, r - 1)).join(""), [width, height, r]);
  return (
    <svg className={"hv-field " + className} style={style} aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      <defs>
        <radialGradient id={"f" + id} cx="1" cy="0" r="1.1">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={"m" + id}><rect width={width} height={height} fill={`url(#f${id})`} /></mask>
      </defs>
      <path d={d} fill="none" stroke="var(--c-text)" strokeOpacity="0.09" strokeWidth="1" mask={`url(#m${id})`} />
    </svg>
  );
});
