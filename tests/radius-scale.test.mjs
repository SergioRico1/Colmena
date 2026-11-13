import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCLE, LEGACY_RADII, PILL, R, RADIUS, radiusOf, radiusToken } from "../src/lib/radius.js";

// One radius scale: src/lib/radius.js names the steps, src/styles/base.css holds the same
// steps as custom properties, and no other corner size is written anywhere in src (the
// generated boards in src/design are not the app's code; bot shapes keep their geometry).

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

test("the scale is short and sits on a 4 px grid", () => {
  const sizes = Object.values(RADIUS);
  assert.deepEqual(sizes, [4, 8, 12, 16, 20, 24, 32]);
  for (const s of sizes) assert.equal(s % 4, 0);
  assert.equal(PILL, "999px");
  assert.equal(CIRCLE, "50%");
});

test("every radius the app used before maps to a step", () => {
  const expected = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 8, 7: 8, 8: 8, 9: 8, 10: 12, 11: 12, 12: 12, 13: 12, 14: 16, 15: 16, 16: 16, 17: 16, 18: 20, 19: 20, 20: 20, 22: 24, 24: 24, 26: 24, 28: 32, 30: 32, 31: 32, 32: 32 };
  assert.deepEqual(Object.fromEntries(LEGACY_RADII.map((px) => [px, radiusOf(px)])), expected);
  for (const px of LEGACY_RADII) assert.ok(radiusToken(px) in RADIUS, `${px} → ${radiusToken(px)}`);
});

test("a step maps to itself; anything else to its nearest, the larger on a tie", () => {
  for (const [name, size] of Object.entries(RADIUS)) { assert.equal(radiusToken(size), name); assert.equal(radiusOf(size), size); }
  assert.equal(radiusOf(10), 12);
  assert.equal(radiusOf(9.9), 8);
  assert.equal(radiusOf(0.5), 4);
  assert.equal(radiusOf(80), 32);
  assert.equal(radiusToken("x"), "md");
});

test("the custom properties in base.css are the same steps", () => {
  for (const [name, size] of Object.entries(RADIUS)) {
    assert.match(css, new RegExp(`--r-${name}:${size}px[;}]`), `--r-${name}`);
    assert.equal(R[name], `var(--r-${name})`);
  }
  assert.match(css, /--r-pill:999px[;}]/);
  assert.match(css, /--r-circle:50%[;}]/);
  const declared = [...css.matchAll(/--r-([a-z0-9]+):/g)].map((m) => m[1]);
  assert.deepEqual(declared.sort(), [...Object.keys(RADIUS), "pill", "circle"].sort());
});

test("no corner size outside the scale is written in src", () => {
  const steps = new Set(Object.values(RADIUS));
  const names = new Set([...Object.keys(RADIUS), "pill", "circle"]);
  const off = [];
  const PX = /(\d+(?:\.\d+)?)px/g;
  const RULES = [
    /\bborder(?:Top|Bottom)?(?:Left|Right)?Radius:\s*((?:[^,{}()]|\([^()]*\))*)/g, // inline styles
    /border-radius:\s*([^;}"'`]+)/g, // CSS text
  ];
  for (const file of sources) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of RULES) {
        re.lastIndex = 0;
        for (let m = re.exec(line); m; m = re.exec(line)) {
          for (const v of m[1].matchAll(PX)) if (!steps.has(Number(v[1])) && Number(v[1]) !== 999) off.push(`${file.slice(root.length)}:${i + 1} ${v[0]}`);
          // A bare number is a pixel radius too (React adds the unit).
          if (/^\s*\d+(?:\.\d+)?\s*$/.test(m[1]) && Number(m[1]) !== 0) off.push(`${file.slice(root.length)}:${i + 1} ${m[1].trim()}`);
        }
      }
      for (const m of line.matchAll(/var\(--r-([a-z0-9]+)\)/g)) if (!names.has(m[1])) off.push(`${file.slice(root.length)}:${i + 1} unknown step --r-${m[1]}`);
    });
  }
  assert.deepEqual(off, []);
});
