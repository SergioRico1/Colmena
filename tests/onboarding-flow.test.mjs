// The welcome flow's own rules (src/lib/onboarding.js): its steps, the three ways to start with
// a team, «¿A qué te dedicas?» in five chips and «Otro», and the name it starts with.
import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, ROLES_SHOWN, ROLE_CHIPS, STEPS, TEAM_CHOICES, draftText, nameDraft, roleChips } from "../src/lib/onboarding.js";
import { aiConnected, askBox } from "../src/lib/aiAccount.js";

test("the welcome asks for the essentials first, then with whom you work", () => {
  assert.deepEqual(STEPS.map(([label]) => label), ["Hola", "Cuenta de IA", "Tu equipo", "Cómo trabajas", "Tus bots", "Tus apps", "Primera petición"]);
  assert.deepEqual(TEAM_CHOICES.map((c) => [c.id, c.title]), [["create", "Crear un equipo"], ["join", "Unirme a un equipo"], ["solo", "Empezar solo"]]);
  // Starting alone says a team can come later.
  assert.match(TEAM_CHOICES.at(-1).text, /más adelante/);
  // «Tu equipo» is the people now: the bots have their own step.
  assert.deepEqual(STEPS.filter(([label]) => /equipo|bots/i.test(label)).map(([label, hint]) => [label, hint]), [["Tu equipo", "Compañeros, o tú solo"], ["Tus bots", "Los que te ayudan"]]);
});

test("«¿A qué te dedicas?» shows five choices and «Otro»; every role the server knows is still reachable", () => {
  const closed = roleChips("otra");
  assert.equal(closed.shown.length, ROLES_SHOWN);
  assert.equal(closed.more, true);
  assert.deepEqual(closed.shown.map(([, label]) => label), ["Trabajo de oficina", "Programación", "Marketing", "Economía y finanzas", "Diseño"]);
  const open = roleChips("otra", true);
  assert.deepEqual([open.shown.length, open.more], [ROLE_CHIPS.length, false]);
  // A role picked from behind «Otro» keeps the list open, so the choice stays on screen.
  assert.deepEqual([roleChips("legal").shown.length, roleChips("legal").more], [ROLE_CHIPS.length, false]);
  assert.deepEqual(ROLE_CHIPS.map(([id]) => id).sort(), ROLES.map((r) => r.id).sort());
});

test("the name field starts with your name, never with a placeholder", () => {
  assert.equal(nameDraft({ userName: "Sergio Rico" }), "Sergio Rico");
  assert.equal(nameDraft({ userName: "Tu cuenta" }, { name: "Marta" }), "Marta");
  assert.equal(nameDraft({ userName: "Sin nombre" }), "");
  assert.equal(nameDraft({}, { email: "a@b.es" }), "", "an address is not a name");
  assert.equal(nameDraft(), "");
});

test("the first request handed to Inicio arrives as words, never as the record it travelled in", () => {
  assert.equal(draftText(JSON.stringify({ text: "Prepárame la semana", mode: "equipo" })), "Prepárame la semana");
  assert.equal(draftText("Resume mis correos"), "Resume mis correos");
  assert.equal(draftText("{no es json"), "{no es json");
  assert.equal(draftText(JSON.stringify({ mode: "equipo" })), "");
  assert.equal(draftText(null), "");
});

test("without an AI account the box of Inicio is off, says why and where to connect; people need none", () => {
  const none = { ready: true, ai: { engines: [{ id: "openai", connected: false }] }, provider: { connected: false } };
  assert.equal(aiConnected(none), false);
  const off = askBox(none);
  assert.equal(off.blocked, true);
  assert.match(off.placeholder, /Conecta una cuenta de IA/);
  assert.match(off.note, /compañeros puedes hablar igual/);
  assert.deepEqual(off.action, { label: "Conectar mi cuenta", href: "/ajustes/ia" });
  // Connected (either way the state says it), or not loaded yet: the box as always.
  for (const state of [{ ready: true, ai: { engines: [{ id: "anthropic", connected: true }] } }, { ready: true, provider: { connected: true } }, { ready: false }])
    assert.deepEqual(askBox(state), { blocked: false, placeholder: "Pide algo a tu equipo…", note: null, action: null });
});
