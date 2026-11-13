import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SELF_FALLBACK, lacksOwnName, selfLabel, selfName } from "../src/lib/ownName.js";

// The minor items of the critique (2026-11-13) that a test can hold.
const src = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("no name set: one fallback for yourself («Tú»), and others are told «Sin nombre»", () => {
  assert.equal(SELF_FALLBACK, "Tú");
  for (const userName of ["", "Tu cuenta", "Sin nombre", "Tú", undefined]) assert.equal(selfName({ settings: { userName } }), "Tú", String(userName));
  assert.equal(selfName({ settings: { userName: "Tu cuenta" }, peers: { me: { name: "Sin nombre" } } }), "Tú");
  assert.equal(selfName({ settings: { userName: "Tu cuenta" }, account: { name: "Sergio Rico" } }), "Sergio Rico");
  assert.equal(selfName({ settings: { userName: "Lucía" } }), "Lucía");
  assert.equal(selfLabel("Sin nombre"), "Tú");
  assert.equal(selfLabel("Lucía Martín"), "Lucía Martín");
  assert.equal(lacksOwnName({ peers: { me: { name: "Sin nombre" } } }), true);
  // The bots' USER.md never says «Tu cuenta»: they ask before signing in the person's name.
  assert.match(src("server/soul.mjs"), /pregúntaselo antes de firmar nada en su nombre/);
  assert.ok(!/userName: settings\.userName \|\| "Tu cuenta"/.test(src("server/soul.mjs")));
});

test("Nueva sala: says what is missing, starts with the coordinator, and its limit is the real one", () => {
  const sheet = src("src/components/v3/team/NewRoomSheet.jsx");
  assert.match(sheet, /"Falta el nombre de la sala\."/);
  assert.match(sheet, /aria-describedby=\{missing \? "room-new-missing" : undefined\}/);
  assert.match(sheet, /\? \["atlas"\] : \[\]/, "the coordinator is preselected");
  assert.match(sheet, /coordina; hasta \$\{ROOM_MAX_BOTS\} más/);
  assert.match(src("server/room.mjs"), /bots: 6,/, "six besides the coordinator, as the sheet says");
});

test("Ctrl N, the palette and the «Nuevo» menu agree; places go Ctrl 1 to 5", () => {
  const side = src("src/components/v3/Sidebar.jsx");
  const palette = src("src/screens/CommandPalette.jsx");
  assert.match(side, /if \(k === "n"\) \{ e\.preventDefault\(\); setMenu/, "Ctrl N opens «Nuevo»");
  assert.match(palette, /label: "Nuevo…"[^\n]*kbd: inCode \? null : "Ctrl N"[^\n]*colmena:new/, "the palette's Ctrl N opens the same menu");
  assert.ok(!/label: "Nuevo chat"[^\n]*"Ctrl N"/.test(palette), "«Nuevo chat» no longer claims Ctrl N");
  assert.match(side, /export const NEW_FIRST = \["chat", "sala", "tarea", "rutina"\]/, "four first; Sala, Chat and Tarea never hidden");
  assert.match(side, /if \(\/\^\[1-5\]\$\/\.test\(e\.key\)\)/);
  assert.match(src("src/components/v2/settings/General.jsx"), /"Ctrl 1 – 5"/);
  assert.match(palette, /navigate|go\("\/personas\/como-funciona"\)/, "the help page is in Ctrl+K");
});

test("Ajustes tells «Quién usa este ordenador» from «Contactos y equipos», old links still work", () => {
  const general = src("src/components/v2/settings/General.jsx");
  assert.match(general, /anchor="personas" title="Contactos y equipos"/);
  assert.match(general, /to="\/ajustes\/contactos"/);
  assert.match(src("src/components/v2/settings/sections.js"), /id: "contactos", label: "Contactos y equipos"/);
});

test("small things a person notices: autonomy only when unusual, Modo experto says «sin cuenta», targets and contrast", () => {
  const parts = src("src/components/v3/team/parts.jsx");
  assert.match(parts, /export const autonomyShown = \(id\) => \(id \|\| DEFAULT_AUTONOMY\) !== DEFAULT_AUTONOMY;/);
  const equipo = src("src/screens/ColmenaV2.jsx");
  assert.match(equipo, /autonomyShown\(bot\.autonomy\) \?/);
  assert.match(equipo, /"sin cuenta de IA"/);
  assert.match(src("src/components/v2/code/CodeHome.jsx"), /type="checkbox" checked=\{multi\}[^\n]*width: "24px", height: "24px"/);
  assert.match(src("src/styles/base.css"), /\.c-on-dark::placeholder\{color:#A9ACB6/);
  assert.match(src("src/components/v3/team/People.jsx"), /className="c-quiet c-on-dark"/);
});

test("rooms: the same log structure, a subtitle that is never cut, a task's conversation says what it is", () => {
  const room = src("src/screens/Room.jsx");
  assert.match(room, /role="log" aria-live="off"/);
  assert.match(room, /WebkitLineClamp: 2/);
  assert.match(room, /title=\{subtitle\}/);
  assert.match(room, /`Conversación de la tarea «\$\{taskTalk\.title\}»`/);
  assert.match(room, /"volver a la tarea"/);
  assert.match(src("src/components/room/MemberPanel.jsx"), /href="\/personas\/como-funciona"/);
});

test("onboarding «¿Con quién trabajas?»: one primary action per state", () => {
  const onb = src("src/screens/BienvenidaV2.jsx");
  assert.match(onb, /Ponle nombre al equipo y pulsa «Crear equipo», o elige «Empezar solo»\./);
  assert.match(onb, /disabled=\{!!busy \|\| connecting \|\| !!teamPending\}/);
});
