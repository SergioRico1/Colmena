// src/lib/useRoomTimeline.js mounted for real (React + linkedom): the merged page of a room with
// people, the page before it by cursor, what a change on this computer and what the people's
// stream do to it, and «escribiendo». The network is a stub: no server, no mailbox.
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
const sources = [];
class FakeEventSource {
  constructor(url) { this.url = url; this.closed = false; sources.push(this); }
  close() { this.closed = true; }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
const calls = [];
let pages = {};
const fetchStub = async (url, init = {}) => {
  calls.push((init.method || "GET") + " " + url);
  if (url === "/api/bootstrap") return { ok: true, status: 200, json: async () => ({ csrf: "t" }) };
  const body = pages[url];
  return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({ error: "No existe esa sala." }) };
};
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Event: window.Event, CustomEvent: window.CustomEvent, EventSource: FakeEventSource, fetch: fetchStub, IS_REACT_ACT_ENVIRONMENT: true });

const { useRoomTimeline } = await import("../src/lib/useRoomTimeline.js");
const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");

const item = (id, min, extra = {}) => ({ id, at: new Date(Date.UTC(2026, 10, 12, 10, min)).toISOString(), engine: "peer", from: "lucia", text: id, ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function mount(roomId, shareId) {
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  const seen = { tl: null, renders: 0 };
  function Probe() { seen.tl = useRoomTimeline(roomId, shareId); seen.renders++; return null; }
  await act(async () => { root.render(h(Probe)); });
  await act(async () => { await wait(20); });
  return { seen, done: async () => { await act(async () => root.unmount()); node.remove(); } };
}

test("a room with people loads its merged page, pages back by cursor and stays live", async () => {
  sources.length = 0; calls.length = 0;
  pages = {
    "/api/rooms/r1/timeline": { items: [item("c", 3), item("d", 4, { engine: "mission", role: "assistant", botId: "vera" })], attached: [item("p", 3.5, { engine: "mission", kind: "progress" })], steps: [{ id: "s2" }], cursor: "CUR1", more: true },
    "/api/rooms/r1/timeline?cursor=CUR1": { items: [item("a", 1), item("b", 2)], attached: [], steps: [{ id: "s1" }], cursor: null, more: false },
  };
  const { seen, done } = await mount("r1", "r1");
  assert.equal(seen.tl.loading, false);
  assert.deepEqual(seen.tl.rows.map((m) => m.id), ["c", "p", "d"], "thread replies and progress lines come among the rows");
  assert.deepEqual(seen.tl.top.map((m) => m.id), ["c", "d"]);
  assert.equal(seen.tl.more, true);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "/api/peers/events?share=r1");

  // The page before: joined in front, each row once; no more after it.
  await act(async () => { await seen.tl.older(); });
  assert.deepEqual(seen.tl.rows.map((m) => m.id), ["a", "b", "c", "p", "d"]);
  assert.deepEqual(seen.tl.steps.map((s) => s.id), ["s1", "s2"]);
  assert.equal(seen.tl.more, false);

  // Someone writes: «escribiendo» shows, and goes when their message arrives; the page reloads.
  await act(async () => { sources[0].emit({ type: "typing", names: ["Lucía Martín"], thinking: ["Vera (de Lucía)"] }); });
  assert.deepEqual([seen.tl.typing, seen.tl.thinking], [["Lucía Martín"], ["Vera (de Lucía)"]]);
  pages["/api/rooms/r1/timeline"] = { ...pages["/api/rooms/r1/timeline"], items: [...pages["/api/rooms/r1/timeline"].items, item("e", 5)] };
  await act(async () => { sources[0].emit({ type: "message", message: { id: "e", from: "lucia", author: { name: "Lucía Martín" } } }); await wait(120); });
  assert.deepEqual(seen.tl.typing, []);
  assert.deepEqual(seen.tl.rows.map((m) => m.id), ["a", "b", "c", "p", "d", "e"], "older pages stay while the latest one is read again");

  // A record changed on this computer (a bot answered): many events, one request.
  const before = calls.filter((c) => c === "GET /api/rooms/r1/timeline").length;
  pages["/api/rooms/r1/timeline"] = { ...pages["/api/rooms/r1/timeline"], items: [...pages["/api/rooms/r1/timeline"].items, item("f", 6, { engine: "mission", role: "assistant", botId: "vera" })] };
  await act(async () => { for (let i = 0; i < 5; i++) window.dispatchEvent(new window.CustomEvent("colmena:changed", { detail: { kinds: ["messages"] } })); await wait(320); });
  assert.equal(calls.filter((c) => c === "GET /api/rooms/r1/timeline").length, before + 1);
  assert.equal(seen.tl.rows.at(-1).id, "f");

  // «Escribiendo» is sent at most once every few seconds.
  await act(async () => { seen.tl.typingNow(); seen.tl.typingNow(); await wait(20); });
  assert.equal(calls.filter((c) => c === "POST /api/peers/shares/r1/typing").length, 1);

  await done();
  assert.equal(sources[0].closed, true, "leaving the room closes the stream");
});

test("a private room asks for nothing, and a room that is gone says so", async () => {
  sources.length = 0; calls.length = 0; pages = {};
  const solo = await mount("m1", null);
  assert.deepEqual([solo.seen.tl.on, solo.seen.tl.loading, solo.seen.tl.rows.length, sources.length, calls.length], [false, false, 0, 0, 0]);
  await solo.done();
  const gone = await mount("nope", "nope");
  assert.equal(gone.seen.tl.error, "missing");
  assert.equal(gone.seen.tl.loading, false);
  await gone.done();
});
