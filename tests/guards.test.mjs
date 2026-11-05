import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call } from "./fixtures/runtime-fixture.mjs";
import { callKey, countRepeat, withReminder, REPEAT_REMINDERS } from "../server/loops.mjs";
import { BLOCKED_ROUNDS, blockingKey, mayDeclareBlocked, onlyHard, permissionChangeNote, trackBlocking } from "../server/guards.mjs";
import { STUCK_ROUNDS } from "../server/runtime.mjs";

// ------------------------------------------------------------- repeats
test("repeat reminder: identical calls are counted per step; reminders at 3, 5 and 8; never blocks", () => {
  assert.deepEqual(REPEAT_REMINDERS, [3, 5, 8]);
  assert.equal(callKey("web_fetch", '{"url":"a","b":1}'), callKey("web_fetch", { b: 1, url: "a" }), "argument order does not matter");
  assert.notEqual(callKey("web_fetch", { url: "a" }), callKey("web_fetch", { url: "b" }));
  let state = null;
  const seen = [];
  for (let i = 1; i <= 9; i++) {
    const out = countRepeat(state, "k", { personAt: "2026-01-01T00:00:00Z" });
    state = out.state;
    if (out.reminder) seen.push(out.count);
  }
  assert.deepEqual(seen, [3, 5, 8]);
  // Another call does not count for this one.
  assert.equal(countRepeat(state, "otra", { personAt: "2026-01-01T00:00:00Z" }).count, 1);
  // A new message of the person starts again.
  assert.equal(countRepeat(state, "k", { personAt: "2026-01-01T00:05:00Z" }).count, 1);
  const r = withReminder({ ok: true, items: [1] }, "Aviso");
  assert.deepEqual(r, { ok: true, items: [1], aviso_repeticion: "Aviso" });
  assert.deepEqual(withReminder({ waiting: true }, "Aviso"), { waiting: true }, "a waiting call is untouched");
  assert.deepEqual(withReminder("texto", "Aviso"), { resultado: "texto", aviso_repeticion: "Aviso" });
  assert.equal(withReminder({ ok: 1 }, null).aviso_repeticion, undefined);
});

test("runtime: the third identical call carries a Spanish reminder and still runs", async (t) => {
  let n = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const outs = input.filter((x) => x.type === "function_call_output");
    if (outs.length < 5) return call("list_files", {}, "l" + n++);
    return answer("Listo");
  });
  const m = runtime.create({ prompt: "Mira los archivos" });
  await runtime.launch(m.id);
  const step = runtime.steps(m.id)[0];
  const outputs = store.get("steps", step.id).history.filter((x) => x.type === "function_call_output").map((x) => String(x.output));
  assert.equal(outputs.length, 5, "never blocked");
  assert.doesNotMatch(outputs[1], /aviso_repeticion/);
  assert.match(outputs[2], /aviso_repeticion/);
  assert.match(outputs[2], /3\.ª vez/);
  assert.match(outputs[4], /5\.ª vez/);
  assert.equal(store.get("missions", m.id).result, "Listo");
});

// ----------------------------------------------------------- permissions
test("permission change note: what changed, before and now, in Spanish", () => {
  const before = { autonomy: "sugiere", apps: { calendario: "escribe" }, capabilities: { web: true, apps: true }, computer: true, commands: true };
  const now = { autonomy: "solo", apps: { calendario: "lee" }, capabilities: { web: false, apps: true }, computer: true, commands: false };
  const note = permissionChangeNote(before, now);
  assert.match(note, /^Aviso de Colmena: la persona ha cambiado tus permisos/);
  assert.match(note, /autonomía: Hace solo \(antes Solo sugiere\)/);
  assert.match(note, /Calendario: solo lee \(antes lee y escribe\)/);
  assert.match(note, /ya no puedes buscar en la web/);
  assert.match(note, /ejecutar programas: no \(antes sí\)/);
  assert.match(note, /líneas rojas siguen/);
  assert.equal(permissionChangeNote(before, before), null);
});

test("runtime: a change of autonomy mid-mission reaches the bot once, at its next round", async (t) => {
  let rounds = 0;
  const seen = [];
  let fx;
  fx = await fixture(t, async ({ input }) => {
    rounds++;
    seen.push(input.filter((x) => x.role === "user" && /cambiado tus permisos/.test(x.content || "")).length);
    if (rounds === 1) {
      fx.store.patch("bots", "nora", { autonomy: fx.store.get("bots", "nora").autonomy === "solo" ? "avisa" : "solo" });
      return call("list_files", {}, "a1");
    }
    if (rounds === 2) return call("list_files", {}, "a2");
    return answer("Hecho");
  });
  const m = fx.runtime.create({ prompt: "Trabaja", botIds: ["nora"], mode: "solo" });
  await fx.runtime.launch(m.id);
  assert.deepEqual(seen, [0, 1, 1], "told once, and it stays in the history");
});

// --------------------------------------------------------- anti-false-blocked
test("blocked only after the same condition for three rounds; «it is difficult» is not blocked", () => {
  assert.equal(BLOCKED_ROUNDS, 3);
  let s = null;
  s = trackBlocking(s, blockingKey("read_file", "No existe: a1.txt"));
  s = trackBlocking(s, blockingKey("read_file", "No existe: a2.txt"));
  assert.equal(mayDeclareBlocked(s), false, "two rounds");
  s = trackBlocking(s, blockingKey("read_file", "No existe: a3.txt"));
  assert.equal(s.rounds, 3, "digits do not make it a new condition");
  assert.equal(mayDeclareBlocked(s), true);
  assert.equal(trackBlocking(s, blockingKey("web_fetch", "timeout")).rounds, 1, "another condition starts again");
  assert.equal(trackBlocking(s, null).rounds, 0, "a round that worked resets it");
  assert.equal(onlyHard("Es muy difícil encontrar el dato"), true);
  assert.equal(onlyHard("Es complicado: no tengo acceso a la carpeta"), false);
  assert.equal(mayDeclareBlocked(s, { reason: "es difícil" }), false);
});

test("runtime: varied failures are not «stuck» at 5 rounds; the same one is", async (t) => {
  let n = 0;
  const errors = ["read_file", "pdf_fields", "read_deliverable"];
  const { store, runtime } = await fixture(t, async ({ input }) => {
    if (input.some((x) => /continúa/.test(x.content || ""))) return answer("Fin");
    const tool = errors[n % errors.length];
    const args = tool === "read_file" ? { path: "nada-" + n + ".txt" } : tool === "pdf_fields" ? { path: "x" + n + ".txt", folderId: "" } : { id: "no-" + n, title: "", page: 1 };
    return call(tool, args, "v" + n++);
  });
  const m = runtime.create({ prompt: "Prueba cosas" });
  await runtime.launch(m.id);
  assert.ok(n > STUCK_ROUNDS, "varied failures keep trying past " + STUCK_ROUNDS);
  assert.ok(n <= STUCK_ROUNDS * 2, "but never without end");
  assert.ok(store.list("messages").some((x) => x.missionId === m.id && x.stall === "loop"));
});
