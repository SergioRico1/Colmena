// COMPANY.md: what matters to the whole company, in one place every bot reads, so knowledge does
// not stay in silos between departments or people. Its counterpart is the person's USER.md
// (learning.mjs), which is theirs alone.
//
// - People write it: anyone in the company (a guest only reads). Every change keeps the text it
//   replaced (doc-history.mjs, doc "company"), with who changed it.
// - Bots read it on every turn (soul.mjs), except when they work for someone outside.
// - Once a day Colmena adds what the bots learned that matters company-wide, only from what is
//   already shared: the team's memories learned outside anyone's private conversation. It only
//   appends short lines under its own heading; what people wrote is never rewritten.
// Hosted, the workspace folder is mounted on its store (doc-files.mjs): no disk there.
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "./doc-files.mjs";
import path from "node:path";
import { z } from "zod";
import { currentPerson, isPerson } from "./identity.mjs";
import { containsSecret, memoryTarget, scanMemoryThreat } from "./memory.mjs";
import { recordVersion, versionsView } from "./doc-history.mjs";
import { chatOwner, personalChat } from "./threads.mjs";
import { now } from "./store.mjs";

export const COMPANY_LIMIT = 6000;
/** What a bot's prompt carries of it, at most. */
export const COMPANY_PROMPT_LIMIT = 4000;
export const LEARNED_HEADING = "## Lo que han aprendido los bots";
const STATE = "company";
const MAX_ADDS = 5;

export const COMPANY_TEMPLATE = `# COMPANY.md — Lo que sabe la empresa

Lo más importante de la empresa, para que todas las personas y todos los bots partan de lo mismo.
Escríbelo con frases cortas; cualquiera de la empresa puede cambiarlo.

## Qué hacemos

## Departamentos y quién lleva qué

## Clientes y proyectos clave

## Cómo trabajamos (normas, herramientas, formatos)

## Prioridades ahora
`;

const fileOf = (directory) => {
  if (!directory) throw Error("Espacio de trabajo no configurado.");
  return path.join(directory, "COMPANY.md");
};
export function readCompanyDoc(directory) {
  try { return readFileSync(fileOf(directory), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function writeCompanyDoc(directory, text) {
  const value = String(text ?? "").replace(/\r\n/g, "\n");
  if (value.length > COMPANY_LIMIT) throw Object.assign(Error(`COMPANY.md puede tener como mucho ${COMPANY_LIMIT} caracteres.`), { status: 400 });
  const threat = scanMemoryThreat(value);
  if (threat) throw Object.assign(Error(threat), { status: 400 });
  if (containsSecret(value)) throw Object.assign(Error("COMPANY.md no puede guardar contraseñas ni claves: lo lee toda la empresa."), { status: 400 });
  const file = fileOf(directory);
  mkdirSync(directory, { recursive: true });
  try { if (lstatSync(file).isSymbolicLink()) throw Error("No se permiten enlaces simbólicos."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const temp = file + "." + process.pid + "." + Date.now() + ".tmp";
  writeFileSync(temp, value, "utf8");
  renameSync(temp, file);
  return value;
}

/** For the screen: {content, chars, limit, updatedAt, updatedBy, template}. */
export function companyDoc(store, directory = store.directory) {
  const content = readCompanyDoc(directory) || "";
  const state = store.get("learningState", STATE) || {};
  return { content, chars: content.length, limit: COMPANY_LIMIT, updatedAt: state.editedAt || state.learnedAt || null, updatedBy: state.editedBy || null, template: content ? null : COMPANY_TEMPLATE };
}
/** A person writes it (or restores a version). */
export function saveCompanyDoc(store, content, { directory = store.directory, source = "edición", reason = null } = {}) {
  const person = currentPerson();
  const who = isPerson(person) ? person.name || person.email || "Alguien" : null;
  const previous = readCompanyDoc(directory);
  const text = writeCompanyDoc(directory, content);
  recordVersion(store, { doc: "company", content: text, previous, source, reason: reason || (who ? "Lo editó " + who : null) });
  store.put("learningState", { ...(store.get("learningState", STATE) || { id: STATE }), editedAt: now(), editedBy: who });
  return companyDoc(store, directory);
}
export const companyVersions = (store) => versionsView(store, "company", null);
export function restoreCompanyVersion(store, versionId, directory = store.directory) {
  const v = store.get("docVersions", versionId);
  if (!v || v.doc !== "company") throw Object.assign(Error("Esa versión ya no existe."), { status: 404 });
  saveCompanyDoc(store, v.content, { directory, source: "restaurado", reason: "Vuelve a la versión del " + new Date(v.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) });
  return companyVersions(store);
}

/** The prompt section: the document as it is (clipped), or null when there is none yet. */
export function companyDigest(directory) {
  let content = null;
  try { content = directory ? readCompanyDoc(directory) : null; } catch {}
  const text = String(content || "").trim();
  if (!text || text === COMPANY_TEMPLATE.trim()) return null;
  return text.length > COMPANY_PROMPT_LIMIT ? text.slice(0, COMPANY_PROMPT_LIMIT) + "\n…(sigue en COMPANY.md)" : text;
}

/**
 * The team's memories everyone in the company may know: not about a person, and not learned in
 * anyone's private conversation (a direct message, a private room, a chat with a bot).
 */
export function sharedTeamMemories(store) {
  return store.list("memories").filter((m) => {
    if (m.active === false || m.doubt || m.review || typeof m.text !== "string") return false;
    if (memoryTarget(m) !== "memory" || m.scope === "bot" || m.personId) return false;
    if (!m.missionId) return true;
    const mission = store.get("missions", m.missionId);
    return !!mission && !mission.audience && !mission.incognito && !(personalChat(mission) && chatOwner(mission));
  });
}

const INSTRUCTIONS = `Eres quien mantiene COMPANY.md: lo más importante de una empresa, que leen todas las personas y todos los bots. Recibes el documento actual y recuerdos nuevos del equipo. Devuelve SOLO JSON: {"add":[string]}.
- Añade como mucho ${MAX_ADDS} frases, solo lo que importa a toda la empresa y le sirve a otro departamento: decisiones, normas, clientes y proyectos clave, quién lleva qué, herramientas, fechas importantes.
- Nada que ya diga el documento (aunque sea con otras palabras), nada de una sola tarea, nada personal de nadie, ninguna contraseña, clave ni dato bancario.
- Cada frase corta (máximo 200 caracteres), en español, como hecho («El cierre contable es el día 5.»), no como orden.
- Si no hay nada que valga para toda la empresa, devuelve {"add":[]}.`;
const addSchema = z.object({ add: z.array(z.string().trim().min(8).max(240)).max(MAX_ADDS) });

/** Once a day (learningTick): new shared knowledge → a few lines under LEARNED_HEADING. */
export async function learnCompanyDoc(store, infer, { model = null, directory = store.directory, at = new Date(), signal } = {}) {
  const settings = store.get("settings", "main") || {};
  if (settings.learning === false) return { status: "disabled" };
  const state = store.get("learningState", STATE) || { id: STATE };
  const since = state.learnedAt ? Date.parse(state.learnedAt) : 0;
  const fresh = sharedTeamMemories(store).filter((m) => (Date.parse(m.updatedAt || m.createdAt || 0) || 0) > since).slice(-40);
  if (!fresh.length) return { status: "skipped" };
  const chosen = model || settings.model;
  if (!chosen) return { status: "skipped", reason: "sin modelo" };
  const current = readCompanyDoc(directory) || "";
  const result = await infer({
    model: chosen, instructions: INSTRUCTIONS, reasoning: { effort: "low" }, tools: [],
    input: [{ role: "user", content: JSON.stringify({ hoy: at.toISOString().slice(0, 10), documento: current.slice(0, COMPANY_LIMIT), recuerdosNuevos: fresh.map((m) => m.text) }) }],
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
  }, { missionId: null, botId: null });
  const raw = String(result?.text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw Error("COMPANY.md: la respuesta no fue JSON.");
  const lines = addSchema.parse(JSON.parse(raw.slice(start, end + 1))).add
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => !containsSecret(t) && !scanMemoryThreat(t) && !current.toLowerCase().includes(t.toLowerCase()));
  store.put("learningState", { ...state, learnedAt: at.toISOString() });
  if (!lines.length) return { status: "nothing" };
  const day = at.toISOString().slice(0, 10);
  let base = current.trim() ? current.replace(/\s*$/, "\n") : COMPANY_TEMPLATE;
  if (!base.includes(LEARNED_HEADING)) base += "\n" + LEARNED_HEADING + "\n_Lo añade Colmena con lo que el equipo ya comparte. Muévelo, corrígelo o bórralo: tus cambios mandan._\n";
  let next = base + lines.map((t) => `- [${day}] ${t}`).join("\n") + "\n";
  // Over the limit, the oldest learned lines go first; what people wrote stays.
  while (next.length > COMPANY_LIMIT) {
    const at2 = next.indexOf("\n- [", next.indexOf(LEARNED_HEADING));
    if (at2 < 0) return { status: "full" };
    next = next.slice(0, at2) + next.slice(next.indexOf("\n", at2 + 1));
  }
  writeCompanyDoc(directory, next);
  recordVersion(store, { doc: "company", content: next, previous: current, source: "condensación", reason: `Añadió ${lines.length} ${lines.length === 1 ? "línea" : "líneas"} de lo que sabe el equipo` });
  return { status: "completed", added: lines };
}
