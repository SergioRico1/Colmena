import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, rank } from "../src/lib/palette.js";

// The Ctrl+K palette (src/screens/CommandPalette.jsx): «>» means actions only, and T3 Code's
// ranking (every word must appear; the title weighs more; ties keep the recent first).

test("«>» shows only actions; anything else searches everything", () => {
  assert.deepEqual(parseQuery(">"), { actionsOnly: true, query: "" });
  assert.deepEqual(parseQuery("  > nuevo  chat"), { actionsOnly: true, query: "nuevo  chat" });
  assert.deepEqual(parseQuery("factura >"), { actionsOnly: false, query: "factura >" });
  assert.deepEqual(parseQuery(""), { actionsOnly: false, query: "" });
});

test("ranking: every word must appear, the title wins, accents do not matter", () => {
  const items = [
    { id: "a", terms: ["Informe del trimestre", "#informe-q3"] },
    { id: "b", terms: ["Facturas", "revisa el informe de facturas"] },
    { id: "c", terms: ["Informe"] },
    { id: "d", terms: ["Campaña de primavera"] },
  ];
  assert.deepEqual(rank(items, "informe").map((x) => x.id), ["c", "a", "b"], "exact title, then title that starts so, then a later term");
  assert.deepEqual(rank(items, "campana").map((x) => x.id), ["d"]);
  assert.deepEqual(rank(items, "informe facturas").map((x) => x.id), ["b"], "both words, in any term");
  assert.deepEqual(rank(items, "zzz"), []);
  assert.equal(rank(items, "").length, 4, "no query keeps the list as it is");
});

test("ranking keeps the original (recent first) order on a tie", () => {
  const items = [{ id: "new", terms: ["Cierre de mes"] }, { id: "old", terms: ["Cierre de mes"] }];
  assert.deepEqual(rank(items, "cierre").map((x) => x.id), ["new", "old"]);
});
