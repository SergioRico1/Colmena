import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

// The crash guards (src/lib/boundary.js, behind components/ErrorBoundary.jsx and
// components/RowBoundary.jsx): one row that throws becomes its fallback while its neighbours
// keep working; the whole app falls back to the crash screen; a failed lazy screen is told
// apart so it can offer a reload; and the console hears of each error once.

const { window, document } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });

const { Boundary, errorText, isChunkError, logCaught, logOnce } = await import("../src/lib/boundary.js");
const { act, createElement: h, lazy, Suspense, useState } = await import("react");
const { createRoot } = await import("react-dom/client");

/** Runs `fn` with console.error captured; returns the calls. */
async function quiet(fn) {
  const real = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try { await fn(); } finally { console.error = real; }
  return calls;
}
const mount = () => {
  const node = document.createElement("div");
  document.body.appendChild(node);
  // As in src/main.jsx: React reports what a boundary caught through the same single line.
  const root = createRoot(node, { onCaughtError: logCaught });
  return { node, root, done: async () => { await act(async () => root.unmount()); node.remove(); } };
};

const pill = (label) => () => h("span", { "data-row-failed": "" }, label);
function Message({ m }) {
  if (m.broken) throw Error("no se puede dibujar " + m.id);
  return h("p", { "data-message": m.id }, m.text);
}
const row = (m) => h(Boundary, { key: m.id, label: "No se ha podido mostrar este mensaje", resetKey: m.text, fallback: pill("No se ha podido mostrar este mensaje") }, h(Message, { m }));

test("one message that throws becomes a pill; the rest of the list keeps working", async () => {
  const { node, root, done } = mount();
  let bump;
  function List({ messages }) {
    const [n, setN] = useState(0);
    bump = () => setN((v) => v + 1);
    return h("div", { "data-renders": n }, messages.map(row));
  }
  const messages = [{ id: "m1", text: "Hola" }, { id: "m2", text: "roto", broken: true }, { id: "m3", text: "Adiós" }];
  const calls = await quiet(() => act(async () => root.render(h(List, { messages }))));
  assert.deepEqual([...node.querySelectorAll("[data-message]")].map((p) => p.textContent), ["Hola", "Adiós"]);
  assert.equal(node.querySelectorAll("[data-row-failed]").length, 1);
  assert.equal(node.querySelector("[data-row-failed]").textContent, "No se ha podido mostrar este mensaje");
  // In its place in the list, between its neighbours.
  assert.deepEqual([...node.firstChild.children].map((c) => c.getAttribute("data-message") || "pill"), ["m1", "pill", "m3"]);
  // Logged once, with what failed.
  const ours = calls.filter((c) => String(c[0]).startsWith("[Colmena]"));
  assert.equal(ours.length, 1, "one line in the console");
  assert.match(ours[0][0], /No se ha podido mostrar este mensaje/);
  assert.match(String(ours[0][1]?.message), /no se puede dibujar m2/);

  // The list still works: it repaints, and the pill neither retries nor logs again.
  const again = await quiet(() => act(async () => bump()));
  assert.equal(node.firstChild.getAttribute("data-renders"), "1");
  assert.equal(node.querySelectorAll("[data-row-failed]").length, 1);
  assert.equal(again.filter((c) => String(c[0]).startsWith("[Colmena]")).length, 0);

  // A new message arrives: it shows; the failed one stays a pill.
  await quiet(() => act(async () => root.render(h(List, { messages: [...messages, { id: "m4", text: "Nuevo" }] }))));
  assert.deepEqual([...node.querySelectorAll("[data-message]")].map((p) => p.textContent), ["Hola", "Adiós", "Nuevo"]);

  // What the row shows changed (resetKey): it is tried again and comes back.
  const fixed = messages.map((m) => (m.id === "m2" ? { id: "m2", text: "Ya está" } : m));
  await quiet(() => act(async () => root.render(h(List, { messages: fixed }))));
  assert.equal(node.querySelectorAll("[data-row-failed]").length, 0);
  assert.deepEqual([...node.querySelectorAll("[data-message]")].map((p) => p.textContent), ["Hola", "Ya está", "Adiós"]);
  await done();
});

test("the app-level boundary shows the crash screen with the error and where it broke", async () => {
  const { node, root, done } = mount();
  function Screen() { throw Error("pantalla rota"); }
  const seen = [];
  const crash = (error, componentStack) => { seen.push({ error, componentStack }); return h("div", { role: "alert" }, "Algo ha fallado al mostrar esta pantalla"); };
  const calls = await quiet(() => act(async () => root.render(h(Boundary, { label: "La pantalla ha fallado", keepStack: true, fallback: crash }, h("main", null, h(Screen))))));
  assert.equal(node.querySelector("[role=alert]").textContent, "Algo ha fallado al mostrar esta pantalla");
  assert.equal(node.querySelector("main"), null, "nothing of the broken screen is left");
  assert.equal(seen.at(-1).error.message, "pantalla rota");
  assert.match(seen.at(-1).componentStack, /Screen/, "the component stack reaches the screen for the detail");
  assert.equal(calls.filter((c) => String(c[0]).startsWith("[Colmena]")).length, 1);
  assert.match(errorText(seen.at(-1).error, seen.at(-1).componentStack), /pantalla rota[\s\S]*En:[\s\S]*Screen/);
  await done();
});

test("a screen whose code no longer loads reaches the boundary as a chunk error", async () => {
  const { node, root, done } = mount();
  const failure = new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1/assets/Hoy-abc123.js");
  const Gone = lazy(() => Promise.reject(failure));
  let caught = null;
  const crash = (error) => { caught = error; return h("div", { role: "alert" }, isChunkError(error) ? "Hay que recargar Colmena" : "Algo ha fallado"); };
  await quiet(async () => {
    await act(async () => root.render(h(Boundary, { fallback: crash }, h(Suspense, { fallback: null }, h(Gone)))));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  });
  assert.equal(caught, failure);
  assert.equal(node.querySelector("[role=alert]").textContent, "Hay que recargar Colmena");
  await done();
});

test("chunk errors are told apart from ordinary ones", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: http://localhost/assets/Hoy-1.js", // Chromium
    "error loading dynamically imported module: http://localhost/assets/Hoy-1.js", // Firefox
    "Importing a module script failed.", // WebKit
    "Loading chunk 12 failed.",
    "Loading CSS chunk 3 failed.",
    "Unable to preload CSS for /assets/Hoy-1.css",
  ]) assert.equal(isChunkError(Error(message)), true, message);
  assert.equal(isChunkError(Object.assign(Error("x"), { name: "ChunkLoadError" })), true);
  for (const error of [Error("Cannot read properties of undefined (reading 'map')"), TypeError("x is not a function"), null, undefined, "texto"]) assert.equal(isChunkError(error), false);
});

test("the detail to copy: the error, where it broke, and never endless", () => {
  const error = Error("falló");
  assert.match(errorText(error), /falló/);
  assert.match(errorText(error, "\n    at Hoy\n    at App"), /En:\n {0,4}at Hoy/);
  assert.equal(errorText(null), "Error desconocido");
  assert.equal(errorText("solo texto"), "solo texto");
  assert.equal(errorText({ message: "x".repeat(20000) }).length, 8000);
});

test("an error is written to the console once, whoever sees it first", async () => {
  const error = Error("una vez");
  const calls = await quiet(() => {
    assert.equal(logOnce(error, "Primero"), true);
    assert.equal(logOnce(error, "Segundo"), false);
    logCaught(error, { componentStack: "at X" });
    assert.equal(logOnce(Error("otro")), true);
    // React's report of an error no boundary of ours wrote down still reaches the console.
    logCaught(Error("sin frontera"), { componentStack: "at Y" });
    return new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(calls.length, 3);
  assert.match(String(calls[2][1]?.message), /sin frontera/);
  assert.match(calls[0][0], /\[Colmena\] Primero/);
  assert.equal(calls[0][1], error);
});
