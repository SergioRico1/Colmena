import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { Notifier, isQuietTime, shouldPop } from "../server/notifications.mjs";
import { createStandingOrder, orderExpired, standingOrderView, standingOrdersText } from "../server/standing.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-v2-settings-")),
    store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store };
}

test("quiet hours: 19:00–9:00 and weekends", () => {
  assert.equal(isQuietTime(new Date(2026, 9, 14, 12, 0)), false); // Wednesday noon
  assert.equal(isQuietTime(new Date(2026, 9, 14, 19, 0)), true);
  assert.equal(isQuietTime(new Date(2026, 9, 14, 8, 59)), true);
  assert.equal(isQuietTime(new Date(2026, 9, 17, 12, 0)), true); // Saturday
});

test("«Avísame de» decides which notices pop", () => {
  const noon = new Date(2026, 9, 14, 12, 0);
  assert.equal(shouldPop({}, "done", noon), true);
  assert.equal(shouldPop({ notifyLevel: "importante" }, "done", noon), false);
  assert.equal(shouldPop({ notifyLevel: "importante" }, "failed", noon), true);
  assert.equal(shouldPop({ notifyLevel: "tuyo" }, "digest", noon), false);
  assert.equal(shouldPop({ notifyLevel: "tuyo" }, "needs", noon), true);
  assert.equal(shouldPop({ quietHours: true }, "needs", new Date(2026, 9, 14, 22, 0)), false);
});

test("a notice is kept in Hoy even when it does not pop", async (t) => {
  const { store } = await fixture(t);
  store.patch("settings", "main", { notifyLevel: "tuyo" });
  const popped = [];
  const notifier = new Notifier(store, { emit: (e) => popped.push(e), clock: () => new Date(2026, 9, 14, 12, 0).getTime() });
  notifier.notify({ kind: "done", title: "Terminado", text: "Listo" });
  assert.equal(store.list("notifications").length, 1);
  assert.equal(popped.filter((e) => e.type === "notify").length, 0);
});

test("standing orders keep «avisos como mucho» and stop reaching the bot after «hasta»", async (t) => {
  const { store } = await fixture(t);
  store.put("bots", { id: "bruno", name: "Bruno", enabled: true });
  const past = new Date(Date.now() - 864e5).toISOString();
  const live = createStandingOrder(store, { botId: "bruno", title: "Facturas", what: "Apunta las facturas.", notifyMax: "dia" });
  createStandingOrder(store, { botId: "bruno", title: "Viejo", what: "Algo que ya terminó.", until: past });
  assert.equal(standingOrderView(live).notifyMax, "dia");
  const text = standingOrdersText(store, "bruno");
  assert.match(text, /Facturas/);
  assert.match(text, /una vez al día/);
  assert.doesNotMatch(text, /Viejo/);
  assert.equal(orderExpired({ until: past }), true);
  assert.equal(orderExpired({ until: null }), false);
});
