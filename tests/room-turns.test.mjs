import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { addressees, passedTo, siblingNote, speechCut, quietReply, STOP_RE } from "../server/roomturns.mjs";
import { narrationDue, cleanNarration, narrationInput } from "../server/narration.mjs";
import { splitStable, repairTail } from "../src/lib/streaming.js";

const MEMBERS = [{ id: "nora", name: "Nora" }, { id: "tomas", name: "Tomás" }, { id: "atlas", name: "Atlas" }];

test("addressees: @names in order, @todos, a name first with a comma; a name in prose does not count", () => {
  assert.deepEqual(addressees("@Tomás y @Nora, ¿qué opináis?", MEMBERS), ["tomas", "nora"]);
  assert.deepEqual(addressees("@tomas mira esto", MEMBERS), ["tomas"], "accents and case do not matter");
  assert.deepEqual(addressees("@todos: reunión a las 5", MEMBERS), ["nora", "tomas", "atlas"]);
  assert.deepEqual(addressees("Nora, revisa el contrato", MEMBERS), ["nora"]);
  assert.deepEqual(addressees("Dile a Nora que lo revise", MEMBERS), [], "prose is not a mention");
  assert.deepEqual(addressees("@Noralia hola", MEMBERS), [], "a longer word is another name");
});

test("passing the word: teammates named with @ in an answer, never itself, at most two", () => {
  assert.deepEqual(passedTo("Lo miro yo. @Tomás, ¿tienes los costes? @Nora también", MEMBERS, { self: "nora" }), ["tomas"]);
  assert.deepEqual(passedTo("@Atlas @Tomás @Nora", MEMBERS, { self: "x" }), ["atlas", "tomas"]);
});

test("siblings: later bots see what earlier ones said, with the rule to add only what is new", () => {
  const steps = [
    { id: "a", chain: "c1", botId: "nora", status: "completed", text: "Yo iría al museo." },
    { id: "b", chain: "c1", botId: "tomas", status: "pending" },
  ];
  const note = siblingNote(steps, steps[1], (b) => (b === "nora" ? "Nora" : b));
  assert.match(note, /Nora: «Yo iría al museo\.»/);
  assert.match(note, /\[SIN NOVEDADES\]/);
  assert.equal(siblingNote(steps, steps[0], (b) => b), "", "the first one has nobody before it");
  assert.equal(quietReply("[SIN NOVEDADES]").quiet, true);
  assert.equal(quietReply("Yo añadiría el parque.").quiet, false);
});

test("speech parts: cut at a paragraph past 800 characters, never inside code or an indented continuation", () => {
  const para = (n) => ("Frase de relleno número " + n + ". ").repeat(12).trim();
  const text = [para(1), para(2), para(3), "Siguiente"].join("\n\n");
  const cut = speechCut(text, 0);
  assert.ok(cut > 800 && cut < text.length, "cut " + cut);
  assert.equal(text.slice(cut).startsWith("Frase") || text.slice(cut).startsWith("Siguiente"), true);
  const code = "```js\n" + "x = 1\n\n".repeat(200) + "```";
  assert.equal(speechCut(code + "\n\nFin", 0) > code.length, true, "the only cut is after the code block");
  assert.equal(speechCut("x".repeat(900) + "\n\n   sigue el punto", 0), -1, "an indented continuation stays with its paragraph");
  assert.equal(speechCut("corto\n\nnada", 0), -1);
});

test("stop words: «para», «detente», «stop»… alone, not inside a sentence", () => {
  for (const w of ["para", "Para.", "detente", "STOP", "basta!", "párate"]) assert.ok(STOP_RE.test(w), w);
  for (const w of ["para mañana", "no pares", "stop motion"]) assert.ok(!STOP_RE.test(w), w);
});

test("narration: due after 20 s of work, every 15 s, one clean line from labels only", () => {
  const t0 = Date.parse("2026-10-17T10:00:00Z");
  const step = { status: "running", startedAt: new Date(t0).toISOString(), activity: [{ tool: "web_fetch", label: "Leyó tarifas.es", status: "done", output: "SECRETO" }] };
  assert.equal(narrationDue(step, t0 + 10000), false);
  assert.equal(narrationDue(step, t0 + 21000), true);
  assert.equal(narrationDue({ ...step, narration: { at: new Date(t0 + 15000).toISOString() } }, t0 + 21000), false);
  assert.ok(!JSON.stringify(narrationInput(step, { name: "Nora" })).includes("SECRETO"), "tool outputs never go to the narrator");
  assert.equal(cleanNarration("«Ya tengo dos tarifas; me falta la de Iberdrola»\nOtra"), "Ya tengo dos tarifas; me falta la de Iberdrola");
  assert.equal(cleanNarration("  "), null);
});

test("live markdown: the finished part stops at the last blank line outside code; the tail is closed", () => {
  assert.deepEqual(splitStable("Uno.\n\nDos a me"), ["Uno.\n\n", "Dos a me"]);
  assert.deepEqual(splitStable("```\na\n\nb"), ["", "```\na\n\nb"], "no cut inside an open code block");
  assert.equal(repairTail("Esto es **importante"), "Esto es **importante**");
  assert.equal(repairTail("Mira [la web](https://exa"), "Mira la web");
  assert.equal(repairTail("```js\nconst a = 1"), "```js\nconst a = 1\n```");
  assert.equal(repairTail("Lista:\n- ").trim(), "Lista:");
});

test("several bots named: they answer one after another, the second sees the first and may stay quiet", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const text = JSON.stringify(input);
    seen.push(text);
    if (seen.length === 1) return answer("Hola, ¿en qué os ayudo?");
    if (/Tus compañeros ya han respondido/.test(text)) return answer("[SIN NOVEDADES]");
    return answer("Yo iría al museo.");
  });
  const m = runtime.create({ prompt: "Planes para el domingo", mode: "solo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  runtime.addMessage(m.id, "@Nora y @Tomás, ¿qué hacemos?");
  await settle(runtime);
  const turns = runtime.steps(m.id).filter((s) => s.kind === "followup");
  assert.deepEqual(turns.map((s) => s.botId), ["nora", "tomas"]);
  assert.equal(turns[0].chain, turns[1].chain);
  assert.match(seen[1], /Este mensaje es para varios: Nora, Tomás/);
  assert.match(seen[2], /Nora: «Yo iría al museo\.»/);
  assert.equal(turns[1].quietReply, true);
  const said = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant").map((x) => x.text);
  assert.deepEqual(said, ["Hola, ¿en qué os ayudo?", "Yo iría al museo."], "the quiet teammate posts nothing");
  const user = store.list("messages").find((x) => x.role === "user" && x.text.startsWith("@Nora"));
  assert.deepEqual(user.to, ["nora", "tomas"]);
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("an @mention in a bot's answer passes the word, within the rounds limit", async (t) => {
  let calls = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    calls++;
    const text = JSON.stringify(input);
    if (calls === 1) return answer("Listo.");
    if (/te menciona en la sala/.test(text)) return answer("Los costes son 1.200 €. @Nora ya lo tienes.");
    return answer("Necesito los costes: @Tomás, ¿me los pasas?");
  });
  const m = runtime.create({ prompt: "Presupuesto", mode: "solo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  runtime.addMessage(m.id, "@Nora prepara el presupuesto");
  await settle(runtime);
  const turns = runtime.steps(m.id).filter((s) => s.kind === "followup");
  assert.deepEqual(turns.map((s) => [s.botId, s.round]), [["nora", 1], ["tomas", 2], ["nora", 3]], "Nora → Tomás → Nora, then the limit");
  const said = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant").map((x) => x.text);
  assert.ok(said.some((x) => x.includes("1.200")), JSON.stringify(said));
});

test("a message for a teammate does not steer or get a 👍 from the bot at work", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("Hecho."));
  const m = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  const msg = store.put("messages", { id: "m-x", missionId: m.id, role: "user", text: "@Tomás mira esto", kind: "message", to: ["tomas"], at: new Date(Date.now() + 1000).toISOString() });
  const step = { id: "s1", botId: "nora", roundAt: new Date().toISOString(), ackOn: null };
  assert.equal(runtime.steeredSince(m.id, step), false, "not for Nora");
  assert.equal(runtime.steeredSince(m.id, { ...step, botId: "tomas" }), true, "for Tomás");
  void msg;
});

test("«para» while they work stops the room (paused, nothing lost)", async (t) => {
  let release;
  const { store, runtime } = await fixture(t, ({ signal }) => new Promise((resolve, reject) => {
    release = resolve;
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const m = runtime.create({ prompt: "Trabajo largo", mode: "solo", botIds: ["nora"] });
  const job = runtime.launch(m.id);
  for (let i = 0; i < 20 && !runtime.active.has(m.id); i++) await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20 && store.get("missions", m.id).status !== "running"; i++) await new Promise((r) => setTimeout(r, 5));
  const said = runtime.addMessage(m.id, "para");
  assert.equal(said.stop, true);
  await job.catch(() => {});
  assert.equal(store.get("missions", m.id).status, "paused");
  void release;
});

test("rooms say long answers in parts as they are written", async (t) => {
  const para = (n) => ("Parte " + n + " de la explicación con detalle suficiente. ").repeat(14).trim();
  const full = [para(1), para(2), para(3)].join("\n\n");
  const { store, runtime } = await fixture(t, async ({ onDelta }) => {
    for (let i = 0; i < full.length; i += 40) onDelta?.(full.slice(i, i + 40));
    return answer(full);
  }, { speech: true });
  const m = runtime.create({ prompt: "Explícamelo", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const parts = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant");
  assert.ok(parts.length >= 2, "said in " + parts.length + " parts");
  assert.equal(parts.map((p) => p.text).join("\n\n"), full, "nothing lost or repeated");
  assert.ok(parts.at(-1).summary, "the summary goes on the last part");
});
