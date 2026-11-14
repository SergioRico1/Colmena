// Files that ship with the server (prompts/, skills): read from the app folder on the desktop,
// from a map the cloud build bundles in (cloud/scripts/gen-assets.mjs) where there is no app
// folder. Also the safe way to find a file next to a module: in workerd `import.meta.url` is not
// a file URL, so `new URL(relative, import.meta.url)` at module scope stopped the whole bundle.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundled = new Map(); // "prompts/SOUL.colmena.md" → text

/** The cloud build registers the app's text files here, before any module reads them. */
export function bundleFiles(files) {
  for (const [name, text] of Object.entries(files || {})) bundled.set(name.replace(/\\/g, "/"), String(text));
}

/** A path next to a module (`import.meta.url`), or null where modules are not files (workerd). */
export function modulePath(relative, base) {
  try {
    const url = new URL(relative, base);
    return url.protocol === "file:" ? fileURLToPath(url) : null;
  } catch {
    return null;
  }
}

const ROOT = modulePath("..", import.meta.url);
/** The app folder (where package.json is), or null in the cloud. */
export const appRoot = () => ROOT;

/** A text file of the app, by its path from the app folder ("prompts/USER.colmena.md"). */
export function appFile(relative) {
  const key = relative.replace(/\\/g, "/");
  if (bundled.has(key)) return bundled.get(key);
  if (!ROOT) throw Error("Archivo de la aplicación no disponible: " + key);
  return readFileSync(path.join(ROOT, key), "utf8");
}

/** The names of the files in a folder of the app ("prompts/skills/"), sorted. */
export function appFileNames(folder) {
  const prefix = folder.replace(/\\/g, "/").replace(/\/?$/, "/");
  const names = [...bundled.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => k.slice(prefix.length));
  if (names.length || !ROOT) return names.sort();
  try {
    return readdirSync(path.join(ROOT, prefix)).sort();
  } catch {
    return [];
  }
}
