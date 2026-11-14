import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Phone, tablet and laptop (src/lib/breakpoint.js, src/styles/responsive.css): the widths are the
// same in JS and CSS, the hook's answer follows matchMedia, a browser hides what only the desktop
// app can do, and a long press stands in for a right-click on a touch screen (src/lib/longPress.js).

// A window whose width the test sets; matchMedia reads min-/max-width from the query.
let width = 1440;
const listeners = new Set();
const matches = (q) => {
  const min = /min-width:\s*([\d.]+)px/.exec(q), max = /max-width:\s*([\d.]+)px/.exec(q);
  if (/pointer/.test(q)) return false;
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
};
globalThis.window = {
  matchMedia: (q) => ({ get matches() { return matches(q); }, addEventListener: (_t, fn) => listeners.add(fn), removeEventListener: (_t, fn) => listeners.delete(fn) }),
};
const { BREAKPOINTS, QUERIES, currentBreakpoint, isDesktopApp } = await import("../src/lib/breakpoint.js");

test("three widths: phone under 640, tablet to 1023, laptop from 1024", () => {
  assert.deepEqual({ ...BREAKPOINTS }, { tablet: 640, laptop: 1024 });
  for (const [w, bp] of [[360, "phone"], [375, "phone"], [639, "phone"], [640, "tablet"], [768, "tablet"], [1023, "tablet"], [1024, "laptop"], [1440, "laptop"]]) {
    width = w;
    assert.equal(currentBreakpoint(), bp, `${w} px`);
  }
});

test("the style sheet uses the same widths as the hook", () => {
  const css = readFileSync(new URL("../src/styles/responsive.css", import.meta.url), "utf8");
  assert.match(QUERIES.phone, /max-width: 639\.98px/);
  assert.match(QUERIES.tablet, /min-width: 640px\) and \(max-width: 1023\.98px/);
  assert.ok(css.includes("(max-width: 639.98px)") && css.includes("(max-width: 1023.98px)"), "responsive.css breaks at 640 and 1024");
  assert.ok(css.includes("--bp-tablet:640px;--bp-laptop:1024px"), "the tokens say the same numbers");
  // Nothing in it may touch the laptop layout: every rule sits in a width, pointer or hover query,
  // or targets markers that only exist outside the desktop app.
  const top = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const selectors = [...top.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  assert.deepEqual(selectors, [":root", "html.colmena-web [data-desktop-only]", ".r-only-touch"]);
});

test("a browser is not the desktop app: no window bridge", () => {
  assert.equal(isDesktopApp(), false);
  globalThis.window.colmenaWindow = { close() {} };
  assert.equal(isDesktopApp(), true);
  delete globalThis.window.colmenaWindow;
});

test("Actualizaciones is listed in the desktop app only", async () => {
  const { groupedSections } = await import("../src/components/v2/settings/sections.js");
  const ids = (opts) => groupedSections(false, opts).flatMap((g) => g.sections.map((s) => s.id));
  assert.ok(ids().includes("actualizaciones"), "the default (and the desktop app) keeps it");
  assert.ok(!ids({ desktop: false }).includes("actualizaciones"), "a browser has nothing to update");
});

test("a held finger opens the right-click menu once; a moving one does not", async () => {
  const { installLongPress, LONG_PRESS } = await import("../src/lib/longPress.js");
  const handlers = {};
  const target = { addEventListener: (t, fn) => { (handlers[t] ||= []).push(fn); }, removeEventListener: () => {} };
  const fired = [];
  const el = { isConnected: true, closest: () => null, dispatchEvent: (e) => { fired.push(e.type); return true; } };
  globalThis.MouseEvent = class { constructor(type, init) { Object.assign(this, init, { type, defaultPrevented: false }); } };
  installLongPress(target);
  const touch = (x, y) => ({ target: el, touches: [{ clientX: x, clientY: y }] });
  handlers.touchstart[0](touch(10, 10));
  await new Promise((r) => setTimeout(r, LONG_PRESS + 60));
  assert.deepEqual(fired, ["contextmenu"]);
  handlers.touchstart[0](touch(10, 10));
  handlers.touchmove[0](touch(40, 10)); // a scroll, not a press
  await new Promise((r) => setTimeout(r, LONG_PRESS + 60));
  assert.deepEqual(fired, ["contextmenu"], "moving cancels it");
  handlers.touchstart[0](touch(10, 10));
  handlers.contextmenu[0](); // the browser fired its own (Android)
  await new Promise((r) => setTimeout(r, LONG_PRESS + 60));
  assert.deepEqual(fired, ["contextmenu"], "never twice");
});
