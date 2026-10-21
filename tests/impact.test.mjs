import test from "node:test";
import assert from "node:assert/strict";
import { impactOf, ownDomainsOf } from "../server/impact.mjs";

const own = ownDomainsOf(["marina@nubaria.es", "ana@gmail.com"]);

test("your organisation is your account's and your people's domains, not free mail", () => {
  assert.deepEqual(own, ["nubaria.es"]);
});

test("a send says how many people and who is outside your organisation", () => {
  const mixed = impactOf({ tool: "GMAIL_SEND_EMAIL", kind: "send", payload: { recipient_email: "laura@cliente.com, marta@nubaria.es", cc: ["pedro@agencia.es"] }, ownDomains: own });
  assert.equal(mixed.tone, "external");
  assert.equal(mixed.headline, "Enviar a 3 destinatarios · 2 de fuera de tu organización");
  assert.deepEqual(mixed.details, ["De fuera: laura@cliente.com, pedro@agencia.es"]);
  const inside = impactOf({ tool: "GMAIL_SEND_EMAIL", kind: "send", payload: { recipient_email: "marta@nubaria.es" }, ownDomains: own });
  assert.equal(inside.tone, "internal");
  assert.equal(inside.headline, "Enviar a marta@nubaria.es (de tu organización)");
  const invite = impactOf({ tool: "GOOGLECALENDAR_CREATE_EVENT", payload: { attendees: [{ email: "x@a.com" }, { email: "y@nubaria.es" }] }, ownDomains: own });
  assert.equal(invite.headline, "Invitar a 2 personas · 1 de fuera de tu organización");
});

test("money, publishing and deleting say amount and payee, visibility and how many", () => {
  assert.equal(impactOf({ tool: "STRIPE_CREATE_PAYMENT", payload: { amount: 49.9, currency: "eur", payee: "Imprenta Sol" } }).headline.replace(/\s/g, " "), "Pagar 49,90 € a Imprenta Sol");
  assert.equal(impactOf({ tool: "LINKEDIN_CREATE_POST", payload: { visibility: "PUBLIC" } }).headline, "Publicar en público");
  assert.equal(impactOf({ tool: "LINKEDIN_CREATE_POST", payload: { visibility: "CONNECTIONS" } }).tone, "private");
  assert.match(impactOf({ tool: "X_CREATE_POST", payload: {} }).headline, /puede ser pública/);
  assert.equal(impactOf({ tool: "GMAIL_DELETE_MESSAGES", payload: { ids: [1, 2, 3] } }).headline, "Borrar 3 elementos");
  assert.equal(impactOf({ tool: "NOTION_SEARCH", payload: { query: "x" } }), null, "reads affect nobody");
});
