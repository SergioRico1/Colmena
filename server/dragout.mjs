// Dragging a file out of Colmena (into Explorer, Outlook, Word…): the desktop shell asks
// where the file a link of the page points to is on disk, and checks the answer itself
// (desktop/dragout.cjs) before handing it to the system's drag and drop. Only files of the
// working folders resolve: a chat's or room's folder (its attachments and what the bots
// made) and the deliverables in them; nothing else of the data folder.
//
//   GET /api/files/locate?url=/api/missions/<id>/workfiles/raw?path=…  → {path, name, roots}
//   GET /api/files/locate?url=/api/artifacts/<id>/file                   (also …/pdf)
import path from "node:path";
import { lstat } from "node:fs/promises";
import { safePath } from "./files.mjs";

/** The folders a dragged file may come from: every chat's folder and the shared folders. */
export function dragRoots(store) {
  return [path.join(store.directory, "workspaces"), ...store.list("folders").map((f) => f.path).filter((p) => typeof p === "string" && path.isAbsolute(p))];
}

/** A URL of the page → {missionId, rel} of the file it serves, or null. */
export function fileOfUrl(store, url) {
  let u;
  try { u = new URL(String(url || ""), "http://colmena.local"); } catch { return null; }
  if (u.origin !== "http://colmena.local" && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u.origin)) return null;
  const work = /^\/api\/missions\/([^/]+)\/workfiles\/raw$/.exec(u.pathname);
  if (work) return { missionId: decodeURIComponent(work[1]), rel: u.searchParams.get("path") || "" };
  const art = /^\/api\/artifacts\/([^/]+)\/(file|pdf)$/.exec(u.pathname);
  if (art) {
    const a = store.get("artifacts", decodeURIComponent(art[1]));
    const rel = art[2] === "pdf" ? a?.pdf : a?.file || a?.workFile;
    if (!a?.missionId || typeof rel !== "string" || !rel) return null;
    return { missionId: a.missionId, rel };
  }
  return null;
}

export function registerDragRoutes(app, { store, rootOf, check, z }) {
  app.get("/api/files/locate", async (req, res) => {
    const url = check(z.string().trim().min(1).max(2000), String(req.query.url ?? ""));
    const found = fileOfUrl(store, url);
    const missing = () => res.status(404).json({ error: "Ese archivo no se puede arrastrar fuera de Colmena." });
    if (!found || !store.get("missions", found.missionId)) return missing();
    let target;
    try { target = await safePath(rootOf(found.missionId), found.rel); } catch { return missing(); }
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile() || info.nlink > 1) return missing();
    res.json({ path: target, name: path.basename(target), size: info.size, roots: dragRoots(store) });
  });
}
