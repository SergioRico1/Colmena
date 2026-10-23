// Dictation. In order of preference (Ajustes › Privacidad › «Dictado por voz» can pin one):
//  1. «sistema»: the speech recognizer of this computer, no key and, when the system can, no
//     network (Windows' offline recognizer, macOS's Speech framework) — server/dictation/. The
//     helper listens to the microphone itself and the words arrive live over SSE.
//  2. «openai»: the SPA records audio with MediaRecorder and sends it here; it is transcribed
//     with OpenAI's transcription endpoint, only when an OpenAI API key is saved (Ajustes ›
//     Cuentas de IA).
//  3. Neither: the status says plainly why and how to fix it (install Spanish speech in
//     Windows, allow the microphone…).
// Audio is never stored.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { DictationSession, MAX_MS, probe as probeSystem, resolveHelper } from "./dictation/index.mjs";

export const OPENAI_TRANSCRIPTIONS = "https://api.openai.com/v1/audio/transcriptions";
export const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export const MAX_AUDIO_MS = 120000; // 2 minutes
export const MAX_AUDIO_BYTES = 1_000_000; // ~2 min of Opus at 48 kbit/s, fits the JSON body limit
const TYPES = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

/** The provider hub holds an OpenAI API key (saved, even if another provider is active). */
export function transcriptionAvailable(provider) {
  try {
    return typeof provider?.loadKey === "function" && !!provider?.config?.()?.apikey;
  } catch {
    return false;
  }
}

export function audioType(mime) {
  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  return TYPES[base] ? { mime: base, ext: TYPES[base] } : null;
}

/** Decodes and checks a base64 recording: {bytes, mime, ext}. Throws a message for the person. */
export function decodeAudio({ audio, mime, durationMs }) {
  const type = audioType(mime);
  if (!type) throw Error("Ese formato de audio no se puede transcribir.");
  if (typeof durationMs === "number" && durationMs > MAX_AUDIO_MS + 2000) throw Error("El dictado puede durar como mucho 2 minutos.");
  const clean = String(audio || "").replace(/^data:[^,]*,/, "");
  if (!clean || !/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw Error("No se recibió el audio.");
  const bytes = Buffer.from(clean, "base64");
  if (!bytes.length) throw Error("No se recibió el audio.");
  if (bytes.length > MAX_AUDIO_BYTES) throw Error("El audio es demasiado largo: dicta como mucho 2 minutos.");
  return { bytes, ...type };
}

/** Transcribes Spanish speech. Returns {text}. */
export async function transcribe({ provider, audio, mime, durationMs, fetchImpl = fetch, signal = AbortSignal.timeout(60000) }) {
  if (!transcriptionAvailable(provider)) {
    throw Object.assign(Error("El dictado necesita una clave de OpenAI en Ajustes › Cuentas de IA."), { status: 501 });
  }
  const { bytes, mime: type, ext } = decodeAudio({ audio, mime, durationMs });
  const key = await provider.loadKey();
  if (!key) throw Object.assign(Error("El dictado necesita una clave de OpenAI en Ajustes › Cuentas de IA."), { status: 501 });
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), "dictado." + ext);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "es");
  form.append("response_format", "json");
  let response;
  try {
    response = await fetchImpl(OPENAI_TRANSCRIPTIONS, { method: "POST", headers: { Authorization: "Bearer " + key }, body: form, signal });
  } catch {
    throw Error("No se pudo conectar con el servicio de transcripción. Revisa la conexión a internet.");
  }
  if (response.status === 401) throw Error("La clave de OpenAI no es válida. Revísala en Ajustes.");
  if (response.status === 429) throw Error("La clave de OpenAI ha alcanzado su límite de uso.");
  if (!response.ok) throw Error("No se pudo transcribir el audio. Inténtalo otra vez.");
  const data = await response.json().catch(() => ({}));
  return { text: String(data?.text || "").trim() };
}

/* ───────────── the computer's own recognizer ───────────── */

export const PREFERENCES = ["auto", "sistema", "openai"];
export const preferenceOf = (store) => {
  const value = store?.get?.("settings", "main")?.dictation;
  return PREFERENCES.includes(value) ? value : "auto";
};

// System settings pages a problem can open (fixed addresses only: nothing from the request).
export const SETTINGS_PAGES = {
  win32: { language: "ms-settings:regionlanguage", microphone: "ms-settings:privacy-microphone" },
  darwin: {
    language: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
    microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    speech: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
  },
};

/** What went wrong with the system recognizer, for the person: {message, help, open}. */
export function systemProblem(code, platform = process.platform) {
  const mac = platform === "darwin";
  switch (code) {
    case "no-language":
      return mac
        ? { message: "Este Mac no tiene el reconocimiento de voz en español.", help: "Ajustes del Sistema › Teclado › Dictado: añade «Español (España)».", open: "language" }
        : { message: "Para dictar sin clave, Windows necesita el reconocimiento de voz en español.", help: "Configuración › Hora e idioma › Idioma y región › Español (España) › Opciones de idioma › Reconocimiento de voz › Descargar. Después vuelve a probar.", open: "language" };
    case "denied-microphone":
      return mac
        ? { message: "macOS no deja que Colmena use el micrófono.", help: "Ajustes del Sistema › Privacidad y seguridad › Micrófono: activa Colmena.", open: "microphone" }
        : { message: "Windows no deja que Colmena use el micrófono.", help: "Configuración › Privacidad y seguridad › Micrófono: activa «Acceso al micrófono» y «Permitir que las aplicaciones de escritorio accedan al micrófono».", open: "microphone" };
    case "denied-speech":
      return { message: "macOS no deja que Colmena reconozca tu voz.", help: "Ajustes del Sistema › Privacidad y seguridad › Reconocimiento de voz: activa Colmena.", open: "speech" };
    case "no-microphone":
      return { message: "No encuentro ningún micrófono.", help: "Conecta uno (o unos auriculares con micrófono) y vuelve a probar.", open: null };
    case "no-compiler":
      return { message: "A este Windows le falta .NET Framework 4, que necesita el dictado.", help: "Instala las actualizaciones de Windows Update y vuelve a probar.", open: null };
    case "missing":
      return { message: "Esta versión de Colmena no trae el dictado de macOS.", help: "Actualiza Colmena desde Ajustes › Acerca de.", open: null };
    case "unsupported":
      return { message: "Este sistema no tiene un reconocimiento de voz que Colmena sepa usar.", help: null, open: null };
    default:
      return { message: "El reconocimiento de voz de este ordenador no ha respondido.", help: "Vuelve a probar en un momento.", open: null };
  }
}

export function engineLabel(system, platform = process.platform) {
  if (!system?.available) return null;
  if (platform === "darwin") return system.onDevice ? "Dictado de macOS, en este Mac" : "Dictado de macOS, con el servicio de Apple";
  return "Reconocimiento de voz de Windows, sin conexión";
}

/** Which engine dictates now: "sistema", "openai" or null. */
export function chooseMode(preference, system, openai) {
  if (preference === "sistema") return system?.available ? "sistema" : null;
  if (preference === "openai") return openai ? "openai" : null;
  return system?.available ? "sistema" : openai ? "openai" : null;
}

const PROBE_OK_MS = 10 * 60000;
const PROBE_RETRY_MS = 20000;

/** Probe cache, live sessions and the SSE fan-out of one server. */
export function createDictation({ platform = process.platform, cacheDir = path.join(os.tmpdir(), "colmena-helpers"), probeImpl = probeSystem, resolve = resolveHelper, Session = DictationSession, launch, maxMs = MAX_MS } = {}) {
  let system = null;
  let probedAt = 0;
  let probing = null;
  let current = null;
  const sessions = new Map();

  const check = async ({ fresh = false } = {}) => {
    const age = Date.now() - probedAt;
    if (!fresh && system && age < (system.available ? PROBE_OK_MS : PROBE_RETRY_MS)) return system;
    probing ??= probeImpl({ platform, cacheDir }).catch(() => ({ available: false, code: "failed" })).then((result) => {
      system = result;
      probedAt = Date.now();
      return result;
    }).finally(() => { probing = null; });
    return probing;
  };

  return {
    platform,
    check,
    /** The last probe, without waiting (null until the first one finishes). */
    cached: () => system,
    async start() {
      const s = await check();
      if (!s.available) throw Object.assign(Error(systemProblem(s.code, platform).message), { status: 409, code: s.code });
      const { command } = await resolve({ platform, cacheDir });
      // One dictation at a time: a new one replaces any that was left open.
      current?.cancel();
      const session = new Session({ command, maxMs, ...(launch ? { launch } : {}) });
      current = session;
      sessions.set(session.id, session);
      session.on("event", (event) => {
        if (event.type === "error" && event.code && event.code !== "failed") {
          // The computer changed (microphone off, language removed): probe again next time.
          probedAt = 0;
        }
        if (event.type === "end") {
          if (current === session) current = null;
          setTimeout(() => sessions.delete(session.id), 60000).unref?.();
        }
      });
      return session;
    },
    get: (id) => sessions.get(id) || null,
    stopAll() {
      for (const s of sessions.values()) s.cancel();
    },
  };
}

/** Spanish wording of a helper event for the SPA (errors get a message and a way to fix them). */
export function publicEvent(event, platform = process.platform) {
  if (event.type === "error") {
    const problem = systemProblem(event.code, platform);
    return { type: "error", code: event.code || "failed", message: problem.message, help: problem.help, open: problem.open };
  }
  if (event.type === "partial" || event.type === "final") return { type: event.type, text: String(event.text || "").trim() };
  if (event.type === "level") return { type: "level", value: Math.max(0, Math.min(1, Number(event.value) || 0)) };
  if (event.type === "ready") return { type: "ready", engine: event.engine, lang: event.lang, onDevice: event.onDevice !== false };
  return { type: event.type };
}

/** GET /api/voice/status body. */
export async function voiceStatus({ dictation, store, provider, fresh = false }) {
  const preference = preferenceOf(store);
  const system = dictation ? await dictation.check({ fresh }) : { available: false, code: "unsupported" };
  return statusView({ preference, system, openai: transcriptionAvailable(provider), platform: dictation?.platform || process.platform });
}

export function statusView({ preference, system, openai, platform = process.platform }) {
  const mode = chooseMode(preference, system, openai);
  const problem = system?.available ? null : systemProblem(system?.code, platform);
  return {
    mode,
    preference,
    platform,
    system: { available: !!system?.available, engine: system?.engine || null, lang: system?.lang || null, onDevice: !!system?.onDevice, label: engineLabel(system, platform), code: system?.available ? null : system?.code || "failed" },
    openai,
    // The recognizer of the computer did not work: shown in Ajustes and, when nothing else
    // dictates, next to the microphone.
    problem: problem && (mode !== "sistema") ? problem : null,
    transcribe: mode === "openai",
    maxMs: MAX_AUDIO_MS,
  };
}

/** Routes: status, the preference, live system dictation (SSE) and OpenAI transcription. */
export function registerVoiceRoutes(app, { store, runtime, check, dictation = createDictation({ cacheDir: store?.directory ? path.join(store.directory, "helpers") : undefined }), openPage = openSystemPage }) {
  // The first probe (and on Windows, compiling the helper) happens before anyone presses the mic
  // (not under `node --test`, whose temporary data folders are gone by then).
  if (!process.env.NODE_TEST_CONTEXT) setTimeout(() => dictation.check().catch(() => {}), 1500).unref?.();
  app.get("/api/voice/status", async (req, res) => {
    res.json(await voiceStatus({ dictation, store, provider: runtime?.provider, fresh: req.query?.fresh === "1" }));
  });
  app.patch("/api/voice/settings", async (req, res) => {
    const { engine } = check(z.object({ engine: z.enum(PREFERENCES) }).strict(), req.body);
    store.patch("settings", "main", { dictation: engine });
    res.json(await voiceStatus({ dictation, store, provider: runtime?.provider }));
  });
  app.post("/api/voice/open-settings", (req, res) => {
    const { page } = check(z.object({ page: z.enum(["language", "microphone", "speech"]) }).strict(), req.body);
    const target = SETTINGS_PAGES[dictation.platform]?.[page];
    if (!target) throw Object.assign(Error("Este sistema no tiene esa página de ajustes."), { status: 404 });
    openPage(target, dictation.platform);
    res.json({ ok: true });
  });
  app.post("/api/voice/listen", async (_req, res) => {
    if (preferenceOf(store) === "openai") throw Object.assign(Error("El dictado está puesto con tu clave de OpenAI."), { status: 409 });
    const session = await dictation.start();
    res.json({ id: session.id, maxMs: MAX_AUDIO_MS });
  });
  app.get("/api/voice/listen/:id/events", (req, res) => {
    const session = dictation.get(req.params.id);
    if (!session) throw Object.assign(Error("Ese dictado ya terminó."), { status: 404 });
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive", "Cache-Control": "no-store" });
    res.flushHeaders?.();
    const send = (event) => res.write("data: " + JSON.stringify(publicEvent(event, dictation.platform)) + "\n\n");
    for (const event of session.events) send(event);
    if (session.done) return res.end();
    const on = (event) => {
      send(event);
      if (event.type === "end") res.end();
    };
    session.on("event", on);
    // Closing the page (or the composer) ends the dictation: nobody would see the words.
    req.on("close", () => {
      session.off("event", on);
      if (!session.done) session.cancel();
    });
  });
  app.post("/api/voice/listen/:id/stop", (req, res) => {
    const { cancel = false } = check(z.object({ cancel: z.boolean().optional() }).strict(), req.body || {});
    const session = dictation.get(req.params.id);
    if (session) cancel ? session.cancel() : session.stop();
    res.json({ ok: true });
  });
  app.post("/api/voice/transcribe", async (req, res) => {
    const data = check(z.object({ audio: z.string().min(16).max(1400000), mime: z.string().trim().min(3).max(120), durationMs: z.number().min(0).max(130000).optional() }).strict(), req.body);
    if (preferenceOf(store) === "sistema") throw Object.assign(Error("El dictado está puesto solo con el reconocimiento de este ordenador."), { status: 409 });
    res.json(await transcribe({ provider: runtime?.provider, ...data }));
  });
  return dictation;
}

/** Opens a system settings page (a fixed address from SETTINGS_PAGES). */
export function openSystemPage(target, platform = process.platform) {
  const [command, args] = platform === "win32" ? ["explorer.exe", [target]] : ["open", [target]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
  } catch {}
}
