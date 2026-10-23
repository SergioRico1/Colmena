// Versions of the documents that shape a bot and what it knows of you: each bot's SOUL.md
// and the person's USER.md. Every write keeps the text it leaves behind, so any earlier
// version can be seen and restored (a restore is one more version: nothing is lost).
// records 'docVersions': {id, doc: 'soul'|'user', botId, content, hash, source, reason, approvalId, createdAt}
import { createHash } from "node:crypto";
import { id, now } from "./store.mjs";

export const DOC_SOURCES = Object.freeze({
  inicial: "Como era al principio",
  "tú": "Lo editaste tú",
  propuesta: "Propuesta aprobada",
  "condensación": "Lo resumió Colmena",
  restaurado: "Restaurado",
});
const KEEP = 30;
const hashOf = (text) => createHash("sha256").update(String(text ?? "")).digest("hex");

/** Versions of a document, newest first; the first one is the current text. */
export function listVersions(store, doc, botId = null) {
  return store.list("docVersions")
    .filter((v) => v.doc === doc && (v.botId ?? null) === (botId ?? null))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || (b.seq || 0) - (a.seq || 0));
}

/**
 * Records a write: the text that was there before becomes the «inicial» version the first
 * time, then the new text. Writing the same text again records nothing. Keeps the last 30.
 */
export function recordVersion(store, { doc, botId = null, content, previous = null, source = "tú", reason = null, approvalId = null }) {
  if (!store || !["soul", "user"].includes(doc)) return null;
  const list = listVersions(store, doc, botId);
  const at = now();
  let seq = (list[0]?.seq || 0) + 1;
  if (!list.length && previous != null && String(previous).trim() && hashOf(previous) !== hashOf(content))
    store.put("docVersions", { id: id(), doc, botId, content: String(previous), hash: hashOf(previous), source: "inicial", reason: null, approvalId: null, createdAt: at, seq: seq++ });
  if (list[0]?.hash === hashOf(content)) return list[0];
  const version = store.put("docVersions", {
    id: id(), doc, botId, content: String(content), hash: hashOf(content), source: DOC_SOURCES[source] ? source : "tú",
    reason: reason ? String(reason).replace(/\s+/g, " ").trim().slice(0, 300) : null, approvalId, createdAt: at, seq,
  });
  for (const old of listVersions(store, doc, botId).slice(KEEP)) store.remove("docVersions", old.id);
  return version;
}

/** Versions for the UI: newest first, with labels and which one is in use. */
export function versionsView(store, doc, botId = null) {
  return listVersions(store, doc, botId).map((v, i) => ({
    id: v.id, source: v.source, sourceLabel: DOC_SOURCES[v.source] || v.source, reason: v.reason ?? null,
    createdAt: v.createdAt, chars: String(v.content).length, content: v.content, current: i === 0,
  }));
}
