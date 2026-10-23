// Dictation with the computer's own speech recognizer (server/dictation, server/voice.mjs):
// the helper protocol with a simulated engine, the choice between the system and the OpenAI
// key, the Spanish help when Windows lacks Spanish speech, the SSE route, and — on a Windows
// with the Spanish recognizer — a real round trip: a WAV spoken by the Windows voice and
// transcribed offline by the compiled helper.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { DictationSession, parseLines, probe, runOnce, windowsHelper } from "../server/dictation/index.mjs";
import { chooseMode, createDictation, preferenceOf, publicEvent, registerVoiceRoutes, statusView, systemProblem } from "../server/voice.mjs";

/** A simulated helper: `script(child)` writes its JSON lines; stdin lines are recorded. */
function fakeLaunch(script) {
  const launched = [];
  const launch = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.input = [];
    child.args = args;
    child.killed = false;
    child.stdin.on("data", (b) => child.input.push(...String(b).split("\n").filter(Boolean)));
    child.kill = () => { child.killed = true; child.emit("exit", null); };
    child.say = (...events) => child.stdout.write(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    child.end = (code = 0) => { child.stdout.end(); setImmediate(() => child.emit("exit", code)); };
    launched.push(child);
    queueMicrotask(() => script(child));
    return child;
  };
  return { launch, launched };
}
const collect = (session) => new Promise((resolve) => {
  const out = [];
  session.on("event", (e) => { out.push(e); if (e.type === "end") resolve(out); });
});

test("the helper's JSON lines become events, even split across chunks", async () => {
  assert.deepEqual(parseLines('{"type":"final","text":"hola"}\nnot json\n{"x":1}\n\n{"type":"end"}'), [{ type: "final", text: "hola" }, { type: "end" }]);
  const { launch, launched } = fakeLaunch((c) => {
    c.stdout.write('{"type":"ready","engine":"sapi","lang":"es-ES"}\n{"type":"par');
    c.stdout.write('tial","text":"buenos"}\n{"type":"level","value":0.4}\n');
    c.say({ type: "final", text: "Buenos días" }, { type: "end" });
    c.end();
  });
  const session = new DictationSession({ command: "helper.exe", launch });
  const events = await collect(session);
  assert.deepEqual(events.map((e) => e.type), ["ready", "partial", "level", "final", "end"]);
  assert.deepEqual(launched[0].args.slice(0, 2), ["--lang", "es-ES"], "Spanish (Spain) is asked for");
  assert.ok(!session.events.some((e) => e.type === "level"), "loudness is live only, never replayed");
  assert.equal(session.done, true);
});

test("stop asks the helper to finish the phrase; a crash still ends the dictation", async () => {
  const { launch, launched } = fakeLaunch((c) => c.say({ type: "ready" }));
  const session = new DictationSession({ command: "h", launch });
  const done = collect(session);
  await new Promise((r) => setImmediate(r));
  session.stop();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(launched[0].input, ["stop"]);
  launched[0].say({ type: "final", text: "Último" }, { type: "end" });
  launched[0].end();
  assert.equal((await done).at(-2).text, "Último");

  const crash = fakeLaunch((c) => { c.say({ type: "ready" }); c.end(3); });
  const broken = await collect(new DictationSession({ command: "h", launch: crash.launch }));
  assert.deepEqual(broken.map((e) => e.type), ["ready", "error", "end"]);
  assert.equal(broken[1].code, "failed");
});

test("the engine: this computer first, then the OpenAI key, or plainly nothing", () => {
  const ok = { available: true, engine: "sapi", lang: "es-ES", onDevice: true };
  const none = { available: false, code: "no-language" };
  assert.equal(chooseMode("auto", ok, true), "sistema", "the local recognizer wins even with a key");
  assert.equal(chooseMode("auto", none, true), "openai");
  assert.equal(chooseMode("auto", none, false), null);
  assert.equal(chooseMode("sistema", none, true), null, "pinned to the computer: never sends audio out");
  assert.equal(chooseMode("openai", ok, true), "openai");
  assert.equal(chooseMode("openai", ok, false), null);
  assert.equal(preferenceOf({ get: () => ({ dictation: "openai" }) }), "openai");
  assert.equal(preferenceOf({ get: () => ({ dictation: "x" }) }), "auto");

  const win = statusView({ preference: "auto", system: none, openai: false, platform: "win32" });
  assert.equal(win.mode, null);
  assert.match(win.problem.message, /Windows necesita el reconocimiento de voz en español/);
  assert.match(win.problem.help, /Hora e idioma › Idioma y región › Español \(España\).*Reconocimiento de voz/);
  assert.equal(win.problem.open, "language");
  assert.equal(win.transcribe, false);
  const local = statusView({ preference: "auto", system: ok, openai: true, platform: "win32" });
  assert.equal(local.mode, "sistema");
  assert.equal(local.problem, null);
  assert.match(local.system.label, /Windows, sin conexión/);
  const fallback = statusView({ preference: "auto", system: none, openai: true, platform: "win32" });
  assert.equal(fallback.mode, "openai");
  assert.ok(fallback.problem, "Ajustes still says how to dictate without the key");
  assert.match(systemProblem("denied-speech", "darwin").help, /Reconocimiento de voz/);
  assert.match(systemProblem("denied-microphone", "win32").help, /aplicaciones de escritorio/);
  assert.equal(publicEvent({ type: "error", code: "no-microphone" }).message, "No encuentro ningún micrófono.");
  assert.equal(publicEvent({ type: "level", value: 7 }).value, 1);
});

test("probe reads what the helper says this computer has", async () => {
  const run = (platform, event) => probe({ platform, resolve: async () => ({ command: "h" }), launchOnce: async (_c, args) => (assert.ok(args.includes("--probe")), [event]) });
  assert.deepEqual(await run("win32", { type: "probe", installed: "en-GB,de-DE" }), { available: false, engine: "sapi", code: "no-language", installed: ["en-GB", "de-DE"] });
  const win = await run("win32", { type: "probe", installed: "es-MX,en-GB", microphoneBlocked: true });
  assert.equal(win.available, true);
  assert.equal(win.lang, "es-MX", "any Spanish recognizer will do when there is no es-ES");
  assert.equal(win.microphoneBlocked, true);
  assert.equal((await run("darwin", { type: "probe", installed: "es_ES,en_US", speech: 2, microphone: 0 })).code, "denied-speech");
  assert.equal((await run("darwin", { type: "probe", installed: "es_ES", speech: 0, microphone: 2 })).code, "denied-microphone");
  const mac = await run("darwin", { type: "probe", installed: "es_ES,en_US", speech: 3, microphone: 0, onDevice: true, available: true });
  assert.deepEqual([mac.available, mac.lang, mac.onDevice], [true, "es-ES", true]);
  assert.equal((await run("win32", { type: "nonsense" })).code, "failed");
  assert.equal((await probe({ platform: "linux" })).code, "unsupported");
  assert.equal((await probe({ platform: "win32", resolve: async () => { throw Object.assign(Error("x"), { code: "no-compiler" }); } })).code, "no-compiler");
});

test("one dictation at a time; the status only probes again when something changed", async () => {
  let probes = 0;
  const { launch, launched } = fakeLaunch((c) => c.say({ type: "ready" }));
  const dictation = createDictation({ platform: "win32", probeImpl: async () => { probes++; return { available: true, engine: "sapi", lang: "es-ES" }; }, resolve: async () => ({ command: "h.exe" }), launch });
  await dictation.check();
  await dictation.check();
  assert.equal(probes, 1);
  const a = await dictation.start();
  const b = await dictation.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(launched[0].input, ["cancel"], "the first one is dropped");
  assert.notEqual(a.id, b.id);
  assert.equal(dictation.get(b.id), b);

  const missing = createDictation({ platform: "win32", probeImpl: async () => ({ available: false, code: "no-language" }) });
  await assert.rejects(missing.start(), (e) => e.status === 409 && /español/.test(e.message));
});

async function voiceServer(t, { system, script, preference = "auto" }) {
  const settings = { id: "main", dictation: preference };
  const store = { get: () => settings, patch: (_k, _id, c) => Object.assign(settings, c), directory: null };
  const app = express();
  app.use(express.json());
  const fake = fakeLaunch(script);
  const opened = [];
  const dictation = createDictation({ platform: "win32", probeImpl: async () => system, resolve: async () => ({ command: "h.exe" }), launch: fake.launch });
  registerVoiceRoutes(app, { store, runtime: { provider: null }, check: (schema, body) => schema.parse(body), dictation, openPage: (target) => opened.push(target) });
  app.use((err, _req, res, _next) => res.status(err.status || 422).json({ error: err.message }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); return new Promise((r) => server.close(r)); });
  const origin = "http://127.0.0.1:" + server.address().port;
  const call = async (method, route, body) => {
    const res = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    return { status: res.status, body: await res.json() };
  };
  return { origin, call, settings, fake, opened };
}

test("routes: status, the preference, live words over SSE and the settings page", async (t) => {
  const s = await voiceServer(t, {
    system: { available: true, engine: "sapi", lang: "es-ES", onDevice: true },
    script: (c) => {
      c.say({ type: "ready", engine: "sapi", lang: "es-ES" }, { type: "partial", text: "prepara" }, { type: "final", text: "Prepara el informe" });
      setTimeout(() => { c.say({ type: "end" }); c.end(); }, 30);
    },
  });
  const status = (await s.call("GET", "/voice/status")).body;
  assert.equal(status.mode, "sistema");
  assert.equal(status.system.lang, "es-ES");

  const { id } = (await s.call("POST", "/voice/listen")).body;
  const text = await (await fetch(`${s.origin}/api/voice/listen/${id}/events`)).text();
  const events = text.split("\n\n").filter(Boolean).map((block) => JSON.parse(block.replace(/^data: /, "")));
  assert.deepEqual(events.map((e) => e.type), ["ready", "partial", "final", "end"]);
  assert.equal(events[2].text, "Prepara el informe");
  assert.equal((await s.call("POST", `/voice/listen/${id}/stop`, {})).status, 200);
  assert.equal((await s.call("GET", "/voice/listen/nope/events")).status, 404);

  assert.equal((await s.call("PATCH", "/voice/settings", { engine: "openai" })).body.mode, null, "no key: nothing dictates");
  assert.equal(s.settings.dictation, "openai");
  assert.equal((await s.call("POST", "/voice/listen")).status, 409);
  assert.equal((await s.call("PATCH", "/voice/settings", { engine: "whisper" })).status, 422);

  assert.equal((await s.call("POST", "/voice/open-settings", { page: "language" })).status, 200);
  assert.deepEqual(s.opened, ["ms-settings:regionlanguage"]);
  assert.equal((await s.call("POST", "/voice/open-settings", { page: "calc.exe" })).status, 422, "only fixed pages");
});

test("closing the page drops the dictation", async (t) => {
  const s = await voiceServer(t, { system: { available: true, engine: "sapi", lang: "es-ES" }, script: (c) => c.say({ type: "ready" }) });
  const { id } = (await s.call("POST", "/voice/listen")).body;
  const controller = new AbortController();
  const res = await fetch(`${s.origin}/api/voice/listen/${id}/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  await reader.read();
  controller.abort();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(s.fake.launched[0].input, ["cancel"]);
});

// ───────────── the real thing, on this Windows ─────────────
const onWindows = process.platform === "win32";
test("Windows: a Spanish WAV spoken by the Windows voice is transcribed offline", { skip: !onWindows && "Windows only", timeout: 90000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-dictation-"));
  // The helper may still be closing (or being scanned) when the test ends.
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 }).catch(() => {}));
  const system = await probe({ cacheDir: dir });
  if (!system.available) return t.skip("this Windows has no Spanish speech recognizer (" + system.code + ")");
  assert.equal(system.engine, "sapi");
  const exe = await windowsHelper({ cacheDir: dir });
  const wav = path.join(dir, "dictado.wav");
  const said = await runOnce(exe, ["--say", "Necesito que revises el contrato con el proveedor de Valencia antes del viernes.", "--out", wav]);
  if (!said.some((e) => e.type === "said")) return t.skip("this Windows has no Spanish voice to speak the sample");
  const events = await collect(new DictationSession({ command: exe, args: ["--wav", wav] }));
  const text = events.filter((e) => e.type === "final").map((e) => e.text).join(" ").toLowerCase();
  assert.ok(events.some((e) => e.type === "partial"), "words arrive while they are spoken");
  for (const word of ["contrato", "proveedor", "valencia", "viernes"]) assert.ok(text.includes(word), `«${word}» in «${text}»`);
});
