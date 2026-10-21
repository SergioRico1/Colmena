import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";
import { createApp } from "../server/app.mjs";
import { sheetPrompt } from "../server/portraits.mjs";

/** A real (blank) PNG of w×h. */
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function serve(t, store, runtime) {
  const session = { status: () => null, models: [], listModels: async () => [], start: async () => ({}), closePending() {}, logout: async () => ({}) };
  let base;
  const app = createApp({ store, runtime, session, scheduler: null, connections: null, getOrigin: () => base });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  base = "http://127.0.0.1:" + server.address().port;
  const token = (await (await fetch(base + "/api/bootstrap")).json()).csrf;
  return async (method, url, body) => {
    const r = await fetch(base + "/api" + url, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": token }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const type = r.headers.get("content-type") || "";
    return { status: r.status, body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}

test("portraits: one 2×2 sheet, you pick, the square crop is kept; no letters asked for", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  let prompts = [];
  runtime.provider.generateImage = async ({ prompt, size }) => { prompts.push(prompt); assert.equal(size, "1024x1024"); return { png: png(64, 64) }; };
  const call = await serve(t, store, runtime);
  const nora = store.get("bots", "nora");
  assert.match(sheetPrompt(nora), /2×2/);
  assert.match(sheetPrompt(nora), /sin letras/);

  const sheet = await call("POST", "/bots/nora/portrait/sheet", {});
  assert.equal(sheet.status, 200);
  assert.equal(prompts.length, 1, "a single image request");
  const file = await call("GET", "/bots/nora/portrait/sheet");
  assert.equal(file.status, 200);
  assert.equal(file.body.subarray(1, 4).toString(), "PNG");

  const wide = await call("PUT", "/bots/nora/portrait", { image: png(200, 100).toString("base64") });
  assert.equal(wide.status, 400, "not square");
  const saved = await call("PUT", "/bots/nora/portrait", { image: png(128, 128).toString("base64") });
  assert.equal(saved.status, 200);
  assert.match(store.get("bots", "nora").portrait, /^\/api\/bots\/nora\/portrait\?v=\d+$/);
  assert.equal((await call("GET", "/bots/nora/portrait")).status, 200);
  assert.equal((await call("GET", "/bots/nora/portrait/sheet")).status, 404, "the sheet is dropped once chosen");

  const removed = await call("DELETE", "/bots/nora/portrait", {});
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(store.get("bots", "nora").portrait, null);
});

test("portraits: without images on the account, a clear answer and nothing changes", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  const call = await serve(t, store, runtime);
  const r = await call("POST", "/bots/nora/portrait/sheet", {});
  assert.equal(r.status, 501);
  assert.match(r.body.error, /ChatGPT/);
});
