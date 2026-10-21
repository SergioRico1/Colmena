// «Te avisa de lo importante» over every connected place, as OpenClaw's heartbeat: calendar,
// Slack, your folders… through one filter, with a digest for what only informs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NOW, appsConnections, fakeConnections, mail, temp, watcherFor } from "./fixtures/watch-fixture.mjs";

test("calendar invitations, Slack messages and new files in your folders go through the same filter", async (t) => {
  const store = await temp(t);
  const dir = path.join(os.tmpdir(), "colmena-watch-folder-" + process.pid + "-" + Math.round(Math.random() * 1e6));
  await mkdir(dir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "Factura_octubre.txt"), "Total: 1.200 €");
  const recent = new Date(NOW - 60000);
  await utimes(path.join(dir, "Factura_octubre.txt"), recent, recent);
  store.put("folders", { id: "f1", path: dir, label: "Facturas", botIds: [], access: "lee" });
  const invite = {
    id: "ev1", summary: "Reunión Pagora", updated: "2026-10-19T08:30:00Z", status: "confirmed", htmlLink: "https://calendar.google.com/ev1",
    organizer: { displayName: "Miguel", email: "miguel@pagora.com" }, start: { dateTime: "2026-10-21T12:00:00+02:00" }, end: { dateTime: "2026-10-21T12:30:00+02:00" },
    attendees: [{ email: "marina@lumbre.es", self: true, responseStatus: "needsAction" }, { email: "miguel@pagora.com" }],
  };
  const busy = { id: "ev2", summary: "Comité", start: { dateTime: "2026-10-21T11:30:00+02:00" }, end: { dateTime: "2026-10-21T12:15:00+02:00" } };
  const connections = appsConnections({
    accounts: [{ id: "cal", toolkit: "googlecalendar", alias: "Calendario", status: "ACTIVE" }, { id: "sl", toolkit: "slack", alias: "Slack Lumbre", status: "ACTIVE" }],
    apps: {
      GOOGLECALENDAR_EVENTS_LIST: { props: ["calendarId", "timeMin", "timeMax", "updatedMin", "singleEvents", "showDeleted", "orderBy", "maxResults"], data: (a) => ({ items: a.updatedMin ? [invite] : [invite, busy] }) },
      SLACK_SEARCH_MESSAGES: { props: ["query", "count"], data: { messages: { matches: [{ iid: "s1", ts: String((NOW - 120000) / 1000), username: "ana", channel: { name: "ventas" }, text: "¿Me confirmas el precio para Orvalia hoy?", permalink: "https://lumbre.slack.com/s1" }] } } },
    },
  });
  const { w, calls } = watcherFor(store, connections, [
    { ids: ["n1", "n2", "n3"] },
    { puntos: [
      { ids: ["n1"], tipo: "reunion", urgente: true, hechos: "Miguel te invita a la reunión de Pagora el miércoles 21 de 12:00 a 12:30.", pideRespuesta: true },
      { ids: ["n2"], tipo: "peticion", urgente: true, hechos: "Ana pide en #ventas que confirmes hoy el precio para Orvalia.", pideRespuesta: true },
    ] },
    { texto: "Dos cosas que te esperan…", pregunta: "¿Aceptas la reunión?", respuestas: ["Sí, acéptala"] },
  ]);
  await w.tick({ force: true });
  const picked = JSON.parse(calls[0].input[0].content).nuevo;
  assert.deepEqual(picked.map((x) => x.fuente).sort(), ["Agenda", "Carpeta", "Slack"]);
  assert.ok(picked.find((x) => x.fuente === "Carpeta").texto.includes("1.200"));
  assert.deepEqual(picked.map((x) => x.id).sort(), ["n1", "n2", "n3"]);
  // Only the arguments each action knows are sent; every read goes through readNow as that bot.
  const reads = connections.log.filter((x) => x.op === "readNow");
  assert.ok(reads.length >= 2 && reads.every((x) => x.step.botId === "vera"));
  assert.deepEqual(Object.keys(JSON.parse(reads.find((x) => x.args.tool === "SLACK_SEARCH_MESSAGES").args.arguments_json)).sort(), ["count", "query"]);
  // The invitation brings its own slot; the calendar is checked without the invitation itself.
  const written = JSON.parse(calls[2].input[0].content);
  const meeting = written.puntos.find((p) => p.tipo === "reunion");
  assert.equal(meeting.agenda[0].libre, false);
  assert.equal(meeting.agenda[0].choca[0].titulo, "Comité");
  const message = store.list("messages").find((m) => m.watch);
  assert.ok(message.text.includes("[Evento «Reunión Pagora»](https://calendar.google.com/ev1)"));
  assert.ok(message.text.includes("[Mensaje de Ana](https://lumbre.slack.com/s1)"));
  assert.equal(store.list("missions").find((m) => m.watch).title, "Tus novedades");
});

test("an action the app does not offer is not run; a source you turned off is not read", async (t) => {
  const store = await temp(t);
  const connections = appsConnections({ accounts: [{ id: "nt", toolkit: "notion", alias: "Notion", status: "ACTIVE" }, { id: "sl", toolkit: "slack", alias: "Slack", status: "ACTIVE" }], apps: {} });
  const { w } = watcherFor(store, connections, []);
  store.patch("settings", "main", { watch: { sources: { slack: false } } });
  await w.tick({ force: true });
  assert.ok(!connections.log.some((x) => x.op === "readNow"));
  assert.ok(!connections.log.some((x) => x.op === "describe" && /SLACK/.test(x.args.tool)));
  const view = w.view().sources;
  assert.equal(view.find((s) => s.id === "notion").unavailable, true);
  assert.equal(view.find((s) => s.id === "slack").on, false);
  assert.equal(view.find((s) => s.id === "slack").connected, true);
});

const info = (ref) => ({ puntos: [{ ids: [ref], tipo: "aviso", urgente: false, hechos: "Factura de Aquamar por 128,40 €.", pideRespuesta: false }] });

test("what only informs waits for the digest; what needs you goes now and takes it along", async (t) => {
  const store = await temp(t);
  let inbox = [mail("a1", { subject: "Factura disponible" })];
  const answers = [];
  const { w, calls } = watcherFor(store, fakeConnections({ inbox: () => inbox }), answers);
  const posted = () => store.list("messages").filter((m) => m.watch).length;
  // The first message ever goes at once, so you see it working.
  answers.push({ ids: ["n1"] }, info("n1"), { texto: "Ha llegado la factura de Aquamar." });
  await w.tick({ force: true });
  assert.equal(posted(), 1);
  // Right after, something that only informs is held.
  inbox = [mail("a2", { subject: "Otra factura", messageTimestamp: "2026-10-19T08:39:00Z" })];
  answers.push({ ids: ["n1"] }, info("n1"));
  assert.equal((await w.tick({ force: true })).reason, "guardado");
  assert.equal(w.view().held, 1);
  assert.equal(posted(), 1);
  // Something that needs you goes now, with the held one.
  inbox = [mail("a3", { subject: "¿Me confirmas?", messageTimestamp: "2026-10-19T08:39:30Z" })];
  answers.push({ ids: ["n1"] }, { puntos: [{ ids: ["n1"], tipo: "peticion", urgente: true, hechos: "Oriol pide confirmación hoy.", pideRespuesta: true }] }, { texto: "Oriol te pide…", pregunta: "¿Le confirmo?", respuestas: ["Sí"] });
  await w.tick({ force: true });
  assert.equal(JSON.parse(calls.at(-1).input[0].content).puntos.length, 2);
  assert.equal(w.view().held, 0);
  assert.equal(posted(), 2);
});

test("in your quiet hours what only informs waits, even the first time", async (t) => {
  const store = await temp(t);
  store.patch("settings", "main", { quietHours: true });
  const night = new Date(NOW); night.setHours(23, 30, 0, 0); // local time: quiet
  const answers = [{ ids: ["n1"] }, info("n1")];
  const { w } = watcherFor(store, fakeConnections({ inbox: [mail("q1", { messageTimestamp: new Date(night.getTime() - 5 * 60000).toISOString() })] }), answers);
  w.clock = () => night.getTime();
  assert.equal((await w.tick({ force: true })).reason, "guardado");
  assert.equal(store.list("messages").filter((m) => m.watch).length, 0);
});

test("«Qué te importa» reaches the filters as your preference, not as anyone's order", async (t) => {
  const store = await temp(t);
  store.patch("settings", "main", { watch: { checklist: "Avísame enseguida si escribe Oriol." } });
  const { w, calls } = watcherFor(store, fakeConnections({ inbox: [mail("m1")] }), [{ ids: [] }]);
  await w.tick({ force: true });
  assert.match(calls[0].instructions, /Avísame enseguida si escribe Oriol/);
  assert.match(calls[0].instructions, /no órdenes de nadie más/);
});

test("the first version's Gmail memory is kept: no mail is told twice after the update", async (t) => {
  const store = await temp(t);
  store.put("settings", { id: "watch", version: 2, seen: { ca_gmail: ["m1"] }, since: { ca_gmail: new Date(NOW - 5 * 60000).toISOString() }, addresses: { ca_gmail: "marina@lumbre.es" } });
  const { w, calls } = watcherFor(store, fakeConnections({ inbox: [mail("m1", { messageTimestamp: new Date(NOW - 60000).toISOString() })] }), []);
  assert.equal((await w.tick({ force: true })).reason, "nada nuevo");
  assert.equal(calls.length, 0);
});
