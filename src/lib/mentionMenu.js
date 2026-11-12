// What the composer's «@» menu lists (pure, for Mentions.jsx and the tests): bots as before,
// the files and folders of the conversation's working folder (one folder at a time, or a
// search over all of them while you type), and past conversations and rooms. A group that
// could not be loaded (null) is simply not there; the others still are.

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const MENTION_LIMITS = Object.freeze({ bots: 6, files: 8, chats: 5, refs: 6 });

/** The folders and files right inside `dir` of a flat [{path}] list (folders first). */
export function folderView(files = [], dir = "") {
  const folders = new Map();
  const here = [];
  const prefix = dir ? dir + "/" : "";
  for (const f of files || []) {
    const p = String(f?.path || "");
    if (!p || (prefix && !p.startsWith(prefix))) continue;
    const rest = p.slice(prefix.length);
    const cut = rest.indexOf("/");
    if (cut < 0) { here.push({ path: p, name: rest, size: f.size ?? null }); continue; }
    const name = rest.slice(0, cut);
    const entry = folders.get(name) || { path: prefix + name, name, count: 0 };
    entry.count++;
    folders.set(name, entry);
  }
  return { folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, "es")), files: here };
}

/** Every folder of a flat [{path}] list (for the search). */
function allFolders(files) {
  const out = new Map();
  for (const f of files || []) {
    const parts = String(f?.path || "").split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (!out.has(p)) out.set(p, { path: p, name: parts[i - 1] });
    }
  }
  return [...out.values()];
}

/** Past conversations and rooms you can point at: never this one, never a private one. */
export function chatsFrom(missions = [], exclude = null) {
  return (missions || [])
    .filter((m) => m && m.id !== exclude && !m.incognito && !m.archived && (m.conversation || m.room))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .map((m) => ({ id: m.id, title: String(m.title || (m.room ? "#" + m.room : "") || "Conversación"), room: !!m.room && !m.conversation && m.kind !== "tarea" }));
}

/**
 * The menu as a flat list: {type: "head"} lines and the items you can pick — «bot», «file»,
 * «folder» (opens it), «here» (the open folder itself), «up» and «chat».
 */
export function mentionItems({ query = "", bots = [], files = null, chats = null, dir = "", who = null } = {}) {
  const q = fold(query);
  const out = [];
  // Inside a folder only its files show; with nothing typed yet each group keeps to a few,
  // so all three fit on screen.
  const few = !q && !dir;
  const limit = (name) => (few ? Math.min(MENTION_LIMITS[name], 4) : MENTION_LIMITS[name]);
  const group = (label, items) => { if (items.length) out.push({ type: "head", key: "head:" + label, label }, ...items); };
  // In a room with people «@» lists who is there, in groups (lib/roomView.js › mentionGroups):
  // your bots, the people, each owner's bots. They replace the plain «Bots» group.
  if (!dir && Array.isArray(who)) for (const g of who) group(g.label, g.items);
  else if (!dir) group("Bots", (bots || []).filter((b) => fold(b.name).startsWith(q)).slice(0, limit("bots")).map((bot) => ({ type: "bot", key: "bot:" + bot.id, bot })));
  if (Array.isArray(files)) {
    if (q) {
      const hits = [
        ...allFolders(files).filter((f) => fold(f.name).includes(q)).map((f) => ({ type: "folder", key: "folder:" + f.path, path: f.path, name: f.name })),
        ...files.filter((f) => fold(f.name || String(f.path).split("/").pop()).includes(q)).map((f) => ({ type: "file", key: "file:" + f.path, path: f.path, name: f.name || String(f.path).split("/").pop() })),
      ];
      group("Archivos", hits.slice(0, MENTION_LIMITS.files));
    } else {
      const view = folderView(files, dir);
      const nav = dir ? [
        { type: "up", key: "up:" + dir, path: dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "" },
        { type: "here", key: "here:" + dir, path: dir, name: dir.split("/").pop() },
      ] : [];
      const entries = [
        ...view.folders.map((f) => ({ type: "folder", key: "folder:" + f.path, path: f.path, name: f.name, count: f.count })),
        ...view.files.map((f) => ({ type: "file", key: "file:" + f.path, path: f.path, name: f.name })),
      ].slice(0, dir ? MENTION_LIMITS.files : limit("files"));
      group(dir ? "Archivos · " + dir : "Archivos", dir || entries.length ? [...nav, ...entries] : []);
    }
  }
  if (Array.isArray(chats) && !dir) group("Conversaciones", chats.filter((c) => !q || fold(c.title).includes(q)).slice(0, limit("chats")).map((chat) => ({ type: "chat", key: "chat:" + chat.id, chat })));
  return out;
}

/** What a pick sends with the message ({kind, path} or {kind, id}). */
export const refBody = (refs = []) => refs.map((r) => (r.kind === "chat" ? { kind: "chat", id: r.id } : { kind: r.kind, path: r.path }));
