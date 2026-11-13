import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEADING, LEGACY_SIZES, SCALE, T, TYPE, fitInitials, stepOf, tokenOf } from "../src/lib/type.js";

// One type scale: src/lib/type.js names the steps, src/styles/base.css holds the same steps as
// custom properties, and no font size outside the scale is written anywhere in src (the
// generated boards in src/design are not the app's code).

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(root, "src/styles/base.css"), "utf8");
const sources = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.replace(/\\/g, "/").includes("/src/design")) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx|js|css)$/.test(name)) sources.push(p);
  }
})(join(root, "src"));

test("the scale is short, ordered, whole pixels, and starts at 11", () => {
  const sizes = Object.values(TYPE);
  assert.ok(sizes.length <= 14, `${sizes.length} steps`);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  assert.equal(new Set(sizes).size, sizes.length);
  assert.equal(Math.min(...sizes), 11);
  for (const s of sizes) assert.equal(s, Math.round(s), `${s} is a whole pixel`);
  const text = Object.entries(TYPE).filter(([name]) => !name.startsWith("display"));
  assert.equal(text.length, 10, "ten steps for text; the rest are display sizes for headlines");
  for (const [name, [, lh]] of Object.entries(SCALE)) assert.ok(lh >= 0.9 && lh <= 1.7, `${name} line-height ${lh}`);
});

test("every size the app used before maps to a step", () => {
  for (const px of LEGACY_SIZES) {
    const name = tokenOf(px);
    assert.ok(name in TYPE, `${px} → ${name}`);
    assert.equal(stepOf(px), TYPE[name]);
    assert.ok(stepOf(px) >= 11, `${px} is never set under 11`);
  }
  const expected = { 7: 11, 8: 11, 9: 11, 9.5: 11, 10: 11, 10.5: 11, 11: 11, 11.5: 12, 12: 12, 12.5: 13, 13: 13, 13.5: 14, 14: 14, 14.5: 15, 15: 15, 15.5: 16, 16: 16, 16.5: 16, 17: 18, 18: 18, 19: 20, 20: 20, 21: 20, 22: 24, 24: 24, 26: 24, 28: 28, 30: 28, 32: 34, 34: 34, 36: 34, 40: 44, 44: 44, 48: 44, 52: 44, 54: 64, 64: 64, 80: 80 };
  assert.deepEqual(Object.fromEntries(LEGACY_SIZES.map((px) => [px, stepOf(px)])), expected);
  assert.deepEqual(Object.keys(expected).map(Number).sort((a, b) => a - b), [...LEGACY_SIZES].sort((a, b) => a - b), "the table covers the whole census");
});

test("a step maps to itself, and anything else to its nearest (the larger on a tie)", () => {
  for (const [name, size] of Object.entries(TYPE)) { assert.equal(tokenOf(size), name); assert.equal(stepOf(size), size); }
  assert.equal(stepOf(13.5), 14);
  assert.equal(stepOf(13.4), 13);
  assert.equal(stepOf(1), 11);
  assert.equal(stepOf(200), 80);
  assert.equal(tokenOf("abc"), "ui");
  assert.equal(stepOf("14"), 14);
});

test("the custom properties in base.css are the same steps", () => {
  for (const [name, [size, lh]] of Object.entries(SCALE)) {
    assert.match(css, new RegExp(`--t-${name}:${size}px;`), `--t-${name}`);
    assert.match(css, new RegExp(`--lh-${name}:${String(lh).replace(".", "\\.")};`), `--lh-${name}`);
    assert.equal(T[name], `var(--t-${name})`);
    assert.equal(LEADING[name], lh);
  }
  const declared = [...css.matchAll(/--t-([a-z-]+):/g)].map((m) => m[1]);
  assert.deepEqual(declared.sort(), Object.keys(SCALE).sort(), "no step in the style sheet that the code does not know");
});

test("no font size outside the scale is written in src", () => {
  const steps = new Set(Object.values(TYPE));
  const names = new Set(Object.keys(TYPE));
  const off = [];
  const SIZE = [
    /fontSize:\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?\s*[,}]/g, // fontSize: "13px" · fontSize: 13
    /font-size:\s*(\d+(?:\.\d+)?)px/g, // CSS text
    /\bfont:\s*["'`]?(?:(?:\d{3}|normal|bold|italic)\s+)+(\d+(?:\.\d+)?)px/g, // font shorthand
    /\bfontSize=["{](\d+(?:\.\d+)?)["}]/g, // SVG text
    /["'](\d+(?:\.\d+)?)px["']\s*:\s*["'](\d+(?:\.\d+)?)px["']\s*\}?\s*\/[\d.]+ '/g, // a size chosen inside a shorthand
  ];
  for (const file of sources) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of SIZE) {
        re.lastIndex = 0;
        for (let m = re.exec(line); m; m = re.exec(line)) for (const v of m.slice(1)) if (v !== undefined && !steps.has(Number(v))) off.push(`${file.slice(root.length)}:${i + 1} ${v}px`);
      }
      for (const m of line.matchAll(/var\(--t-([a-z-]+)\)/g)) if (!names.has(m[1])) off.push(`${file.slice(root.length)}:${i + 1} unknown step --t-${m[1]}`);
    });
  }
  assert.deepEqual(off, []);
});

test("initials fit the mark they are in", () => {
  assert.equal(fitInitials("TC", 40), "TC");
  assert.equal(fitInitials("TC", 24), "TC");
  assert.equal(fitInitials("TC", 15), "T", "a small mark shows one letter at a readable size");
  assert.equal(fitInitials("TÚ", 14), "T");
  assert.equal(fitInitials("", 14), "");
  assert.equal(fitInitials(null, 14), "");
});
