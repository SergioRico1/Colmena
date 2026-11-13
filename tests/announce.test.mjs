import test from "node:test";
import assert from "node:assert/strict";
import { announcement, createAnnouncer, fresh, spoken } from "../src/lib/announce.js";
import { nearest, rowStep } from "../src/lib/messageKeys.js";
import { botAlt, botsAlt } from "../src/lib/alt.js";

// What a conversation says to a screen reader (rooms, 1:1 chats, chats with people).

test("one finished message is said with its author and its first words", () => {
  assert.equal(announcement([{ name: "Nora", text: "Comparativa lista." }]), "Nora: Comparativa lista.");
  assert.equal(announcement([{ name: "Nora", text: "" }]), "Mensaje nuevo de Nora");
  assert.equal(announcement([]), "");
});

test("the text is spoken plain and cut near 120 characters at a word", () => {
  assert.equal(spoken("## Resultado\n\n- **Ventas**: `12 %` más. [Fuente](https://ejemplo.invalid)"), "Resultado Ventas: 12 % más. Fuente");
  assert.equal(spoken("Mira:\n```js\nconst a = 1;\n```\nlisto"), "Mira: (código) listo");
  const long = "palabra ".repeat(40).trim();
  const cut = spoken(long);
  assert.ok(cut.length <= 121, String(cut.length));
  assert.ok(cut.endsWith("…"));
  assert.ok(!cut.includes("palabr…"), "never cuts inside a word");
  assert.equal(spoken("x".repeat(300)).length, 121, "a single long word is cut hard");
  assert.equal(spoken(null), "");
});

test("several arrivals are one count with who wrote, not one line each", () => {
  const items = [{ name: "Nora", text: "a" }, { name: "Vera", text: "b" }, { name: "Nora", text: "c" }];
  assert.equal(announcement(items), "3 mensajes nuevos de Nora y Vera");
  const many = ["Nora", "Vera", "Tomás", "Iris"].map((name) => ({ name, text: "x" }));
  assert.equal(announcement(many), "4 mensajes nuevos de Nora, Vera y Tomás y más");
});

test("what starts waiting is said by name", () => {
  assert.equal(announcement([], [{ name: "Vera", kind: "send" }]), "Vera espera tu OK");
  assert.equal(announcement([], [{ name: "Tomás", kind: "question" }]), "Tomás te pregunta algo");
  assert.equal(announcement([], [{ name: "" }]), "Algo espera tu OK");
  assert.equal(announcement([], [{ name: "Vera" }, { name: "Tomás" }]), "Vera y Tomás esperan tu OK");
  assert.equal(announcement([], [{ name: "Vera" }, { name: "Vera" }]), "Vera espera tu OK en 2 cosas");
  assert.equal(announcement([], [{ name: "Vera" }, { name: "Tomás" }, { name: "Iris" }]), "3 cosas esperan tu OK");
  assert.equal(announcement([{ name: "Nora", text: "Hecho" }], [{ name: "Vera" }]), "Nora: Hecho. Vera espera tu OK");
});

test("fresh: each message once, when it is finished, never the person's own", () => {
  const seen = new Set();
  // What is there when the conversation opens is only marked.
  fresh(seen, [{ id: "1" }, { id: "2", skip: true }]);
  assert.deepEqual(fresh(seen, [{ id: "1" }, { id: "2", skip: true }]), []);
  // A message being written is not said, however many times it is looked at…
  const writing = { id: "3", name: "Nora", text: "Compa", done: false };
  assert.deepEqual(fresh(seen, [{ id: "1" }, writing]), []);
  assert.deepEqual(fresh(seen, [{ id: "1" }, { ...writing, text: "Comparativa" }]), []);
  // …and once when it ends.
  const done = { id: "3", name: "Nora", text: "Comparativa lista.", done: true };
  assert.deepEqual(fresh(seen, [{ id: "1" }, done]), [done]);
  assert.deepEqual(fresh(seen, [{ id: "1" }, done]), []);
  // Yours is marked and never said; a row without an id is ignored.
  assert.deepEqual(fresh(seen, [{ id: "4", skip: true }, { name: "x" }, null]), []);
  assert.deepEqual(fresh(seen, [{ id: "4", skip: true }]), []);
});

function clock() {
  let next = 1;
  const pending = new Map();
  return {
    timers: { set: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; }, clear: (id) => pending.delete(id) },
    run() { const all = [...pending.values()]; pending.clear(); for (const t of all) t.fn(); },
    get size() { return pending.size; },
    get delays() { return [...pending.values()].map((t) => t.ms); },
  };
}

test("the announcer batches what arrives together into one line", () => {
  const said = [], c = clock();
  const a = createAnnouncer({ say: (line) => said.push(line), delay: 1200, timers: c.timers });
  a.add([{ name: "Nora", text: "uno" }]);
  a.add([{ name: "Vera", text: "dos" }]);
  a.add([{ name: "Nora", text: "tres" }]);
  assert.equal(c.size, 1, "one timer, restarted by each arrival");
  assert.deepEqual(c.delays, [1200]);
  assert.deepEqual(said, [], "nothing is said until the moment passes");
  c.run();
  assert.deepEqual(said, ["3 mensajes nuevos de Nora y Vera"]);
  // The next arrival alone is said in full.
  a.add([{ name: "Vera", text: "Resumen listo" }]);
  c.run();
  assert.deepEqual(said, ["3 mensajes nuevos de Nora y Vera", "Vera: Resumen listo"]);
});

test("the announcer says waiting with the messages, and nothing when nothing came", () => {
  const said = [], c = clock();
  const a = createAnnouncer({ say: (line) => said.push(line), timers: c.timers });
  a.add([], []);
  assert.equal(c.size, 0, "no timer for nothing");
  a.add([{ name: "Tomás", text: "¿Cómo las trato?" }], [{ name: "Tomás", kind: "question" }]);
  c.run();
  assert.deepEqual(said, ["Tomás: ¿Cómo las trato?. Tomás te pregunta algo"]);
  a.add([{ name: "Nora", text: "x" }]);
  assert.equal(a.pending, 1);
  a.cancel();
  assert.equal(c.size, 0);
  c.run();
  assert.equal(said.length, 1, "a cancelled batch is never said");
  a.add([{ name: "Nora", text: "y" }]);
  a.flush();
  assert.deepEqual(said[1], "Nora: y");
  assert.equal(c.size, 0, "flush leaves no timer behind");
});

test("arrows move between messages; from the list they enter at the nearest end", () => {
  assert.equal(rowStep(5, -1, "ArrowUp"), 4, "from the list, up lands on the newest");
  assert.equal(rowStep(5, -1, "ArrowDown"), 0);
  assert.equal(rowStep(5, 2, "ArrowUp"), 1);
  assert.equal(rowStep(5, 2, "ArrowDown"), 3);
  assert.equal(rowStep(5, 0, "ArrowUp"), 0, "stays at the first");
  assert.equal(rowStep(5, 4, "ArrowDown"), 4, "stays at the last");
  assert.equal(rowStep(5, 2, "Home"), 0);
  assert.equal(rowStep(5, 2, "End"), 4);
  assert.equal(rowStep(0, -1, "ArrowUp"), -1, "an empty list has nowhere to go");
  assert.equal(rowStep(5, 2, "Enter"), null, "other keys are not the list's");
  assert.equal(rowStep(5, 2, "Tab"), null, "Tab goes on to the message's own actions");
});

test("nearest: the closest match around an element, never past the dialog or the content", () => {
  const list = { id: "list" };
  const node = (parent, found = null, stops = false) => ({ parentElement: parent, querySelector: () => found, matches: () => stops });
  const content = node(null, list, true);
  const form = node(content);
  const field = node(form);
  assert.equal(nearest(field, "[data-message-list]"), list);
  const dialog = node(node(null, list), null, true);
  assert.equal(nearest(node(dialog), "[data-message-list]"), null, "a composer in a dialog does not reach the page behind");
  assert.equal(nearest(null, "x"), null);
});

test("a bot is named with the word «bot», its owner when not yours, and its state as a word", () => {
  assert.equal(botAlt({ name: "Vera" }), "Vera, bot");
  assert.equal(botAlt({ name: "Vera" }, { owner: { name: "Lucía Martín", you: false } }), "Vera, bot de Lucía");
  assert.equal(botAlt({ name: "Vera" }, { owner: { name: "Sergio", you: true } }), "Vera, bot");
  assert.equal(botAlt({ name: "Nora" }, { state: "work" }), "Nora, bot, trabajando");
  assert.equal(botAlt({ name: "Tomás" }, { state: "wait" }), "Tomás, bot, te espera");
  assert.equal(botAlt({ name: "Iris" }, { state: "rest" }), "Iris, bot");
  assert.equal(botAlt(null), "Bot, bot");
});

test("a stack of bot marks reads as a list of names", () => {
  assert.equal(botsAlt([{ name: "Nora" }]), "Bot: Nora");
  assert.equal(botsAlt([{ b: { name: "Nora" }, work: true }, { b: { name: "Tomás" }, work: false }]), "Bots: Nora (trabajando) y Tomás");
  assert.equal(botsAlt([{ bot: { name: "Leo" }, owner: { name: "Lucía Martín" }, state: "thinking" }, { name: "Vera" }, { name: "Iris" }]), "Bots: Leo (de Lucía, pensando), Vera y Iris");
  assert.equal(botsAlt([]), "");
  assert.equal(botsAlt([null, undefined]), "");
});
