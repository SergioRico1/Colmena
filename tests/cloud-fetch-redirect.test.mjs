// The Workers runtime refuses `redirect: "error"`; cloud/src/fetch-redirect.js turns it into
// "manual" plus a refusal of any redirect, as Node does.
import test from "node:test";
import assert from "node:assert/strict";

const before = globalThis.fetch;
const { refuseRedirects } = await import("../cloud/src/fetch-redirect.js");
globalThis.fetch = before; // the module patches the global on import; tests use the factory

test("redirect «error» reaches the runtime as «manual» and a redirect is refused", async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push(init?.redirect);
    return url.endsWith("/r") ? new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } }) : new Response("ok");
  };
  const f = refuseRedirects(fake);
  assert.equal(await (await f("https://api.example/ok", { redirect: "error", method: "POST", body: "x" })).text(), "ok");
  await assert.rejects(() => f("https://api.example/r", { redirect: "error" }), /redirect refused/);
  assert.equal((await f("https://api.example/r")).status, 302); // other modes untouched
  assert.deepEqual(seen, ["manual", "manual", undefined]);
});
