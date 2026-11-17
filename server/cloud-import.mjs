// «Traer las conversaciones de la nube»: a company's export from hosted Colmena (Administración ›
// Exportar, format colmena-export-1: server/cloud/chat.mjs › exportEntries) brought into this
// computer. Each channel and direct conversation becomes a private room here with its whole
// history — who said what and when, threads as replies, files in the room's folder — and nobody
// is asked to work: the rooms are made idle. Bringing the same export again adds only what is new.
// Every person can bring it into their own computer: «yo» is whoever they say they were there.
import JSZip from "jszip";
import { writeMissionAttachments } from "./files.mjs";

export class ImportError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

const LIMITS = { channels: 500, messages: 200000, fileBytes: 25 * 1024 * 1024 };

/** The export's parts: {workspace, members, channels, messagesOf(channelId), fileOf(id)}. */
export async function readExport(bytes) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new ImportError("No es un ZIP que se pueda abrir."); }
  const json = async (name) => { const f = zip.file(name); if (!f) return null; try { return JSON.parse(await f.async("string")); } catch { throw new ImportError("El archivo «" + name + "» del ZIP está dañado."); } };
  const workspace = await json("workspace.json");
  if (workspace?.format !== "colmena-export-1") throw new ImportError("No es una exportación de Colmena en la nube (Administración › Exportar).");
  const people = (await json("people.json")) || {};
  const channels = ((await json("channels.json")) || []).slice(0, LIMITS.channels);
  const names = Object.keys(zip.files);
  const folders = new Map();
  for (const n of names) {
    const m = /^(.*)\/messages-\d{4}\.json$/.exec(n);
    if (m) folders.set(m[1], [...(folders.get(m[1]) || []), n].sort());
  }
  // Each channel's folder ends with its id (exportEntries › folder).
  const folderOf = (id) => [...folders.keys()].find((f) => f.endsWith(id) || f.includes(id));
  const messagesOf = async (id) => {
    const out = [];
    for (const n of folders.get(folderOf(id)) || []) out.push(...((await json(n)) || []));
    return out.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  };
  const fileOf = async (id) => {
    const n = names.find((x) => x.startsWith("files/" + id + "-"));
    return n ? { name: n.slice(("files/" + id + "-").length), bytes: await zip.file(n).async("nodebuffer") } : null;
  };
  return { workspace, members: [...(people.members || []), ...(people.ghosts || [])], channels, messagesOf, fileOf };
}

/** A stored message of the cloud (Slack's format) as the Markdown the rooms draw and bots read. */
export function cloudText(text, nameOf) {
  return String(text || "")
    .replace(/<@([^>]+)>/g, (_, id) => "@" + nameOf(id))
    .replace(/<#[^>|]+\|([^>]*)>/g, (_, label) => "#" + label)
    .replace(/<#[^>]+>/g, "#canal")
    .replace(/<!(?:channel|everyone)>/g, "@canal").replace(/<!here>/g, "@aquí")
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]*)>/g, "[$2]($1)").replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
    // *negrita* → **negrita**, ~tachado~ → ~~tachado~~ (at word edges, as the cloud drew them).
    .replace(/(^|[\s(«"'¡¿])\*([^*\n]+)\*(?=[\s).,;:!?»"']|$)/g, "$1**$2**")
    .replace(/(^|[\s(«"'¡¿])~([^~\n]+)~(?=[\s).,;:!?»"']|$)/g, "$1~~$2~~")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** What the export holds, for the screen that asks who you were: {company, members, channels}. */
export async function previewExport(bytes) {
  const x = await readExport(bytes);
  const nameOf = (id) => x.members.find((p) => p.id === id)?.name || "Alguien";
  const channels = [];
  for (const c of x.channels) channels.push({ id: c.id, kind: c.kind, title: titleOf(c, nameOf), messages: (await x.messagesOf(c.id)).length });
  return { company: x.workspace.name || "Colmena en la nube", exportedAt: x.workspace.exportedAt || null, members: x.members.filter((p) => !p.ghost).map((p) => ({ id: p.id, name: p.name })), channels };
}

function titleOf(c, nameOf, me = null) {
  if (c.kind === "public" || c.kind === "private") return c.name || "canal";
  if (c.kind === "chat") return "Chat con " + (c.name || "un bot");
  const others = (c.members || c.people || []).filter((p) => p !== me).map(nameOf);
  return others.length ? others.join(", ") : "Notas";
}

/**
 * Brings the export in. `me`: your id in it (your messages read «Tú»). Returns {company, rooms:
 * [{roomId, title, added, kept}], files, skipped}.
 */
export async function importExport(bytes, { store, rooms, runtime, me = null }) {
  const x = await readExport(bytes);
  const people = new Map(x.members.map((p) => [p.id, p]));
  const nameOf = (id) => (String(id).startsWith("bot:") ? cap(String(id).slice(4)) : people.get(id)?.name || "Alguien");
  const company = x.workspace.name || "la nube";
  const out = { company, rooms: [], files: 0, skipped: [] };
  let total = 0;
  for (const c of x.channels) {
    const key = "nube:" + (x.workspace.id || company) + ":" + c.id;
    const title = (c.kind === "public" || c.kind === "private" ? "#" : "") + titleOf(c, nameOf, me) + " · " + company;
    // The room made the first time; found again on the next import.
    let room = null;
    try { room = store.get("cloudImports", key) ? rooms.detail(store.get("cloudImports", key).roomId) : null; } catch { room = null; } // removed here since
    if (!room) {
      room = rooms.create({ title: title.slice(0, 60) });
      store.put("cloudImports", { id: key, roomId: room.id, missionId: room.missionId || room.mission?.id || null, at: new Date().toISOString() });
    }
    const missionId = store.get("cloudImports", key).missionId || store.get("rooms", room.id)?.missionId;
    if (!missionId) { out.skipped.push(title); continue; }
    const root = runtime.root(missionId);
    let added = 0, kept = 0;
    for (const m of await x.messagesOf(c.id)) {
      if (++total > LIMITS.messages) break;
      const id = "nube:" + m.id;
      if (store.get("messages", id)) { kept++; continue; }
      const bot = String(m.author || "").startsWith("bot:");
      const mine = !bot && me && m.author === me;
      const name = m.botName || nameOf(m.author);
      const attachments = [];
      for (const f of m.files || []) {
        const got = f.id ? await x.fileOf(f.id) : null;
        if (!got || got.bytes.length > LIMITS.fileBytes) { if (f.name) out.skipped.push(f.name); continue; }
        try { attachments.push(...await writeMissionAttachments(root, [{ name: f.name || got.name, content: got.bytes.toString("base64"), encoding: "base64" }])); out.files++; }
        catch { out.skipped.push(f.name || got.name); }
      }
      const poll = m.poll ? "\n\n📊 " + m.poll.question + "\n" + (m.poll.options || []).map((o) => "· " + o.text + (o.count != null ? " (" + o.count + ")" : "")).join("\n") : "";
      const text = (m.format === "md" ? String(m.text || "") : cloudText(m.text, nameOf)) + poll;
      store.put("messages", {
        id, missionId, kind: "message", text: text || (attachments.length ? "" : "(mensaje sin texto)"), attachments,
        at: new Date(m.at || Date.now()).toISOString(), imported: "colmena-nube",
        ...(m.threadId && m.threadId !== m.id ? { replyTo: "nube:" + m.threadId } : {}),
        ...(mine ? { role: "user" }
          : bot ? { role: "assistant", botId: store.get("bots", String(m.author).slice(4)) ? String(m.author).slice(4) : null, author: { kind: "bot", name, botId: null, owner: { address: null, name: company, you: false } } }
          : { role: "user", author: { kind: "person", name, address: null, color: people.get(m.author)?.color || null } }),
      });
      added++;
    }
    out.rooms.push({ roomId: room.id, missionId, title, added, kept });
  }
  return out;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
