import { parseDocument } from "yaml";
import { createHash } from "node:crypto";
import { id, now } from "./store.mjs";
import { forget } from "./forgotten.mjs";

// SKILL.md in the agentskills.io / VoltAgent shape: YAML frontmatter with
// name, description and optional metadata, followed by Markdown. Importing is
// text only: nothing is installed or executed and no permission is granted.
const ORIGINS = new Set(["learned", "imported", "shared"]);

function plain(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value === null || ["string", "number", "boolean"].includes(typeof value))
    return typeof value === "string" ? value.slice(0, 500) : value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => plain(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) out[String(k).slice(0, 60)] = plain(v, depth + 1);
    return out;
  }
  return undefined;
}

/** Parses frontmatter and counts numbered steps. Throws on unsafe or invalid YAML. */
export function parseSkill(content) {
  if (typeof content !== "string" || content.length > 60000 || content.length < 20)
    throw Error("La habilidad debe contener entre 20 y 60000 caracteres.");
  const front = content.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let data = {};
  if (front) {
    const doc = parseDocument(front[1], { uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) throw Error("Cabecera YAML no valida.");
    data = doc.toJS({ maxAliasCount: 0 });
    if (!data || Array.isArray(data) || typeof data !== "object")
      throw Error("La cabecera debe ser un objeto YAML.");
  }
  const body = front ? content.slice(front[0].length) : content;
  const name = String(data.name || body.match(/^#\s+(.+)$/m)?.[1] || "Nueva habilidad").trim().slice(0, 100);
  const description = String(
    data.description || body.replace(/^#.*$/gm, "").trim().split(/\r?\n\r?\n/)[0] || "Procedimiento reutilizable",
  ).replace(/\s+/g, " ").trim().slice(0, 300);
  const steps = (body.match(/^\s*\d+[.)]\s+\S/gm) || []).length;
  const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? plain(data.metadata) : null;
  return { name, description, steps, metadata, license: data.license ? String(data.license).slice(0, 100) : null };
}

const sameOwner = (a, b) => (a.botId || null) === (b.botId || null);

export function importSkill(
  store,
  {
    content,
    source = "Importacion local",
    missionId = null,
    botId = null,
    origin = "imported",
    learnedFrom = null,
    previous = undefined,
    status = "pending",
  },
) {
  const parsed = parseSkill(content);
  const hash = createHash("sha256").update(content).digest("hex");
  const all = store.list("skills");
  const duplicate = all.find((s) => s.hash === hash && sameOwner(s, { botId }));
  if (duplicate) return duplicate;
  const versions = all
    .filter((s) => s.name === parsed.name && sameOwner(s, { botId }))
    .sort((a, b) => (b.version || 0) - (a.version || 0));
  const prior = previous === undefined ? versions[0] || null : previous ? store.get("skills", previous) : null;
  return store.put("skills", {
    id: id(),
    name: parsed.name,
    description: parsed.description,
    content,
    source: String(source).slice(0, 500),
    missionId,
    botId,
    hash,
    origin: ORIGINS.has(origin) ? origin : "imported",
    version: (versions[0]?.version || 0) + 1,
    previous: prior?.id || null,
    steps: parsed.steps,
    metadata: parsed.metadata,
    license: parsed.license,
    learnedFrom,
    status: ["pending", "active", "disabled"].includes(status) ? status : "pending",
    createdAt: now(),
    uses: 0,
    pinned: false,
    lastUsedAt: null,
  });
}

export const SKILL_STATUSES = ["pending", "active", "disabled", "stale", "archived"];

/**
 * Activating a version disables every other active (or stale) version with the same
 * name and owner. Activation (also «Reactivar» of a stale/archived skill) restarts the
 * curator clock through `activatedAt`.
 */
export function activateSkill(store, skillId, status) {
  const skill = store.get("skills", skillId);
  if (!skill) throw Error("Habilidad no encontrada.");
  if (!["active", "disabled", "pending"].includes(status)) throw Error("Estado no válido.");
  if (status === "active")
    for (const older of store
      .list("skills")
      .filter((x) => x.name === skill.name && sameOwner(x, skill) && x.id !== skill.id && ["active", "stale"].includes(x.status)))
      store.patch("skills", older.id, { status: "disabled" });
  return store.patch("skills", skillId, status === "active" ? { status, activatedAt: now(), curatedAt: null, curatedFrom: null } : { status });
}

/** «Fijar»: pinned skills are never marked stale or archived by the curator. */
export function setSkillPinned(store, skillId, pinned) {
  if (!store.get("skills", skillId)) throw Error("Habilidad no encontrada.");
  return store.patch("skills", skillId, { pinned: !!pinned });
}

/** Marks a skill as loaded (read_skill / skill_view). A stale skill used again becomes active. */
export function touchSkill(store, skillId, at = now()) {
  return store.patch("skills", skillId, (s) => ({
    uses: (s.uses || 0) + 1,
    lastUsedAt: at,
    ...(s.status === "stale" ? { status: "active", curatedAt: at, curatedFrom: "stale" } : {}),
  }));
}

// ---------- minimal patches (Hermes skill_manage patch) ----------
const occurrences = (text, needle) => {
  let n = 0;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
};
/**
 * Applies [{old, new}] edits to the current content. Every `old` must appear exactly
 * once (whitespace at the ends ignored); a single miss or ambiguity discards the whole patch.
 */
export function applySkillEdits(content, edits) {
  if (!Array.isArray(edits) || !edits.length) throw Error("El parche no tiene cambios.");
  if (edits.length > 20) throw Error("Demasiados cambios en un parche.");
  let text = String(content || "").replace(/\r\n/g, "\n");
  for (const [i, edit] of edits.entries()) {
    const old = String(edit?.old ?? "").replace(/\r\n/g, "\n");
    const next = String(edit?.new ?? "").replace(/\r\n/g, "\n");
    if (!old.trim()) throw Error(`Cambio ${i + 1}: falta el texto a sustituir.`);
    let needle = old;
    let count = occurrences(text, needle);
    if (count === 0 && old.trim() !== old) {
      needle = old.trim();
      count = occurrences(text, needle);
    }
    if (count === 0) throw Error(`Cambio ${i + 1}: el texto a sustituir no está en la versión actual.`);
    if (count > 1) throw Error(`Cambio ${i + 1}: el texto a sustituir aparece ${count} veces; hace falta un trozo único.`);
    const at = text.indexOf(needle);
    text = text.slice(0, at) + (needle === old ? next : next.trim()) + text.slice(at + needle.length);
  }
  return text;
}

/**
 * Creates a new pending version of `skillId` from minimal edits applied to its CURRENT
 * content (read before write). The name never changes. Returns the new version or
 * throws (nothing is written) when an edit does not match.
 */
export function patchSkill(store, { skillId, edits, source = "Mejora", missionId = null, learnedFrom = null }) {
  const target = store.get("skills", skillId);
  if (!target) throw Error("Habilidad no encontrada.");
  const content = applySkillEdits(target.content, edits);
  if (content === String(target.content).replace(/\r\n/g, "\n")) throw Error("El parche no cambia nada.");
  const parsed = parseSkill(content);
  if (parsed.name !== target.name) throw Error("Un parche no puede cambiar el nombre de la habilidad.");
  const skill = importSkill(store, { content, source, missionId, botId: target.botId ?? null, origin: "learned", learnedFrom, previous: target.id });
  return target.pinned && skill.id !== target.id && !skill.pinned ? store.patch("skills", skill.id, { pinned: true }) : skill;
}

// ---------- curator (Hermes agent/curator.py, deterministic part) ----------
export const CURATOR = Object.freeze({ staleDays: 30, archiveDays: 90, graceDays: 14 });
const DAY = 86400000;

/** Skills loaded by automation runs or named in an automation prompt: never aged out. */
export function skillsUsedByAutomations(store) {
  const ids = new Set();
  const automations = store.list("automations");
  const skills = store.list("skills");
  for (const a of automations) {
    for (const sid of Array.isArray(a.skillIds) ? a.skillIds : []) ids.add(sid);
    const prompt = String(a.prompt || "").toLowerCase();
    for (const s of skills) if (prompt.includes(s.id) || (s.name.length > 3 && prompt.includes(s.name.toLowerCase()))) ids.add(s.id);
  }
  const automated = new Set(store.list("missions").filter((m) => m.automationId).map((m) => m.id));
  if (automated.size)
    for (const step of [...automated].flatMap((id) => store.where("steps", "missionId", id))) {
      for (const item of step.history || []) {
        if (item.type !== "function_call" || !["read_skill", "skill_view"].includes(item.name)) continue;
        try { ids.add(JSON.parse(item.arguments).id); } catch {}
      }
    }
  return ids;
}

/**
 * Weekly pass: active skills without use for 30 days → 'stale' (hidden from the index,
 * visible in Biblioteca); 90 days → 'archived'. Never deletes. Pinned skills, skills used
 * by automations and consolidated ones are skipped; never-used skills get 14 days of grace. A stale skill
 * used again goes back to 'active'. Returns {checked, stale, archived, reactivated}.
 */
export function curateSkills(store, at = Date.now(), { staleDays = CURATOR.staleDays, archiveDays = CURATOR.archiveDays, graceDays = CURATOR.graceDays } = {}) {
  const time = typeof at === "number" ? at : Date.parse(at);
  const out = { checked: 0, stale: [], archived: [], reactivated: [] };
  const protectedIds = skillsUsedByAutomations(store);
  for (const s of store.list("skills")) {
    if (!["active", "stale"].includes(s.status)) continue;
    out.checked++;
    // Pinned, used by an automation or proven to help (verdicts.mjs): never aged out.
    if (s.pinned || s.consolidated || protectedIds.has(s.id)) {
      if (s.status === "stale") {
        store.patch("skills", s.id, { status: "active", curatedAt: new Date(time).toISOString(), curatedFrom: "stale" });
        out.reactivated.push(s.id);
      }
      continue;
    }
    const born = Math.max(Date.parse(s.createdAt || 0) || 0, Date.parse(s.activatedAt || 0) || 0);
    const used = Date.parse(s.lastUsedAt || 0) || 0;
    if (!used && time - born < graceDays * DAY) continue;
    const anchor = Math.max(used, born);
    const idle = time - anchor;
    const stamp = new Date(time).toISOString();
    if (idle >= archiveDays * DAY) {
      store.patch("skills", s.id, { status: "archived", curatedAt: stamp, curatedFrom: s.status });
      out.archived.push(s.id);
    } else if (idle >= staleDays * DAY && s.status === "active") {
      store.patch("skills", s.id, { status: "stale", curatedAt: stamp, curatedFrom: "active" });
      out.stale.push(s.id);
    } else if (idle < staleDays * DAY && s.status === "stale") {
      store.patch("skills", s.id, { status: "active", curatedAt: stamp, curatedFrom: "stale" });
      out.reactivated.push(s.id);
    }
  }
  return out;
}

/** Skill detail with the previous version, for the diff in the API. */
export function skillDetail(store, skillId) {
  const skill = store.get("skills", skillId);
  if (!skill) return null;
  const prior = skill.previous ? store.get("skills", skill.previous) : null;
  return { ...skill, previous: prior ? { id: prior.id, version: prior.version, content: prior.content } : null };
}

/**
 * Resolves the Bandeja approval (kind 'skill') of a skill after the user activates
 * or discards it elsewhere (PATCH /api/skills/:id). Returns the updated approvals.
 */
export function resolveSkillApproval(store, skillId, status) {
  if (!["active", "disabled"].includes(status)) return [];
  const open = store.list("approvals").filter((a) => a.kind === "skill" && a.skillId === skillId && a.status === "pending");
  // A learned skill or improvement you discard is never proposed again (forgotten.mjs).
  const skill = store.get("skills", skillId);
  if (status === "disabled" && open.length && skill?.origin === "learned")
    forget(store, (skill.version || 1) > 1 ? "skill-patch" : "skill", (skill.version || 1) > 1 ? skill.content : skill.name, skill.botId ?? null, { missionId: skill.missionId ?? null, reason: "rejected" });
  return store
    .list("approvals")
    .filter((a) => a.kind === "skill" && a.skillId === skillId && a.status === "pending")
    .map((a) =>
      store.patch("approvals", a.id, {
        status: status === "active" ? "approved" : "denied",
        decidedAt: now(),
        decidedBy: "tú",
        resolution: status === "active" ? "Habilidad activada" : "Habilidad descartada",
      }),
    );
}
