// Phase 4 (docs/CLOUD.md › Browser): the bots' browser in the cloud. A fake Chromium page answers
// the Chrome DevTools Protocol the way Browser Rendering's does, so the real browser module
// (server/cloud/browser-cloud.mjs) and the real computer tools (server/computer/tools.mjs) run:
// references from the accessibility tree, filling a form, a submit that waits for the person,
// frames for the live view, «tomar el control», cookie jars sealed in the vault, and saved
// passwords never in a turn for another person or incognito.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cloudBrowser } from "../server/cloud/browser-cloud.mjs";
import { WorkspaceKeyring, envelopeVault } from "../server/envelope-vault.mjs";
import { planComputerCall, executeComputerTool } from "../server/computer/tools.mjs";
import { passwordsAllowed, browserSessionOf } from "../server/computer/wire.mjs";

const PUBLIC = async () => [{ address: "93.184.216.34" }];
const FORM_URL = "https://app.example.com/prueba/formulario";

/** A fake Chromium page: one form (Nombre, Correo, Enviar) and its accessibility tree. */
function fakeChromium() {
  const pages = [];
  const state = { jarSets: [] };
  const driver = {
    async open() {
      const listeners = new Map();
      const values = { 11: "", 12: "" };
      const page = { url: "about:blank", title: "", jar: [], focused: null, sent: null, closed: false };
      pages.push(page);
      const emit = (event, params) => (listeners.get(event) || []).forEach((fn) => fn(params));
      const nodes = () => page.url === FORM_URL ? [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Formulario de prueba" }, childIds: ["2", "3", "4", "5"] },
        { nodeId: "2", parentId: "1", role: { value: "heading" }, name: { value: "Formulario de prueba" }, properties: [{ name: "level", value: { value: 1 } }] },
        { nodeId: "3", parentId: "1", role: { value: "textbox" }, name: { value: "Nombre" }, backendDOMNodeId: 11, value: { value: values[11] } },
        { nodeId: "4", parentId: "1", role: { value: "textbox" }, name: { value: "Correo" }, backendDOMNodeId: 12, value: { value: values[12] } },
        { nodeId: "5", parentId: "1", role: { value: "button" }, name: { value: "Enviar" }, backendDOMNodeId: 13 },
      ] : [{ nodeId: "1", role: { value: "RootWebArea" }, name: { value: page.title }, childIds: ["2"] }, { nodeId: "2", parentId: "1", role: { value: "StaticText" }, name: { value: page.sent ? "Recibido: " + page.sent : "El código secreto es COLMENA-4242" } }];
      const info = (id) => id === 13
        ? { tag: "BUTTON", type: "submit", inForm: true, isSearch: false, submitButton: true, payment: false, text: "Enviar", password: false, oneTimeCode: false, paymentField: false, checked: false, select: false, editable: false, action: FORM_URL, href: "" }
        : { tag: "INPUT", type: id === 12 ? "email" : "text", inForm: true, isSearch: false, submitButton: false, payment: false, text: "", password: false, oneTimeCode: false, paymentField: false, checked: false, select: false, editable: true, action: FORM_URL, href: "" };
      const send = async (method, p = {}) => {
        switch (method) {
          case "Network.setCookies": page.jar = p.cookies; state.jarSets.push(p.cookies); return {};
          case "Network.getAllCookies": return { cookies: page.jar };
          case "Page.navigate":
            page.url = p.url;
            page.title = p.url === FORM_URL ? "Formulario de prueba" : "Página de prueba";
            if (p.url.includes("example.com")) page.jar = [...page.jar.filter((c) => c.name !== "visto"), { name: "visto", value: "galleta-secreta-123", domain: "app.example.com", path: "/", expires: Date.now() / 1000 + 3600 }];
            emit("Page.frameNavigated", { frame: { id: "f1", url: p.url } });
            return { frameId: "f1" };
          case "Runtime.evaluate":
            if (p.expression === "document.readyState") return { result: { value: "complete" } };
            if (p.expression === "[location.href, document.title]") return { result: { value: [page.url, page.title] } };
            return { result: { value: info(page.focused || 11) } };
          case "Accessibility.getFullAXTree": return { nodes: nodes() };
          case "DOM.describeNode": return { node: { attributes: ["type", p.backendNodeId === 12 ? "email" : "text", "name", "n" + p.backendNodeId] } };
          case "Page.getFrameTree": return { frameTree: { frame: { id: "f1", url: page.url } } };
          case "Page.createIsolatedWorld": return { executionContextId: 7 };
          case "DOM.resolveNode": return { object: { objectId: "o" + p.backendNodeId } };
          case "Runtime.callFunctionOn": {
            const id = Number(String(p.objectId).slice(1));
            if (p.functionDeclaration.includes("fields: out")) return { result: { value: { fields: [{ label: "Nombre", value: values[11] }, { label: "Correo", value: values[12] }], action: FORM_URL, method: "post" } } };
            if (p.functionDeclaration.includes("this.focus()")) { page.focused = id; return { result: { value: true } }; }
            return { result: { value: info(id) } };
          }
          case "DOM.focus": page.focused = p.backendNodeId; return {};
          case "Input.insertText": if (page.focused && page.focused in values) values[page.focused] = p.text; return {};
          case "DOM.getContentQuads": return { quads: [[100, 500, 200, 500, 200, 540, 100, 540]] };
          case "Input.dispatchMouseEvent":
            if (p.type === "mouseReleased" && p.y >= 500 && page.url === FORM_URL) { page.sent = [values[11], values[12]].join(" / "); page.url = FORM_URL + "?enviado"; page.title = "Recibido"; emit("Page.frameNavigated", { frame: { id: "f1", url: page.url } }); }
            return {};
          case "Page.captureScreenshot": return { data: Buffer.from("jpeg " + page.url).toString("base64") };
          default: return {};
        }
      };
      return { send, on: (event, fn) => listeners.set(event, [...(listeners.get(event) || []), fn]), close: async () => { page.closed = true; } };
    },
    async close() {},
  };
  return { driver, pages, state };
}

function vaultPair() {
  const records = new Map();
  const keyring = new WorkspaceKeyring({ workspace: "ws-test", masters: [{ kid: "m1", secret: randomBytes(32).toString("hex") }], load: () => records.get("key") || null, save: (r) => records.set("key", r) });
  const store = { get: (id) => records.get(id) || null, put: (r) => records.set(r.id, r), remove: (id) => records.delete(id) };
  return { records, vault: (namespace) => envelopeVault({ keyring, records: store, namespace }) };
}

const ctxFor = (browser, extra = {}) => ({ missionId: "m1", botId: "nora", bot: { id: "nora", name: "Nora" }, computer: browser, resolve: PUBLIC, settings: {}, ...extra });

test("browser: open, read with references, fill, and a submit that waits for the person", async () => {
  const { driver, pages } = fakeChromium();
  const browser = cloudBrowser({ driver });
  const frames = [];
  browser.onFrame((f) => frames.push(f));
  const ctx = ctxFor(browser);
  // Only public pages: a private address is refused before any browser opens.
  await assert.rejects(executeComputerTool("browser_open", { url: "http://10.0.0.1/" }, { ...ctx, resolve: async () => [{ address: "10.0.0.1" }] }), /públicas/);
  const read = await executeComputerTool("browser_open", { url: "https://app.example.com/prueba/pagina" }, ctx);
  assert.equal(read.url, "https://app.example.com/prueba/pagina");
  const text = await executeComputerTool("browser_read", { mode: "texto", query: "" }, ctx);
  assert.match(text.page, /COLMENA-4242/);
  const open = await executeComputerTool("browser_open", { url: FORM_URL }, ctx);
  assert.match(open.page, /campo "Nombre" \[e1\]/);
  assert.match(open.page, /botón "Enviar" \[e3\]/);
  const fillPlan = await planComputerCall("browser_fill", { fields: [{ ref: "e1", value: "Ana Prueba" }, { ref: "e2", value: "ana@example.com" }] }, ctx);
  assert.equal(fillPlan.policy, "free");
  await executeComputerTool("browser_fill", { fields: [{ ref: "e1", value: "Ana Prueba" }, { ref: "e2", value: "ana@example.com" }] }, ctx);
  // A click on «Enviar» becomes a submit: a red line with the fields for the person to see.
  const plan = await planComputerCall("browser_act", { kind: "click", ref: "e3", text: "" }, ctx);
  assert.equal(plan.name, "browser_submit");
  assert.equal(plan.policy, "redline");
  assert.deepEqual(plan.approval.computer.fields, [{ label: "Nombre", value: "Ana Prueba" }, { label: "Correo", value: "ana@example.com" }]);
  await assert.rejects(executeComputerTool("browser_submit", plan.args, ctx), /aprobación/);
  await assert.rejects(executeComputerTool("browser_act", { kind: "click", ref: "e3", text: "" }, ctx), /browser_submit/);
  const sent = await executeComputerTool("browser_submit", plan.args, { ...ctx, approved: true, approval: { computer: plan.approval.computer } });
  assert.equal(sent.navigated, true);
  assert.match(sent.url, /enviado/);
  assert.match((await executeComputerTool("browser_read", { mode: "texto", query: "" }, ctx)).page, /Recibido: Ana Prueba \/ ana@example.com/);
  assert.equal(pages.length, 1);
  // The live view got frames (throttled to one a second per mission).
  assert.ok(frames.length >= 1);
  assert.equal(frames[0].type, "browser_frame");
  assert.match(frames[0].image, /^data:image\/jpeg;base64,/);
  assert.ok(browser.lastFrame("m1"));
});

test("browser: the cookie jar of a named session is sealed in the vault and comes back; a turn's own jar never does", async () => {
  const { vault, records } = vaultPair();
  const one = fakeChromium();
  const browser = cloudBrowser({ driver: one.driver, vault });
  await browser.call("open", { missionId: "m1", botId: "nora", url: "https://app.example.com/prueba/pagina" });
  await browser.call("close", { missionId: "m1", botId: "nora" });
  const sealed = [...records.values()].find((r) => r.namespace === "browser-jars");
  assert.ok(sealed, "the jar is in the vault");
  assert.equal(JSON.stringify(sealed).includes("galleta-secreta-123"), false, "never in the clear");
  // A fresh browser (another object, a day later) gets the jar back into its page.
  const two = fakeChromium();
  const again = cloudBrowser({ driver: two.driver, vault });
  await again.call("open", { missionId: "m2", botId: "nora", url: "https://app.example.com/otra" });
  assert.ok(two.state.jarSets.some((jar) => jar.some((c) => c.value === "galleta-secreta-123")));
  // A turn for another person: an empty jar, never loaded, never saved.
  const three = fakeChromium();
  const guest = cloudBrowser({ driver: three.driver, vault });
  const before = JSON.stringify([...records.values()]);
  await guest.call("open", { missionId: "m3", botId: "nora", session: "req-step1", url: "https://app.example.com/prueba/pagina" });
  await guest.call("close", { missionId: "m3", botId: "nora", session: "req-step1" });
  assert.equal(three.state.jarSets.length, 0);
  assert.equal(JSON.stringify([...records.values()]), before);
  // Named sessions keep jars apart.
  await again.call("open", { missionId: "m4", botId: "nora", profile: "ventas", url: "https://app.example.com/prueba/pagina" });
  await again.call("close", { missionId: "m4", botId: "nora", profile: "ventas" });
  assert.ok([...records.keys()].some((k) => k === "browser-jars:ventas"));
});

test("browser: saved passwords only for your own turns, never for another person or incognito", async () => {
  const { driver } = fakeChromium();
  const browser = cloudBrowser({ driver });
  assert.equal(passwordsAllowed({ incognito: true }), false);
  assert.equal(passwordsAllowed({ peerErrand: true }, { id: "s1" }), false);
  assert.equal(passwordsAllowed({}), true);
  assert.equal(browserSessionOf({ peerErrand: true }, { id: "s1" }), "req-s1");
  const vaultBook = { has: () => true, entry: () => ({ domain: "app.example.com", username: "ana" }), secret: async () => ({ domain: "app.example.com", username: "ana", password: "x" }), used() {} };
  await assert.rejects(planComputerCall("browser_sign_in", { entry: "v1" }, ctxFor(browser, { vault: vaultBook, noPasswords: true })), /no se usan las contraseñas/);
  // The cloud browser itself refuses to type a password into a turn's own session.
  await browser.call("open", { missionId: "m9", botId: "nora", session: "req-s9", url: FORM_URL });
  await assert.rejects(browser.call("signIn", { missionId: "m9", botId: "nora", session: "req-s9", domain: "app.example.com", username: "a", password: "b" }), /contraseñas/);
});

test("browser: «tomar el control» pauses the bot, the person's clicks reach the page, and giving it back says so", async () => {
  const { driver } = fakeChromium();
  const browser = cloudBrowser({ driver });
  const events = [];
  browser.onEvent((e) => events.push(e.event));
  await browser.call("open", { missionId: "m1", botId: "nora", url: FORM_URL });
  await assert.rejects(browser.call("input", { missionId: "m1", kind: "click", x: 10, y: 10 }), /Toma el control/);
  const took = await browser.call("takeover", { missionId: "m1", action: "take" });
  assert.equal(took.takeover, true);
  await assert.rejects(browser.call("snapshot", { missionId: "m1", botId: "nora", mode: "elementos", query: "" }), /tiene el control/);
  await browser.call("input", { missionId: "m1", kind: "type", text: "hola" });
  const done = await browser.call("input", { missionId: "m1", kind: "click", x: 150, y: 520 });
  assert.match(done.url, /enviado/);
  await browser.call("takeover", { missionId: "m1", action: "return" });
  assert.deepEqual(events, ["takeover", "returned"]);
  const snap = await browser.call("snapshot", { missionId: "m1", botId: "nora", mode: "texto", query: "" });
  assert.match(snap.text, /Recibido/);
  // Desktop-only operations say so.
  await assert.rejects(browser.call("openPath", {}), /En la nube no hay archivos/);
});
