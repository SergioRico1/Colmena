// Builds Colmena's emoji set from Blobmoji (https://github.com/c1710/blobmoji, Apache-2.0): one
// WebP sprite sheet per emoji group plus one for the skin tones, in public/emoji/, and the data the
// picker and the messages need (src/chat/emoji/blobmoji.json): each emoji's place in its sheet,
// its Spanish name and search words (emojibase-data, MIT, from Unicode CLDR).
//
//   node scripts/build-emoji.mjs          (downloads Blobmoji's png.zip once into .local/emoji-src)
//
// The sheets are content-hashed, so they can be cached for good. Emojis that Blobmoji does not
// draw (newer than its Unicode 15 set) are left out: the app shows those with the system font.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = "v15.0";
const ZIP_URL = `https://github.com/c1710/blobmoji/releases/download/${RELEASE}/png.zip`;
const SRC = path.join(ROOT, ".local", "emoji-src", "png.zip");
const OUT_DIR = path.join(ROOT, "public", "emoji");
const DATA = path.join(ROOT, "src", "chat", "emoji", "blobmoji.json");
const CELL = 64; // drawn at up to 32 px: sharp on a 2× screen
const COLS = 32;
const require = (p) => JSON.parse(readFileSync(path.join(ROOT, "node_modules", p), "utf8"));

if (!existsSync(SRC)) {
  mkdirSync(path.dirname(SRC), { recursive: true });
  console.log("Downloading " + ZIP_URL);
  const r = await fetch(ZIP_URL);
  if (!r.ok) throw Error("download " + r.status);
  writeFileSync(SRC, Buffer.from(await r.arrayBuffer()));
}
const zip = await JSZip.loadAsync(readFileSync(SRC));
const pngs = new Map(Object.keys(zip.files).filter((n) => n.endsWith(".png")).map((n) => [path.basename(n), zip.files[n]]));

/** Blobmoji names a file by its code points without FE0F: emoji_u1f44d.png, emoji_u1f1ea_1f1f8.png. */
const fileOf = (hexcode) => "emoji_u" + hexcode.toLowerCase().split("-").filter((c) => c !== "fe0f").join("_") + ".png";

const emojis = require("emojibase-data/es/data.json");
const groups = require("emojibase-data/es/messages.json").groups; // [{key, message, order}]
const LABELS = { "smileys-emotion": "Caras y emociones", "people-body": "Personas", "animals-nature": "Animales y naturaleza", "food-drink": "Comida y bebida", "travel-places": "Viajes y lugares", activities: "Actividades", objects: "Objetos", symbols: "Símbolos", flags: "Banderas" };

const sheets = groups.filter((g) => LABELS[g.key]).map((g) => ({ key: g.key, label: LABELS[g.key], group: g.order, cells: [] }));
const tones = { key: "tonos", label: "Tonos de piel", group: null, cells: [] };
const list = [];
let missing = 0;
for (const e of [...emojis].sort((a, b) => a.order - b.order)) {
  const sheet = sheets.find((s) => s.group === e.group);
  if (!sheet || !pngs.has(fileOf(e.hexcode))) { if (sheet) missing++; continue; }
  const item = [e.emoji, sheets.indexOf(sheet), sheet.cells.push(fileOf(e.hexcode)) - 1, e.label, [...new Set(e.tags || [])].join(" ")];
  const skins = (e.skins || []).filter((s) => !Array.isArray(s.tone) && pngs.has(fileOf(s.hexcode))).sort((a, b) => a.tone - b.tone);
  // Five tones, light to dark, when Blobmoji draws them all; a person with mixed tones is not offered.
  if (skins.length === 5) item.push(skins.map((s) => [s.emoji, sheets.length, tones.cells.push(fileOf(s.hexcode)) - 1]));
  // Text the picker does not offer but a message may carry (two people with two tones).
  for (const s of (e.skins || []).filter((x) => Array.isArray(x.tone) && pngs.has(fileOf(x.hexcode)))) list.push([s.emoji, sheets.length, tones.cells.push(fileOf(s.hexcode)) - 1]);
  list.push(item);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
const out = [];
for (const sheet of [...sheets, tones]) {
  const rows = Math.ceil(sheet.cells.length / COLS);
  const canvas = createCanvas(COLS * CELL, rows * CELL);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  for (let i = 0; i < sheet.cells.length; i++) {
    const img = await loadImage(await pngs.get(sheet.cells[i]).async("nodebuffer"));
    // Blobmoji's PNGs are 136×128 with side padding: fit the drawing into the square cell.
    const scale = Math.min(CELL / img.width, CELL / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (i % COLS) * CELL + (CELL - w) / 2, Math.floor(i / COLS) * CELL + (CELL - h) / 2, w, h);
  }
  const bytes = await canvas.encode("webp", 90);
  const file = `${sheet.key}-${createHash("sha256").update(bytes).digest("hex").slice(0, 10)}.webp`;
  writeFileSync(path.join(OUT_DIR, file), bytes);
  total += bytes.length;
  out.push({ key: sheet.key, label: sheet.label, file, rows });
  console.log(`${file}: ${sheet.cells.length} emojis, ${(bytes.length / 1024).toFixed(0)} KB`);
}
writeFileSync(path.join(OUT_DIR, "LICENSE.txt"), "Emoji images: Blobmoji " + RELEASE + " (https://github.com/c1710/blobmoji), derived from Noto Emoji.\nLicensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0\nResized and combined into sprite sheets for Colmena (scripts/build-emoji.mjs).\n");
mkdirSync(path.dirname(DATA), { recursive: true });
writeFileSync(DATA, JSON.stringify({ source: "blobmoji " + RELEASE, cell: CELL, cols: COLS, sheets: out, list }) + "\n");
for (const f of readdirSync(OUT_DIR)) if (!out.some((s) => s.file === f) && f !== "LICENSE.txt") rmSync(path.join(OUT_DIR, f));
console.log(`${list.length} emojis (${missing} newer than Blobmoji left out), sheets ${(total / 1024 / 1024).toFixed(2)} MB, data ${(readFileSync(DATA).length / 1024).toFixed(0)} KB`);
