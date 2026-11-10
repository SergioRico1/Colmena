import { refsInput } from "../mention-refs.mjs";
import path from "node:path";
import { z } from "zod";
import { TOOL_KEYS } from "../store.mjs";
import { attachmentInput } from "../files.mjs";
import { triggerInput } from "../triggers.mjs";
import { DELIVERY_MODES } from "../scheduler.mjs";

// What the route modules share (server/app.mjs and server/routes/*.mjs): the HTTP error, the
// request schemas and small helpers.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
// «Habilidad no encontrada», «Bot no encontrado»: the ending agrees with the noun.
const FEMININE = new Set(["Automatización", "Carpeta", "Conversación", "Habilidad", "Misión", "Persona", "Pregunta", "Regla", "Sala", "Sugerencia"]);
const notFound = (what) => new HttpError(404, what + (FEMININE.has(what) ? " no encontrada." : " no encontrado."));
const SOON = "Disponible en breve.";

// ---------------------------------------------------------------- schemas
const short = z.string().trim().min(1).max(100);
const pct = z.number().min(0).max(100);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Color no válido (#RRGGBB).");
const shape = z.enum(["hex", "circle", "square", "diamond", "arch", "leaf"]);
const access = z.enum(["none", "lee", "escribe", "pide"]);
const toolsSchema = z.object(Object.fromEntries(TOOL_KEYS.map((k) => [k, access]))).partial().strict();
const personality = z.object({ tono: pct, detalle: pct, riesgo: pct }).partial().strict();
const channels = z.object({ colmena: z.literal(true), correo: z.boolean(), chat: z.boolean(), movil: z.boolean() }).partial().strict();
const autonomy = z.enum(["sugiere", "avisa", "solo"]);
const thinking = z.enum(["rapido", "equilibrado", "profundo"]);
const attachment = z.object({ name: short, content: z.string().max(200000), size: z.number().int().min(0).optional() }).strict();
const skillDraft = z.object({ name: short, description: z.string().trim().max(300).default("") }).strict();
const instructions = z.string().trim().min(10).max(12000);
const email = z.string().trim().email("Correo no válido.").max(254);

const botFields = z.object({
  name: short, role: short, instructions, color: hex, shape, enabled: z.boolean(), audience: z.enum(["yo", "equipo"]),
  usesChatGPT: z.boolean(), engine: z.enum(["openai", "anthropic", "opencode-go"]).nullable(), personality, autonomy, thinking, location: z.enum(["local", "nube"]), tools: toolsSchema,
  helpers: z.array(short).max(10), delegateFreely: z.boolean(), channels,
  voice: z.string().trim().max(200).nullable(), // speechSynthesis voice (voiceURI) for «Escuchar»
});
const botCreate = botFields
  .partial()
  .required({ name: true, role: true, instructions: true, color: true, shape: true })
  .extend({ skills: z.array(skillDraft).max(8).optional(), soul: z.string().max(60000).optional() })
  .strict();
const botPatch = botFields.partial().strict();
const draftBase = z.object({
  name: short, role: short, instructions, shape: shape.optional(), color: hex.optional(),
  skills: z.array(skillDraft).max(8).default([]), permissions: toolsSchema.default({}), autonomy: autonomy.optional(),
  questions: z.array(z.string().trim().min(1).max(300)).max(5).default([]), audience: z.enum(["yo", "equipo"]).optional(),
  personality: personality.optional(), thinking: thinking.optional(),
});
const missionCreate = z
  .object({
    prompt: z.string().trim().min(1).max(20000), title: short.optional(), mode: z.enum(["solo", "equipo", "debate"]).default("solo"),
    botIds: z.array(short).max(4).default([]), conversation: z.boolean().optional(), conversationOf: short.optional(),
    safety: z.enum(["preguntar", "avisar"]).optional(), attachments: z.array(attachmentInput).max(5).default([]),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    // A private chat: deleted 24 h after it starts, no memory or learning (OpenClaw incognito).
    incognito: z.boolean().optional(),
    // «+» in the composer: tools or apps for this message, and «Pensar a fondo».
    use: z.array(z.string().trim().min(2).max(40)).max(8).optional(), deep: z.boolean().optional(),
    // «@» picks of past conversations (server/mention-refs.mjs); a new chat has no folder yet.
    refs: refsInput.optional(),
  })
  .strict();
const automationFields = z.object({
  name: short, botId: short, prompt: z.string().trim().min(1).max(20000), enabled: z.boolean(), trigger: triggerInput,
  notify: z.enum(["siempre", "resultado", "fallo"]), needs: z.array(z.object({ tool: z.enum(TOOL_KEYS), access }).strict()).max(10),
  // Where each run goes: a new conversation, always the same one, or a room you chose.
  delivery: z.object({ mode: z.enum(DELIVERY_MODES), missionId: short.nullable().optional() }).strict(),
});
const automationCreate = automationFields.partial({ enabled: true, notify: true, needs: true, delivery: true }).strict();
// `expectedEditedAt`: the editedAt the editor loaded (null for a rule never edited); a different
// one means someone else changed the rule meanwhile, and the edit is refused instead of overwriting.
const automationPatch = automationFields.extend({ expectedEditedAt: z.string().max(40).nullable() }).partial().strict();
const folderFields = z.object({ path: z.string().trim().min(1).max(1000), label: short, botIds: z.array(short).max(20), access: z.enum(["lee", "escribe"]) });
const personFields = z.object({ name: short, email: email.nullable(), role: z.string().trim().max(100) });

const MESSAGES = {
  invalid_type: (i) => (i.received === "undefined" ? "falta" : "tiene un tipo no válido"),
  too_small: () => "es demasiado corto o le faltan elementos",
  too_big: () => "es demasiado largo o tiene demasiados elementos",
  invalid_enum_value: () => "no es una opción válida",
  invalid_literal: () => "no es una opción válida",
  unrecognized_keys: (i) => "incluye campos no permitidos (" + (i.keys || []).join(", ") + ")",
  invalid_union: () => "no es válido",
};
export function zodMessage(error) {
  const issue = error.issues[0];
  const field = issue.path.length ? "«" + issue.path.join(".") + "»" : "la petición";
  if (issue.code === "custom" || (issue.code === "invalid_string" && !/^Invalid/.test(issue.message)))
    return "Revisa los datos: " + field + ": " + issue.message;
  return "Revisa los datos: " + field + " " + (MESSAGES[issue.code]?.(issue) || "no es válido") + ".";
}
const check = (schema, input) => schema.parse(input ?? {});
// Desktop-only for now: bots work on this computer and there is no mobile channel.
const LATER = "Disponible más adelante.";
function desktopOnly(bot) {
  if (bot.location === "nube") throw new HttpError(422, LATER);
  if (bot.channels?.movil === true) throw new HttpError(422, LATER);
  return bot;
}
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

// ------------------------------------------------------- folder policy
const fold = (p) => {
  const r = path.resolve(p).replace(/[\\/]+$/, "") || path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

// ------------------------------------------------------------- the app
/** Picks the «Sobre <Nombre>: …» paragraph of a critique; whole text if the bot ignored the format. */
export function critiqueAbout(text, name) {
  if (!name) return text;
  const fold = (v) => String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const parts = String(text).split(/\n?\s*(?=(?:\*\*)?Sobre\s+[^:\n]{1,40}:)/i);
  const hit = parts.find((p) => fold(p).replace(/\*/g, "").trim().startsWith("sobre " + fold(name)));
  return hit ? hit.replace(/^(?:\*\*)?Sobre\s+[^:\n]{1,40}:(?:\*\*)?\s*/i, "").trim() : text;
}

export {
  notFound, SOON, short, attachment, instructions, email, botCreate, botPatch, draftBase, missionCreate, automationCreate, automationPatch,
  folderFields, personFields, check, desktopOnly, pick, safe, fold, inside,
};
