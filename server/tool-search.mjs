// Tools on demand. Every model call lists the definitions of every tool the bot may use; a
// bot with the computer, projects and connected apps carries 70+ of them (~23 000 tokens,
// scripts/measure-tools.mjs) on every round. Above a threshold only a CORE set is listed —
// what almost every turn needs, plus the gateways whose approvals people already know — and
// the long tail goes behind two tools:
//   find_tools({query})          ranked matches among the bot's OWN tools (local BM25, no model call)
//   use_tool({name, arguments})  the real tool, through the same execution path as a direct call
// use_tool is not a second way in: the runtime turns a valid use_tool call into the real call
// before anything runs (Runtime#unwrapToolUse), so permissions, approvals, red lines, receipts
// and tool cards see the real name and arguments. A name outside the bot's tools, or
// arguments that do not fit the real schema, never run: the bot reads why and fixes it.
//
// How it lives with the other searches (nothing is duplicated):
//   find_tools   what Colmena already has loaded for this bot (built-ins, computer, projects,
//                the direct tools of connected apps). Local, instant.
//   apps_search  Composio's whole catalogue, for actions of a connected app that are NOT
//                loaded as a tool (server/nexo/composio.mjs). Remote. Runs with apps_execute.
//   mcp_tools    the tools of one MCP server (server/mcp/tools.mjs). Runs with mcp_call.
// The three gateways stay in the core list, so their flows are exactly as before.
//
// The list is fixed for a whole step (as before): changing it would end the cached prompt
// prefix, drop the warm socket's continuation and restart a Claude Code session. Tools a bot
// used through use_tool are listed directly from its NEXT step in the same mission (within a
// cap); inside the step it keeps calling use_tool with the name it already knows.

import { isAppToolName } from "./apptools.mjs";

export const FIND_TOOLS = "find_tools";
export const USE_TOOL = "use_tool";
export const isMetaTool = (name) => name === FIND_TOOLS || name === USE_TOOL;

export const TOOL_SEARCH = Object.freeze({
  threshold: 32,     // up to this many tools nothing changes: everything is listed
  minDeferred: 6,    // fewer than this behind the search is not worth two more tools
  directApps: 4,     // direct tools of connected apps that stay listed (the most used first)
  promoted: 8,       // tools used through use_tool that stay listed in the bot's next steps
  results: 6,        // matches per search
  detailChars: 7000, // full description + schema for the best matches, up to this many characters
  names: 60,         // names of unlisted tools written in the system prompt
});

// Always listed (when the bot has them). Why each group is here:
export const CORE_TOOLS = new Set([
  // Answering and asking the person; reacting instead of an empty message.
  "ask_user", "react",
  // Memory and skills: the system prompt tells every bot to use them by name.
  "recall", "remember", "list_skills", "read_skill",
  // The files and deliverables of the mission, and the conversation itself.
  "list_files", "read_file", "write_file", "create_deliverable", "read_deliverable", "mission_brief", "read_thread", "search_history",
  // The web and the folders the person shared.
  "web_fetch", "list_folder", "read_folder_file",
  // Delegation and planning.
  "ask_bot", "message_bot", "propose_plan", "code_task", "ask_peer_bot",
  // Gateways with their own search and their own review: connected apps (Composio) and MCP.
  "apps_accounts", "apps_search", "apps_describe", "apps_execute", "apps_table", "mcp_tools", "mcp_call",
  // Commands always wait for the person, and the prompt («Código») names the tool.
  "run_command",
]);

/** The two definitions, written for the tools that are not listed in this step. */
export function metaToolDefs(deferred, { apps = false, mcp = false } = {}) {
  const more = (apps ? " No busca en el catálogo de las apps conectadas: para una acción de Gmail, Calendar, etc. que no tengas, apps_search." : "") + (mcp ? " Para las apps conectadas por MCP, mcp_tools." : "");
  return [
    {
      type: "function", name: FIND_TOOLS, strict: true,
      description: "Busca entre tus herramientas que no aparecen en la lista (" + deferred.length + " más) por lo que quieres hacer, en español o en inglés («enviar correo», «fill form», «captura de pantalla»). Devuelve las que mejor encajan con su nombre, qué hacen y sus parámetros; después úsala con use_tool." + more,
      parameters: { type: "object", properties: { query: { type: "string", description: "Qué quieres hacer, en pocas palabras, o el nombre de la herramienta." } }, required: ["query"], additionalProperties: false },
    },
    {
      type: "function", name: USE_TOOL, strict: false,
      description: "Usa una de tus herramientas que no aparece en la lista, por su nombre exacto (el que da find_tools). Es lo mismo que llamarla directamente: mismos permisos, mismas revisiones de la persona y mismo resultado. Si los argumentos no cumplen su esquema, te dice cuáles para que lo corrijas.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre exacto de la herramienta." },
          arguments: { type: "object", description: "Sus argumentos, como un objeto que cumple su esquema.", additionalProperties: true },
        },
        required: ["name", "arguments"],
      },
    },
  ];
}

/**
 * What a step lists and what stays behind the search: {listed, deferred, active}. `all` is
 * everything the bot may call (Runtime#toolsForStep); `promoted` the names it used through
 * use_tool earlier in the mission. Below the threshold, or switched off, `listed` is `all`.
 */
export function splitTools(all, { enabled = true, promoted = [], limits = TOOL_SEARCH } = {}) {
  const list = Array.isArray(all) ? all : [];
  const whole = { listed: list, deferred: [], active: false };
  if (!enabled || list.length <= limits.threshold) return whole;
  const keep = new Set(promoted);
  let apps = 0;
  const direct = (tool) => {
    if (CORE_TOOLS.has(tool.name) || keep.has(tool.name)) return true;
    // Connected apps put their most used action first (apptools.mjs): a few stay at hand.
    return isAppToolName(tool.name) && apps++ < limits.directApps;
  };
  const listed = [], deferred = [];
  for (const tool of list) (direct(tool) ? listed : deferred).push(tool);
  if (deferred.length < limits.minDeferred) return whole;
  const has = (name) => list.some((t) => t.name === name);
  return { listed: [...listed, ...metaToolDefs(deferred, { apps: has("apps_search"), mcp: has("mcp_tools") })], deferred, active: true };
}

/** The paragraph of the system prompt that says more tools exist and how to reach them. */
export function toolsNote(deferred, { apps = false, limits = TOOL_SEARCH } = {}) {
  if (!deferred?.length) return "";
  const names = deferred.slice(0, limits.names).map((t) => t.name).join(", ") + (deferred.length > limits.names ? " y " + (deferred.length - limits.names) + " más" : "");
  return "\n\n# Más herramientas\nAdemás de las de la lista tienes estas, que no se cargan en cada llamada: " + names + ". " +
    "Cuando necesites una, llama a find_tools con lo que quieres hacer (te da su nombre y sus parámetros) y después a use_tool con ese nombre y sus argumentos: es lo mismo que llamarla directamente, con los mismos permisos y las mismas revisiones de la persona. " +
    "Si ya sabes su nombre y sus parámetros porque la buscaste antes, no la busques otra vez." +
    (apps ? " Las acciones de tus apps conectadas que no estén ni en la lista ni aquí se buscan con apps_search, no con find_tools." : "");
}

// ------------------------------------------------------------------ lexical ranking (BM25)
const fold = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set(("de la el los las un una unos unas en con para por que y o a al del lo se su sus mi mis me te tu es son como quiero necesito puedo hacer algo " +
  "the to of in for and an my is are how do i want need can some with from on it this that herramienta herramientas tool tools").split(" "));
const SUFFIXES = [["ciones", "cion"], ["mente", ""], ["iendo", ""], ["ando", ""], ["ing", ""], ["ados", ""], ["idos", ""], ["ado", ""], ["ido", ""], ["ar", ""], ["er", ""], ["ir", ""], ["es", ""], ["s", ""], ["a", ""], ["o", ""], ["e", ""]];
/** A light stem for Spanish and English: «enviar», «envía» and «envío» meet, «emails» and «email» too. */
const stem = (word) => {
  if (word.length <= 3) return word;
  for (const [suffix, put] of SUFFIXES)
    if (word.endsWith(suffix) && word.length - suffix.length + put.length >= 3) return word.slice(0, word.length - suffix.length) + put;
  return word;
};
// Words that mean the same thing in a tool's name (English) and in what a person asks (Spanish).
const SYNONYMS = [
  "correo correos email emails mail", "enviar envia envio mandar manda send", "calendario calendar agenda", "evento event cita reunion meeting",
  "hoja spreadsheet excel sheet sheets xlsx", "navegador browser", "pagina page sitio website", "captura screenshot pantallazo", "archivo fichero file",
  "carpeta folder directorio", "borrar eliminar delete remove quitar", "buscar busca search find encontrar", "leer lee read lectura", "escribir escribe write",
  "crear crea create nuevo new generar", "abrir abre open", "descargar download bajar", "proyecto project", "imagen image foto picture dibujo",
  "presentacion diapositiva diapositivas slides slide deck powerpoint pptx", "documento document word docx informe", "formulario form", "clave secret token credencial apikey",
  "borrador draft", "responder reply contestar respuesta", "escritorio desktop", "ventana window", "ejecutar run correr lanzar", "comando command programa program",
  "instalar install", "automatizacion automation rutina", "objetivo goal", "clic click pulsar", "rellenar fill completar", "lista listar list", "servidor server",
  "tabla table", "actualizar update modificar editar edit cambiar", "aplicacion app application", "sesion login acceso", "vista preview previsualizar", "pdf", "api http endpoint",
];
const CANON = new Map();
for (const group of SYNONYMS) {
  const words = group.split(" ");
  for (const word of words) CANON.set(stem(word), stem(words[0]));
}
/** Folded, split (snake_case and camelCase too), without filler words, stemmed, synonyms joined. */
export function termsOf(value) {
  return String(value ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).flatMap((part) => fold(part).split(/[^a-z0-9]+/))
    .filter((word) => word.length >= 2 && !STOP.has(word))
    .map((word) => { const s = stem(word); return CANON.get(s) || s; });
}

const K1 = 1.2, B = 0.75, NAME_WEIGHT = 3;
const oneLine = (value, max) => { const s = String(value ?? "").replace(/\s+/g, " ").trim(); return s.length > max ? s.slice(0, max - 1) + "…" : s; };

/**
 * BM25 over the tools' names (weighted), descriptions and parameter names. Returns
 * [{tool, score}] best first, only matches. A query that is (or contains) a tool's exact name
 * puts that tool first; a word that only starts like an indexed one counts half.
 */
export function rankTools(query, tools, { limit = TOOL_SEARCH.results } = {}) {
  const list = (Array.isArray(tools) ? tools : []).filter((t) => t?.name);
  const docs = list.map((tool) => {
    const tf = new Map();
    const add = (terms, weight) => { for (const term of terms) tf.set(term, (tf.get(term) || 0) + weight); };
    add(termsOf(tool.name), NAME_WEIGHT);
    add(termsOf(tool.description), 1);
    add(termsOf(Object.keys(tool.parameters?.properties || {}).join(" ")), 1);
    return { tool, tf, length: [...tf.values()].reduce((a, n) => a + n, 0) };
  });
  const average = docs.reduce((a, d) => a + d.length, 0) / (docs.length || 1) || 1;
  const df = new Map();
  for (const doc of docs) for (const term of doc.tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  const wanted = [...new Set(termsOf(query))];
  const literal = fold(query).trim();
  const scored = docs.map((doc) => {
    let score = 0;
    for (const term of wanted) {
      // The word itself, or (half) the indexed words it starts — «calend» for «calendario».
      const hits = doc.tf.has(term) ? [[term, 1]] : term.length >= 4 ? [...doc.tf.keys()].filter((k) => k.startsWith(term) || (k.length >= 4 && term.startsWith(k))).map((k) => [k, 0.5]) : [];
      for (const [key, weight] of hits) {
        const n = df.get(key) || 0, f = doc.tf.get(key);
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        score += weight * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (doc.length / average))));
      }
    }
    const name = fold(doc.tool.name);
    if (literal === name) score += 1000;
    else if (literal.split(/[^a-z0-9_]+/).includes(name)) score += 100;
    return { tool: doc.tool, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ------------------------------------------------------------------ parameters and their check
const typeName = (schema) => {
  if (!schema || typeof schema !== "object") return "cualquiera";
  if (Array.isArray(schema.enum)) return schema.enum.slice(0, 8).map((v) => String(v)).join("|") + (schema.enum.length > 8 ? "|…" : "");
  const type = Array.isArray(schema.type) ? schema.type.join("|") : schema.type;
  if (type === "array") return "lista de " + typeName(schema.items);
  if (type === "object") return "objeto" + (schema.properties ? " {" + Object.keys(schema.properties).slice(0, 8).join(", ") + "}" : "");
  return { string: "texto", integer: "entero", number: "número", boolean: "sí/no" }[type] || type || "cualquiera";
};
/** «url (texto)*, mode (texto|elementos)*, fields (lista de objeto {ref, value})» — * = obligatorio. */
export function paramSummary(parameters, max = 600) {
  const props = parameters?.properties && typeof parameters.properties === "object" ? parameters.properties : {};
  const required = new Set(Array.isArray(parameters?.required) ? parameters.required : []);
  const parts = Object.entries(props).map(([name, schema]) => name + " (" + typeName(schema) + ")" + (required.has(name) ? "*" : ""));
  return parts.length ? oneLine(parts.join(", "), max) + (required.size ? " — * obligatorio" : "") : "sin parámetros";
}

const kindOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const fits = (type, v) => type === kindOf(v) || (type === "number" && typeof v === "number" && Number.isFinite(v));
const SPANISH = { string: "un texto", integer: "un número entero", number: "un número", boolean: "true o false", array: "una lista", object: "un objeto", null: "null" };
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Every mismatch between `value` and a tool's JSON Schema, in the bot's terms («fields[0].ref:
 * falta»). Checks what the definitions use: type (one or several), enum, const, properties,
 * required, additionalProperties (false or a schema), items, anyOf/oneOf and the usual limits.
 * Keywords it does not know are ignored, never a reason to refuse.
 */
export function schemaProblems(schema, value, at = "", out = [], limit = 8) {
  if (out.length >= limit || !isObject(schema)) return out;
  const where = at || "argumentos";
  const push = (problem) => { if (out.length < limit) out.push(where + ": " + problem); };
  const options = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (options && !options.some((branch) => !schemaProblems(branch, value, at, [], 1).length)) { push("no cumple ninguna de las formas admitidas"); return out; }
  const types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some((t) => fits(t, value))) { push("tiene que ser " + types.map((t) => SPANISH[t] || t).join(" o ") + " y es " + (SPANISH[kindOf(value)] || kindOf(value))); return out; }
  if (schema.const !== undefined && value !== schema.const) push("tiene que valer " + JSON.stringify(schema.const));
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) push("tiene que ser uno de " + schema.enum.slice(0, 12).map((v) => JSON.stringify(v)).join(", "));
  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) push("demasiado corto (mín. " + schema.minLength + ")");
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) push("demasiado largo (máx. " + schema.maxLength + ")");
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) push("menor que " + schema.minimum);
    if (typeof schema.maximum === "number" && value > schema.maximum) push("mayor que " + schema.maximum);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) push("necesita al menos " + schema.minItems + " elementos");
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) push("admite como mucho " + schema.maxItems + " elementos");
    if (isObject(schema.items)) value.forEach((item, i) => schemaProblems(schema.items, item, at + "[" + i + "]", out, limit));
  }
  if (isObject(value)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    const path = (name) => (at ? at + "." + name : name);
    for (const name of Array.isArray(schema.required) ? schema.required : []) if (!(name in value) && out.length < limit) out.push(path(name) + ": falta");
    for (const [name, v] of Object.entries(value)) {
      if (Object.hasOwn(props, name)) schemaProblems(props[name], v, path(name), out, limit);
      else if (schema.additionalProperties === false) { if (out.length < limit) out.push(path(name) + ": no existe en esta herramienta"); }
      else if (isObject(schema.additionalProperties)) schemaProblems(schema.additionalProperties, v, path(name), out, limit);
    }
  }
  return out;
}

// ------------------------------------------------------------------ the two tools
/**
 * find_tools: the best matches among `all` (the bot's own tools). The first ones carry their
 * whole description and schema (what the bot needs to call them right); the rest one line and
 * a summary of their parameters. `listed` marks the ones it can already call directly.
 */
export function findTools(query, all, { listed = [], limits = TOOL_SEARCH } = {}) {
  const pool = (Array.isArray(all) ? all : []).filter((t) => t?.name && !isMetaTool(t.name));
  const direct = new Set(listed.map((t) => t.name));
  const hits = rankTools(query, pool, { limit: limits.results });
  const has = (name) => pool.some((t) => t.name === name);
  const elsewhere = (has("apps_search") ? " Para una acción de una app conectada que no esté entre tus herramientas: apps_search." : "") + (has("mcp_tools") ? " Para una app conectada por MCP: mcp_tools." : "");
  if (!hits.length) return { tools: [], total: pool.length, message: "Ninguna de tus herramientas encaja con eso. Prueba con otras palabras: la acción («enviar», «crear», «abrir») o el nombre de la app." + elsewhere };
  let budget = limits.detailChars;
  const tools = hits.map(({ tool }, i) => {
    const entry = {
      name: tool.name,
      description: oneLine(tool.description, 220),
      parameters: paramSummary(tool.parameters),
      use: direct.has(tool.name) ? "está en tu lista: llámala directamente" : "use_tool({name: \"" + tool.name + "\", arguments: {…}})",
    };
    const size = String(tool.description || "").length + JSON.stringify(tool.parameters || {}).length;
    // The best match always comes whole; the next ones while there is room.
    if (!direct.has(tool.name) && (i === 0 || size <= budget)) {
      budget -= size;
      entry.full_description = String(tool.description || "");
      entry.schema = tool.parameters || { type: "object", properties: {} };
    }
    return entry;
  });
  return { tools, total: pool.length, notice: "Usa los nombres tal cual. Para el esquema completo de otra, búscala por su nombre." + elsewhere };
}

/**
 * A use_tool call → the real call, or why not: {name, arguments (JSON text), tool} | {error}.
 * `all` is everything the bot may call directly: a name outside it never resolves, whatever
 * the arguments. The arguments must fit the real tool's schema.
 */
export function resolveToolUse(rawArguments, all) {
  let input;
  try { input = typeof rawArguments === "string" ? JSON.parse(rawArguments || "{}") : rawArguments; } catch { return { error: "use_tool: los argumentos no son un JSON válido. Forma: {\"name\": \"herramienta\", \"arguments\": {…}}." }; }
  if (!isObject(input) || typeof input.name !== "string" || !input.name.trim()) return { error: "use_tool: falta «name», el nombre exacto de la herramienta (el que da find_tools)." };
  const name = input.name.trim();
  const pool = (Array.isArray(all) ? all : []).filter((t) => t?.name && !isMetaTool(t.name));
  const tool = pool.find((t) => t.name === name);
  if (!tool) {
    const near = rankTools(name.replace(/_/g, " "), pool, { limit: 3 }).map((x) => x.tool.name);
    return { error: "«" + oneLine(name, 80) + "» no es una de tus herramientas" + (near.length ? " (¿" + near.join(", ") + "?)" : "") + ". Búscala con find_tools y usa el nombre tal cual." };
  }
  let args = input.arguments ?? {};
  // Some models write the object as text: read it once, never guess further.
  if (typeof args === "string") try { args = args.trim() ? JSON.parse(args) : {}; } catch { return { error: "use_tool: «arguments» tiene que ser un objeto JSON con los argumentos de " + name + "." }; }
  if (!isObject(args)) return { error: "use_tool: «arguments» tiene que ser un objeto con los argumentos de " + name + ": " + paramSummary(tool.parameters) + "." };
  const problems = schemaProblems(tool.parameters && typeof tool.parameters === "object" ? { type: "object", ...tool.parameters } : null, args);
  if (problems.length)
    return { error: "Argumentos no válidos para " + name + " — " + problems.join("; ") + ". Sus parámetros: " + paramSummary(tool.parameters) + ". Corrígelos y vuelve a llamar a use_tool." };
  return { name, arguments: JSON.stringify(args), tool };
}

/** For a tool card: the call a use_tool that did not get through was aiming at ({name, args}), or null. */
export function wrappedCall(args) {
  if (!isObject(args) || typeof args.name !== "string" || !args.name.trim() || isMetaTool(args.name.trim())) return null;
  let inner = args.arguments;
  if (typeof inner === "string") try { inner = JSON.parse(inner); } catch { inner = {}; }
  return { name: args.name.trim(), args: isObject(inner) ? inner : {} };
}
