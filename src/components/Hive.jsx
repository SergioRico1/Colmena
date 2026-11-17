import { memo, useId, useMemo } from "react";
import { combCells, hexPath, pitch, seeded } from "../lib/hive.js";
export { bumpPulse } from "../lib/hive.js";
import BotFace from "./BotFace.jsx";

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

/**
 * A conversation's last 24 hours as a little comb (server/cloud/chat.mjs › pulse): twelve cells
 * of two hours, oldest at the left of the top row; the busier, the fuller. The newest cell has a
 * ring. In the accent's ink (never honey).
 */
export const PulseComb = memo(function PulseComb({ pulse, className = "" }) {
  if (!pulse?.counts?.length) return null;
  const R = 5.2, { cw, rh } = pitch(R);
  const max = Math.max(1, ...pulse.counts);
  const total = pulse.counts.reduce((a, b) => a + b, 0);
  const busiest = pulse.counts.indexOf(Math.max(...pulse.counts));
  const hour = (i) => new Date(pulse.from + i * 7200000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const label = total ? `Últimas 24 horas: ${total} ${total === 1 ? "mensaje" : "mensajes"} · lo más movido, de ${hour(busiest)} a ${hour(busiest + 1)}` : "Sin mensajes en las últimas 24 horas";
  const W = cw * 6.5 + 2, H = rh + R * 2 + 2;
  return (
    <svg className={"hv-pulse " + className} role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} width={W * 2} height={H * 2}>
      <title>{label}</title>
      {pulse.counts.map((n, i) => {
        const row = i < 6 ? 0 : 1, col = i % 6;
        const x = 1 + cw / 2 + col * cw + (row ? cw / 2 : 0), y = 1 + R + row * rh;
        const level = n ? 0.22 + 0.78 * (n / max) : 0;
        return (
          <path key={i} d={hexPath(x, y, R - 0.6)} fill="var(--c-accent)" fillOpacity={level} stroke={i === 11 ? "var(--c-accent-ink)" : "var(--c-text)"} strokeOpacity={i === 11 ? 0.9 : 0.16} strokeWidth={i === 11 ? 0.9 : 0.6} />
        );
      })}
    </svg>
  );
});

/**
 * The picture of an empty list: one of Colmena's pixel bots, blinking, on a few comb cells. The
 * same `seed` (the list's title) gives the same bot.
 */
export const EmptyArt = memo(function EmptyArt({ seed = "" }) {
  const PALETTE = ["#6E48F0", "#2F6BFF", "#16895A", "#D23F86", "#0E8FA8", "#E0510C"];
  const SHAPES = ["hex", "capsule", "square", "diamond", "leaf", "arch"];
  const h = hash(seed);
  const bot = { id: "empty-" + (h % 97), name: "Colmena", color: PALETTE[h % PALETTE.length], shape: SHAPES[(h >> 3) % SHAPES.length] };
  const R = 15, { cw, rh } = pitch(R);
  const cells = [[0, 1], [1, 1], [2, 1], [0.5, 0], [1.5, 0]].map(([c, r]) => hexPath(18 + c * cw, 18 + r * rh, R - 1.5)).join("");
  return (
    <div className="hv-empty" aria-hidden="true">
      <svg className="hv-empty-comb" viewBox={`0 0 ${36 + cw * 2} ${36 + rh}`} width={36 + cw * 2} height={36 + rh}><path d={cells} fill="none" stroke="var(--c-text)" strokeOpacity="0.12" strokeWidth="1.2" /></svg>
      <span className="hv-empty-bot"><BotFace bot={bot} size={48} decorative alive /></span>
    </div>
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
