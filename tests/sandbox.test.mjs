import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Sandbox, detectBackend, findCodexBinary, runConfined, sandboxFailure, sandboxKey, seatbeltProfile, untrustedCommand, BLOCKED_NOTE,
} from "../server/computer/sandbox.mjs";
import { computerPolicy } from "../server/computer/policy.mjs";
import { planComputerCall, executeComputerTool } from "../server/computer/tools.mjs";
import { computerExtraTools } from "../server/computer/wire.mjs";
import { Store } from "../server/store.mjs";

test("detection only looks for files, per platform, and can be switched off", () => {
  const appdata = "C:\\Users\\x\\AppData\\Roaming";
  const exe = path.join(appdata, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
  const only = (...files) => (p) => files.includes(p);
  assert.deepEqual(detectBackend({ platform: "win32", env: { APPDATA: appdata }, exists: only(exe), arch: "x64" }), { kind: "codex", command: exe });
  assert.equal(findCodexBinary({ env: { APPDATA: appdata }, exists: () => false }), null);
  assert.equal(detectBackend({ platform: "win32", env: { APPDATA: appdata }, exists: () => false }), null);
  assert.equal(detectBackend({ platform: "win32", env: { APPDATA: appdata, COLMENA_SANDBOX: "off" }, exists: only(exe) }), null);
  assert.equal(detectBackend({ platform: "darwin", env: {}, exists: only("/usr/bin/sandbox-exec") }).kind, "seatbelt");
  assert.equal(detectBackend({ platform: "linux", env: { PATH: "/usr/bin:/bin" }, exists: only(path.join("/usr/bin", "bwrap")) }).kind, "bwrap");
  assert.equal(detectBackend({ platform: "linux", env: { PATH: "/usr/bin" }, exists: () => false }), null);
});

test("Sandbox caches its backend, fails closed for a while after a runner failure, and confines only Colmena's folders on Windows", () => {
  let calls = 0, clock = 1000;
  const box = new Sandbox({ directory: "C:\\Data\\Colmena", platform: "win32", detect: () => (calls++, { kind: "codex", command: "C:\\codex.exe" }), now: () => clock });
  box.backend(); box.backend(); box.backend();
  assert.equal(calls, 1, "detected once");
  assert.equal(box.canConfine(path.win32.join("C:\\Data\\Colmena", "workspaces", "m1")), process.platform === "win32");
  assert.equal(box.canConfine("D:\\Mis documentos"), false, "never a shared folder of the person");
  box.markBroken("boom");
  assert.equal(box.backend(), null);
  clock += 11 * 60 * 1000;
  assert.ok(box.backend(), "detected again later");
  assert.equal(calls, 2);
  const mac = new Sandbox({ directory: "/data", platform: "darwin", detect: () => ({ kind: "seatbelt", command: "/usr/bin/sandbox-exec" }) });
  assert.equal(mac.canConfine("/anywhere"), true);
  const none = new Sandbox({ directory: "/data", detect: () => null });
  assert.equal(none.canConfine("/data/x"), false);
});

test("wrap builds the runner's argv: codex workspace profile, Seatbelt profile and bwrap binds", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-sbx-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, "workspaces", "m1");
  await mkdir(cwd, { recursive: true });
  const codex = new Sandbox({ directory: dir, detect: () => ({ kind: "codex", command: "codex.exe" }) });
  const spec = codex.wrap("node.exe", ["a.js"], { cwd, env: { PATH: "x" } });
  assert.deepEqual(spec.args, ["sandbox", "-P", ":workspace", "-C", cwd, "--", "node.exe", "a.js"]);
  assert.equal(spec.env.PATH, "x");
  assert.equal(spec.env.TEMP, spec.temp);
  assert.ok(spec.temp.startsWith(path.join(dir, "sandbox", "tmp")), "a private temp folder inside Colmena's data");
  assert.match(String(spec.env.CODEX_HOME), /codex-home$/);
  assert.ok(existsSync(path.join(spec.env.CODEX_HOME, "config.toml")), "its own Codex config, never the person's");
  codex.dispose(spec);
  assert.equal(existsSync(spec.temp), false);

  const seat = new Sandbox({ directory: dir, detect: () => ({ kind: "seatbelt", command: "/usr/bin/sandbox-exec" }) }).wrap("/usr/bin/python3", ["x.py"], { cwd });
  assert.equal(seat.args[0], "-p");
  assert.match(seat.args[1], /\(deny default\)/);
  assert.ok(seat.args[1].includes("(subpath " + JSON.stringify(cwd) + ")") || seat.args[1].includes("(subpath \"" + cwd.replace(/\\/g, "\\\\") + "\")"));
  assert.doesNotMatch(seat.args[1], /\(allow network\*\)$/m);
  assert.deepEqual(seat.args.slice(-3), ["--", "/usr/bin/python3", "x.py"]);
  assert.match(seatbeltProfile({ writable: ["/a"], network: true }), /\(allow network\*\)/);

  const bw = new Sandbox({ directory: dir, detect: () => ({ kind: "bwrap", command: "/usr/bin/bwrap" }) }).wrap("/usr/bin/node", ["a.js"], { cwd });
  assert.ok(bw.args.includes("--unshare-net"));
  assert.deepEqual(bw.args.slice(bw.args.indexOf("--bind"), bw.args.indexOf("--bind") + 3), ["--bind", cwd, cwd]);
});

test("a blocked command is told apart from a runner that failed", () => {
  assert.equal(sandboxFailure({ exitCode: 0, stdout: "EPERM", stderr: "" }), null, "success is never a block");
  assert.equal(sandboxFailure({ exitCode: 1, stdout: "", stderr: "Error: EPERM: operation not permitted, open 'C:\\x'" }), "blocked");
  assert.equal(sandboxFailure({ exitCode: 1, stdout: "", stderr: "Acceso denegado." }), "blocked");
  assert.equal(sandboxFailure({ exitCode: 2, stdout: "", stderr: "SyntaxError: Unexpected token" }), null, "the program's own error");
  assert.equal(sandboxFailure({ exitCode: 127, stdout: "", stderr: "" }), "runner");
  assert.equal(sandboxFailure({ exitCode: 2, stdout: "", stderr: "error: the following required arguments were not provided:\n  --permission-profile <NAME>" }), "runner");
  assert.equal(sandboxFailure({ exitCode: 1, stdout: "", stderr: "bwrap: Creating new namespace failed" }), "runner");
  assert.equal(sandboxFailure(null, { error: Error("spawn ENOENT") }), "runner");
  assert.equal(sandboxFailure({ exitCode: null, timedOut: true, stderr: "EPERM" }), null);
});

test("code the bot wrote or brought is untrusted; installed programs are not", () => {
  const work = path.resolve("/data/workspaces/m1");
  assert.match(untrustedCommand("python", ["informe.py"]), /script/);
  assert.match(untrustedCommand("node", ["--trace-warnings", "build.mjs"]), /script/);
  assert.equal(untrustedCommand("python", ["--version"]), null);
  assert.equal(untrustedCommand("git", ["status"]), null);
  assert.match(untrustedCommand(path.join(work, "herramienta.exe"), [], { resolved: path.join(work, "herramienta.exe"), folders: [work] }), /carpeta de trabajo/);
  assert.equal(untrustedCommand("C:\\Windows\\System32\\where.exe", ["git"], { folders: [work] }), null);
});

test("runConfined: confined, blocked (with the note), runner failure (never run twice) and the approved wide mode", async () => {
  const seen = [];
  const fake = (out) => ({
    canConfine: () => true, markBroken: () => (fake.broken = true), clean: (r) => r, dispose: () => {},
    wrap: (file, args, { env }) => ({ kind: "fake", file: "runner", args: [file, ...args], env: { ...env, BOXED: "1" } }),
    out,
  });
  const run = (result) => async (file, args, env) => { seen.push({ file, args, env }); return result; };
  let r = await runConfined(fake(), { file: "node", args: ["a.js"], cwd: "/w", env: {}, untrusted: true }, run({ exitCode: 0, stdout: "ok", stderr: "" }));
  assert.equal(r.sandbox.mode, "aislado");
  assert.equal(seen.at(-1).file, "runner");
  assert.equal(seen.at(-1).env.BOXED, "1");
  r = await runConfined(fake(), { file: "node", args: ["a.js"], cwd: "/w", env: {} }, run({ exitCode: 1, stdout: "", stderr: "EACCES: permission denied" }));
  assert.equal(r.sandbox.blocked, true);
  assert.equal(r.sandbox.note, BLOCKED_NOTE);
  const count = seen.length;
  const box = fake();
  r = await runConfined(box, { file: "node", args: ["a.js"], cwd: "/w", env: {} }, run({ exitCode: 127, stdout: "", stderr: "" }));
  assert.equal(r.result.sandboxRunner, true);
  assert.match(r.result.error, /no se ha ejecutado/);
  assert.equal(seen.length, count + 1, "the runner failure is not retried unconfined");
  r = await runConfined(fake(), { file: "node", args: ["a.js"], cwd: "/w", env: {}, mode: "amplio" }, run({ exitCode: 0, stdout: "", stderr: "" }));
  assert.equal(seen.at(-1).file, "node", "the person's OK runs it without the sandbox");
  r = await runConfined(null, { file: "node", args: [], cwd: "/w", env: {} }, run({ exitCode: 0 }));
  assert.equal(r.sandbox, null, "not configured: as before");
  const none = { canConfine: () => false, wrap: () => null };
  await assert.rejects(runConfined(none, { file: "node", args: ["a.js"], cwd: "/w", env: {}, untrusted: true }, run({ exitCode: 0 })), /aprobación/);
  r = await runConfined(none, { file: "git", args: ["status"], cwd: "/w", env: {} }, run({ exitCode: 0 }));
  assert.equal(r.sandbox.mode, "sin-aislar", "an ordinary command keeps today's behaviour");
});

test("policy: bot-written code without a sandbox is a red line; a blocked run asked again is a red line", () => {
  const bot = { autonomy: "avisa" };
  const args = { program: "python", args: ["x.py"] };
  assert.equal(computerPolicy("run_command", args, bot), "free");
  assert.equal(computerPolicy("run_command", args, bot, { unconfined: "Ejecuta un script." }), "redline");
  assert.equal(computerPolicy("run_command", args, bot, { wide: true }), "redline");
});

async function setup(t, sandbox) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-sbx-run-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missionRoot = path.join(dir, "workspaces", "m1");
  await mkdir(missionRoot, { recursive: true });
  await writeFile(path.join(missionRoot, "hola.js"), "console.log(process.env.BOXED || 'libre')");
  const ctx = { missionId: "m1", botId: "nora", bot: { id: "nora", name: "Nora", autonomy: "avisa" }, missionRoot, folders: [], settings: {}, sandbox };
  return { dir, missionRoot, ctx };
}
// A stand-in backend: the "runner" is node itself running the program with BOXED=1.
const fakeBox = (extra = {}) => ({
  canConfine: () => true, markBroken() {}, clean: (r) => r, dispose() {},
  wrap: (file, args, { env }) => ({ kind: "fake", file, args, env: { ...env, BOXED: "1" } }),
  ...extra,
});

test("run_command runs a bot's script in the sandbox, and fails closed into a red line without one", async (t) => {
  const { ctx } = await setup(t, fakeBox());
  const call = { program: process.execPath, args: ["hola.js"], folderId: null, reason: "Probar el script" };
  const plan = await planComputerCall("run_command", call, ctx);
  assert.equal(plan.policy, "free");
  const result = await executeComputerTool("run_command", call, ctx);
  assert.equal(result.stdout.trim(), "1", "confined");
  assert.match(result.sandbox, /aislado/);

  const none = { ...ctx, sandbox: { canConfine: () => false, wrap: () => null } };
  const red = await planComputerCall("run_command", call, none);
  assert.equal(red.policy, "redline");
  assert.match(red.approval.summary, /no tiene un entorno aislado/);
  assert.equal(red.approval.computer.sandbox, "amplio");
  await assert.rejects(executeComputerTool("run_command", call, none), /aprobación/);
  const approved = await executeComputerTool("run_command", call, { ...none, approved: true, approval: red.approval });
  assert.equal(approved.stdout.trim(), "libre", "the person's OK runs it as approved");
  // Ordinary installed programs keep today's classification.
  assert.equal((await planComputerCall("run_command", { program: process.execPath, args: ["--version"], folderId: null, reason: "Versión" }, none)).policy, "free");
});

test("wire: the sandbox blocks a command; asked again it becomes one approval card for a wider run", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-sbx-wire-"));
  const store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const missionRoot = path.join(dir, "workspaces", "m1");
  await mkdir(missionRoot, { recursive: true });
  await writeFile(path.join(missionRoot, "fuera.js"), "if (process.env.BOXED) { console.error('EPERM: operation not permitted'); process.exit(1) } console.log('hecho')");
  const runtime = {
    store, sandbox: fakeBox(), settings: () => ({}), autonomy: () => "avisa", root: () => missionRoot,
    setActivity() {}, announce() {}, approvalContext: () => "Nora · prueba",
  };
  store.put("steps", { id: "s1", missionId: "m1", botId: "nora", history: [], pending: [] });
  const tools = computerExtraTools(runtime, { computer: { available: false } })({ id: "nora", name: "Nora" });
  const runTool = tools.find((x) => x.name === "run_command");
  const args = { program: process.execPath, args: ["fuera.js"], folderId: null, reason: "Escribir fuera" };
  const ctxFor = (callId) => ({ mission: { id: "m1" }, step: store.get("steps", "s1"), bot: { id: "nora", name: "Nora" }, call: { call_id: callId } });
  const first = await runTool.run(args, ctxFor("c1"));
  assert.equal(first.sandboxBlocked, true);
  assert.match(first.note, /vuelve a llamar exactamente igual/);
  assert.equal(store.get("steps", "s1").sandboxBlocked[sandboxKey("run_command", { program: args.program, args: args.args, folderId: null })], "blocked");
  const second = await runTool.run(args, ctxFor("c2"));
  assert.deepEqual(second, { waiting: true });
  const card = store.get("approvals", "s1:c2");
  assert.equal(card.redLine, true);
  assert.match(card.title, /^Ejecutar sin aislamiento/);
  assert.match(card.summary, /bloqueó/);
  store.patch("approvals", "s1:c2", { status: "approved", decidedBy: "tú" });
  const wide = await runTool.run(args, ctxFor("c2"));
  assert.equal(wide.stdout.trim(), "hecho", "the approved retry runs with the wider mode");
  // Asked once: blocked again later, it does not ask again.
  const third = await runTool.run(args, ctxFor("c3"));
  assert.equal(third.sandboxBlocked, true);
  assert.match(third.note, /no insistas/);
  assert.equal(store.get("approvals", "s1:c3"), null);
});
