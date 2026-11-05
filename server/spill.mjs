// Spill (DeepSeek Harness spill-local / spill-policy — MIT, ideas only): a tool output too big
// for the context is saved whole to a private file of the mission, and the model gets its
// head and tail plus where to read the rest with read_file, instead of the whole text.
// Files live in the mission folder under .colmena/ (never in its restore points:
// checkpoints.mjs EXCLUDED_DIRS) in one folder per step, named by a hash of the step id.
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { safePath } from "./files.mjs";
import { CONTEXT, estimateTokens, headOf, tailOf } from "./context.mjs";

export const SPILL_DIR = ".colmena/salidas";
const GAP = "\n\n[...]\n\n";

/** Folder (relative to the mission folder) of one step's spilled outputs. */
export const spillFolder = (sessionId) => SPILL_DIR + "/sesion-" + createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 12);
const safeName = (name) => String(name || "salida").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "salida";

/** Whether an output is big enough to spill (~12 500 tokens). */
export const shouldSpill = (output, maxTokens = CONTEXT.spillTokens) => typeof output === "string" && estimateTokens(output) > maxTokens;

/**
 * Writes `text` to a fresh file (created exclusively, owner-only where the OS allows it) in
 * the step's folder: {path (relative, for read_file), bytes}.
 */
export async function saveSpill(root, sessionId, tool, text) {
  const relative = spillFolder(sessionId) + "/" + randomBytes(6).toString("hex") + "-" + safeName(tool) + ".txt";
  await mkdir(path.join(root, ...spillFolder(sessionId).split("/")), { recursive: true, mode: 0o700 });
  // No link anywhere on the way (the same check read_file makes).
  const target = await safePath(root, relative);
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(String(text), "utf8");
  } finally {
    await handle.close();
  }
  return { path: relative, bytes: Buffer.byteLength(String(text), "utf8") };
}

/** What the model reads instead of a spilled output: its head, «[...]», its tail and where the rest is. */
export function spillPreview(text, relative, { maxChars = CONTEXT.spillTokens * CONTEXT.charsPerToken } = {}) {
  const note = `\n\n[Colmena guardó la salida completa (${text.length} caracteres) en «${relative}». Aquí tienes solo el principio y el final; si necesitas el resto, léelo con read_file (path «${relative}», por páginas) en vez de repetir la herramienta.]`;
  const room = Math.max(0, maxChars - note.length - GAP.length);
  const head = Math.floor(room * 0.7);
  return headOf(text, head) + GAP + tailOf(text, room - head) + note;
}

/**
 * The output the model gets for a tool result: the same string when it fits; when it does not
 * and it could be saved, the preview. A failed save keeps the original inline.
 */
export async function spillOutput(root, sessionId, tool, output, { maxTokens = CONTEXT.spillTokens } = {}) {
  if (!shouldSpill(output, maxTokens) || tool === "read_file") return output;
  try {
    const saved = await saveSpill(root, sessionId, tool, output);
    return spillPreview(output, saved.path, { maxChars: maxTokens * CONTEXT.charsPerToken });
  } catch {
    return output;
  }
}
