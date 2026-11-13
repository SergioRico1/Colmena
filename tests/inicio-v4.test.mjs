// Colmena 4 · Inicio: «Para empezar · N de 4» (src/lib/setupSteps.js) and «Trabajando ahora»
// (src/lib/workingNow.js), both pure functions of the state the store already has.
import test from "node:test";
import assert from "node:assert/strict";
import { setupSteps } from "../src/lib/setupSteps.js";
import { elapsed, workingNow } from "../src/lib/workingNow.js";

const fresh = { settings: {}, people: [{ id: "me", name: "Tú", self: true }], peers: { contacts: [] }, teams: [{ id: "solo", people: 1 }], connectors: [{ id: "gmail", name: "Gmail", connected: false }], ai: { engines: [] } };

test("a fresh Colmena shows the four steps, none done; you yourself are not «your team»", () => {
  const s = setupSteps(fresh);
  assert.equal(s.show, true);
  assert.equal(s.done, 0);
  assert.deepEqual(s.steps.map((x) => x.id), ["ai", "about", "apps", "invite"]);
  assert.ok(s.steps.every((x) => !x.done));
  assert.equal(s.steps.find((x) => x.id === "invite").action.href, "/equipo?invitar=1");
});

test("each step is done by what already exists: an AI account, your role, an app, someone else", () => {
  const s = setupSteps({ ...fresh, ai: { engines: [{ id: "openai", connected: true, label: "ChatGPT" }] }, settings: { role: "marketing" }, connectors: [{ id: "gmail", name: "Gmail", connected: true }], peers: { contacts: [{ name: "Lucía" }] } });
  assert.equal(s.done, 4);
  assert.equal(s.show, false, "the card hides once all is done");
  assert.match(s.steps.find((x) => x.id === "invite").text, /Lucía/);
  assert.equal(setupSteps({ ...fresh, teams: [{ id: "t", people: 3 }] }).steps.find((x) => x.id === "invite").done, true, "a team of several counts");
});

test("«Ahora no» puts an optional step off and the × closes the card", () => {
  const off = setupSteps({ ...fresh, settings: { setupHidden: ["apps", "invite"] } });
  assert.deepEqual(off.steps.filter((x) => x.hidden).map((x) => x.id), ["apps", "invite"]);
  assert.equal(off.show, true, "ai and about are still open");
  assert.equal(setupSteps({ ...fresh, settings: { setupHidden: ["all"] } }).show, false);
  const rest = setupSteps({ ...fresh, ai: { engines: [{ connected: true }] }, settings: { role: "otra", setupHidden: ["apps", "invite"] } });
  assert.equal(rest.show, false, "nothing open is left to show");
});

test("«Trabajando ahora» lists the busy bots with what they do, the longest at it first", () => {
  const now = Date.now();
  const state = {
    bots: [
      { id: "vera", name: "Vera", busy: true, activity: { verb: "escribiendo", detail: "la nota de prensa", missionId: "m2" } },
      { id: "tomas", name: "Tomás", status: "trabaja" },
      { id: "nora", name: "Nora", status: "libre" },
    ],
    missions: [
      { id: "m1", title: "Cuadrar precios", botIds: ["tomas"], status: "running", room: "precios", createdAt: new Date(now - 40 * 60000).toISOString(), activityLine: "Lee ventas.xlsx" },
      { id: "m2", title: "Nota", botIds: ["vera"], status: "running", room: "prensa", createdAt: new Date(now - 5 * 60000).toISOString() },
    ],
  };
  const list = workingNow(state);
  assert.deepEqual(list.map((w) => w.bot.id), ["tomas", "vera"]);
  assert.equal(list[0].what, "Lee ventas.xlsx");
  assert.equal(list[1].what, "Escribiendo la nota de prensa");
  assert.equal(workingNow({ ...state, paused: true }).length, 0, "a paused team works on nothing");
});

test("elapsed says minutes, hours and days", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.equal(elapsed("2026-11-13T11:59:40Z", now), "ahora");
  assert.equal(elapsed("2026-11-13T11:48:00Z", now), "12 min");
  assert.equal(elapsed("2026-11-13T10:55:00Z", now), "1 h 5 min");
  assert.equal(elapsed("2026-11-11T10:00:00Z", now), "2 d");
  assert.equal(elapsed(null, now), "ahora");
});
