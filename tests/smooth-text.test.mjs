import test from "node:test";
import assert from "node:assert/strict";
import { TextReveal } from "../src/lib/smoothText.js";

const run = (reveal, from, to, step = 16) => { for (let t = from; t <= to; t += step) reveal.tick(t); };

test("a burst of text is revealed over about 250 ms, not at once", () => {
  const seen = [];
  const r = new TextReveal((t) => seen.push(t));
  const burst = "x".repeat(200);
  assert.equal(r.setTarget(burst, 0), true);
  r.tick(16);
  assert.ok(r.shown.length > 0 && r.shown.length < 40, "first frame shows a little: " + r.shown.length);
  run(r, 32, 256);
  assert.ok(r.shown.length >= 120 && r.shown.length < 200, "most of it in ~250 ms: " + r.shown.length);
  run(r, 272, 800);
  assert.equal(r.shown, burst, "the tail at no less than one character every 5 ms");
  assert.ok(seen.every((t, i) => i === 0 || t.length >= seen[i - 1].length), "it only grows");
});

test("a short burst goes at no more than one character every 5 ms; new text joins the backlog", () => {
  const r = new TextReveal(() => {});
  r.setTarget("hola", 0);
  r.tick(10);
  assert.equal(r.shown, "ho");
  r.setTarget("hola, ¿qué tal?", 12);
  run(r, 20, 200);
  assert.equal(r.shown, "hola, ¿qué tal?");
});

test("a reset (text that does not continue) starts over; finish shows everything", () => {
  const seen = [];
  const r = new TextReveal((t) => seen.push(t));
  r.setTarget("primer intento", 0);
  run(r, 16, 400);
  r.setTarget("otra respuesta", 500);
  assert.equal(seen.at(-1), "", "the old text is cleared at once");
  r.finish();
  assert.equal(seen.at(-1), "otra respuesta");
});
