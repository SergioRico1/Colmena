// Accessibility scan of the running app (dev only): contrast, targets under 24 px, controls
// without a name, landmarks and the heading outline, plus a census of font sizes and radii.
// Usage: node scripts/a11y-scan.mjs [baseUrl] [--json=out.json] [--only=Inicio,Sala] [--theme=dark|light] [--dark] [--w=375 --h=812] [--verbose]
//   --dark is short for --theme=dark (the default «Sistema» setting follows the system theme).
//   Needs a server on isolated QA data (scripts/seed-qa.mjs) and a playwright-core install
//   (PLAYWRIGHT_CORE, PW_EXE as in scripts/v3-shot.cjs). Exits 1 when it finds something.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const args = process.argv.slice(2);
const flag = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const base = args.find((a) => !a.startsWith("--")) || "http://localhost:4319";
const only = (flag("only", "") || "").split(",").filter(Boolean);
const verbose = args.includes("--verbose");

/** The main routes, on the records scripts/seed-qa.mjs writes. */
export const ROUTES = [
  ["Inicio", "/"], ["Chat", "/chat/nora?c=m-chat"], ["Sala", "/sala/m-q3"], ["Trabajo", "/trabajo"],
  ["Rutinas", "/trabajo/rutinas"], ["Objetivos", "/trabajo/objetivos"], ["Codigo", "/codigo"], ["Equipo", "/equipo"],
  ["Bot", "/equipo/tomas"], ["Archivos", "/biblioteca"], ["Notas", "/biblioteca/notas"], ["Habilidades", "/biblioteca/habilidades"],
  ["Memoria", "/biblioteca/memoria"], ["Actividad", "/actividad"], ["Ajustes", "/ajustes"], ["AjustesIA", "/ajustes/ia"],
  ["Bienvenida", "/bienvenida"],
];

/* Runs inside the page. Everything it needs is declared in its body. */
function scan() {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return null;
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      if (n.getAttribute("aria-hidden") === "true" && n !== el) return false;
    }
    return true;
  };
  /** The colour behind an element, or null when a picture or gradient sits there. */
  const backdrop = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) bg = over(c, bg);
    return bg;
  };
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const where = (el) => {
    const text = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
    return `<${el.tagName.toLowerCase()}> «${text}»`;
  };
  const out = { contrast: [], targets: [], unnamed: [], landmarks: [], headings: [], sizes: {}, radii: {} };

  // Contrast, and the census of sizes: every element that holds text of its own.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!node.nodeValue.trim() || !el || seen.has(el) || ["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(el.tagName)) continue;
    seen.add(el);
    if (!shown(el) || el.closest("[aria-hidden='true']")) continue;
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    out.sizes[size] = (out.sizes[size] || 0) + 1;
    const bg = backdrop(el), fg = parse(s.color);
    if (!bg || !fg) continue;
    const ink = over({ ...fg, a: fg.a * opacity(el) }, bg);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const value = ratio(ink, bg);
    if (el.closest(":disabled,[aria-disabled='true']")) continue;
    if (value < (large ? 3 : 4.5)) out.contrast.push({ what: where(el), ratio: Math.round(value * 100) / 100, size, color: hex(ink), on: hex(bg) });
  }
  for (const el of document.querySelectorAll("input[placeholder],textarea[placeholder]")) {
    if (!shown(el) || el.value || el.disabled) continue;
    const bg = backdrop(el), fg = parse(getComputedStyle(el, "::placeholder").color);
    if (!bg || !fg) continue;
    const ink = over(fg, bg), value = ratio(ink, bg);
    if (value < 4.5) out.contrast.push({ what: "placeholder " + where(el), ratio: Math.round(value * 100) / 100, size: parseFloat(getComputedStyle(el).fontSize), color: hex(ink), on: hex(bg) });
  }

  // Radii in use.
  for (const el of document.body.querySelectorAll("*")) {
    const r = getComputedStyle(el).borderTopLeftRadius;
    if (r && r !== "0px" && shown(el)) out.radii[r] = (out.radii[r] || 0) + 1;
  }

  // Targets and names.
  const controls = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=option],[role=menuitem],[role=checkbox],[role=switch],[tabindex]:not([tabindex='-1'])")];
  const hit = (el) => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (const pseudo of ["::before", "::after"]) {
      const s = getComputedStyle(el, pseudo);
      if (s.content === "none" || s.position !== "absolute") continue;
      // An invisible area laid over the control (.c-hit in styles/base.css) counts as its size.
      const w = parseFloat(s.width) || 0, h = parseFloat(s.height) || 0;
      left = Math.min(left, r.left - Math.max(0, w - r.width) / 2); right = Math.max(right, r.right + Math.max(0, w - r.width) / 2);
      top = Math.min(top, r.top - Math.max(0, h - r.height) / 2); bottom = Math.max(bottom, r.bottom + Math.max(0, h - r.height) / 2);
    }
    // A control inside a <label> is hit through the whole label.
    const label = el.closest("label");
    if (label && el.matches("input,select,textarea")) { const l = label.getBoundingClientRect(); left = Math.min(left, l.left); top = Math.min(top, l.top); right = Math.max(right, l.right); bottom = Math.max(bottom, l.bottom); }
    return { w: right - left, h: bottom - top };
  };
  const inline = (el) => {
    if (el.tagName !== "A" || getComputedStyle(el).display !== "inline") return false;
    const rest = (el.parentElement?.textContent || "").replace(el.textContent, "").trim();
    return rest.length > 12; // a link inside a sentence (WCAG 2.5.8 «inline» exception)
  };
  for (const el of controls) {
    if (!shown(el) || el.disabled || el.closest("[aria-hidden='true']")) continue;
    const { w, h } = hit(el);
    if ((w < 23.9 || h < 23.9) && !inline(el)) out.targets.push({ what: where(el), w: Math.round(w), h: Math.round(h) });
    const labelled = (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join("").trim();
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "";
    const name = (el.getAttribute("aria-label") || labelled || forLabel || el.closest("label")?.textContent || el.textContent || el.getAttribute("title") || el.querySelector("img[alt]")?.alt || (el.tagName === "INPUT" && ["submit", "button"].includes(el.type) ? el.value : "") || "").trim();
    if (!name) out.unnamed.push({ what: `<${el.tagName.toLowerCase()}${el.type ? " type=" + el.type : ""}> ${el.getAttribute("placeholder") ? "placeholder «" + el.getAttribute("placeholder") + "»" : (el.className || "").toString().slice(0, 40)}` });
  }

  // Landmarks and headings.
  const mains = [...document.querySelectorAll("main,[role=main]")].filter(shown);
  if (mains.length !== 1) out.landmarks.push({ what: `${mains.length} main landmarks` });
  if (![...document.querySelectorAll("nav,[role=navigation]")].some(shown) && !location.pathname.startsWith("/bienvenida")) out.landmarks.push({ what: "no navigation landmark" });
  const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(shown).map((h) => ({ level: Number(h.getAttribute("aria-level") || h.tagName[1]), text: h.textContent.trim().slice(0, 40) }));
  const h1 = heads.filter((h) => h.level === 1);
  if (h1.length !== 1) out.headings.push({ what: `${h1.length} h1 (${h1.map((h) => "«" + h.text + "»").join(", ")})` });
  heads.reduce((prev, h) => { if (prev && h.level > prev.level + 1) out.headings.push({ what: `h${prev.level} «${prev.text}» → h${h.level} «${h.text}» skips a level` }); return h; }, null);
  return out;
}

const KINDS = ["contrast", "targets", "unnamed", "landmarks", "headings"];
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const { chromium } = require(PW);
  const browser = await chromium.launch({ executablePath: EXE });
  // --theme=dark|light: the app's theme for the whole scan (src/lib/theme.js reads it at boot).
  const theme = flag("theme", null) || (args.includes("--dark") ? "dark" : null);
  // --w=375 --h=812: a phone (with touch, src/styles/responsive.css); the default is the desktop window.
  const w = Number(flag("w", 1440)), h = Number(flag("h", 900));
  const page = await browser.newPage({ viewport: { width: w, height: h }, ...(w < 1024 ? { hasTouch: true, isMobile: w < 640 } : {}), ...(theme ? { colorScheme: theme } : {}) });
  if (theme) await page.addInitScript((t) => { try { localStorage.setItem("colmena.theme", t); } catch { /* blocked storage */ } }, theme);
  const report = {}, totals = Object.fromEntries(KINDS.map((k) => [k, 0])), sizes = {}, radii = {};
  for (const [name, route] of ROUTES.filter(([n]) => !only.length || only.includes(n))) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const found = await page.evaluate(scan);
    report[name] = found;
    for (const k of KINDS) totals[k] += found[k].length;
    for (const [k, n] of Object.entries(found.sizes)) sizes[k] = (sizes[k] || 0) + n;
    for (const [k, n] of Object.entries(found.radii)) radii[k] = (radii[k] || 0) + n;
    console.log(`${name.padEnd(12)} ${KINDS.map((k) => `${k} ${found[k].length}`).join(" · ")} · sizes ${Object.keys(found.sizes).length} · radii ${Object.keys(found.radii).length}`);
    if (verbose) for (const k of KINDS) for (const item of found[k]) console.log(`    ${k}: ${item.what}${item.ratio ? ` ${item.ratio}:1 ${item.size}px ${item.color} on ${item.on}` : ""}${item.w != null ? ` ${item.w}×${item.h}` : ""}`);
  }
  await browser.close();
  const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(", ");
  console.log(`\nTotal        ${KINDS.map((k) => `${k} ${totals[k]}`).join(" · ")}`);
  console.log(`Font sizes (${Object.keys(sizes).length}): ${sorted(sizes)}`);
  console.log(`Radii (${Object.keys(radii).length}): ${sorted(radii)}`);
  const json = flag("json", "");
  if (json) writeFileSync(json, JSON.stringify({ totals, sizes, radii, report }, null, 2));
  process.exit(KINDS.some((k) => totals[k]) ? 1 : 0);
}
