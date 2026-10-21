import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { assertPublicUrl } from "../server/computer/tools.mjs";

const require = createRequire(import.meta.url);
const { urlProblem, makeResolver, isBlockedAddress } = require("../desktop/netguard.cjs");

const PRIVATE = [
  "http://127.0.0.1/", "http://127.8.9.1:8080/x", "http://10.0.0.1/", "http://172.16.5.4/", "http://192.168.1.1/admin",
  "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/", "http://0.0.0.0/",
  "http://localhost/", "http://LOCALHOST:3000/", "http://router.local/", "http://nas.lan/", "http://intranet/",
];

test("the desktop browser refuses private, loopback and non-web addresses", () => {
  for (const url of PRIVATE) assert.ok(urlProblem(url), url);
  for (const url of ["file:///C:/Windows/win.ini", "chrome://settings", "javascript:alert(1)", "ftp://x.org/", "data:text/html,hola", "https://user:pw@example.com/"])
    assert.ok(urlProblem(url), url);
  assert.equal(urlProblem("https://example.com/a?b=1"), null);
  assert.equal(urlProblem("about:blank"), null);
  // Inside a public page: images as data:, websockets to public hosts.
  assert.equal(urlProblem("data:image/png;base64,AAAA", { subresource: true }), null);
  assert.equal(urlProblem("wss://example.com/socket", { subresource: true }), null);
  assert.ok(urlProblem("ws://127.0.0.1:9222/devtools", { subresource: true }));
  assert.ok(urlProblem("wss://example.com/socket"), "top-level websocket");
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("::ffff:10.0.0.1"), true);
});

test("DNS rebinding: names resolving to private addresses are refused; failures fail closed", async () => {
  const fake = { "evil.example": ["10.0.0.7"], "ok.example": ["93.184.216.34"], "mixed.example": ["93.184.216.34", "127.0.0.1"] };
  const check = makeResolver({
    lookup: async (host) => {
      if (!fake[host]) throw Error("ENOTFOUND");
      return fake[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
  });
  assert.ok(await check("evil.example"));
  assert.ok(await check("mixed.example"));
  assert.equal(await check("ok.example"), null);
  assert.ok(await check("missing.example"));
});

test("server-side check before asking Electron to open a page", async () => {
  const resolve = async (host) => (host === "intra.example.com" ? [{ address: "192.168.0.20", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
  for (const url of [...PRIVATE, "file:///C:/x", "https://intra.example.com/"])
    await assert.rejects(() => assertPublicUrl(url, { resolve }), /no permitida|Solo se pueden|no válida|No se encontró/, url);
  assert.equal((await assertPublicUrl("https://www.boe.es/buscar", { resolve })).hostname, "www.boe.es");
});
