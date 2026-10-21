import test from "node:test";
import assert from "node:assert/strict";
import { ResponseSockets, SocketUnavailable, continuationBody, HTTP_URL } from "../server/provider-ws.mjs";
import { responseCollector } from "../server/provider.mjs";

const errors = { name: "OpenAI" };
const completed = (id, text) => [
  { type: "response.created", response: { id } },
  { type: "response.output_text.delta", delta: text, response_id: id },
  { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-" + id, content: [{ type: "output_text", text }] } },
  { type: "response.completed", response: { id, status: "completed", output: [{ type: "message", id: "msg-" + id, content: [{ type: "output_text", text }] }], usage: { total_tokens: 3 } } },
];

/** A WebSocket double: opens (or refuses), records what is sent, answers with `script`. */
function fakeSockets({ refuse = false, script }) {
  const sent = [], opened = [];
  class FakeSocket {
    constructor(url, options) {
      opened.push({ url, headers: options?.headers });
      this.readyState = 0;
      this.listeners = {};
      setTimeout(() => {
        if (refuse) return this.fire("error", { message: "403" });
        this.readyState = 1;
        this.fire("open", {});
      }, 0);
    }
    addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
    removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
    fire(type, event) { for (const fn of [...(this.listeners[type] || [])]) fn(event); }
    send(data) {
      const body = JSON.parse(data);
      sent.push(body);
      setTimeout(() => { for (const e of script(body, sent.length)) this.fire("message", { data: JSON.stringify(e) }); }, 0);
    }
    close() { this.readyState = 3; this.fire("close", {}); }
  }
  return { sockets: new ResponseSockets({ WebSocketImpl: FakeSocket }), sent, opened };
}

test("continuation: only the new items travel with previous_response_id; any earlier change sends everything", () => {
  const body = { model: "m", instructions: "x", input: [{ role: "user", content: "a" }], stream: true, store: false };
  const cont = { context: JSON.stringify({ model: "m", instructions: "x", store: false }), input: body.input, output: [{ type: "message", id: "o1" }], responseId: "r1" };
  const next = { ...body, input: [...body.input, { type: "message", id: "o1" }, { type: "function_call_output", call_id: "c", output: "{}" }] };
  const { request, continued } = continuationBody(next, cont);
  assert.equal(continued, true);
  assert.equal(request.previous_response_id, "r1");
  assert.deepEqual(request.input, [{ type: "function_call_output", call_id: "c", output: "{}" }]);
  assert.equal("stream" in request, false);
  assert.equal(continuationBody({ ...next, instructions: "otra" }, cont).continued, false, "other instructions");
  assert.equal(continuationBody({ ...next, input: [{ role: "user", content: "b" }, ...next.input.slice(1)] }, cont).continued, false, "an earlier item changed");
});

test("warm socket: the second round reuses the connection and sends only what is new", async () => {
  const { sockets, sent, opened } = fakeSockets({ script: (body, n) => completed("r" + n, "hola " + n) });
  const run = (input) => sockets.run({ key: "k", headers: { Authorization: "Bearer t" }, body: { model: "m", input, stream: true, store: false }, collector: () => responseCollector({ errors }) });
  const first = await run([{ role: "user", content: "a" }]);
  assert.equal(first.transport, "ws");
  assert.equal(first.text, "hola 1");
  const second = await run([{ role: "user", content: "a" }, ...first.output, { role: "user", content: "b" }]);
  assert.equal(second.transport, "ws-continued");
  assert.equal(opened.length, 1, "one connection");
  assert.equal(sent[1].previous_response_id, "r1");
  assert.deepEqual(sent[1].input, [{ role: "user", content: "b" }]);
  assert.equal(sent[0].type, "response.create");
  assert.equal(opened[0].url, "wss://api.openai.com/v1/responses");
  assert.equal(opened[0].headers.Authorization, "Bearer t");
  sockets.closeAll();
});

test("a forgotten previous response is sent again in full, once", async () => {
  const { sockets, sent } = fakeSockets({
    script: (body, n) => (body.previous_response_id ? [{ type: "error", error: { code: "previous_response_not_found" } }] : completed("r" + n, "ok")),
  });
  const run = (input) => sockets.run({ key: "k", headers: {}, body: { model: "m", input }, collector: () => responseCollector({ errors }) });
  const first = await run([{ role: "user", content: "a" }]);
  const again = await run([{ role: "user", content: "a" }, ...first.output, { role: "user", content: "b" }]);
  assert.equal(again.transport, "ws");
  assert.equal(sent.length, 3);
  assert.equal(sent[2].previous_response_id, undefined);
  assert.equal(sent[2].input.length, 3);
  sockets.closeAll();
});

test("a refused handshake or a refusal before any event hands over to SSE", async () => {
  const refused = fakeSockets({ refuse: true, script: () => [] });
  await assert.rejects(refused.sockets.run({ key: "k", headers: {}, body: { model: "m", input: [] }, collector: () => responseCollector({ errors }) }), SocketUnavailable);
  assert.equal(refused.opened.length, 2, "both header variants tried");
  assert.equal(refused.sockets.supports(HTTP_URL, "k"), false, "paused for a while");
  const rejecting = fakeSockets({ script: () => [{ type: "error", error: { code: "invalid_request_error" } }] });
  await assert.rejects(rejecting.sockets.run({ key: "k", headers: {}, body: { model: "m", input: [] }, collector: () => responseCollector({ errors }) }), SocketUnavailable);
  assert.equal(rejecting.sockets.supports("http://127.0.0.1:11434/v1/responses", "k"), false, "only the official endpoint");
});

test("a busy socket is never shared", async () => {
  let hold;
  const { sockets } = fakeSockets({ script: (b, n) => (n === 1 ? (hold = completed("r1", "x"), []) : completed("r" + n, "y")) });
  const first = sockets.run({ key: "k", headers: {}, body: { model: "m", input: [] }, collector: () => responseCollector({ errors }) });
  for (let i = 0; i < 50 && !hold; i++) await new Promise((r) => setTimeout(r, 2));
  await assert.rejects(sockets.run({ key: "k", headers: {}, body: { model: "m", input: [] }, collector: () => responseCollector({ errors }) }), SocketUnavailable);
  const entry = sockets.entries.get("k");
  for (const e of hold) entry.socket.fire("message", { data: JSON.stringify(e) });
  assert.equal((await first).text, "x");
  sockets.closeAll();
});
