import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildSnapshot, detectBlocker } = require("../desktop/axsnapshot.cjs");

// Minimal CDP Accessibility.getFullAXTree shape.
let next = 1;
const node = (role, name, extra = {}) => ({ nodeId: String(next++), ignored: false, role: { type: "role", value: role }, name: { type: "computedString", value: name }, childIds: [], backendDOMNodeId: next * 10, ...extra });
function tree() {
  next = 1;
  const root = node("RootWebArea", "Tienda");
  const h = node("heading", "Tu pedido", { properties: [{ name: "level", value: { type: "integer", value: 1 } }] });
  const hText = node("StaticText", "Tu pedido");
  h.childIds = [hText.nodeId];
  const p = node("StaticText", "Revisa los datos antes de pagar.");
  const name = node("textbox", "Nombre", { value: { type: "string", value: "Ana" }, properties: [{ name: "required", value: { type: "boolean", value: true } }] });
  const pass = node("textbox", "Contraseña", { value: { type: "string", value: "secreto123" } });
  const check = node("checkbox", "Acepto las condiciones", { properties: [{ name: "checked", value: { type: "tristate", value: "false" } }] });
  const button = node("button", "Comprar ahora");
  const btnText = node("StaticText", "Comprar ahora");
  button.childIds = [btnText.nodeId];
  const hidden = node("button", "Oculto", { ignored: true });
  root.childIds = [h, p, name, pass, check, button, hidden].map((n) => n.nodeId);
  const nodes = [root, h, hText, p, name, pass, check, button, btnText, hidden];
  for (const n of nodes) for (const c of n.childIds) nodes.find((x) => x.nodeId === c).parentId = n.nodeId;
  return { nodes, pass };
}

test("snapshot lists interactive elements with refs, states and values", () => {
  const { nodes, pass } = tree();
  const dom = new Map([[pass.backendDOMNodeId, { password: true }]]);
  const snap = buildSnapshot(nodes, { mode: "elementos", dom });
  assert.equal(snap.count, 4);
  assert.match(snap.text, /# Tu pedido/);
  assert.match(snap.text, /- campo "Nombre" = "Ana" \[e1\] \(obligatorio\)/);
  assert.match(snap.text, /- casilla "Acepto las condiciones" \[e3\] \(sin marcar\)/);
  assert.match(snap.text, /- botón "Comprar ahora" \[e4\]/);
  assert.doesNotMatch(snap.text, /Oculto/);
  assert.doesNotMatch(snap.text, /Revisa los datos/, "elementos mode omits prose");
  assert.equal(snap.refs.get("e4").backendNodeId, nodes.find((n) => n.name.value === "Comprar ahora" && n.role.value === "button").backendDOMNodeId);
});

test("password fields never show their value and raise a blocker", () => {
  const { nodes, pass } = tree();
  const snap = buildSnapshot(nodes, { mode: "texto", dom: new Map([[pass.backendDOMNodeId, { password: true }]]) });
  assert.doesNotMatch(snap.text, /secreto123/);
  assert.match(snap.text, /campo "Contraseña" \[e2\] \(contraseña: no la escribas/);
  assert.equal(snap.flags.password, true);
  assert.equal(detectBlocker({ text: snap.text, flags: snap.flags }).tipo, "contraseña");
});

test("texto mode adds prose without repeating headings or button labels", () => {
  const { nodes } = tree();
  const snap = buildSnapshot(nodes, { mode: "texto" });
  assert.match(snap.text, /Revisa los datos antes de pagar\./);
  assert.equal(snap.text.match(/Tu pedido/g).length, 1);
  assert.equal(snap.text.match(/Comprar ahora/g).length, 1);
});

test("query keeps matching lines (accent-insensitive) and their refs", () => {
  const { nodes } = tree();
  const snap = buildSnapshot(nodes, { mode: "elementos", query: "contrasena" });
  assert.equal(snap.matches, 1);
  assert.match(snap.text, /\[e2\]/);
  assert.doesNotMatch(snap.text, /Comprar/);
});

test("long pages are cut at maxChars with a hint", () => {
  next = 1;
  const root = node("RootWebArea", "");
  const links = Array.from({ length: 400 }, (_, i) => node("link", "Enlace número " + i + " con un texto bastante largo"));
  root.childIds = links.map((l) => l.nodeId);
  links.forEach((l) => (l.parentId = root.nodeId));
  const snap = buildSnapshot([root, ...links], { maxChars: 2000 });
  assert.ok(snap.text.length < 2100);
  assert.equal(snap.truncated, true);
  assert.match(snap.text, /usa query/);
});

test("captcha and 2FA are detected so the bot asks for a takeover", () => {
  assert.equal(detectBlocker({ frameUrls: ["https://www.google.com/recaptcha/api2/anchor?k=x"] }).tipo, "captcha");
  assert.equal(detectBlocker({ text: "Confirma que eres humano" }).tipo, "captcha");
  assert.equal(detectBlocker({ text: "Introduce el código de verificación que te hemos enviado" }).tipo, "2fa");
  assert.equal(detectBlocker({ flags: { oneTimeCode: true } }).tipo, "2fa");
  assert.match(detectBlocker({ text: "I'm not a robot" }).mensaje, /Tomar el control/);
  assert.equal(detectBlocker({ text: "Noticias del día" }), null);
});
