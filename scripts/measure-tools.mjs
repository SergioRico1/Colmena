// Measures what the tool definitions cost on every model call: how many tools a bot gets in
// a few typical configurations and how big their definitions are (characters and approximate
// tokens), listing everything («todas», as before tools on demand) and with the long tail
// behind find_tools/use_tool («a la vista», server/tool-search.mjs). It builds a throwaway
// database in the system's temp folder — never your own data — with the real definitions of
// the built-in, computer, project, desktop, secret and MCP tools and faked connected apps.
// Usage: node scripts/measure-tools.mjs [--json]
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { computerToolDefs } from "../server/computer/tools.mjs";
import { projectToolDefs } from "../server/projects/tools.mjs";
import { desktopExtraTools } from "../server/computer/desktop.mjs";
import { secretsExtraTools } from "../server/secrets.mjs";
import { mcpExtraTools } from "../server/mcp/tools.mjs";
import { CURATED, LIMITS, TABLE_TOOL, toFunction } from "../server/apptools.mjs";
import { toolDefinition } from "../server/tools.mjs";

const CHARS_PER_TOKEN = 4;
const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-measure-tools-"));
const store = new Store(directory);
store.patch("settings", "main", { model: "fixture", learning: false });
const runtime = new Runtime(store, { respond: async () => ({ text: "", output: [] }) }, { call: async () => ({}) });

// A connected app's action as Composio describes it: a dozen parameters with long descriptions.
const fakeSchema = (slug) => ({
  tool: slug, toolkit: slug.split("_")[0].toLowerCase(), name: slug,
  description: "Acción «" + slug.toLowerCase().replace(/_/g, " ") + "» de la app conectada: lee o cambia elementos con filtros, paginación y campos opcionales, y devuelve el resultado con sus identificadores.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(["query", "max_results", "page_token", "label_ids", "include_payload", "user_id", "time_min", "time_max", "calendar_id", "verbose"].map((p) => [p, {
      type: p.startsWith("max") ? "integer" : p.startsWith("include") || p === "verbose" ? "boolean" : "string",
      description: "Parámetro " + p + " de la acción: admite la sintaxis propia del servicio, con valores por defecto razonables cuando se deja vacío; consulta el formato exacto en el ejemplo.",
    }])),
    required: ["query"],
  },
});
const appTools = () => {
  const account = [{ id: "ca_1", alias: "trabajo" }];
  const lists = ["gmail", "googlecalendar", "googlesheets", "googledrive", "notion"].map((k) => CURATED[k].map((slug) => toFunction(fakeSchema(slug), account)));
  const defs = [];
  for (let i = 0; i < 8; i++) for (const list of lists) if (list[i] && defs.length < LIMITS.tools) defs.push(list[i]);
  return [{ ...TABLE_TOOL, capability: "apps" }, ...defs.map((d) => ({ name: d.name, description: d.description, parameters: d.parameters, capability: "apps" }))];
};
const mcpHub = { connected: () => ["linear", "notion", "stripe", "github"].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), tools: Array.from({ length: 30 }, (_, i) => ({ name: id + "_tool_" + i })) })) };
const strip = (defs, capability) => defs.map(({ type: _type, ...def }) => ({ ...def, ...(capability ? { capability } : {}) }));
const computer = (bot) => [
  ...strip(computerToolDefs(bot, { available: true, settings: runtime.settings() })),
  ...strip(projectToolDefs(), "ordenador"),
  ...desktopExtraTools(runtime, { available: true })(),
  ...secretsExtraTools(runtime, { available: true, list: () => [] })(),
];

const CONFIGS = [
  { label: "Chat sin extras", capabilities: { web: false, carpetas: false, apps: false, ordenador: false }, extra: () => [], connections: false },
  { label: "Archivos y web", capabilities: { web: true, carpetas: true, apps: false, ordenador: false }, extra: () => [], connections: false },
  { label: "Ordenador (navegador, proyectos, escritorio)", capabilities: { web: true, carpetas: true, apps: false, ordenador: true }, extra: computer, connections: false },
  { label: "Apps conectadas + 4 servidores MCP", capabilities: { web: true, carpetas: true, apps: true, ordenador: false }, extra: () => [...mcpExtraTools(runtime, mcpHub)(), ...appTools()], connections: true },
  { label: "Todo a la vez", capabilities: { web: true, carpetas: true, apps: true, ordenador: true }, extra: (bot) => [...computer(bot), ...mcpExtraTools(runtime, mcpHub)(), ...appTools()], connections: true },
];

const size = (tools) => {
  const chars = JSON.stringify(tools.map(toolDefinition)).length;
  return { tools: tools.length, chars, tokens: Math.ceil(chars / CHARS_PER_TOKEN) };
};
const mission = { id: "m", botIds: ["nora"], mode: "solo", conversation: true };
const rows = [];
const connections = runtime.connections;
for (const config of CONFIGS) {
  const bot = { id: "nora", name: "Nora", role: "Analista", capabilities: config.capabilities };
  runtime.connections = config.connections ? connections : null;
  runtime.extraTools = (b) => config.extra(b);
  const step = { id: "m:s", kind: "solo", botId: "nora", missionId: "m" };
  const all = runtime.toolsForStep(mission, step, bot);
  // Tools on demand (when this checkout has them): what is listed, and the note in the prompt.
  const listed = typeof runtime.listedTools === "function" ? runtime.listedTools(mission, step, bot, all) : null;
  const note = listed && typeof runtime.toolsNote === "function" ? runtime.toolsNote(all, listed) : "";
  const biggest = [...all].map((t) => ({ name: t.name, chars: JSON.stringify(toolDefinition(t)).length })).sort((a, b) => b.chars - a.chars).slice(0, 5);
  rows.push({
    config: config.label, todas: size(all),
    ...(listed ? { aLaVista: { ...size(listed), nota: note.length, tokens: Math.ceil((JSON.stringify(listed.map(toolDefinition)).length + note.length) / CHARS_PER_TOKEN) } } : {}),
    mayores: biggest,
  });
}
store.close?.();
await rm(directory, { recursive: true, force: true }).catch(() => {});

if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  const pad = (v, n) => String(v).padStart(n);
  console.log("Definiciones de herramientas por llamada al modelo (≈ " + CHARS_PER_TOKEN + " caracteres por token)\n");
  console.log("Configuración".padEnd(46) + pad("todas", 7) + pad("carac.", 9) + pad("tokens", 8) + "  │" + pad("vista", 7) + pad("carac.", 9) + pad("tokens", 8) + pad("ahorro", 8));
  for (const r of rows) {
    const after = r.aLaVista;
    console.log(r.config.padEnd(46) + pad(r.todas.tools, 7) + pad(r.todas.chars, 9) + pad(r.todas.tokens, 8) + "  │" +
      (after ? pad(after.tools, 7) + pad(after.chars + after.nota, 9) + pad(after.tokens, 8) + pad(Math.round((1 - after.tokens / r.todas.tokens) * 100) + " %", 8) : "   (sin herramientas bajo demanda)"));
  }
  console.log("\nLas cinco mayores de «Todo a la vez»: " + rows.at(-1).mayores.map((t) => t.name + " " + t.chars).join(", "));
}
