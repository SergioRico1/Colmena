// Builds the colmena.team home page into site/dist (static assets for the colmena-home Worker).
//
//   node site/build.mjs
//
// Templates in site/src/*.html (and site/src/<dir>/index.html) are copied with these markers
// replaced:
//   {{bot <id> <size> [mood] [label]}}  a pixel bot drawn by src/lib/pixelBot.js, the app's own
//                                       renderer, in its role shape and the demo person's colour
//   {{icon <Name>}}                     a Phosphor icon (site/src/icons.json, extracted from
//                                       @phosphor-icons/react; viewBox 0 0 256 256)
//   {{css}}                             site/src/styles.css, inlined
// Fonts (site/fonts) and static files (site/static) are copied as they are.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pixelBotSvg } from "../src/lib/pixelBot.js";
import { seededLooks } from "../server/bot-looks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "src");
const out = path.join(here, "dist");

// The demo person's bots: the same names and colours a real Colmena would give a person whose
// key is "demo-c" (server/bot-looks.mjs › seededLooks). Shapes and props mark the role.
const looks = seededLooks("demo-c");
const ROLES = {
  atlas: { shape: "hex", role: "coordinador" },
  nora: { shape: "capsule", role: "investigacion" },
  tomas: { shape: "square", role: "datos" },
  iris: { shape: "diamond", role: "diseno" },
  vera: { shape: "leaf", role: "redaccion" },
  bruno: { shape: "arch", role: "codigo" },
};
const seedOf = (id) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const BOTS = Object.fromEntries(Object.entries(ROLES).map(([id, r]) => [id, { ...r, name: looks[id].name, color: looks[id].color }]));

const icons = JSON.parse(readFileSync(path.join(src, "icons.json"), "utf8"));
const css = readFileSync(path.join(src, "styles.css"), "utf8");

// Drawings repeat (a bot at several sizes, an icon in every channel name): each is defined once
// as a <symbol> in a hidden sprite at the top of <body>, and every use points at it.
let sprite = new Map();
function bot(id, size, mood = "libre", label = "") {
  const b = BOTS[id];
  if (!b) throw new Error(`unknown bot ${id}`);
  const svg = pixelBotSvg({ shape: b.shape, color: b.color, role: b.role, seed: seedOf(id), size: Number(size), mood });
  const n = /viewBox="0 0 (\d+) /.exec(svg)[1];
  const key = `b-${id}-${mood}-${n}`;
  if (!sprite.has(key)) sprite.set(key, `<symbol id="${key}" viewBox="0 0 ${n} ${n}">${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</symbol>`);
  // "label" names the drawing after the bot (it then carries meaning); without it, it is decoration.
  const a11y = label === "label" ? `role="img" aria-label="${b.name}, bot"` : 'aria-hidden="true"';
  return `<svg class="pbot" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" ${a11y}><use href="#${key}"/></svg>`;
}
function icon(name) {
  const body = icons[name];
  if (!body) throw new Error(`unknown icon ${name}`);
  const key = "i-" + name.replace(":", "-");
  if (!sprite.has(key)) sprite.set(key, `<symbol id="${key}" viewBox="0 0 256 256">${body}</symbol>`);
  return `<svg class="ic" fill="currentColor" aria-hidden="true" focusable="false"><use href="#${key}"/></svg>`;
}
function render(html) {
  sprite = new Map();
  const page = html
    .replace(/\{\{css\}\}/g, () => css.replace(/\s*\n\s*/g, "\n").trim())
    .replace(/\{\{bot ([a-z]+) (\d+)(?: ([a-z]+))?(?: ([^}]+))?\}\}/g, (_, id, size, mood, label) => bot(id, size, mood || "libre", label || ""))
    .replace(/\{\{name ([a-z]+)\}\}/g, (_, id) => BOTS[id].name)
    .replace(/\{\{icon ([A-Za-z:]+)\}\}/g, (_, name) => icon(name));
  if (!sprite.size) return page;
  return page.replace(/<body([^>]*)>/, (m) => `${m}\n<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${[...sprite.values()].join("")}</svg>`);
}

// Empty the folder rather than removing it: `wrangler dev` holds it open on Windows.
mkdirSync(out, { recursive: true });
for (const entry of readdirSync(out)) rmSync(path.join(out, entry), { recursive: true, force: true });
function walk(dir, rel = "") {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const r = path.join(rel, entry);
    if (statSync(full).isDirectory()) { walk(full, r); continue; }
    if (!entry.endsWith(".html")) continue;
    const html = render(readFileSync(full, "utf8"));
    const left = html.match(/\{\{[^}]*\}\}/);
    if (left) throw new Error(`${r}: marker left: ${left[0]}`);
    // Pages named _*.html are build sources, not pages (the Open Graph card, screenshotted into
    // static/og.png by site/og.cjs over a running copy of the site): they go to .local/site/.
    const dest = entry.startsWith("_") ? path.join(here, "..", ".local", "site") : path.join(out, rel);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, entry), html);
  }
}
walk(src);
cpSync(path.join(here, "fonts"), path.join(out, "fonts"), { recursive: true, filter: (f) => !f.endsWith(".txt") });
cpSync(path.join(here, "static"), out, { recursive: true });
console.log("built", out, Object.values(BOTS).map((b) => `${b.name} ${b.color}`).join(", "));
