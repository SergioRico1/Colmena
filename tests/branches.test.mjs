import test from "node:test";
import assert from "node:assert/strict";
import { branchPoints, openBranch, switchTo, visibleMessages } from "../server/branches.mjs";

// A chat as the store keeps it: messages with times; the mission's branch fields change.
const chat = () => {
  let clock = 0;
  const t = () => new Date(Date.UTC(2026, 10, 1) + (clock += 1000)).toISOString();
  const messages = [];
  let mission = { id: "m" };
  const say = (id, role, text) => { messages.push({ id, role, text, at: t() }); };
  const apply = (changes) => { mission = { ...mission, ...changes }; };
  return { messages, say, apply, now: t, get mission() { return mission; } };
};
const texts = (c) => visibleMessages(c.mission, c.messages).map((m) => m.text);

test("a chat that never branched is its single linear branch", () => {
  const c = chat();
  c.say("u1", "user", "hola"); c.say("a1", "assistant", "¡hola!");
  assert.deepEqual(texts(c), ["hola", "¡hola!"]);
  assert.deepEqual(branchPoints(c.mission, c.messages), {});
});

test("editing a message opens a sibling «2/2»; switching shows each version with what followed", () => {
  const c = chat();
  c.say("u1", "user", "precio"); c.say("a1", "assistant", "1.250 €");
  c.say("u2", "user", "¿y con IVA?"); c.say("a2", "assistant", "1.512,50 €");
  // Edit u2: from there on, a new branch.
  const { changes } = openBranch(c.mission, c.messages, "u2", c.now());
  c.apply(changes);
  c.say("u2b", "user", "¿y sin IVA?"); c.say("a2b", "assistant", "1.250 €");
  assert.deepEqual(texts(c), ["precio", "1.250 €", "¿y sin IVA?", "1.250 €"], "the bot sees only this path");
  assert.deepEqual(branchPoints(c.mission, c.messages), { u2b: { index: 2, count: 2, ids: ["u2", "u2b"] } });
  // Back to the first version: the old answer is there.
  c.apply(switchTo(c.mission, c.messages, "u2", c.now()));
  assert.deepEqual(texts(c), ["precio", "1.250 €", "¿y con IVA?", "1.512,50 €"]);
  assert.deepEqual(branchPoints(c.mission, c.messages).u2, { index: 1, count: 2, ids: ["u2", "u2b"] });
  // Writing there continues the first version.
  c.say("u3", "user", "gracias");
  assert.deepEqual(texts(c).slice(-2), ["1.512,50 €", "gracias"]);
  c.apply(switchTo(c.mission, c.messages, "u2b", c.now()));
  assert.deepEqual(texts(c).slice(-1), ["1.250 €"]);
});

test("editing a replacement adds a third version of the same spot", () => {
  const c = chat();
  c.say("u1", "user", "uno"); c.say("a1", "assistant", "A");
  c.apply(openBranch(c.mission, c.messages, "u1", c.now()).changes);
  c.say("u1b", "user", "dos"); c.say("a1b", "assistant", "B");
  c.apply(openBranch(c.mission, c.messages, "u1b", c.now()).changes);
  c.say("u1c", "user", "tres"); c.say("a1c", "assistant", "C");
  assert.deepEqual(branchPoints(c.mission, c.messages).u1c, { index: 3, count: 3, ids: ["u1", "u1b", "u1c"] });
  assert.deepEqual(texts(c), ["tres", "C"]);
});

test("«Otra respuesta» is a sibling of the answer; your message stays shared", () => {
  const c = chat();
  c.say("u1", "user", "un título"); c.say("a1", "assistant", "Título A");
  c.apply(openBranch(c.mission, c.messages, "a1", c.now()).changes);
  c.say("a1b", "assistant", "Título B");
  assert.deepEqual(texts(c), ["un título", "Título B"]);
  assert.deepEqual(branchPoints(c.mission, c.messages).a1b, { index: 2, count: 2, ids: ["a1", "a1b"] });
});

test("going back to a version returns to where you were below it", () => {
  const c = chat();
  c.say("u1", "user", "uno"); c.say("a1", "assistant", "A");
  c.say("u2", "user", "dos"); c.say("a2", "assistant", "B");
  c.apply(openBranch(c.mission, c.messages, "u1", c.now()).changes);
  c.say("u1b", "user", "UNO"); c.say("a1b", "assistant", "A'");
  c.say("u2b", "user", "DOS"); c.say("a2b", "assistant", "B'");
  // Below the new version, edit again deeper.
  c.apply(openBranch(c.mission, c.messages, "u2b", c.now()).changes);
  c.say("u2c", "user", "DOS bis");
  c.apply(switchTo(c.mission, c.messages, "u1", c.now()));
  assert.deepEqual(texts(c), ["uno", "A", "dos", "B"]);
  c.apply(switchTo(c.mission, c.messages, "u1b", c.now()));
  assert.deepEqual(texts(c), ["UNO", "A'", "DOS bis"], "back where you left that version");
});
