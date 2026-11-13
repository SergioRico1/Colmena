import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

// The live region of a conversation, mounted with React in a linkedom document: what
// useAnnouncer + <Announcer> put in the one polite region as messages arrive.

const { window, document } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });

const { useAnnouncer } = await import("../src/lib/useAnnouncer.js");
const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");

// A stand-in for components/Announcer.jsx (JSX is not loaded by node): same attributes.
function Screen({ scope, ready = true, items, waiting }) {
  const said = useAnnouncer({ scope, ready, items, waiting });
  return h("p", { role: "status", "aria-live": "polite", "aria-atomic": "true", "data-announcer": "" }, said);
}
const NONE = [];
const said = () => document.querySelector("[data-announcer]").textContent;

async function mount(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (p) => act(async () => { root.render(h(Screen, p)); });
  await render(props);
  return { render, unmount: () => act(async () => { root.unmount(); host.remove(); }) };
}
const tick = (ms) => act(async () => { mock.timers.tick(ms); });

test("a conversation has one polite region, empty until something arrives", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const view = await mount({ scope: "m1", items: [{ id: "1", name: "Nora", text: "ya estaba" }], waiting: [{ id: "ap-old", name: "Vera" }] });
  const regions = document.querySelectorAll("[aria-live='polite']");
  assert.equal(regions.length, 1);
  assert.equal(regions[0].getAttribute("role"), "status");
  await tick(5000);
  assert.equal(said(), "", "what was there on opening is never read out");
  await view.unmount();
  mock.timers.reset();
});

test("a finished message is said once, with its author; yours is not", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const first = [{ id: "1", name: "Nora", text: "antes" }];
  const view = await mount({ scope: "m1", items: first, waiting: NONE });
  const mine = [...first, { id: "2", name: "Tú", text: "hola", skip: true }];
  await view.render({ scope: "m1", items: mine, waiting: NONE });
  await tick(2000);
  assert.equal(said(), "", "the person's own message says nothing");
  const answered = [...mine, { id: "3", name: "Nora", text: "**Comparativa** lista." }];
  await view.render({ scope: "m1", items: answered, waiting: NONE });
  assert.equal(said(), "", "not before the moment passes");
  await tick(1200);
  assert.equal(said(), "Nora: Comparativa lista.");
  // The same rows again (a refresh) say nothing new, and the line is emptied afterwards.
  await view.render({ scope: "m1", items: [...answered], waiting: NONE });
  await tick(5000);
  assert.equal(said(), "");
  await view.unmount();
  mock.timers.reset();
});

test("text being written is never said token by token: once, when it ends", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const view = await mount({ scope: "m1", items: NONE, waiting: NONE });
  for (const text of ["Com", "Compara", "Comparativa lis"]) {
    await view.render({ scope: "m1", items: [{ id: "9", name: "Nora", text, done: false }], waiting: NONE });
    await tick(1500);
    assert.equal(said(), "", text);
  }
  await view.render({ scope: "m1", items: [{ id: "9", name: "Nora", text: "Comparativa lista.", done: true }], waiting: NONE });
  await tick(1200);
  assert.equal(said(), "Nora: Comparativa lista.");
  await view.unmount();
  mock.timers.reset();
});

test("several arrivals in the same moment are one count", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const view = await mount({ scope: "m1", items: NONE, waiting: NONE });
  const a = [{ id: "1", name: "Nora", text: "uno" }];
  const b = [...a, { id: "2", name: "Vera", text: "dos" }];
  const c = [...b, { id: "3", name: "Nora", text: "tres" }];
  await view.render({ scope: "m1", items: a, waiting: NONE });
  await tick(400);
  await view.render({ scope: "m1", items: b, waiting: NONE });
  await tick(400);
  await view.render({ scope: "m1", items: c, waiting: NONE });
  assert.equal(said(), "");
  await tick(1200);
  assert.equal(said(), "3 mensajes nuevos de Nora y Vera");
  await view.unmount();
  mock.timers.reset();
});

test("something that starts waiting is said by name, once", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const view = await mount({ scope: "m1", items: NONE, waiting: NONE });
  const waits = [{ id: "ap-1", name: "Vera", kind: "send" }];
  await view.render({ scope: "m1", items: NONE, waiting: waits });
  await tick(1200);
  assert.equal(said(), "Vera espera tu OK");
  await tick(5000);
  await view.render({ scope: "m1", items: NONE, waiting: [...waits] });
  await tick(2000);
  assert.equal(said(), "", "still waiting is not said again");
  await view.unmount();
  mock.timers.reset();
});

test("opening another conversation starts again without reading it out", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const view = await mount({ scope: "m1", items: [{ id: "1", name: "Nora", text: "a" }], waiting: NONE });
  await view.render({ scope: "m2", items: [{ id: "7", name: "Vera", text: "otra sala" }, { id: "8", name: "Vera", text: "más" }], waiting: [{ id: "ap-2", name: "Vera" }] });
  await tick(3000);
  assert.equal(said(), "");
  // Not ready (still loading): nothing is marked, nothing is said.
  await view.render({ scope: "m3", ready: false, items: NONE, waiting: NONE });
  await view.render({ scope: "m3", ready: true, items: [{ id: "20", name: "Iris", text: "cargado" }], waiting: NONE });
  await tick(3000);
  assert.equal(said(), "");
  await view.unmount();
  mock.timers.reset();
});
