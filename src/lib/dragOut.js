import { failure } from "./undoToast.js";

// Dragging files out of Colmena into other apps (Explorer, Outlook, Word…), desktop app only:
// anything marked with data-drag-file="<the link it is served at>" — files in «Archivos»,
// what a bot made, your attachments, the changed files of a turn — and the pictures of
// deliverables and work files (also in the Lightbox). The desktop shell finds the file and
// checks it is in Colmena's working folders (desktop/dragout.cjs). In the browser nothing
// changes: links and pictures drag as they always did.

/** Links that point to a file on disk (server/dragout.mjs fileOfUrl). */
const LOCATABLE = /^(?:https?:\/\/[^/]+)?\/api\/(?:missions\/[^/]+\/workfiles\/raw\?|artifacts\/[^/]+\/(?:file|pdf)(?:[?#]|$))/;
export const isLocatable = (url) => LOCATABLE.test(String(url || ""));

export const canDragOut = () => typeof window !== "undefined" && !!window.colmenaWindow?.dragFile;

/** Props that make an element draggable out of Colmena (nothing in the browser). */
export function dragOutProps(url) {
  if (!url || !canDragOut()) return {};
  return { draggable: true, "data-drag-file": url };
}

/** The workfile link of a path of a chat's folder. */
export const workFileUrl = (missionId, path) => `/api/missions/${encodeURIComponent(missionId)}/workfiles/raw?path=${encodeURIComponent(path)}`;

function sourceOf(target) {
  const el = target?.closest?.("[data-drag-file]");
  if (el) return el.dataset.dragFile;
  // A picture or a «Descargar» link of a file.
  const img = target?.closest?.("img");
  const link = img ? null : target?.closest?.("a[href]");
  const url = img ? img.dataset.full || img.currentSrc || img.src : link ? link.href : null;
  if (!url) return null;
  try { const u = new URL(url, location.href); return u.origin === location.origin && isLocatable(u.pathname + u.search) ? u.pathname + u.search : null; } catch { return null; }
}

let installed = false;
/** Once, at start: a press warms the lookup, a drag hands the file to the system. */
export function installDragOut() {
  if (installed || !canDragOut()) return;
  installed = true;
  const api = window.colmenaWindow.dragFile;
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const url = sourceOf(e.target);
    if (url) api.warm(url);
  }, true);
  document.addEventListener("dragstart", (e) => {
    const url = sourceOf(e.target);
    if (!url) return;
    e.preventDefault();
    Promise.resolve(api.drag(url)).then((r) => {
      if (!r?.ok) failure("No se pudo arrastrar el archivo", r?.error || null);
    }, () => failure("No se pudo arrastrar el archivo"));
  }, true);
}
