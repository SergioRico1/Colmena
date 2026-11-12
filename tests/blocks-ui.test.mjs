import test from "node:test";
import assert from "node:assert/strict";
import {
  agoLabel, asOfLabel, blockIdOf, cellText, deltaLabel, externalHref, formatNumber, formatValue, hostOf, isStale, moveOptions, movedIds, progressPercent,
  sinceLabel, sourceLabel, sparklineEnd, sparklinePath, updatedLabel,
} from "../src/lib/blocks.js";

const NBSP = "\u00a0", MINUS = "\u2212";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

test("numbers are written here, the Spanish way; text is never taken pre-formatted", () => {
  assert.equal(formatNumber(1234.5), "1.234,5");
  assert.equal(formatNumber(1234), "1.234", "four digits are grouped too");
  assert.equal(formatNumber(1234567.891), "1.234.567,89");
  assert.equal(formatNumber(0.126), "0,13");
  assert.equal(formatNumber(-42), MINUS + "42");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber("<b>1</b>"), "—", "only numbers are numbers");
  assert.equal(formatNumber(NaN), "—");
  assert.equal(formatValue(1234.5, "€"), "1.234,5" + NBSP + "€");
  assert.equal(formatValue(12, "%"), "12" + NBSP + "%");
  assert.equal(formatValue(7, ""), "7");
  assert.equal(formatValue(null, "€"), "—");
  assert.equal(cellText(1500), "1.500");
  assert.equal(cellText("Acme S.L."), "Acme S.L.");
  assert.equal(cellText(null), "—");
  assert.equal(cellText(""), "—");
  assert.equal(cellText(0), "0");
});

test("the delta says how much, which way and whether that is good", () => {
  assert.deepEqual(deltaLabel({ change: 50, percent: 25, direction: "up", good: true }, "€"),
    { text: "+50" + NBSP + "€ · +25" + NBSP + "%", tone: "good", direction: "up", spoken: "Sube 50" + NBSP + "€ (25" + NBSP + "%) respecto a la vez anterior" });
  const down = deltaLabel({ change: -3, percent: -12.5, direction: "down", good: true }, "tickets");
  assert.deepEqual([down.text, down.tone, down.spoken], [MINUS + "3" + NBSP + "tickets · " + MINUS + "12,5" + NBSP + "%", "good", "Baja 3" + NBSP + "tickets (12,5" + NBSP + "%) respecto a la vez anterior"]);
  assert.equal(deltaLabel({ change: -3, percent: -12.5, direction: "down", good: false }, "").tone, "bad");
  // A percentage moves in points, without a percentage of a percentage.
  assert.equal(deltaLabel({ change: 2, percent: 50, direction: "up", good: true }, "%").text, "+2" + NBSP + "pt");
  assert.equal(deltaLabel({ change: 5, percent: null, direction: "up", good: true }, "").text, "+5");
  assert.deepEqual(deltaLabel({ change: 0, percent: 0, direction: "flat", good: null }, "€"), { text: "Sin cambios", tone: "flat", direction: "flat", spoken: "Igual que la vez anterior" });
  assert.equal(deltaLabel(null, "€"), null);
});

test("the sparkline path spans the box, flips the axis and survives flat or missing data", () => {
  assert.equal(sparklinePath([0, 10], 100, 20, 0), "M0 20L100 0");
  assert.equal(sparklinePath([1, 3, 2], 120, 32, 2), "M2 30L60 2L118 16");
  assert.equal(sparklinePath([5, 5, 5], 100, 20, 0), "M0 10L50 10L100 10", "equal values: a flat line through the middle");
  assert.equal(sparklinePath([7]), null);
  assert.equal(sparklinePath([]), null);
  assert.equal(sparklinePath(null), null);
  assert.equal(sparklinePath([1, "2", NaN, 3], 100, 20, 0), "M0 20L100 0", "only numbers count");
  assert.deepEqual(sparklineEnd([1, 3, 2], 120, 32, 2), { x: 118, y: 16 });
  assert.equal(sparklineEnd([1]), null);
  const long = sparklinePath(Array.from({ length: 30 }, (_, i) => Math.sin(i)), 120, 32, 2);
  assert.equal(long.split("L").length, 30);
  assert.ok(!/NaN|Infinity/.test(long));
});

test("progress stays between 0 and 100", () => {
  assert.equal(progressPercent(7, 12), 58);
  assert.equal(progressPercent(15, 12), 100);
  assert.equal(progressPercent(-1, 12), 0);
  assert.equal(progressPercent(1, 0), 0);
  assert.equal(progressPercent("1", 2), 0);
});

test("«hace 2 h» while fresh; «Sin actualizar desde…» once stale", () => {
  const now = new Date(2026, 10, 12, 10, 0).getTime(); // 12 Nov 2026, 10:00 local
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(agoLabel(at(20_000), now), "ahora mismo");
  assert.equal(agoLabel(at(5 * MIN), now), "hace 5 min");
  assert.equal(agoLabel(at(2 * HOUR + 10 * MIN), now), "hace 2 h");
  assert.equal(agoLabel(at(3 * DAY), now), "hace 3 d");
  assert.equal(agoLabel("", now), "");
  assert.equal(sinceLabel(at(2 * HOUR), now), "hoy a las 08:00");
  assert.equal(sinceLabel(at(26 * HOUR), now), "ayer a las 08:00");
  assert.equal(sinceLabel(at(5 * DAY), now), "el 7 nov");
  assert.equal(sinceLabel(new Date(2025, 11, 30, 9, 0).toISOString(), now), "el 30 dic 2025");

  const block = (ms, staleAfterMs) => ({ updatedAt: at(ms), staleAfterMs });
  // A daily routine: stale after two days.
  assert.equal(isStale(block(47 * HOUR, 2 * DAY), now), false);
  assert.equal(isStale(block(49 * HOUR, 2 * DAY), now), true);
  // An hourly one: stale after two hours.
  assert.equal(isStale(block(119 * MIN, 2 * HOUR), now), false);
  assert.equal(isStale(block(121 * MIN, 2 * HOUR), now), true);
  // No figure from the server: 48 h.
  assert.equal(isStale(block(47 * HOUR, 0), now), false);
  assert.equal(isStale(block(49 * HOUR, undefined), now), true);
  assert.equal(isStale({}, now), true);
  assert.equal(updatedLabel(block(2 * HOUR, 2 * DAY), now), "Actualizado hace 2 h");
  assert.equal(updatedLabel(block(26 * HOUR, 2 * HOUR), now), "Sin actualizar desde ayer a las 08:00");
  assert.equal(updatedLabel(block(5 * DAY, 2 * DAY), now), "Sin actualizar desde el 7 nov");
  assert.equal(asOfLabel("2026-11-11T00:00:00.000Z", now), "Dato del 11 nov", "a date without a time is that day in any time zone");
  assert.match(asOfLabel(new Date(2026, 10, 11, 18, 30).toISOString(), now), /^Dato del 11 nov, 18:30$/);
  assert.equal(asOfLabel("", now), "");
});

test("who keeps a block, where it can move, and which message carries it", () => {
  assert.equal(sourceLabel({ source: { botName: "Nora", routine: "Ventas cada mañana" } }), "Nora · Ventas cada mañana");
  assert.equal(sourceLabel({ source: { botName: "Nora" } }), "Nora");
  assert.equal(sourceLabel({ source: { botName: "Nora", routineGone: true } }), "Nora · su rutina ya no existe");
  assert.equal(sourceLabel({ source: {} }), "Un bot que ya no está");
  assert.deepEqual(moveOptions(["a", "b", "c"], "a"), { up: false, down: true, position: 1, total: 3 });
  assert.deepEqual(moveOptions(["a", "b", "c"], "c"), { up: true, down: false, position: 3, total: 3 });
  assert.deepEqual(moveOptions(["a"], "a"), { up: false, down: false, position: 1, total: 1 });
  assert.deepEqual(moveOptions(["a"], "zz"), { up: false, down: false, position: 0, total: 1 });
  const ids = ["a", "b", "c"];
  assert.deepEqual(movedIds(ids, "c", "up"), ["a", "c", "b"]);
  assert.deepEqual(movedIds(ids, "a", "down"), ["b", "a", "c"]);
  assert.equal(movedIds(ids, "a", "up"), ids, "cannot move: the same list");
  assert.equal(movedIds(ids, "c", "down"), ids);
  assert.equal(movedIds(ids, "zz", "up"), ids);
  assert.equal(blockIdOf({ id: "block:abc-1", kind: "block" }), "abc-1");
  assert.equal(blockIdOf({ id: "block:abc-1", kind: "activity" }), null);
  assert.equal(blockIdOf({ id: "note:x", kind: "block" }), null);
  assert.equal(blockIdOf(null), null);
});

test("a link opens outside only when it is http or https", () => {
  assert.equal(externalHref("https://tienda.test/ventas?d=1"), "https://tienda.test/ventas?d=1");
  assert.equal(externalHref("http://tienda.test"), "http://tienda.test/");
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "file:///c:/x", "colmena://x", "/ajustes", "https://ana:clave@tienda.test/", "", null, 7])
    assert.equal(externalHref(bad), null, String(bad));
  assert.equal(hostOf("https://www.tienda.test/ventas"), "tienda.test");
  assert.equal(hostOf("nada"), "");
});
