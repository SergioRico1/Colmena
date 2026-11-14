// «Llevar mis datos a la nube» (docs/CLOUD.md › Phase 5): the bots, their SOULs, memory and skills,
// routines, conversations and rooms of a local install, uploaded into the person's workspace
// through their approved computer's agent link.
//
// - Secrets never travel: provider logins and API keys, the vault, password-manager logins,
//   MCP servers, grants, folders and paths, browser sessions, the mailbox and its peers stay
//   on the computer (they are not in KINDS), and any record field that looks like one is dropped.
//   The person enters their API keys again in the cloud.
// - Idempotent: every record keeps its id and a ledger row per (install, kind, id) keeps the hash
//   of what was imported. The same upload again changes nothing; a changed record updates only
//   what this import made; a record the workspace already had for itself is never overwritten
//   (a seeded bot keeps the cloud's version and receives the memories that name it).
// - Private by default: imported conversations are seen only by the person who brought them, and
//   messages only join conversations that person brought; routines arrive paused, owned by them;
//   skills (which shape every bot of the company) arrive switched off.
import { containsSecret } from "../memory.mjs";
import { canonical, sha256Hex } from "./protocol.mjs";

export const MIGRATION_KINDS = Object.freeze(["bots", "skills", "memories", "goals", "automations", "missions", "rooms", "messages", "wikiPages"]);
export const LEDGER = "importLedger";
export const BATCH_CHARS = 350_000;
const MAX_RECORD_CHARS = 200_000;
/** Fields that only make sense on the computer, or could hold a secret. */
const DROP = new Set(["apiKey", "token", "password", "secret", "secrets", "vault", "grants", "browserSession", "profile", "folders", "folderIds", "cwd", "path", "peer", "peerErrand", "share", "relay", "mailbox", "credentials", "env", "authorization"]);
const SECRETISH = /^(sk-|sk_|ghp_|gho_|xox[abp]-|AKIA|AIza)[A-Za-z0-9_-]{8,}/;

function scrub(value, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === "string") return SECRETISH.test(value.trim()) ? "" : value;
  if (Array.isArray(value)) return value.slice(0, 2000).map((v) => scrub(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (!DROP.has(k)) out[k] = scrub(v, depth + 1);
  return out;
}

/** What one kind keeps of a local record before it leaves the computer (null: it does not go). */
export function exportable(kind, record) {
  if (!record || typeof record !== "object" || typeof record.id !== "string") return null;
  if (kind === "memories" && (record.active === false || containsSecret(String(record.text || "")))) return null;
  if (kind === "missions" && (record.incognito || record.peerErrand || record.dm)) return null;
  if (kind === "messages" && (record.incognito || record.private)) return null;
  const out = scrub(record);
  return JSON.stringify(out).length > MAX_RECORD_CHARS ? null : out;
}

/**
 * The local store's data in upload batches ({kind, records}), in an order that keeps references
 * whole (bots before their memories, conversations before their messages). `kinds` narrows it.
 */
export function exportBatches(store, { kinds = MIGRATION_KINDS, maxChars = BATCH_CHARS } = {}) {
  const batches = [];
  const counts = {};
  const incognito = new Set(store.list("missions").filter((m) => m.incognito || m.peerErrand || m.dm).map((m) => m.id));
  for (const kind of MIGRATION_KINDS) {
    if (!kinds.includes(kind)) continue;
    let records = [], size = 0;
    counts[kind] = 0;
    for (const r of store.list(kind)) {
      if (kind === "messages" && incognito.has(r.missionId)) continue;
      if (kind === "rooms" && incognito.has(r.missionId)) continue;
      const clean = exportable(kind, r);
      if (!clean) continue;
      const n = JSON.stringify(clean).length;
      if (records.length && size + n > maxChars) { batches.push({ kind, records }); records = []; size = 0; }
      records.push(clean);
      size += n;
      counts[kind]++;
    }
    if (records.length) batches.push({ kind, records });
  }
  return { batches, counts };
}

/**
 * One batch into the workspace, as `person`. Returns {created, updated, unchanged, skipped}.
 * `installId`: the local install the data comes from (a random id it keeps).
 */
export async function importBatch(store, person, { installId, kind, records } = {}) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(installId || ""))) throw Object.assign(Error("Falta el identificador de esta instalación."), { status: 400 });
  if (!MIGRATION_KINDS.includes(kind)) throw Object.assign(Error("Ese tipo de datos no se puede llevar a la nube."), { status: 400 });
  if (!Array.isArray(records) || records.length > 5000) throw Object.assign(Error("Lote no válido."), { status: 400 });
  const at = new Date().toISOString();
  const out = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  const rows = [];
  for (const raw of records) {
    const record = exportable(kind, raw);
    if (!record) { out.skipped++; continue; }
    rows.push({ record, hash: await sha256Hex(canonical(record)) });
  }
  store.tx(() => {
    for (const { record, hash } of rows) {
      const key = installId + ":" + kind + ":" + record.id;
      const ledger = store.get(LEDGER, key);
      if (ledger?.hash === hash) { out.unchanged++; continue; }
      // Messages and rooms only join a conversation this person brought (never someone else's).
      if ((kind === "messages" || kind === "rooms") && store.get("missions", record.missionId)?.importedBy !== person.id) { out.skipped++; continue; }
      const existing = store.get(kind, record.id);
      const ours = existing && existing.importedFrom === installId && existing.importedBy === person.id;
      if (existing && !ours) {
        // The workspace's own record (a seeded bot, someone else's import): never overwritten.
        store.put(LEDGER, { id: key, installId, kind, recordId: record.id, hash, at, personId: person.id, kept: true }, { silent: true });
        out.skipped++;
        continue;
      }
      store.put(kind, shape(kind, record, person, installId, existing), { silent: true });
      store.put(LEDGER, { id: key, installId, kind, recordId: record.id, hash, at, personId: person.id }, { silent: true });
      if (existing) out.updated++; else out.created++;
    }
  });
  if (out.created || out.updated) for (const fn of store.listeners) try { fn({ type: "changed-local", kinds: [kind] }); } catch {}
  return out;
}

/** How a local record lives in the workspace: whose it is and who sees it. */
function shape(kind, record, person, installId, existing) {
  const mark = { importedFrom: installId, importedBy: person.id, importedAt: existing?.importedAt || new Date().toISOString() };
  if (kind === "missions") return { ...record, ...mark, audience: [person.id], askedBy: person.id, createdBy: person.id, ...(["running", "queued", "planning"].includes(record.status) ? { status: "paused" } : {}) };
  if (kind === "automations") return { ...record, ...mark, ownerId: person.id, enabled: false, importedPaused: true, approver: null, queue: [] };
  if (kind === "bots") return { ...record, ...mark, createdBy: person.id };
  // Skills shape every bot of the company: they arrive switched off until someone turns them on.
  if (kind === "skills") return { ...record, ...mark, status: "disabled", importedDisabled: true };
  return { ...record, ...mark };
}

/** What an import left in the workspace for a person (for the summary on the screen). */
export function importSummary(store, person, installId) {
  const counts = {};
  for (const l of store.list(LEDGER)) if (l.personId === person.id && l.installId === installId && !l.kept) counts[l.kind] = (counts[l.kind] || 0) + 1;
  return counts;
}
