// Renders public/icon.svg to PNGs and a Windows .ico (PNG-compressed entries)
// for the desktop window and taskbar. Usage: node scripts/make-icons.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const out = new URL("../desktop/icons/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = [];
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
  const png = await page.locator("svg").screenshot({ omitBackground: true });
  pngs.push({ size, png });
  await page.close();
}
await browser.close();
await writeFile(new URL("colmena.png", out), pngs.at(-1).png);
await writeFile(new URL("colmena-32.png", out), pngs.find((p) => p.size === 32).png);
// ICO: header + directory + PNG payloads.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
const dir = Buffer.alloc(16 * pngs.length);
let offset = 6 + dir.length;
pngs.forEach(({ size, png }, i) => {
  const o = i * 16;
  dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
  dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += png.length;
});
await writeFile(new URL("colmena.ico", out), Buffer.concat([header, dir, ...pngs.map((p) => p.png)]));
console.log("Iconos en desktop/icons/");
