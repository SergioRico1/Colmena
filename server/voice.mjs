// Dictation fallback: when the browser's Web Speech API is missing or does not work
// (Electron has no speech service), the SPA records audio with MediaRecorder and sends it
// here. It is transcribed with OpenAI's transcription endpoint ONLY when an OpenAI API key
// is configured (Ajustes › Cuentas de IA); otherwise transcription is unavailable and the
// microphone button is not shown. Audio is never stored.

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
