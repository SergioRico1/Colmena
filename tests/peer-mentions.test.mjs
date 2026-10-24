// «@» mentions when two bots have the same name (src/lib/mentions.js): the one you pick
// keeps its owner, one written by hand is yours, and each «@Vera» is drawn with its owner.
import test from "node:test";
import assert from "node:assert/strict";
import { mentions, mentionSegments, resolveMentions } from "../src/lib/mentions.js";

const ME = "a".repeat(43), MARTA = "b".repeat(43);
const myBots = [{ id: "vera", name: "Vera" }, { id: "tomas", name: "Tomás" }];
const martaVera = { owner: MARTA, bot: "vera", name: "Vera" };

test("«@Nombre» is found with or without accents, never inside another word or an address", () => {
  assert.ok(mentions("hola @vera, ¿qué tal?", "Vera"));
  assert.ok(mentions("@tomas mira esto", "Tomás"));
  assert.ok(!mentions("escribe a vera@ejemplo.com", "Vera"));
  assert.ok(!mentions("@Veranito", "Vera"));
});

test("a hand-written «@Vera» is yours; the Vera you picked keeps her owner", () => {
  assert.deepEqual(resolveMentions("@Vera resume esto", [], myBots, ME).map((m) => [m.owner, m.bot]), [[ME, "vera"]]);
  // Picked Marta's: only hers, although you have a Vera too.
  assert.deepEqual(resolveMentions("@Vera ¿qué hotel era?", [martaVera], myBots, ME).map((m) => [m.owner, m.bot]), [[MARTA, "vera"]]);
  // Both picked: both.
  const both = resolveMentions("@Vera y @Vera, poneos de acuerdo", [martaVera, { owner: ME, bot: "vera", name: "Vera" }], myBots, ME);
  assert.deepEqual(both.map((m) => m.owner), [MARTA, ME]);
  // A pick whose name was deleted from the text no longer counts.
  assert.deepEqual(resolveMentions("da igual", [martaVera], myBots, ME), []);
  // Your other bots by hand still count.
  assert.deepEqual(resolveMentions("@Vera y @Tomás", [martaVera], myBots, ME).map((m) => m.bot), ["vera", "tomas"]);
});

test("each «@Vera» in a message is drawn with its own owner", () => {
  const seg = mentionSegments("Hola @Vera y @vera: ¿os coordináis?", [{ ...martaVera, label: "de Marta" }, { owner: ME, bot: "vera", name: "Vera", label: "tuya" }]);
  assert.deepEqual(seg.map((s) => (s.mention ? `[${s.text}·${s.mention.label}]` : s.text)).join(""), "Hola [@Vera·de Marta] y [@vera·tuya]: ¿os coordináis?");
  // Accents do not move the cut.
  const t = mentionSegments("Café con @Tomás ahora", [{ owner: ME, bot: "tomas", name: "Tomás", label: "tuyo" }]);
  assert.deepEqual(t.map((s) => s.text), ["Café con ", "@Tomás", " ahora"]);
  assert.deepEqual(mentionSegments("sin menciones", []), [{ text: "sin menciones" }]);
});
