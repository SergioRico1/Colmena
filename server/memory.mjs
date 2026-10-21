import { readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { id, now } from "./store.mjs";

// Bounded, curated memory in the style of Hermes (MEMORY.md / USER.md with char
// limits). Three stores, each a list of short facts:
//   user   «Lo que sabes de la persona»  ≤ 1400 chars per space
//   memory «Lo que sabe el equipo»       ≤ 2200 chars per space
//   bot    memoria propia de cada bot    ≤ 1400 chars per bot
// Writes are batches of add/replace/remove checked on the result: if a batch does
// not fit, the model must merge or remove in the same call. Memories enter the
// system prompt, so injection payloads, secrets and orders are refused.
export const MEMORY_LIMITS = Object.freeze({ user: 1400, memory: 2200, bot: 1400 });
export const MEMORY_LABELS = Object.freeze({ user: "Lo que sabes de la persona", memory: "Lo que sabe el equipo", bot: "Tu memoria propia" });
/** Tool-facing names (Spanish) → internal targets. */
export const TARGET_OF = Object.freeze({ persona: "user", equipo: "memory", bot: "bot", user: "user", memory: "memory" });
export const PROFILE_LIMIT = 1400;

const fold = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (text) => new Set(fold(text).split(" ").filter((t) => t.length > 2));
function similar(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

/** Internal target of a memory record; older records are classified by scope/kind/source. */
export function memoryTarget(m) {
  if (m?.target && MEMORY_LIMITS[m.target]) return m.target;
  if (m?.scope === "bot") return "bot";
  if (m?.kind === "preferencia") return "user";
  if (m?.kind === "hecho") return "memory";
  return !m?.source || m.source === "dijiste" ? "user" : "memory";
}

/** Active entries of a store. `botId` is required for the bot store. Condensed person facts live in USER.md. */
export function memoryEntries(store, target, botId = null) {
  return store
    .list("memories")
    .filter((m) => m.active !== false && typeof m.text === "string" && memoryTarget(m) === target)
    .filter((m) => (target === "bot" ? m.botId === botId : true))
    .filter((m) => !(target === "user" && m.condensed));
}

const sizeOf = (entries) => entries.reduce((n, m) => n + String(m.text).trim().length, 0);

/** {used, limit, percent, label:'67 % — 940/1400'} */
export function usageOf(used, limit) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return { used, limit, percent, label: `${percent} % — ${used}/${limit}` };
}
export function memoryUsage(store, target, botId = null) {
  return usageOf(sizeOf(memoryEntries(store, target, botId)), MEMORY_LIMITS[target]);
}
/** Usage of the three stores seen by a bot (for the prompt and the profile meter). */
export function memoryMeters(store, botId) {
  return { user: memoryUsage(store, "user"), memory: memoryUsage(store, "memory"), bot: memoryUsage(store, "bot", botId) };
}

// ---------- safety checks ----------
const SECRET_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/,                                   // email
  /\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}/,          // international phone
  /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3}\b/,                          // 612 345 678
  /\b\d{3}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}\b/,               // 912 34 56 78
  /\b\d{9,19}\b/,                                               // long digit runs (phones, cards, accounts)
  /\b(?:\d{4}[\s-]){3}\d{1,4}\b/,                               // card numbers
  /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,8}(?:[ ]?[A-Z0-9]{1,3})?\b/i, // IBAN
  /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{12,}/, // API keys
  /\b(?:contrase(?:n|ñ)a|password|passwd|clave|token|secreto|pin)\b(?:\s*[:=]|\s+(?:es|era|is))\s*\S+/i,
  /\b[A-Fa-f0-9]{32,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}/,
];
/** True when the text carries personal data or credentials that never go to memory. */
export function containsSecret(text) {
  return SECRET_PATTERNS.some((r) => r.test(String(text || "")));
}

const INVISIBLE = /[​‌‍⁠⁢⁣⁤﻿‪-‮⁦-⁩]/;
const FILLER = "(?:[\\p{L}\\p{N}]+\\s+){0,6}";
const THREATS = [
  [new RegExp(`\\bignor(?:a|e|ad|ar|en)\\s+${FILLER}(?:instrucciones|indicaciones|reglas|[oó]rdenes|instructions|rules)`, "iu"), "orden de ignorar instrucciones"],
  [new RegExp(`\\bolvida\\s+${FILLER}(?:instrucciones|reglas|indicaciones)`, "iu"), "orden de olvidar instrucciones"],
  [new RegExp(`\\bdisregard\\s+${FILLER}(?:instructions|rules|guidelines)`, "iu"), "disregard"],
  [/\b(?:system\s+prompt|prompt\s+del\s+sistema|instrucciones\s+del\s+sistema)\b/i, "referencia al prompt del sistema"],
  [new RegExp(`\\b(?:a\\s+partir\\s+de\\s+ahora|desde\\s+ahora)\\s+${FILLER}(?:eres|act[uú]a|responde|obedece)`, "iu"), "cambio de identidad"],
  [new RegExp(`\\b(?:you\\s+are\\s+now|pretend\\s+to\\s+be|act\\s+as\\s+if)\\b`, "i"), "cambio de identidad"],
  [new RegExp(`\\bno\\s+(?:se\\s+lo\\s+)?(?:digas|cuentes|menciones)\\s+${FILLER}(?:a\\s+la\\s+persona|al\\s+usuario|a\\s+nadie)`, "iu"), "ocultar algo a la persona"],
  [/\b(?:env[ií]a|manda|sube|send|post|upload)\b[^\n]{0,200}\bhttps?:\/\//i, "envío a una dirección web"],
  [/https?:\/\/\S*[?&#](?:token|key|api_?key|access_token|auth|sig|signature|password|secret|code)=/i, "URL con credenciales"],
  [/https?:\/\/[^\s/]*:[^\s/]*@/i, "URL con credenciales"],
  [/<!--|<\s*script\b|<\s*div\s+style\s*=\s*["'][^>]*display\s*:\s*none/i, "contenido oculto"],
  [/\b(?:api[_-]?key|token|secret|password|contrase(?:ñ|n)a|clave)\s*[:=]\s*\S{6,}/i, "secreto"],
  [/authorized_keys|\.ssh\/|\.env\b/i, "ruta sensible"],
];
/** Error text if the memory looks like an injection or exfiltration payload; null when clean. */
export function scanMemoryThreat(text) {
  const value = String(text || "").slice(0, 65536);
  if (INVISIBLE.test(value)) return "Contiene caracteres invisibles: no se guarda.";
  const normalized = value.normalize("NFKC");
  for (const [re, what] of THREATS) if (re.test(normalized)) return `Parece una instrucción peligrosa (${what}): la memoria no admite órdenes, enlaces con claves ni secretos.`;
  return null;
}

// Bare second-person orders to the bot. «Usa Excel» or «Trabaja con euros» stay valid facts.
const IMPERATIVE = /^(?:por\s+favor,?\s+)?(?:responde|resp[oó]ndele|contesta|haz|escribe|di|dile|env[ií]a|manda|pon|evita|recuerda|ignora|olvida|incluye|a[nñ]ade|aseg[uú]rate|ten\s+en\s+cuenta|debes|tienes\s+que|(?:nunca|no|jam[aá]s)\s+(?:uses|utilices|hagas|escribas|respondas|pongas|incluyas|env[ií]es|digas|mandes|menciones))(?=[\s,.:;!]|$)/iu;
/** Memories are facts («Prefiere…», «Trabaja con…»), not orders («Responde…»). */
export function factProblem(text) {
  return IMPERATIVE.test(String(text || "").trim())
    ? "Escríbelo como un hecho sobre la persona o el equipo («Prefiere informes breves», «Trabaja en euros»), no como una orden («Responde…»)."
    : null;
}

const PERSON = /^(?:prefiere|le\s+gusta|no\s+le\s+gusta|quiere|odia|suele|nunca|siempre|trabaja|vive|es\s|tiene|habla|usa\s)/iu;
/** Legacy remember({text, scope}) → target. */
export function guessTarget(text, scope) {
  if (scope === "bot") return "bot";
  return PERSON.test(String(text || "").trim()) ? "user" : "memory";
}

// ---------- batch operations ----------
/** Validates one operation; throws a message for the model. */
export function normalizeMemoryOp(op, i = 0) {
  const target = TARGET_OF[op?.target] || (op?.scope || !op?.target ? guessTarget(op?.text, op?.scope) : null);
  if (!target) throw Error(`Operación ${i + 1}: destino no válido (persona, equipo o bot).`);
  const action = op.action || "add";
  if (!["add", "replace", "remove"].includes(action)) throw Error(`Operación ${i + 1}: acción no válida.`);
  const text = String(op.text || "").replace(/\s+/g, " ").trim();
  const old = String(op.old || "").trim();
  if (action !== "remove") {
    if (text.length < 3 || text.length > 500) throw Error(`Operación ${i + 1}: el recuerdo debe tener entre 3 y 500 caracteres.`);
    if (containsSecret(text)) throw Error(`Operación ${i + 1}: no guardes datos sensibles en la memoria (correos, teléfonos, cuentas, claves).`);
    const problem = scanMemoryThreat(text) || factProblem(text);
    if (problem) throw Error(`Operación ${i + 1}: ${problem}`);
  }
  if (action !== "add" && old.length < 3) throw Error(`Operación ${i + 1}: indica en «old» un trozo literal del recuerdo que cambias o quitas.`);
  return { action, target, text, old, index: i };
}

/**
 * Applies add/replace/remove operations atomically. `ops` = [{action, target, text, old}],
 * target in persona|equipo|bot (or user|memory). Throws with a message for the model when
 * an operation is invalid or the result does not fit. Returns {results, usage}.
 */
/**
 * origin (OpenClaw memory provenance): 'persona' (you wrote it), 'bot' (the bot inferred it)
 * or 'externo' (saved in a turn after reading a web page, an email or a connected app).
 * External memories stay «por revisar» and out of the bots' prompts until you confirm them,
 * so a page cannot plant a «fact» in the team's memory.
 */
export function applyMemoryOps(store, { ops, bot, mission = null, source = "dedujo", review = true, keyPrefix = id(), sourceLabel = null, maxAdds = 10, origin = null }) {
  const from = origin || (source === "dijiste" ? "persona" : "bot");
  if (from === "externo") review = true;
  if (!Array.isArray(ops) || !ops.length) throw Error("Indica al menos una operación.");
  if (ops.length > 12) throw Error("Como mucho 12 operaciones por llamada.");
  const normalized = ops.map((op, i) => normalizeMemoryOp(op, i));
  return store.tx(() => {
    const work = new Map(); // target → entries copy
    const entries = (target) => {
      if (!work.has(target)) work.set(target, memoryEntries(store, target, bot.id).map((m) => ({ ...m })));
      return work.get(target);
    };
    const before = new Map();
    const all = store.list("memories").filter((m) => m.active !== false && typeof m.text === "string");
    const results = [];
    let adds = 0;
    for (const op of normalized) {
      const list = entries(op.target);
      if (!before.has(op.target)) before.set(op.target, sizeOf(list));
      if (op.action === "add") {
        const twin = [...all, ...list].find((m) => !m._removed && (fold(m.text) === fold(op.text) || similar(m.text, op.text) >= 0.8));
        if (twin) { results.push({ action: "add", skipped: "duplicado", existing: twin.text }); continue; }
        if (adds >= maxAdds) { results.push({ action: "add", skipped: "límite de recuerdos nuevos por revisión" }); continue; }
        adds++;
        const record = {
          id: keyPrefix + (ops.length > 1 ? ":" + op.index : ""), text: op.text, botId: bot.id,
          scope: op.target === "bot" ? "bot" : "equipo", target: op.target, kind: op.target === "user" ? "preferencia" : "hecho",
          source, sourceLabel: sourceLabel || (source === "acuerdo" ? "Aprobado por ti" : "Lo dedujo " + bot.name) + (mission ? " en «" + mission.title + "»" : ""),
          review, origin: from, active: true, missionId: mission?.id || null, createdAt: now(), _new: true, _order: op.index,
        };
        list.push(record);
        all.push(record);
        results.push({ action: "add", text: op.text, id: record.id });
        continue;
      }
      const needle = fold(op.old);
      const hits = list.filter((m) => !m._removed && fold(m.text).includes(needle));
      if (!hits.length) throw Error(`Operación ${op.index + 1}: no encuentro ningún recuerdo con «${op.old.slice(0, 80)}» en ${MEMORY_LABELS[op.target]}.`);
      if (hits.length > 1) throw Error(`Operación ${op.index + 1}: «${op.old.slice(0, 80)}» coincide con ${hits.length} recuerdos; usa un trozo más largo.`);
      const hit = hits[0];
      if (op.action === "remove") {
        if (hit.source === "dijiste") throw Error(`Operación ${op.index + 1}: ese recuerdo lo escribió la persona; no lo quites (como mucho fusiónalo con replace).`);
        hit._removed = true;
        results.push({ action: "remove", text: hit.text, id: hit.id });
      } else {
        hit._previous ??= hit.text;
        hit.text = op.text;
        hit._changed = true;
        results.push({ action: "replace", from: hit._previous, text: op.text, id: hit.id });
      }
    }
    for (const [target, list] of work) {
      const used = sizeOf(list.filter((m) => !m._removed)), limit = MEMORY_LIMITS[target];
      if (used > limit && used > before.get(target)) {
        const current = list.filter((m) => !m._new).map((m) => "- " + (m._previous || m.text)).join("\n");
        throw Error(
          `«${MEMORY_LABELS[target]}» quedaría en ${used}/${limit} caracteres. Libera al menos ${used - limit} en la MISMA llamada: ` +
            `fusiona recuerdos parecidos con replace o quita los que ya no sirvan con remove, y añade el nuevo. Recuerdos actuales:\n${current}`,
        );
      }
    }
    // New facts in the order of the operations, then edits and removals.
    for (const m of [...work.values()].flat().filter((x) => x._new).sort((a, b) => a._order - b._order)) {
      const { _new, _order, ...record } = m;
      store.put("memories", record);
    }
    for (const list of work.values())
      for (const m of list) {
        if (m._new) continue;
        if (m._removed) {
          store.patch("memories", m.id, { active: false, removedAt: now(), removedBy: bot.id, removedIn: mission?.id || null });
        } else if (m._changed) {
          store.patch("memories", m.id, { text: m.text, previousText: m._previous, review: review || m.review === true, editedBy: bot.id, target: memoryTarget(m), ...(from === "externo" ? { origin: "externo" } : {}) });
        }
      }
    const usage = {};
    for (const target of work.keys()) usage[Object.keys(TARGET_OF).find((k) => TARGET_OF[k] === target)] = memoryUsage(store, target, bot.id).label;
    return { results, usage };
  });
}

// ---------- USER.md: condensed profile of the person (OpenClaw style) ----------
export function userProfilePath(directory) {
  if (!directory) throw Error("Espacio de trabajo no configurado.");
  return path.join(directory, "USER.md");
}
export function readUserProfile(directory) {
  try {
    return readFileSync(userProfilePath(directory), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function writeUserProfile(directory, text) {
  const value = String(text ?? "").replace(/\r\n/g, "\n");
  if (value.length > PROFILE_LIMIT * 2) throw Error(`El perfil debe tener como mucho ${PROFILE_LIMIT * 2} caracteres.`);
  const threat = scanMemoryThreat(value.replace(/^_.*_$/gm, ""));
  if (threat) throw Error(threat);
  const file = userProfilePath(directory);
  mkdirSync(directory, { recursive: true });
  try {
    if (lstatSync(file).isSymbolicLink()) throw Error("No se permiten enlaces simbolicos.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temp = file + "." + process.pid + "." + Date.now() + ".tmp";
  writeFileSync(temp, value, "utf8");
  renameSync(temp, file);
  return value;
}

const DIRECTIVE = /^\s*-\s*\[(\d{4}-\d{2}-\d{2})\s*·\s*([^\]]+)\]\s*(.+)$/;
const ACTIVE_WORDS = new Set(["activa", "active", "vigente"]);
/** [{date, status:'active'|'superseded', text}] from a USER.md written by condenseUserProfile or edited by hand. */
export function parseDirectives(content) {
  const out = [];
  for (const line of String(content || "").split("\n")) {
    const m = line.match(DIRECTIVE);
    if (m) out.push({ date: m[1], status: ACTIVE_WORDS.has(fold(m[2])) ? "active" : "superseded", text: m[3].trim() });
    else if (/^\s*-\s+\S/.test(line)) out.push({ date: null, status: "active", text: line.replace(/^\s*-\s+/, "").trim() });
  }
  return out;
}

/** Renders directives into a USER.md of at most PROFILE_LIMIT characters (drops superseded, then oldest). */
export function renderUserProfile(directives, { date = new Date().toISOString().slice(0, 10), userName = null } = {}) {
  const head = `# USER.md — Perfil de la persona\n_Lo condensa Colmena a partir de lo que sabéis de ${userName || "la persona"} (actualizado ${date}). Puedes editarlo: tus cambios mandan._\n\n## Directivas\n`;
  let list = directives.filter((d) => d.text && !scanMemoryThreat(d.text)).map((d) => ({ ...d, date: d.date || date }));
  const render = (items) => head + items.map((d) => `- [${d.date} · ${d.status === "active" ? "activa" : "sustituida"}] ${d.text.replace(/\s+/g, " ").trim()}`).join("\n") + "\n";
  let text = render(list);
  while (text.length > PROFILE_LIMIT && list.some((d) => d.status !== "active")) {
    list.splice(list.findIndex((d) => d.status !== "active"), 1);
    text = render(list);
  }
  while (text.length > PROFILE_LIMIT && list.length > 1) {
    const oldest = list.reduce((a, d, i) => (String(d.date) < String(list[a].date) ? i : a), 0);
    list.splice(oldest, 1);
    text = render(list);
  }
  return text.slice(0, PROFILE_LIMIT);
}

/** Active directives of the profile, for the system prompt. */
export function profileDigest(directory) {
  let content = null;
  try { content = directory ? readUserProfile(directory) : null; } catch {}
  return parseDirectives(content).filter((d) => d.status === "active").map((d) => "- " + d.text);
}
