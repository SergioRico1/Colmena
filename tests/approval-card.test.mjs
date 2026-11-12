import test from "node:test";
import assert from "node:assert/strict";
import { approvalCard, expiryLine, leftText, redLineVerb, sendWhat, GROUP_VERBS, UNDO_SECONDS } from "../src/lib/approvalCard.js";
import { UNDO_MS } from "../src/lib/undoable.js";
import { APPROVAL_TTL_MS } from "../server/state.mjs";

// One approval card model for every surface (src/lib/approvalCard.js): the verbs of each kind,
// which button is held, the undo line and what the expiry line says happens.

const NOW = Date.parse("2026-11-12T10:00:00Z");
const inMin = (n) => new Date(NOW + n * 60000).toISOString();
const base = (extra = {}) => ({ id: "a1", status: "pending", kind: "permission", botId: "bruno", title: "Instalar una librería", summary: "Instalar una librería para leer hojas de cálculo.", ...extra });
const card = (a, options = {}) => approvalCard(a, { botName: "Bruno", now: NOW, ...options });
const labels = (m) => [m.primary?.label, ...m.secondary.map((s) => s.label)];
const email = { to: ["ana@ejemplo.com", "luis@ejemplo.com"], cc: [], cco: [], subject: "Resumen semanal", body: "Hola a todos.", attachments: [] };

test("an ordinary request: Aprobar, Siempre where the server allows it, Revisar, No permitir", () => {
  const m = card(base({ canAlways: true }));
  assert.deepEqual(labels(m), ["Aprobar", "Siempre a Bruno", "Revisar", "No permitir"]);
  assert.equal(m.primary.hold, false);
  assert.equal(m.primary.action, "approve");
  assert.equal(m.secondary.find((s) => s.id === "review").href, "/revisar/a1");
  assert.equal(m.undoLine, "Tendrás 10 segundos para deshacer.");
  assert.equal(m.expiryLine, null, "it waits as long as it takes");
  assert.equal(m.waitText, "Se aprueba en");
  assert.equal(m.denyToast, "No se permite");
  // In a connected app «Siempre» names the app; without `canAlways` it is not offered.
  assert.deepEqual(labels(card(base({ canAlways: true, app: "Google Calendar" }))), ["Aprobar", "Siempre en Google Calendar", "Revisar", "No permitir"]);
  assert.deepEqual(labels(card(base({ canAlways: false }))), ["Aprobar", "Revisar", "No permitir"]);
  for (const kind of ["write", "memory", "read", "skill", "soul"]) assert.deepEqual(labels(card(base({ kind }))), ["Aprobar", "Revisar", "No permitir"], kind);
});

test("the undo line is only promised where the surface gives the undo window", () => {
  assert.equal(card(base(), { undo: false }).undoLine, null);
  assert.equal(UNDO_SECONDS * 1000, UNDO_MS, "the line and the real window agree");
  assert.equal(GROUP_VERBS.undoLine, "Tendrás 10 segundos para deshacer.");
});

test("a send: held, says what it does, who it goes to and the subject; never «Siempre»", () => {
  const m = card(base({ kind: "send", canAlways: true, title: "Enviar el resumen", email, expiresAt: inMin(11) }));
  assert.deepEqual(labels(m), ["Mantén para enviar", "Revisar", "No enviar"]);
  assert.equal(m.primary.hold, true);
  assert.equal(m.primary.plain, "Enviar", "two steps under reduced motion: «Enviar», then «Confirmar»");
  assert.equal(m.title, "Enviar «Resumen semanal»");
  assert.deepEqual(m.send.to, ["ana@ejemplo.com", "luis@ejemplo.com"]);
  assert.equal(m.send.subject, "Resumen semanal");
  assert.equal(m.send.truncated, false);
  assert.equal(m.truncatedLine, null);
  assert.equal(m.waitText, "Se envía en");
  assert.equal(m.denyToast, "No se envía");
  assert.equal(m.undoLine, "Tendrás 10 segundos para deshacer.");
  assert.equal(m.expiryLine.text, "Si no decides en 11 min, caduca y no se envía. Después tendrás que pedirle a Bruno que lo prepare otra vez.");
});

test("a card says so when it cuts the text or the recipients", () => {
  const long = { ...email, body: "palabra ".repeat(80), to: ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"], cc: ["f@x.com"] };
  const s = sendWhat(long, { excerpt: 100 });
  assert.equal(s.truncated, true);
  assert.ok(s.excerpt.length <= 101 && s.excerpt.endsWith("…"));
  assert.deepEqual(s.to, ["a@x.com", "b@x.com", "c@x.com"]);
  assert.equal(s.moreTo, 2);
  assert.equal(s.copies, 1);
  assert.equal(card(base({ kind: "send", email: long })).truncatedLine, "Aquí va recortado: ábrelo en «Revisar» para leerlo entero.");
  // Four recipients are all named: never «y 1 más».
  assert.equal(sendWhat({ ...email, to: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"] }).moreTo, 0);
  // A short text to few people is whole: nothing to say.
  assert.equal(sendWhat(email).truncated, false);
});

test("every red line names what it does and is held", () => {
  const red = (impact) => card(base({ redLine: true, canAlways: true, impact, expiresAt: inMin(5) }));
  const cases = [
    [{ tone: "money", headline: "Pagar 120,00 € a Acme" }, "pagar", "Mantén para pagar", "No pagar", "no se paga"],
    [{ tone: "money", headline: "Devolver 20,00 €" }, "devolver", "Mantén para devolver", "No devolver", "no se devuelve"],
    [{ tone: "public", headline: "Publicar en público" }, "publicar", "Mantén para publicar", "No publicar", "no se publica"],
    [{ tone: "private", headline: "Publicar con visibilidad restringida" }, "publicar", "Mantén para publicar", "No publicar", "no se publica"],
    [{ tone: "delete", headline: "Borrar 3 elementos" }, "borrar", "Mantén para borrar", "No borrar", "no se borra"],
    [{ tone: "delete", headline: "Archivar 1 elemento" }, "archivar", "Mantén para archivar", "No archivar", "no se archiva"],
    [{ tone: "external", headline: "Enviar a ana@ejemplo.com" }, "enviar", "Mantén para enviar", "No enviar", "no se envía"],
    [{ tone: "internal", headline: "Invitar a 3 personas" }, "invitar", "Mantén para invitar", "No invitar", "no se invita a nadie"],
  ];
  for (const [impact, verb, primary, deny, undone] of cases) {
    const m = red(impact);
    assert.equal(m.verb, verb);
    assert.deepEqual(labels(m), [primary, "Revisar", deny], verb);
    assert.equal(m.primary.hold, true);
    assert.equal(m.impact, impact.headline);
    assert.ok(m.expiryLine.text.includes(`caduca y ${undone}.`), m.expiryLine.text);
  }
  // A red line the server does not describe (a risky command): still held, in general words.
  const plain = card(base({ redLine: true }));
  assert.deepEqual(labels(plain), ["Mantén para aprobar", "Revisar", "No permitir"]);
  assert.equal(plain.primary.plain, "Aprobar");
  assert.equal(redLineVerb(base()), null);
});

test("a plan and a key are decided where they are read; a question keeps its own options", () => {
  const plan = card(base({ kind: "plan", missionId: "m1", title: "Plan para el informe" }));
  assert.deepEqual(labels(plan), ["Revisar el plan"]);
  assert.equal(plan.primary.action, "open");
  assert.equal(plan.primary.href, "/sala/m1#plan");
  assert.equal(plan.undoLine, null);
  const secret = card(base({ kind: "secret", expiresAt: inMin(14) }));
  assert.deepEqual(labels(secret), ["Revisar"]);
  assert.equal(secret.expiryLine.text, "Si no respondes en 14 min, Bruno sigue sin la clave.");
  const question = card(base({ kind: "question", waitUntil: inMin(3) }));
  assert.equal(question.primary, null);
  assert.equal(question.expiryLine.text, "Si no respondes en 3 min, Bruno sigue con la opción más prudente. Podrás responder después.");
  assert.equal(card(base({ kind: "question", questions: [{}, {}] })).title, "Bruno tiene 2 preguntas");
});

test("the expiry line states what the server does, and when", () => {
  const send = base({ kind: "send", email });
  assert.equal(expiryLine(send, { botName: "Vera", now: NOW }), null, "no deadline, no line");
  assert.equal(expiryLine({ ...send, status: "approved", expiresAt: inMin(5) }, { now: NOW }), null, "only while it waits");
  const soon = expiryLine({ ...send, expiresAt: inMin(1) }, { botName: "Vera", now: NOW });
  assert.equal(soon.urgent, true);
  assert.equal(soon.text, "Si no decides en 1 min, caduca y no se envía. Después tendrás que pedirle a Vera que lo prepare otra vez.");
  assert.equal(expiryLine({ ...send, expiresAt: inMin(11) }, { botName: "Vera", now: NOW }).urgent, false);
  assert.equal(expiryLine({ ...send, expiresAt: inMin(-1) }, { botName: "Vera", now: NOW }).text, "Ha caducado y no se envía. Pídele a Vera que lo prepare otra vez.");
  // A send you asked for yourself leaves on its own: that is the nearer fact.
  assert.equal(expiryLine({ ...send, autoSendAt: new Date(NOW + 8000).toISOString(), expiresAt: inMin(20) }, { now: NOW }).text, "Lo pediste tú: se envía solo en 8 s si no lo cancelas.");
  // A timed question that already ran out stays open.
  assert.equal(expiryLine(base({ kind: "question", waitUntil: inMin(-2), stillOpen: true }), { now: NOW }), null);
  // The server's window for what leaves the computer is the 30 minutes the line counts down.
  assert.equal(APPROVAL_TTL_MS, 30 * 60000);
  assert.equal(leftText(45000), "45 s");
  assert.equal(leftText(11 * 60000 - 1), "11 min");
  assert.equal(leftText(3 * 3600e3), "3 h");
});

test("several requests decided together use the same words everywhere", () => {
  assert.deepEqual({ ...GROUP_VERBS }, { approve: "Aprobar todas", retry: "Reintentar todas", each: "Ver cada una", together: "Ver juntas", deny: "No permitir", undoLine: "Tendrás 10 segundos para deshacer." });
});
