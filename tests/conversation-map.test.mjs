import test from "node:test";
import assert from "node:assert/strict";
import { conversationMap } from "../server/history.mjs";

test("one entry per message of yours, titled by it and previewed by its answer", () => {
  const at = (i) => new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString();
  const map = conversationMap([
    { id: "u1", role: "user", kind: "message", text: "¿Qué es **Verifactu**?", at: at(1) },
    { id: "p1", role: "assistant", kind: "progress", text: "Miro la AEAT", at: at(2) },
    { id: "a1", role: "assistant", kind: "message", text: "Es el sistema de [la AEAT](https://aeat.es) para…", at: at(3) },
    { id: "a1b", role: "assistant", kind: "message", text: "Y además…", at: at(4) },
    { id: "r1", role: "user", kind: "message", text: "respuesta en hilo", replyTo: "a1", at: at(5) },
    { id: "u2", role: "user", kind: "message", text: "x".repeat(200), at: at(6) },
  ]);
  assert.deepEqual(map.map((t) => t.id), ["u1", "u2"], "thread replies are not turns");
  assert.equal(map[0].title, "¿Qué es Verifactu?");
  assert.equal(map[0].preview, "Es el sistema de la AEAT para…", "the first answer, without Markdown");
  assert.ok(map[1].title.length <= 72 && map[1].title.endsWith("…"));
  assert.equal(map[1].preview, null, "not answered yet");
});
