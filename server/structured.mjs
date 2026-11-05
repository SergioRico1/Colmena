// Structured results between bots: a delegate (ask_bot tasks) or a plan part may be asked to
// return JSON matching an `outputSchema` — a small JSON Schema subset, like DeepSeek Harness'
// enforced subset (dsh-tools/json-schema): type, properties, required, additionalProperties
// (boolean), items, enum, const, oneOf, min/maxItems, min/maxLength, minimum/maximum, and the
// annotations description, title, default and examples. Anything else is refused up front
// instead of being accepted without enforcement.

export const SCHEMA_MAX = 8000;
const MAX_DEPTH = 8;
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const ANNOTATIONS = new Set(["description", "title", "default", "examples"]);
const KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "oneOf", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", ...ANNOTATIONS]);
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const scalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

/** Every problem of a schema node (empty list: supported). */
function schemaProblems(node, at = "esquema", depth = 0) {
  if (!isObject(node)) return [at + ": debe ser un objeto"];
  if (depth > MAX_DEPTH) return [at + ": demasiado anidado (máx. " + MAX_DEPTH + " niveles)"];
  const out = [];
  for (const key of Object.keys(node)) if (!KEYWORDS.has(key)) out.push(at + ": «" + key + "» no está admitido");
  if (node.type !== undefined && !TYPES.has(node.type)) out.push(at + ".type: usa uno de " + [...TYPES].join(", "));
  if (node.properties !== undefined) {
    if (!isObject(node.properties) || (node.type && node.type !== "object")) out.push(at + ".properties: solo en objetos");
    else for (const [name, child] of Object.entries(node.properties)) out.push(...schemaProblems(child, at + "." + name, depth + 1));
  }
  if (node.required !== undefined && (!Array.isArray(node.required) || node.required.some((r) => typeof r !== "string" || !isObject(node.properties) || !(r in node.properties))))
    out.push(at + ".required: lista de nombres que estén en properties");
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== "boolean") out.push(at + ".additionalProperties: true o false");
  if (node.items !== undefined) {
    if (node.type && node.type !== "array") out.push(at + ".items: solo en listas");
    else out.push(...schemaProblems(node.items, at + "[]", depth + 1));
  }
  if (node.enum !== undefined && (!Array.isArray(node.enum) || !node.enum.length || !node.enum.every(scalar))) out.push(at + ".enum: lista de valores simples");
  if (node.const !== undefined && !scalar(node.const)) out.push(at + ".const: un valor simple");
  if (node.oneOf !== undefined) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) out.push(at + ".oneOf: al menos dos opciones");
    else node.oneOf.forEach((child, i) => out.push(...schemaProblems(child, at + ".oneOf[" + i + "]", depth + 1)));
  }
  for (const key of ["minItems", "maxItems", "minLength", "maxLength"])
    if (node[key] !== undefined && !(Number.isInteger(node[key]) && node[key] >= 0)) out.push(at + "." + key + ": un entero ≥ 0");
  for (const key of ["minimum", "maximum"]) if (node[key] !== undefined && typeof node[key] !== "number") out.push(at + "." + key + ": un número");
  return out;
}

/**
 * The schema a bot wrote as text (tools are strict: a JSON Schema travels as a string).
 * Returns {schema} (null when empty) or {error} in Spanish, for the bot to fix it.
 */
export function parseOutputSchema(text) {
  const raw = typeof text === "string" ? text.trim() : text && typeof text === "object" ? JSON.stringify(text) : "";
  if (!raw) return { schema: null };
  if (raw.length > SCHEMA_MAX) return { error: "outputSchema es demasiado largo (máx. " + SCHEMA_MAX + " caracteres)." };
  let schema;
  try { schema = JSON.parse(raw); } catch { return { error: "outputSchema no es JSON válido." }; }
  const problems = schemaProblems(schema);
  if (problems.length) return { error: "outputSchema no válido — " + problems.slice(0, 6).join("; ") + "." };
  return { schema };
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const fits = (type, v) => type === typeOf(v) || (type === "number" && typeof v === "number" && Number.isFinite(v));

/** Every mismatch between `value` and `schema` (paths in the bot's terms), at most `limit`. */
export function validateOutput(schema, value, at = "$", out = [], limit = 12) {
  if (out.length >= limit || !isObject(schema)) return out;
  const push = (text) => { if (out.length < limit) out.push(at + ": " + text); };
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => !validateOutput(branch, value, at, [], 1).length).length;
    if (matches !== 1) push(matches ? "cumple más de una opción de oneOf" : "no cumple ninguna opción de oneOf");
    return out;
  }
  if (schema.type && !fits(schema.type, value)) { push("debe ser " + schema.type + " y es " + typeOf(value)); return out; }
  if (schema.const !== undefined && value !== schema.const) push("debe valer " + JSON.stringify(schema.const));
  if (schema.enum && !schema.enum.includes(value)) push("debe ser uno de " + schema.enum.map((v) => JSON.stringify(v)).join(", "));
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) push("demasiado corto (mín. " + schema.minLength + ")");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) push("demasiado largo (máx. " + schema.maxLength + ")");
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) push("menor que " + schema.minimum);
    if (schema.maximum !== undefined && value > schema.maximum) push("mayor que " + schema.maximum);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) push("necesita al menos " + schema.minItems + " elementos");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) push("admite como mucho " + schema.maxItems + " elementos");
    if (schema.items) value.forEach((item, i) => validateOutput(schema.items, item, at + "[" + i + "]", out, limit));
  }
  if (isObject(value)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    for (const name of schema.required || []) if (!(name in value)) push("falta «" + name + "»");
    for (const [name, v] of Object.entries(value)) {
      if (props[name]) validateOutput(props[name], v, at + "." + name, out, limit);
      else if (schema.additionalProperties === false) push("«" + name + "» no está en el esquema");
    }
  }
  return out;
}

/**
 * The JSON in a bot's answer: the whole answer, or its last ```json block (any prose around
 * it is kept as `prose`). {value, prose} or {error}.
 */
export function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return { error: "la respuesta está vacía" };
  try { return { value: JSON.parse(raw), prose: "" }; } catch {}
  const blocks = [...raw.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)];
  for (const block of blocks.reverse()) {
    try { return { value: JSON.parse(block[1].trim()), prose: raw.replace(block[0], "").trim() }; } catch {}
  }
  // A JSON object or list with a sentence before or after it.
  const start = raw.search(/[[{]/), end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start >= 0 && end > start) try { return { value: JSON.parse(raw.slice(start, end + 1)), prose: (raw.slice(0, start) + " " + raw.slice(end + 1)).trim() }; } catch {}
  return { error: "no contiene JSON válido" };
}

/** A bot's answer checked against `schema`: {ok, value, prose} or {ok: false, errors}. */
export function checkStructured(schema, text) {
  const found = extractJson(text);
  if (found.error) return { ok: false, errors: [found.error] };
  const errors = validateOutput(schema, found.value);
  return errors.length ? { ok: false, errors } : { ok: true, value: found.value, prose: found.prose };
}

/** What the bot reads when its result must be JSON (first ask and the one repair). */
export function schemaNote(schema) {
  return "Entrega tu resultado como JSON que cumpla este esquema (JSON Schema), solo el JSON o en un bloque ```json:\n" + JSON.stringify(schema);
}
export function repairNote(schema, errors) {
  return "[Colmena] Tu resultado no cumple el formato pedido (" + errors.slice(0, 6).join("; ") + "). Responde ahora solo con el JSON corregido que cumpla este esquema, sin herramientas:\n" + JSON.stringify(schema);
}
