import { createUniqueFile } from "./files.mjs";

// Real images for design bots through the native {type:"image_generation"} tool of the
// Responses API, as OpenClaw does with a ChatGPT/Codex account
// (extensions/openai/image-generation-provider.ts + image-generation-codex-response.ts, MIT:
// licenses/OpenClaw.txt). The PNG lives in the mission folder; the artifact stores its path.

export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"];
export const IMAGES_UNSUPPORTED = "Tu plan no permite crear imágenes desde Colmena.";
export const IMAGE_CODE = "COLMENA_IMAGES_UNSUPPORTED";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Every bot can create an image when you ask (with your ChatGPT account), whatever its role:
 * a team without a designer should not hear «no puedo». Off per bot with capabilities.imagenes === false.
 */
export function canCreateImages(bot) {
  if (!bot) return false;
  return bot.capabilities?.imagenes !== false && bot.tools?.imagenes !== false;
}

export function imageUnsupported(message = IMAGES_UNSUPPORTED) {
  return Object.assign(Error(message), { code: IMAGE_CODE });
}

/** {width, height} from the IHDR chunk; throws if the bytes are not a PNG. */
export function pngInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString("latin1", 12, 16) !== "IHDR")
    throw Error("OpenAI no devolvió una imagen PNG válida.");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Strict base64 → bytes (no whitespace inside, canonical padding). */
export function decodeImage(base64) {
  if (typeof base64 !== "string" || !base64 || base64.length > 48 * 1024 * 1024) throw Error("La imagen recibida no es válida.");
  const clean = base64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw Error("La imagen recibida no es válida.");
  const bytes = Buffer.from(clean, "base64");
  if (bytes.toString("base64") !== clean) throw Error("La imagen recibida no es válida.");
  return bytes;
}

/**
 * Asks the provider for one image and saves it as imagenes/<titulo>.png in the mission
 * folder. `onPhase(text)` reports «Preparando», «Dibujando», «Guardando».
 * Returns {path, bytes, width, height, size, revisedPrompt}.
 */
export async function createImage(provider, { root, model, prompt, size, title, signal, onPhase = () => {} }) {
  if (!IMAGE_SIZES.includes(size)) throw Error("Tamaño no admitido: usa 1024x1024, 1536x1024 o 1024x1536.");
  if (typeof provider?.generateImage !== "function") throw imageUnsupported();
  onPhase("Preparando");
  const result = await provider.generateImage({ model, prompt, size, signal, onPhase });
  const bytes = Buffer.isBuffer(result?.png) ? result.png : decodeImage(result?.base64);
  const { width, height } = pngInfo(bytes);
  onPhase("Guardando");
  const saved = await createUniqueFile(root, "imagenes", title, "png", bytes);
  return { path: saved.path, bytes: bytes.length, width, height, size, revisedPrompt: result?.revisedPrompt || null, usage: result?.usage || null };
}
