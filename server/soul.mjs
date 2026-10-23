import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, lstatSync } from "node:fs";
import { standingOrdersText } from "./standing.mjs";
import path from "node:path";
import { memoryEntries, memoryMeters, profileDigest, MEMORY_LIMITS } from "./memory.mjs";
import { recordVersion } from "./doc-history.mjs";

// OpenClaw-style workspace per bot: <dataDir>/bots/<id>/{SOUL,IDENTITY,USER,MEMORY}.md.
// SOUL.md is the user's to edit. Bots can only propose changes (approval kind 'soul').
// prompts/SOUL.md stays byte-for-byte as the MIT-licensed reference and is never sent.
const template = (name) => readFileSync(new URL("../prompts/" + name, import.meta.url), "utf8");
const TEMPLATES = {
  soul: template("SOUL.colmena.md"),
  agents: template("AGENTS.colmena.md"),
  identity: template("IDENTITY.colmena.md"),
  user: template("USER.colmena.md"),
  memory: template("MEMORY.colmena.md"),
};

export const AUTONOMY_LABELS = { sugiere: "Solo sugiere", avisa: "Actúa y te avisa", solo: "Actúa solo" };
export const THINKING_LABELS = { rapido: "Rápida", equilibrado: "Equilibrada", profundo: "Profunda" };
const SHAPES = { hex: "hexágono", circle: "círculo", square: "cuadrado", diamond: "rombo", arch: "arco", leaf: "hoja" };
export const SOUL_LIMITS = { min: 20, max: 20000 };
const MEMORY_BUDGET = 4000;

let dataDirectory = null;
let dataStore = null;
/** The Runtime sets this once with the store directory (and the store, to render missing SOULs). */
export function useDataDirectory(directory, store = null) {
  dataDirectory = directory;
  dataStore = store;
}

function fill(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in values ? String(values[key] ?? "") : all));
}

export function botDirectory(botId, directory = dataDirectory) {
  if (!directory) throw Error("Espacio de trabajo no configurado.");
  if (typeof botId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(botId)) throw Error("Bot no válido.");
  return path.join(directory, "bots", botId);
}

function atomicWrite(file, text) {
  try {
    if (lstatSync(file).isSymbolicLink()) throw Error("No se permiten enlaces simbolicos.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temp = file + "." + process.pid + "." + Date.now() + ".tmp";
  writeFileSync(temp, text, "utf8");
  renameSync(temp, file);
}

export function renderSoulTemplate(bot) {
  return fill(TEMPLATES.soul, { name: bot?.name || "un bot", role: (bot?.role || "especialista").toLowerCase() });
}

export function autonomyOf(bot) {
  return ["sugiere", "avisa", "solo"].includes(bot?.autonomy) ? bot.autonomy : "avisa";
}

const band = (value) => (typeof value !== "number" ? 1 : value < 34 ? 0 : value > 66 ? 2 : 1);
/** Translates the 0..100 personality sliders into concrete style guidance. */
export function personalityHints(personality) {
  if (!personality) return [];
  const tono = [
    "Tono formal: trato respetuoso, frases completas, sin coloquialismos.",
    "Tono profesional y natural.",
    "Tono cercano: tutea, cálido y directo, sin perder precisión.",
  ][band(personality.tono)];
  const detalle = [
    "Breve: ve al grano, como mucho unas pocas viñetas; ofrece ampliar si hace falta.",
    "Detalle equilibrado: lo esencial más el porqué cuando ayude.",
    "Detallado: explica el razonamiento, alternativas y ejemplos concretos.",
  ][band(personality.detalle)];
  const riesgo = [
    "Prudente: señala riesgos, prefiere opciones seguras y pregunta ante dudas importantes.",
    "Equilibrio entre prudencia e iniciativa.",
    "Atrevido: propone ideas audaces y decide con información parcial, sin saltarte nunca las líneas rojas.",
  ][band(personality.riesgo)];
  return [tono, detalle, riesgo];
}

function personalityLine(personality) {
  return personalityHints(personality).map((x) => x.split(":")[0].replace(/\.$/, "")).join(" · ") || "Por defecto";
}

/**
 * Memories the bot may see, per bounded store (Hermes MEMORY.md / USER.md):
 * personal = «Lo que sabes de la persona», team = «Lo que sabe el equipo», own = its
 * own memory. Newest first, each store within its limit. `meters` carries the usage
 * label shown in the prompt («67 % — 940/1400») and `profile` the active USER.md lines.
 */
/**
 * Facts and procedures (learning.mjs): a fact a bot deduced in another task is marked to be
 * checked again before it is relied on (facts change); a procedure is marked to be followed.
 */
export function memoryTag(m, missionId = null) {
  if (m.nature === "procedimiento") return " [cómo]";
  const deduced = !["dijiste", "importado"].includes(m.source) && m.origin !== "persona";
  return deduced && m.missionId && m.missionId !== missionId ? " [compruébalo]" : "";
}

export function memoryDigest(store, bot, budget = MEMORY_BUDGET, { directory = dataDirectory, missionId = null } = {}) {
  const lines = (target) => {
    const out = [];
    let used = 0;
    for (const m of memoryEntries(store, target, bot.id).reverse()) {
      // Saved after reading outside content and not confirmed yet: kept out of the prompt.
      if (m.origin === "externo" && m.review) continue;
      const text = m.text.replace(/\s+/g, " ").trim().slice(0, 500);
      if (used + text.length > Math.max(MEMORY_LIMITS[target], 0) && out.length) {
        out.push("- (hay más recuerdos en la Biblioteca)");
        break;
      }
      used += text.length;
      out.push("- " + text + memoryTag(m, missionId) + (m.review ? " (por revisar)" : ""));
    }
    return out;
  };
  void budget;
  return { personal: lines("user"), team: lines("memory"), own: lines("bot"), meters: memoryMeters(store, bot.id), profile: profileDigest(directory) };
}

/** Index of active skills: «- id: nombre (vN) — Úsala cuando…». Stale/archived skills stay out. */
export function skillIndex(store, bot) {
  return store
    .list("skills")
    .filter((s) => s.status === "active" && (!s.botId || s.botId === bot.id))
    .slice(-40)
    .map((s) => `- ${s.id}: ${s.name} (v${s.version || 1}) — ${s.description}`);
}

/** Creates the bot folder, its editable SOUL.md if missing, and derived IDENTITY/USER/MEMORY. */
export function ensureWorkspace(bot, { store = null, directory = dataDirectory } = {}) {
  const folder = botDirectory(bot.id, directory);
  mkdirSync(folder, { recursive: true });
  const soulFile = path.join(folder, "SOUL.md");
  if (!existsSync(soulFile)) atomicWrite(soulFile, renderSoulTemplate(bot));
  const identity = fill(TEMPLATES.identity, {
    name: bot.name,
    role: bot.role,
    shape: SHAPES[bot.shape] || bot.shape || "",
    color: bot.color || "",
    personality: personalityLine(bot.personality),
    autonomy: AUTONOMY_LABELS[autonomyOf(bot)],
    thinking: THINKING_LABELS[bot.thinking] || THINKING_LABELS.equilibrado,
  });
  writeIfChanged(path.join(folder, "IDENTITY.md"), identity);
  if (store) {
    const settings = store.get("settings", "main") || {};
    writeIfChanged(path.join(folder, "USER.md"), fill(TEMPLATES.user, {
      userName: settings.userName || "Tu cuenta",
      userRole: settings.userRole || "Administrador",
      spaceName: settings.spaceName || "Colmena",
    }));
    const { personal, team, own, profile } = memoryDigest(store, bot, MEMORY_BUDGET, { directory });
    writeIfChanged(path.join(folder, "MEMORY.md"), fill(TEMPLATES.memory, {
      personal: [...profile, ...personal].join("\n") || "_Nada todavía._",
      team: team.join("\n") || "_Nada todavía._",
      own: own.join("\n") || "_Nada todavía._",
    }));
  }
  return folder;
}

function writeIfChanged(file, text) {
  try {
    if (readFileSync(file, "utf8") === text) return;
  } catch {}
  atomicWrite(file, text);
}

/** Current SOUL.md of a bot; if it was never written, the Colmena template for that bot. */
export function readSoul(botId, { directory = dataDirectory, bot = null } = {}) {
  try {
    return readFileSync(path.join(botDirectory(botId, directory), "SOUL.md"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const record = bot || (directory === dataDirectory ? dataStore?.get?.("bots", botId) : null);
    return record ? renderSoulTemplate(record) : null;
  }
}

/**
 * Writes a bot's SOUL.md and keeps a version of it (doc-history.mjs): `source` says who
 * changed it (tú, propuesta, restaurado) and `reason` why, for «Restaurar» in its profile.
 */
export function writeSoul(botId, text, { directory = dataDirectory, store = directory === dataDirectory ? dataStore : null, source = "tú", reason = null, approvalId = null } = {}) {
  if (typeof text !== "string" || text.trim().length < SOUL_LIMITS.min || text.length > SOUL_LIMITS.max)
    throw Error("El SOUL debe tener entre 20 y 20000 caracteres.");
  const folder = botDirectory(botId, directory);
  mkdirSync(folder, { recursive: true });
  const normalized = text.replace(/\r\n/g, "\n");
  const file = path.join(folder, "SOUL.md");
  let previous = null;
  try { previous = readFileSync(file, "utf8"); } catch {}
  if (previous == null && store) {
    const bot = store.get?.("bots", botId);
    if (bot) previous = renderSoulTemplate(bot);
  }
  atomicWrite(file, normalized);
  try { if (store) recordVersion(store, { doc: "soul", botId, content: normalized, previous, source, reason, approvalId }); } catch {}
  return { soul: normalized };
}

/** Line diff (LCS) for soul proposals: [{op:' '|'+'|'-', line}]. */
export function lineDiff(before, after) {
  const a = String(before || "").split("\n").slice(0, 1500), b = String(after || "").split("\n").slice(0, 1500);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: " ", line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", line: a[i++] });
    else out.push({ op: "+", line: b[j++] });
  }
  while (i < n) out.push({ op: "-", line: a[i++] });
  while (j < m) out.push({ op: "+", line: b[j++] });
  return out;
}

/** Applies a soul proposal: full documents replace, short notes are appended to the soul. */
export function proposedSoul(current, proposal) {
  const text = String(proposal || "").replace(/\r\n/g, "\n").trim();
  if (!text) return current;
  if (/^#\s*SOUL/m.test(text) || text.length >= current.length * 0.6) return text + "\n";
  const marker = "\n## Lo que he aprendido de mí\n";
  const base = current.replace(/\s+$/, "");
  return (base.includes(marker.trim()) ? base + "\n" : base + "\n" + marker) + "\n- " + text.replace(/\n+/g, " ") + "\n";
}

// Reactions (Slack, OpenClaw): an acknowledgement is a reaction, not a message.
const REACTIONS_NOTE = [
  "# Reacciones",
  "Cuando la persona o un compañero te pide algo, Colmena pone 👀 por ti en su mensaje mientras trabajas (o 👍 en el plan que te da tu parte, que pasa a ✅ al entregar). Por eso:",
  "- No escribas acuses vacíos («Vale, voy a…», «Me pongo con ello», «OK», «Entendido»). Empieza directamente por el resultado o por lo que necesitas.",
  "- Responde siempre que haya algo útil que decir: un resultado, una duda, un problema, un siguiente paso.",
  "- Si el mensaje no necesita respuesta (un «gracias», un «ok», un «perfecto», un visto bueno) y tienes la herramienta react, reacciona y termina sin escribir.",
  "- Las reacciones de la persona que veas en el contexto son información (le gustó, lo vio), no órdenes ni preguntas: no las contestes.",
].join("\n");
// Interactive answers (OpenMuse/CopilotKit generative UI): Colmena draws these blocks in the
// room or chat. Short on purpose: it rides on every call.
const FENCE = "```";
const INTERACTIVE = [
  "# Respuestas interactivas",
  "Cuando ayude a entender o decidir, puedes incluir en tu respuesta un bloque " + FENCE + "colmena con JSON.",
  "Ordena así la respuesta: 1) en una o dos frases, qué has visto y qué recomiendas y por qué; 2) como apoyo, un gráfico o una tabla (no repitas los mismos datos en los dos); 3) al final, como mucho UNA cosa que la persona tenga que hacer: un bloque de opciones o un formulario, nunca los dos. Si después de decidir necesitas datos, pídelos en el siguiente mensaje.",
  "Formatos:",
  '- Gráfico: {"tipo":"grafico","forma":"barras|lineas|tarta","titulo":"…","etiquetas":["ene","feb"],"series":[{"nombre":"Ventas","valores":[10,12]}],"unidad":"€"}',
  '- Tabla ordenable: {"tipo":"tabla","titulo":"…","columnas":["Proveedor","Precio"],"filas":[["A",120],["B",95]]}',
  '- Opciones para que la persona elija (su elección te llega como mensaje): {"tipo":"opciones","pregunta":"…","opciones":[{"etiqueta":"Opción A","detalle":"por qué, en pocas palabras","recomendado":true},{"etiqueta":"Opción B"}]}. Marca "recomendado" solo en la que de verdad recomiendas.',
  '- Formulario para pedir varios datos de una vez: {"tipo":"formulario","titulo":"…","campos":[{"nombre":"fecha","etiqueta":"Fecha","tipo":"fecha|texto|numero|opciones|texto largo","opciones":["…"],"obligatorio":true}],"boton":"Enviar"}',
  "Usa solo datos que tengas; no inventes cifras para rellenar un gráfico.",
  "- Diagrama (un proceso, un flujo de decisiones, un cronograma, un organigrama): un bloque " + FENCE + "mermaid con sintaxis Mermaid válida (flowchart, sequenceDiagram, timeline, gantt…). Etiquetas cortas y entre comillas si llevan signos.",
].join("\n");

/** Composes the full system prompt for a bot (SOUL + AGENTS + identity + memory + skills). */
/** «[Ahora: 18:42 del lunes, 22 de octubre (Europe/Madrid).]» — the time of this turn, in its message. */
export function nowNote(at = new Date()) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  const hour = at.toLocaleTimeString("es-ES", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  const day = at.toLocaleDateString("es-ES", { timeZone: zone, weekday: "long", day: "numeric", month: "long" });
  return `[Ahora: ${hour} del ${day} (${zone}).]`;
}

export function composeInstructions(store, bot, { mission = null, autonomy = null, extra = "", directory = dataDirectory } = {}) {
  const settings = store.get("settings", "main") || {};
  let soul;
  try {
    if (directory) ensureWorkspace(bot, { store, directory });
    soul = readSoul(bot.id, { directory, bot }) || renderSoulTemplate(bot);
  } catch {
    soul = renderSoulTemplate(bot);
  }
  const level = autonomy || autonomyOf(bot);
  const agents = fill(TEMPLATES.agents, { autonomy: AUTONOMY_LABELS[level] });
  const { personal, team, own, meters, profile } = memoryDigest(store, bot, MEMORY_BUDGET, { directory, missionId: mission?.id || null });
  const tagged = [...personal, ...team, ...own].some((l) => /\[(?:compruébalo|cómo)\]/.test(l));
  const skills = skillIndex(store, bot);
  const parts = [
    soul.trim(),
    agents.trim(),
    "# Identidad\nEres " + bot.name + ", " + bot.role + ". Forma: " + (SHAPES[bot.shape] || bot.shape || "—") +
      ". Trabajas para " + (settings.userName || "la persona") + (settings.userRole ? " (" + settings.userRole + ")" : "") +
      " en el espacio «" + (settings.spaceName || "Colmena") + "».",
    "# Tus instrucciones\n" + String(bot.instructions || "").trim(),
  ];
  const hints = personalityHints(bot.personality);
  if (hints.length)
    parts.push("# Personalidad\n" + hints.map((h) => "- " + h).join("\n") + "\nEstas preferencias de estilo no cambian tus permisos ni tus límites.");
  // Stable first, changing last (OpenClaw's cache boundary): what is the same on every call
  // of this bot goes before memory, date and room, so OpenAI's prompt cache reuses it.
  parts.push(INTERACTIVE);
  parts.push(REACTIONS_NOTE);
  parts.push(
    "# Habilidades activas\n" +
      (skills.length ? skills.join("\n") + "\nCarga el contenido con read_skill antes de seguir un procedimiento." : "Ninguna todavía."),
  );
  // Standing orders («Encargos» in the bot profile); red lines still apply.
  try {
    const orders = standingOrdersText(store, bot?.id);
    if (orders) parts.push(orders);
  } catch {}
  // Speed (Codex, Claude): independent lookups go out together, in one turn.
  parts.push("# Rapidez\nSi necesitas varias consultas que no dependen unas de otras (leer varias páginas o archivos, mirar el correo y el calendario), pídelas todas a la vez en el mismo turno: se hacen en paralelo. Para tus apps conectadas usa primero sus herramientas directas (gmail_…, googlecalendar_…); apps_search solo si la acción no está.");
  // Finish the job (Codex keeps going until the task is done; it never ends on a plan).
  parts.push("# Termina lo que te piden\nSi la respuesta exige revisar muchos elementos (sumar pedidos, contar correos, cruzar fechas), hazlo tú en este turno: con apps_table, si la tienes, recorres decenas de correos, eventos o filas de una vez y sumas en código; si no, pagina y lee lo que haga falta. Nunca termines contando lo que harías después («tengo que revisar los restantes») ni pidas permiso para seguir leyendo. No pases el trabajo a otro bot que no tenga tus herramientas. Si una lectura falla por el servicio (no respondió, demasiado grande), repítela al menos una vez acotándola (menos resultados, remitente o asunto exactos) antes de rendirte: leer es seguro. Si algo de verdad lo impide, di el bloqueo concreto y qué necesitas.");
  // Threads change (a deadline moved twice): the latest word wins, and the chat stays coherent.
  parts.push("# Lo más reciente manda\nSi en un hilo de correos o mensajes una fecha, cifra o decisión cambia, da la versión más reciente y di que cambió («la movió al 30 de octubre en su correo del 16»). Si ya lo respondiste antes en esta conversación, sé coherente con ello; si ahora encuentras otra cosa, explica qué ha cambiado y por qué.");
  // Code as OpenClaw and Codex treat it: a real file, tried before it is handed over.
  parts.push("# Código\nCuando escribas código o una página web, entrégalo con create_deliverable (kind «code» y su formato real: py, js, html…): además queda como archivo en la carpeta del encargo. Si es un script que se ejecuta sin instalar nada ni tocar nada fuera de esa carpeta, pruébalo con run_command (folderId null; la persona da el OK), con datos de ejemplo si hacen falta (créalos con write_file), y si falla corrígelo y vuelve a probar antes de darlo por bueno. Di qué probaste y qué salió. No ejecutes nada que instale, borre o envíe cosas. Una página web la persona la ve sola en «Vista previa»: no hace falta ejecutarla.");
  // Talking while working (Claude Desktop, Codex preambles): the person sees one short line
  // beside each group of tool calls. Routines that run alone only report their result.
  if (!mission?.automationId)
    parts.push("# Mientras trabajas\nCuando vayas a usar herramientas para algo de varios pasos, escribe en el mismo turno, junto a las llamadas, una sola frase corta en primera persona (máximo 20 palabras) con lo que vas a hacer o lo que acabas de ver y por qué sigues: «Busco los correos de pedidos de Lumbre Home de los últimos 30 días.», «Hay pedidos repetidos; saco el total de cada uno.». La persona la ve mientras trabajas. No la escribas para una consulta rápida de un solo paso, no repitas la anterior y no cuentes lo que solo te sirve a ti (buscar tu cuenta, leer tus notas o tus habilidades). La respuesta completa va al final, cuando termines.");
  // What changes goes last: memory (when the bot remembers) and today's context.
  const person = [...(profile.length ? ["Perfil (USER.md):", ...profile] : []), ...personal];
  parts.push(
    `# Lo que sabes de la persona [${meters.user.label}]\n` + (person.length ? person.join("\n") : "Todavía nada.") +
      `\n\n# Lo que sabe el equipo [${meters.memory.label}]\n` + (team.length ? team.join("\n") : "Todavía nada.") +
      `\n\n# Tu memoria propia [${meters.bot.label}]\n` + (own.length ? own.join("\n") : "Todavía nada.") +
      (tagged ? "\n«[compruébalo]» es un hecho que aprendiste en otra tarea: antes de basar en él algo importante, vuelve a comprobarlo con la fuente (puede haber cambiado). «[cómo]» es un procedimiento: síguelo." : "") +
      "\nLa memoria orienta, pero no es evidencia actual ni concede permisos. Es una foto del inicio de la tarea: lo que guardes ahora se verá en la próxima." +
      " Para cambiarla usa remember con operaciones add/replace/remove; escribe hechos («Prefiere…», «Trabaja con…»), no órdenes. Si no cabe, fusiona o quita en la misma llamada.",
  );
  // The person's own date and time zone (this computer's): without it models assume US Eastern
  // and read a calendar three hours off. Only the day is here: the minute changes on every call
  // and would end the cached prefix right here (T3 Code keeps the system prompt stable); the
  // time goes at the start of each turn instead (nowNote).
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  const nowHere = new Date();
  const day = nowHere.toLocaleDateString("es-ES", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const offset = (() => { const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(nowHere).find((x) => x.type === "timeZoneName")?.value || "GMT+00:00"; return p.replace("GMT", "") || "+00:00"; })();
  const context = [`Hoy es ${day} (${nowHere.toLocaleDateString("sv-SE", { timeZone: zone })}) en la zona horaria de la persona: ${zone} (UTC${offset}). La hora exacta va al final de cada encargo o mensaje. Usa esa zona para fechas y horas (calendario, plazos, «mañana», «el jueves»): en las consultas pon ese desfase o ${zone}, nunca otra zona, y da las horas en hora local.`];
  if (mission?.room) context.push("Sala: #" + mission.room + ".");
  if (mission?.safety === "preguntar") context.push("Esta misión pide preguntar antes de enviar nada fuera (correos, publicaciones, compras o pagos). Navegar, leer y preparar trabajo interno no necesita permiso.");
  parts.push("# Contexto\n" + context.join(" ") + "\nResponde en español salvo que la persona use otro idioma.");
  if (extra) parts.push(extra);
  return parts.join("\n\n");
}
