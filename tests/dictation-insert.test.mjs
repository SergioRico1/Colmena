// Where a finished dictation goes (src/lib/dictation.js): at the caret it had when you began, as
// one edit, unless you moved it or the text changed; and which engine is said to be in use.
import test from "node:test";
import assert from "node:assert/strict";
import { appendText, engineNote, planInsert } from "../src/lib/dictation.js";

const box = {};
const at = (value, start, end = start, el = box) => ({ value, start, end, el });

test("the transcript goes at the caret, with spaces where words would touch", () => {
  const plan = planInsert(at("Hola equipo", 4), at("Hola equipo", 4), "  buenos   días ");
  assert.deepEqual(plan, { mode: "caret", start: 4, end: 4, text: " buenos días", caret: 16 });
  assert.equal(at("Hola equipo").value.slice(0, 4) + plan.text + "Hola equipo".slice(4), "Hola buenos días equipo");
  // In the middle of words: spaces on both sides; before punctuation: none after.
  assert.equal(planInsert(at("ab", 1), at("ab", 1), "x").text, " x ");
  assert.equal(planInsert(at("Hola.", 4), at("Hola.", 4), "a todos").text, " a todos");
  // An empty box, or the caret at the end, is the same edit.
  assert.deepEqual(planInsert(at("", 0), at("", 0), "Hola"), { mode: "caret", start: 0, end: 0, text: "Hola", caret: 4 });
  assert.equal(planInsert(at("Hola", 4), at("Hola", 4), "y adiós").text, " y adiós");
});

test("a selection is replaced by what you dictated", () => {
  const plan = planInsert(at("Nos vemos el lunes por la tarde", 13, 18), at("Nos vemos el lunes por la tarde", 13, 18), "martes");
  assert.equal(plan.mode, "caret");
  const value = "Nos vemos el lunes por la tarde";
  assert.equal(value.slice(0, plan.start) + plan.text + value.slice(plan.end), "Nos vemos el martes por la tarde");
});

test("a caret moved or a text changed while dictating: the words are appended instead", () => {
  assert.deepEqual(planInsert(at("Hola equipo", 4), at("Hola equipo", 11), "x"), { mode: "append", text: "x" });
  assert.deepEqual(planInsert(at("Hola equipo", 4), at("Hola equipo y más", 4), "x"), { mode: "append", text: "x" });
  assert.deepEqual(planInsert(null, at("Hola", 4), "x"), { mode: "append", text: "x" });
  assert.deepEqual(planInsert(at("Hola", 2), null, "x"), { mode: "append", text: "x" });
  // A box swapped for the live words and back has no caret of its own: the old one is restored.
  assert.equal(planInsert(at("Hola equipo", 4), at("Hola equipo", 11, 11, {}), "x").mode, "caret");
  assert.equal(planInsert(at("Hola", 2), at("Hola", 2), "   "), null);
});

test("appendText keeps one space between", () => {
  assert.equal(appendText("", "hola"), "hola");
  assert.equal(appendText("Hola", "equipo"), "Hola equipo");
  assert.equal(appendText("Hola ", "equipo"), "Hola equipo");
});

test("the engine is named where it is used, and the cloud fallback is said", () => {
  assert.deepEqual(engineNote({ preference: "auto" }, "sistema"), { where: "En este equipo", cloud: false, note: null });
  const fallback = engineNote({ preference: "auto" }, "openai");
  assert.equal(fallback.where, "En la nube");
  assert.equal(fallback.fallback, true);
  assert.match(fallback.note, /este equipo no está disponible.*OpenAI/);
  const chosen = engineNote({ preference: "openai" }, "openai");
  assert.equal(chosen.fallback, false);
  assert.match(chosen.note, /OpenAI/);
  assert.equal(engineNote({ preference: "auto" }, null), null);
});
