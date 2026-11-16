import test from "node:test";
import assert from "node:assert/strict";
import { withMine } from "../src/chat/reactions.js";

test("a reaction shows at the click, before the server answers", () => {
  const server = [{ emoji: "👍", people: ["ana"], count: 1 }];
  assert.deepEqual(withMine(server, { "👍": true }, "me"), [{ emoji: "👍", people: ["ana", "me"], count: 2 }]);
  assert.deepEqual(withMine(server, { "🎉": true }, "me"), [server[0], { emoji: "🎉", people: ["me"], count: 1 }]);
  assert.deepEqual(server, [{ emoji: "👍", people: ["ana"], count: 1 }], "the server's view is not changed");
});

test("taking a reaction back hides it at once; the last one goes away", () => {
  const server = [{ emoji: "👍", people: ["ana", "me"], count: 2 }, { emoji: "🔥", people: ["me"], count: 1 }];
  assert.deepEqual(withMine(server, { "👍": false, "🔥": false }, "me"), [{ emoji: "👍", people: ["ana"], count: 1 }]);
});

test("a click the server already shows changes nothing", () => {
  const server = [{ emoji: "👍", people: ["me"], count: 1 }];
  assert.deepEqual(withMine(server, { "👍": true, "👀": false }, "me"), server);
  assert.deepEqual(withMine(undefined, {}, "me"), []);
});
