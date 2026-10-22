import test from "node:test";
import assert from "node:assert/strict";
import { NOW, fakeConnections, itemsIn, mail, temp, watcherFor } from "./fixtures/watch-fixture.mjs";
import { availability, gmailUrl, ownAddress, sourceLinks, watchBot, watchNotesState } from "../server/watch.mjs";
import { needsOf, needsCount } from "../src/components/v2/needs.js";

test("the mail bot is the one that may do most with your mail; Atlas when nobody can", async (t) => {
  const store = await temp(t);
  assert.equal(watchBot(store).id, "vera");
  for (const b of store.list("bots")) store.patch("bots", b.id, { tools: { ...(b.tools || {}), correo: "none" } });
  assert.equal(watchBot(store).id, "atlas");
  assert.equal(watchBot(store, { botId: "nora" }).id, "nora");
});

test("a proposed meeting: it looks at your calendar and asks in its chat whether to answer", async (t) => {
  const store = await temp(t);
  const connections = fakeConnections({
    inbox: [mail("m1", { sender: "Miguel <miguel@pagora.com>", subject: "Reunión Pagora", preview: { body: "¿Os va bien el martes 20 de 12:00 a 12:30?" } })],
    events: [{ summary: "Comité", start: { dateTime: "2026-10-20T10:00:00+02:00" }, end: { dateTime: "2026-10-20T11:00:00+02:00" } }],
  });
  const { w, calls, notices } = watcherFor(store, connections, [
    { ids: ["n1"] },
    { puntos: [{ ids: ["n1"], tipo: "reunion", urgente: true, hechos: "Miguel propone reunión de Pagora el martes 20 de 12:00 a 12:30.", reunion: { huecos: [{ inicio: "2026-10-20T12:00:00+02:00", fin: "2026-10-20T12:30:00+02:00" }] }, pideRespuesta: true }] },
    { texto: "Miguel propone la reunión de Pagora el martes 20 de 12:00 a 12:30. Tienes ese hueco libre.", pregunta: "¿Le contesto que te va bien?", respuestas: ["Sí, contéstale", "Busca otro hueco"], titulo: "Reunión de Pagora el martes" },
  ]);
  const result = await w.tick({ force: true });
  assert.equal(result.notes, 1);
  // Picked and sorted on the everyday model, written on the bot's own one; all think «low».
  assert.deepEqual(calls.map((c) => c.model), ["gpt-6-luna", "gpt-6-luna", "gpt-6.1-sol"]);
  assert.ok(calls.every((c) => c.reasoning?.effort === "low"));
  // Picking sees snippets; only the picked mail is read in full, as text.
  const sortedInput = itemsIn(calls[1].input[0].content);
  assert.ok(sortedInput.nuevo[0].texto.endsWith("(texto completo)"));
  assert.doesNotMatch(sortedInput.nuevo[0].texto, /<p>/);
  assert.equal(sortedInput.nuevo[0].fuente, "Correo");
  const written = JSON.parse(calls[2].input[0].content);
  assert.equal(written.puntos[0].agenda[0].libre, true);
  // Only reads went to the service: nothing was sent or created.
  assert.ok(connections.log.filter((x) => x.op === "prepare").every((x) => /FETCH_EMAILS|FETCH_MESSAGE_BY_MESSAGE_ID|EVENTS_LIST/.test(x.args.tool)));
  assert.ok(connections.log.filter((x) => x.op === "prepare" && /FETCH_EMAILS/.test(x.args.tool)).every((x) => JSON.parse(x.args.arguments_json).verbose === false));

  const chat = store.list("missions").find((m) => m.watch);
  assert.equal(chat.conversation, true);
  assert.deepEqual(chat.botIds, ["vera"]);
  const message = store.list("messages").find((m) => m.missionId === chat.id);
  assert.equal(message.role, "assistant");
  assert.match(message.text, /Tienes ese hueco libre/);
  assert.match(message.text, /\[Correo de Miguel\]\(https:\/\/mail\.google\.com\/mail\/u\/\?authuser=marina%40lumbre\.es#all\/t-m1\)/);
  const [note] = watchNotesState(store);
  assert.equal(note.question, "¿Le contesto que te va bien?");
  assert.deepEqual(note.replies, ["Sí, contéstale", "Busca otro hueco"]);
  assert.equal(notices[0].kind, "question");
  assert.equal(notices[0].url, `/chat/vera?c=${chat.id}`);
  // Hoy counts it as something that needs you.
  assert.equal(needsCount({ approvals: [], missions: [], watchNotes: watchNotesState(store) }), 1);
  assert.equal(needsOf({ watchNotes: watchNotesState(store) }).notes.length, 1);

  // The same mail never comes twice, and a look with nothing new calls no model.
  const again = await w.tick({ force: true });
  assert.equal(again.reason, "nada nuevo");
  assert.equal(calls.length, 3);
});

test("your answer from Hoy is said in the chat and closes the question; typing there closes it too", async (t) => {
  const store = await temp(t);
  const connections = fakeConnections({ inbox: [mail("m1"), mail("m2", { subject: "Otra cosa", threadId: "t-x" })] });
  const { w, said } = watcherFor(store, connections, [
    { ids: ["n1"] },
    { puntos: [{ ids: ["n1"], tipo: "peticion", urgente: true, hechos: "Oriol pide confirmar la revisión antes del lunes 19.", pideRespuesta: true }] },
    { texto: "Te dejo un pendiente con plazo: Oriol pidió confirmar la revisión de costes antes del lunes 19.", pregunta: "¿La reviso yo?", respuestas: ["Sí, revísala"] },
    { ids: ["n1"] },
    { puntos: [{ ids: ["n1"], tipo: "peticion", urgente: true, hechos: "Otra petición.", pideRespuesta: true }] },
    { texto: "Otra petición.", pregunta: "¿Te ayudo?", respuestas: ["Sí"] },
  ]);
  w.start();
  t.after(() => w.stop());
  await w.tick({ force: true });
  const [note] = watchNotesState(store);
  await w.reply(note.id, "Sí, revísala");
  assert.equal(said[0].text, "Sí, revísala");
  assert.equal(said[0].missionId, note.missionId);
  assert.equal(watchNotesState(store).length, 0);

  connections.log.length = 0;
  const inbox = [mail("m3", { subject: "Petición nueva", threadId: "t-3", messageTimestamp: "2026-10-19T08:39:00Z" })];
  const c2 = fakeConnections({ inbox });
  w.connections = c2;
  await w.tick({ force: true });
  assert.equal(watchNotesState(store).length, 1);
  store.put("messages", { id: "typed", missionId: note.missionId, role: "user", text: "Ya lo miro yo", kind: "message", at: new Date(NOW).toISOString() });
  await new Promise((r) => setImmediate(r));
  assert.equal(watchNotesState(store).length, 0);
});

test("nothing that matters: no message, no notice; «solo lo urgente» keeps only what needs you", async (t) => {
  const store = await temp(t);
  const { w, notices } = watcherFor(store, fakeConnections({ inbox: [mail("n1", { subject: "Boletín" })] }), [{ ids: [] }]);
  assert.equal((await w.tick({ force: true })).reason, "nada importante");
  assert.equal(store.list("messages").length, 0);
  assert.equal(notices.length, 0);

  const store2 = await temp(t);
  store2.patch("settings", "main", (s) => ({ watch: { ...(s.watch || {}), level: "urgente" } }));
  const { w: w2 } = watcherFor(store2, fakeConnections({ inbox: [mail("i1")] }), [{ ids: ["n1"] }, { puntos: [{ ids: ["n1"], tipo: "aviso", urgente: false, hechos: "REVER canceló la reunión.", pideRespuesta: false }] }]);
  assert.equal((await w2.tick({ force: true })).reason, "nada importante");
});

test("anything the service does not mark as a read is dropped; that source stops after three failures, the others go on", async (t) => {
  const store = await temp(t);
  const connections = fakeConnections({ inbox: [mail("m1")], readScope: false });
  const { w, calls } = watcherFor(store, connections, []);
  const result = await w.tick({ force: true });
  assert.equal(result.reason, "nada nuevo");
  assert.equal(calls.length, 0);
  assert.ok(connections.log.some((x) => x.op === "discard"));
  assert.ok(!connections.log.some((x) => x.op === "commit"));
  const mail1 = w.view().sources.find((s) => s.id === "gmail");
  assert.equal(mail1.connected, true);
  assert.match(mail1.error, /solo lectura/);
  for (let i = 0; i < 2; i++) await w.tick({ force: true });
  assert.equal(w.view().sources.find((s) => s.id === "gmail").stopped, true);
  connections.log.length = 0;
  await w.tick(); // not forced: a stopped source is not read again
  assert.ok(!connections.log.some((x) => x.op === "prepare" && /GMAIL/.test(x.args.tool)));
});

test("off in Ajustes, or with the team paused, it does not look", async (t) => {
  const store = await temp(t);
  const { w } = watcherFor(store, fakeConnections({ inbox: [mail("m1")] }), []);
  store.patch("settings", "main", { watch: { enabled: false } });
  assert.equal(w.due(NOW), false);
  store.patch("settings", "main", { watch: { enabled: true }, paused: true });
  assert.equal(w.due(NOW), false);
  store.patch("settings", "main", { paused: false });
  assert.equal(w.due(NOW), true);
});

test("availability: what overlaps is busy; declined and «free» events do not count", () => {
  const slot = [{ inicio: "2026-10-21T12:00:00+02:00", fin: "2026-10-21T12:30:00+02:00" }];
  const ev = (over) => ({ summary: "Comité", start: { dateTime: "2026-10-21T11:30:00+02:00" }, end: { dateTime: "2026-10-21T12:15:00+02:00" }, ...over });
  assert.equal(availability(slot, [ev()])[0].libre, false);
  assert.equal(availability(slot, [ev()])[0].choca[0].titulo, "Comité");
  assert.equal(availability(slot, [ev({ transparency: "transparent" })])[0].libre, true);
  assert.equal(availability(slot, [ev({ attendees: [{ self: true, responseStatus: "declined" }] })])[0].libre, true);
  assert.equal(availability(slot, [ev({ start: { dateTime: "2026-10-21T12:30:00+02:00" }, end: { dateTime: "2026-10-21T13:00:00+02:00" } })])[0].libre, true);
});

test("links and addresses: your address is the one most mail goes to; one link per thread", () => {
  assert.equal(ownAddress([{ to: "Marina <marina@lumbre.es>" }, { to: "marina@lumbre.es, ana@lumbre.es" }, { to: "ana@lumbre.es" }, { to: "marina@lumbre.es" }]), "marina@lumbre.es");
  assert.equal(gmailUrl({ threadId: "abc" }), "https://mail.google.com/mail/u/0/#all/abc");
  assert.equal(sourceLinks([{ id: "1", hilo: "h", de: "Oriol Vidal <o@v.es>", url: "u1" }, { id: "2", hilo: "h", de: "Oriol", url: "u2" }]), "[Correo de Oriol](u1)");
});

test("a page the service finds too big is asked again smaller; after three failures it stops until you ask", async (t) => {
  const store = await temp(t);
  const sizes = [];
  let failedOnce = false;
  const base = fakeConnections({ inbox: [mail("m1")] });
  const connections = {
    log: base.log,
    async call(op, args = {}) {
      if (op === "commit" && !failedOnce) { failedOnce = true; return { ok: false, error: "Respuesta de el servicio de conexiones demasiado grande. Acota la consulta." }; }
      if (op === "prepare" && args.tool === "GMAIL_FETCH_EMAILS") sizes.push(JSON.parse(args.arguments_json).max_results);
      return base.call(op, args);
    },
  };
  const { w } = watcherFor(store, connections, [{ ids: [] }]);
  assert.equal((await w.tick({ force: true })).reason, "nada importante");
  assert.deepEqual(sizes.slice(0, 2), [20, 8], "retried with a smaller page");
  // The smaller size is kept: the next look does not fail the same way again.
  sizes.length = 0;
  await w.tick({ force: true });
  assert.equal(sizes[0], 8);
  assert.ok(base.log.filter((x) => x.op === "prepare").every((x) => JSON.parse(x.args.arguments_json).include_payload === false || !/FETCH_EMAILS/.test(x.args.tool)));

  const failing = { async call(op) { if (op === "accounts") throw Error("caído"); return {}; } };
  const { w: w2 } = watcherFor(store, failing, []);
  for (let i = 0; i < 3; i++) await w2.tick({ force: true });
  assert.equal(w2.view().stopped, true);
  assert.equal(w2.due(NOW + 5 * 3600000), false);
});

test("an answer the service cut (over 80 000 characters) is asked again smaller, without a failed read", async (t) => {
  const store = await temp(t);
  const base = fakeConnections({ inbox: [mail("m1")] });
  let cut = true;
  const connections = { log: base.log, async call(op, args = {}) {
    if (op === "commit" && cut) { cut = false; await base.call(op, args); return { ok: true, data: { preview: "{…", truncated: true } }; }
    return base.call(op, args);
  } };
  const { w } = watcherFor(store, connections, [{ ids: [] }]);
  assert.equal((await w.tick({ force: true })).reason, "nada importante");
  const sizes = base.log.filter((x) => x.op === "prepare" && /FETCH_EMAILS/.test(x.args.tool)).map((x) => JSON.parse(x.args.arguments_json).max_results);
  assert.deepEqual(sizes.slice(0, 2), [20, 8]);
});

test("mail older than the look is old news even if the list brings it; companies are named by their domain", async (t) => {
  const store = await temp(t);
  const old = mail("old", { messageTimestamp: "2026-10-06T09:00:00Z" });
  const { w, calls } = watcherFor(store, fakeConnections({ inbox: [old] }), []);
  assert.equal((await w.tick({ force: true })).reason, "nada nuevo");
  assert.equal(calls.length, 0);
  assert.equal(sourceLinks([{ id: "1", de: "No Reply <noreply@aquamar.es>", url: "u" }]), "[Correo de Aquamar](u)");
  assert.equal(sourceLinks([{ id: "1", de: "Ana Ruiz <ana@orvalia.es>", url: "u" }]), "[Correo de Ana](u)");
});
