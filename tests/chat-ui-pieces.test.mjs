// Pure pieces of the channels' screens: the box's formatting bar (src/chat/formatText.js), the
// header's comb of the last 24 hours (src/lib/hive.js › bumpPulse) and the bots' blink
// (src/lib/pixelBot.js › lids).
import test from "node:test";
import assert from "node:assert/strict";
import { formatText } from "../src/chat/formatText.js";
import { bumpPulse } from "../src/lib/hive.js";
import { pixelBotSpec } from "../src/lib/pixelBot.js";

test("the formatting bar wraps the selection, or leaves the caret between the marks", () => {
  assert.deepEqual(formatText("hola equipo", 5, 11, "bold"), { text: "hola *equipo*", start: 6, end: 12 });
  assert.deepEqual(formatText("hola ", 5, 5, "italic"), { text: "hola __", start: 6, end: 6 });
  assert.equal(formatText("x", 0, 1, "strike").text, "~x~");
  assert.equal(formatText("npm i", 0, 5, "code").text, "`npm i`");
  assert.equal(formatText("a\nb", 0, 3, "code").text, "```\na\nb\n```", "several lines: a block");
});

test("lists and quotes go on every line the selection touches, and come off when all have them", () => {
  const t = "uno\ndos\ntres";
  assert.equal(formatText(t, 1, 6, "bullets").text, "- uno\n- dos\ntres");
  assert.equal(formatText("- uno\n- dos", 0, 11, "bullets").text, "uno\ndos");
  assert.equal(formatText(t, 0, t.length, "numbers").text, "1. uno\n2. dos\n3. tres");
  assert.equal(formatText("- uno", 0, 5, "quote").text, "> uno", "one prefix replaces another");
});

test("«Enlace» selects what is left to type", () => {
  const a = formatText("mira esto", 5, 9, "link");
  assert.equal(a.text, "mira [esto](https://)");
  assert.equal(a.text.slice(a.start, a.end), "https://");
  const b = formatText("https://colmena.team", 0, 20, "link");
  assert.equal(b.text, "[texto](https://colmena.team)");
  assert.equal(b.text.slice(b.start, b.end), "texto");
});

test("the comb of the last 24 hours moves on with time", () => {
  const H = 3600000, from = 1_000_000_000_000;
  const p = { from, counts: Array(12).fill(0) };
  assert.deepEqual(bumpPulse(p, from + 5 * H).counts, [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // Two hours past the window: the oldest cell drops off, the new message is the last cell.
  const later = bumpPulse({ from, counts: [3, ...Array(11).fill(1)] }, from + 25 * H);
  assert.equal(later.from, from + 2 * H);
  assert.deepEqual(later.counts, [...Array(11).fill(1), 1]);
  // A day later nothing old is left.
  const next = bumpPulse({ from, counts: Array(12).fill(4) }, from + 60 * H);
  assert.equal(next.counts.reduce((a, b) => a + b, 0), 1);
  assert.equal(bumpPulse(null), null);
});

test("a bot's lids cover its eyes only, in the visor's colour", () => {
  for (const size of [20, 24, 32]) {
    const spec = pixelBotSpec({ shape: "hex", color: "#3A5BE8", role: "investigacion", size });
    assert.ok(spec.lids.length > 0, "eyes to close at " + size);
    const plate = new Set(spec.lids.map((r) => r.fill));
    assert.equal(plate.size, 1, "one colour");
    // Every lid sits on a drawn cell (an eye), never outside the body.
    for (const l of spec.lids) assert.ok(spec.rects.some((r) => r.y === l.y && r.x <= l.x && l.x < r.x + r.w), `lid ${l.x},${l.y} on the face`);
  }
});
