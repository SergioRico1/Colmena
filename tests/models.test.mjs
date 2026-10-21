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
