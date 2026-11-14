// The living hive behind every hosted onboarding page (the home page's hero, site/src/home.js,
// redrawn in the app's tokens): a honeycomb that breathes, the team's pixel bots flying from cell
// to cell and lighting the cells they land on in their own colour. A clearing stays empty under
// the page's card. The pages speak to it with `hive(type)`:
//   type    a key was typed: a bot flies to the card's edge to look
//   gather  the bots come close and wait (the mail is on its way)
//   honey   the cell by the card glows honey: something waits for you
//   ok      a green wave runs out from the card (signed in, connected)
// `asleep` draws the bots resting on their cells with their eyes closed (no AI connected yet).
// Reduced motion draws one still frame. Nothing runs while the page is hidden; ~30 frames a
// second while it shows. Decorative: aria-hidden, no pointer events.
import { useEffect, useRef } from "react";
import { combCells, neighbours, seeded, SQRT3 } from "../lib/hive.js";
import { pixelBotSpec, roleKey, seedOf } from "../lib/pixelBot.js";

export const hive = (type) => { try { window.dispatchEvent(new CustomEvent("colmena:hive", { detail: type })); } catch {} };

const HONEY = "255,201,60";
const rgbOf = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); if (!m) return "91,102,128"; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(","); };
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One bot as a small canvas (its pixel drawing at `px` CSS pixels, sharp at this screen's density). */
function sprite(bot, px, mood, dpr) {
  const spec = pixelBotSpec({ shape: bot.shape, color: bot.color, role: roleKey(bot), seed: seedOf(bot), size: px, mood });
  const cv = document.createElement("canvas");
  const scale = Math.max(1, Math.round((px / spec.n) * dpr));
  cv.width = cv.height = spec.n * scale;
  const g = cv.getContext("2d");
  for (const r of [...spec.rects, ...spec.spark]) { g.fillStyle = r.fill; g.fillRect(r.x * scale, r.y * scale, r.w * scale, scale); }
  return cv;
}

export default function Hive({ bots = [], asleep = false, clear = null }) {
  const ref = useRef(null);
  const live = useRef({ bots, asleep });
  live.current = { bots, asleep };
  const key = bots.map((b) => b.id + b.color + b.shape).join("|") + (asleep ? ":z" : "");

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext?.("2d");
    if (!ctx) return undefined;
    const still = reduced();
    const team = live.current.bots;
    const sleeping = live.current.asleep;
    let R = 22, W = 0, H = 0, cells = [], cols = 0, rows = 0, flyers = [], hole = null, heart = { x: 0, y: 0 }, px = 32, ink = "18,19,26", dark = false, dpr = 1;
    let speed = 1, gather = false, core = null;
    const mark = new Image();
    mark.src = "/logo-mark-64.png";
    const rand = seeded(7);
    const theme = () => {
      const s = getComputedStyle(document.documentElement);
      ink = (s.getPropertyValue("--c-ink-rgb").trim() || "18 19 26").split(/\s+/).join(",");
      dark = document.documentElement.dataset.theme === "dark";
    };
    const sprites = new Map();
    const face = (b, mood) => {
      const k = b.id + mood;
      if (!sprites.has(k)) sprites.set(k, sprite(b, px, mood, dpr));
      return sprites.get(k);
    };
    // How strongly a cell shows: fullest at the hive's heart (where the bots live: beside the card
    // on a laptop, under or above it on a phone) and in a thin ring round the card, faint elsewhere.
    const weightAt = (x, y) => {
      if (hole && x > hole.l && x < hole.r && y > hole.t && y < hole.b) return 0;
      const ring = hole ? Math.max(0, 1 - Math.hypot(Math.max(hole.l - x, 0, x - hole.r), Math.max(hole.t - y, 0, y - hole.b)) / 150) : 0;
      const near = heart ? Math.max(0, 1 - Math.hypot(x - heart.x, y - heart.y) / (0.36 * Math.max(W, H))) : 0;
      return Math.max(0.1, ring * 0.7, near);
    };
    /** How far a cell is from the card's edge (0 on it). */
    const fromCard = (k) => (hole ? Math.hypot(Math.max(hole.l - k.x, 0, k.x - hole.r), Math.max(hole.t - k.y, 0, k.y - hole.b)) : Infinity);
    const findHeart = () => {
      if (!hole) return { x: W * 0.62, y: H * 0.48 };
      if (W - hole.r > 320) return { x: hole.r + (W - hole.r) * 0.5, y: H * 0.47 };
      // A phone: under the card when there is room, else above it, else nowhere (the bots wait
      // off the page and come back when scrolling makes room).
      const below = H - hole.b, above = hole.t - 70;
      if (below >= 170) return { x: W / 2, y: hole.b + Math.min(150, Math.max(80, below / 2 - 20)) };
      if (above >= 170) return { x: W / 2, y: 70 + above / 2 };
      return null;
    };
    // Where the card is now (it moves when the page scrolls): its clearing and the ring round it.
    const measure = () => {
      const box = clear?.current?.getBoundingClientRect?.();
      hole = box && box.width ? { l: box.left - R * 0.6, t: box.top - R * 0.6, r: box.right + R * 0.6, b: box.bottom + R * 0.6 } : null;
      heart = findHeart();
      for (const k of cells) k.w = weightAt(k.x, k.y);
      if (flyers.length || !heart) rehome();
    };
    const layout = () => {
      theme();
      dpr = Math.min(1.5, devicePixelRatio || 1);
      W = innerWidth; H = innerHeight; px = W < 640 ? 24 : 32; R = W >= 1280 ? 26 : 22;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ({ cells, cols, rows } = combCells(W, H, R));
      measure();
      for (const k of cells) { k.ph = rand() * 6.283; k.glow = 0; k.rgb = "255,255,255"; k.hold = 0; k.delay = 0; }
      sprites.clear();
      // The rosette: the cell at the heart holds the Colmena mark, the six round it are the team's
      // homes. The bots fly out from there and come back; asleep, they stay in it.
      flyers = team.slice(0, 6).map((b) => ({ b, home: null, rgb: rgbOf(b.color), from: null, to: null, t0: 0, dur: 1, wait: 600 + rand() * 2400 }));
      core = null;
      rehome();
    };
    // The rosette round the heart: when the heart moves to another cell (the card scrolled, the
    // step changed), the bots fly to their new homes; with no heart on screen they wait off it.
    const rehome = () => {
      const by = (p) => (a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y);
      const next = heart ? cells.filter((k) => k.w).sort(by(heart))[0] || null : null;
      if (next === core) return;
      for (const k of cells) k.home = false;
      core = next;
      if (!core) { for (const f of flyers) f.home = f.from = f.to = null; return; }
      const ring = neighbours(cells, cols, rows, core).filter((k) => k.w);
      const spare = cells.filter((k) => k.w > 0.5 && k !== core && !ring.includes(k)).sort(by(heart));
      const homes = [...ring, ...spare];
      flyers.forEach((f, i) => {
        const home = homes[i] || core;
        home.glow = sleeping ? 0.45 : 0.85; home.rgb = f.rgb; home.home = true;
        f.home = home;
        // Appearing (first time, or back on screen): already home. Otherwise they fly there.
        if (!f.to || sleeping) { f.from = f.to = home; f.t0 = 0; }
        else { f.from = f.to; f.to = home; f.t0 = performance.now(); f.dur = 700; f.wait = 800 + rand() * 1600; }
      });
    };
    const hexTrace = (x, y, r) => {
      const h = (SQRT3 / 2) * r;
      ctx.moveTo(x, y - r); ctx.lineTo(x + h, y - r / 2); ctx.lineTo(x + h, y + r / 2);
      ctx.lineTo(x, y + r); ctx.lineTo(x - h, y + r / 2); ctx.lineTo(x - h, y - r / 2); ctx.closePath();
    };
    const draw = (now) => {
      ctx.clearRect(0, 0, W, H);
      const t = now / 1000;
      // The comb: line strength in five steps, so it is five paths a frame.
      const buckets = [[], [], [], [], []];
      for (const k of cells) {
        if (!k.w) continue;
        const a = k.w * (still ? 0.8 : 0.6 + 0.4 * Math.sin(t * 0.45 + k.ph + k.x * 0.004));
        buckets[Math.min(4, (a * 5) | 0)].push(k);
      }
      ctx.lineWidth = 1;
      const base = dark ? 0.028 : 0.03, step = dark ? 0.03 : 0.034;
      buckets.forEach((list, i) => {
        if (!list.length) return;
        ctx.strokeStyle = `rgba(${ink},${base + i * step})`;
        ctx.beginPath();
        for (const k of list) hexTrace(k.x, k.y, R - 1.5);
        ctx.stroke();
      });
      // Lit cells.
      for (const k of cells) {
        if (k.glow <= 0.01 || !k.w || k.delay > now) continue;
        const g = k.glow * Math.max(0.4, k.w);
        ctx.beginPath(); hexTrace(k.x, k.y, R - 3);
        ctx.fillStyle = `rgba(${k.rgb},${(dark ? 0.2 : 0.14) * g})`; ctx.fill();
        ctx.strokeStyle = `rgba(${k.rgb},${(dark ? 0.7 : 0.55) * g})`; ctx.stroke();
      }
      // The mark at the heart of the rosette.
      if (core && mark.complete && mark.naturalWidth) {
        ctx.globalAlpha = sleeping ? 0.55 : 1;
        ctx.drawImage(mark, Math.round(core.x - 14), Math.round(core.y - 14), 28, 28);
        ctx.globalAlpha = 1;
      }
      // The bots.
      for (const f of flyers) {
        if (!f.to) continue;
        const k = still || sleeping ? 1 : Math.min(1, Math.max(0, (now - f.t0) / f.dur));
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const x = f.from.x + (f.to.x - f.from.x) * e;
        const y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(Math.PI * k) * 10;
        const img = face(f.b, sleeping ? "pausa" : k < 1 ? "trabajando" : "libre");
        ctx.drawImage(img, Math.round(x - px / 2), Math.round(y - px / 2), px, px);
      }
    };
    const step = (now, dt) => {
      for (const k of cells) if (k.delay <= now && k.hold <= now) k.glow = Math.max(sleeping ? 0.5 * (k.glow > 0.45 ? 1 : 0) : 0, k.glow - dt / 5200);
      if (sleeping) return;
      for (const f of flyers) {
        if (!f.to || now < f.t0 + f.dur + f.wait) continue;
        const land = f.to;
        if (f.from !== land) { land.glow = 1; land.rgb = f.rgb; land.delay = 0; }
        const inside = (n) => n.w && n !== core && n.y > 60 && n.y < H - 24 && n.x > 12 && n.x < W - 12;
        let next = land, away = false;
        if (gather) {
          // Gathered: each walks cell by cell to the card's edge and waits there.
          const options = neighbours(cells, cols, rows, land).filter(inside).sort((a, b) => fromCard(a) - fromCard(b));
          if (options[0] && fromCard(options[0]) < fromCard(land) && fromCard(land) > 40) next = options[0];
        } else if (land === f.home) {
          // Out on an errand: one or two cells beyond the rosette.
          const out = neighbours(cells, cols, rows, land).filter((n) => inside(n) && !n.home);
          const far = out.length ? out[Math.floor(rand() * out.length)] : null;
          const farther = far ? neighbours(cells, cols, rows, far).filter((n) => inside(n) && !n.home) : [];
          next = (rand() < 0.5 && farther.length ? farther[Math.floor(rand() * farther.length)] : far) || land;
          away = true;
        } else next = f.home;
        f.from = land; f.to = next; f.t0 = now; f.dur = (next === land ? 1 : 520 + Math.hypot(next.x - land.x, next.y - land.y) * 2.2) / speed;
        f.wait = (gather ? 900 + rand() * 1800 : away ? 300 + rand() * 900 : 1400 + rand() * 3200) / speed;
      }
    };
    const center = () => (hole ? { x: (hole.l + hole.r) / 2, y: (hole.t + hole.b) / 2 } : { x: W / 2, y: H / 2 });
    const wave = (rgb, chance, reach, hold) => {
      const now = performance.now(), p = center();
      for (const k of cells) {
        if (!k.w) continue;
        const d = Math.hypot(k.x - p.x, k.y - p.y);
        if (d < reach && rand() < chance) { k.rgb = rgb; k.glow = 1; k.delay = now + d * 1.6; k.hold = hold ? now + hold + d * 1.6 : 0; }
      }
    };
    // The cell nearest the card's top-right corner: where «te necesita» shows.
    const honey = () => {
      if (!hole) return;
      let best = null, bd = Infinity;
      for (const k of cells) { if (!k.w) continue; const d = Math.hypot(k.x - hole.r, k.y - hole.t); if (d < bd) { bd = d; best = k; } }
      if (best) { best.rgb = HONEY; best.glow = 1; best.hold = performance.now() + 9e5; }
    };
    let raf = 0, last = 0, prev = 0;
    const frame = (now) => {
      raf = 0;
      if (document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      step(now, Math.min(100, now - (prev || now)));
      prev = now; last = now;
      draw(now);
    };
    const go = () => { if (!still && !raf && !document.hidden) { prev = 0; raf = requestAnimationFrame(frame); } };
    const onSignal = (ev) => {
      const type = ev.detail;
      const placed = flyers.filter((x) => x.to);
      if (type === "type" && placed.length && !sleeping) {
        // One bot comes to the card's edge to look at what you write.
        const f = placed[Math.floor(rand() * placed.length)];
        const edge = cells.filter((k) => k.w && k.y > 60 && fromCard(k) < 30).sort((a, b) => Math.hypot(a.x - f.to.x, a.y - f.to.y) - Math.hypot(b.x - f.to.x, b.y - f.to.y))[0];
        if (edge && performance.now() > f.t0 + f.dur) { f.from = f.to; f.to = edge; f.t0 = performance.now(); f.dur = 520; f.wait = 900; }
      }
      if (type === "gather") { gather = true; speed = 0.8; }
      if (type === "free") { gather = false; speed = 1; }
      if (type === "honey") honey();
      if (type === "ok") { for (const k of cells) if (k.rgb === HONEY) k.hold = 0; wave("60,196,138", 0.42, Math.max(W, H) * 0.6, 0); }
      if (still) draw(0);
    };
    let rt = 0, st = 0;
    const onScroll = () => { if (st) return; st = requestAnimationFrame(() => { st = 0; measure(); if (still) draw(0); }); };
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { layout(); if (still) draw(0); }, 150); };
    const onTheme = new MutationObserver(() => { theme(); sprites.clear(); if (still) draw(0); });
    onTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // The card changing size (another step, an error) moves only the clearing: bots and lit cells stay.
    const ro = clear?.current && typeof ResizeObserver === "function" ? new ResizeObserver(onScroll) : null;
    if (ro) ro.observe(clear.current);
    layout();
    if (still) draw(0);
    else go();
    addEventListener("colmena:hive", onSignal);
    addEventListener("resize", onResize);
    addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", go);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(rt);
      ro?.disconnect();
      onTheme.disconnect();
      removeEventListener("colmena:hive", onSignal);
      removeEventListener("resize", onResize);
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(st);
      document.removeEventListener("visibilitychange", go);
    };
  }, [key, clear]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={ref} className="cl-hive" aria-hidden="true" />;
}

