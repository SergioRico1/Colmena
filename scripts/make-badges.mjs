// Draws the taskbar counter badges (desktop/icons/badges/badge-<n>.png, 1–9 and 9+): a
// honey disc with the count in ink and a thin white ring, Colmena's «waits for you» colour.
// Run once after changing the look: node scripts/make-badges.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "desktop", "icons", "badges");
mkdirSync(out, { recursive: true });
const SIZE = 32;
for (const label of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+"]) {
  const canvas = createCanvas(SIZE, SIZE);
  const c = canvas.getContext("2d");
  c.beginPath();
  c.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 0.5, 0, Math.PI * 2);
  c.fillStyle = "#FFFFFF";
  c.fill();
  c.beginPath();
  c.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2.5, 0, Math.PI * 2);
  c.fillStyle = "#FFC93C";
  c.fill();
  c.fillStyle = "#12131A";
  c.font = `700 ${label.length > 1 ? 15 : 20}px "Segoe UI", Arial, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, SIZE / 2, SIZE / 2 + 1);
  writeFileSync(path.join(out, "badge-" + (label === "9+" ? "9plus" : label) + ".png"), canvas.toBuffer("image/png"));
}
console.log("Badges in " + out);
