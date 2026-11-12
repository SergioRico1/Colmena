import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs } from "./fixtures/runtime-fixture.mjs";
import {
  applyMemoryOps, confirmMemory, flushMemoryUse, memoryEntries, memoryProvenance, memoryTier, memoryUsage, noteMemoryUse, placeMemory,
  relatedMemories, searchArchive, settleCore, MEMORY_LIMITS, RELATED,
} from "../server/memory.mjs";
import { contradicts, stem, terms } from "../server/memory-rank.mjs";
import { composeInstructions } from "../server/soul.mjs";
import { forget } from "../server/forgotten.mjs";
import { memorySummary } from "../server/state.mjs";

const pad = (text, length) => text.padEnd(length, " y algo más");
const said = (store, id, text, extra = {}) => store.put("memories", { id, text, scope: "equipo", target: "user", source: "dijiste", review: false, active: true, createdAt: "2026-01-01T00:00:00.000Z", ...extra });
const archived = (store, id, text, extra = {}) => store.put("memories", { id, text, botId: "nora", scope: "equipo", target: "memory", source: "dedujo", review: false, active: true, tier: "archive", missionId: "old", createdAt: "2026-01-01T00:00:00.000Z", ...extra });
const firstUser = (input) => input.find((x) => x.role === "user")?.content || "";

test("a full core store makes room: the least recently useful entry moves to the archive, nothing fails or is lost", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const bot = store.get("bots", "nora");
  for (let i = 0; i < 9; i++) said(store, "s" + i, pad("Dato número " + i + " de la persona", 150), { createdAt: `2026-01-0${i + 1}T00:00:00.000Z` });
  assert.equal(memoryUsage(store, "user").used, 1350);
  // s0 is the oldest, but it was used a moment ago: s1 is the least recently useful.
  noteMemoryUse(store, ["s0"]);
  const r = applyMemoryOps(store, { bot, source: "acuerdo", review: false, ops: [{ action: "add", target: "persona", text: pad("Prefiere los informes en PDF", 120) }] });
  assert.equal(r.results[0].action, "add");
  assert.deepEqual(r.archived.map((m) => m.id), ["s1"]);
  assert.equal(memoryTier(store.get("memories", "s1")), "archive");
  assert.equal(store.get("memories", "s1").active, true, "moved, never deleted");
  assert.equal(memoryTier(store.get("memories", "s0")), "core");
  assert.equal(memoryUsage(store, "user").used, 1320);
  assert.equal(store.list("memories").filter((m) => m.active !== false).length, 10);

  // What a bot deduced and nobody confirmed never pushes out what the person said: it is the one that waits in the archive.
  const guess = applyMemoryOps(store, { bot, ops: [{ action: "add", target: "persona", text: pad("Suele pedir gráficos de barras", 120) }] });
  assert.equal(guess.results[0].tier, "archive");
  assert.equal(memoryTier(store.get("memories", guess.results[0].id)), "archive");
  assert.equal(memoryUsage(store, "user").used, 1320);
  assert.doesNotMatch(composeInstructions(store, bot), /gráficos de barras|Dato número 1 /, "the archive is not in the system prompt");
  assert.match(composeInstructions(store, bot), /Dato número 0 /);
});

test("pinned entries never move; a pin brings an entry back and what is not pinned makes room", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const bot = store.get("bots", "nora");
  for (let i = 0; i < 9; i++) said(store, "s" + i, pad("Dato número " + i + " de la persona", 150), { createdAt: `2026-01-0${i + 1}T00:00:00.000Z` });
  placeMemory(store, "s0", { pinned: true });
  placeMemory(store, "s1", { pinned: true });
  applyMemoryOps(store, { bot, source: "acuerdo", review: false, ops: [{ action: "add", target: "persona", text: pad("Prefiere los informes en PDF", 120) }] });
  assert.equal(memoryTier(store.get("memories", "s0")), "core");
  assert.equal(memoryTier(store.get("memories", "s1")), "core");
  assert.equal(memoryTier(store.get("memories", "s2")), "archive", "the oldest that is not pinned");

  // «Archivar» takes it out and drops the pin; «Fijar» from the archive brings it back.
  assert.deepEqual([placeMemory(store, "s0", { tier: "archive" })].map((m) => [m.tier, m.pinned]), [["archive", false]]);
  const back = placeMemory(store, "s2", { pinned: true });
  assert.deepEqual([back.tier, back.pinned], ["core", true]);
  assert.ok(memoryUsage(store, "user").used <= MEMORY_LIMITS.user);

  // Everything pinned: one more pin does not fit and nothing changes.
  for (const m of memoryEntries(store, "user")) placeMemory(store, m.id, { pinned: true });
  const full = memoryEntries(store, "user").map((m) => m.id);
  const out = memoryEntries(store, "user", null, { tier: "archive" })[0];
  assert.throws(() => placeMemory(store, out.id, { pinned: true }), /No cabe/);
  assert.equal(memoryTier(store.get("memories", out.id)), "archive");
  assert.deepEqual(memoryEntries(store, "user").map((m) => m.id), full);
  // The person telling something new still works: with every entry pinned, it waits in the archive.
  said(store, "new", pad("Los viernes sale a las tres", 150));
  settleCore(store, "user", null, { keep: ["new"] });
  assert.equal(memoryTier(store.get("memories", "new")), "archive");
});

test("Spanish stems: accents, plurals and longer forms of a word meet", () => {
  assert.equal(stem("facturas"), stem("factura"));
  assert.equal(stem("reuniones"), stem("reunion"));
  assert.deepEqual(terms("¿Cuándo presenta la gestoría el IVA?"), ["present", "gestori", "iva"]);
  assert.deepEqual(terms("Las 8 diapositivas del comité"), ["8", "diapositiv", "comit"]);
});

test("retrieval: a relevant archived entry comes for a matching Spanish request, an irrelevant one does not", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const bot = store.get("bots", "nora");
  archived(store, "iva", "La gestoría presenta el IVA trimestral el día 20");
  archived(store, "perro", "Su perra se llama Kira y es una galga");
  archived(store, "logo", "El logotipo nuevo usa la tipografía Poppins");
  archived(store, "tomas", "Tomás guarda los extractos del banco por meses", { botId: "tomas", scope: "bot", target: "bot" });
  for (let i = 0; i < 40; i++) archived(store, "f" + i, `El proveedor ${i} entrega los pedidos en ${i + 2} días laborables`);

  const found = relatedMemories(store, bot, "¿Cuándo presentan los de la gestoria el IVA de este trimestre?");
  assert.deepEqual(found.entries.map((m) => m.id), ["iva"]);
  assert.match(found.text, /^# Recuerdos relacionados con esto\n.*\n- La gestoría presenta el IVA trimestral el día 20 \[compruébalo\]$/);
  assert.equal(relatedMemories(store, bot, "Hola, ¿qué tal estás hoy?").text, "");
  assert.equal(relatedMemories(store, bot, "Escribe un poema sobre el mar y las gaviotas").text, "");
  // A name is enough; another bot's own memory is never shown.
  assert.deepEqual(searchArchive(store, bot, "Busca una foto de Kira para la felicitación de este año").map((x) => x.memory.id), ["perro"]);
  assert.deepEqual(searchArchive(store, bot, "extractos del banco").map((x) => x.memory.id), []);
  assert.deepEqual(searchArchive(store, store.get("bots", "tomas"), "extractos del banco").map((x) => x.memory.id), ["tomas"]);

  // Within the budget and the count: many entries about the same thing, a few go.
  const many = relatedMemories(store, bot, "¿En cuántos días entrega el proveedor los pedidos?");
  assert.ok(many.entries.length > 0 && many.entries.length <= RELATED.max);
  assert.ok(many.entries.reduce((n, m) => n + m.text.length, 0) <= RELATED.chars);
  const tight = searchArchive(store, bot, "¿En cuántos días entrega el proveedor los pedidos?", { budget: 120, max: 6 });
  assert.equal(tight.length, 2, "two entries of ~55 characters fit in 120");

  // The index follows the memory: a new entry is found, a forgotten one is not.
  archived(store, "nuevo", "La feria de Valencia es en marzo");
  assert.deepEqual(searchArchive(store, bot, "¿Cuándo era la feria de Valencia?").map((x) => x.memory.id), ["nuevo"]);
  store.patch("memories", "nuevo", { active: false });
  assert.deepEqual(searchArchive(store, bot, "¿Cuándo era la feria de Valencia?"), []);
});

test("a step gets the related memories with its request, after the core; uses are counted in one batch", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input, instructions }) => { seen.push({ input, instructions }); return answer("El día 20."); });
  archived(store, "iva", "La gestoría presenta el IVA trimestral el día 20");
  archived(store, "perro", "Su perra se llama Kira y es una galga");
  const before = JSON.stringify(store.get("memories", "iva"));
  const m = runtime.create({ prompt: "¿Qué día presenta la gestoría el IVA?" });
  await runtime.launch(m.id);
  assert.doesNotMatch(seen[0].instructions, /IVA trimestral|Kira/, "archived entries are not in the system prompt");
  assert.match(firstUser(seen[0].input), /# Recuerdos relacionados con esto\n[^\n]+\n- La gestoría presenta el IVA trimestral el día 20/);
  assert.doesNotMatch(firstUser(seen[0].input), /Kira/);
  // Counted in memory, written once.
  assert.equal(JSON.stringify(store.get("memories", "iva")), before, "nothing is rewritten while the step runs");
  noteMemoryUse(store, ["iva"]);
  assert.equal(flushMemoryUse(store), 1);
  const used = store.get("memories", "iva");
  assert.equal(used.uses, 2);
  assert.ok(Date.parse(used.lastUsedAt) > 0);
  assert.equal(store.get("memories", "perro").uses, undefined);
  assert.equal(flushMemoryUse(store), 0);
});

test("incognito: nothing is written to the archive and the request leaves no trace in the memory", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    seen.push({ input, tools: tools.map((x) => x.name) });
    return outputs(input).length ? answer("Hecho.") : call("recall", { query: "gestoría IVA" });
  });
  archived(store, "iva", "La gestoría presenta el IVA trimestral el día 20");
  const snapshot = () => JSON.stringify([store.list("memories"), store.list("forgotten")]);
  const before = snapshot();
  const m = runtime.create({ prompt: "Tengo un problema secreto con la gestoría y el IVA", conversation: true, incognito: true });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).incognito, true);
  assert.ok(!seen[0].tools.includes("remember"), "an incognito chat cannot write memory");
  // It may read what you already told (as with the core), and recall still answers…
  assert.match(firstUser(seen[0].input), /Recuerdos relacionados con esto/);
  assert.deepEqual(outputs(seen[1].input)[0].map((x) => x.id), ["iva"]);
  // …but no use is counted and no record of the memory changes.
  assert.equal(flushMemoryUse(store), 0);
  assert.equal(snapshot(), before);
  assert.ok(!JSON.stringify(store.list("memories")).includes("problema secreto"));
});

test("what was forgotten stays forgotten in the archive too", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const bot = store.get("bots", "nora");
  archived(store, "gone", "El contable se llama Ramón Ferrer");
  // «Olvidar» on an archived entry (DELETE /api/memories/:id).
  const m = store.get("memories", "gone");
  store.remove("memories", "gone");
  forget(store, "memory", m.text, null, { reason: "rejected" });
  assert.deepEqual(searchArchive(store, bot, "¿Cómo se llama el contable?"), []);
  // A full core would send a new deduction to the archive: a forgotten one is not written at all.
  for (let i = 0; i < 9; i++) said(store, "s" + i, pad("Dato número " + i + " de la persona", 155));
  const r = applyMemoryOps(store, { bot, ops: [{ action: "add", target: "persona", text: "el contable se llama Ramón FERRER." }, { action: "add", target: "equipo", text: "El contable se llama Ramón Ferrer" }] });
  assert.deepEqual(r.results.map((x) => x.skipped), ["olvidado", "olvidado"]);
  assert.ok(!store.list("memories").some((x) => /Ferrer/i.test(x.text)));
  assert.deepEqual(searchArchive(store, bot, "¿Cómo se llama el contable?"), []);
});

test("provenance: old entries get their defaults, new ones say where they come from", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const bot = store.get("bots", "nora");
  // Records from before the tiers: no tier, no origin, some with no source at all.
  const old = { id: "o1", text: "Trabaja en euros", active: true };
  assert.deepEqual(memoryProvenance(old), { source: "dijiste", origin: "persona", from: "persona", trust: "confirmed", botId: null, missionId: null, at: null, confirmedAt: null });
  assert.equal(memoryTier(old), "core");
  const deduced = { id: "o2", text: "Cierra el día 5", botId: "nora", missionId: "m9", review: true, active: true, createdAt: "2026-02-01T10:00:00.000Z" };
  assert.deepEqual(memoryProvenance(deduced), { source: "dedujo", origin: "bot", from: "bot", trust: "unverified", botId: "nora", missionId: "m9", at: "2026-02-01T10:00:00.000Z", confirmedAt: null });
  assert.equal(memoryProvenance({ ...deduced, review: false }).trust, "confirmed");
  assert.equal(memoryProvenance({ source: "importado", text: "x" }).from, "importado");
  assert.equal(memoryProvenance({ source: "documento", review: true, text: "x" }).from, "fuera");
  assert.deepEqual([memoryProvenance({ source: "dedujo", origin: "externo", review: true }).from, memoryProvenance({ source: "dedujo", origin: "externo", review: true }).trust], ["fuera", "unverified"]);
  const summary = memorySummary(old);
  // /api/state carries only what is not the default (core, not pinned, confirmed).
  assert.deepEqual([summary.tier, summary.pinned, summary.trust, summary.source, summary.origin], [undefined, undefined, undefined, "dijiste", "persona"]);
  assert.deepEqual([memorySummary({ ...deduced, tier: "archive", pinned: true, uses: 3 })].map((s) => [s.tier, s.pinned, s.trust, s.uses]), [["archive", true, "unverified", 3]]);
  // Nothing was migrated: the old record is as it was.
  store.put("memories", old);
  composeInstructions(store, bot);
  assert.deepEqual(store.get("memories", "o1"), old);

  const mission = { id: "m1", title: "Cierre" };
  const r = applyMemoryOps(store, { bot, mission, ops: [{ action: "add", target: "equipo", text: "El cierre contable es el día 5" }] });
  const p = memoryProvenance(store.get("memories", r.results[0].id));
  assert.deepEqual([p.source, p.origin, p.from, p.trust, p.missionId, p.botId], ["dedujo", "bot", "bot", "unverified", "m1", "nora"]);
  const confirmed = confirmMemory(store, r.results[0].id);
  assert.equal(memoryProvenance(confirmed).trust, "confirmed");
  assert.ok(confirmed.confirmedAt);
});

test("a deduction that contradicts what the person said is kept «en duda» and waits in the review", async (t) => {
  assert.ok(contradicts("El año fiscal cierra el 30 de junio", "El año fiscal cierra el 31 de diciembre"));
  assert.ok(contradicts("El comité pide como máximo 10 diapositivas", "El comité pide como máximo 8 diapositivas"));
  assert.ok(contradicts("No le gustan los informes largos", "Le gustan los informes largos"));
  assert.ok(!contradicts("Trabaja en euros y en dólares", "Trabaja en euros"), "more detail is not a contradiction");
  assert.ok(!contradicts("Trabaja con Excel", "Trabaja con Word"), "one shared word is not the same subject");
  assert.ok(!contradicts("Su perra se llama Kira", "El año fiscal cierra el 31 de diciembre"));

  const { store } = await fixture(t, async () => answer("x"));
  const bot = store.get("bots", "nora");
  said(store, "mine", "El año fiscal cierra el 31 de diciembre", { target: "memory" });
  const r = applyMemoryOps(store, { bot, mission: { id: "m1", title: "Cierre" }, ops: [{ action: "add", target: "equipo", text: "El año fiscal cierra el 30 de junio" }] });
  assert.equal(r.results[0].doubt, true);
  assert.match(r.results[0].notice, /Contradice lo que dijo la persona/);
  const doubt = store.get("memories", r.results[0].id);
  assert.deepEqual([doubt.doubt, doubt.contradicts, doubt.review, doubt.tier], [true, "mine", true, "archive"]);
  assert.equal(memoryProvenance(doubt).trust, "doubt");
  assert.equal(memorySummary(doubt).contradicts, "mine");
  // The person's version stands, alone, wherever a bot reads memory.
  assert.equal(store.get("memories", "mine").active, true);
  assert.match(composeInstructions(store, bot), /cierra el 31 de diciembre/);
  assert.doesNotMatch(composeInstructions(store, bot), /30 de junio/);
  assert.equal(relatedMemories(store, bot, "¿Cuándo cierra el año fiscal?").text, "");
  assert.throws(() => placeMemory(store, doubt.id, { pinned: true }), /en duda/);
  // Asked again, it is not stored twice.
  const again = applyMemoryOps(store, { bot, ops: [{ action: "add", target: "equipo", text: "El año fiscal cierra el 30 de junio." }] });
  assert.equal(again.results[0].skipped, "duplicado");
  // What the person approves in the tray is theirs: no doubt.
  const approved = applyMemoryOps(store, { bot, source: "acuerdo", review: false, ops: [{ action: "add", target: "equipo", text: "El año fiscal cierra el 30 de septiembre" }] });
  assert.equal(approved.results[0].doubt, undefined);

  // «Cambiarlo»: it takes the place of what the person had said.
  const taken = confirmMemory(store, doubt.id, { replaces: true });
  assert.deepEqual([taken.doubt, taken.review, taken.tier, taken.replaced], [false, false, "core", "mine"]);
  assert.equal(store.get("memories", "mine").active, false);
  assert.equal(store.get("memories", "mine").supersededBy, doubt.id);
  assert.match(composeInstructions(store, bot), /30 de junio/);

  // «Valen las dos»: both stay, the new one no longer in doubt.
  said(store, "mine2", "Prefiere las cifras en miles de euros");
  const d2 = applyMemoryOps(store, { bot, ops: [{ action: "add", target: "persona", text: "Prefiere las cifras en millones de euros" }] }).results[0];
  assert.equal(d2.doubt, true);
  const both = confirmMemory(store, d2.id);
  assert.deepEqual([both.doubt, both.review, both.tier], [false, false, "archive"]);
  assert.equal(store.get("memories", "mine2").active, true);
});

test("recall searches both tiers", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async ({ input }) => {
    seen.push(input);
    const out = outputs(input);
    if (!out.length) return call("recall", { query: "informes" });
    if (out.length === 1) return call("recall", { query: "¿qué día presenta la gestoría el IVA?" }, "c2");
    return answer("ok");
  });
  said(store, "core1", "Prefiere informes breves");
  archived(store, "arch1", "Los informes de ventas llevan una tabla por región");
  archived(store, "iva", "La gestoría presenta el IVA trimestral el día 20");
  archived(store, "doubt", "Prefiere informes larguísimos", { doubt: true, review: true });
  const m = runtime.create({ prompt: "Hola" });
  await runtime.launch(m.id);
  const [first, second] = outputs(seen.at(-1));
  assert.deepEqual(first.map((x) => [x.id, !!x.archivo]).sort(), [["arch1", true], ["core1", false]]);
  assert.deepEqual(second.map((x) => x.id), ["iva"]);
  assert.equal(flushMemoryUse(store), 3);
  assert.equal(store.get("memories", "core1").uses, 1);
  assert.equal(store.get("memories", "iva").uses, 1);
});
