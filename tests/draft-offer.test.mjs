import test from "node:test";
import assert from "node:assert/strict";

const memory = new Map();
globalThis.localStorage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const { draftForLater, readDraftEntry, readStash, saveDraft } = await import("../src/lib/composer.js");

test("a draft left in a chat is offered with when it was written", () => {
  assert.equal(readDraftEntry("chat:nora"), null);
  saveDraft("chat:nora", "Hola Nora, mañana te paso");
  const entry = readDraftEntry("chat:nora");
  assert.equal(entry.text, "Hola Nora, mañana te paso");
  assert.ok(entry.at > 0);
  saveDraft("chat:nora", "   ");
  assert.equal(readDraftEntry("chat:nora"), null, "an empty box is no draft");
});

test("«Guardar para después» moves the draft to the Ctrl+S list and out of the chat", () => {
  saveDraft("chat:vera", "Recuérdame revisar el IVA");
  const stashed = draftForLater("chat:vera", "Para Vera");
  assert.equal(stashed.text, "Recuérdame revisar el IVA");
  assert.equal(readStash()[0].label, "Para Vera");
  assert.equal(readDraftEntry("chat:vera"), null);
  assert.equal(draftForLater("chat:vera"), null, "nothing left to keep");
});
