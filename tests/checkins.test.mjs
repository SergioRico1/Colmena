import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { cheapestModel, runCheckin, checkinDue } from "../server/checkins.mjs";

const MODELS = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].map((slug) => ({ slug }));

async function temp(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-checkin-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return store;
}

test("check-ins run on the cheapest model: the lowest Luna", () => {
  assert.equal(cheapestModel(MODELS), "gpt-5.6-luna");
  assert.equal(cheapestModel([{ slug: "gpt-6-astra" }, { slug: "gpt-6-sol" }]), "gpt-6-sol");
});

test("no model call when nothing waits or nothing changed; one notice when Atlas decides it matters", async (t) => {
  const store = await temp(t);
  const calls = [];
  const notices = [];
  const infer = async (params) => { calls.push(params); return { text: JSON.stringify({ avisar: true, titulo: "Tomás lleva 3 h esperando", texto: "Responde su pregunta del Excel en la Bandeja.", url: "/bandeja" }) }; };
  const notifier = { notify: (n) => notices.push(n) };

  assert.equal((await runCheckin({ store, infer, models: MODELS, notifier })).reason, "nada pendiente");
  assert.equal(calls.length, 0);

  store.put("approvals", { id: "a1", kind: "question", status: "pending", title: "El Excel no trae devoluciones", botId: "tomas", createdAt: new Date(Date.now() - 3 * 3600e3).toISOString() });
  const first = await runCheckin({ store, infer, models: MODELS, notifier });
  assert.equal(first.notified, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gpt-5.6-luna");
  assert.deepEqual(calls[0].reasoning, { effort: "low" });
  assert.equal(notices[0].url, "/bandeja");

  assert.equal((await runCheckin({ store, infer, models: MODELS, notifier })).reason, "sin cambios");
  assert.equal(calls.length, 1, "same situation, no second model call");
});

test("check-ins are due every few hours, only inside your hours, and can be switched off", async (t) => {
  const store = await temp(t);
  const wed10 = new Date(2026, 9, 14, 10, 0).getTime(); // a Wednesday, 10:00 local time
  store.put("settings", { id: "main", checkin: { enabled: true, everyHours: 2 } });
  assert.equal(checkinDue(store, wed10), true);
  store.put("settings", { id: "checkin", lastAt: new Date(wed10).toISOString() });
  assert.equal(checkinDue(store, wed10), false);
  assert.equal(checkinDue(store, wed10 + 2 * 3600e3), true);
  assert.equal(checkinDue(store, wed10 + 11 * 3600e3), false, "21:00 is outside 9–20");
  assert.equal(checkinDue(store, new Date(2026, 9, 17, 11, 0).getTime()), false, "Saturday");
  store.put("settings", { id: "main", checkin: { enabled: true, everyHours: 2, weekends: true, from: 8, to: 22 } });
  assert.equal(checkinDue(store, new Date(2026, 9, 17, 11, 0).getTime()), true, "weekends on");
  assert.equal(checkinDue(store, wed10 + 11 * 3600e3), true, "21:00 inside 8–22");
  store.put("settings", { id: "main", checkin: { enabled: false } });
  assert.equal(checkinDue(store, wed10 + 9 * 3600e3), false);
});

test("check-in links open the real room, not its #name", async (t) => {
  const store = await temp(t);
  const { linkFor } = await import("../server/checkins.mjs");
  store.put("missions", { id: "m-1", room: "planes-valladolid", title: "Planes", status: "waiting" });
  assert.equal(linkFor(store, "/sala/planes-valladolid"), "/sala/m-1");
  assert.equal(linkFor(store, "/sala/#planes-valladolid"), "/sala/m-1");
  assert.equal(linkFor(store, "/sala/no-existe"), "/misiones");
  assert.equal(linkFor(store, "https://evil.example"), "/bandeja");
});
