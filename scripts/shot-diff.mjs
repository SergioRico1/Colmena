// Compares two folders of screenshots pixel by pixel (same file names), for «nothing changed at
// this size» checks: node scripts/shot-diff.mjs <before-dir> <after-dir> [--only=1440x960] [--out=<dir>]
// Prints, per file, how many pixels differ and the box around them; with --out writes a copy of
// the after image with the differing pixels painted magenta. Exits 1 when any file differs.
import { readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const args = process.argv.slice(2);
const flag = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const [before, after] = args.filter((a) => !a.startsWith("--"));
if (!before || !after) { console.error("usage: node scripts/shot-diff.mjs <before-dir> <after-dir> [--only=text] [--out=dir]"); process.exit(2); }
const only = flag("only", "");
const out = flag("out", "");
if (out) mkdirSync(out, { recursive: true });

const pixels = async (file) => {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data, canvas: c, g };
};

let changed = 0;
for (const name of readdirSync(before).filter((f) => f.endsWith(".png") && f.includes(only)).sort()) {
  const other = join(after, name);
  if (!existsSync(other)) { console.log(`missing  ${name}`); changed++; continue; }
  const a = await pixels(join(before, name));
  const b = await pixels(other);
  if (a.w !== b.w || a.h !== b.h) { console.log(`size     ${name} ${a.w}x${a.h} → ${b.w}x${b.h}`); changed++; continue; }
  let n = 0, x0 = a.w, y0 = a.h, x1 = -1, y1 = -1;
  const mark = out ? b.g.getImageData(0, 0, b.w, b.h) : null;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) continue;
    n++;
    const p = i / 4, x = p % a.w, y = (p / a.w) | 0;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    if (mark) { mark.data[i] = 255; mark.data[i + 1] = 0; mark.data[i + 2] = 255; }
  }
  if (!n) { console.log(`same     ${name}`); continue; }
  changed++;
  console.log(`DIFF     ${name} ${n} px in [${x0},${y0}]–[${x1},${y1}]`);
  if (mark) { b.g.putImageData(mark, 0, 0); writeFileSync(join(out, name), b.canvas.toBuffer("image/png")); }
}
process.exit(changed ? 1 : 0);
