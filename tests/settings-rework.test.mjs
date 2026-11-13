import test from "node:test";
import assert from "node:assert/strict";
import { ALIAS, ANCHOR_HOME, DETAIL_ALIAS, GROUPS, PARENT, SECTIONS, SECTION_OF, groupedSections, homeOf, searchSettings, sectionId, settingsIndex } from "../src/components/v2/settings/sections.js";
import { agoWord, aiStatus, appsStatus, backupStatus, diagnosticsStatus, peopleStatus, sectionTags, updateStatus } from "../src/components/v2/settings/status.js";
import { disconnectAiText, disconnectAppText, forgetAllText, forgetBackupPasswordText, suggestedAccess, KIND_OF } from "../src/components/v2/settings/effects.js";
import { RED_LINES } from "../src/components/v2/settings/redLines.js";

// Ajustes (Colmena 4): sections grouped by what people think about, every old address and anchor
// still landing on its setting, a search that knows the words people use, the status of each
// section at a glance and the sentences that say what an action will do before it is done.

// The registry before the rework (Colmena 3): every section and every anchor it had.
const OLD = {
  general: ["tu-nombre", "tu-rol", "nombre-espacio", "tema", "modo-experto", "narracion", "sugerencias", "quien-responde", "quien-usa", "personas", "atajos"],
  ia: ["chatgpt", "claude", "opencode", "piensan-con", "respaldo", "cuanto-piensan", "modelo", "por-bot"],
  permisos: ["lineas-rojas", "pausa", "autonomia-bot", "que-app", "permisos", "revisor", "esperar-respuesta", "sin-supervision", "codigo-archivar", "capacidades"],
  apps: ["apps-conectadas", "conectar-app", "carpetas", "navegador"],
  avisos: ["avisame-de", "como-avisa", "sonido-avisos", "horario", "resumenes", "te-avisa", "revision-atlas"],
  privacidad: ["privado", "aprenden", "recuerdos", "perfil-historial", "boveda", "dictado", "registro", "olvidar", "copias", "copia-contrasena", "copia-donde", "copia-automatica", "copia-ahora", "copia-restaurar", "copia-que-protege", "cifrado", "cifrado-estado", "cifrado-que-protege"],
  uso: ["este-mes", "limites-plan", "cache", "por-bot-uso", "por-chat", "limite-mensual", "pausar-limite", "aviso-80", "pausa-plan", "csv"],
  ayuda: ["comprobar", "diag-ia", "diag-codigo", "diag-datos", "diag-servidor", "diag-apps", "diag-actualizaciones", "version", "actualizaciones", "canal", "comentarios"],
  avanzado: ["mcp", "modelo-local", "clave-openai", "claves", "familias", "carpeta-datos", "servicio-local"],
  contactos: ["tu-identidad", "tu-estado", "invitar", "contactos", "encargos", "buzon", "como-funciona"],
};
const OLD_ALIASES = ["cuenta", "espacio", "inteligencia", "autonomia", "conexiones", "conectores", "limites", "diagnostico", "acerca"];
const anchorsOf = (id) => SECTION_OF[id]?.items.map((i) => i[0]) || [];
/** Where /ajustes/<section>#<anchor> ends up: the redirect if there is one, else the address itself. */
const land = (section, anchor) => {
  const id = sectionId(section);
  const moved = homeOf(id, anchor);
  return moved || `/ajustes/${id}#${anchor}`;
};

test("Ajustes: thirteen sections in six groups, in the order people think about them", () => {
  assert.deepEqual(GROUPS.map((g) => g.label), ["Tú", "Tu equipo y tus contactos", "Inteligencia y apps", "Privacidad y seguridad", "Este ordenador", "Avanzado"]);
  assert.deepEqual(groupedSections(false).map((g) => [g.id, g.sections.map((s) => s.id)]), [
    ["tu", ["general", "avisos"]], ["equipo", ["contactos", "permisos"]], ["ia", ["ia", "apps", "uso"]],
    ["privacidad", ["privacidad", "copias"]], ["ordenador", ["sistema", "actualizaciones"]], ["avanzado", ["ayuda"]],
  ]);
  assert.deepEqual(groupedSections(true).at(-1).sections.map((s) => s.id), ["ayuda", "avanzado"], "Servidores y claves only in expert mode");
  for (const s of SECTIONS) {
    assert.ok(GROUPS.some((g) => g.id === s.group), s.id + " has a group");
    assert.match(s.lead, /^[A-ZÁÉÍÓÚÑ¿].+\.$/, s.id + " opens with one sentence on what it is for");
    assert.ok(s.icon, s.id + " has an icon");
  }
});

test("Ajustes: every old section address still opens a section", () => {
  for (const old of [...Object.keys(OLD), ...OLD_ALIASES]) assert.ok(SECTION_OF[sectionId(old)], old);
  for (const [from, to] of Object.entries(ALIAS)) assert.ok(SECTION_OF[to], `${from} → ${to}`);
  for (const [detail, parent] of Object.entries(PARENT)) assert.ok(SECTION_OF[parent], `${detail} lives in ${parent}`);
  assert.equal(DETAIL_ALIAS.personas, "quien-usa");
  assert.equal(PARENT["quien-usa"], "contactos", "who uses this computer sits with your contacts now");
  assert.equal(sectionId("acerca"), "actualizaciones");
  assert.equal(sectionId("backup"), "copias");
  assert.equal(sectionId(null), "general");
});

test("Ajustes: every old link to a setting lands on that setting, wherever it lives now", () => {
  for (const [section, anchors] of Object.entries(OLD)) {
    for (const anchor of anchors) {
      const to = land(section, anchor);
      const [, id, a] = /^\/ajustes\/([^#]+)#(.+)$/.exec(to);
      assert.ok(SECTION_OF[id], `${section}#${anchor} → ${to}`);
      assert.ok(anchorsOf(id).includes(a), `${section}#${anchor} → ${to} has its anchor`);
    }
  }
  assert.equal(land("privacidad", "copia-donde"), "/ajustes/copias#copia-donde");
  assert.equal(land("ayuda", "actualizaciones"), "/ajustes/actualizaciones#actualizaciones");
  assert.equal(land("apps", "navegador"), "/ajustes/sistema#navegador");
  assert.equal(land("general", "quien-usa"), "/ajustes/contactos#quien-usa");
  assert.equal(land("general", "personas"), "/ajustes/contactos#contactos");
  assert.equal(land("autonomia", "codigo-archivar"), "/ajustes/permisos#codigo-archivar", "an alias and an anchor together");
  assert.equal(homeOf("avisos", "horario"), null, "a link that is already right stays");
  // Links other screens and the server write (LimitNotice, EquipoBot, Diagnostics, Hoy…).
  for (const href of ["uso#pausa-plan", "ia#respaldo", "uso#limite-mensual", "contactos#buzon", "contactos#encargos", "general#tu-nombre", "general#modo-experto", "avanzado#mcp", "permisos#que-app", "copias#cifrado"]) {
    const [s, a] = href.split("#");
    assert.equal(land(s, a), "/ajustes/" + href, href);
  }
  // An anchor is in one place only, so a moved one has one home.
  const all = SECTIONS.flatMap((s) => s.items.map((i) => i[0]));
  assert.equal(new Set(all).size, all.length);
  assert.equal(ANCHOR_HOME.version, "actualizaciones");
});

test("Ajustes search: finds a setting by the words people use and by synonyms", () => {
  const first = (q, expert = false) => searchSettings(q, settingsIndex(expert))[0]?.href;
  assert.equal(first("notificaciones"), "/ajustes/avisos#como-avisa");
  assert.ok(searchSettings("notificaciones").some((i) => i.href === "/ajustes/avisos"), "a synonym finds the section");
  assert.equal(searchSettings("backup")[0].section, "copias");
  assert.equal(first("modo oscuro"), "/ajustes/general#tema");
  assert.equal(first("micrófono"), "/ajustes/sistema#dictado");
  assert.equal(first("contraseña"), "/ajustes/privacidad#boveda");
  assert.equal(first("versión"), "/ajustes/actualizaciones#version");
  assert.ok(searchSettings("gasto").some((i) => i.section === "uso"));
  assert.ok(searchSettings("cifrar").some((i) => i.href === "/ajustes/copias#cifrado-estado"));
  assert.ok(searchSettings("pagar").some((i) => i.href === "/ajustes/permisos#lineas-rojas"), "red lines by what they stop");
  assert.ok(searchSettings("problema").some((i) => i.section === "ayuda"));
  assert.ok(searchSettings("firmar").some((i) => i.key === "contactos#quien-usa"));
  assert.equal(searchSettings("servidores mcp", settingsIndex(false)).length, 0, "simple mode does not find the expert section");
  assert.equal(first("servidores mcp", true), "/ajustes/avanzado#mcp");
  assert.deepEqual(searchSettings("zzzz"), []);
});

test("Ajustes status: each section says how it is at a glance", () => {
  const now = Date.parse("2026-11-13T12:00:00");
  assert.equal(aiStatus({ engines: [{ id: "openai", connected: false }] }).tone, "error");
  assert.deepEqual(aiStatus({ primary: "openai", engines: [{ id: "openai", label: "ChatGPT", connected: true }] }, { primary: { usedPercent: 34 } }), { text: "34 %", tone: "quiet", label: "Piensan con ChatGPT · usado el 34 % de su plan" });
  assert.equal(aiStatus({ primary: "anthropic", engines: [{ id: "anthropic", label: "Claude", connected: true }] }).label, "Piensan con Claude");
  assert.equal(aiStatus({ primary: "openai", fallback: "anthropic", engines: [{ id: "openai", label: "ChatGPT", connected: true, limit: {} }, { id: "anthropic", connected: true }] }).label, "ChatGPT ha llegado a su límite de uso; sigue el respaldo.");
  assert.equal(appsStatus([{ id: "correo", name: "Correo", connected: true }, { id: "carpeta", connected: true }], [{}]).label, "Correo conectado · 1 carpeta");
  assert.equal(appsStatus([], []).text, "Ninguna");
  assert.equal(peopleStatus({ me: {}, contacts: [{ status: "ok" }, { status: "known" }], relay: { status: "online" } }).label, "Buzón activo · 1 persona");
  assert.equal(peopleStatus({ me: {}, contacts: [], relay: { status: "offline" } }).tone, "error");
  assert.equal(backupStatus({ last: { at: "2026-11-13T09:00:00" }, schedule: "daily" }, { encrypted: true }, now).label, "Última copia hoy · automáticas · base de datos cifrada");
  assert.equal(backupStatus({ last: { at: "2026-10-01T09:00:00" } }, null, now).tone, "error", "an old copy is a warning");
  assert.equal(backupStatus({ hasPassword: false }, null, now).text, "Sin copias");
  assert.equal(backupStatus({ lastError: "Disco lleno" }).label, "La última copia falló: Disco lleno");
  assert.equal(agoWord("2026-11-12T20:00:00", now), "ayer");
  assert.equal(agoWord("2026-11-08T20:00:00", now), "hace 5 días");
  assert.equal(updateStatus({ status: "ready", version: "2.4.0" }).tone, "news");
  assert.equal(updateStatus({ status: "idle", current: "2.3.1" }).text, "2.3.1");
  assert.equal(diagnosticsStatus({ summary: { fail: 0, warn: 0 } }).text, "Todo bien");
  assert.equal(diagnosticsStatus({ summary: { fail: 2, warn: 1 } }).label, "2 cosas fallan");
  const tags = sectionTags({ paused: true, settings: { quietHours: true } }, now);
  assert.deepEqual(Object.keys(tags).sort(), ["avisos", "permisos"]);
});

test("Ajustes says what an action will do before it is done", () => {
  const engines = [{ id: "openai", label: "ChatGPT", connected: true }, { id: "anthropic", label: "Claude", connected: true }];
  assert.match(disconnectAiText({ id: "openai", engines: [engines[0]], primary: "openai" }), /única cuenta: tus bots dejan de pensar/);
  assert.match(disconnectAiText({ id: "openai", engines, primary: "openai", fallback: "anthropic" }), /pasarán a pensar con Claude/);
  assert.match(disconnectAiText({ id: "anthropic", engines, primary: "openai", fallback: "anthropic" }), /Es tu respaldo/);
  assert.match(disconnectAiText({ id: "anthropic", engines, primary: "openai", fallback: "none", bots: [{ name: "Greta", engine: "anthropic" }] }), /Greta la usa por su cuenta/);
  assert.equal(disconnectAppText("Gmail", [{ name: "Nora" }, { name: "Vera" }]).startsWith("Nora y Vera dejan de poder usar Gmail."), true);
  const forget = forgetAllText(3, 2);
  assert.equal(forget.action, "Olvidar 5 recuerdos");
  assert.match(forget.body, /2 recuerdos archivados.*se quedan.*10 segundos/);
  const pw = forgetBackupPasswordText({ schedule: "daily", backups: [{}, {}] });
  assert.match(pw.body, /automáticas se apagan.*Las 2 copias que ya tienes siguen.*no se puede deshacer/);
  // After connecting an app: reading for all when nobody had that kind; otherwise what they had.
  const bots = [{ id: "a", tools: {} }, { id: "b", tools: { correo: "escribe" } }];
  assert.deepEqual(suggestedAccess(bots, "calendario"), { a: "lee", b: "lee" });
  assert.deepEqual(suggestedAccess(bots, "correo"), { a: "none", b: "escribe" });
  assert.equal(KIND_OF.gmail, "correo");
  assert.ok(RED_LINES.some(([t]) => /Pagar, comprar/.test(t)), "buying and paying are red lines");
});
