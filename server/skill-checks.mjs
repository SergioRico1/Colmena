// Checks before anything learned is accepted (harness2 core/tree.py validate): a skill is
// activated, or a proposal reaches the person, only when it is well formed, names tools that
// exist, fits the size limits, does not repeat another skill (then a merge is proposed) and
// carries no secrets. Every problem is listed, in plain words, so the review can say why.
import { parseSkill } from "./skills.mjs";
import { toolsFor, CONNECTION_TOOLS, TOOL_ALIASES } from "./tools.mjs";
import { containsSecret, scanMemoryThreat } from "./memory.mjs";
import { SOUL_LIMITS } from "./soul.mjs";

export const SKILL_LIMITS = Object.freeze({ chars: 8000, steps: 15, description: 300 });

const fold = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (text) => new Set(fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((t) => t.length > 2));
function similarity(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

// Tools of connected apps, the computer, projects and MCP servers come and go with the
// person's setup: any name under these prefixes is accepted.
const DYNAMIC = /^(?:gmail|googlecalendar|googledrive|googlesheets|googledocs|outlook|microsoft|slack|notion|github|gitlab|hubspot|trello|asana|dropbox|onedrive|whatsapp|telegram|linkedin|twitter|apps|browser|desktop|computer|project|projects|mcp|run|command)_/;
let known = null;
/** Every tool name a Colmena bot can be offered. */
export function knownTools() {
  if (known) return known;
  known = new Set([...Object.keys(TOOL_ALIASES), ...CONNECTION_TOOLS.map((t) => t.name), "run_command", "apps_table"]);
  for (const kind of ["solo", "plan", "critique", "followup", "consult", "delegate"])
    for (const t of toolsFor(kind, { connections: true, images: true })) known.add(t.name);
  return known;
}
/** snake_case names a skill presents as tools: `read_file` in backticks or read_file(…). */
export function namedTools(content) {
  const out = new Set();
  for (const m of String(content || "").matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\([^`]*\))?`|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\(/g)) out.add(m[1] || m[2]);
  return [...out];
}
export function unknownTools(content) {
  const tools = knownTools();
  return namedTools(content).filter((name) => !tools.has(name) && !DYNAMIC.test(name));
}

/**
 * {ok, problems: [text], duplicateOf: skill|null} for a SKILL.md about to be activated or
 * proposed. `lineage`: ids of the same skill's versions (a new version never duplicates them).
 */
export function checkSkill(store, content, { botId = null, lineage = [] } = {}) {
  const problems = [];
  let parsed = null;
  try { parsed = parseSkill(content); } catch (error) { problems.push(error.message); }
  const front = /^﻿?---\r?\n[\s\S]*?\r?\n---/.test(String(content || ""));
  if (!front) problems.push("Falta la cabecera YAML con name y description.");
  if (parsed) {
    if (front && !/^\s*name\s*:/m.test(String(content).split(/\r?\n---/)[0])) problems.push("La cabecera no tiene name.");
    if (!/^usala cuando\b/.test(fold(parsed.description).trim())) problems.push("La descripción debe empezar por «Úsala cuando…».");
    if (parsed.steps < 1) problems.push("No tiene pasos numerados.");
    if (parsed.steps > SKILL_LIMITS.steps) problems.push(`Tiene ${parsed.steps} pasos; como mucho ${SKILL_LIMITS.steps}.`);
  }
  if (String(content || "").length > SKILL_LIMITS.chars) problems.push(`Ocupa ${String(content).length} caracteres; como mucho ${SKILL_LIMITS.chars}.`);
  const missing = unknownTools(content);
  if (missing.length) problems.push("Nombra herramientas que no existen: " + missing.slice(0, 5).join(", ") + ".");
  if (containsSecret(content)) problems.push("Contiene datos sensibles (correos, teléfonos, cuentas o claves).");
  const threat = scanMemoryThreat(content);
  if (threat) problems.push(threat);
  let duplicateOf = null;
  if (parsed) {
    const mine = parsed.name + " " + parsed.description;
    duplicateOf = store.list("skills")
      .filter((s) => ["active", "stale", "pending"].includes(s.status) && !s.removed && !lineage.includes(s.id) && s.name !== parsed.name)
      .filter((s) => (s.botId ?? null) === (botId ?? null) || (s.botId ?? null) === null)
      .map((s) => ({ s, score: Math.max(similarity(mine, s.name + " " + s.description), similarity(content, s.content) >= 0.7 ? 1 : 0) }))
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score)[0]?.s || null;
  }
  return { ok: !problems.length && !duplicateOf, problems, duplicateOf };
}

/** Problems of a proposed SOUL (the whole new document): size, secrets, orders hidden in it. */
export function checkSoul(next) {
  const problems = [];
  const text = String(next || "");
  if (text.trim().length < SOUL_LIMITS.min || text.length > SOUL_LIMITS.max) problems.push(`El SOUL debe tener entre ${SOUL_LIMITS.min} y ${SOUL_LIMITS.max} caracteres.`);
  if (containsSecret(text)) problems.push("Contiene datos sensibles (correos, teléfonos, cuentas o claves).");
  const threat = scanMemoryThreat(text);
  if (threat) problems.push(threat);
  return problems;
}
