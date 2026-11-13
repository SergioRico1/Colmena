import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DETAIL_ALIAS, PARENT, SETTINGS_INDEX, searchSettings } from "../src/components/v2/settings/sections.js";
import { pauseLine, pauseReason } from "../src/lib/pauseReason.js";
import { lacksOwnName } from "../src/lib/ownName.js";
import { missionSummary, context } from "../server/state.mjs";

// Words that meant two things: «Personas» in Ajustes, «Encargos», and a pause with no reason.

const read = (file) => readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8");
const NOW = Date.parse("2026-11-12T10:00:00");
const inMin = (n) => new Date(NOW + n * 60000).toISOString();

test("Ajustes: «Contactos y equipos» is the people you talk to; who signs here is «Quién usa este ordenador»", () => {
  const label = (key) => SETTINGS_INDEX.find((i) => i.key === key)?.label;
  assert.equal(label("general#quien-usa"), "Quién usa este ordenador");
  assert.equal(label("general#personas"), "Contactos y equipos");
  assert.equal(SETTINGS_INDEX.some((i) => i.label === "Personas del espacio"), false);
  // The page keeps working at its old address.
  assert.equal(PARENT["quien-usa"], "general");
  assert.equal(DETAIL_ALIAS.personas, "quien-usa");
  // Searching the old words still finds it.
  assert.ok(searchSettings("firmar").some((i) => i.key === "general#quien-usa"));
  const page = read("src/components/settings/Personas.jsx");
  assert.ok(page.includes('<PageHeader title="Quién usa este ordenador">'));
  assert.equal(/no hay invitaciones ni cuentas en red/.test(page), false, "that sentence is gone: there are invitations now");
  const general = read("src/components/v2/settings/General.jsx");
  assert.ok(general.includes('title="Quién usa este ordenador"') && general.includes('to="/ajustes/quien-usa"'));
});

test("«Encargos»: a bot's standing duties are «Tareas fijas», on its profile and in Rutinas alike", () => {
  const profile = read("src/components/interaction/StandingOrders.jsx");
  const routines = read("src/screens/RutinasV2.jsx");
  assert.ok(profile.includes(">Tareas fijas</h2>"));
  assert.ok(routines.includes('["encargo", "Tareas fijas"]'));
  // None of their labels still says «encargo» (the route /encargo/ and the code names stay).
  const OLD = [">Encargos<", '"Encargos"', "Nombre del encargo", "Nuevo encargo", "Añadir encargo", "Guardar encargo", "Cambiar el encargo", "Un encargo es", "Sin encargos", "Aún no tiene encargos", "Encargo «", "borrar el encargo", "el encargo diga"];
  for (const old of OLD) {
    assert.equal(profile.includes(old), false, "bot profile: " + old);
    assert.equal(routines.includes(old), false, "Rutinas: " + old);
  }
  for (const now of ["Nombre de la tarea fija", "Tarea fija «"]) assert.ok(profile.includes(now) && routines.includes(now), now);
  // The word is kept for one thing: what another person asks of your bots.
  assert.ok(read("src/components/v2/settings/People.jsx").includes('title="Encargos de otras personas"'));
  assert.ok(read("src/components/v3/team/People.jsx").includes('"Encargos a tus bots"'));
});

test("a paused task says why it is paused and what makes it go on", () => {
  const paused = (extra) => ({ id: "m", status: "paused", ...extra });
  const opts = { botName: "Nora", now: NOW };
  assert.equal(pauseReason({ status: "running" }, opts), null);
  assert.deepEqual(pauseReason(paused({ stopped: { reason: "cancelled" } }), opts), { why: "La paraste tú", resumes: "Sigue cuando pulses «Continuar»", auto: false });
  assert.equal(pauseLine(paused({ stopped: { reason: "cancelled", why: "Espera al lunes" } }), opts), "La paraste tú: «Espera al lunes». Sigue cuando pulses «Continuar».");
  assert.equal(pauseLine(paused({ pausedBy: "all", error: "El equipo esta en pausa." }), opts), "Pausaste a todo el equipo. Sigue cuando pulses «Reanudar al equipo».");
  assert.equal(pauseLine(paused({ interrupted: true, stopped: { reason: "other", detail: "Colmena se cerró mientras trabajaba." } }), opts), "Colmena se cerró mientras trabajaba. Sigue sola desde el último paso guardado en cuanto tu IA esté lista.");
  assert.equal(pauseReason(paused({ interrupted: true }), opts).auto, true);
  assert.equal(pauseLine(paused({ stopped: { reason: "length" } }), opts), "La respuesta era demasiado larga y se cortó. Sigue cuando pulses «Continuar», desde el último paso guardado.");
  assert.equal(pauseLine(paused({ stopped: { reason: "content-filter" } }), opts), "Un filtro de contenido la cortó. Prueba a pedirlo de otra manera.");
  assert.equal(pauseLine(paused({ stopped: { reason: "error", detail: "Sin conexión." } }), opts), "Nora no pudo seguir: Sin conexión. Sigue cuando pulses «Continuar».");
  assert.equal(pauseLine(paused({ stopped: { reason: "other", detail: "Llevaba 10 minutos sin avanzar." } }), opts), "Llevaba 10 minutos sin avanzar. Sigue cuando pulses «Continuar».");
  assert.equal(pauseLine(paused({}), opts), "Nora se paró. Sigue cuando pulses «Continuar».");
  // An AI's usage limit: which one, and that it goes on by itself.
  const limit = pauseReason(paused({ limited: { engine: "openai", label: "límite de 5 horas", resetsAt: inMin(40) } }), opts);
  assert.deepEqual(limit, { why: "ChatGPT ha llegado a su límite de 5 horas", resumes: "Sigue sola cuando se renueve, en 40 min", auto: true });
  assert.equal(pauseReason(paused({ limited: { engine: "anthropic", plan: true, resetsAt: inMin(30) } }), opts).why, "Queda poco del plan de Claude");
  // The limit wins over a stop record: it is what holds the work now.
  assert.equal(pauseReason(paused({ limited: { engine: "openai" }, stopped: { reason: "cancelled" } }), opts).auto, true);
});

test("the mission summary carries the cause of a pause", () => {
  const records = { bots: [], missions: [], automations: [], approvals: [], people: [], watchNotes: [], peerErrands: [], settings: [] };
  const store = { list: (k) => records[k] || [], columns: (k) => records[k] || [], get: () => null };
  const ctx = context(store, null, NOW);
  const view = (m) => missionSummary({ id: "m", title: "T", botIds: [], ...m }, ctx);
  assert.equal(view({ status: "paused", pausedBy: "all" }).pausedBy, "all");
  assert.equal(view({ status: "paused", interrupted: { at: inMin(-1) } }).interrupted, true);
  const running = view({ status: "running", pausedBy: "all", interrupted: { at: inMin(-1) } });
  assert.equal("pausedBy" in running || "interrupted" in running, false, "only while it is paused");
});

test("an invitation never reads «soy Sin nombre»: the sheet asks for your name first", () => {
  assert.equal(lacksOwnName({ peers: { me: { name: "Sin nombre" } } }), true);
  assert.equal(lacksOwnName({ peers: { me: { name: "Sergio Rico" } } }), false);
  assert.equal(lacksOwnName({ peers: null, settings: { userName: "Tu cuenta" } }), true);
  assert.equal(lacksOwnName({ peers: null, settings: {}, account: { email: "s@x.com" } }), false);
  assert.equal(lacksOwnName({ peers: null, settings: { userName: "Sergio" } }), false);
  // Every code is made in one place (the «Invitar» sheet's code panel), for a room, a team or to talk.
  const sheet = read("src/components/people/CodePanel.jsx");
  assert.ok(sheet.includes("lacksOwnName(store)") && sheet.includes('patch("/settings", { userName: mine.trim() })'));
  assert.ok(sheet.includes("Ver el mensaje que se copia"), "what is copied can be read before sending it");
});
