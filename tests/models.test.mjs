import test from "node:test";
import assert from "node:assert/strict";
import { chooseModel, familyModels } from "../server/models.mjs";

const models = [
  { slug: "gpt-5.5-luna" }, { slug: "gpt-6-luna" }, { slug: "gpt-6.1-sol" }, { slug: "gpt-5.6-sol" },
  { slug: "gpt-6-astra" }, { slug: "gpt-6.1-astra" }, { slug: "otro-modelo" },
];

test("each family resolves to its highest version", () => {
  const f = familyModels(models);
  assert.equal(f.luna.slug, "gpt-6-luna");
  assert.equal(f.sol.slug, "gpt-6.1-sol");
  assert.equal(f.astra.slug, "gpt-6.1-astra");
});

test("the bot's role picks the family: Atlas Astra, code Sol, writing Luna", () => {
  assert.equal(chooseModel({ id: "atlas", role: "Coordinador" }, models).slug, "gpt-6.1-astra");
  assert.equal(chooseModel({ id: "bruno", role: "Código" }, models).slug, "gpt-6.1-sol");
  assert.equal(chooseModel({ id: "tomas", role: "Datos y finanzas" }, models).slug, "gpt-6.1-sol");
  assert.equal(chooseModel({ id: "vera", role: "Redacción" }, models).slug, "gpt-6-luna");
  assert.equal(chooseModel({ id: "x", role: "Asistente del día a día" }, models).label, "Luna 6");
});

test("falls back to the nearest family, then to the account default", () => {
  assert.equal(chooseModel({ id: "atlas", role: "Coordinador" }, [{ slug: "gpt-6-sol" }, { slug: "gpt-6-luna" }]).slug, "gpt-6-sol");
  assert.equal(chooseModel({ id: "vera", role: "Redacción" }, [{ slug: "gpt-6-sol" }]).slug, "gpt-6-sol");
  assert.equal(chooseModel({ id: "vera", role: "Redacción" }, [{ slug: "modelo-x" }], "modelo-x").slug, "modelo-x");
});

test("a model chosen for the bot wins while its engine offers it, else Colmena chooses", () => {
  const list = [{ slug: "gpt-6-luna" }, { slug: "gpt-6.1-sol" }, { slug: "gpt-6.1-astra" }, { slug: "o-extra", label: "Extra" }];
  const pinned = chooseModel({ id: "vera", role: "Redacción", modelPin: "gpt-6.1-astra" }, list);
  assert.deepEqual([pinned.slug, pinned.label, pinned.family, pinned.pinned, pinned.reason], ["gpt-6.1-astra", "Astra 6.1", "astra", true, "lo elegiste tú"]);
  // A model without a family keeps its own name.
  assert.equal(chooseModel({ id: "vera", modelPin: "o-extra" }, list).label, "Extra");
  // Gone from the list (another engine, another plan): the role decides again.
  const gone = chooseModel({ id: "vera", role: "Redacción", modelPin: "claude-opus-5-5" }, list);
  assert.equal(gone.slug, "gpt-6-luna");
  assert.ok(!gone.pinned);
});
