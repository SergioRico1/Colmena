import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge, ComputerError } from "../server/computer/bridge.mjs";
import {
  computerToolDefs, planComputerCall, executeComputerTool, toolOutputFor, forReceipt, compactImages,
  findComputerGrant, addComputerGrant,
} from "../server/computer/tools.mjs";
import { Store } from "../server/store.mjs";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

/** Fake desktop: a real bridge whose `send` answers from handlers, like Electron would. */
function fakeComputer(handlers = {}) {
  const calls = [];
  const bridge = createBridge({
    available: true,
    send: (message) => {
      calls.push({ op: message.op, args: message.args });
      setImmediate(async () => {
        try {
          const handler = handlers[message.op];
          if (!handler) throw new ComputerError("sin manejador " + message.op, "BAD_OP");
          bridge.handleMessage({ type: "computer-result", id: message.id, ok: true, result: await handler(message.args) });
        } catch (error) {
          bridge.handleMessage({ type: "computer-result", id: message.id, ok: false, error: { message: error.message, code: error.code } });
        }
      });
    },
  });
  bridge.calls = calls;
  return bridge;
}

async function setup(t, handlers, autonomy = "avisa") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-computer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missionRoot = path.join(dir, "workspaces", "m1");
  await mkdir(missionRoot, { recursive: true });
  const shared = path.join(dir, "compartida");
  await mkdir(shared);
  const computer = fakeComputer(handlers);
  const ctx = {
    missionId: "m1", botId: "nora", bot: { id: "nora", name: "Nora", color: "#2F6BFF", autonomy }, missionRoot, computer,
    folders: [
      { id: "f-lee", path: shared, label: "Compartida", botIds: ["nora"], access: "lee" },
      { id: "f-escribe", path: shared, label: "Compartida", botIds: ["nora"], access: "escribe" },
    ],
    settings: {},
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  };
  return { dir, missionRoot, shared, computer, ctx };
}

const SUBMIT_PAGE = {
  inspect: ({ ref }) => ({ ref, name: ref === "e9" ? "Confirmar pedido" : "Siguiente", submit: ref === "e9", domain: "tienda.es" }),
  formSummary: () => ({ fields: [{ label: "Nombre", value: "Ana" }, { label: "Cantidad", value: "3" }], domain: "tienda.es", url: "https://tienda.es/pedido", action: "https://tienda.es/pedido", button: "Confirmar pedido" }),
  screenshot: () => ({ url: "https://tienda.es/pedido", title: "Pedido", jpegBase64: JPEG }),
  status: () => ({ sessions: [{ missionId: "m1", botId: "nora", url: "https://tienda.es/pedido" }] }),
  act: (args) => ({ ok: true, clicked: args.ref, allowSubmit: args.allowSubmit }),
};

test("tool definitions are strict and depend on the desktop app", () => {
  const offline = computerToolDefs({ id: "nora" }, { available: false });
  assert.deepEqual(offline.map((d) => d.name), ["run_command"]);
  const defs = computerToolDefs({ id: "nora" }, { available: true, settings: { allowedApps: [{ label: "Node", path: process.execPath }] } });
  const names = defs.map((d) => d.name);
  for (const n of ["browser_open", "browser_read", "browser_screenshot", "browser_act", "browser_fill", "browser_submit", "browser_download", "open_file", "open_app", "run_command"])
    assert.ok(names.includes(n), n);
  for (const d of defs) {
    assert.equal(d.strict, true);
    assert.deepEqual(d.parameters.required, Object.keys(d.parameters.properties));
    assert.equal(d.parameters.additionalProperties, false);
  }
  assert.deepEqual(defs.find((d) => d.name === "open_app").parameters.properties.app.enum, ["node"]);
  assert.match(defs.find((d) => d.name === "browser_open").description, /captcha.*2FA.*contraseña.*pago/s);
  assert.deepEqual(computerToolDefs({}, { available: true, settings: { computer: { enabled: false } } }), []);
});

test("a click on a submit button becomes a red-line browser_submit with capture and fields", async (t) => {
  const { ctx, missionRoot } = await setup(t, SUBMIT_PAGE, "solo");
  const plan = await planComputerCall("browser_act", { kind: "click", ref: "e9", text: "" }, ctx);
  assert.equal(plan.name, "browser_submit");
  assert.equal(plan.policy, "redline");
  assert.equal(plan.approval.title, "Enviar formulario en tienda.es");
  assert.match(plan.approval.scopeLabel, /Dominio externo · tienda\.es/);
  assert.equal(plan.approval.canAlways, false);
  assert.equal(plan.approval.grantScope, null);
  assert.equal(plan.approval.reconverted, true);
  assert.deepEqual(plan.approval.computer.fields.map((f) => f.label), ["Nombre", "Cantidad"]);
  assert.match(plan.approval.computer.shot, /^capturas\/envio-\d+-[a-f0-9]+\.jpg$/);
  assert.ok(existsSync(path.join(missionRoot, plan.approval.computer.shot)));
  assert.equal(plan.verb, "navegando");
});

test("a normal click is free and announced, whatever the autonomy", async (t) => {
  for (const level of ["avisa", "sugiere"]) {
    const env = await setup(t, SUBMIT_PAGE, level);
    const free = await planComputerCall("browser_act", { kind: "click", ref: "e2", text: "" }, env.ctx);
    assert.equal(free.policy, "free", level);
    assert.equal(free.approval, null, level);
    assert.equal(free.announce, "Nora pulsa «Siguiente» en tienda.es", level);
  }
});

test("browser_submit never runs without approval and refuses a changed form", async (t) => {
  const { ctx, computer } = await setup(t, SUBMIT_PAGE, "solo");
  await assert.rejects(() => executeComputerTool("browser_submit", { ref: "e9", summary: "Pedido" }, ctx), /aprobación/);
  assert.equal(computer.calls.filter((c) => c.op === "act").length, 0);
  const stale = { computer: { fields: [{ label: "Nombre", value: "Ana" }, { label: "Cantidad", value: "30" }], domain: "tienda.es" } };
  await assert.rejects(() => executeComputerTool("browser_submit", { ref: "e9", summary: "Pedido" }, { ...ctx, approved: true, approval: stale }), /ha cambiado/);
  const ok = { computer: { fields: [{ label: "Nombre", value: "Ana" }, { label: "Cantidad", value: "3" }], domain: "tienda.es" } };
  const result = await executeComputerTool("browser_submit", { ref: "e9", summary: "Pedido" }, { ...ctx, approved: true, approval: ok });
  assert.equal(result.allowSubmit, true);
});

test("ordinary clicks never carry permission to submit", async (t) => {
  const { ctx, computer } = await setup(t, SUBMIT_PAGE, "solo");
  await executeComputerTool("browser_act", { kind: "click", ref: "e2", text: "" }, ctx);
  assert.equal(computer.calls.find((c) => c.op === "act").args.allowSubmit, false);
});

test("passwords are never typed: the desktop refusal reaches the bot verbatim", async (t) => {
  const { ctx } = await setup(t, {
    act: () => {
      throw new ComputerError("Este campo es una contraseña: pide a la persona que tome el control", "PASSWORD");
    },
  });
  await assert.rejects(
    () => executeComputerTool("browser_act", { kind: "escribir", ref: "e4", text: "1234" }, ctx),
    (error) => error.message === "Este campo es una contraseña: pide a la persona que tome el control" && error.code === "PASSWORD",
  );
});

test("private addresses are refused before reaching the browser", async (t) => {
  const { ctx, computer } = await setup(t, { open: (a) => ({ url: a.url, title: "Ejemplo", page: "- enlace \"Más\" [e1]\n", elements: 1 }) });
  for (const url of ["http://192.168.1.1/", "http://127.0.0.1:4317/api/state", "http://localhost/", "file:///C:/Windows/win.ini", "http://[::1]/", "http://169.254.169.254/"])
    await assert.rejects(() => executeComputerTool("browser_open", { url }, ctx), /no permitida|Solo se pueden/, url);
  await assert.rejects(() => executeComputerTool("browser_open", { url: "https://rebind.example.com/" }, { ...ctx, resolve: async () => [{ address: "10.1.2.3", family: 4 }] }), /no permitida/);
  assert.equal(computer.calls.length, 0);
  const page = await executeComputerTool("browser_open", { url: "https://example.com/" }, ctx);
  assert.equal(page.title, "Ejemplo");
  assert.match(page.notice, /no fiable/);
  assert.equal(computer.calls[0].args.downloadsDir, path.join(ctx.missionRoot, "descargas"));
});

test("open_file rejects executables and paths outside the folder", async (t) => {
  const { ctx, shared, computer } = await setup(t, { openPath: (a) => ({ opened: true, path: a.path }) }, "solo");
  await writeFile(path.join(shared, "factura.pdf"), "%PDF");
  await writeFile(path.join(shared, "instalar.exe"), "MZ");
  for (const p of ["instalar.exe", "x.bat", "x.cmd", "x.ps1", "x.lnk", "x.msi", "x.vbs", "x.js", "x.jar", "x.scr", "x.com"])
    await assert.rejects(() => executeComputerTool("open_file", { folderId: "f-lee", path: p }, ctx), /No se abren/, p);
  await assert.rejects(() => executeComputerTool("open_file", { folderId: "f-lee", path: "../fuera.pdf" }, ctx), /Ruta no permitida/);
  await assert.rejects(() => executeComputerTool("open_file", { folderId: "otra", path: "factura.pdf" }, ctx), /acceso/);
  assert.equal(computer.calls.length, 0);
  const result = await executeComputerTool("open_file", { folderId: "f-lee", path: "factura.pdf" }, ctx);
  assert.equal(result.opened, true);
  assert.equal(path.basename(computer.calls[0].args.path), "factura.pdf");
  const sugiere = await setup(t, {}, "sugiere");
  await assert.rejects(() => executeComputerTool("open_file", { folderId: "mision", path: "a.pdf" }, sugiere.ctx), /aprobación/);
});

test("run_command: free when the bot acts (asked with «Solo sugiere»), exact-argv rule, write folders only, no shell and a minimal environment", async (t) => {
  const { ctx, missionRoot } = await setup(t, {}, "solo");
  const free = await planComputerCall("run_command", { program: process.execPath, args: ["--version"], folderId: null, reason: "Ver la versión" }, ctx);
  assert.equal(free.policy, "free");
  assert.equal(free.approval, null);
  assert.match(free.announce, /ejecuta «/);
  await assert.rejects(() => executeComputerTool("run_command", { program: process.execPath, args: ["--version"], folderId: "f-lee", reason: "Probar" }, ctx), /solo puedes leer|No encuentro/);
  const asks = (await setup(t, {}, "sugiere")).ctx;
  const plan = await planComputerCall("run_command", { program: process.execPath, args: ["--version"], folderId: null, reason: "Ver la versión" }, asks);
  assert.equal(plan.policy, "approval");
  assert.equal(plan.approval.canAlways, true);
  assert.equal(plan.approval.grantDays, 30);
  assert.match(plan.approval.grantScope, /^cmd:[a-f0-9]{32}$/);
  const other = await planComputerCall("run_command", { program: process.execPath, args: ["--help"], folderId: null, reason: "Ayuda" }, asks);
  assert.notEqual(other.approval.grantScope, plan.approval.grantScope, "rule bound to exact args");
  assert.match(plan.approval.summary, /no hay un entorno aislado/);

  const red = await planComputerCall("run_command", { program: process.execPath, args: ["-e", "1"], folderId: null, reason: "Probar" }, ctx);
  assert.equal(red.policy, "redline");
  assert.equal(red.approval.canAlways, false);

  await assert.rejects(() => executeComputerTool("run_command", { program: process.execPath, args: ["--version"], folderId: null, reason: "Probar" }, asks), /aprobación/);
  await assert.rejects(() => planComputerCall("run_command", { program: "git", args: [], folderId: "f-lee", reason: "Probar" }, asks), /solo puedes leer|No encuentro/);
  await assert.rejects(() => planComputerCall("run_command", { program: "del", args: ["a"], folderId: null, reason: "Probar" }, ctx), /No encuentro|consola/);
  await assert.rejects(() => planComputerCall("run_command", { program: "C:\\x\\instalar.bat", args: [], folderId: null, reason: "Probar" }, ctx), /scripts/);

  process.env.COLMENA_SECRET_FOR_TEST = "no-debe-salir";
  t.after(() => delete process.env.COLMENA_SECRET_FOR_TEST);
  const version = await executeComputerTool("run_command", { program: process.execPath, args: ["--version"], folderId: null, reason: "Probar" }, { ...ctx, approved: true, approval: plan.approval });
  assert.equal(version.exitCode, 0);
  assert.match(version.stdout, /^v\d+\./);
  const env = await executeComputerTool("run_command", { program: process.execPath, args: ["-p", "JSON.stringify([process.cwd(), process.env.COLMENA_SECRET_FOR_TEST || null, 'a b & echo hacked'])"], folderId: null, reason: "Probar" }, { ...ctx, approved: true });
  const [cwd, secret, literal] = JSON.parse(env.stdout);
  assert.equal(path.resolve(cwd).toLowerCase(), path.resolve(missionRoot).toLowerCase());
  assert.equal(secret, null);
  assert.equal(literal, "a b & echo hacked");
});

test("screenshots go to the model as input_image but never into receipts", async (t) => {
  const { ctx, computer } = await setup(t, { screenshot: () => ({ url: "https://example.com/", title: "Ejemplo", jpegBase64: JPEG }) });
  const result = await executeComputerTool("browser_screenshot", {}, ctx);
  const output = toolOutputFor("browser_screenshot", result);
  assert.equal(output[1].type, "input_image");
  assert.match(output[1].image_url, /^data:image\/jpeg;base64,/);
  assert.doesNotMatch(output[0].text, /base64/);
  assert.equal(forReceipt(result).image, undefined);
  assert.equal(forReceipt(result).imageOmitted, true);
  assert.equal(typeof toolOutputFor("browser_read", { page: "x" }), "string");
  assert.equal(computer.lastFrame("m1").url, "https://example.com/");
  const history = [
    { type: "function_call_output", call_id: "a", output },
    { type: "function_call_output", call_id: "b", output },
  ];
  const compact = compactImages(history);
  assert.equal(compact[0].output.some((p) => p.type === "input_image"), false);
  assert.equal(compact[1].output.some((p) => p.type === "input_image"), true);
});

test("command rules expire after 30 days; red lines never become rules", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-grants-"));
  const store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const grant = addComputerGrant(store, { botId: "nora", tool: "run_command", scope: "cmd:abc", canAlways: true, grantDays: 30 });
  const days = (Date.parse(grant.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30);
  assert.ok(findComputerGrant(store, { botId: "nora", tool: "run_command", scope: "cmd:abc" }));
  assert.equal(findComputerGrant(store, { botId: "nora", tool: "run_command", scope: "cmd:otro" }), null);
  store.patch("grants", grant.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(findComputerGrant(store, { botId: "nora", tool: "run_command", scope: "cmd:abc" }), null);
  assert.throws(() => addComputerGrant(store, { botId: "nora", tool: "browser_submit", scope: null, redLine: true, canAlways: false }), /permanente/);
});

test("bridge: unavailable without Electron, timeouts, and frames throttled to 1/s in memory", async () => {
  const off = createBridge({ available: false });
  await assert.rejects(() => off.call("status"), (e) => e.code === "UNAVAILABLE" && /escritorio/.test(e.message));
  const silent = createBridge({ available: true, send: () => {} });
  await assert.rejects(() => silent.call("status", {}, { timeout: 30 }), (e) => e.code === "TIMEOUT");
  let clock = 1000;
  const bridge = createBridge({ available: true, now: () => clock });
  const seen = [];
  bridge.onFrame((f) => seen.push(f));
  const frame = { type: "computer-frame", missionId: "m1", botId: "nora", url: "https://a.es/", title: "A", jpegBase64: JPEG };
  bridge.handleMessage(frame);
  clock += 400;
  bridge.handleMessage({ ...frame, title: "B" });
  clock += 700;
  bridge.handleMessage({ ...frame, title: "C" });
  assert.deepEqual(seen.map((f) => f.title), ["A", "C"]);
  assert.equal(bridge.lastFrame("m1").title, "C");
  assert.equal(seen[0].type, "browser_frame");
  assert.equal(seen[0].mission, "m1");
  assert.match(seen[0].image, /^data:image\/jpeg;base64,/);
  bridge.handleMessage({ ...frame, jpegBase64: "<script>" });
  assert.equal(bridge.lastFrame("m1").title, "C", "invalid frames are ignored");
});
