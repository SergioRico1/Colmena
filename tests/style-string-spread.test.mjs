import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Spreading a string into a React style object ({ ...mono }) sets indexed properties ("0", "1"…)
// on CSSStyleDeclaration, which throws «Indexed property setter is not supported» and takes the
// whole screen down (Ajustes › IA in the hosted app, 2026-11-14). The settings kit's `mono` is a
// font-family string: use it as `fontFamily: mono`, never spread it.
const ROOT = path.resolve(import.meta.dirname, "..", "src");
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? files(full) : /\.(jsx?|mjs)$/.test(name) ? [full] : [];
});

test("string style tokens imported from the settings kit are never spread into a style object", () => {
  const kit = readFileSync(path.join(ROOT, "components", "v2", "settings", "v3.jsx"), "utf8");
  const strings = [...kit.matchAll(/^export const (\w+) = ["'`]/gm)].map((m) => m[1]);
  assert.ok(strings.includes("mono"), "mono is a string token of the kit");
  const bad = [];
  for (const file of files(ROOT)) {
    const src = readFileSync(file, "utf8");
    const imported = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*settings\/v3\.jsx["']|import\s*\{([^}]*)\}\s*from\s*["']\.\/v3\.jsx["']/g)]
      .flatMap((m) => (m[1] || m[2]).split(",").map((s) => s.trim().split(/\s+as\s+/).pop()));
    for (const name of strings.filter((s) => imported.includes(s)))
      if (new RegExp("\\.\\.\\." + name + "\\b").test(src)) bad.push(path.relative(ROOT, file) + ": ..." + name);
  }
  assert.deepEqual(bad, []);
});
