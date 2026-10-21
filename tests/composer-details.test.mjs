import test from "node:test";
import assert from "node:assert/strict";

// The composer helpers use localStorage and Blob, as in the app.
const memory = new Map();
globalThis.localStorage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };

const { PASTE_FILE_AT, pasteKind, pastedFile } = await import("../src/lib/useFileDrop.js");
const { promptHistory, readStash, rememberPrompt, rememberedPrompts, stashPrompt, unstash } = await import("../src/lib/composer.js");

test("a paste of 32 KB or more becomes a file; a long one a card; a short one stays text", () => {
  assert.equal(pasteKind("hola"), null);
  assert.equal(pasteKind("x".repeat(1500), { pasteCards: true }), "card");
  assert.equal(pasteKind("x".repeat(1500)), null, "composers without cards keep long pastes as text");
  assert.equal(pasteKind("x".repeat(PASTE_FILE_AT)), "file");
  assert.equal(pasteKind("ñ".repeat(PASTE_FILE_AT / 2)), "file", "measured in bytes, not characters");
  const small = pastedFile("a".repeat(40000));
  assert.equal(small.encoding, "utf8");
  assert.match(small.name, /^pegado-.*\.txt$/);
  const big = pastedFile("€".repeat(210000));
  assert.equal(big.encoding, "base64", "past what a text attachment carries it goes as base64");
  assert.equal(Buffer.from(big.content, "base64").toString("utf8"), "€".repeat(210000));
});

test("↑ finds what you sent here before, even when it is not loaded, once and newest last", () => {
  rememberPrompt("chat:nora", "primero");
  rememberPrompt("chat:nora", "segundo");
  rememberPrompt("chat:vera", "otra conversación");
  rememberPrompt("chat:nora", "primero");
  assert.deepEqual(rememberedPrompts("chat:nora"), ["segundo", "primero"]);
  const loaded = [{ role: "user", kind: "message", text: "tercero" }, { role: "assistant", text: "respuesta" }, { role: "user", text: "segundo" }];
  assert.deepEqual(promptHistory(rememberedPrompts("chat:nora"), loaded), ["primero", "tercero", "segundo"]);
  assert.deepEqual(rememberedPrompts(null), [], "private chats keep nothing");
});

test("Ctrl+S keeps the draft for later, newest first, and bringing it back takes it out", () => {
  const a = stashPrompt("borrador para Nora", { from: "m1", label: "Para Nora" });
  const b = stashPrompt("otro borrador");
  assert.equal(stashPrompt("   "), null);
  assert.deepEqual(readStash().map((x) => x.text), ["otro borrador", "borrador para Nora"]);
  assert.equal(unstash(a.id).text, "borrador para Nora");
  assert.deepEqual(readStash().map((x) => x.id), [b.id]);
});
