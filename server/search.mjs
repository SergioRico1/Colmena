import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { missionRoom, MISSION_LABELS } from "./state.mjs";

// Palette search: accent- and case-insensitive, at most 8 results per group.
const LIMIT = 8;
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function snippet(text, query, width = 140) {
  const plain = String(text || "").replace(/\s+/g, " ").trim();
  const at = fold(plain).indexOf(query);
  if (at < 0) return plain.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return (start > 0 ? "…" : "") + plain.slice(start, start + width) + (start + width < plain.length ? "…" : "");
}

async function missionFiles(root, mission, query, out) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= LIMIT) return;
    if (!e.isFile() || !fold(e.name).includes(query)) continue;
    let size = null;
    try {
      size = (await stat(path.join(root, e.name))).size;
    } catch {}
    out.push({ missionId: mission.id, missionTitle: mission.title, room: missionRoom(mission), name: e.name, size });
  }
}

/** Returns { bots, missions, artifacts, files, messages }. `rootOf(missionId)` locates mission files. */
export async function search(store, q, { rootOf = null } = {}) {
  const query = fold(q).trim();
  const empty = { bots: [], missions: [], artifacts: [], files: [], messages: [] };
  if (!query) return empty;
  const has = (...values) => values.some((v) => fold(v).includes(query));
  const missions = store.list("missions").sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  const byId = new Map(missions.map((m) => [m.id, m]));
  const result = { ...empty };
  result.bots = store
    .list("bots")
    .filter((b) => has(b.name, b.role))
    .slice(0, LIMIT)
    .map((b) => ({ id: b.id, name: b.name, role: b.role, color: b.color, shape: b.shape, enabled: b.enabled }));
  result.missions = missions
    .filter((m) => has(m.title, m.prompt, missionRoom(m)))
    .slice(0, LIMIT)
    .map((m) => ({ id: m.id, title: m.title, room: missionRoom(m), status: m.status, statusLabel: MISSION_LABELS[m.status] || m.status, conversation: !!m.conversation, updatedAt: m.updatedAt || m.createdAt }));
  result.artifacts = store
    .columns("artifacts", ["id", "title", "missionId", "kind", "format", "content", "createdAt"])
    .filter((a) => has(a.title, a.content))
    .reverse()
    .slice(0, LIMIT)
    .map((a) => ({ id: a.id, title: a.title, missionId: a.missionId, kind: a.kind, format: a.format, snippet: snippet(a.content, query), createdAt: a.createdAt }));
  result.messages = store
    .columns("messages", ["id", "missionId", "botId", "role", "text", "at"])
    .filter((m) => m.role !== "system" && has(m.text))
    .reverse()
    .slice(0, LIMIT)
    .map((m) => ({ id: m.id, missionId: m.missionId, missionTitle: byId.get(m.missionId)?.title ?? null, botId: m.botId ?? null, role: m.role, snippet: snippet(m.text, query), at: m.at }));
  if (rootOf) for (const m of missions.slice(0, 200)) {
    if (result.files.length >= LIMIT) break;
    await missionFiles(rootOf(m.id), m, query, result.files);
  }
  return result;
}
