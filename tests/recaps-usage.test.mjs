import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { cleanRecap } from "../server/recaps.mjs";
import { csvCell, record, usageCsv, usageHistory } from "../server/usage.mjs";

test("room recap: plain text, three sentences at most, 450 characters at most", () => {
  assert.equal(cleanRecap("**Nora** ha comparado tres tarifas. Falta la de Iberdrola. Te espera tu OK. Y otra frase más."), "Nora ha comparado tres tarifas. Falta la de Iberdrola. Te espera tu OK.");
  assert.equal(cleanRecap("«Todo listo.»"), "Todo listo.");
  const long = cleanRecap(("Una frase bastante larga sobre lo que se ha hecho en la sala con detalle ").repeat(12));
  assert.ok(long.length <= 451, long.length);
  assert.equal(cleanRecap("   "), "");
});

test("room recap: written when a room finishes, kept until something new happens, never for chats", async (t) => {
  let calls = 0;
  const { store, runtime } = await fixture(t, async ({ instructions, input }) => {
    if (/Resume en español/.test(instructions)) {
      calls++;
      assert.match(input[0].content, /presupuesto/);
      return answer("Nora ha preparado el presupuesto de la feria. Queda confirmar el stand.");
    }
    return answer("Aquí tienes el presupuesto de la feria.");
  }, { recaps: true });
  runtime.provider.session = { models: [{ slug: "fixture" }] };
  const room = runtime.create({ prompt: "Prepara el presupuesto de la feria", mode: "solo", botIds: ["nora"] });
  await runtime.launch(room.id);
  await settle(runtime);
  const recap = store.get("missions", room.id).recap;
  assert.equal(recap.status, "ok");
  assert.equal(recap.text, "Nora ha preparado el presupuesto de la feria. Queda confirmar el stand.");
  assert.equal(calls, 1);
  await runtime.recapRoom(room.id);
  assert.equal(calls, 1, "nothing new: no second call");
  await runtime.recapRoom(room.id, { force: true });
  assert.equal(calls, 2, "«Reintentar resumen» always writes it again");
  const chat = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora"], conversation: true });
  await runtime.launch(chat.id);
  await settle(runtime);
  assert.equal(store.get("missions", chat.id).recap, undefined);
});

test("usage history: 30 local days, per bot and room; the CSV neutralises formulas", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  store.put("missions", { id: "m1", title: "=HYPERLINK(\"x\")", room: "=cmd|calc", prompt: "", botIds: [] });
  record(store, { missionId: "m1", botId: "nora", tokens: 1200, model: "luna-1" });
  record(store, { missionId: "m1", botId: "nora", tokens: 300, model: "luna-1" });
  record(store, { missionId: null, botId: "atlas", tokens: 50 });
  const old = store.put("usage", { id: "old", botId: "nora", tokens: 999, at: new Date(Date.now() - 40 * 864e5).toISOString() });
  assert.ok(old);
  const h = usageHistory(store, { days: 30 });
  assert.equal(h.days.length, 30);
  assert.equal(h.total, 1550);
  assert.deepEqual(h.bots.map((b) => [b.botId, b.tokens]), [["nora", 1500], ["atlas", 50]]);
  assert.deepEqual(h.rooms.map((r) => [r.missionId, r.calls]), [["m1", 2]]);
  assert.equal(h.days.at(-1).tokens, 1550);
  const csv = usageCsv(h, { botName: (id) => id, roomName: () => "#=cmd|calc" });
  assert.ok(csv.startsWith("﻿Fecha;Bot;"));
  assert.match(csv, /;#=cmd\|calc;luna-1;1500;2/);
  assert.equal(csvCell("=SUM(A1)"), `"'=SUM(A1)"`);
  assert.equal(csvCell("@x"), `"'@x"`);
  assert.equal(csvCell("normal"), "normal");
});
