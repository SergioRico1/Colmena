import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// One honey element per decision (critique 2026-11-13, P2). Honey #FFC93C means only «te
// necesita»: one action per decision, explanations and counts of other things stay neutral.
const src = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("a room-level decision has one action: the banner, not the header too", () => {
  const room = src("src/screens/Room.jsx");
  assert.ok(!/>\{"Elegir propuesta"\}<\/a>/.test(room), "the header no longer repeats «Elegir propuesta»");
  assert.match(room, /mission\.status !== "awaiting_choice" \? <a href=\{`\/debate\//, "a debate that does not wait for you keeps a neutral way to its proposals");
  const parts = src("src/components/room/RoomParts.jsx");
  assert.match(parts, /!first \? "Elegir propuesta" : first\.kind === "plan" \? "Revisar el plan"/, "the banner's own action says what it does");
});

test("a colleague's request to your bot: the card only, no honey line above it", () => {
  const room = src("src/screens/Room.jsx");
  assert.ok(!room.includes('" · decidir"'), "no «Vera espera tu OK · decidir» line");
  assert.ok(!/renderForeign[\s\S]{0,1600}#FFC93C/.test(room), "nothing honey among the people's messages");
});

test("Revisar explains in neutral; the skills to review and the room's unread are not honey", () => {
  const revisar = src("src/screens/Revisar.jsx");
  const why = revisar.slice(revisar.indexOf('{"Por qué te pregunta"}') - 120, revisar.indexOf('{"Por qué te pregunta"}'));
  assert.ok(!/FFF6DC|FFC93C|FFF1C7/.test(why), "«Por qué te pregunta» is explanation");
  assert.match(revisar, /background: "#FFC93C", [^>]*>\{"Te necesita"\}/, "honey stays on the «Te necesita» chip");
  const library = src("src/screens/ArchivoV2.jsx");
  assert.ok(!/por revisar`\} style=\{\{[^}]*#FFC93C/.test(library), "«Habilidades 1» is a neutral count");
  assert.ok(!src("src/components/v3/library/Skills.jsx").includes("#FFC93C"));
  const sidebar = src("src/components/v3/Sidebar.jsx");
  assert.match(sidebar, /\{r\.unread \? <Count n=\{r\.unread\} \/> : null\}/, "a room's unread count is dark on light");
});
