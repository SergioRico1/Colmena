import { post } from "../../../../lib/api.js";
import { navigate } from "../../../../lib/router.jsx";
import { noteUrl } from "../../../../lib/wikiLinks.js";

// What several places of «Notas» do the same way.

/**
 * Creates the note with that title and opens it to write. A note with that name already
 * there (409) is opened instead, as it is. Throws what else goes wrong.
 */
export async function createNote(title, { body = "" } = {}) {
  try {
    const page = await post("/wiki/pages", { title, ...(body ? { body } : {}) });
    navigate(noteUrl(page.slug, "editar"), { force: true });
    return page;
  } catch (e) {
    const slug = e.status === 409 ? e.data?.details?.slug : null;
    if (!slug) throw e;
    navigate(noteUrl(slug), { force: true });
    return null;
  }
}

/** The files of a picked folder or zip → the `source` of POST /api/wiki/import, and what stayed out. */
const MARKDOWN = /\.(md|markdown)$/i;
export const IMPORT_MAX = { file: 1024 * 1024, zip: 25 * 1024 * 1024, notes: 2000 };

export async function sourceOfFolder(files) {
  const all = [...files].map((f) => ({ f, path: String(f.webkitRelativePath || f.name).replace(/\\/g, "/") }));
  // Everything hangs from the picked folder: that first part is not a folder of the notes.
  const top = all.length && all.every((x) => x.path.includes("/")) ? all[0].path.split("/")[0] + "/" : "";
  const strip = top && all.every((x) => x.path.startsWith(top)) ? top.length : 0;
  const out = [], left = { attachments: 0, big: [] };
  for (const { f, path } of all) {
    const rel = path.slice(strip);
    if (!MARKDOWN.test(rel)) { if (!rel.split("/").some((p) => p.startsWith("."))) left.attachments++; continue; }
    if (f.size > IMPORT_MAX.file) { left.big.push(rel); continue; }
    out.push({ path: rel, content: await f.text() });
  }
  if (out.length > IMPORT_MAX.notes) throw Error(`Hay demasiadas notas para traerlas de una vez (máx. ${IMPORT_MAX.notes}). Tráelas por carpetas.`);
  if (!out.length) throw Error("En esa carpeta no hay notas en Markdown (.md).");
  return { source: { type: "files", files: out }, left };
}
export async function sourceOfZip(file) {
  if (file.size > IMPORT_MAX.zip) throw Error("El zip es demasiado grande (máx. 25 MB).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { source: { type: "zip", data: btoa(binary), name: file.name.slice(0, 200) }, left: { attachments: 0, big: [] } };
}
